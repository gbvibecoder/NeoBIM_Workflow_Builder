// ─── Seasonal Cost Adjustment Engine ─────────────────────────────────────────
// Computes effective cost multipliers based on seasonal construction conditions.
//
// KEY INSIGHT: Standard BOQ rates don't change by season (a brick costs the same
// in July as January). What changes is PRODUCTIVITY — during monsoon, you need
// more labor-days to accomplish the same work, so effective cost per unit rises.
//
// This module computes the "effective cost multiplier" which represents:
//   - Labor: 1/productivity (e.g., productivity 0.72 → multiplier 1.39 → 39% more labor cost)
//   - Equipment: direct premium (crane rates go up in rain)
//   - Material: transport premium only (not base price)
//
// The adjustment is applied as a TRANSPARENT layer — always shown in metadata,
// always explained to the user, never hidden.

import {
  getSeasonalFactor,
  type SeasonalFactor,
} from "@/features/boq/constants/indian-pricing-factors";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SeasonalAdjustment {
  /** Whether any adjustment was applied */
  applied: boolean;

  /** Month used for calculation (1-12) */
  month: number;

  /** Month name for display */
  monthName: string;

  /** State used for climate zone lookup */
  state: string;

  /** Climate zone */
  climateZone: "heavy_monsoon" | "moderate";

  /** Effective labor cost multiplier (>1 means costlier due to low productivity) */
  laborMultiplier: number;

  /** Material transport premium multiplier */
  materialTransportMultiplier: number;

  /** Equipment rate multiplier */
  equipmentMultiplier: number;

  /** Weighted overall impact on total cost (approximate) */
  overallImpactPercent: number;

  /** Raw seasonal factor data */
  rawFactor: SeasonalFactor;

  /** Human-readable description */
  description: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Approximate cost breakdown for impact calculation:
// Labor is ~35% of hard cost, material ~55%, equipment ~10%
const LABOR_SHARE = 0.35;
const MATERIAL_SHARE = 0.55;
const EQUIPMENT_SHARE = 0.10;

const HEAVY_MONSOON_STATES = new Set([
  "Maharashtra", "Gujarat", "Goa", "Karnataka", "Kerala", "Tamil Nadu",
  "Andhra Pradesh", "Telangana", "West Bengal", "Odisha",
  "Assam", "Meghalaya", "Manipur", "Mizoram", "Tripura", "Nagaland",
  "Arunachal Pradesh", "Sikkim",
]);

// ── Core Function ────────────────────────────────────────────────────────────

/**
 * Compute seasonal cost adjustment for a given state and month.
 *
 * @param state - Indian state name
 * @param month - Month number (1-12). Defaults to current month.
 * @returns Adjustment multipliers and metadata
 */
export function computeSeasonalAdjustment(
  state: string,
  month?: number,
): SeasonalAdjustment {
  const m = month ?? new Date().getMonth() + 1;
  const factor = getSeasonalFactor(state, m);
  const climateZone = HEAVY_MONSOON_STATES.has(state) ? "heavy_monsoon" : "moderate";

  // Labor: inverse of productivity (lower productivity → higher effective cost)
  // Capped at 1.50× to avoid extreme adjustments
  const laborMultiplier = factor.laborProductivity > 0
    ? Math.min(1.50, 1.0 / factor.laborProductivity)
    : 1.0;

  // Material: transport premium from demand spike (NOT base price change)
  // Only the demand-driven transport premium applies, capped conservatively
  const materialTransportMultiplier = factor.materialDemand;

  // Equipment: direct premium
  const equipmentMultiplier = factor.equipmentPremium;

  // Weighted overall impact
  const laborImpact = (laborMultiplier - 1.0) * LABOR_SHARE;
  const materialImpact = (materialTransportMultiplier - 1.0) * MATERIAL_SHARE;
  const equipmentImpact = (equipmentMultiplier - 1.0) * EQUIPMENT_SHARE;
  const overallImpactPercent = Math.round((laborImpact + materialImpact + equipmentImpact) * 1000) / 10;

  // Is this a meaningful adjustment? (>2% impact)
  const isSignificant = Math.abs(overallImpactPercent) > 2;

  // Build description
  let description: string;
  if (!isSignificant) {
    description = `${MONTH_NAMES[m - 1]} — ${factor.notes}. No significant seasonal cost impact.`;
  } else if (overallImpactPercent > 0) {
    description = `${MONTH_NAMES[m - 1]} — ${factor.notes}. ` +
      `Estimated +${overallImpactPercent.toFixed(1)}% cost impact: ` +
      `labor productivity at ${(factor.laborProductivity * 100).toFixed(0)}%` +
      (equipmentMultiplier > 1.02 ? `, equipment premium +${((equipmentMultiplier - 1) * 100).toFixed(0)}%` : "") +
      ".";
  } else {
    description = `${MONTH_NAMES[m - 1]} — ${factor.notes}. Favorable conditions, slight cost reduction.`;
  }

  return {
    applied: isSignificant,
    month: m,
    monthName: MONTH_NAMES[m - 1],
    state,
    climateZone,
    laborMultiplier: Math.round(laborMultiplier * 1000) / 1000,
    materialTransportMultiplier: Math.round(materialTransportMultiplier * 1000) / 1000,
    equipmentMultiplier: Math.round(equipmentMultiplier * 1000) / 1000,
    overallImpactPercent,
    rawFactor: factor,
    description,
  };
}

/**
 * Apply seasonal adjustment to individual cost components.
 * Returns adjusted costs with multipliers applied.
 *
 * @param materialCost - Base material cost
 * @param laborCost - Base labor cost
 * @param equipmentCost - Base equipment cost
 * @param adjustment - Seasonal adjustment from computeSeasonalAdjustment()
 */
export function applySeasonalToCosts(
  materialCost: number,
  laborCost: number,
  equipmentCost: number,
  adjustment: SeasonalAdjustment,
): {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  totalCost: number;
  totalDelta: number;
} {
  if (!adjustment.applied) {
    const total = materialCost + laborCost + equipmentCost;
    return { materialCost, laborCost, equipmentCost, totalCost: total, totalDelta: 0 };
  }

  const adjMaterial = materialCost * adjustment.materialTransportMultiplier;
  const adjLabor = laborCost * adjustment.laborMultiplier;
  const adjEquipment = equipmentCost * adjustment.equipmentMultiplier;
  const totalCost = adjMaterial + adjLabor + adjEquipment;
  const originalTotal = materialCost + laborCost + equipmentCost;

  return {
    materialCost: Math.round(adjMaterial),
    laborCost: Math.round(adjLabor),
    equipmentCost: Math.round(adjEquipment),
    totalCost: Math.round(totalCost),
    totalDelta: Math.round(totalCost - originalTotal),
  };
}
