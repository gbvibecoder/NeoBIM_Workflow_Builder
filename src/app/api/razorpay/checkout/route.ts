import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { razorpay, resolveRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 5 checkout attempts per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, 'razorpay-checkout', 5, '1 m');
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Too many requests', message: 'Please wait before trying again.', code: 'RATE_001' }),
        { status: 429 },
      );
    }

    let plan: string;
    try {
      ({ plan } = await req.json());
    } catch {
      return NextResponse.json(
        formatErrorResponse({ title: 'Invalid request', message: 'Invalid request body.', code: 'FORM_001' }),
        { status: 400 },
      );
    }

    // Normalize plan name
    const normalizedPlan = plan === 'TEAM' ? 'TEAM_ADMIN' : plan;
    if (!normalizedPlan || !['MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'].includes(normalizedPlan)) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Invalid plan', message: 'Please select a valid plan.', code: 'VAL_001' }),
        { status: 400 },
      );
    }

    // Resolve Razorpay plan ID
    const razorpayPlanId = resolveRazorpayPlanId(normalizedPlan);
    if (!razorpayPlanId) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Configuration error', message: 'Razorpay plan is not configured. Please contact support.', code: 'RAZORPAY_CONFIG' }),
        { status: 500 },
      );
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        razorpaySubscriptionId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'Your account could not be found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    // Guard: if user already has an active Razorpay subscription, block
    if (user.razorpaySubscriptionId) {
      try {
        const existingSub = await razorpay.subscriptions.fetch(user.razorpaySubscriptionId);
        if (['active', 'authenticated', 'pending'].includes(existingSub.status)) {
          return NextResponse.json(
            formatErrorResponse({
              title: 'Subscription already active',
              message: 'You already have an active subscription. Please cancel it first to switch plans.',
              code: 'BILL_001',
              action: 'Manage Subscription',
              actionUrl: '/dashboard/billing',
            }),
            { status: 400 },
          );
        }
        // Dead subscription — clear stale data
        await prisma.user.update({
          where: { id: user.id },
          data: { razorpaySubscriptionId: null, razorpayPlanId: null },
        });
      } catch {
        // Can't verify — clear stale data
        await prisma.user.update({
          where: { id: user.id },
          data: { razorpaySubscriptionId: null, razorpayPlanId: null },
        });
      }
    }

    // Also guard against active Stripe subscriptions
    if (user.stripeSubscriptionId && user.role !== 'FREE') {
      return NextResponse.json(
        formatErrorResponse({
          title: 'Active Stripe subscription',
          message: 'You have an active Stripe subscription. Please cancel it first before switching to Razorpay.',
          code: 'BILL_001',
          action: 'Manage Billing',
          actionUrl: '/dashboard/billing',
        }),
        { status: 400 },
      );
    }

    // Create Razorpay subscription
    try {
      const subscription = await razorpay.subscriptions.create({
        plan_id: razorpayPlanId,
        total_count: 120, // Allow up to 120 billing cycles (10 years monthly)
        quantity: 1,
        customer_notify: 0, // We handle notifications
        notes: {
          userId: user.id,
          plan: normalizedPlan,
          email: user.email!,
        },
      });

      console.info('[razorpay/checkout] Subscription created:', {
        userId: user.id,
        subscriptionId: subscription.id,
        plan: normalizedPlan,
      });

      return NextResponse.json({
        subscriptionId: subscription.id,
        razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID,
        amount: subscription.plan_id ? undefined : undefined, // Amount is handled by subscription
        currency: 'INR',
        name: user.name || undefined,
        email: user.email,
        plan: normalizedPlan,
      });
    } catch (razorpayError) {
      console.error('[razorpay/checkout] Subscription creation failed:', razorpayError);
      return NextResponse.json(
        formatErrorResponse({ title: 'Payment setup failed', message: 'Unable to create subscription. Please try again.', code: 'RAZORPAY_001' }),
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    console.error('[razorpay/checkout] Unexpected error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
