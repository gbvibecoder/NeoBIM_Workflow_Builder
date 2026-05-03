/**
 * App-wide numeric limits shared between client UX and server enforcement.
 *
 * Both sides must use the same source of truth — drift between them is the
 * exact bug Phase 2 Task 4 fixed for regenerationCounts (the client cap was
 * 3 in execution-store.ts, but the server had no cap at all, so refresh
 * trivially bypassed it).
 */

/** Maximum number of regenerations per node per execution. Enforced
 *  server-side in src/app/api/execute-node/route.ts via a Prisma transaction
 *  on Execution.metadata.regenerationCounts. Mirrored client-side in
 *  useExecutionStore.regenerationCounts as a UX hint (instant "out of regens"
 *  feedback before the round-trip), but the server is the authoritative gate.
 *
 *  A new execution starts with an empty regenerationCounts map, so users get
 *  a fresh budget per workflow run.
 */
export const MAX_REGENERATIONS = 3;

/** Execution limits per plan. FREE is lifetime, others are per month.
 *  Derived from STRIPE_PLANS to avoid dual-source-of-truth drift. */
import { STRIPE_PLANS } from "@/features/billing/lib/plan-data";

export const PLAN_EXEC_LIMITS: Record<string, number> = {
  FREE: STRIPE_PLANS.FREE.limits.runsPerMonth,
  MINI: STRIPE_PLANS.MINI.limits.runsPerMonth,
  STARTER: STRIPE_PLANS.STARTER.limits.runsPerMonth,
  PRO: STRIPE_PLANS.PRO.limits.runsPerMonth,
  TEAM_ADMIN: STRIPE_PLANS.TEAM.limits.runsPerMonth,
  PLATFORM_ADMIN: STRIPE_PLANS.TEAM.limits.runsPerMonth,
};

/** Numeric rank for comparing plan tiers. Higher = more features. */
export const PLAN_RANK: Record<string, number> = {
  FREE: 0, MINI: 1, STARTER: 2, PRO: 3, TEAM_ADMIN: 4, PLATFORM_ADMIN: 5,
};
