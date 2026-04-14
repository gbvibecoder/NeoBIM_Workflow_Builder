// ─── BOQ Quality & Confidence Thresholds ────────────────────────────────────
// Single source of truth for ALL threshold values across the BOQ visualizer.
// Before this file, 4 components used 2 different threshold sets.

// ── Line-level confidence ────────────────────────────────────────────────────
// Used for individual BOQ line items (BOQTable, parse-artifact, etc.)
// Based on data quality: HIGH = measured from IFC, MEDIUM = derived/estimated, LOW = provisional/fallback

export const LINE_CONFIDENCE = {
  HIGH: 80,   // score >= 80 → high confidence
  MEDIUM: 55, // score >= 55 → medium confidence
  // score < 55 → low confidence
} as const;

export type ConfidenceScore = "high" | "medium" | "low";

export function getLineConfidenceScore(numericConfidence: number): ConfidenceScore {
  if (numericConfidence >= LINE_CONFIDENCE.HIGH) return "high";
  if (numericConfidence >= LINE_CONFIDENCE.MEDIUM) return "medium";
  return "low";
}

export function getLineConfidenceColor(score: ConfidenceScore): string {
  switch (score) {
    case "high": return "#22C55E";
    case "medium": return "#F59E0B";
    case "low": return "#EF4444";
  }
}

// ── IFC model quality score ──────────────────────────────────────────────────
// Used for overall IFC model quality (HeroStats, IFCQualityCard)
// Aligned with TR-008 server-side thresholds

export const IFC_QUALITY = {
  EXCELLENT: 85, // score > 85
  GOOD: 65,      // score > 65
  FAIR: 40,      // score > 40
  // score <= 40 → LIMITED
} as const;

export type IFCQualityLabel = "EXCELLENT" | "GOOD" | "FAIR" | "LIMITED";

export function getIFCQualityLabel(score: number): IFCQualityLabel {
  if (score > IFC_QUALITY.EXCELLENT) return "EXCELLENT";
  if (score > IFC_QUALITY.GOOD) return "GOOD";
  if (score > IFC_QUALITY.FAIR) return "FAIR";
  return "LIMITED";
}

export function getIFCQualityColor(score: number): string {
  if (score > IFC_QUALITY.EXCELLENT) return "#22C55E";
  if (score > IFC_QUALITY.GOOD) return "#00F5FF";
  if (score > IFC_QUALITY.FAIR) return "#F59E0B";
  return "#EF4444";
}

// ── Confidence level (for BOQ overall) ───────────────────────────────────────
// Used by parse-artifact.ts to derive overall BOQ confidence from IFC quality

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export function getConfidenceLevelFromIFCScore(score: number): ConfidenceLevel {
  if (score >= LINE_CONFIDENCE.HIGH) return "HIGH";
  if (score >= LINE_CONFIDENCE.MEDIUM) return "MEDIUM";
  return "LOW";
}
