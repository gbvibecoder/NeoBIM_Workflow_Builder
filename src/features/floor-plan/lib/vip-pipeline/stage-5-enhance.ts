/**
 * Phase 2.9 — Stage 5 dimension correction (enhancement helpers).
 *
 * For rooms that Stage 4 extracted as grid-square sizes despite the
 * Stage 1 brief specifying varied areas, resize each room around its
 * extracted center to the target area while:
 *
 *   - Preserving the original aspect ratio (w/h from Stage 4).
 *   - Keeping the room inside the plot bounds (clip if needed).
 *   - Skipping rooms the brief doesn't name (no target to hit).
 *
 * NOTE: This module doesn't decide WHEN to correct — that's the
 * classifier's job (stage-5-classifier.ts). It only computes the
 * correction when called. The caller (runStage5FidelityMode) runs
 * an overlap check on the corrected output and reverts to the
 * pre-correction state if overlaps appear.
 *
 * Design principles:
 *   - Pure. No I/O. Deterministic.
 *   - Non-destructive per room: if we can't hit the target cleanly
 *     (brief missing, expected area non-finite, zero-size original),
 *     leave the room unchanged and log it in `skipped`.
 *   - Center-preserving — the extracted position is the anchor; we
 *     only grow/shrink around that center.
 */

import type { ArchitectBrief } from "./types";
import type { Rect } from "../strip-pack/types";
import type { TransformedRoom } from "./stage-5-synthesis";

// ─── Tunables ────────────────────────────────────────────────────

/**
 * Rooms already this close (in ratio) to their target area are left
 * alone — avoids pointless 1-pixel nudges that can cascade into
 * overlaps for no real gain.
 */
const SKIP_IF_WITHIN = 0.15; // ±15%

/** Aspect-ratio clamp: don't allow degenerate skinny rectangles. */
const MIN_ASPECT = 0.4; // shortest side / longest side ≥ 0.4
const MAX_ASPECT = 2.5;

/** Minimum feet dimension a room can have after correction (code-compliance sanity). */
const MIN_DIM_FT = 4;

// ─── Public types ────────────────────────────────────────────────

export interface CorrectionRecord {
  room: string;
  originalArea: number;
  targetArea: number;
  correctedArea: number;
  action: "resized" | "skipped-close-enough" | "skipped-no-target" | "skipped-zero-size" | "clipped-to-plot";
  note?: string;
}

export interface OutOfBoundsClip {
  room: string;
  originalRect: Rect;
  clippedRect: Rect;
}

export interface DimensionCorrectionResult {
  /** Corrected room list (always the same length as input; some entries unchanged). */
  rooms: TransformedRoom[];
  /** Per-room trace for Logs Panel / telemetry. */
  applied: CorrectionRecord[];
  /** Rooms clipped because their correction pushed them outside the plot. */
  outOfBounds: OutOfBoundsClip[];
}

export interface CorrectionInput {
  /** Rooms in feet (already transformed from pixels by Stage 5). */
  rooms: TransformedRoom[];
  brief: ArchitectBrief;
  plotWidthFt: number;
  plotDepthFt: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function snap01(v: number): number {
  return Math.round(v * 10) / 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampAspectToBand(rawAspect: number): number {
  // rawAspect = w / h. Clamp to [MIN_ASPECT, MAX_ASPECT] so a
  // degenerate 20:1 extraction doesn't get re-inflated.
  if (!Number.isFinite(rawAspect) || rawAspect <= 0) return 1;
  return clamp(rawAspect, MIN_ASPECT, MAX_ASPECT);
}

function targetAreaForRoom(
  roomName: string,
  brief: ArchitectBrief,
): number | null {
  const matchName = roomName.toLowerCase();
  const entry = brief.roomList.find((r) => r.name.toLowerCase() === matchName);
  if (!entry) return null;
  if (typeof entry.approxAreaSqft !== "number" || !Number.isFinite(entry.approxAreaSqft)) return null;
  if (entry.approxAreaSqft <= 0) return null;
  return entry.approxAreaSqft;
}

function rectFromCenter(
  cx: number,
  cy: number,
  width: number,
  depth: number,
): Rect {
  return { x: cx - width / 2, y: cy - depth / 2, width, depth };
}

function clipRectToPlot(
  rect: Rect,
  plotW: number,
  plotD: number,
): Rect {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(plotW, rect.x + rect.width);
  const y1 = Math.min(plotD, rect.y + rect.depth);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    depth: Math.max(0, y1 - y0),
  };
}

function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.depth);
}

function rectEq(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.05 &&
    Math.abs(a.y - b.y) < 0.05 &&
    Math.abs(a.width - b.width) < 0.05 &&
    Math.abs(a.depth - b.depth) < 0.05
  );
}

// ─── Public: applyDimensionCorrection ────────────────────────────

export function applyDimensionCorrection(
  input: CorrectionInput,
): DimensionCorrectionResult {
  const plotW = input.plotWidthFt;
  const plotD = input.plotDepthFt;
  const applied: CorrectionRecord[] = [];
  const outOfBounds: OutOfBoundsClip[] = [];

  const rooms: TransformedRoom[] = input.rooms.map((orig) => {
    const originalRect = orig.placed;
    const originalArea = rectArea(originalRect);
    const target = targetAreaForRoom(orig.name, input.brief);

    if (target === null) {
      applied.push({
        room: orig.name,
        originalArea,
        targetArea: 0,
        correctedArea: originalArea,
        action: "skipped-no-target",
        note: "brief has no approxAreaSqft for this room",
      });
      return orig;
    }

    if (originalArea <= 0 || originalRect.width <= 0 || originalRect.depth <= 0) {
      applied.push({
        room: orig.name,
        originalArea,
        targetArea: target,
        correctedArea: originalArea,
        action: "skipped-zero-size",
      });
      return orig;
    }

    const ratio = target / originalArea;
    if (ratio >= 1 - SKIP_IF_WITHIN && ratio <= 1 + SKIP_IF_WITHIN) {
      applied.push({
        room: orig.name,
        originalArea,
        targetArea: target,
        correctedArea: originalArea,
        action: "skipped-close-enough",
      });
      return orig;
    }

    // Resize preserving center + aspect ratio (with safety clamp).
    const rawAspect = originalRect.width / originalRect.depth;
    const aspect = clampAspectToBand(rawAspect);
    let newW = Math.sqrt(target * aspect);
    let newH = Math.sqrt(target / aspect);
    // Floor on minimum dimension — bathrooms can otherwise vanish.
    newW = Math.max(MIN_DIM_FT, newW);
    newH = Math.max(MIN_DIM_FT, newH);

    const cx = originalRect.x + originalRect.width / 2;
    const cy = originalRect.y + originalRect.depth / 2;
    const resized = rectFromCenter(cx, cy, newW, newH);
    const clipped = clipRectToPlot(resized, plotW, plotD);

    const snapped: Rect = {
      x: snap01(clipped.x),
      y: snap01(clipped.y),
      width: snap01(clipped.width),
      depth: snap01(clipped.depth),
    };

    const correctedArea = rectArea(snapped);
    let action: CorrectionRecord["action"] = "resized";
    if (!rectEq(resized, clipped)) {
      action = "clipped-to-plot";
      outOfBounds.push({ room: orig.name, originalRect: resized, clippedRect: clipped });
    }

    applied.push({
      room: orig.name,
      originalArea,
      targetArea: target,
      correctedArea,
      action,
    });

    return { ...orig, placed: snapped };
  });

  return { rooms, applied, outOfBounds };
}

// ─── Overlap detection for rollback gating ───────────────────────

export interface OverlapReport {
  a: string;
  b: string;
  overlapSqft: number;
}

/**
 * Detect pairwise overlaps (by >0.5 sqft) between corrected rooms.
 * Used by the fidelity integration to decide whether to keep the
 * correction or revert to the pre-correction state.
 */
export function detectOverlaps(
  rooms: TransformedRoom[],
  thresholdSqft = 0.5,
): OverlapReport[] {
  const overlaps: OverlapReport[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const A = rooms[i].placed;
    if (!A) continue;
    for (let j = i + 1; j < rooms.length; j++) {
      const B = rooms[j].placed;
      if (!B) continue;
      const x0 = Math.max(A.x, B.x);
      const y0 = Math.max(A.y, B.y);
      const x1 = Math.min(A.x + A.width, B.x + B.width);
      const y1 = Math.min(A.y + A.depth, B.y + B.depth);
      if (x1 <= x0 || y1 <= y0) continue;
      const ov = (x1 - x0) * (y1 - y0);
      if (ov > thresholdSqft) {
        overlaps.push({ a: rooms[i].name, b: rooms[j].name, overlapSqft: ov });
      }
    }
  }
  return overlaps;
}

/** Clip every room to plot bounds (used after adjacency enforcement). */
export function clipAllToPlot(
  rooms: TransformedRoom[],
  plotW: number,
  plotD: number,
): { rooms: TransformedRoom[]; clips: OutOfBoundsClip[] } {
  const clips: OutOfBoundsClip[] = [];
  const next = rooms.map((r) => {
    const original = r.placed;
    const clipped = clipRectToPlot(original, plotW, plotD);
    if (!rectEq(original, clipped)) {
      clips.push({ room: r.name, originalRect: original, clippedRect: clipped });
      return {
        ...r,
        placed: {
          x: snap01(clipped.x),
          y: snap01(clipped.y),
          width: snap01(clipped.width),
          depth: snap01(clipped.depth),
        },
      };
    }
    return r;
  });
  return { rooms: next, clips };
}
