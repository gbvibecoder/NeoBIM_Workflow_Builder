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

/** Monthly subscription price in INR for the `value` field of Purchase events. */
export function getPlanValueINR(role: string | null | undefined): number {
  if (!role) return 0;
  return PLAN_VALUE_INR[role.toUpperCase()] ?? 0;
}

/**
 * Deterministic event_id for Purchase dedup between client pixel and server CAPI.
 * Both sides derive the same id from userId + normalized plan, so Meta dedups.
 */
export function getPurchaseEventId(userId: string, plan: string): string {
  return `purchase_${userId}_${plan.toUpperCase()}`;
}
