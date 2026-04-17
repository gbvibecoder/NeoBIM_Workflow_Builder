import { NextResponse } from 'next/server';
import { auth, invalidateUserRoleCache } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';

/**
 * Razorpay statuses that indicate the subscription is paid-for and should
 * grant the user their plan role. `authenticated` and `pending` cover the
 * UPI-mandate authorization window; `active` is post-first-charge.
 */
const LIVE_RAZORPAY_STATUSES = new Set(['active', 'authenticated', 'pending']);

/**
 * GET — Read current Razorpay subscription status for the signed-in user.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, 'razorpay-subscription', 10, '1 m');
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Too many requests', message: 'Please try again later.', code: 'RATE_001' }),
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        razorpaySubscriptionId: true,
        razorpayPlanId: true,
        paymentGateway: true,
        stripeCurrentPeriodEnd: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'No user account found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    let subscriptionStatus: { status: string; planId: string | null } | null = null;
    if (user.razorpaySubscriptionId) {
      try {
        const sub = await razorpay.subscriptions.fetch(user.razorpaySubscriptionId);
        subscriptionStatus = { status: sub.status, planId: sub.plan_id ?? null };
      } catch (err) {
        console.error('[RAZORPAY_SUBSCRIPTION] Failed to fetch subscription:', err);
      }
    }

    return NextResponse.json({
      role: user.role,
      subscription: subscriptionStatus,
      paymentGateway: user.paymentGateway,
      razorpaySubscriptionId: user.razorpaySubscriptionId,
    });
  } catch (error) {
    console.error('[RAZORPAY_SUBSCRIPTION] GET error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

/**
 * POST — Safety-net sync from Razorpay.
 *
 * Called by the thank-you page after checkout, and available as a user-triggered
 * recovery path. If /api/razorpay/verify failed for any reason (network blip,
 * tab closed during redirect, handler JS error), this re-queries Razorpay and
 * reconciles the DB role.
 *
 * Never downgrades a paid user: if the live subscription's plan_id can't be
 * mapped to a role (env var drift), we preserve the user's current role and
 * return `synced: false, reason: "unmapped_plan_id"` so ops can investigate.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, 'razorpay-sync', 5, '1 m');
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Too many requests', message: 'Please wait before syncing again.', code: 'RATE_001' }),
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        razorpaySubscriptionId: true,
        razorpayPlanId: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'No user account found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    if (!user.razorpaySubscriptionId) {
      return NextResponse.json({ role: user.role, synced: false, reason: 'no_razorpay_subscription' });
    }

    let sub;
    try {
      sub = await razorpay.subscriptions.fetch(user.razorpaySubscriptionId);
    } catch (err) {
      console.error('[RAZORPAY_SYNC] Failed to fetch subscription:', err);
      return NextResponse.json(
        formatErrorResponse({
          title: 'Sync failed',
          message: 'Unable to verify your subscription with Razorpay. Please try again or contact support.',
          code: 'RAZORPAY_SYNC_001',
        }),
        { status: 502 },
      );
    }

    // Subscription not in a live state — leave role untouched; the regular
    // cancellation webhook is responsible for downgrades.
    if (!LIVE_RAZORPAY_STATUSES.has(sub.status)) {
      return NextResponse.json({
        role: user.role,
        synced: false,
        reason: 'subscription_not_live',
        subscriptionStatus: sub.status,
      });
    }

    const planId = sub.plan_id ?? null;
    const newRole = getRoleByRazorpayPlanId(planId);

    // Live subscription but unmapped plan_id — refuse to downgrade.
    if (newRole === 'FREE' && planId) {
      console.error('[RAZORPAY_SYNC] CRITICAL: Live subscription resolved to FREE — refusing to downgrade user.', {
        userId: user.id,
        planId,
        subscriptionId: user.razorpaySubscriptionId,
        currentRole: user.role,
        envMini: process.env.RAZORPAY_MINI_PLAN_ID ? 'set' : 'MISSING',
        envStarter: process.env.RAZORPAY_STARTER_PLAN_ID ? 'set' : 'MISSING',
        envPro: process.env.RAZORPAY_PRO_PLAN_ID ? 'set' : 'MISSING',
        envTeam: process.env.RAZORPAY_TEAM_PLAN_ID ? 'set' : 'MISSING',
      });

      // Keep the stored plan_id current so a future backfill can resolve it
      // once env vars are corrected — but do not touch role.
      if (user.razorpayPlanId !== planId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { razorpayPlanId: planId, paymentGateway: 'razorpay' },
        });
      }

      return NextResponse.json({
        role: user.role,
        synced: false,
        reason: 'unmapped_plan_id',
        planId,
      });
    }

    const periodEnd = sub.current_end || sub.charge_at;
    const currentPeriodEnd = periodEnd
      ? new Date(periodEnd * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (user.role !== newRole || user.razorpayPlanId !== planId) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            razorpaySubscriptionId: user.razorpaySubscriptionId,
            razorpayPlanId: planId,
            paymentGateway: 'razorpay',
            stripeCurrentPeriodEnd: currentPeriodEnd,
          },
        });
        invalidateUserRoleCache(user.id);

        console.info('[RAZORPAY_SYNC] Reconciled user role:', {
          userId: user.id,
          previousRole: user.role,
          newRole,
          subscriptionId: user.razorpaySubscriptionId,
        });

        return NextResponse.json({ role: newRole, synced: true, previousRole: user.role });
      } catch (dbError) {
        console.error('[RAZORPAY_SYNC] DB update failed:', dbError);
        return NextResponse.json(
          formatErrorResponse({
            title: 'Database update failed',
            message: 'Your payment was received but we could not update your plan. Please contact support.',
            code: 'RAZORPAY_SYNC_002',
          }),
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ role: user.role, synced: false, reason: 'already_synced' });
  } catch (error) {
    console.error('[RAZORPAY_SYNC] Unexpected error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
