// ─── BOQ Recalculation Engine ───────────────────────────────────────────────
// Pre-calculates sensitivity coefficients so price slider changes are instant.

import type { BOQLineItem, BOQData, PriceOverrides, RateOverride } from "./types";

// Default base prices (used to compute deltas)
export const DEFAULT_PRICES: PriceOverrides = {
  steel: 72000, // ₹/tonne
  cement: 390,  // ₹/bag
  mason: 800,   // ₹/day
};

export const PRICE_RANGES = {
  steel: { min: 50000, max: 80000, step: 500, unit: "₹/tonne" },
  cement: { min: 300, max: 550, step: 5, unit: "₹/bag" },
  mason: { min: 400, max: 1400, step: 25, unit: "₹/day" },
} as const;

// ─── Sensitivity Computation ────────────────────────────────────────────────
// For each line item, compute how much its cost changes when steel/cement/mason
// changes by 1 unit. This lets us do O(n) recalc instead of rerunning the full
// rate engine.

function classifyMaterial(desc: string, division: string): {
  steelWeight: number;
  cementWeight: number;
  masonWeight: number;
} {
  const d = desc.toLowerCase();
  const div = division.toLowerCase();

  // Steel-heavy items
  if (d.includes("steel") || d.includes("rebar") || d.includes("reinforcement") || d.includes("structural steel") || d.includes("railing")) {
    return { steelWeight: 0.85, cementWeight: 0.05, masonWeight: 0.10 };
  }

  // Concrete items (cement + steel rebar)
  if (d.includes("concrete") || d.includes("rcc") || d.includes("slab") || d.includes("beam") || d.includes("column") || d.includes("footing") || d.includes("foundation")) {
    return { steelWeight: 0.30, cementWeight: 0.45, masonWeight: 0.25 };
  }

  // Masonry/brickwork
  if (d.includes("brick") || d.includes("masonry") || d.includes("block") || d.includes("wall") || div.includes("part 4") || div.includes("masonry")) {
    return { steelWeight: 0.0, cementWeight: 0.35, masonWeight: 0.65 };
  }

  // Plastering/finishing
  if (d.includes("plaster") || d.includes("render") || d.includes("putty") || d.includes("paint") || d.includes("finish") || d.includes("tile") || d.includes("flooring")) {
    return { steelWeight: 0.0, cementWeight: 0.20, masonWeight: 0.80 };
  }

  // MEP / Provisional
  if (div.includes("mep") || div.includes("provisional") || d.includes("hvac") || d.includes("electrical") || d.includes("plumbing") || d.includes("fire")) {
    return { steelWeight: 0.10, cementWeight: 0.05, masonWeight: 0.15 };
  }

  // Default: moderate sensitivity
  return { steelWeight: 0.15, cementWeight: 0.25, masonWeight: 0.30 };
}

export function computeSensitivities(lines: BOQLineItem[], basePrices: PriceOverrides): BOQLineItem[] {
  return lines.map((line) => {
    const weights = classifyMaterial(line.description, line.division);
    const materialPortion = line.materialCost / (line.totalCost || 1);

    // Sensitivity = how much totalCost changes when price changes by 1 unit
    // steel: per ₹1000/tonne change
    // cement: per ₹10/bag change
    // mason: per ₹100/day change
    return {
      ...line,
      steelSensitivity: (line.totalCost * materialPortion * weights.steelWeight) / (basePrices.steel / 1000),
      cementSensitivity: (line.totalCost * materialPortion * weights.cementWeight) / (basePrices.cement / 10),
      masonSensitivity: (line.totalCost * (1 - materialPortion) * weights.masonWeight) / (basePrices.mason / 100),
    };
  });
}

// ─── Recalculation ──────────────────────────────────────────────────────────

export function recalculateLines(
  lines: BOQLineItem[],
  basePrices: PriceOverrides,
  newPrices: PriceOverrides,
  rateOverrides: Map<string, RateOverride>
): BOQLineItem[] {
  const steelDelta = (newPrices.steel - basePrices.steel) / 1000;
  const cementDelta = (newPrices.cement - basePrices.cement) / 10;
  const masonDelta = (newPrices.mason - basePrices.mason) / 100;

  return lines.map((line) => {
    const override = rateOverrides.get(line.id);

    if (override) {
      // User manually overrode the rate — use that directly
      const ratio = override.newRate / override.originalRate;
      const newTotal = line.totalCost * ratio;
      return { ...line, unitRate: override.newRate, totalCost: newTotal };
    }

    // Apply sensitivity-based delta
    const delta =
      line.steelSensitivity * steelDelta +
      line.cementSensitivity * cementDelta +
      line.masonSensitivity * masonDelta;

    const newTotal = Math.max(0, line.totalCost + delta);
    return { ...line, totalCost: newTotal };
  });
}

export function computeTotals(lines: BOQLineItem[]): {
  totalCost: number;
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquipment: number;
} {
  let subtotalMaterial = 0;
  let subtotalLabor = 0;
  let subtotalEquipment = 0;

  for (const line of lines) {
    // Approximate split based on original ratios
    const origTotal = line.materialCost + line.laborCost + line.equipmentCost;
    if (origTotal > 0) {
      const ratio = line.totalCost / origTotal;
      subtotalMaterial += line.materialCost * ratio;
      subtotalLabor += line.laborCost * ratio;
      subtotalEquipment += line.equipmentCost * ratio;
    } else {
      subtotalMaterial += line.totalCost;
    }
  }

  return {
    totalCost: subtotalMaterial + subtotalLabor + subtotalEquipment,
    subtotalMaterial,
    subtotalLabor,
    subtotalEquipment,
  };
}

// ─── Division Classification ────────────────────────────────────────────────

export function getDivisionCategory(division: string, description: string): string {
  const d = division.toLowerCase();
  const desc = description.toLowerCase();

  if (d.includes("mep") || desc.includes("hvac") || desc.includes("electrical") || desc.includes("plumbing") || desc.includes("fire") || desc.includes("lift")) return "MEP";
  if (d.includes("part 2") || d.includes("part 3") || desc.includes("concrete") || desc.includes("rcc") || desc.includes("steel") || desc.includes("rebar") || desc.includes("column") || desc.includes("beam") || desc.includes("slab")) return "Structural";
  if (d.includes("part 4") || desc.includes("brick") || desc.includes("masonry") || desc.includes("block")) return "Structural";
  if (desc.includes("foundation") || desc.includes("footing") || desc.includes("pile") || desc.includes("excavation") || desc.includes("earthwork")) return "Foundation";
  if (desc.includes("plaster") || desc.includes("paint") || desc.includes("tile") || desc.includes("flooring") || desc.includes("finish") || desc.includes("door") || desc.includes("window") || desc.includes("glazing")) return "Finishes";
  if (desc.includes("external") || desc.includes("landscap") || desc.includes("paving") || desc.includes("drain") || desc.includes("compound") || desc.includes("boundary")) return "External";

  return "Structural";
}

// ─── Format Helpers ─────────────────────────────────────────────────────────

export function formatINR(value: number): string {
  if (value >= 10000000) {
    return `₹${(value / 10000000).toFixed(2)} Cr`;
  }
  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(2)} L`;
  }
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatINRFull(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatCrores(value: number): string {
  return (value / 10000000).toFixed(2);
}
