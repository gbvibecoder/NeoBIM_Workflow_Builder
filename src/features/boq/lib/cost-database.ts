/**
 * BOQ Cost Utilities — Indian Construction
 *
 * Kept functions: waste factors, project type multipliers, M/L/E splits,
 * escalation, soft cost calculation, disclaimers, type detection.
 *
 * USD/RSMeans rate arrays REMOVED in Phase B (Indian-only product).
 * All construction rates are in is1200-rates.ts with CPWD DSR baseline.
 */

// =============================================================================
// WASTE FACTORS
// =============================================================================

export const WASTE_FACTORS: Record<string, { factor: number; notes: string }> = {
  Concrete:         { factor: 0.07, notes: "7% — spillage, over-pour, testing samples" },
  Steel:            { factor: 0.10, notes: "10% — cut-off, welding loss, galvanizing" },
  Masonry:          { factor: 0.08, notes: "8% — breakage, cutting, mortar waste" },
  Finishes:         { factor: 0.12, notes: "12% — cutting, pattern matching, damage" },
  "Doors & Windows": { factor: 0.03, notes: "3% — factory-made, minimal site waste" },
  Roofing:          { factor: 0.10, notes: "10% — overlap, cutting at edges/penetrations" },
  MEP:              { factor: 0.08, notes: "8% — pipe/duct cut-off, fittings" },
  Sitework:         { factor: 0.15, notes: "15% — compaction, over-excavation, grading loss" },
  Formwork:         { factor: 0.12, notes: "12% — single-use forms, cutting, damage" },
  Waterproofing:    { factor: 0.10, notes: "10% — overlap, penetration details" },
  Insulation:       { factor: 0.10, notes: "10% — compression, cutting, cavity fill" },
  Electrical:       { factor: 0.08, notes: "8% — wire pull waste, conduit cuts" },
  Plumbing:         { factor: 0.08, notes: "8% — pipe cut-off, fittings, testing" },
  Landscaping:      { factor: 0.10, notes: "10% — transplant loss, over-order" },
};

export function getWasteFactor(subcategory: string): number {
  return WASTE_FACTORS[subcategory]?.factor ?? 0.10;
}

// =============================================================================
// PROJECT TYPE MULTIPLIERS
// =============================================================================

export const PROJECT_TYPE_MULTIPLIERS: Record<string, { multiplier: number; notes: string }> = {
  residential:   { multiplier: 0.85, notes: "Standard finishes, repetitive layouts" },
  commercial:    { multiplier: 1.00, notes: "Baseline — office/retail typical" },
  "mixed-use":   { multiplier: 1.05, notes: "Multiple occupancy types, transitions" },
  educational:   { multiplier: 1.10, notes: "Specialized rooms, accessibility, durability" },
  healthcare:    { multiplier: 1.45, notes: "Medical gas, clean rooms, infection control" },
  hospital:      { multiplier: 1.60, notes: "OR suites, ICU, redundant MEP, code compliance" },
  industrial:    { multiplier: 0.90, notes: "Simple finishes, heavy structure" },
  hospitality:   { multiplier: 1.20, notes: "High finishes, FF&E, guest amenities" },
  institutional: { multiplier: 1.15, notes: "Government standards, security, durability" },
  laboratory:    { multiplier: 1.50, notes: "Fume hoods, specialized HVAC, vibration control" },
  datacenter:    { multiplier: 1.35, notes: "Redundant power, cooling, raised floors" },
  religious:     { multiplier: 1.10, notes: "High ceilings, acoustics, specialty finishes" },
  parking:       { multiplier: 0.70, notes: "Simple structure, minimal finishes" },
  warehouse:     { multiplier: 0.65, notes: "Shell only, minimal MEP" },
};

export function detectProjectType(description: string): { type: string; multiplier: number } {
  const lower = description.toLowerCase();
  for (const [type, data] of Object.entries(PROJECT_TYPE_MULTIPLIERS)) {
    if (lower.includes(type)) {
      return { type, multiplier: data.multiplier };
    }
  }
  if (lower.includes("wellness") || lower.includes("spa") || lower.includes("club house") || lower.includes("clubhouse")) return { type: "wellness", multiplier: 1.35 };
  if (lower.includes("hotel") || lower.includes("resort") || lower.includes("hospitality")) return { type: "hospitality", multiplier: 1.20 };
  if (lower.includes("hospital") || lower.includes("clinic") || lower.includes("medical")) return { type: "healthcare", multiplier: 1.45 };
  if (lower.includes("school") || lower.includes("university") || lower.includes("college")) return { type: "educational", multiplier: 1.10 };
  if (lower.includes("warehouse") || lower.includes("storage") || lower.includes("godown")) return { type: "warehouse", multiplier: 0.70 };
  if (lower.includes("factory") || lower.includes("plant") || lower.includes("manufacturing")) return { type: "industrial", multiplier: 0.90 };
  if (lower.includes("office") || lower.includes("retail") || lower.includes("it park")) return { type: "commercial", multiplier: 1.00 };
  if (lower.includes("apartment") || lower.includes("condo") || lower.includes("housing")) return { type: "residential", multiplier: 0.85 };
  if (lower.includes("church") || lower.includes("mosque") || lower.includes("temple")) return { type: "religious", multiplier: 1.10 };
  return { type: "commercial", multiplier: 1.00 };
}

// =============================================================================
// COST BREAKDOWN PERCENTAGES — Material / Labor / Equipment
// =============================================================================

export const COST_BREAKDOWN: Record<string, { material: number; labor: number; equipment: number }> = {
  Concrete:          { material: 0.40, labor: 0.50, equipment: 0.10 },
  Steel:             { material: 0.55, labor: 0.35, equipment: 0.10 },
  Masonry:           { material: 0.35, labor: 0.58, equipment: 0.07 },
  Finishes:          { material: 0.45, labor: 0.52, equipment: 0.03 },
  "Doors & Windows": { material: 0.65, labor: 0.30, equipment: 0.05 },
  Roofing:           { material: 0.50, labor: 0.42, equipment: 0.08 },
  MEP:               { material: 0.45, labor: 0.48, equipment: 0.07 },
  Sitework:          { material: 0.30, labor: 0.40, equipment: 0.30 },
  Formwork:          { material: 0.25, labor: 0.65, equipment: 0.10 },
  Waterproofing:     { material: 0.55, labor: 0.40, equipment: 0.05 },
  Insulation:        { material: 0.50, labor: 0.45, equipment: 0.05 },
  Electrical:        { material: 0.42, labor: 0.53, equipment: 0.05 },
  Plumbing:          { material: 0.40, labor: 0.55, equipment: 0.05 },
  Landscaping:       { material: 0.40, labor: 0.45, equipment: 0.15 },
};

export function getCostBreakdown(subcategory: string): { material: number; labor: number; equipment: number } {
  return COST_BREAKDOWN[subcategory] ?? { material: 0.45, labor: 0.48, equipment: 0.07 };
}

// =============================================================================
// COST ESCALATION
// =============================================================================

export const DEFAULT_ESCALATION_RATE = 0.06;
export const DEFAULT_MONTHS_TO_CONSTRUCTION = 6;

export function calculateEscalation(
  baseCost: number,
  annualRate: number = DEFAULT_ESCALATION_RATE,
  monthsUntilConstruction: number = DEFAULT_MONTHS_TO_CONSTRUCTION
): { factor: number; amount: number; annualRate: number; months: number } {
  const factor = Math.pow(1 + annualRate, monthsUntilConstruction / 12);
  const amount = baseCost * (factor - 1);
  return {
    factor,
    amount: Math.round(amount * 100) / 100,
    annualRate,
    months: monthsUntilConstruction,
  };
}

// =============================================================================
// DISCLAIMERS
// =============================================================================

export const COST_DISCLAIMERS = {
  accuracy: "Estimate accuracy: ±25-30% (AACE Class 4). Not suitable for contract pricing.",
  validity: "Cost rates valid for 90 days from generation date. Market volatility may affect pricing.",
  basis: "Based on IS 1200 method of measurement, CPWD DSR 2025-26, with state PWD SOR and AI market intelligence adjustment.",
  exclusions: "Excludes: land acquisition, financing costs, developer fees, furniture/fixtures/equipment (FF&E), specialty systems, hazardous material abatement.",
  recommendation: "Recommend engaging a certified Quantity Surveyor (RICS/AACE) for detailed estimate at design development stage.",
  full: "DISCLAIMER: Preliminary estimate only (AACE Class 4, ±25-30%). Rates based on IS 1200 method of measurement, CPWD DSR 2025-26, and state PWD Schedule of Rates with AI market intelligence. Valid for 90 days. Excludes land, financing, FF&E, and specialty systems. Engage a certified QS for contract-grade pricing.",
};

export function buildDynamicDisclaimer(opts: {
  aaceClass?: string; accuracy?: string;
  city?: string; state?: string;
  marketFetchDate?: string;
}): string {
  const cls = opts.aaceClass ?? "Class 4";
  const acc = opts.accuracy ?? "±25-30%";
  const loc = opts.city && opts.state ? `${opts.city}, ${opts.state}` : (opts.state ?? "India");
  const fetchDate = opts.marketFetchDate
    ? new Date(opts.marketFetchDate).toLocaleDateString("en-IN")
    : new Date().toLocaleDateString("en-IN");
  return `DISCLAIMER: Preliminary estimate only (AACE ${cls}, ${acc} accuracy). Rates based on IS 1200 method of measurement and ${opts.state ?? "CPWD"} Schedule of Rates, adjusted by AI market intelligence for ${loc}. Market prices fetched ${fetchDate}. Valid for 90 days. Excludes land, financing, FF&E, and specialty systems. Engage a certified QS for contract-grade pricing.`;
}

// =============================================================================
// SOFT COST CALCULATION
// =============================================================================

export function calculateTotalCost(
  hardCostSubtotal: number,
  includeOverhead: boolean = true,
  includeContingency: boolean = true
): {
  hardCosts: number;
  softCosts: number;
  totalCost: number;
  breakdown: Array<{ item: string; percentage: number; amount: number }>;
} {
  const breakdown: Array<{ item: string; percentage: number; amount: number }> = [];
  let softCostTotal = 0;

  const archFees = hardCostSubtotal * 0.08;
  breakdown.push({ item: "Architectural Fees", percentage: 8, amount: archFees });
  softCostTotal += archFees;

  const structFees = hardCostSubtotal * 0.02;
  breakdown.push({ item: "Structural Engineering", percentage: 2, amount: structFees });
  softCostTotal += structFees;

  const mepFees = hardCostSubtotal * 0.035;
  breakdown.push({ item: "MEP Engineering", percentage: 3.5, amount: mepFees });
  softCostTotal += mepFees;

  const civilFees = hardCostSubtotal * 0.015;
  breakdown.push({ item: "Civil Engineering", percentage: 1.5, amount: civilFees });
  softCostTotal += civilFees;

  const permits = hardCostSubtotal * 0.02;
  breakdown.push({ item: "Permits & Inspections", percentage: 2, amount: permits });
  softCostTotal += permits;

  if (includeOverhead) {
    const overhead = hardCostSubtotal * 0.18;
    breakdown.push({ item: "GC Overhead & Profit", percentage: 18, amount: overhead });
    softCostTotal += overhead;
  }

  if (includeContingency) {
    const contingency = hardCostSubtotal * 0.10;
    breakdown.push({ item: "Contingency", percentage: 10, amount: contingency });
    softCostTotal += contingency;
  }

  const insurance = hardCostSubtotal * 0.025;
  breakdown.push({ item: "Insurance & Bonding", percentage: 2.5, amount: insurance });
  softCostTotal += insurance;

  return {
    hardCosts: hardCostSubtotal,
    softCosts: softCostTotal,
    totalCost: hardCostSubtotal + softCostTotal,
    breakdown,
  };
}
