import type { ParsedConstraints } from "../structured-parser";
import type { FinePlacement } from "./cell-csp";
import { rectOverlaps, type Rect } from "./geometry-utils";
import { logger } from "@/lib/logger";

const SNAP_THRESHOLD_FT = 2.0;
const PERIMETER_TOL_FT = 0.5;

export interface AlignmentResult {
  placements: FinePlacement[];
  warnings: string[];
  snaps_applied: number;
}

function toRect(p: FinePlacement): Rect {
  return { x: p.x_ft, y: p.y_ft, width: p.width_ft, depth: p.depth_ft };
}

function pAsRect(p: { x_ft: number; y_ft: number; width_ft: number; depth_ft: number }): Rect {
  return { x: p.x_ft, y: p.y_ft, width: p.width_ft, depth: p.depth_ft };
}

function wouldOverlap(p: FinePlacement, others: FinePlacement[]): string | null {
  const rect = toRect(p);
  for (const o of others) {
    if (o.room_id === p.room_id) continue;
    if (rectOverlaps(rect, toRect(o))) return o.room_id;
  }
  return null;
}

function outOfPlot(p: FinePlacement, plotW: number, plotD: number): boolean {
  if (p.x_ft < -0.01) return true;
  if (p.y_ft < -0.01) return true;
  if (p.x_ft + p.width_ft > plotW + 0.01) return true;
  if (p.y_ft + p.depth_ft > plotD + 0.01) return true;
  return false;
}

/**
 * Stage 3C.1 — Snap each non-user-pinned room to its closest plot edge if within
 * SNAP_THRESHOLD_FT. Preserves H1 (no overlap) and plot bounds.
 */
function snapToPlotEdges(
  placements: FinePlacement[],
  plotW: number,
  plotD: number,
  userExplicitIds: Set<string>,
): { placements: FinePlacement[]; warnings: string[]; snaps: number } {
  const warnings: string[] = [];
  let snaps = 0;
  const result = placements.map(p => ({ ...p }));

  for (let i = 0; i < result.length; i++) {
    const p = result[i];
    if (userExplicitIds.has(p.room_id)) continue;

    const attempts: Array<{ axis: "x" | "y"; newVal: number; side: string }> = [];

    if (p.y_ft > PERIMETER_TOL_FT && p.y_ft < SNAP_THRESHOLD_FT) {
      attempts.push({ axis: "y", newVal: 0, side: "N" });
    }
    if (p.x_ft > PERIMETER_TOL_FT && p.x_ft < SNAP_THRESHOLD_FT) {
      attempts.push({ axis: "x", newVal: 0, side: "W" });
    }
    const bottom = p.y_ft + p.depth_ft;
    if (bottom < plotD - PERIMETER_TOL_FT && bottom > plotD - SNAP_THRESHOLD_FT) {
      attempts.push({ axis: "y", newVal: plotD - p.depth_ft, side: "S" });
    }
    const right = p.x_ft + p.width_ft;
    if (right < plotW - PERIMETER_TOL_FT && right > plotW - SNAP_THRESHOLD_FT) {
      attempts.push({ axis: "x", newVal: plotW - p.width_ft, side: "E" });
    }

    for (const a of attempts) {
      const prev = a.axis === "x" ? p.x_ft : p.y_ft;
      if (a.axis === "x") p.x_ft = a.newVal; else p.y_ft = a.newVal;

      if (outOfPlot(p, plotW, plotD)) {
        if (a.axis === "x") p.x_ft = prev; else p.y_ft = prev;
        warnings.push(`Snap "${p.room_name}" to ${a.side} skipped: out of plot`);
        continue;
      }
      const overlapper = wouldOverlap(p, result);
      if (overlapper) {
        if (a.axis === "x") p.x_ft = prev; else p.y_ft = prev;
        const other = result.find(r => r.room_id === overlapper);
        warnings.push(`Snap "${p.room_name}" to ${a.side} skipped: would overlap "${other?.room_name ?? overlapper}"`);
        continue;
      }
      snaps++;
    }
  }

  return { placements: result, warnings, snaps };
}

interface PriorityPair {
  room_a_id: string;
  room_b_id: string;
  user_explicit: boolean;
  attached_ensuite: boolean;
  priority: number;
}

function buildPriorityPairs(constraints: ParsedConstraints, placements: FinePlacement[]): PriorityPair[] {
  const pairs: PriorityPair[] = [];
  const areaOf = (id: string) => {
    const p = placements.find(x => x.room_id === id);
    return p ? p.width_ft * p.depth_ft : 0;
  };

  for (const adj of constraints.adjacency_pairs) {
    const isAttached = adj.relationship === "attached_ensuite";
    pairs.push({
      room_a_id: adj.room_a_id,
      room_b_id: adj.room_b_id,
      user_explicit: adj.user_explicit,
      attached_ensuite: isAttached,
      priority:
        1000 * (adj.user_explicit ? 1 : 0) +
        500 * (isAttached ? 1 : 0) +
        Math.floor(areaOf(adj.room_a_id) + areaOf(adj.room_b_id)),
    });
  }

  pairs.sort((a, b) => b.priority - a.priority);
  return pairs;
}

type PlotSide = "N" | "S" | "E" | "W";

function onSamePlotSide(a: FinePlacement, b: FinePlacement, plotW: number, plotD: number): PlotSide | null {
  if (Math.abs(a.y_ft) < PERIMETER_TOL_FT && Math.abs(b.y_ft) < PERIMETER_TOL_FT) return "N";
  if (Math.abs(a.y_ft + a.depth_ft - plotD) < PERIMETER_TOL_FT && Math.abs(b.y_ft + b.depth_ft - plotD) < PERIMETER_TOL_FT) return "S";
  if (Math.abs(a.x_ft + a.width_ft - plotW) < PERIMETER_TOL_FT && Math.abs(b.x_ft + b.width_ft - plotW) < PERIMETER_TOL_FT) return "E";
  if (Math.abs(a.x_ft) < PERIMETER_TOL_FT && Math.abs(b.x_ft) < PERIMETER_TOL_FT) return "W";
  return null;
}

function gapOnPlotSide(a: FinePlacement, b: FinePlacement, side: PlotSide): { gap: number; aFirst: boolean } {
  if (side === "N" || side === "S") {
    const aRight = a.x_ft + a.width_ft;
    const bRight = b.x_ft + b.width_ft;
    if (aRight <= b.x_ft + 0.01) return { gap: b.x_ft - aRight, aFirst: true };
    if (bRight <= a.x_ft + 0.01) return { gap: a.x_ft - bRight, aFirst: false };
    return { gap: -1, aFirst: true };
  }
  const aBottom = a.y_ft + a.depth_ft;
  const bBottom = b.y_ft + b.depth_ft;
  if (aBottom <= b.y_ft + 0.01) return { gap: b.y_ft - aBottom, aFirst: true };
  if (bBottom <= a.y_ft + 0.01) return { gap: a.y_ft - bBottom, aFirst: false };
  return { gap: -1, aFirst: true };
}

/**
 * Stage 3C.2 — Close small gaps between rooms on the same plot side.
 * Each snap moves the non-user-pinned room; user-pinned rooms never move.
 * Validates against H1 (no overlap), plot bounds; on violation, try inverse;
 * on double failure, log warning and leave gap.
 */
function snapInterRoomGaps(
  placements: FinePlacement[],
  priorityPairs: PriorityPair[],
  plotW: number,
  plotD: number,
  userExplicitIds: Set<string>,
): { placements: FinePlacement[]; warnings: string[]; snaps: number } {
  const warnings: string[] = [];
  let snaps = 0;
  const result = placements.map(p => ({ ...p }));
  const byId = new Map(result.map(p => [p.room_id, p]));

  // Also consider structural neighbors (rooms on same plot side even without
  // parsed adjacency_pair)
  const allPairs: Array<{ a: string; b: string; priority: number }> = priorityPairs.map(p => ({
    a: p.room_a_id, b: p.room_b_id, priority: p.priority,
  }));
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const A = result[i], B = result[j];
      if (allPairs.some(p => (p.a === A.room_id && p.b === B.room_id) || (p.a === B.room_id && p.b === A.room_id))) continue;
      if (onSamePlotSide(A, B, plotW, plotD)) {
        allPairs.push({ a: A.room_id, b: B.room_id, priority: Math.floor(A.width_ft * A.depth_ft + B.width_ft * B.depth_ft) });
      }
    }
  }
  allPairs.sort((x, y) => y.priority - x.priority);

  for (const pair of allPairs) {
    const A = byId.get(pair.a);
    const B = byId.get(pair.b);
    if (!A || !B) continue;
    const side = onSamePlotSide(A, B, plotW, plotD);
    if (!side) continue;
    const { gap, aFirst } = gapOnPlotSide(A, B, side);
    if (gap <= 0.01 || gap > SNAP_THRESHOLD_FT) continue;

    // Prefer moving the non-user-pinned room closer to the other
    const aPinned = userExplicitIds.has(A.room_id);
    const bPinned = userExplicitIds.has(B.room_id);
    if (aPinned && bPinned) {
      warnings.push(`Gap ${gap.toFixed(1)}ft between "${A.room_name}" and "${B.room_name}" on ${side} wall — both user-pinned, skipped`);
      continue;
    }

    const others = result.filter(r => r.room_id !== A.room_id && r.room_id !== B.room_id);
    const mover = aPinned ? B : A;
    const anchor = aPinned ? A : B;
    const prevX = mover.x_ft;
    const prevY = mover.y_ft;

    if (side === "N" || side === "S") {
      const anchorRight = anchor.x_ft + anchor.width_ft;
      if (mover.x_ft > anchorRight - 0.01) {
        mover.x_ft = anchorRight;
      } else {
        mover.x_ft = anchor.x_ft - mover.width_ft;
      }
    } else {
      const anchorBottom = anchor.y_ft + anchor.depth_ft;
      if (mover.y_ft > anchorBottom - 0.01) {
        mover.y_ft = anchorBottom;
      } else {
        mover.y_ft = anchor.y_ft - mover.depth_ft;
      }
    }

    if (outOfPlot(mover, plotW, plotD) || wouldOverlap(mover, [...others, anchor])) {
      mover.x_ft = prevX;
      mover.y_ft = prevY;

      // Try inverse: move anchor toward mover if anchor is not user-pinned
      const inversePinned = mover === A ? bPinned : aPinned;
      if (!inversePinned) {
        const altMover = mover === A ? B : A;
        const altAnchor = mover === A ? A : B;
        const altPrevX = altMover.x_ft;
        const altPrevY = altMover.y_ft;
        if (side === "N" || side === "S") {
          if (altMover.x_ft + altMover.width_ft < altAnchor.x_ft) altMover.x_ft = altAnchor.x_ft - altMover.width_ft;
          else altMover.x_ft = altAnchor.x_ft + altAnchor.width_ft;
        } else {
          if (altMover.y_ft + altMover.depth_ft < altAnchor.y_ft) altMover.y_ft = altAnchor.y_ft - altMover.depth_ft;
          else altMover.y_ft = altAnchor.y_ft + altAnchor.depth_ft;
        }
        if (outOfPlot(altMover, plotW, plotD) || wouldOverlap(altMover, [...others, altAnchor])) {
          altMover.x_ft = altPrevX;
          altMover.y_ft = altPrevY;
          warnings.push(`Gap ${gap.toFixed(1)}ft between "${A.room_name}" and "${B.room_name}" on ${side} wall — inverse snap failed (overlap)`);
          continue;
        }
        snaps++;
        continue;
      }

      warnings.push(`Gap ${gap.toFixed(1)}ft between "${A.room_name}" and "${B.room_name}" on ${side} wall — snap skipped`);
      continue;
    }

    snaps++;
  }

  return { placements: result, warnings, snaps };
}

/**
 * Stage 3C public entry. Snaps Stage 3B placements toward plot edges and
 * closes small inter-room gaps on shared plot sides. Preserves user-pinned
 * rooms, H1 no-overlap, and plot bounds.
 */
export function alignBoundaries(
  placements: FinePlacement[],
  constraints: ParsedConstraints,
  plotW: number,
  plotD: number,
): AlignmentResult {
  const userExplicitIds = new Set<string>(
    constraints.rooms.filter(r => r.user_explicit_position).map(r => r.id),
  );

  const allWarnings: string[] = [];
  let totalSnaps = 0;

  const plotSnap = snapToPlotEdges(placements, plotW, plotD, userExplicitIds);
  totalSnaps += plotSnap.snaps;
  allWarnings.push(...plotSnap.warnings);

  const priorityPairs = buildPriorityPairs(constraints, plotSnap.placements);
  const neighborSnap = snapInterRoomGaps(plotSnap.placements, priorityPairs, plotW, plotD, userExplicitIds);
  totalSnaps += neighborSnap.snaps;
  allWarnings.push(...neighborSnap.warnings);

  logger.debug(`[CSP-3C] boundary alignment: ${totalSnaps} snaps, ${allWarnings.length} warnings`);

  return {
    placements: neighborSnap.placements,
    warnings: allWarnings,
    snaps_applied: totalSnaps,
  };
}
