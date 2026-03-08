/**
 * Cost Database - Realistic Construction Unit Rates
 * 
 * Base rates in USD (United States baseline)
 * Regional multipliers applied separately
 * 
 * Sources:
 * - RSMeans 2024/2025
 * - Industry averages (US, Europe, Asia)
 * - Construction Engineer validation
 */

export interface UnitRate {
  item: string;
  unit: string;
  baseRate: number; // USD
  category: "hard" | "soft";
  subcategory: string;
  notes?: string;
}

export interface RegionalFactor {
  region: string;
  multiplier: number;
  currency: string;
  notes: string;
}

// =============================================================================
// HARD COSTS - Direct Construction Costs
// =============================================================================

export const CONCRETE_RATES: UnitRate[] = [
  {
    item: "Concrete Foundation",
    unit: "CY",
    baseRate: 180,
    category: "hard",
    subcategory: "Concrete",
    notes: "Including formwork, rebar, pour, finish",
  },
  {
    item: "Concrete Slab on Grade",
    unit: "CY",
    baseRate: 150,
    category: "hard",
    subcategory: "Concrete",
    notes: "4-6 inch slab with mesh",
  },
  {
    item: "Concrete Column",
    unit: "CY",
    baseRate: 250,
    category: "hard",
    subcategory: "Concrete",
    notes: "Heavy formwork + rebar",
  },
  {
    item: "Concrete Beam",
    unit: "CY",
    baseRate: 220,
    category: "hard",
    subcategory: "Concrete",
    notes: "Elevated formwork",
  },
  {
    item: "Concrete Elevated Slab",
    unit: "CY",
    baseRate: 200,
    category: "hard",
    subcategory: "Concrete",
    notes: "Decking + pour + finish",
  },
  {
    item: "Concrete Wall",
    unit: "CY",
    baseRate: 190,
    category: "hard",
    subcategory: "Concrete",
    notes: "Vertical formwork + pour",
  },
  {
    item: "Concrete Stair",
    unit: "CY",
    baseRate: 300,
    category: "hard",
    subcategory: "Concrete",
    notes: "Complex formwork",
  },
];

export const STEEL_RATES: UnitRate[] = [
  {
    item: "Structural Steel (Beams & Columns)",
    unit: "ton",
    baseRate: 3500,
    category: "hard",
    subcategory: "Steel",
    notes: "Wide flange sections, painted",
  },
  {
    item: "Steel Joist",
    unit: "ton",
    baseRate: 3200,
    category: "hard",
    subcategory: "Steel",
    notes: "Open web joists",
  },
  {
    item: "Steel Deck",
    unit: "SF",
    baseRate: 4.5,
    category: "hard",
    subcategory: "Steel",
    notes: "Composite metal deck",
  },
  {
    item: "Rebar",
    unit: "ton",
    baseRate: 2800,
    category: "hard",
    subcategory: "Steel",
    notes: "Grade 60, placed & tied",
  },
  {
    item: "Steel Stud Framing",
    unit: "SF",
    baseRate: 3.2,
    category: "hard",
    subcategory: "Steel",
    notes: "Light gauge interior partition",
  },
];

export const MASONRY_RATES: UnitRate[] = [
  {
    item: "CMU Block Wall (8 inch)",
    unit: "SF",
    baseRate: 12,
    category: "hard",
    subcategory: "Masonry",
    notes: "Concrete masonry unit",
  },
  {
    item: "Brick Veneer",
    unit: "SF",
    baseRate: 18,
    category: "hard",
    subcategory: "Masonry",
    notes: "Standard modular brick",
  },
  {
    item: "Stone Veneer",
    unit: "SF",
    baseRate: 35,
    category: "hard",
    subcategory: "Masonry",
    notes: "Natural stone cladding",
  },
  {
    item: "Glass Block",
    unit: "SF",
    baseRate: 45,
    category: "hard",
    subcategory: "Masonry",
    notes: "8x8 inch blocks",
  },
];

export const FINISHES_RATES: UnitRate[] = [
  {
    item: "Gypsum Board (Drywall)",
    unit: "SF",
    baseRate: 2.8,
    category: "hard",
    subcategory: "Finishes",
    notes: "1/2 inch, taped & finished",
  },
  {
    item: "Ceramic Tile Flooring",
    unit: "SF",
    baseRate: 15,
    category: "hard",
    subcategory: "Finishes",
    notes: "12x12 inch, installed",
  },
  {
    item: "Vinyl Tile Flooring (VCT)",
    unit: "SF",
    baseRate: 6,
    category: "hard",
    subcategory: "Finishes",
    notes: "Commercial grade",
  },
  {
    item: "Hardwood Flooring",
    unit: "SF",
    baseRate: 22,
    category: "hard",
    subcategory: "Finishes",
    notes: "Oak strip, installed & finished",
  },
  {
    item: "Carpet (Commercial)",
    unit: "SF",
    baseRate: 8,
    category: "hard",
    subcategory: "Finishes",
    notes: "Broadloom with padding",
  },
  {
    item: "Acoustic Ceiling Tile",
    unit: "SF",
    baseRate: 5.5,
    category: "hard",
    subcategory: "Finishes",
    notes: "2x2 grid system",
  },
  {
    item: "Paint (Interior Walls)",
    unit: "SF",
    baseRate: 1.5,
    category: "hard",
    subcategory: "Finishes",
    notes: "Two coats, labor included",
  },
];

export const OPENINGS_RATES: UnitRate[] = [
  {
    item: "Hollow Metal Door & Frame",
    unit: "EA",
    baseRate: 850,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "3x7 standard door with hardware",
  },
  {
    item: "Wood Door",
    unit: "EA",
    baseRate: 650,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "Solid core with hardware",
  },
  {
    item: "Aluminum Storefront Door",
    unit: "EA",
    baseRate: 2200,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "3x7 with closer & panic hardware",
  },
  {
    item: "Double-Glazed Window (Standard)",
    unit: "SF",
    baseRate: 65,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "Aluminum frame, installed",
  },
  {
    item: "Curtain Wall System",
    unit: "SF",
    baseRate: 120,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "Unitized system with glass",
  },
  {
    item: "Skylight",
    unit: "SF",
    baseRate: 95,
    category: "hard",
    subcategory: "Doors & Windows",
    notes: "Fixed aluminum frame with glazing",
  },
];

export const ROOFING_RATES: UnitRate[] = [
  {
    item: "Built-Up Roofing (BUR)",
    unit: "SF",
    baseRate: 8.5,
    category: "hard",
    subcategory: "Roofing",
    notes: "Multi-ply with gravel",
  },
  {
    item: "Single-Ply Membrane (TPO/EPDM)",
    unit: "SF",
    baseRate: 7,
    category: "hard",
    subcategory: "Roofing",
    notes: "Fully adhered",
  },
  {
    item: "Metal Roofing",
    unit: "SF",
    baseRate: 12,
    category: "hard",
    subcategory: "Roofing",
    notes: "Standing seam",
  },
  {
    item: "Asphalt Shingle Roofing",
    unit: "SF",
    baseRate: 5.5,
    category: "hard",
    subcategory: "Roofing",
    notes: "Architectural shingle",
  },
];

export const MEP_RATES: UnitRate[] = [
  {
    item: "HVAC System (Commercial)",
    unit: "SF",
    baseRate: 18,
    category: "hard",
    subcategory: "MEP",
    notes: "VAV system with ductwork",
  },
  {
    item: "Plumbing Rough-In",
    unit: "SF",
    baseRate: 8,
    category: "hard",
    subcategory: "MEP",
    notes: "Per SF of building area",
  },
  {
    item: "Electrical Rough-In",
    unit: "SF",
    baseRate: 12,
    category: "hard",
    subcategory: "MEP",
    notes: "Wiring, panels, outlets",
  },
  {
    item: "Fire Sprinkler System",
    unit: "SF",
    baseRate: 6,
    category: "hard",
    subcategory: "MEP",
    notes: "Wet system",
  },
  {
    item: "Lighting (Commercial)",
    unit: "SF",
    baseRate: 7,
    category: "hard",
    subcategory: "MEP",
    notes: "LED fixtures installed",
  },
];

export const SITEWORK_RATES: UnitRate[] = [
  {
    item: "Excavation",
    unit: "CY",
    baseRate: 12,
    category: "hard",
    subcategory: "Sitework",
    notes: "Bulk earthwork",
  },
  {
    item: "Grading",
    unit: "SF",
    baseRate: 0.8,
    category: "hard",
    subcategory: "Sitework",
    notes: "Fine grading",
  },
  {
    item: "Asphalt Paving",
    unit: "SF",
    baseRate: 6,
    category: "hard",
    subcategory: "Sitework",
    notes: "2 inch overlay on base",
  },
  {
    item: "Concrete Sidewalk",
    unit: "SF",
    baseRate: 8.5,
    category: "hard",
    subcategory: "Sitework",
    notes: "4 inch thick",
  },
  {
    item: "Site Utilities",
    unit: "LF",
    baseRate: 45,
    category: "hard",
    subcategory: "Sitework",
    notes: "Underground water/sewer/storm",
  },
];

// =============================================================================
// SOFT COSTS - Indirect / Professional Costs
// =============================================================================

export const SOFT_COST_RATES: UnitRate[] = [
  {
    item: "Architectural Design Fees",
    unit: "%",
    baseRate: 8, // 8% of construction cost
    category: "soft",
    subcategory: "Professional Fees",
    notes: "Full service through construction documents",
  },
  {
    item: "Structural Engineering Fees",
    unit: "%",
    baseRate: 2,
    category: "soft",
    subcategory: "Professional Fees",
    notes: "2% of construction cost",
  },
  {
    item: "MEP Engineering Fees",
    unit: "%",
    baseRate: 3.5,
    category: "soft",
    subcategory: "Professional Fees",
    notes: "3.5% of construction cost",
  },
  {
    item: "Civil Engineering Fees",
    unit: "%",
    baseRate: 1.5,
    category: "soft",
    subcategory: "Professional Fees",
    notes: "Site design, grading, utilities",
  },
  {
    item: "Permit & Inspection Fees",
    unit: "%",
    baseRate: 2,
    category: "soft",
    subcategory: "Regulatory",
    notes: "Building permit, plan review, inspections",
  },
  {
    item: "General Contractor Overhead & Profit",
    unit: "%",
    baseRate: 18,
    category: "soft",
    subcategory: "Contractor Fees",
    notes: "GC O&P on hard costs",
  },
  {
    item: "Contingency",
    unit: "%",
    baseRate: 10,
    category: "soft",
    subcategory: "Risk",
    notes: "Design contingency (reduce during CD phase)",
  },
  {
    item: "Insurance & Bonding",
    unit: "%",
    baseRate: 2.5,
    category: "soft",
    subcategory: "Risk",
    notes: "Builder's risk, performance bond",
  },
];

// =============================================================================
// REGIONAL COST FACTORS
// =============================================================================

export const REGIONAL_FACTORS: RegionalFactor[] = [
  {
    region: "New York City, NY (USA)",
    multiplier: 1.30,
    currency: "USD",
    notes: "High labor costs, union rates, logistics",
  },
  {
    region: "San Francisco, CA (USA)",
    multiplier: 1.28,
    currency: "USD",
    notes: "High labor + materials, seismic requirements",
  },
  {
    region: "Los Angeles, CA (USA)",
    multiplier: 1.15,
    currency: "USD",
    notes: "Above-average costs, seismic",
  },
  {
    region: "Chicago, IL (USA)",
    multiplier: 1.10,
    currency: "USD",
    notes: "Union labor, winter weather impacts",
  },
  {
    region: "Houston, TX (USA)",
    multiplier: 0.95,
    currency: "USD",
    notes: "Lower labor costs, high material availability",
  },
  {
    region: "Atlanta, GA (USA)",
    multiplier: 0.92,
    currency: "USD",
    notes: "Below-average costs",
  },
  {
    region: "Phoenix, AZ (USA)",
    multiplier: 0.90,
    currency: "USD",
    notes: "Low labor costs, desert climate",
  },
  {
    region: "London, UK",
    multiplier: 1.22,
    currency: "GBP",
    notes: "High costs, converted at £1 = $1.27 USD",
  },
  {
    region: "Munich, Germany",
    multiplier: 1.18,
    currency: "EUR",
    notes: "High European costs, €1 = $1.10 USD",
  },
  {
    region: "Paris, France",
    multiplier: 1.15,
    currency: "EUR",
    notes: "Above-average EU costs",
  },
  {
    region: "Amsterdam, Netherlands",
    multiplier: 1.12,
    currency: "EUR",
    notes: "High costs, complex regulations",
  },
  {
    region: "Berlin, Germany",
    multiplier: 1.05,
    currency: "EUR",
    notes: "Average EU costs",
  },
  {
    region: "Madrid, Spain",
    multiplier: 0.95,
    currency: "EUR",
    notes: "Lower EU costs",
  },
  {
    region: "Mumbai, India",
    multiplier: 0.40,
    currency: "INR",
    notes: "Low labor costs, ₹1 = $0.012 USD",
  },
  {
    region: "Bangalore, India",
    multiplier: 0.42,
    currency: "INR",
    notes: "Slightly higher than Mumbai",
  },
  {
    region: "Delhi, India",
    multiplier: 0.45,
    currency: "INR",
    notes: "Capital city premium",
  },
  {
    region: "Dubai, UAE",
    multiplier: 0.85,
    currency: "AED",
    notes: "Low labor, high materials, AED 1 = $0.27 USD",
  },
  {
    region: "Singapore",
    multiplier: 1.08,
    currency: "SGD",
    notes: "High-cost Asian city, S$1 = $0.74 USD",
  },
  {
    region: "Tokyo, Japan",
    multiplier: 1.20,
    currency: "JPY",
    notes: "High costs, seismic, ¥1 = $0.0067 USD",
  },
  {
    region: "Sydney, Australia",
    multiplier: 1.12,
    currency: "AUD",
    notes: "High costs, A$1 = $0.65 USD",
  },
  {
    region: "Toronto, Canada",
    multiplier: 1.05,
    currency: "CAD",
    notes: "Moderate costs, C$1 = $0.72 USD",
  },
  {
    region: "Mexico City, Mexico",
    multiplier: 0.65,
    currency: "MXN",
    notes: "Lower costs, MXN 1 = $0.05 USD",
  },
  {
    region: "São Paulo, Brazil",
    multiplier: 0.70,
    currency: "BRL",
    notes: "Moderate Latin America costs, R$1 = $0.20 USD",
  },
];

// =============================================================================
// WASTE FACTORS — per material type (Section 1)
// Industry-standard waste percentages for quantity take-off adjustments
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

/**
 * Get waste factor for a subcategory. Falls back to 0.10 (10%) if unknown.
 */
export function getWasteFactor(subcategory: string): number {
  return WASTE_FACTORS[subcategory]?.factor ?? 0.10;
}

// =============================================================================
// PROJECT TYPE MULTIPLIERS (Section 4)
// Adjusts cost based on complexity, code requirements, and specialization
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

/**
 * Detect project type from building description text
 */
export function detectProjectType(description: string): { type: string; multiplier: number } {
  const lower = description.toLowerCase();
  for (const [type, data] of Object.entries(PROJECT_TYPE_MULTIPLIERS)) {
    if (lower.includes(type)) {
      return { type, multiplier: data.multiplier };
    }
  }
  // Additional keyword matching
  if (lower.includes("office") || lower.includes("retail")) return { type: "commercial", multiplier: 1.00 };
  if (lower.includes("hotel") || lower.includes("resort")) return { type: "hospitality", multiplier: 1.20 };
  if (lower.includes("school") || lower.includes("university")) return { type: "educational", multiplier: 1.10 };
  if (lower.includes("clinic") || lower.includes("medical")) return { type: "healthcare", multiplier: 1.45 };
  if (lower.includes("apartment") || lower.includes("condo") || lower.includes("housing")) return { type: "residential", multiplier: 0.85 };
  if (lower.includes("church") || lower.includes("mosque") || lower.includes("temple")) return { type: "religious", multiplier: 1.10 };
  if (lower.includes("factory") || lower.includes("plant") || lower.includes("manufacturing")) return { type: "industrial", multiplier: 0.90 };

  return { type: "commercial", multiplier: 1.00 }; // Default
}

// =============================================================================
// COST BREAKDOWN PERCENTAGES — Material / Labor / Equipment (Section 5)
// Per subcategory, based on RSMeans 2024 national averages
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

/**
 * Get M/L/E breakdown percentages for a subcategory.
 * Falls back to 45/48/7 if subcategory is unknown.
 */
export function getCostBreakdown(subcategory: string): { material: number; labor: number; equipment: number } {
  return COST_BREAKDOWN[subcategory] ?? { material: 0.45, labor: 0.48, equipment: 0.07 };
}

// =============================================================================
// COST ESCALATION (Section 3)
// Construction cost escalation to account for future price increases
// =============================================================================

export const DEFAULT_ESCALATION_RATE = 0.06; // 6% annual
export const DEFAULT_MONTHS_TO_CONSTRUCTION = 6;

/**
 * Calculate escalation factor for future construction start.
 * @param annualRate Annual escalation rate (default 6%)
 * @param monthsUntilConstruction Months until construction begins (default 6)
 * @returns { factor, amount, annualRate, months }
 */
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
// ADDITIONAL COST ITEMS (Section 2)
// Missing items for professional BOQ completeness
// =============================================================================

export const EXCAVATION_RATES: UnitRate[] = [
  { item: "Bulk Excavation", unit: "CY", baseRate: 12, category: "hard", subcategory: "Sitework", notes: "Open cut, machine excavation" },
  { item: "Trench Excavation", unit: "CY", baseRate: 22, category: "hard", subcategory: "Sitework", notes: "Narrow width, bracing may apply" },
  { item: "Rock Excavation", unit: "CY", baseRate: 85, category: "hard", subcategory: "Sitework", notes: "Blasting or mechanical breaking" },
  { item: "Backfill Compacted", unit: "CY", baseRate: 15, category: "hard", subcategory: "Sitework", notes: "Imported fill, compacted in lifts" },
  { item: "Dewatering", unit: "DAY", baseRate: 350, category: "hard", subcategory: "Sitework", notes: "Wellpoint system per day" },
];

export const FORMWORK_RATES: UnitRate[] = [
  { item: "Wall Formwork", unit: "SFCA", baseRate: 8.5, category: "hard", subcategory: "Formwork", notes: "Plywood forms, 2 uses" },
  { item: "Column Formwork", unit: "SFCA", baseRate: 12, category: "hard", subcategory: "Formwork", notes: "Fiber tube or custom" },
  { item: "Slab Formwork", unit: "SFCA", baseRate: 6.5, category: "hard", subcategory: "Formwork", notes: "Shoring + decking" },
  { item: "Beam Formwork", unit: "SFCA", baseRate: 14, category: "hard", subcategory: "Formwork", notes: "Custom box forms" },
  { item: "Stair Formwork", unit: "SFCA", baseRate: 18, category: "hard", subcategory: "Formwork", notes: "Complex geometry" },
];

export const WATERPROOFING_RATES: UnitRate[] = [
  { item: "Below-Grade Waterproofing", unit: "SF", baseRate: 6.5, category: "hard", subcategory: "Waterproofing", notes: "Sheet membrane, foundation walls" },
  { item: "Deck Waterproofing", unit: "SF", baseRate: 8, category: "hard", subcategory: "Waterproofing", notes: "Traffic-bearing membrane" },
  { item: "Wet Area Waterproofing", unit: "SF", baseRate: 4.5, category: "hard", subcategory: "Waterproofing", notes: "Bathroom/kitchen membrane" },
  { item: "Dampproofing", unit: "SF", baseRate: 2.5, category: "hard", subcategory: "Waterproofing", notes: "Asphalt coating, below grade" },
];

export const HVAC_BREAKDOWN_RATES: UnitRate[] = [
  { item: "HVAC Ductwork", unit: "LB", baseRate: 5.5, category: "hard", subcategory: "MEP", notes: "Galvanized sheet metal, installed" },
  { item: "HVAC AHU (Air Handling Unit)", unit: "EA", baseRate: 12000, category: "hard", subcategory: "MEP", notes: "5-15 ton packaged unit" },
  { item: "HVAC Chiller", unit: "TON", baseRate: 1200, category: "hard", subcategory: "MEP", notes: "Air-cooled chiller per ton" },
  { item: "HVAC Controls (BAS)", unit: "SF", baseRate: 3.5, category: "hard", subcategory: "MEP", notes: "DDC building automation" },
  { item: "HVAC Diffusers & Grilles", unit: "EA", baseRate: 85, category: "hard", subcategory: "MEP", notes: "Supply/return, installed" },
];

export const ELECTRICAL_FIXTURE_RATES: UnitRate[] = [
  { item: "Electrical Panel (200A)", unit: "EA", baseRate: 2800, category: "hard", subcategory: "Electrical", notes: "Main distribution panel" },
  { item: "Electrical Outlet (Duplex)", unit: "EA", baseRate: 120, category: "hard", subcategory: "Electrical", notes: "Receptacle with wiring" },
  { item: "Electrical Switch", unit: "EA", baseRate: 85, category: "hard", subcategory: "Electrical", notes: "Single-pole with plate" },
  { item: "LED Light Fixture (2x4)", unit: "EA", baseRate: 280, category: "hard", subcategory: "Electrical", notes: "Recessed troffer, installed" },
  { item: "Emergency Lighting", unit: "EA", baseRate: 350, category: "hard", subcategory: "Electrical", notes: "Battery backup with heads" },
  { item: "Fire Alarm System", unit: "SF", baseRate: 4.5, category: "hard", subcategory: "Electrical", notes: "Addressable system, per SF" },
];

export const PLUMBING_FIXTURE_RATES: UnitRate[] = [
  { item: "Toilet (Water Closet)", unit: "EA", baseRate: 850, category: "hard", subcategory: "Plumbing", notes: "Commercial flush valve type" },
  { item: "Lavatory (Sink)", unit: "EA", baseRate: 650, category: "hard", subcategory: "Plumbing", notes: "Wall-mount with faucet" },
  { item: "Urinal", unit: "EA", baseRate: 750, category: "hard", subcategory: "Plumbing", notes: "Wall-hung with flush valve" },
  { item: "Kitchen Sink (Double)", unit: "EA", baseRate: 950, category: "hard", subcategory: "Plumbing", notes: "Stainless steel with faucet" },
  { item: "Water Heater (Commercial)", unit: "EA", baseRate: 3500, category: "hard", subcategory: "Plumbing", notes: "80-gal commercial gas" },
  { item: "Drinking Fountain", unit: "EA", baseRate: 1200, category: "hard", subcategory: "Plumbing", notes: "ADA compliant, bi-level" },
];

export const LANDSCAPING_RATES: UnitRate[] = [
  { item: "Topsoil & Fine Grading", unit: "SF", baseRate: 1.2, category: "hard", subcategory: "Landscaping", notes: "4 inch topsoil, graded" },
  { item: "Lawn Seeding", unit: "SF", baseRate: 0.8, category: "hard", subcategory: "Landscaping", notes: "Seed, fertilizer, mulch" },
  { item: "Sod Installation", unit: "SF", baseRate: 1.5, category: "hard", subcategory: "Landscaping", notes: "Rolled sod, installed" },
  { item: "Deciduous Tree (2.5 inch cal)", unit: "EA", baseRate: 650, category: "hard", subcategory: "Landscaping", notes: "B&B, planted" },
  { item: "Shrubs (3 gal)", unit: "EA", baseRate: 45, category: "hard", subcategory: "Landscaping", notes: "Container, installed" },
  { item: "Irrigation System", unit: "SF", baseRate: 2.0, category: "hard", subcategory: "Landscaping", notes: "Pop-up heads, controller" },
];

export const HARDSCAPE_RATES: UnitRate[] = [
  { item: "Concrete Pavers", unit: "SF", baseRate: 14, category: "hard", subcategory: "Sitework", notes: "Interlocking, sand-set" },
  { item: "Retaining Wall (Concrete)", unit: "SF", baseRate: 35, category: "hard", subcategory: "Sitework", notes: "Cast-in-place, 4-8 ft" },
  { item: "Site Fencing (Chain Link)", unit: "LF", baseRate: 25, category: "hard", subcategory: "Sitework", notes: "6 ft galvanized" },
  { item: "Site Fencing (Ornamental)", unit: "LF", baseRate: 65, category: "hard", subcategory: "Sitework", notes: "Aluminum picket, 6 ft" },
  { item: "Concrete Curb & Gutter", unit: "LF", baseRate: 22, category: "hard", subcategory: "Sitework", notes: "Standard 6 inch" },
  { item: "Site Lighting (Pole)", unit: "EA", baseRate: 3500, category: "hard", subcategory: "Sitework", notes: "20 ft pole with LED head" },
];

export const INSULATION_RATES: UnitRate[] = [
  { item: "Batt Insulation (R-19)", unit: "SF", baseRate: 1.5, category: "hard", subcategory: "Insulation", notes: "Fiberglass, wall cavity" },
  { item: "Rigid Insulation (R-10)", unit: "SF", baseRate: 2.8, category: "hard", subcategory: "Insulation", notes: "XPS board, below grade" },
  { item: "Spray Foam Insulation", unit: "SF", baseRate: 3.5, category: "hard", subcategory: "Insulation", notes: "Closed-cell, 2 inch" },
];

// =============================================================================
// PROFESSIONAL DISCLAIMERS (Section 7)
// =============================================================================

export const COST_DISCLAIMERS = {
  accuracy: "Estimate accuracy: ±15-20% (Class 4 AACE). Not suitable for contract pricing.",
  validity: "Cost rates valid for 90 days from generation date. Market volatility may affect pricing.",
  basis: "Based on RSMeans 2024/2025 national average unit rates with regional adjustment factors.",
  exclusions: "Excludes: land acquisition, financing costs, developer fees, furniture/fixtures/equipment (FF&E), specialty systems, hazardous material abatement.",
  recommendation: "Recommend engaging a certified Quantity Surveyor (RICS/AACE) for detailed estimate at design development stage.",
  full: "DISCLAIMER: This estimate is for preliminary budgeting purposes only (±15-20% accuracy, AACE Class 4). Rates based on RSMeans 2024/2025 data with regional factors. Valid for 90 days. Excludes land, financing, FF&E, and specialty systems. Engage a certified QS for contract-grade pricing.",
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export const ALL_HARD_COSTS = [
  ...CONCRETE_RATES,
  ...STEEL_RATES,
  ...MASONRY_RATES,
  ...FINISHES_RATES,
  ...OPENINGS_RATES,
  ...ROOFING_RATES,
  ...MEP_RATES,
  ...SITEWORK_RATES,
  ...EXCAVATION_RATES,
  ...FORMWORK_RATES,
  ...WATERPROOFING_RATES,
  ...HVAC_BREAKDOWN_RATES,
  ...ELECTRICAL_FIXTURE_RATES,
  ...PLUMBING_FIXTURE_RATES,
  ...LANDSCAPING_RATES,
  ...HARDSCAPE_RATES,
  ...INSULATION_RATES,
];

export const ALL_UNIT_RATES = [...ALL_HARD_COSTS, ...SOFT_COST_RATES];

/**
 * Find a unit rate by item name (fuzzy match)
 */
export function findUnitRate(itemName: string): UnitRate | null {
  const normalized = itemName.toLowerCase().trim();
  
  // Exact match first
  let match = ALL_UNIT_RATES.find((r) =>
    r.item.toLowerCase() === normalized
  );
  
  if (match) return match;
  
  // Partial match
  match = ALL_UNIT_RATES.find((r) =>
    r.item.toLowerCase().includes(normalized) ||
    normalized.includes(r.item.toLowerCase())
  );
  
  return match ?? null;
}

/**
 * Apply regional multiplier to base rate
 */
export function applyRegionalFactor(
  baseRate: number,
  regionName: string
): { adjustedRate: number; multiplier: number; region: string } {
  const region = REGIONAL_FACTORS.find((r) =>
    r.region.toLowerCase().includes(regionName.toLowerCase())
  );
  
  if (!region) {
    return { adjustedRate: baseRate, multiplier: 1.0, region: "USA (baseline)" };
  }
  
  return {
    adjustedRate: baseRate * region.multiplier,
    multiplier: region.multiplier,
    region: region.region,
  };
}

/**
 * Calculate total cost with hard and soft costs breakdown
 */
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
  
  // Add professional fees
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

/**
 * Get recommended unit rate for a building element
 */
export function getRecommendedRate(
  elementType: string,
  material?: string
): UnitRate | null {
  const searchTerm = material ? `${elementType} ${material}` : elementType;
  return findUnitRate(searchTerm);
}

/**
 * Calculate a fully-loaded line item cost with waste, M/L/E breakdown, regional factor, and project type.
 */
export function calculateLineItemCost(
  unitRate: UnitRate,
  quantity: number,
  regionName: string,
  projectType?: string,
): {
  baseRate: number;
  adjustedRate: number;
  wasteFactor: number;
  wasteQty: number;
  totalQty: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  lineTotal: number;
  projectMultiplier: number;
} {
  const { adjustedRate } = applyRegionalFactor(unitRate.baseRate, regionName);
  const wasteFactor = getWasteFactor(unitRate.subcategory);
  const totalQty = quantity * (1 + wasteFactor);
  const wasteQty = quantity * wasteFactor;

  const projectMultiplier = projectType
    ? (PROJECT_TYPE_MULTIPLIERS[projectType]?.multiplier ?? 1.0)
    : 1.0;

  const lineTotal = totalQty * adjustedRate * projectMultiplier;

  const breakdown = getCostBreakdown(unitRate.subcategory);
  const materialCost = lineTotal * breakdown.material;
  const laborCost = lineTotal * breakdown.labor;
  const equipmentCost = lineTotal * breakdown.equipment;

  return {
    baseRate: unitRate.baseRate,
    adjustedRate,
    wasteFactor,
    wasteQty: Math.round(wasteQty * 100) / 100,
    totalQty: Math.round(totalQty * 100) / 100,
    materialCost: Math.round(materialCost * 100) / 100,
    laborCost: Math.round(laborCost * 100) / 100,
    equipmentCost: Math.round(equipmentCost * 100) / 100,
    lineTotal: Math.round(lineTotal * 100) / 100,
    projectMultiplier,
  };
}
