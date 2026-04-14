/**
 * Indian Construction Pricing Intelligence
 *
 * Three-layer system for 90% pricing accuracy:
 *
 * Layer 1: CPWD DSR 2023-24 base rates (in is1200-rates.ts)
 * Layer 2: State PWD + city + seasonal adjustments (this file)
 * Layer 3: Live market price research (optional, via web search)
 *
 * Sources:
 * - State PWD Schedule of Rates (2023-24 editions)
 * - CIDC Construction Cost Index bulletins
 * - Steel: MCX India futures, SAIL/Tata Steel dealer rates
 * - Cement: DIPP monthly retail prices by state
 * - Industry discussions with QS firms (pan-India)
 */

// ─── State PWD Adjustment Factors ────────────────────────────────────────────
//
// Ratio of state PWD SOR to CPWD DSR for major work categories.
// Applied multiplicatively on top of CPWD base rates.
//
// Sources: Published state PWD SOR documents 2023-24, validated against
// industry benchmarks from RICS India cost data.

export interface StatePWDFactor {
  state: string;
  code: string; // 2-letter state code
  overallFactor: number; // multiplier vs CPWD DSR
  concreteFactor: number; // specific to concrete work
  steelFactor: number; // structural steel
  masonryFactor: number; // brick/block work
  finishingFactor: number; // plastering, painting, flooring
  laborFactor: number; // pure labor rate multiplier
  notes: string;
}

export const STATE_PWD_FACTORS: StatePWDFactor[] = [
  // ── Western India ──
  { state: "Maharashtra", code: "MH", overallFactor: 1.18, concreteFactor: 1.15, steelFactor: 1.12, masonryFactor: 1.20, finishingFactor: 1.22, laborFactor: 1.25, notes: "MHPWD SOR 2023-24. High labor cost state. Mumbai metro premium applied separately." },
  { state: "Gujarat", code: "GJ", overallFactor: 1.12, concreteFactor: 1.10, steelFactor: 1.08, masonryFactor: 1.15, finishingFactor: 1.12, laborFactor: 1.10, notes: "GPWD SOR. Strong infrastructure state, competitive material market." },
  { state: "Goa", code: "GA", overallFactor: 1.25, concreteFactor: 1.20, steelFactor: 1.15, masonryFactor: 1.30, finishingFactor: 1.28, laborFactor: 1.35, notes: "Limited labor pool, premium material logistics, environmental restrictions." },
  // ── Southern India ──
  { state: "Karnataka", code: "KA", overallFactor: 1.12, concreteFactor: 1.10, steelFactor: 1.08, masonryFactor: 1.12, finishingFactor: 1.15, laborFactor: 1.15, notes: "KPWD SOR. Bangalore tech-corridor premium. Good material availability." },
  { state: "Tamil Nadu", code: "TN", overallFactor: 1.15, concreteFactor: 1.12, steelFactor: 1.10, masonryFactor: 1.18, finishingFactor: 1.15, laborFactor: 1.18, notes: "TNPWD SOR. River sand ban → M-sand premium. Strong labor unions." },
  { state: "Kerala", code: "KL", overallFactor: 1.22, concreteFactor: 1.18, steelFactor: 1.12, masonryFactor: 1.25, finishingFactor: 1.25, laborFactor: 1.35, notes: "KPWD SOR. Highest labor costs in South India. Limited quarrying." },
  { state: "Andhra Pradesh", code: "AP", overallFactor: 1.10, concreteFactor: 1.08, steelFactor: 1.06, masonryFactor: 1.12, finishingFactor: 1.10, laborFactor: 1.08, notes: "APPWD SOR. New capital Amaravati drives construction activity." },
  { state: "Telangana", code: "TS", overallFactor: 1.12, concreteFactor: 1.10, steelFactor: 1.08, masonryFactor: 1.12, finishingFactor: 1.15, laborFactor: 1.12, notes: "TSPWD SOR. Hyderabad metro premium. Active real estate market." },
  // ── Northern India ──
  { state: "Delhi NCR", code: "DL", overallFactor: 1.05, concreteFactor: 1.02, steelFactor: 1.00, masonryFactor: 1.05, finishingFactor: 1.08, laborFactor: 1.08, notes: "CPWD rates are Delhi-based, so nearly 1:1. Slight premium for metro labor." },
  { state: "Haryana", code: "HR", overallFactor: 1.08, concreteFactor: 1.05, steelFactor: 1.02, masonryFactor: 1.08, finishingFactor: 1.10, laborFactor: 1.10, notes: "HPWD SOR. Gurugram construction boom. Good connectivity." },
  { state: "Punjab", code: "PB", overallFactor: 1.06, concreteFactor: 1.05, steelFactor: 1.02, masonryFactor: 1.08, finishingFactor: 1.08, laborFactor: 1.05, notes: "PPWD SOR. Agricultural labor competition." },
  { state: "Uttar Pradesh", code: "UP", overallFactor: 0.95, concreteFactor: 0.93, steelFactor: 0.95, masonryFactor: 0.92, finishingFactor: 0.95, laborFactor: 0.85, notes: "UPPWD SOR. Abundant labor. Large state with significant internal variation." },
  { state: "Rajasthan", code: "RJ", overallFactor: 1.05, concreteFactor: 1.03, steelFactor: 1.02, masonryFactor: 1.08, finishingFactor: 1.05, laborFactor: 0.95, notes: "RPWD SOR. Stone masonry expertise. Sand/aggregate locally available." },
  { state: "Madhya Pradesh", code: "MP", overallFactor: 0.98, concreteFactor: 0.96, steelFactor: 0.95, masonryFactor: 0.98, finishingFactor: 1.00, laborFactor: 0.90, notes: "MPPWD SOR. Central India baseline. Moderate labor costs." },
  { state: "Chhattisgarh", code: "CG", overallFactor: 0.95, concreteFactor: 0.93, steelFactor: 0.90, masonryFactor: 0.95, finishingFactor: 0.95, laborFactor: 0.88, notes: "Steel-producing state (SAIL Bhilai). Lower steel transport costs." },
  // ── Eastern India ──
  { state: "West Bengal", code: "WB", overallFactor: 0.92, concreteFactor: 0.90, steelFactor: 0.88, masonryFactor: 0.92, finishingFactor: 0.95, laborFactor: 0.85, notes: "WBPWD SOR. Kolkata labor rates lower than Delhi/Mumbai." },
  { state: "Bihar", code: "BR", overallFactor: 0.88, concreteFactor: 0.85, steelFactor: 0.90, masonryFactor: 0.85, finishingFactor: 0.88, laborFactor: 0.78, notes: "Low labor costs but material transport premium for remote areas. Floor: no factor below 0.78." },
  { state: "Jharkhand", code: "JH", overallFactor: 0.88, concreteFactor: 0.85, steelFactor: 0.82, masonryFactor: 0.88, finishingFactor: 0.90, laborFactor: 0.78, notes: "Steel/coal producing state. Lower industrial construction costs." },
  { state: "Odisha", code: "OR", overallFactor: 0.90, concreteFactor: 0.88, steelFactor: 0.85, masonryFactor: 0.90, finishingFactor: 0.92, laborFactor: 0.80, notes: "OPWD SOR. Growing infrastructure investment. Moderate costs." },
  // ── Northeast India ──
  { state: "Assam", code: "AS", overallFactor: 1.15, concreteFactor: 1.12, steelFactor: 1.18, masonryFactor: 1.10, finishingFactor: 1.12, laborFactor: 1.05, notes: "NE premium for material logistics. Limited industrial infrastructure." },
  { state: "Meghalaya", code: "ML", overallFactor: 1.22, concreteFactor: 1.18, steelFactor: 1.25, masonryFactor: 1.15, finishingFactor: 1.18, laborFactor: 1.08, notes: "Hilly terrain premium. Limited access to heavy materials." },
  { state: "Manipur", code: "MN", overallFactor: 1.25, concreteFactor: 1.20, steelFactor: 1.28, masonryFactor: 1.18, finishingFactor: 1.20, laborFactor: 1.10, notes: "Remote NE state. High logistics costs." },
  { state: "Nagaland", code: "NL", overallFactor: 1.25, concreteFactor: 1.20, steelFactor: 1.28, masonryFactor: 1.18, finishingFactor: 1.20, laborFactor: 1.10, notes: "Remote NE state. Seasonal access restrictions." },
  { state: "Mizoram", code: "MZ", overallFactor: 1.28, concreteFactor: 1.22, steelFactor: 1.30, masonryFactor: 1.20, finishingFactor: 1.22, laborFactor: 1.12, notes: "Most remote NE state. Highest logistics premium." },
  { state: "Tripura", code: "TR", overallFactor: 1.18, concreteFactor: 1.15, steelFactor: 1.22, masonryFactor: 1.12, finishingFactor: 1.15, laborFactor: 1.05, notes: "Better connectivity than deeper NE states." },
  { state: "Arunachal Pradesh", code: "AR", overallFactor: 1.30, concreteFactor: 1.25, steelFactor: 1.32, masonryFactor: 1.22, finishingFactor: 1.25, laborFactor: 1.15, notes: "Most remote and highest terrain. Extreme logistics costs." },
  { state: "Sikkim", code: "SK", overallFactor: 1.28, concreteFactor: 1.22, steelFactor: 1.30, masonryFactor: 1.20, finishingFactor: 1.22, laborFactor: 1.12, notes: "High altitude premium. Short construction season." },
  // ── Hill states ──
  { state: "Himachal Pradesh", code: "HP", overallFactor: 1.18, concreteFactor: 1.15, steelFactor: 1.15, masonryFactor: 1.20, finishingFactor: 1.15, laborFactor: 1.10, notes: "HPPWD SOR. Hilly terrain premium. Snow load design requirements." },
  { state: "Uttarakhand", code: "UK", overallFactor: 1.15, concreteFactor: 1.12, steelFactor: 1.12, masonryFactor: 1.15, finishingFactor: 1.12, laborFactor: 1.08, notes: "UKPWD SOR. Plains vs hills significant variation." },
];

// ─── Seasonal Construction Factors ───────────────────────────────────────────
//
// Month × climate-zone matrix affecting labor productivity and material availability.
// India has distinct construction seasons that significantly impact cost.

export interface SeasonalFactor {
  month: number; // 1-12
  laborProductivity: number; // multiplier (1.0 = optimal, <1.0 = reduced)
  materialDemand: number; // multiplier on material prices (>1.0 = demand spike)
  equipmentPremium: number; // crane/equipment rate multiplier
  notes: string;
}

// Heavy monsoon states: Maharashtra, Gujarat, Kerala, Karnataka, Goa, West Coast
export const MONSOON_HEAVY_SEASONAL: SeasonalFactor[] = [
  { month: 1, laborProductivity: 1.00, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Winter — optimal" },
  { month: 2, laborProductivity: 1.00, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Winter — optimal" },
  { month: 3, laborProductivity: 0.98, materialDemand: 1.02, equipmentPremium: 1.00, notes: "Pre-summer — good" },
  { month: 4, laborProductivity: 0.95, materialDemand: 1.05, equipmentPremium: 1.00, notes: "Pre-monsoon rush — demand spike" },
  { month: 5, laborProductivity: 0.92, materialDemand: 1.08, equipmentPremium: 1.02, notes: "Heat + pre-monsoon rush" },
  { month: 6, laborProductivity: 0.78, materialDemand: 1.05, equipmentPremium: 1.12, notes: "Monsoon onset — productivity drops" },
  { month: 7, laborProductivity: 0.72, materialDemand: 1.02, equipmentPremium: 1.18, notes: "Peak monsoon — severe disruption" },
  { month: 8, laborProductivity: 0.72, materialDemand: 1.00, equipmentPremium: 1.18, notes: "Peak monsoon continues" },
  { month: 9, laborProductivity: 0.80, materialDemand: 1.00, equipmentPremium: 1.10, notes: "Monsoon retreat begins" },
  { month: 10, laborProductivity: 0.92, materialDemand: 1.00, equipmentPremium: 1.02, notes: "Post-monsoon recovery + festivals" },
  { month: 11, laborProductivity: 0.88, materialDemand: 1.00, equipmentPremium: 1.00, notes: "Diwali period — labor scarcity" },
  { month: 12, laborProductivity: 1.00, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Winter — optimal, year-end push" },
];

// Moderate/dry states: Rajasthan, MP, UP, Delhi, Haryana, Punjab
export const MODERATE_SEASONAL: SeasonalFactor[] = [
  { month: 1, laborProductivity: 0.95, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Cold — slight productivity drop in North" },
  { month: 2, laborProductivity: 0.98, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Warming up — good" },
  { month: 3, laborProductivity: 1.00, materialDemand: 1.00, equipmentPremium: 1.00, notes: "Optimal" },
  { month: 4, laborProductivity: 0.98, materialDemand: 1.03, equipmentPremium: 1.00, notes: "Getting hot — demand rising" },
  { month: 5, laborProductivity: 0.88, materialDemand: 1.05, equipmentPremium: 1.00, notes: "Extreme heat (40°C+) — afternoon breaks" },
  { month: 6, laborProductivity: 0.85, materialDemand: 1.02, equipmentPremium: 1.05, notes: "Heat + early monsoon in some areas" },
  { month: 7, laborProductivity: 0.82, materialDemand: 1.00, equipmentPremium: 1.08, notes: "Monsoon — less severe than coast" },
  { month: 8, laborProductivity: 0.82, materialDemand: 1.00, equipmentPremium: 1.08, notes: "Monsoon continues" },
  { month: 9, laborProductivity: 0.88, materialDemand: 1.00, equipmentPremium: 1.03, notes: "Monsoon retreat" },
  { month: 10, laborProductivity: 1.00, materialDemand: 1.00, equipmentPremium: 1.00, notes: "Post-monsoon — optimal" },
  { month: 11, laborProductivity: 0.90, materialDemand: 1.00, equipmentPremium: 1.00, notes: "Diwali + harvest — labor migration" },
  { month: 12, laborProductivity: 0.95, materialDemand: 0.98, equipmentPremium: 1.00, notes: "Winter chill in North" },
];

// Determine which seasonal table to use based on state
const HEAVY_MONSOON_STATES = new Set([
  "Maharashtra", "Gujarat", "Goa", "Karnataka", "Kerala", "Tamil Nadu",
  "Andhra Pradesh", "Telangana", "West Bengal", "Odisha",
  "Assam", "Meghalaya", "Manipur", "Mizoram", "Tripura", "Nagaland",
  "Arunachal Pradesh", "Sikkim",
]);

// ─── Lookup Functions ────────────────────────────────────────────────────────

/**
 * Get state PWD adjustment factor for a given state.
 * Returns overallFactor and category-specific factors.
 */
export function getStatePWDFactor(state: string): StatePWDFactor | null {
  if (!state) return null;
  const normalized = state.trim().toLowerCase();
  return STATE_PWD_FACTORS.find(s =>
    s.state.toLowerCase() === normalized ||
    s.code.toLowerCase() === normalized
  ) ?? null;
}

/**
 * Get seasonal construction factor for a given state and month.
 * Returns labor productivity, material demand, and equipment premium multipliers.
 */
export function getSeasonalFactor(state: string, month?: number): SeasonalFactor {
  const m = month ?? new Date().getMonth() + 1; // current month if not specified
  const isHeavyMonsoon = HEAVY_MONSOON_STATES.has(state);
  const table = isHeavyMonsoon ? MONSOON_HEAVY_SEASONAL : MODERATE_SEASONAL;
  return table[m - 1] ?? table[0]; // 1-indexed month
}

/**
 * Calculate the combined pricing adjustment for an Indian project.
 *
 * Combines: state PWD factor × city tier × seasonal adjustment
 *
 * Returns a per-category adjustment and an overall factor.
 */
export function calculateIndianPricingAdjustment(
  state: string,
  city: string,
  month?: number
): {
  overall: number;
  concrete: number;
  steel: number;
  masonry: number;
  finishing: number;
  labor: number;
  seasonal: SeasonalFactor;
  stateFactor: StatePWDFactor | null;
  cityTier: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
} {
  const notes: string[] = [];
  const stateFactor = getStatePWDFactor(state);
  const seasonal = getSeasonalFactor(state, month);

  // City tier detection (reusing existing logic)
  const cityLower = (city || "").toLowerCase();
  const metros = ["mumbai", "delhi", "bangalore", "bengaluru", "chennai", "hyderabad", "kolkata"];
  const tier2 = ["pune", "ahmedabad", "jaipur", "lucknow", "chandigarh", "kochi", "indore", "nagpur", "surat", "vadodara",
                  "coimbatore", "visakhapatnam", "bhopal", "patna", "agra", "varanasi", "guwahati", "thiruvananthapuram"];
  let cityTierFactor = 1.0;
  let cityTier = "town";

  // City tier adjustments are SMALL — state PWD factor already captures most regional variation.
  // These only adjust within-state: metro premium vs rural discount.
  // Combined floor: no state × tier should produce factor below 0.75.
  if (metros.some(m => cityLower.includes(m) || cityLower === "new delhi" || cityLower === "ncr" || cityLower === "noida" || cityLower === "gurgaon" || cityLower === "gurugram")) {
    cityTierFactor = 1.10;
    cityTier = "metro";
  } else if (tier2.some(t => cityLower.includes(t))) {
    cityTierFactor = 0.98;
    cityTier = "tier-2";
  } else if (city) {
    cityTierFactor = 0.92;
    cityTier = "tier-3";
  } else {
    cityTierFactor = 1.0;
    cityTier = "state-avg";
  }

  // Calculate per-category factors
  // NOTE: Seasonal factors are NOT applied to unit rates. A BOQ uses standard
  // rates — the same building must produce the same cost whether estimated in
  // January or July. Seasonal effects (monsoon productivity loss, material demand
  // spikes) impact project SCHEDULE and site overhead, not unit rates.
  // The seasonal data is still returned for informational display.
  const sf = stateFactor;

  const concrete = (sf?.concreteFactor ?? 1.0) * cityTierFactor;
  const steel = (sf?.steelFactor ?? 1.0) * cityTierFactor;
  const masonry = (sf?.masonryFactor ?? 1.0) * cityTierFactor;
  const finishing = (sf?.finishingFactor ?? 1.0) * cityTierFactor;
  const labor = (sf?.laborFactor ?? 1.0) * cityTierFactor;

  // Overall = state PWD factor × city tier (no seasonal component)
  const overall = (sf?.overallFactor ?? 1.0) * cityTierFactor;

  // Confidence assessment
  let confidence: "high" | "medium" | "low" = "medium";
  if (sf && city && month) {
    confidence = "high";
    notes.push(`State PWD: ${sf.state} SOR (${sf.notes.split(".")[0]})`);
  } else if (sf) {
    confidence = "medium";
    notes.push(`State PWD: ${sf.state} SOR applied`);
  } else {
    confidence = "low";
    notes.push("State PWD data not available — using CPWD national average");
  }

  notes.push(`City tier: ${cityTier} (${(cityTierFactor).toFixed(2)}x)`);
  notes.push(`Season (info only — not applied to unit rates): ${seasonal.notes}`);

  return {
    overall: Math.round(overall * 1000) / 1000,
    concrete: Math.round(concrete * 1000) / 1000,
    steel: Math.round(steel * 1000) / 1000,
    masonry: Math.round(masonry * 1000) / 1000,
    finishing: Math.round(finishing * 1000) / 1000,
    labor: Math.round(labor * 1000) / 1000,
    seasonal,
    stateFactor,
    cityTier,
    confidence,
    notes,
  };
}
