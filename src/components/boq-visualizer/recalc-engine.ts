// ─── BOQ Recalculation Engine ───────────────────────────────────────────────
// Pre-calculates sensitivity coefficients so price slider changes are instant.

import type { BOQLineItem, PriceOverrides, RateOverride } from "@/components/boq-visualizer/types";

// Default base prices (used to compute deltas)
export const DEFAULT_PRICES: PriceOverrides = {
  steel: 72000, // ₹/tonne
  cement: 390,  // ₹/bag
  mason: 800,   // ₹/day
  bricks: 8,    // ₹/nos
  sand: 80,     // ₹/cft
  timber: 1200, // ₹/m²
};

export const PRICE_RANGES = {
  steel:  { min: 50000, max: 80000, step: 500,  unit: "₹/tonne" },
  cement: { min: 300,   max: 550,   step: 5,    unit: "₹/bag" },
  mason:  { min: 400,   max: 1400,  step: 25,   unit: "₹/day" },
  bricks: { min: 5,     max: 15,    step: 0.5,  unit: "₹/nos" },
  sand:   { min: 40,    max: 150,   step: 5,    unit: "₹/cft" },
  timber: { min: 800,   max: 2000,  step: 50,   unit: "₹/m²" },
} as const;

// ─── Sensitivity Computation ────────────────────────────────────────────────

interface MaterialWeights {
  steelWeight: number;
  cementWeight: number;
  masonWeight: number;
  bricksWeight: number;
  sandWeight: number;
  timberWeight: number;
}

function classifyMaterial(desc: string, division: string): MaterialWeights {
  const d = desc.toLowerCase();
  const div = division.toLowerCase();

  // Steel-heavy items
  if (d.includes("steel") || d.includes("rebar") || d.includes("reinforcement") || d.includes("railing")) {
    return { steelWeight: 0.80, cementWeight: 0.03, masonWeight: 0.07, bricksWeight: 0.0, sandWeight: 0.05, timberWeight: 0.05 };
  }

  // Concrete items (cement + steel rebar + sand + formwork)
  if (d.includes("concrete") || d.includes("rcc") || d.includes("slab") || d.includes("beam") || d.includes("column") || d.includes("footing") || d.includes("foundation")) {
    return { steelWeight: 0.25, cementWeight: 0.30, masonWeight: 0.15, bricksWeight: 0.0, sandWeight: 0.15, timberWeight: 0.15 };
  }

  // Masonry/brickwork
  if (d.includes("brick") || d.includes("masonry") || d.includes("block") || d.includes("wall") || div.includes("part 4") || div.includes("masonry")) {
    return { steelWeight: 0.0, cementWeight: 0.20, masonWeight: 0.40, bricksWeight: 0.25, sandWeight: 0.10, timberWeight: 0.05 };
  }

  // Plastering/finishing
  if (d.includes("plaster") || d.includes("render") || d.includes("putty") || d.includes("paint") || d.includes("finish") || d.includes("tile") || d.includes("flooring")) {
    return { steelWeight: 0.0, cementWeight: 0.15, masonWeight: 0.55, bricksWeight: 0.0, sandWeight: 0.20, timberWeight: 0.10 };
  }

  // Formwork/carpentry
  if (d.includes("formwork") || d.includes("shuttering") || d.includes("door") || d.includes("window") || d.includes("carpent") || d.includes("timber")) {
    return { steelWeight: 0.05, cementWeight: 0.0, masonWeight: 0.25, bricksWeight: 0.0, sandWeight: 0.0, timberWeight: 0.70 };
  }

  // MEP / Provisional
  if (div.includes("mep") || div.includes("provisional") || d.includes("hvac") || d.includes("electrical") || d.includes("plumbing") || d.includes("fire")) {
    return { steelWeight: 0.08, cementWeight: 0.03, masonWeight: 0.10, bricksWeight: 0.0, sandWeight: 0.02, timberWeight: 0.02 };
  }

  // Default: moderate sensitivity
  return { steelWeight: 0.12, cementWeight: 0.18, masonWeight: 0.25, bricksWeight: 0.05, sandWeight: 0.10, timberWeight: 0.10 };
}

export function computeSensitivities(lines: BOQLineItem[], basePrices: PriceOverrides): BOQLineItem[] {
  return lines.map((line) => {
    const weights = classifyMaterial(line.description, line.division);
    const materialPortion = line.materialCost / (line.totalCost || 1);
    const laborPortion = 1 - materialPortion;

    return {
      ...line,
      steelSensitivity: (line.totalCost * materialPortion * weights.steelWeight) / (basePrices.steel / 1000),
      cementSensitivity: (line.totalCost * materialPortion * weights.cementWeight) / (basePrices.cement / 10),
      masonSensitivity: (line.totalCost * laborPortion * weights.masonWeight) / (basePrices.mason / 100),
      bricksSensitivity: (line.totalCost * materialPortion * weights.bricksWeight) / (basePrices.bricks / 1),
      sandSensitivity: (line.totalCost * materialPortion * weights.sandWeight) / (basePrices.sand / 10),
      timberSensitivity: (line.totalCost * materialPortion * weights.timberWeight) / (basePrices.timber / 100),
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
  const bricksDelta = (newPrices.bricks - basePrices.bricks) / 1;
  const sandDelta = (newPrices.sand - basePrices.sand) / 10;
  const timberDelta = (newPrices.timber - basePrices.timber) / 100;

  return lines.map((line) => {
    const override = rateOverrides.get(line.id);

    if (override) {
      const ratio = override.newRate / override.originalRate;
      const newTotal = line.totalCost * ratio;
      return { ...line, unitRate: override.newRate, totalCost: newTotal };
    }

    const delta =
      line.steelSensitivity * steelDelta +
      line.cementSensitivity * cementDelta +
      line.masonSensitivity * masonDelta +
      line.bricksSensitivity * bricksDelta +
      line.sandSensitivity * sandDelta +
      line.timberSensitivity * timberDelta;

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
