// ─── Mock BOQ Data for Development ──────────────────────────────────────────
// Used when no executionId artifact is available (demo / dev mode)

import type { BOQData } from "@/features/boq/components/types";
import { computeSensitivities, DEFAULT_PRICES } from "@/features/boq/components/recalc-engine";

const RAW_LINES = [
  { division: "Part 2", isCode: "IS1200-P2-RCC-FDN", description: "RCC Foundation (M25)", unit: "m³", quantity: 180, wasteFactor: 0.08, materialRate: 9800, laborRate: 4200, equipmentRate: 1200, confidence: 92, source: "ifc-geometry" as const },
  { division: "Part 2", isCode: "IS1200-P2-RCC-COL", description: "RCC Columns (M30)", unit: "m³", quantity: 95, wasteFactor: 0.06, materialRate: 11200, laborRate: 4800, equipmentRate: 1500, confidence: 94, source: "ifc-geometry" as const },
  { division: "Part 2", isCode: "IS1200-P2-RCC-BEAM", description: "RCC Beams (M25)", unit: "m³", quantity: 210, wasteFactor: 0.07, materialRate: 10500, laborRate: 4400, equipmentRate: 1300, confidence: 91, source: "ifc-geometry" as const },
  { division: "Part 2", isCode: "IS1200-P2-RCC-SLAB", description: "RCC Slab 150mm (M25)", unit: "m³", quantity: 340, wasteFactor: 0.06, materialRate: 9200, laborRate: 4000, equipmentRate: 1100, confidence: 93, source: "ifc-geometry" as const },
  { division: "Part 2", isCode: "IS1200-P2-RCC-STAIR", description: "RCC Staircase", unit: "m³", quantity: 28, wasteFactor: 0.10, materialRate: 12800, laborRate: 5600, equipmentRate: 1800, confidence: 85, source: "ifc-geometry" as const },
  { division: "Part 3", isCode: "IS1200-P3-STL-MAIN", description: "Structural Steel (Fe500D Rebar)", unit: "kg", quantity: 48000, wasteFactor: 0.05, materialRate: 72, laborRate: 18, equipmentRate: 5, confidence: 88, source: "ifc-geometry" as const },
  { division: "Part 3", isCode: "IS1200-P3-STL-MISC", description: "Miscellaneous Steel (Ties, Chairs)", unit: "kg", quantity: 3200, wasteFactor: 0.12, materialRate: 78, laborRate: 22, equipmentRate: 6, confidence: 72, source: "ifc-derived" as const },
  { division: "Part 4", isCode: "IS1200-P4-BRK-230", description: "Brick Masonry 230mm AAC Block", unit: "m²", quantity: 2800, wasteFactor: 0.05, materialRate: 420, laborRate: 380, equipmentRate: 45, confidence: 86, source: "ifc-geometry" as const },
  { division: "Part 4", isCode: "IS1200-P4-BRK-115", description: "Brick Masonry 115mm Partition", unit: "m²", quantity: 1200, wasteFactor: 0.05, materialRate: 280, laborRate: 320, equipmentRate: 35, confidence: 82, source: "ifc-geometry" as const },
  { division: "Part 5", isCode: "IS1200-P5-PLSTR-INT", description: "Internal Cement Plaster 12mm", unit: "m²", quantity: 4200, wasteFactor: 0.05, materialRate: 85, laborRate: 140, equipmentRate: 12, confidence: 78, source: "ifc-derived" as const },
  { division: "Part 5", isCode: "IS1200-P5-PLSTR-EXT", description: "External Cement Plaster 20mm", unit: "m²", quantity: 1800, wasteFactor: 0.06, materialRate: 120, laborRate: 180, equipmentRate: 18, confidence: 75, source: "ifc-derived" as const },
  { division: "Part 6", isCode: "IS1200-P6-FLR-VIT", description: "Vitrified Tile Flooring 600x600", unit: "m²", quantity: 2100, wasteFactor: 0.05, materialRate: 680, laborRate: 320, equipmentRate: 25, confidence: 70, source: "ifc-derived" as const },
  { division: "Part 6", isCode: "IS1200-P6-FLR-GRN", description: "Granite Flooring (Lobby)", unit: "m²", quantity: 180, wasteFactor: 0.08, materialRate: 2200, laborRate: 650, equipmentRate: 80, confidence: 68, source: "ifc-derived" as const },
  { division: "Part 7", isCode: "IS1200-P7-DOOR-FL", description: "Flush Door with Frame", unit: "EA", quantity: 64, wasteFactor: 0.0, materialRate: 8500, laborRate: 2200, equipmentRate: 0, confidence: 80, source: "ifc-geometry" as const },
  { division: "Part 7", isCode: "IS1200-P7-WIN-AL", description: "Aluminium Sliding Window", unit: "m²", quantity: 420, wasteFactor: 0.03, materialRate: 3200, laborRate: 800, equipmentRate: 120, confidence: 76, source: "ifc-geometry" as const },
  { division: "Part 8", isCode: "IS1200-P8-WP-BASE", description: "Waterproofing (Basement)", unit: "m²", quantity: 850, wasteFactor: 0.10, materialRate: 280, laborRate: 220, equipmentRate: 30, confidence: 65, source: "ifc-derived" as const },
  { division: "Part 8", isCode: "IS1200-P8-WP-ROOF", description: "Waterproofing (Terrace)", unit: "m²", quantity: 620, wasteFactor: 0.08, materialRate: 350, laborRate: 260, equipmentRate: 40, confidence: 62, source: "ifc-derived" as const },
  { division: "Part 9", isCode: "IS1200-P9-PNT-INT", description: "Interior Painting (Acrylic)", unit: "m²", quantity: 5400, wasteFactor: 0.05, materialRate: 45, laborRate: 65, equipmentRate: 8, confidence: 72, source: "benchmark" as const },
  { division: "Part 9", isCode: "IS1200-P9-PNT-EXT", description: "Exterior Weather Coat", unit: "m²", quantity: 1800, wasteFactor: 0.06, materialRate: 60, laborRate: 85, equipmentRate: 12, confidence: 70, source: "benchmark" as const },
  { division: "Earthwork", isCode: "IS1200-P1-EXC", description: "Excavation in All Soils", unit: "m³", quantity: 520, wasteFactor: 0.0, materialRate: 0, laborRate: 280, equipmentRate: 180, confidence: 85, source: "ifc-geometry" as const },
  { division: "Earthwork", isCode: "IS1200-P1-FILL", description: "Backfilling with Selected Earth", unit: "m³", quantity: 280, wasteFactor: 0.0, materialRate: 120, laborRate: 180, equipmentRate: 150, confidence: 80, source: "ifc-derived" as const },
  { division: "PROVISIONAL — MEP", isCode: "IS1200-P14", description: "HVAC Ducting & Equipment", unit: "LS", quantity: 1, wasteFactor: 0.0, materialRate: 3200000, laborRate: 1800000, equipmentRate: 400000, confidence: 45, source: "provisional" as const },
  { division: "PROVISIONAL — MEP", isCode: "IS1200-P15", description: "Electrical Wiring & Distribution", unit: "LS", quantity: 1, wasteFactor: 0.0, materialRate: 2800000, laborRate: 1400000, equipmentRate: 300000, confidence: 48, source: "provisional" as const },
  { division: "PROVISIONAL — MEP", isCode: "IS1200-P16", description: "Plumbing & Drainage", unit: "LS", quantity: 1, wasteFactor: 0.0, materialRate: 1800000, laborRate: 1200000, equipmentRate: 250000, confidence: 45, source: "provisional" as const },
  { division: "PROVISIONAL — MEP", isCode: "IS1200-P17", description: "Fire Protection System", unit: "LS", quantity: 1, wasteFactor: 0.0, materialRate: 1200000, laborRate: 600000, equipmentRate: 200000, confidence: 42, source: "provisional" as const },
  { division: "PROVISIONAL — MEP", isCode: "IS1200-P18", description: "Lifts & Elevators (2 nos)", unit: "EA", quantity: 2, wasteFactor: 0.0, materialRate: 1800000, laborRate: 400000, equipmentRate: 100000, confidence: 50, source: "provisional" as const },
  { division: "External", isCode: "IS1200-EXT-PAVE", description: "External Paving & Landscaping", unit: "m²", quantity: 650, wasteFactor: 0.05, materialRate: 480, laborRate: 350, equipmentRate: 120, confidence: 55, source: "benchmark" as const },
  { division: "External", isCode: "IS1200-EXT-COMP", description: "Compound Wall with Railing", unit: "Rmt", quantity: 180, wasteFactor: 0.05, materialRate: 2800, laborRate: 1600, equipmentRate: 300, confidence: 58, source: "benchmark" as const },
  { division: "Part 10", isCode: "IS1200-P10-SANI", description: "Sanitary Fittings & Fixtures", unit: "EA", quantity: 48, wasteFactor: 0.0, materialRate: 12000, laborRate: 3500, equipmentRate: 0, confidence: 65, source: "benchmark" as const },
  { division: "Part 11", isCode: "IS1200-P11-CEIL", description: "False Ceiling (Grid Type)", unit: "m²", quantity: 1800, wasteFactor: 0.05, materialRate: 380, laborRate: 280, equipmentRate: 35, confidence: 68, source: "ifc-derived" as const },
];

function buildLines() {
  return RAW_LINES.map((line, idx) => {
    const adjQty = line.quantity * (1 + line.wasteFactor);
    const materialCost = adjQty * line.materialRate;
    const laborCost = adjQty * line.laborRate;
    const equipmentCost = adjQty * line.equipmentRate;
    const unitRate = line.materialRate + line.laborRate + line.equipmentRate;
    return {
      id: `boq-${idx}`,
      ...line,
      adjustedQty: adjQty,
      materialCost,
      laborCost,
      equipmentCost,
      unitRate,
      totalCost: materialCost + laborCost + equipmentCost,
      steelSensitivity: 0,
      cementSensitivity: 0,
      masonSensitivity: 0,
      bricksSensitivity: 0,
      sandSensitivity: 0,
      timberSensitivity: 0,
    };
  });
}

export function getMockBOQData(): BOQData {
  const rawLines = buildLines();
  const lines = computeSensitivities(rawLines, DEFAULT_PRICES);

  const subtotalMaterial = lines.reduce((s, l) => s + l.materialCost, 0);
  const subtotalLabor = lines.reduce((s, l) => s + l.laborCost, 0);
  const subtotalEquipment = lines.reduce((s, l) => s + l.equipmentCost, 0);
  const hardCosts = subtotalMaterial + subtotalLabor + subtotalEquipment;
  const escalation = hardCosts * 0.03;
  const softCosts = hardCosts * 0.30;
  const totalCost = hardCosts + escalation + softCosts;
  const gfa = 2284;

  return {
    projectName: "Commercial Complex",
    location: "Bhilai, Chhattisgarh, India",
    date: "27 Mar 2026",
    currency: "INR",
    currencySymbol: "₹",
    gfa,
    projectType: "Commercial",

    lines,

    totalCost,
    hardCosts,
    softCosts,
    escalation,
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
    grandTotal: totalCost,

    benchmark: {
      costPerM2: totalCost / gfa,
      benchmarkLow: 28000,
      benchmarkHigh: 42000,
      status: "within",
      severity: "ok",
      message: "Cost per m² is within the expected range for Commercial buildings in Tier-2 cities.",
      buildingType: "Commercial",
      cityTier: "Tier-2",
    },

    market: {
      steelPerTonne: 72000,
      steelSource: "SAIL Bhilai",
      steelConfidence: "HIGH",
      cementPerBag: 390,
      cementBrand: "UltraTech",
      cementSource: "Regional dealer",
      cementConfidence: "MEDIUM",
      masonRate: 800,
      masonSource: "Local market survey",
      masonConfidence: "MEDIUM",
    },

    ifcQuality: {
      score: 78,
      confidence: 82,
      elementCoverage: 85,
      missingFiles: ["MEP Services Model", "Landscape Model"],
      anomalies: [
        "3 columns missing storey assignment",
        "Slab thickness inconsistency on 2nd floor (120mm vs 150mm spec)",
        "2 beams with zero cross-section area",
      ],
    },

    mepBreakdown: {
      hvac: { cost: 5400000, percentage: 32.8, reasoning: "Based on 2,284m² GFA, commercial profile with central AC requirement" },
      electrical: { cost: 4500000, percentage: 27.3, reasoning: "Commercial building electrical load estimate based on IS 732 standards" },
      plumbing: { cost: 3250000, percentage: 19.7, reasoning: "2,284m² GFA × ₹1,420/m² benchmark for commercial plumbing" },
      fire: { cost: 2000000, percentage: 12.1, reasoning: "Statutory requirement per NBC 2016 for commercial occupancy > 1,500m²" },
      lifts: { cost: 1340000, percentage: 8.1, reasoning: "2 passenger lifts for G+4 commercial building" },
    },

    aaceClass: "Class 3",
    confidenceLevel: "MEDIUM",

    summary: `This Bill of Quantities covers a Commercial Complex of ₹8.1 Cr total project cost spread across 2,284 m² gross floor area in Bhilai, Chhattisgarh. The estimated cost per m² of ₹35,464 falls within the expected benchmark range of ₹28,000–₹42,000 for Tier-2 commercial construction.\n\nStructural works form the largest cost component at approximately 45% of hard costs, driven by RCC foundations (₹28.5 L), columns (₹17.2 L), beams (₹36.4 L), and slabs (₹52.1 L). Steel reinforcement at 48,000 kg of Fe500D rebar represents ₹45.4 L at current SAIL Bhilai rates of ₹72,000/tonne.\n\nMEP provisional sums total ₹1.65 Cr (approximately 20% of project cost), with HVAC being the dominant component at ₹54 L. These are benchmark-based estimates and should be validated with detailed MEP design.\n\nThe IFC model quality score of 78% (GOOD) provides reasonable confidence in geometric quantities. 3 anomalies were detected including missing storey assignments and slab thickness inconsistencies that should be reviewed.`,

    disclaimer: "This is an AI-generated cost estimate prepared using IS 1200 / CPWD DSR 2023-24 rates with regional adjustments for Bhilai, Chhattisgarh. All quantities are derived from IFC model geometry where available, supplemented by benchmark rates for provisional items. This estimate is suitable for preliminary budgeting (AACE Class 3) and should not be used for tendering without detailed measurement verification. Market prices are indicative and subject to change.",
  };
}
