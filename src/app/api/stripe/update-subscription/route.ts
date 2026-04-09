import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';
import { sendPlanChangedEmail } from '@/services/email';

const TIER_ORDER = ['FREE', 'MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'] as const;

function resolvePriceId(plan: string): string | undefined {
  switch (plan) {
    case 'MINI': return process.env.STRIPE_MINI_PRICE_ID;
    case 'STARTER': return process.env.STRIPE_STARTER_PRICE_ID;
    case 'PRO': return process.env.STRIPE_PRICE_ID;
    case 'TEAM_ADMIN': return process.env.STRIPE_TEAM_PRICE_ID;
    default: return undefined;
  }
}

/**
 * POST — Change subscription plan for existing subscribers.
 * Upgrades apply immediately with proration.
 * Downgrades schedule at period end.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 5 plan change attempts per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, 'stripe-update-sub', 5, '1 m');
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

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'Your account could not be found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    // Must have active subscription to change plan
    if (!user.stripeSubscriptionId || !user.stripeCustomerId) {
      return NextResponse.json(
        formatErrorResponse({
          title: 'No active subscription',
          message: 'You need an active subscription to change plans. Please subscribe first.',
          code: 'BILL_001',
          action: 'Subscribe',
          actionUrl: '/dashboard/billing',
        }),
        { status: 400 },
      );
    }

    // Same plan check
    if (user.role === normalizedPlan) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Already on this plan', message: 'You are already subscribed to this plan.', code: 'BILL_001' }),
        { status: 400 },
      );
    }

    // Resolve new price ID
    const newPriceId = resolvePriceId(normalizedPlan);
    if (!newPriceId) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Configuration error', message: 'Plan price is not configured. Please contact support.', code: 'STRIPE_CONFIG' }),
        { status: 500 },
      );
    }

    // Retrieve current subscription from Stripe
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    } catch (stripeError) {
      console.error('[stripe/update-sub] Failed to retrieve subscription:', stripeError);
      return NextResponse.json(
        formatErrorResponse({ title: 'Subscription not found', message: 'Unable to find your subscription. Please contact support.', code: 'STRIPE_001' }),
        { status: 404 },
      );
    }

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return NextResponse.json(
        formatErrorResponse({ title: 'Subscription inactive', message: 'Your subscription is not active. Please subscribe to a new plan.', code: 'BILL_002' }),
        { status: 400 },
      );
    }

    const currentItemId = subscription.items.data[0]?.id;
    if (!currentItemId) {
      console.error('[stripe/update-sub] No subscription item found:', subscription.id);
      return NextResponse.json(
        formatErrorResponse({ title: 'Subscription error', message: 'Unable to modify your subscription. Please contact support.', code: 'STRIPE_001' }),
        { status: 500 },
      );
    }

    // Determine upgrade vs downgrade
    const currentTierIndex = TIER_ORDER.indexOf(user.role as typeof TIER_ORDER[number]);
    const newTierIndex = TIER_ORDER.indexOf(normalizedPlan as typeof TIER_ORDER[number]);
    const isUpgrade = newTierIndex > currentTierIndex;

    try {
      if (isUpgrade) {
        // Upgrade: apply immediately with proration
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
          items: [{ id: currentItemId, price: newPriceId }],
          proration_behavior: 'create_prorations',
        });

        // Update DB immediately for upgrades
        const newRole = getPlanByPriceId(newPriceId);
        const firstItem = updatedSubscription.items?.data?.[0];
        const currentPeriodEnd = firstItem?.current_period_end
          ?? Math.floor(Date.now() / 1000);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            stripePriceId: newPriceId,
            stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
          },
        });

        console.info('[stripe/update-sub] Upgrade applied:', {
          userId: user.id,
          from: user.role,
          to: newRole,
          subscriptionId: subscription.id,
        });

        // Send plan changed email (fire-and-forget)
        if (user.email) {
          sendPlanChangedEmail(user.email, user.name, user.role, newRole, 'upgrade').catch((err) => console.error("[webhook] Failed to send plan changed email:", err));
        }

        return NextResponse.json({
          success: true,
          type: 'upgrade',
          newRole,
          previousRole: user.role,
          effectiveImmediately: true,
        });
      } else {
        // Downgrade: change price immediately, no proration (no refund for remaining period)
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
          items: [{ id: currentItemId, price: newPriceId }],
          proration_behavior: 'none',
        });

        // Update DB immediately — webhook will also fire but both resolve to same role
        const newRole = getPlanByPriceId(newPriceId);
        const firstItem = updatedSubscription.items?.data?.[0];
        const currentPeriodEnd = firstItem?.current_period_end
          ?? Math.floor(Date.now() / 1000);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            stripePriceId: newPriceId,
            stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
          },
        });

        console.info('[stripe/update-sub] Downgrade applied:', {
          userId: user.id,
          from: user.role,
          to: newRole,
          subscriptionId: subscription.id,
        });

        // Send plan changed email (fire-and-forget)
        if (user.email) {
          sendPlanChangedEmail(user.email, user.name, user.role, normalizedPlan, 'downgrade').catch((err) => console.error("[webhook] Failed to send plan changed email:", err));
        }

        return NextResponse.json({
          success: true,
          type: 'downgrade',
          newRole: normalizedPlan,
          previousRole: user.role,
          effectiveImmediately: true,
        });
      }
    } catch (stripeError) {
      console.error('[stripe/update-sub] Failed to update subscription:', stripeError);
      return NextResponse.json(
        formatErrorResponse({
          title: 'Plan change failed',
          message: 'Unable to change your plan. Please try again or contact support.',
          code: 'STRIPE_001',
        }),
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    console.error('[stripe/update-sub] Unexpected error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
