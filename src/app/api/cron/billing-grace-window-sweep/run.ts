import { prisma } from "@/lib/db";
import { applyImmediateDowngrade } from "@/features/billing/lib/role-transitions";
import { billingFeatureFlags } from "@/features/billing/lib/feature-flags";
import { billingGraceWindowFlagOff } from "@/features/billing/lib/metrics";

/**
 * Report shape returned to the cron route caller. Stable surface for ops
 * dashboards / curl probes.
 */
export interface SweepReport {
  skipped: boolean;
  reason?: string;
  candidates: number;
  downgraded: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
  durationMs: number;
}

/**
 * The grace-window sweep:
 *
 *   - Find users currently on a paid role whose stripeCurrentPeriodEnd
 *     is in the past. (Activate writes current_end into this column;
 *     cancel handlers under flag-ON refresh it; nothing else is supposed
 *     to write a stale future date.)
 *   - For each, call applyImmediateDowngrade. That function is idempotent
 *     (no-op for FREE / admin roles) so a stale find result can't cause
 *     incorrect writes.
 *   - Per-user errors are caught so one bad row can't crash the sweep.
 *
 * Admin roles (TEAM_ADMIN, PLATFORM_ADMIN) are excluded from the find so
 * the cron never touches manually-elevated accounts. Same exclusion the
 * existing reconcile-subscriptions cron uses.
 */
export async function runGraceWindowSweep(): Promise<SweepReport> {
  const t0 = Date.now();

  if (!billingFeatureFlags.graceWindowEnabled) {
    billingGraceWindowFlagOff({
      handler: "cron.billing_grace_window_sweep",
      userId: null,
      event: "tick",
    });
    return {
      skipped: true,
      reason: "flag_off",
      candidates: 0,
      downgraded: 0,
      failed: 0,
      errors: [],
      durationMs: Date.now() - t0,
    };
  }

  const now = new Date();

  const expired = await prisma.user.findMany({
    where: {
      role: { notIn: ["FREE", "TEAM_ADMIN", "PLATFORM_ADMIN"] },
      stripeCurrentPeriodEnd: { lt: now, not: null },
      OR: [
        { razorpaySubscriptionId: { not: null } },
        { stripeSubscriptionId: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      stripeCurrentPeriodEnd: true,
    },
  });

  let downgraded = 0;
  let failed = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of expired) {
    try {
      await applyImmediateDowngrade({
        userId: user.id,
        reason: "grace_period_ended",
        triggeredBy: "cron",
      });
      downgraded++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ userId: user.id, error: msg });
      console.error("[BILLING_CRON] Downgrade failed", { userId: user.id, error: msg });
    }
  }

  console.log("[BILLING_CRON] Grace sweep complete", {
    candidates: expired.length,
    downgraded,
    failed,
  });

  return {
    skipped: false,
    candidates: expired.length,
    downgraded,
    failed,
    errors,
    durationMs: Date.now() - t0,
  };
}
