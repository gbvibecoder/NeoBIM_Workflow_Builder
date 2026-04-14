// ─── Price Escalation Engine ─────────────────────────────────────────────────
// Category-specific inflation escalation for construction material prices.
// Uses RBI-aligned rates by material category, NOT a flat 8%/yr for everything.
//
// Designed to keep BOQ estimates reasonable even when cached prices age out.
// When a cached price is 6 months old, this engine applies the appropriate
// inflation rate to bring it to current-day equivalent.

export interface EscalationResult {
  /** The escalated price in current-day terms */
  escalatedPrice: number;
  /** The original price before escalation */
  originalPrice: number;
  /** Annual escalation rate applied (decimal, e.g. 0.06 = 6%) */
  annualRate: number;
  /** Number of years (fractional) the price was escalated over */
  yearsElapsed: number;
  /** Total escalation percentage applied */
  escalationPercent: number;
  /** Whether any escalation was applied */
  escalationApplied: boolean;
  /** Confidence decay: further from fetch date → lower confidence */
  confidenceMultiplier: number;
  /** Human-readable explanation */
  note: string;
}

// ── Category-specific annual inflation rates ─────────────────────────────────
// Based on RBI WPI indices + CPWD cost index trends (2020-2026 average)
// Steel is volatile (MCX futures); cement/sand are more stable.

const MATERIAL_INFLATION_RATES: Record<string, number> = {
  // Metals — volatile, track MCX steel futures
  steel: 0.06,             // 6%/yr average (can spike ±15% in a quarter)
  reinforcement: 0.06,
  structural_steel: 0.065, // slightly higher for fabricated

  // Cement — steady, oligopolistic market
  cement: 0.045,           // 4.5%/yr (RBI WPI cement avg 2020-2026)
  ready_mix: 0.05,         // RMC includes transport premium

  // Aggregates — regional, transport-sensitive
  sand: 0.07,              // 7%/yr (scarcity-driven in many states)
  aggregate: 0.05,         // 5%/yr (quarrying stable but transport rising)
  m_sand: 0.06,            // manufactured sand slightly different

  // Labor — fastest-growing in India
  mason: 0.09,             // 9%/yr (MGNREGA floor + scarcity premium)
  helper: 0.10,            // 10%/yr (acute shortage in construction)
  carpenter: 0.085,
  electrician: 0.08,
  plumber: 0.085,
  steel_fixer: 0.09,

  // Timber & formwork
  timber: 0.06,            // 6%/yr
  plywood: 0.055,

  // Finishing materials
  tiles: 0.04,             // 4%/yr (factory-made, economies of scale)
  paint: 0.045,
  glass: 0.05,
  marble: 0.06,            // natural stone = quarrying inflation
  granite: 0.06,

  // MEP
  electrical: 0.05,
  plumbing_materials: 0.055,
  hvac: 0.05,
  fire_fighting: 0.045,

  // Benchmarks / general
  benchmark: 0.06,         // composite construction cost index
  general: 0.06,           // default fallback
};

/**
 * Infer the material category from a materialCode string.
 * Tries exact match first, then keyword matching.
 */
function inferCategory(materialCode: string): string {
  const code = materialCode.toLowerCase();

  // Exact match
  if (MATERIAL_INFLATION_RATES[code] !== undefined) return code;

  // Keyword matching
  if (code.includes("steel") || code.includes("rebar") || code.includes("tmt")) return "steel";
  if (code.includes("cement") || code.includes("opc") || code.includes("ppc")) return "cement";
  if (code.includes("sand") || code.includes("m_sand") || code.includes("m-sand")) return "sand";
  if (code.includes("aggregate") || code.includes("gravel") || code.includes("jelly")) return "aggregate";
  if (code.includes("mason")) return "mason";
  if (code.includes("helper") || code.includes("labour") || code.includes("labor")) return "helper";
  if (code.includes("carpenter")) return "carpenter";
  if (code.includes("electrician")) return "electrician";
  if (code.includes("plumber")) return "plumber";
  if (code.includes("timber") || code.includes("wood") || code.includes("formwork")) return "timber";
  if (code.includes("tile")) return "tiles";
  if (code.includes("paint")) return "paint";
  if (code.includes("marble")) return "marble";
  if (code.includes("granite")) return "granite";
  if (code.includes("glass")) return "glass";
  if (code.includes("electrical")) return "electrical";
  if (code.includes("plumbing") || code.includes("pipe")) return "plumbing_materials";
  if (code.includes("hvac") || code.includes("duct")) return "hvac";
  if (code.includes("fire")) return "fire_fighting";
  if (code.includes("benchmark") || code.includes("cost_per")) return "benchmark";

  return "general";
}

/**
 * Escalate a cached price to current-day value using category-specific inflation.
 *
 * @param price - The cached price (INR)
 * @param fetchedAt - When the price was originally fetched
 * @param materialCode - Material identifier (e.g., "steel_per_tonne", "cement_per_bag")
 * @param now - Current date (defaults to Date.now())
 */
export function escalatePrice(
  price: number,
  fetchedAt: Date,
  materialCode: string,
  now: Date = new Date()
): EscalationResult {
  const msElapsed = now.getTime() - fetchedAt.getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
  const yearsElapsed = daysElapsed / 365.25;

  // No escalation needed for fresh data (< 30 days)
  if (daysElapsed < 30) {
    return {
      escalatedPrice: price,
      originalPrice: price,
      annualRate: 0,
      yearsElapsed: 0,
      escalationPercent: 0,
      escalationApplied: false,
      confidenceMultiplier: 1.0,
      note: "Fresh data — no escalation needed",
    };
  }

  const category = inferCategory(materialCode);
  const annualRate = MATERIAL_INFLATION_RATES[category] ?? MATERIAL_INFLATION_RATES.general;

  // Compound escalation: price × (1 + rate)^years
  const escalationFactor = Math.pow(1 + annualRate, yearsElapsed);
  const escalatedPrice = Math.round(price * escalationFactor * 100) / 100;
  const escalationPercent = (escalationFactor - 1) * 100;

  // Confidence decay: starts at 1.0 for fresh data, decays to 0.4 for very old data
  // - 0-30 days: 1.0 (handled above)
  // - 30-90 days: 0.95-0.85
  // - 90-180 days: 0.85-0.70
  // - 180-365 days: 0.70-0.55
  // - 1-3 years: 0.55-0.40
  // - >3 years: 0.40 (floor)
  const confidenceMultiplier = Math.max(0.40, 1.0 - (daysElapsed / 1200));

  // Freshness label
  let freshnessNote: string;
  if (daysElapsed < 90) {
    freshnessNote = `Recent data (${Math.round(daysElapsed)} days old) — ${escalationPercent.toFixed(1)}% escalation applied`;
  } else if (daysElapsed < 180) {
    freshnessNote = `Aging data (${Math.round(daysElapsed)} days old) — ${escalationPercent.toFixed(1)}% escalation applied, verify against current market`;
  } else if (daysElapsed < 365) {
    freshnessNote = `Stale data (${Math.round(daysElapsed)} days old) — ${escalationPercent.toFixed(1)}% escalation applied, recommend refresh`;
  } else {
    freshnessNote = `Very stale data (${(yearsElapsed).toFixed(1)} years old) — ${escalationPercent.toFixed(1)}% escalation applied, low confidence`;
  }

  return {
    escalatedPrice,
    originalPrice: price,
    annualRate,
    yearsElapsed,
    escalationPercent,
    escalationApplied: true,
    confidenceMultiplier,
    note: freshnessNote,
  };
}

/**
 * Get the appropriate freshness label for display.
 */
export function getFreshnessLabel(daysOld: number): "fresh" | "recent" | "stale" | "very_stale" {
  if (daysOld < 30) return "fresh";
  if (daysOld < 90) return "recent";
  if (daysOld < 180) return "stale";
  return "very_stale";
}

/**
 * Get display color for freshness badges.
 */
export function getFreshnessColor(label: "fresh" | "recent" | "stale" | "very_stale"): string {
  switch (label) {
    case "fresh": return "#22C55E";     // green
    case "recent": return "#00F5FF";    // cyan
    case "stale": return "#F59E0B";     // amber
    case "very_stale": return "#EF4444"; // red
  }
}

/**
 * Get the annual inflation rate for a material category (for display/info).
 */
export function getInflationRate(materialCode: string): number {
  const category = inferCategory(materialCode);
  return MATERIAL_INFLATION_RATES[category] ?? MATERIAL_INFLATION_RATES.general;
}
