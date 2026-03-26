/**
 * BOQ Intelligence — Quantity validation + Provisional sums
 *
 * Capability 2: Quantity sanity checker (validates IFC-extracted quantities)
 * Capability 3: MEP provisional sum (estimated from building type + GFA)
 * Capability 4: Foundation provisional sum (estimated from floors + footprint)
 * Capability 5: External works provisional sum (estimated from GFA)
 */

// ─── Quantity Sanity Checker ────────────────────────────────────────────────

export interface QuantityWarning {
  element: string;
  metric: string;
  value: number;
  expectedRange: string;
  severity: "info" | "warning" | "critical";
  suggestion: string;
}

export function checkQuantitySanity(
  elements: Array<{ description: string; grossArea?: number; totalVolume?: number; elementCount?: number; storey?: string }>,
  totalGFA: number,
  floorCount: number
): QuantityWarning[] {
  const warnings: QuantityWarning[] = [];
  if (totalGFA <= 0 || floorCount <= 0) return warnings;

  const avgFloorPlate = totalGFA / floorCount;

  // Wall-to-floor ratio check
  const totalWallArea = elements
    .filter(e => e.description.toLowerCase().includes("wall"))
    .reduce((s, e) => s + (e.grossArea ?? 0), 0);
  const wallToFloorRatio = totalWallArea / totalGFA;
  if (wallToFloorRatio < 0.3) {
    warnings.push({
      element: "Walls", metric: "Wall-to-floor ratio",
      value: Math.round(wallToFloorRatio * 100) / 100,
      expectedRange: "0.3 – 1.2",
      severity: "warning",
      suggestion: "Low wall area may indicate missing internal partitions. Check if the IFC model includes all wall types.",
    });
  } else if (wallToFloorRatio > 1.5) {
    warnings.push({
      element: "Walls", metric: "Wall-to-floor ratio",
      value: Math.round(wallToFloorRatio * 100) / 100,
      expectedRange: "0.3 – 1.2",
      severity: "info",
      suggestion: "High wall area — may include multiple layers (inner + outer leaf) or curved walls.",
    });
  }

  // Slab area per floor check
  const totalSlabArea = elements
    .filter(e => e.description.toLowerCase().includes("slab"))
    .reduce((s, e) => s + (e.grossArea ?? 0), 0);
  const slabPerFloor = totalSlabArea / floorCount;
  if (totalSlabArea > 0 && slabPerFloor < avgFloorPlate * 0.5) {
    warnings.push({
      element: "Slabs", metric: "Slab area per floor vs expected floor plate",
      value: Math.round(slabPerFloor),
      expectedRange: `${Math.round(avgFloorPlate * 0.7)} – ${Math.round(avgFloorPlate * 1.3)} m²`,
      severity: "warning",
      suggestion: "Slab area seems low — some floor slabs may use geometry the parser couldn't extract. Manual verification recommended.",
    });
  }

  // Door density check
  const totalDoors = elements
    .filter(e => e.description.toLowerCase().includes("door"))
    .reduce((s, e) => s + (e.elementCount ?? 1), 0);
  const doorDensity = totalGFA / Math.max(totalDoors, 1);
  if (totalDoors > 0 && doorDensity < 10) {
    warnings.push({
      element: "Doors", metric: "Floor area per door",
      value: Math.round(doorDensity),
      expectedRange: "15 – 50 m² per door",
      severity: "info",
      suggestion: "High door count — likely includes internal partition doors, closet doors, etc.",
    });
  }

  // Column count check
  const totalColumns = elements
    .filter(e => e.description.toLowerCase().includes("column"))
    .reduce((s, e) => s + (e.elementCount ?? 1), 0);
  if (totalColumns === 0 && floorCount > 1) {
    warnings.push({
      element: "Columns", metric: "Column count",
      value: 0,
      expectedRange: `${Math.max(4, Math.round(avgFloorPlate / 25))} – ${Math.round(avgFloorPlate / 12)} columns`,
      severity: "critical",
      suggestion: "No columns detected. Structural columns may be modelled as IfcBuildingElementProxy or missing from the IFC export.",
    });
  }

  return warnings;
}

// ─── MEP Provisional Sum ────────────────────────────────────────────────────

export interface ProvisionalSum {
  category: string;
  description: string;
  amount: number;
  unit: string;
  rate: number;
  quantity: number;
  basis: string;
  is1200Code?: string;
  confidence: "estimated" | "benchmark" | "provisional";
}

/**
 * MEP rates differentiated by building type (INR/m² GFA, Tier-2 baseline).
 * Source: RICS India 2024, CBRE India Construction Monitor, ASHRAE benchmarks.
 *
 * City tier multiplier applied on top:
 *   Metro (Mumbai/Delhi/Bengaluru): 1.30x
 *   Tier-1 (Pune/Hyderabad/Chennai): 1.15x
 *   Tier-2 (Nagpur/Jaipur/Lucknow): 1.00x (baseline)
 *   Tier-3 and below: 0.85x
 */
interface MEPRateProfile {
  plumbing: number;
  electrical: number;
  hvac: number;
  fireFighting: number;
  bms: number;
  liftCostLakh: number; // per lift, in lakhs
  liftMinFloors: number; // minimum floors to include lifts
  notes: string;
}

const MEP_PROFILES: Record<string, MEPRateProfile> = {
  residential: {
    plumbing: 900, electrical: 1200, hvac: 0,
    fireFighting: 300, bms: 0, liftCostLakh: 18, liftMinFloors: 5,
    notes: "Natural ventilation assumed. Fire fighting only if >15m height.",
  },
  commercial: {
    plumbing: 1100, electrical: 2200, hvac: 2500,
    fireFighting: 600, bms: 400, liftCostLakh: 25, liftMinFloors: 4,
    notes: "Full HVAC, BMS, electrical with UPS provisions.",
  },
  "wellness": {
    plumbing: 2200, electrical: 2500, hvac: 3500,
    fireFighting: 700, bms: 600, liftCostLakh: 28, liftMinFloors: 3,
    notes: "Spa-grade plumbing (hot/cold, pools, steam), full climate control.",
  },
  "hospitality": {
    plumbing: 2200, electrical: 2500, hvac: 3500,
    fireFighting: 700, bms: 600, liftCostLakh: 28, liftMinFloors: 3,
    notes: "Hotel-grade MEP with extensive plumbing and climate control.",
  },
  healthcare: {
    plumbing: 3500, electrical: 4000, hvac: 5000,
    fireFighting: 800, bms: 1000, liftCostLakh: 30, liftMinFloors: 3,
    notes: "Medical gas, HEPA filtration, pressure control, UPS critical systems.",
  },
  hospital: {
    plumbing: 3500, electrical: 4000, hvac: 5000,
    fireFighting: 800, bms: 1000, liftCostLakh: 30, liftMinFloors: 3,
    notes: "Same as healthcare — full medical-grade MEP.",
  },
  educational: {
    plumbing: 800, electrical: 1400, hvac: 1200,
    fireFighting: 400, bms: 200, liftCostLakh: 20, liftMinFloors: 4,
    notes: "Classroom ventilation, basic BMS for energy management.",
  },
  industrial: {
    plumbing: 600, electrical: 1800, hvac: 800,
    fireFighting: 500, bms: 0, liftCostLakh: 22, liftMinFloors: 5,
    notes: "Heavy electrical for machinery, minimal plumbing/HVAC.",
  },
  warehouse: {
    plumbing: 300, electrical: 800, hvac: 0,
    fireFighting: 400, bms: 0, liftCostLakh: 0, liftMinFloors: 99,
    notes: "Minimal MEP. Fire fighting mandatory for storage.",
  },
  datacenter: {
    plumbing: 800, electrical: 6000, hvac: 5500,
    fireFighting: 1000, bms: 1500, liftCostLakh: 25, liftMinFloors: 3,
    notes: "Precision cooling, redundant power, advanced BMS/monitoring.",
  },
  laboratory: {
    plumbing: 3000, electrical: 3500, hvac: 4500,
    fireFighting: 800, bms: 800, liftCostLakh: 25, liftMinFloors: 3,
    notes: "Fume hoods, specialized gas, HEPA, pressure cascade.",
  },
  "mixed-use": {
    plumbing: 1200, electrical: 1800, hvac: 2000,
    fireFighting: 600, bms: 350, liftCostLakh: 25, liftMinFloors: 4,
    notes: "Blended rate: retail + residential + commercial.",
  },
  retail: {
    plumbing: 900, electrical: 2000, hvac: 2200,
    fireFighting: 600, bms: 300, liftCostLakh: 22, liftMinFloors: 4,
    notes: "High electrical for lighting, full HVAC for comfort cooling.",
  },
};

const DEFAULT_MEP_PROFILE: MEPRateProfile = {
  plumbing: 1100, electrical: 1800, hvac: 1800,
  fireFighting: 500, bms: 300, liftCostLakh: 25, liftMinFloors: 4,
  notes: "Default commercial-equivalent MEP rates.",
};

export function estimateMEPCosts(
  totalGFA: number,
  buildingType: string,
  floorCount: number,
  cityTier: string,
  isINR: boolean,
): ProvisionalSum[] {
  if (totalGFA <= 0) return [];

  // Resolve building type to MEP profile
  const btLower = buildingType.toLowerCase();
  const profile = MEP_PROFILES[btLower]
    ?? (btLower.includes("wellness") || btLower.includes("spa") ? MEP_PROFILES["wellness"]
    : btLower.includes("hotel") || btLower.includes("resort") ? MEP_PROFILES["hospitality"]
    : btLower.includes("hospital") || btLower.includes("clinic") ? MEP_PROFILES["healthcare"]
    : btLower.includes("school") || btLower.includes("university") ? MEP_PROFILES["educational"]
    : btLower.includes("warehouse") || btLower.includes("storage") ? MEP_PROFILES["warehouse"]
    : btLower.includes("data") ? MEP_PROFILES["datacenter"]
    : btLower.includes("lab") ? MEP_PROFILES["laboratory"]
    : btLower.includes("retail") || btLower.includes("shop") || btLower.includes("mall") ? MEP_PROFILES["retail"]
    : DEFAULT_MEP_PROFILE);

  // City tier multiplier (Tier-2 = 1.0 baseline)
  const tierMult = cityTier === "metro" ? 1.30
    : cityTier === "tier-1" ? 1.15
    : cityTier === "tier-2" ? 1.00
    : 0.85; // tier-3 and below

  const fx = isINR ? 1 : 1 / 83.5;
  const sums: ProvisionalSum[] = [];

  // Plumbing
  if (profile.plumbing > 0) {
    const rate = Math.round(profile.plumbing * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: `Plumbing & drainage (${btLower.includes("wellness") || btLower.includes("spa") ? "spa-grade hot/cold, pools, steam" : btLower.includes("hospital") || btLower.includes("healthcare") ? "medical gas, specialized drainage" : "supply, waste, storm water"})`,
      amount: Math.round(totalGFA * rate * fx), unit: "m²", rate: Math.round(rate * fx),
      quantity: Math.round(totalGFA),
      basis: `₹${rate}/m² GFA (${buildingType} profile, ${cityTier} tier)`,
      is1200Code: "IS1200-P14", confidence: "benchmark",
    });
  }

  // Electrical
  if (profile.electrical > 0) {
    const rate = Math.round(profile.electrical * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: `Electrical (${profile.electrical >= 3500 ? "UPS, critical systems, redundant power" : profile.electrical >= 2000 ? "LT panels, wiring, lighting, UPS" : "LT panels, wiring, lighting, earthing"})`,
      amount: Math.round(totalGFA * rate * fx), unit: "m²", rate: Math.round(rate * fx),
      quantity: Math.round(totalGFA),
      basis: `₹${rate}/m² GFA (${buildingType} profile, ${cityTier} tier)`,
      is1200Code: "IS1200-P16", confidence: "benchmark",
    });
  }

  // HVAC
  if (profile.hvac > 0) {
    const rate = Math.round(profile.hvac * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: `HVAC / ventilation (${profile.hvac >= 4000 ? "HEPA, pressure control, precision cooling" : profile.hvac >= 3000 ? "full climate control throughout" : "comfort cooling & ventilation"})`,
      amount: Math.round(totalGFA * rate * fx), unit: "m²", rate: Math.round(rate * fx),
      quantity: Math.round(totalGFA),
      basis: `₹${rate}/m² GFA (${buildingType} profile, ${cityTier} tier)`,
      is1200Code: "IS1200-P17-HVAC",
      confidence: "benchmark",
    });
  } else if (btLower === "residential" && floorCount > 3) {
    // Residential with >3 floors may need common area ventilation
    const rate = Math.round(400 * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: "Common area ventilation (basement, corridors)",
      amount: Math.round(totalGFA * 0.2 * rate * fx), unit: "m²", rate: Math.round(rate * fx),
      quantity: Math.round(totalGFA * 0.2),
      basis: `₹${rate}/m² × 20% common area`,
      is1200Code: "IS1200-P17-VENT",
      confidence: "estimated",
    });
  }

  // Fire fighting
  if (profile.fireFighting > 0) {
    // Residential: only if >15m height (≈5 floors)
    const includeFireFighting = btLower !== "residential" || floorCount >= 5;
    if (includeFireFighting) {
      const rate = Math.round(profile.fireFighting * tierMult);
      sums.push({
        category: "PROVISIONAL — MEP",
        description: "Fire fighting system (sprinklers, hydrants, detection, alarm)",
        amount: Math.round(totalGFA * rate * fx), unit: "m²", rate: Math.round(rate * fx),
        quantity: Math.round(totalGFA),
        basis: `₹${rate}/m² GFA (${buildingType} profile)`,
        is1200Code: "IS1200-P15-FIRE",
        confidence: "benchmark",
      });
    }
  }

  // BMS
  if (profile.bms > 0) {
    const rate = Math.round(profile.bms * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: `Building management system (${profile.bms >= 800 ? "advanced monitoring, analytics, automation" : "IBMS/automation"})`,
      amount: Math.round(totalGFA * rate * fx), unit: "m²", rate: Math.round(rate * fx),
      quantity: Math.round(totalGFA),
      basis: `₹${rate}/m² GFA (${buildingType})`,
      is1200Code: "IS1200-P16-BMS",
      confidence: "estimated",
    });
  }

  // Lifts
  if (floorCount >= profile.liftMinFloors && profile.liftCostLakh > 0) {
    const liftsNeeded = floorCount <= 5 ? 1 : floorCount <= 10 ? 2 : Math.ceil(floorCount / 5);
    const liftCost = Math.round(profile.liftCostLakh * 100000 * tierMult);
    sums.push({
      category: "PROVISIONAL — MEP",
      description: `Passenger lifts (${liftsNeeded} nos, ${floorCount} floors)`,
      amount: Math.round(liftsNeeded * liftCost * fx), unit: "EA", rate: Math.round(liftCost * fx),
      quantity: liftsNeeded,
      basis: `${liftsNeeded} lifts × ₹${(liftCost / 100000).toFixed(1)} lakh each (${buildingType})`,
      is1200Code: "IS1200-P16-LIFT",
      confidence: "estimated",
    });
  }

  return sums;
}

// ─── Rate Benchmark Validator ───────────────────────────────────────────────
//
// Compares computed cost/m² against industry benchmarks by building type + city.
// Catches wildly wrong estimates before they reach users.

export interface BenchmarkResult {
  costPerM2: number;
  benchmarkLow: number;
  benchmarkHigh: number;
  status: "within" | "below" | "above";
  severity: "ok" | "warning" | "critical";
  message: string;
  buildingType: string;
  cityTier: string;
}

// Benchmark ranges in INR/m² (structural + finishing, excl. land)
// Source: RICS India 2024, Knight Frank India Cost Guide, CBRE Construction Monitor
const BENCHMARK_RANGES: Record<string, { low: number; high: number }> = {
  "residential":        { low: 18000, high: 35000 },
  "residential-premium":{ low: 35000, high: 65000 },
  "commercial":         { low: 35000, high: 60000 },
  "retail":             { low: 30000, high: 55000 },
  "healthcare":         { low: 50000, high: 90000 },
  "hospital":           { low: 50000, high: 90000 },
  "hospitality":        { low: 55000, high: 95000 },
  "hotel":              { low: 55000, high: 95000 },
  "industrial":         { low: 15000, high: 30000 },
  "warehouse":          { low: 12000, high: 25000 },
  "educational":        { low: 25000, high: 45000 },
  "wellness":           { low: 40000, high: 70000 },
  "spa":                { low: 40000, high: 70000 },
  "datacenter":         { low: 65000, high: 120000 },
  "laboratory":         { low: 60000, high: 110000 },
  "mixed-use":          { low: 30000, high: 55000 },
};

// City factor applied to benchmark range
const BENCHMARK_CITY_FACTORS: Record<string, number> = {
  metro: 1.30,    // Mumbai, Delhi, Bengaluru
  "tier-1": 1.15, // Pune, Hyderabad, Chennai
  "tier-2": 1.00, // Nagpur, Jaipur, Lucknow
  "tier-3": 0.85, // Smaller towns
  "town": 0.85,
  "rural": 0.75,
  "city": 1.00,
  "state-avg": 1.00,
};

/**
 * @param totalProjectCost Total project cost (hard + escalation + soft costs incl. contingency).
 *   Industry benchmarks include all costs except land.
 */
export function validateBenchmark(
  totalProjectCost: number,
  totalGFA: number,
  buildingType: string,
  cityTier: string,
): BenchmarkResult {
  const costPerM2 = totalGFA > 0 ? totalProjectCost / totalGFA : 0;
  const btLower = buildingType.toLowerCase();

  // Find matching benchmark range
  const range = BENCHMARK_RANGES[btLower]
    ?? (btLower.includes("wellness") || btLower.includes("spa") ? BENCHMARK_RANGES["wellness"]
    : btLower.includes("hospital") || btLower.includes("clinic") ? BENCHMARK_RANGES["healthcare"]
    : btLower.includes("hotel") || btLower.includes("resort") ? BENCHMARK_RANGES["hospitality"]
    : btLower.includes("warehouse") || btLower.includes("storage") ? BENCHMARK_RANGES["warehouse"]
    : btLower.includes("school") || btLower.includes("university") ? BENCHMARK_RANGES["educational"]
    : btLower.includes("data") ? BENCHMARK_RANGES["datacenter"]
    : btLower.includes("lab") ? BENCHMARK_RANGES["laboratory"]
    : btLower.includes("retail") || btLower.includes("mall") ? BENCHMARK_RANGES["retail"]
    : BENCHMARK_RANGES["commercial"]); // default

  const cityFactor = BENCHMARK_CITY_FACTORS[cityTier] ?? 1.0;
  const adjLow = Math.round(range.low * cityFactor);
  const adjHigh = Math.round(range.high * cityFactor);

  let status: BenchmarkResult["status"] = "within";
  let severity: BenchmarkResult["severity"] = "ok";
  let message = `Estimated cost ₹${Math.round(costPerM2).toLocaleString()}/m² is within the typical range (₹${adjLow.toLocaleString()}–${adjHigh.toLocaleString()}/m²) for ${buildingType} in ${cityTier} city.`;

  if (costPerM2 < adjLow * 0.7) {
    status = "below";
    severity = "critical";
    message = `⚠️ ACCURACY WARNING: Estimated cost (₹${Math.round(costPerM2).toLocaleString()}/m²) is significantly below typical range (₹${adjLow.toLocaleString()}–${adjHigh.toLocaleString()}/m²) for ${buildingType} in ${cityTier} city. This may indicate missing elements — verify MEP, foundation, and finishing are included.`;
  } else if (costPerM2 < adjLow * 0.85) {
    status = "below";
    severity = "warning";
    message = `⚠️ Estimated cost (₹${Math.round(costPerM2).toLocaleString()}/m²) is below typical range (₹${adjLow.toLocaleString()}–${adjHigh.toLocaleString()}/m²) for ${buildingType} in ${cityTier} city. Some elements may be missing or underpriced.`;
  } else if (costPerM2 > adjHigh * 1.4) {
    status = "above";
    severity = "critical";
    message = `⚠️ ACCURACY WARNING: Estimated cost (₹${Math.round(costPerM2).toLocaleString()}/m²) appears high vs typical range (₹${adjLow.toLocaleString()}–${adjHigh.toLocaleString()}/m²). Verify no elements are double-counted.`;
  } else if (costPerM2 > adjHigh * 1.15) {
    status = "above";
    severity = "warning";
    message = `Estimated cost (₹${Math.round(costPerM2).toLocaleString()}/m²) is above typical range (₹${adjLow.toLocaleString()}–${adjHigh.toLocaleString()}/m²) for ${buildingType}. May include premium specifications.`;
  }

  return {
    costPerM2: Math.round(costPerM2),
    benchmarkLow: adjLow,
    benchmarkHigh: adjHigh,
    status,
    severity,
    message,
    buildingType,
    cityTier,
  };
}

// ─── Foundation Provisional Sum ─────────────────────────────────────────────

export function estimateFoundationCosts(
  totalGFA: number,
  floorCount: number,
  buildingType: string,
  cityTier: string,
  isINR: boolean,
  soilType?: string, // "hard_rock" | "medium" | "soft_clay" | "waterlogged"
): ProvisionalSum[] {
  if (totalGFA <= 0) return [];

  const footprint = totalGFA / Math.max(floorCount, 1);
  const tierMult = cityTier === "metro" ? 1.15 : cityTier === "tier-2" ? 0.95 : 0.80;

  // Foundation type inference — soil type overrides floor-count logic
  let foundationType: string;
  let ratePerSqm: number; // INR per m² of footprint
  let excavationDepth = 1.5; // metres
  let excavationRate = 800; // INR/m³

  if (soilType === "waterlogged") {
    // Waterlogged: always pile foundation + dewatering
    foundationType = "Pile foundation (RCC bored cast-in-situ) — waterlogged soil";
    ratePerSqm = Math.round(9500 * tierMult); // premium for waterlogged
    excavationDepth = 2.0;
    excavationRate = 1200; // dewatering + pumping cost
  } else if (soilType === "soft_clay") {
    // Soft clay: raft foundation regardless of floor count
    foundationType = "Raft foundation (soft clay soil condition)";
    ratePerSqm = Math.round(6000 * tierMult);
    excavationDepth = 2.0;
    excavationRate = 900;
  } else if (soilType === "hard_rock") {
    // Hard rock: isolated footings are cheaper, but excavation is harder
    if (floorCount <= 8) {
      foundationType = "Isolated footings + grade beams (hard rock)";
      ratePerSqm = Math.round(3500 * 0.85 * tierMult); // 15% cheaper foundation on rock
    } else {
      foundationType = "Raft foundation on rock (high-rise)";
      ratePerSqm = Math.round(5000 * tierMult);
    }
    excavationRate = 1400; // rock excavation much more expensive
    excavationDepth = 1.2; // less depth needed on rock
  } else {
    // Default: infer from floor count (medium soil or unspecified)
    if (floorCount <= 3) {
      foundationType = "Isolated footings + grade beams";
      ratePerSqm = Math.round(3500 * tierMult);
    } else if (floorCount <= 8) {
      foundationType = "Raft foundation / combined footings";
      ratePerSqm = Math.round(5500 * tierMult);
    } else {
      foundationType = "Pile foundation (RCC bored cast-in-situ)";
      ratePerSqm = Math.round(8500 * tierMult);
    }
  }

  const fx = isINR ? 1 : 1 / 83.5;
  const soilNote = soilType ? ` [soil: ${soilType.replace("_", " ")}]` : "";

  return [
    {
      category: "PROVISIONAL — SUBSTRUCTURE",
      description: `${foundationType} (estimated for ${floorCount}-storey ${buildingType})${soilNote}`,
      amount: Math.round(footprint * ratePerSqm * fx),
      unit: "m²", rate: Math.round(ratePerSqm * fx),
      quantity: Math.round(footprint),
      basis: `₹${ratePerSqm}/m² footprint. ${floorCount} floors${soilNote} → ${foundationType.split(" (")[0]}`,
      is1200Code: "IS1200-P2",
      confidence: "estimated",
    },
    {
      category: "PROVISIONAL — SUBSTRUCTURE",
      description: `Excavation & backfill (estimated from footprint)${soilNote}`,
      amount: Math.round(footprint * excavationDepth * excavationRate * fx),
      unit: "m³", rate: Math.round(excavationRate * fx),
      quantity: Math.round(footprint * excavationDepth),
      basis: `Footprint ${Math.round(footprint)}m² × ${excavationDepth}m depth × ₹${excavationRate}/m³${soilType === "hard_rock" ? " (rock breaking)" : soilType === "waterlogged" ? " (incl. dewatering)" : ""}`,
      is1200Code: "IS1200-P1",
      confidence: "estimated",
    },
  ];
}

// ─── External Works Provisional Sum ─────────────────────────────────────────

export function estimateExternalWorksCosts(
  totalGFA: number,
  floorCount: number,
  cityTier: string,
  isINR: boolean,
  userPlotArea?: number, // m² — if provided, use instead of estimate
): ProvisionalSum[] {
  if (totalGFA <= 0) return [];

  const footprint = totalGFA / Math.max(floorCount, 1);
  // Use user-provided plot area, or estimate from footprint × FAR
  const plotArea = (userPlotArea && userPlotArea > footprint)
    ? userPlotArea
    : footprint * (floorCount <= 4 ? 2.5 : floorCount <= 10 ? 2.0 : 1.5);
  const openArea = plotArea - footprint;
  const perimeter = Math.sqrt(plotArea) * 4; // rough square plot
  const tierMult = cityTier === "metro" ? 1.15 : cityTier === "tier-2" ? 0.95 : 0.80;
  const fx = isINR ? 1 : 1 / 83.5;

  return [
    {
      category: "PROVISIONAL — EXTERNAL WORKS",
      description: "Compound wall with gates (estimated perimeter)",
      amount: Math.round(perimeter * 4500 * tierMult * fx),
      unit: "Rmt", rate: Math.round(4500 * tierMult * fx), quantity: Math.round(perimeter),
      basis: `Est. perimeter ${Math.round(perimeter)}m × ₹4,500/Rmt`,
      is1200Code: "IS1200-P3-EXT", confidence: "estimated",
    },
    {
      category: "PROVISIONAL — EXTERNAL WORKS",
      description: "Internal roads, parking & paving",
      amount: Math.round(openArea * 0.4 * 2200 * tierMult * fx),
      unit: "m²", rate: Math.round(2200 * tierMult * fx), quantity: Math.round(openArea * 0.4),
      basis: `40% of open area (${Math.round(openArea * 0.4)}m²) × ₹2,200/m²`,
      is1200Code: "IS1200-P13-PAV", confidence: "estimated",
    },
    {
      category: "PROVISIONAL — EXTERNAL WORKS",
      description: "External drainage, STP & water tank",
      amount: Math.round(totalGFA * 250 * tierMult * fx),
      unit: "LS", rate: Math.round(totalGFA * 250 * tierMult * fx), quantity: 1,
      basis: `Lump sum: ₹250/m² GFA × ${Math.round(totalGFA)}m²`,
      is1200Code: "IS1200-P14-DRN", confidence: "estimated",
    },
    {
      category: "PROVISIONAL — EXTERNAL WORKS",
      description: "Landscaping & softscape",
      amount: Math.round(openArea * 0.3 * 800 * tierMult * fx),
      unit: "m²", rate: Math.round(800 * tierMult * fx), quantity: Math.round(openArea * 0.3),
      basis: `30% of open area (${Math.round(openArea * 0.3)}m²) × ₹800/m²`,
      is1200Code: "IS1200-EXT-LAND", confidence: "estimated",
    },
  ];
}
