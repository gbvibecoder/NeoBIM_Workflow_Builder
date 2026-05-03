/**
 * Time-aware rate library for BOQ pricing.
 *
 * Every construction rate has a baseline date + escalation curve. Given a
 * project construction date, `escalateRate()` compounds the rate forward
 * using domain-specific CAGR derived from public Indian indices:
 *   - MoSPI Construction CPI (composite)
 *   - RBI WPI Steel Products
 *   - RBI WPI Cement, lime & plaster
 *   - MGNREGA + labor market scarcity
 *
 * Staleness thresholds:
 *   - < 1 year from baseline → "fresh" (high confidence)
 *   - 1–2 years → "escalated" (medium confidence)
 *   - 2–4 years → "stale" (low confidence, yellow warning)
 *   - > 4 years → "expired" (AACE downgrade, red warning)
 */

// ─── Escalation Curves ──────────────────────────────────────────────────────

export type EscalationCurve =
  | "construction-cpi-india"   // 6%/yr — MoSPI Construction CPI composite
  | "wpi-steel"                // 6%/yr — RBI WPI Steel Products
  | "wpi-cement"               // 4.5%/yr — RBI WPI Cement, lime & plaster
  | "labor-mason"              // 9%/yr — MGNREGA floor + scarcity
  | "labor-helper"             // 10%/yr — acute unskilled shortage
  | "labor-skilled"            // 8.5%/yr — carpenters, electricians, plumbers
  | "finishes-composite"       // 4.5%/yr — tiles, paint, glass
  | "mep-composite"            // 5.5%/yr — MEP systems
  | "static";                  // 0% — for factors, percentages, and dimensions

/** When the escalation curve data was last verified against public indices. */
export const ESCALATION_CURVES_AS_OF = "2026-01-01";

export const ESCALATION_CURVES: Record<EscalationCurve, number> = {
  "construction-cpi-india": 0.06,
  "wpi-steel":              0.06,
  "wpi-cement":             0.045,
  "labor-mason":            0.09,
  "labor-helper":           0.10,
  "labor-skilled":          0.085,
  "finishes-composite":     0.045,
  "mep-composite":          0.055,
  "static":                 0,
};

// ─── Baseline Dates ─────────────────────────────────────────────────────────
// Single source of truth for when each rate library was last anchored.

/** IS 1200 / CPWD DSR rates baseline (is1200-rates.ts) */
export const IS1200_BASELINE = "2026-04-01";
/** MEP provisional rates baseline (boq-intelligence.ts) — RICS India 2024 + escalation */
export const MEP_BASELINE = "2024-06-01";
/** Market intelligence static fallbacks (market-intelligence.ts) */
export const MARKET_FALLBACK_BASELINE = "2026-04-01";
/** Benchmark ranges (boq-intelligence.ts) */
export const BENCHMARK_BASELINE = "2024-06-01";
/** Client-side slider defaults (recalc-engine.ts) */
export const CLIENT_DEFAULTS_BASELINE = "2025-01-01";

// ─── Core Types ─────────────────────────────────────────────────────────────

export interface DatedRate {
  value: number;
  unit: string;
  asOfDate: string;            // ISO YYYY-MM-DD
  source: string;              // "CPWD DSR 2025-26" | "RICS India 2024" | "TR-015 live"
  escalationCurve: EscalationCurve;
  validUntil?: string;         // optional hard expiry
}

export interface ResolvedRate {
  value: number;
  confidence: "fresh" | "escalated" | "stale" | "expired";
  escalationApplied: number;   // 1.0 = no escalation, 1.26 = 26% escalated
  yearsSinceBaseline: number;
  baseline: { value: number; date: string; source: string };
  warning?: string;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Escalate a single DatedRate to a target project date.
 */
export function escalateRate(rate: DatedRate, projectDate: Date): ResolvedRate {
  const baseDate = new Date(rate.asOfDate);
  const years = (projectDate.getTime() - baseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  // If project date is before baseline, no escalation (historical estimate)
  if (years <= 0) {
    return {
      value: rate.value,
      confidence: "fresh",
      escalationApplied: 1,
      yearsSinceBaseline: 0,
      baseline: { value: rate.value, date: rate.asOfDate, source: rate.source },
    };
  }

  // Check hard expiry
  if (rate.validUntil && projectDate > new Date(rate.validUntil)) {
    return {
      value: rate.value,
      confidence: "expired",
      escalationApplied: 1,
      yearsSinceBaseline: Math.round(years * 10) / 10,
      baseline: { value: rate.value, date: rate.asOfDate, source: rate.source },
      warning: `Rate expired on ${rate.validUntil}. Live market data required.`,
    };
  }

  const cagr = ESCALATION_CURVES[rate.escalationCurve] ?? 0;
  const factor = Math.pow(1 + cagr, years);
  const escalatedValue = Math.round(rate.value * factor * 100) / 100;

  const confidence: ResolvedRate["confidence"] =
    years < 1 ? "fresh" : years < 2 ? "escalated" : years < 4 ? "stale" : "expired";

  return {
    value: escalatedValue,
    confidence,
    escalationApplied: Math.round(factor * 1000) / 1000,
    yearsSinceBaseline: Math.round(years * 10) / 10,
    baseline: { value: rate.value, date: rate.asOfDate, source: rate.source },
    warning: years > 2
      ? `Rate is ${Math.round(years * 10) / 10} years old (${Math.round((factor - 1) * 100)}% escalated). Verify with current market.`
      : undefined,
  };
}

/**
 * Shorthand: escalate a raw number using a known baseline date + curve.
 * Use this for constants that haven't been wrapped in DatedRate yet.
 */
export function escalateValue(
  value: number,
  curve: EscalationCurve,
  baselineDate: string,
  projectDate: Date,
): number {
  const baseDate = new Date(baselineDate);
  const years = (projectDate.getTime() - baseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return value;
  const cagr = ESCALATION_CURVES[curve] ?? 0;
  return Math.round(value * Math.pow(1 + cagr, years) * 100) / 100;
}

/**
 * Compute the staleness of a rate relative to a project date.
 * Returns years since baseline. Used for stale-rate banner.
 */
export function computeStaleness(baselineDate: string, projectDate: Date): number {
  const base = new Date(baselineDate);
  return Math.max(0, (projectDate.getTime() - base.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Determine the overall staleness warning level for the BOQ.
 */
export function getStalenessLevel(
  baselineDate: string,
  projectDate: Date,
): { severity: "ok" | "warning" | "critical"; years: number; message: string } {
  const years = computeStaleness(baselineDate, projectDate);
  if (years > 4) {
    return {
      severity: "critical",
      years: Math.round(years * 10) / 10,
      message: `Rate library is ${Math.round(years * 10) / 10} years from project date. Estimates are unreliable — live market refresh required. AACE class downgraded to Class 5.`,
    };
  }
  if (years > 2) {
    return {
      severity: "warning",
      years: Math.round(years * 10) / 10,
      message: `Rates escalated ${Math.round((Math.pow(1.06, years) - 1) * 100)}% from ${baselineDate} baseline. Verify with current market quotes before budgeting.`,
    };
  }
  return { severity: "ok", years: Math.round(years * 10) / 10, message: "" };
}

/**
 * Factory to create a DatedRate from a raw number.
 */
export function makeRate(
  value: number,
  unit: string,
  asOfDate: string,
  source: string,
  curve: EscalationCurve = "construction-cpi-india",
): DatedRate {
  return { value, unit, asOfDate, source, escalationCurve: curve };
}

// ─── Curve Mapping for IS 1200 Subcategories ────────────────────────────────
// Maps subcategory names (from IS1200Rate.subcategory) to the appropriate
// escalation curve. Used at the point of consumption (TR-008) so the IS 1200
// rate data doesn't need structural changes.

const SUBCATEGORY_CURVES: Record<string, { total: EscalationCurve; material: EscalationCurve; labour: EscalationCurve }> = {
  Concrete:          { total: "construction-cpi-india", material: "wpi-cement",          labour: "labor-mason" },
  Steel:             { total: "wpi-steel",              material: "wpi-steel",            labour: "labor-mason" },
  Masonry:           { total: "construction-cpi-india", material: "construction-cpi-india", labour: "labor-mason" },
  Finishes:          { total: "finishes-composite",     material: "finishes-composite",   labour: "labor-mason" },
  "Doors & Windows": { total: "finishes-composite",     material: "finishes-composite",   labour: "labor-skilled" },
  Plumbing:          { total: "mep-composite",          material: "mep-composite",        labour: "labor-skilled" },
  HVAC:              { total: "mep-composite",          material: "mep-composite",        labour: "labor-skilled" },
  Electrical:        { total: "mep-composite",          material: "mep-composite",        labour: "labor-skilled" },
  Earthwork:         { total: "construction-cpi-india", material: "construction-cpi-india", labour: "labor-helper" },
};

const DEFAULT_CURVES = { total: "construction-cpi-india" as EscalationCurve, material: "construction-cpi-india" as EscalationCurve, labour: "labor-mason" as EscalationCurve };

/** Get the escalation curve set for a given IS 1200 subcategory. */
export function getCurvesForSubcategory(subcategory: string): { total: EscalationCurve; material: EscalationCurve; labour: EscalationCurve } {
  return SUBCATEGORY_CURVES[subcategory] ?? DEFAULT_CURVES;
}

/**
 * Escalation factor for a project date vs a baseline.
 * Convenience for bulk-escalating: `rawRate * getEscalationFactor(curve, baseline, projectDate)`.
 */
export function getEscalationFactor(curve: EscalationCurve, baselineDate: string, projectDate: Date): number {
  const base = new Date(baselineDate);
  const years = (projectDate.getTime() - base.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return 1;
  const cagr = ESCALATION_CURVES[curve] ?? 0;
  return Math.pow(1 + cagr, years);
}
