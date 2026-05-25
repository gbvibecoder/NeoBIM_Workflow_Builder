/**
 * Template tier-access helpers.
 *
 * Templates may declare a `requiredTier` (FREE | MINI | STARTER | PRO | TEAM)
 * that gates which plans can use them. This module is the single source of
 * truth for the comparison rule, so the templates page, the gold lock badge,
 * and the server-side `/api/workflows/from-template` guard all answer the
 * same question the same way.
 *
 * Comparison uses PLAN_RANK from src/constants/limits.ts. Admins
 * (PLATFORM_ADMIN, TEAM_ADMIN) bypass the gate.
 */
import { PLAN_RANK } from "@/constants/limits";
import { STRIPE_PLANS } from "@/features/billing/lib/plan-data";

export type TemplateTier = "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM";

/** Map a template's `requiredTier` to the PLAN_RANK key for comparison.
 *  Templates use "TEAM" but PLAN_RANK keys it as "TEAM_ADMIN". */
function tierToRankKey(tier: TemplateTier): keyof typeof PLAN_RANK {
  return tier === "TEAM" ? "TEAM_ADMIN" : tier;
}

/** True if a user with `userRole` can use a template that requires
 *  `requiredTier`. Undefined / "FREE" requirement → always accessible.
 *  Admins always pass. */
export function canAccessTemplate(
  userRole: string | undefined | null,
  requiredTier: TemplateTier | undefined,
): boolean {
  if (!requiredTier || requiredTier === "FREE") return true;
  if (!userRole) return false;
  if (userRole === "PLATFORM_ADMIN" || userRole === "TEAM_ADMIN") return true;

  const userRank = PLAN_RANK[userRole] ?? 0;
  const requiredRank = PLAN_RANK[tierToRankKey(requiredTier)] ?? 0;
  return userRank >= requiredRank;
}

export interface UpgradeTarget {
  tier: TemplateTier;
  /** "Mini" / "Starter" / "Pro" / "Team" — display name from STRIPE_PLANS. */
  label: string;
  /** Monthly INR price for the target tier. */
  price: number;
  /** Currency symbol from STRIPE_PLANS (always "₹" for now). */
  currency: string;
  /** True when pricing is sales-negotiated (TEAM). UI should show
   *  "Contact Sales" instead of a price + checkout CTA. */
  isCustom: boolean;
}

/** Returns the upgrade target a locked-out user should be sent to.
 *  Returns null if `requiredTier` is FREE/undefined or the user already meets it. */
export function getUpgradeTargetForTemplate(
  userRole: string | undefined | null,
  requiredTier: TemplateTier | undefined,
): UpgradeTarget | null {
  if (canAccessTemplate(userRole, requiredTier)) return null;
  if (!requiredTier || requiredTier === "FREE") return null;

  const planKey = requiredTier; // STRIPE_PLANS keys: FREE, MINI, STARTER, PRO, TEAM
  const plan = STRIPE_PLANS[planKey];
  return {
    tier: requiredTier,
    label: plan.name,
    price: plan.price,
    currency: plan.currency,
    isCustom: 'isCustom' in plan && plan.isCustom === true,
  };
}
