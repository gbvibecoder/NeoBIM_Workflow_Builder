/**
 * Phase 2.9 — Stage 5 scenario classifier.
 *
 * Decides whether it's safe to run dimension correction + adjacency
 * enforcement on top of the Phase 2.7C fidelity extraction. Conservative
 * by design: when in doubt, return `enhanceDimensions: false` and the
 * pipeline preserves Stage 4 coords unchanged.
 *
 * Gate criteria (ALL must hold for enhanceDimensions=true):
 *   - Plot is (approximately) rectangular.
 *   - Plot area lands in the "enhanceable" band
 *     (small / standard / large — not tiny or luxury).
 *   - User prompt is residential (not commercial / office / retail).
 *   - Stage 4 output shows grid-square bias (≥ 3 mixed-type rooms
 *     within ±5% of the same area).
 *   - Room count is sane (4..15 — excludes studios and mega-mansions).
 *   - Stage 1 brief is available with roomList (needed for target sizes).
 *
 * Any reason to abstain is surfaced in `reasonsForFallback` so the
 * Logs Panel / telemetry can explain why enhancement was skipped.
 */

import type {
  ArchitectBrief,
  ExtractedRooms,
  RectPx,
} from "./types";

// ─── Public types ────────────────────────────────────────────────

export type PlotSizeCategory = "tiny" | "small" | "standard" | "large" | "luxury";

export interface ScenarioClassification {
  isRectangular: boolean;
  plotSqft: number;
  plotSizeCategory: PlotSizeCategory;
  isResidential: boolean;
  hasGridSquareBias: boolean;
  roomCount: number;
  enhanceDimensions: boolean;
  reasonsForFallback: string[];
}

// ─── Configuration ───────────────────────────────────────────────

/** Plot area bands. */
const PLOT_SIZE_BOUNDS: Array<{ max: number; cat: PlotSizeCategory }> = [
  { max: 500,  cat: "tiny" },
  { max: 900,  cat: "small" },
  { max: 4000, cat: "standard" },
  { max: 7000, cat: "large" },
  { max: Infinity, cat: "luxury" },
];

/** Rectangularity tolerance: plotBounds area vs (w*h) within 5%. */
const RECT_TOLERANCE = 0.05;

/** Commercial-prompt signal words — any hit flips isResidential=false. */
const COMMERCIAL_MARKERS = [
  /\boffice\b/i,
  /\bworkstation\b/i,
  /\bmeeting\s+room\b/i,
  /\bconference\b/i,
  /\bboardroom\b/i,
  /\bcommercial\b/i,
  /\bretail\b/i,
  /\bshop\b/i,
  /\bshowroom\b/i,
  /\bwarehouse\b/i,
  /\bclinic\b/i,
  /\brestaurant\b/i,
  /\bcafe\b/i,
  /\bcafeteria\b/i,
  /\breception\b/i,
];

/** Room count band where enhancement is sensible. */
const MIN_ROOM_COUNT = 4;
const MAX_ROOM_COUNT = 15;

/** Grid-bias detection thresholds. */
const BIAS_AREA_TOLERANCE = 0.05; // rooms within ±5% of each other
const BIAS_MIN_CLUSTER_SIZE = 3;

// ─── Helpers ─────────────────────────────────────────────────────

function classifyPlotSize(plotSqft: number): PlotSizeCategory {
  if (!Number.isFinite(plotSqft) || plotSqft <= 0) return "tiny";
  for (const band of PLOT_SIZE_BOUNDS) {
    if (plotSqft < band.max) return band.cat;
  }
  return "luxury";
}

function isApproxRectangular(
  plotBoundsPx: RectPx | null,
): boolean {
  if (!plotBoundsPx) return false;
  if (plotBoundsPx.w <= 0 || plotBoundsPx.h <= 0) return false;
  // The bounding box is always a rectangle — but we reject degenerate
  // or sliver shapes by requiring a reasonable aspect ratio AND
  // positive dimensions. Callers pass `plotBoundsPx` straight from
  // Stage 4 which may have L-shape hints elsewhere (room union
  // extending beyond bbox). For Phase 2.9 we trust the bbox when
  // its aspect is within 1:4 range.
  const ratio =
    Math.max(plotBoundsPx.w, plotBoundsPx.h) /
    Math.max(1, Math.min(plotBoundsPx.w, plotBoundsPx.h));
  return ratio <= 4;
}

function isResidentialPrompt(userPrompt: string): boolean {
  if (!userPrompt) return true; // Absent prompt → default residential (safer).
  const trimmed = userPrompt.trim();
  if (trimmed.length === 0) return true;
  return !COMMERCIAL_MARKERS.some((re) => re.test(trimmed));
}

/** Normalise a type string for equal-type detection. */
function normType(t: string | undefined): string {
  return (t || "").toLowerCase().trim();
}

/**
 * Grid-square-bias detector. Returns true when ≥ 3 MIXED-TYPE rooms
 * share an area within ±5% of each other. Same-type clusters (e.g. 3
 * standard bedrooms at 120 sqft) do NOT trigger — they're expected.
 *
 * Uses the Stage 1 brief's roomList type mapping to classify each
 * extracted room; unknown types fall back to "other".
 */
function detectGridSquareBias(
  extraction: ExtractedRooms,
  brief: ArchitectBrief | undefined,
  plotWidthFt: number,
  plotDepthFt: number,
): boolean {
  const bounds = extraction.plotBoundsPx;
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return false;
  const scaleX = plotWidthFt / bounds.w;
  const scaleY = plotDepthFt / bounds.h;

  // Build a name→type map from the brief (fallback to "other").
  const typeByName = new Map<string, string>();
  for (const br of brief?.roomList ?? []) {
    typeByName.set(br.name.toLowerCase(), normType(br.type));
  }

  const rooms = extraction.rooms
    .map((r) => {
      const areaSqft =
        Math.max(0, r.rectPx.w * scaleX) * Math.max(0, r.rectPx.h * scaleY);
      const type = typeByName.get(r.name.toLowerCase()) ?? "other";
      return { name: r.name, type, areaSqft };
    })
    .filter((r) => r.areaSqft > 0);

  if (rooms.length < BIAS_MIN_CLUSTER_SIZE) return false;

  // For each room, count how many OTHER rooms (of a DIFFERENT type)
  // fall within ±5% of its area. If that count ≥ BIAS_MIN_CLUSTER_SIZE-1,
  // this room is the anchor of a mixed-type cluster → bias.
  for (const anchor of rooms) {
    let sameAreaMixed = 0;
    for (const other of rooms) {
      if (other === anchor) continue;
      if (other.type === anchor.type) continue; // same type is fine
      const ratio = other.areaSqft / anchor.areaSqft;
      if (ratio >= 1 - BIAS_AREA_TOLERANCE && ratio <= 1 + BIAS_AREA_TOLERANCE) {
        sameAreaMixed += 1;
      }
    }
    // Including the anchor itself, cluster size = sameAreaMixed + 1.
    if (sameAreaMixed + 1 >= BIAS_MIN_CLUSTER_SIZE) return true;
  }
  return false;
}

// ─── Public classifier ──────────────────────────────────────────

export interface ClassifyInput {
  extraction: ExtractedRooms;
  brief?: ArchitectBrief;
  userPrompt?: string;
  plotWidthFt: number;
  plotDepthFt: number;
}

export function classifyScenario(input: ClassifyInput): ScenarioClassification {
  const reasonsForFallback: string[] = [];

  const plotSqft = Math.max(0, input.plotWidthFt * input.plotDepthFt);
  const plotSizeCategory = classifyPlotSize(plotSqft);
  const isRectangular = isApproxRectangular(input.extraction.plotBoundsPx);
  const isResidential = isResidentialPrompt(input.userPrompt ?? "");
  const roomCount = input.extraction.rooms.length;
  const hasGridSquareBias = detectGridSquareBias(
    input.extraction,
    input.brief,
    input.plotWidthFt,
    input.plotDepthFt,
  );

  if (!isRectangular) reasonsForFallback.push("plot is not (approximately) rectangular");
  if (plotSizeCategory === "tiny") reasonsForFallback.push(`plot ${plotSqft} sqft is tiny (<500)`);
  if (plotSizeCategory === "luxury") reasonsForFallback.push(`plot ${plotSqft} sqft is luxury (>7000)`);
  if (!isResidential) reasonsForFallback.push("prompt suggests commercial / non-residential program");
  if (!hasGridSquareBias) reasonsForFallback.push("no grid-square bias detected in Stage 4 output");
  if (roomCount < MIN_ROOM_COUNT) reasonsForFallback.push(`room count ${roomCount} < ${MIN_ROOM_COUNT}`);
  if (roomCount > MAX_ROOM_COUNT) reasonsForFallback.push(`room count ${roomCount} > ${MAX_ROOM_COUNT}`);
  if (!input.brief) reasonsForFallback.push("brief not supplied — cannot look up target areas");
  if (input.brief && (input.brief.roomList?.length ?? 0) === 0)
    reasonsForFallback.push("brief roomList empty");

  const enhanceDimensions = reasonsForFallback.length === 0;

  return {
    isRectangular,
    plotSqft,
    plotSizeCategory,
    isResidential,
    hasGridSquareBias,
    roomCount,
    enhanceDimensions,
    reasonsForFallback,
  };
}
