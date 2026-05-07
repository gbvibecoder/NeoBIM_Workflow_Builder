/**
 * Role-transition primitives for the cancel-grace-window fix.
 *
 * `applyImmediateDowngrade` is the ONE place in this codebase that writes
 * role='FREE' under the flag-on behaviour. Cancel-class webhooks route
 * here when the grace window has already passed; the hourly cron routes
 * here when stripeCurrentPeriodEnd has expired.
 *
 * Surgical update: ONLY role is touched. razorpaySubscriptionId,
 * stripeSubscriptionId, stripeCurrentPeriodEnd, paymentGateway,
 * legacyLimits, and legacyLimitsSetAt are deliberately preserved — they
 * are the audit trail and the grace-window state.
 */

import { prisma } from "@/lib/db";
import { invalidateUserRoleCache } from "@/lib/auth";
import { getRoleByRazorpayPlanId } from "./razorpay";
import { getPlanByPriceId } from "./stripe";
import { billingRoleDowngraded, type TriggeredBy, type Provider } from "./metrics";

/**
 * Roles that applyImmediateDowngrade refuses to overwrite. Mirrors the
 * existing cron at src/app/api/cron/reconcile-subscriptions/run.ts:327
 * (`ADMIN_ROLES_SWEEP`) — keeping the safety set consistent across crons
 * is the canonical intent.
 */
const NO_DOWNGRADE_ROLES = new Set<string>(["FREE", "TEAM_ADMIN", "PLATFORM_ADMIN"]);

// Re-export the per-provider helpers so callers can reach them through
// this single barrel (the restore script uses both).
export { getRoleByRazorpayPlanId, getPlanByPriceId };

/**
 * Single entry point for plan→role mapping across both providers.
 * Used by the restore script's classification loop.
 *
 * Returns 'FREE' if the planOrPriceId can't be resolved — callers must
 * treat that case as "ambiguous, needs manual review", not as a downgrade
 * trigger.
 */
export function deriveRoleFromPlan(args: {
  provider: Provider;
  planOrPriceId: string | null;
}): "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" {
  if (args.provider === "razorpay") return getRoleByRazorpayPlanId(args.planOrPriceId);
  return getPlanByPriceId(args.planOrPriceId);
}

/**
 * Downgrade a single user to FREE. Idempotent — safe to call when the
 * user is already FREE or holds an admin role (returns early without
 * writing).
 *
 * Touches ONLY the role column. All other subscription metadata is
 * preserved for audit and any subsequent reconcile / restore flow.
 *
 * Note: does NOT send the cancellation email. The email send lives in the
 * legacy `cancelSubscription_LEGACY` path (Razorpay) and
 * `cancelUserSubscription_LEGACY` (Stripe), which run under flag-OFF.
 * Under flag-ON, email-on-grace-expiry is a follow-up — out of scope for
 * this surgical fix.
 */
export async function applyImmediateDowngrade(params: {
  userId: string;
  reason: string;
  triggeredBy: TriggeredBy;
  providerEventId?: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, role: true, email: true },
  });

  if (!user) {
    console.error("[BILLING_DOWNGRADE] User not found:", params.userId);
    return;
  }

  if (NO_DOWNGRADE_ROLES.has(user.role)) {
    return;
  }

  const fromRole = user.role;

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "FREE" },
  });

  invalidateUserRoleCache(user.id);

  billingRoleDowngraded({
    userId: user.id,
    fromRole,
    toRole: "FREE",
    reason: params.reason,
    triggeredBy: params.triggeredBy,
    providerEventId: params.providerEventId,
  });
}
