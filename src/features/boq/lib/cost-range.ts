// ─── Cost Range Estimation Engine ────────────────────────────────────────────
// Converts point estimates into honest ranges based on per-line confidence.
//
// Current output: "Total: ₹8.95 Cr" (implies false precision)
// Target output: "Total: ₹7.2 — ₹10.7 Cr (best: ₹8.95 Cr)"
//
// The key insight: individual line uncertainties don't simply add up.
// A portfolio of 100 line items with ±25% uncertainty each has LESS than ±25%
// total uncertainty because errors partially cancel (diversification effect).

import type { BOQLineItem } from "@/features/boq/components/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CostRange {
  low: number;
  high: number;
  best: number;
  uncertaintyPercent: number;
}

export interface BOQCostRangeSummary {
  /** Total project cost range */
  total: CostRange;
  /** Hard costs range only */
  hardCosts: CostRange;
  /** Confidence distribution */
  confidenceBreakdown: {
    highCount: number;
    mediumCount: number;
    lowCount: number;
    highPercent: number;
    mediumPercent: number;
    lowPercent: number;
  };
  /** AACE class description */
  aaceDescription: string;
}

// ── AACE Classification Descriptions ─────────────────────────────────────────

const AACE_DESCRIPTIONS: Record<string, string> = {
  "Class 1": "Check estimate / bid validation — accuracy ±3-5%. Requires complete design documentation.",
  "Class 2": "Bid / tender estimate — accuracy ±5-15%. Requires detailed design and specifications.",
  "Class 3": "Budget authorization — accuracy ±10-20%. Requires preliminary design.",
  "Class 3-4": "Preliminary to budget estimate — accuracy ±15-25%. Design in progress.",
  "Class 4": "Feasibility study — accuracy ±25-30%. Suitable for early-stage cost planning only.",
  "Class 5": "Concept screening — accuracy ±30-50%. Order-of-magnitude estimate.",
};

export function getAACEDescription(aaceClass: string | undefined): string {
  if (!aaceClass) return AACE_DESCRIPTIONS["Class 4"];
  return AACE_DESCRIPTIONS[aaceClass] ?? AACE_DESCRIPTIONS["Class 4"];
}

// ── Per-Line Range Calculation ───────────────────────────────────────────────

/**
 * Calculate cost range for a single line item based on its confidence score.
 * Higher confidence = tighter range.
 */
export function calculateLineRange(pointEstimate: number, confidence: number): CostRange {
  // Confidence → uncertainty band mapping
  // Aligned with AACE recommended practice 18R-97
  const uncertaintyPercent = confidence >= 95 ? 5
    : confidence >= 80 ? 15
    : confidence >= 60 ? 25
    : confidence >= 40 ? 40
    : 60;

  return {
    low: Math.round(pointEstimate * (1 - uncertaintyPercent / 100)),
    high: Math.round(pointEstimate * (1 + uncertaintyPercent / 100)),
    best: Math.round(pointEstimate),
    uncertaintyPercent,
  };
}

// ── Total BOQ Range Calculation ──────────────────────────────────────────────

/**
 * Calculate aggregate cost range for the entire BOQ.
 * Uses diversification factor — sum of individual ranges over-estimates total uncertainty.
 *
 * @param lines - BOQ line items with confidence scores
 * @param softCostRatio - Soft costs as ratio of hard costs (e.g., 0.44 for 44%)
 */
export function calculateBOQRange(
  lines: BOQLineItem[],
  softCostRatio: number = 0,
): BOQCostRangeSummary {
  if (lines.length === 0) {
    return {
      total: { low: 0, high: 0, best: 0, uncertaintyPercent: 0 },
      hardCosts: { low: 0, high: 0, best: 0, uncertaintyPercent: 0 },
      confidenceBreakdown: {
        highCount: 0, mediumCount: 0, lowCount: 0,
        highPercent: 0, mediumPercent: 0, lowPercent: 0,
      },
      aaceDescription: getAACEDescription("Class 4"),
    };
  }

  // Sum individual ranges
  let sumBest = 0;
  let sumLow = 0;
  let sumHigh = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const line of lines) {
    const range = calculateLineRange(line.totalCost, line.confidence);
    sumBest += range.best;
    sumLow += range.low;
    sumHigh += range.high;

    if (line.confidence >= 80) highCount++;
    else if (line.confidence >= 55) mediumCount++;
    else lowCount++;
  }

  // Diversification factor: individual errors partially cancel out
  // More items = more cancellation. Factor ranges from 0.70 (few items) to 0.55 (many items)
  const n = lines.length;
  const diversificationFactor = Math.max(0.55, 0.85 - Math.log10(Math.max(n, 1)) * 0.12);

  // Apply diversification to the spread (not the best estimate)
  const rawSpreadLow = sumBest - sumLow;
  const rawSpreadHigh = sumHigh - sumBest;
  const adjustedLow = Math.round(sumBest - rawSpreadLow * diversificationFactor);
  const adjustedHigh = Math.round(sumBest + rawSpreadHigh * diversificationFactor);

  const hardCosts: CostRange = {
    low: adjustedLow,
    high: adjustedHigh,
    best: Math.round(sumBest),
    uncertaintyPercent: sumBest > 0
      ? Math.round(((adjustedHigh - adjustedLow) / (2 * sumBest)) * 100)
      : 0,
  };

  // Total = hard costs + soft costs (proportional)
  const totalMultiplier = 1 + softCostRatio;
  const total: CostRange = {
    low: Math.round(hardCosts.low * totalMultiplier),
    high: Math.round(hardCosts.high * totalMultiplier),
    best: Math.round(hardCosts.best * totalMultiplier),
    uncertaintyPercent: hardCosts.uncertaintyPercent,
  };

  const totalLines = lines.length;

  return {
    total,
    hardCosts,
    confidenceBreakdown: {
      highCount,
      mediumCount,
      lowCount,
      highPercent: Math.round((highCount / totalLines) * 100),
      mediumPercent: Math.round((mediumCount / totalLines) * 100),
      lowPercent: Math.round((lowCount / totalLines) * 100),
    },
    aaceDescription: getAACEDescription(undefined), // caller should pass actual class
  };
}

// ── Format Helpers ───────────────────────────────────────────────────────────

/** @remarks Used in tests — not yet wired to production UI */
export function formatRangeINR(range: CostRange): string {
  const fmt = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
    return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  };
  return `${fmt(range.low)} — ${fmt(range.high)}`;
}
