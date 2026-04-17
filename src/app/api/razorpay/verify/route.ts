import { NextResponse } from 'next/server';
import { auth, invalidateUserRoleCache } from '@/lib/auth';
import { razorpay, verifyPaymentSignature, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';

/**
 * POST — Verify Razorpay payment after checkout widget success.
 * Called by the frontend after the Razorpay checkout handler fires.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, 'razorpay-verify', 10, '1 m');
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Too many requests', message: 'Please wait before trying again.', code: 'RATE_001' }),
        { status: 429 },
      );
    }

    let razorpay_payment_id: string;
    let razorpay_subscription_id: string;
    let razorpay_signature: string;

    try {
      const body = await req.json();
      razorpay_payment_id = body.razorpay_payment_id;
      razorpay_subscription_id = body.razorpay_subscription_id;
      razorpay_signature = body.razorpay_signature;
    } catch {
      return NextResponse.json(
        formatErrorResponse({ title: 'Invalid request', message: 'Invalid request body.', code: 'FORM_001' }),
        { status: 400 },
      );
    }

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Missing parameters', message: 'Payment verification parameters are missing.', code: 'VAL_001' }),
        { status: 400 },
      );
    }

    // Step 1: Verify signature
    const isValid = verifyPaymentSignature({
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    });

    if (!isValid) {
      console.error('[razorpay/verify] Signature verification FAILED:', {
        userId: session.user.id,
        subscriptionId: razorpay_subscription_id,
        paymentId: razorpay_payment_id,
      });
      return NextResponse.json(
        formatErrorResponse({ title: 'Verification failed', message: 'Payment signature verification failed. Please contact support.', code: 'RAZORPAY_002' }),
        { status: 400 },
      );
    }

    // Step 2: Fetch subscription from Razorpay to get plan details
    let subscription;
    try {
      subscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    } catch (fetchError) {
      console.error('[razorpay/verify] Failed to fetch subscription:', fetchError);
      return NextResponse.json(
        formatErrorResponse({ title: 'Verification failed', message: 'Unable to verify subscription. Please contact support.', code: 'RAZORPAY_003' }),
        { status: 502 },
      );
    }

    // Step 3: Map plan to role
    const planId = subscription.plan_id;
    const newRole = getRoleByRazorpayPlanId(planId);

    // Step 4: Calculate period end
    // Razorpay charge_at is the next charge timestamp; current_end is period end
    const periodEndTimestamp = subscription.current_end || subscription.charge_at;
    const currentPeriodEnd = periodEndTimestamp
      ? new Date(periodEndTimestamp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback: 30 days from now

    // Step 5: Update user in DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'Your account could not be found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    // If a paid Razorpay plan_id can't be mapped to a role (env var drift,
    // wrong RAZORPAY_*_PLAN_ID in prod, regenerated plan), do NOT downgrade
    // the user to FREE. Store the subscription metadata so ops can re-run a
    // backfill once env vars are corrected, and preserve the existing role.
    // Mirrors the Stripe webhook guard in src/app/api/stripe/webhook/route.ts.
    if (newRole === 'FREE' && planId) {
      console.error('[razorpay/verify] CRITICAL: Paid subscription resolved to FREE — refusing to downgrade user.', {
        userId: session.user.id,
        planId,
        subscriptionId: razorpay_subscription_id,
        currentRole: user.role,
        envMini: process.env.RAZORPAY_MINI_PLAN_ID ? 'set' : 'MISSING',
        envStarter: process.env.RAZORPAY_STARTER_PLAN_ID ? 'set' : 'MISSING',
        envPro: process.env.RAZORPAY_PRO_PLAN_ID ? 'set' : 'MISSING',
        envTeam: process.env.RAZORPAY_TEAM_PLAN_ID ? 'set' : 'MISSING',
      });

      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          razorpaySubscriptionId: razorpay_subscription_id,
          razorpayPlanId: planId,
          paymentGateway: 'razorpay',
          stripeCurrentPeriodEnd: currentPeriodEnd,
          // role deliberately NOT touched — keep user's existing role
        },
      });

      return NextResponse.json(
        formatErrorResponse({
          title: 'Plan activation needs attention',
          message: 'Your payment succeeded but your plan could not be activated automatically. Our team has been notified — please contact support.',
          code: 'RAZORPAY_PLAN_UNMAPPED',
        }),
        { status: 502 },
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        role: newRole,
        razorpaySubscriptionId: razorpay_subscription_id,
        razorpayPlanId: planId,
        paymentGateway: 'razorpay',
        stripeCurrentPeriodEnd: currentPeriodEnd, // Reuse this field for period tracking
      },
    });
    invalidateUserRoleCache(session.user.id);

    console.info('[razorpay/verify] Subscription activated:', {
      userId: session.user.id,
      role: newRole,
      subscriptionId: razorpay_subscription_id,
      planId,
    });

    // Welcome email is sent by the Razorpay webhook on `subscription.activated`
    // (src/app/api/razorpay/webhook/route.ts). Razorpay retries failed webhook
    // deliveries, so that's the reliable path — sending it here too was
    // causing every new subscriber to receive two welcome emails.

    return NextResponse.json({
      success: true,
      role: newRole,
      previousRole: user.role,
    });
  } catch (error: unknown) {
    console.error('[razorpay/verify] Unexpected error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
