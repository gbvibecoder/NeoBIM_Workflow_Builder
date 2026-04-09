import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { razorpay, verifyPaymentSignature, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';
import { sendWelcomeEmail } from '@/shared/services/email';

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

    if (newRole === 'FREE' && planId) {
      console.error('[razorpay/verify] CRITICAL: Paid subscription resolved to FREE!', {
        userId: session.user.id,
        planId,
        subscriptionId: razorpay_subscription_id,
      });
    }

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

    console.info('[razorpay/verify] Subscription activated:', {
      userId: session.user.id,
      role: newRole,
      subscriptionId: razorpay_subscription_id,
      planId,
    });

    // Send welcome email (fire-and-forget)
    if (user.email) {
      sendWelcomeEmail(user.email, user.name, newRole).catch((err) => console.error("[webhook] Failed to send welcome email:", err));
    }

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
