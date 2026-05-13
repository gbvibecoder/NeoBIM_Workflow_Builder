/**
 * Shared analytics helpers for subscription tracking — imported by both
 * client (thank-you page, Meta Pixel calls) and server (webhooks, CAPI).
 *
 * No Node-only imports so this file is safe in client bundles.
 */

const PLAN_VALUE_INR: Record<string, number> = {
  FREE: 0,
  MINI: 99,
  STARTER: 799,
  PRO: 1999,
  TEAM: 4999,
  TEAM_ADMIN: 4999,
};

/**
 * EUR mapping used for ad-platform `value` reporting (Meta Pixel + CAPI,
 * Google Ads). We unify ad-side currency on EUR so Meta's ROAS
 * optimization stops degrading from a 100%-missing-value diagnostic and
 * doesn't have to weigh INR-denominated events against a EUR ad budget.
 * Actual user billing remains in INR — this map is for tracking only.
 *
 * Plan → EUR (approximate 1:100 INR ratio, locked per product decision):
 *   MINI (₹99)   → €1
 *   STARTER (₹799)  → €8
 *   PRO (₹1999)  → €20
 *   TEAM (₹4999) → €45
 *   TEAM_ADMIN   → €45  (legacy alias for TEAM)
 *   FREE         → €0
 */
const PLAN_VALUE_EUR: Record<string, number> = {
  FREE: 0,
  MINI: 1,
  STARTER: 8,
  PRO: 20,
  TEAM: 45,
  TEAM_ADMIN: 45,
};

/** Monthly subscription price in INR. Kept for non-Meta usage and tests. */
export function getPlanValueINR(role: string | null | undefined): number {
  if (!role) return 0;
  return PLAN_VALUE_INR[role.toUpperCase()] ?? 0;
}

/** EUR `value` for Meta Pixel/CAPI + Google Ads Purchase events. */
export function getPlanValueEUR(role: string | null | undefined): number {
  if (!role) return 0;
  return PLAN_VALUE_EUR[role.toUpperCase()] ?? 0;
}

/**
 * Deterministic event_id for Purchase dedup between client pixel and server CAPI.
 * Both sides derive the same id from userId + normalized plan, so Meta dedups.
 */
export function getPurchaseEventId(userId: string, plan: string): string {
  return `purchase_${userId}_${plan.toUpperCase()}`;
}
