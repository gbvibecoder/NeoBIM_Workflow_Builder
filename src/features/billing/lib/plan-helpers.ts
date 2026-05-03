/**
 * Thin helpers for reading plan configuration from STRIPE_PLANS.
 *
 * Every UI surface that displays plan limits, prices, or credits MUST
 * use these helpers (or import STRIPE_PLANS directly) — never hardcode
 * plan numbers.  The consistency test in `__tests__/plan-consistency.test.ts`
 * enforces this invariant.
 */
import { STRIPE_PLANS } from "./plan-data";

// ── Types ────────────────────────────────────────────────────────────────────

/** Keys of STRIPE_PLANS — the canonical plan identifiers. */
export type PlanKey = keyof typeof STRIPE_PLANS;

/** Shape of the `limits` object inside each plan. */
export type PlanLimits = (typeof STRIPE_PLANS)[PlanKey]["limits"];

/**
 * Loosely-typed limits for legacyLimits JSON (may lack new fields added after
 * the snapshot was taken). Every field is optional so old snapshots don't
 * break when we add new metered features.
 */
export interface LegacyLimits {
  runsPerMonth?: number;
  maxWorkflows?: number;
  maxNodesPerWorkflow?: number;
  videoPerMonth?: number;
  modelsPerMonth?: number;
  rendersPerMonth?: number;
  floorPlansPerMonth?: number;
  briefRendersPerMonth?: number;
  teamMembers?: number;
}

/** Minimal credit descriptor for UI plan cards. */
export interface PlanCredit {
  kind: "video" | "model" | "render";
  /** Raw numeric value from STRIPE_PLANS (-1 = unlimited, 0 = not available). */
  value: number;
  /** Pre-formatted display value: "0", "3", or "\u221E" (∞). */
  display: string;
}

// ── Role → PlanKey mapping ───────────────────────────────────────────────────

/**
 * Map a DB user role (or any string) to a valid PlanKey.
 * Unknown/null roles fall back to "FREE".
 * TEAM_ADMIN / PLATFORM_ADMIN → "TEAM".
 */
export function toPlanKey(role: string | null | undefined): PlanKey {
  if (!role) return "FREE";
  if (role === "TEAM_ADMIN" || role === "PLATFORM_ADMIN") return "TEAM";
  if (role in STRIPE_PLANS) return role as PlanKey;
  return "FREE";
}

// ── Getters ──────────────────────────────────────────────────────────────────

/** Full plan config for the given role. */
export function getPlanConfig(role: string | null | undefined) {
  return STRIPE_PLANS[toPlanKey(role)];
}

/** Limits sub-object for the given role. */
export function getPlanLimits(role: string | null | undefined): PlanLimits {
  return getPlanConfig(role).limits;
}

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Format a numeric limit for display.
 * -1 → "∞" (unlimited), 0+ → the number as a string.
 */
export function formatPlanLimit(value: number): string {
  return value < 0 ? "\u221E" : String(value);
}

/**
 * Build the three-row credit descriptor used by pricing / billing cards.
 * Returns [video, model, render] credits for the given role.
 */
export function getPlanCredits(role: string | null | undefined): PlanCredit[] {
  const limits = getPlanLimits(role);
  return [
    { kind: "video",  value: limits.videoPerMonth,   display: formatPlanLimit(limits.videoPerMonth) },
    { kind: "model",  value: limits.modelsPerMonth,  display: formatPlanLimit(limits.modelsPerMonth) },
    { kind: "render", value: limits.rendersPerMonth, display: formatPlanLimit(limits.rendersPerMonth) },
  ];
}

/**
 * Sum total credits for the "credits total" badge on plan cards.
 * Returns "∞" if any credit is unlimited, otherwise the numeric sum as a
 * zero-padded two-digit string (e.g. "02", "15", "45").
 */
export function getPlanCreditsTotal(role: string | null | undefined): string {
  const credits = getPlanCredits(role);
  if (credits.some(c => c.value < 0)) return "\u221E";
  const sum = credits.reduce((acc, c) => acc + c.value, 0);
  return String(sum).padStart(2, "0");
}

/**
 * Interpolate `{placeholder}` tokens in an i18n string with plan-limit values.
 *
 * Supported tokens: `{executions}`, `{workflows}`, `{renders}`, `{videos}`,
 * `{models}`, `{floorPlans}`.
 */
export function interpolatePlanString(template: string, role: string | null | undefined): string {
  const limits = getPlanLimits(role);
  return template
    .replace("{executions}", formatPlanLimit(limits.runsPerMonth))
    .replace("{workflows}", formatPlanLimit(limits.maxWorkflows))
    .replace("{renders}", formatPlanLimit(limits.rendersPerMonth))
    .replace("{videos}", formatPlanLimit(limits.videoPerMonth))
    .replace("{models}", formatPlanLimit(limits.modelsPerMonth))
    .replace("{floorPlans}", formatPlanLimit(limits.floorPlansPerMonth));
}

// ── Grandfathering ───────────────────────────────────────────────────────────

/**
 * Return effective limits for a user, honoring their legacy snapshot if present.
 *
 * - New users (legacyLimits = null) → current STRIPE_PLANS for their role.
 * - Existing users (legacyLimits populated) → snapshotted limits.
 * - On upgrade/downgrade (webhook clears legacyLimits) → new plan's limits.
 *
 * Fields missing from the snapshot (e.g. `floorPlansPerMonth` added after
 * the snapshot was taken) fall back to the current STRIPE_PLANS value.
 */
export function getEffectiveLimits(
  role: string | null | undefined,
  legacyLimits: LegacyLimits | null | undefined,
): PlanLimits {
  if (!legacyLimits) return getPlanLimits(role);
  const current = getPlanLimits(role);
  // Merge: legacy wins for fields it has; current fills any gaps.
  return {
    ...current,
    ...(legacyLimits.runsPerMonth != null && { runsPerMonth: legacyLimits.runsPerMonth }),
    ...(legacyLimits.maxWorkflows != null && { maxWorkflows: legacyLimits.maxWorkflows }),
    ...(legacyLimits.maxNodesPerWorkflow != null && { maxNodesPerWorkflow: legacyLimits.maxNodesPerWorkflow }),
    ...(legacyLimits.videoPerMonth != null && { videoPerMonth: legacyLimits.videoPerMonth }),
    ...(legacyLimits.modelsPerMonth != null && { modelsPerMonth: legacyLimits.modelsPerMonth }),
    ...(legacyLimits.rendersPerMonth != null && { rendersPerMonth: legacyLimits.rendersPerMonth }),
    ...(legacyLimits.floorPlansPerMonth != null && { floorPlansPerMonth: legacyLimits.floorPlansPerMonth }),
    ...(legacyLimits.briefRendersPerMonth != null && { briefRendersPerMonth: legacyLimits.briefRendersPerMonth }),
  } as PlanLimits;
}
