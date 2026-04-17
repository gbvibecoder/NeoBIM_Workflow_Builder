import { prisma } from '@/lib/db';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { invalidateUserRoleCache } from '@/lib/auth';

const LIVE_RAZORPAY_STATUSES = new Set(['active', 'authenticated', 'pending']);

export type ReconcileGateway = 'stripe' | 'razorpay';

export type ReconcileOutcome =
  | { status: 'reconciled'; gateway: ReconcileGateway; previousRole: string; newRole: string; subscriptionId: string; planOrPriceId: string }
  | { status: 'already_synced'; gateway: ReconcileGateway; role: string }
  | { status: 'unresolved'; gateway: ReconcileGateway; reason: string; details?: Record<string, unknown> }
  | { status: 'no_subscription' }
  | { status: 'error'; gateway?: ReconcileGateway; error: string };

export interface ReconcileUserInput {
  id: string;
  role: string;
  stripeSubscriptionId: string | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId?: string | null;
}

/**
 * Attempt to reconcile a single user's role with their payment provider.
 *
 * Priority order: Razorpay first (our primary Indian gateway), then Stripe.
 * Never downgrades — if the live subscription's plan/price can't be mapped to
 * a role, the user's existing role is preserved and an `unresolved` outcome
 * is returned so callers can surface it to ops.
 *
 * When `dryRun` is true, no DB writes happen; the returned outcome describes
 * what would have changed.
 */
export async function reconcileUserSubscription(
  user: ReconcileUserInput,
  options: { dryRun?: boolean } = {},
): Promise<ReconcileOutcome> {
  const dryRun = options.dryRun === true;

  if (user.razorpaySubscriptionId) {
    try {
      const sub = await razorpay.subscriptions.fetch(user.razorpaySubscriptionId);

      if (!LIVE_RAZORPAY_STATUSES.has(sub.status)) {
        return {
          status: 'unresolved',
          gateway: 'razorpay',
          reason: 'subscription_not_live',
          details: { subscriptionStatus: sub.status },
        };
      }

      const planId = sub.plan_id ?? null;
      const newRole = getRoleByRazorpayPlanId(planId);

      if (newRole === 'FREE' && planId) {
        return {
          status: 'unresolved',
          gateway: 'razorpay',
          reason: 'unmapped_plan_id',
          details: { planId },
        };
      }

      const periodEnd = sub.current_end || sub.charge_at;
      const currentPeriodEnd = periodEnd
        ? new Date(periodEnd * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      if (user.role === newRole && user.razorpayPlanId === planId) {
        return { status: 'already_synced', gateway: 'razorpay', role: user.role };
      }

      if (!dryRun) {
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
      }

      return {
        status: 'reconciled',
        gateway: 'razorpay',
        previousRole: user.role,
        newRole,
        subscriptionId: user.razorpaySubscriptionId,
        planOrPriceId: planId ?? '',
      };
    } catch (err) {
      return {
        status: 'error',
        gateway: 'razorpay',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (user.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

      if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
        return {
          status: 'unresolved',
          gateway: 'stripe',
          reason: 'subscription_not_live',
          details: { subscriptionStatus: sub.status },
        };
      }

      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const newRole = getPlanByPriceId(priceId);

      if (newRole === 'FREE' && priceId) {
        return {
          status: 'unresolved',
          gateway: 'stripe',
          reason: 'unmapped_price_id',
          details: { priceId },
        };
      }

      const currentPeriodEnd =
        sub.items?.data?.[0]?.current_period_end ??
        (sub as unknown as { current_period_end?: number }).current_period_end ??
        Math.floor(Date.now() / 1000);

      if (user.role === newRole) {
        return { status: 'already_synced', gateway: 'stripe', role: user.role };
      }

      if (!dryRun) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
          },
        });
        invalidateUserRoleCache(user.id);
      }

      return {
        status: 'reconciled',
        gateway: 'stripe',
        previousRole: user.role,
        newRole,
        subscriptionId: sub.id,
        planOrPriceId: priceId ?? '',
      };
    } catch (err) {
      return {
        status: 'error',
        gateway: 'stripe',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { status: 'no_subscription' };
}
