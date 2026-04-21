/**
 * Phase 2.4 P0-A — municipality-aware building setbacks.
 *
 * Indian urban bylaws require front/side/rear setbacks between the plot
 * line and the building's exterior wall. Values below are published
 * defaults; real permits can vary by road width, plot size, and floor
 * count — this table covers the common residential case.
 *
 * Sources (see phase-2-3-5-geometry-audit.md §V.9 for citations):
 *   Bengaluru BBMP / BDA 2025, Mumbai DCPR 2034, Delhi DDA 100–250 m²,
 *   Pune PMC, Hyderabad GHMC.
 */

export interface SetbackRule {
  front: number; // feet
  side: number; // feet (symmetric left/right)
  rear: number; // feet
}

export const SETBACK_TABLE: Record<string, SetbackRule> = {
  DEFAULT: { front: 3, side: 2, rear: 3 },
  MUMBAI: { front: 9.8, side: 4.9, rear: 9.8 },
  BENGALURU_SMALL: { front: 5, side: 2.5, rear: 5 }, // plot ≤30×40 ≈ 1200 sqft
  BENGALURU_LARGE: { front: 10, side: 5, rear: 10 }, // plot >1200 sqft
  DELHI_DDA: { front: 9.8, side: 6.6, rear: 9.8 }, // 100–250 m² plots
  PUNE: { front: 6.5, side: 3.3, rear: 6.5 },
  HYDERABAD: { front: 5, side: 3, rear: 5 },
};

/**
 * Resolve the applicable setback rule for a plot.
 *
 * Unknown/unset municipality → DEFAULT.
 * Bengaluru/Bangalore splits on plot area (1200 sqft threshold).
 */
export function resolveSetback(
  municipality: string | undefined,
  plotWidthFt: number,
  plotDepthFt: number,
): SetbackRule {
  if (!municipality) return SETBACK_TABLE.DEFAULT;
  const key = municipality.toUpperCase().trim();
  if (key === "BENGALURU" || key === "BANGALORE") {
    return plotWidthFt * plotDepthFt <= 1200
      ? SETBACK_TABLE.BENGALURU_SMALL
      : SETBACK_TABLE.BENGALURU_LARGE;
  }
  return SETBACK_TABLE[key] ?? SETBACK_TABLE.DEFAULT;
}

/**
 * Feature flag for Phase 2.4 P0-A rollout.
 *
 * Default OFF — only applies setbacks when PHASE_2_4_SETBACKS=true.
 * This lets us ship the code, deploy to preview, eyeball the output,
 * and flip in production without a redeploy.
 */
export function setbacksEnabled(): boolean {
  return process.env.PHASE_2_4_SETBACKS === "true";
}

/**
 * Compute the usable building envelope after setbacks.
 *
 * Returns:
 *   - inset rect (originX, originY, usableWidth, usableDepth)
 *   - the setback rule applied (for metadata logging)
 *
 * Safe fallback: if the plot is too small to accommodate even the
 * DEFAULT setbacks (usable area would be <=0 on either axis), returns
 * a zero-setback result so synthesis still produces output. Caller
 * should push a warning in that case.
 */
export interface SetbackEnvelope {
  originX: number;
  originY: number;
  usableWidthFt: number;
  usableDepthFt: number;
  rule: SetbackRule;
  applied: boolean;
  fallbackReason?: string;
}

export function computeEnvelope(
  plotWidthFt: number,
  plotDepthFt: number,
  municipality: string | undefined,
): SetbackEnvelope {
  if (!setbacksEnabled()) {
    return {
      originX: 0,
      originY: 0,
      usableWidthFt: plotWidthFt,
      usableDepthFt: plotDepthFt,
      rule: { front: 0, side: 0, rear: 0 },
      applied: false,
    };
  }

  const rule = resolveSetback(municipality, plotWidthFt, plotDepthFt);
  const usableWidthFt = plotWidthFt - rule.side * 2;
  const usableDepthFt = plotDepthFt - rule.front - rule.rear;

  if (usableWidthFt <= 0 || usableDepthFt <= 0) {
    return {
      originX: 0,
      originY: 0,
      usableWidthFt: plotWidthFt,
      usableDepthFt: plotDepthFt,
      rule: { front: 0, side: 0, rear: 0 },
      applied: false,
      fallbackReason: `Plot ${plotWidthFt}×${plotDepthFt}ft too small for ${rule.front}/${rule.side}/${rule.rear} setback — falling back to no setback`,
    };
  }

  return {
    originX: rule.side,
    originY: rule.rear,
    usableWidthFt,
    usableDepthFt,
    rule,
    applied: true,
  };
}
