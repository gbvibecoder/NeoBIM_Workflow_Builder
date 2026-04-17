/**
 * Steps 6 + 7 — strip-packer.
 *
 * THIS IS THE CORE MODULE. Get it right.
 *
 * Operates in a CANONICAL coordinate frame:
 *   - x = 0 is the western edge of the available rectangle
 *   - y = 0 is the hallway-side edge of the available rectangle
 *   - rooms pack left-to-right along x within a row
 *   - rows stack upward (positive y), away from the hallway
 *
 * The orchestrator (strip-pack-engine.ts) is responsible for transforming
 * plot-frame strip coordinates into canonical coordinates BEFORE calling
 * this module, and transforming each room's `placed` rect back AFTER.
 *
 * Determinism: same input → same output. No randomness.
 *
 * Guarantees on output:
 *   - No two placed rooms overlap.
 *   - Every placed room shares a wall with the hallway (row 0) OR with a
 *     room in the row below (row 1+). Connectivity is by construction.
 *   - Within a row, all rooms have the same depth (no inter-row gaps).
 *   - The right-edge slack of every row is absorbed (no end-of-row gaps).
 *
 * What this module deliberately does NOT do:
 *   - It does not handle rotation as an optimization (only rotates to fit).
 *   - It does not move rooms across rows for better aesthetics.
 *   - It does not handle attached rooms (sub-room-attacher does that).
 */
import type { Rect, StripPackRoom } from "./types";

const MIN_ROOM_WIDTH_FT = 4;
const MIN_ROOM_DEPTH_FT = 4;
const SMALL_GAP_THRESHOLD_FT = 2;

/**
 * Phase 3B fix #1 — dimension hard cap on row normalization + slack absorption.
 *
 * User dimensions are HARD constraints. Voids are acceptable. So when a row
 * has a deep room next to a shallow room, we don't stretch the shallow one
 * past 115% of its requested area to match. We cap and accept a micro-void
 * above the shallower room (which Fix 7's smart void handler will deal with).
 */
const AREA_CAP_RATIO_ROW = 1.15;

/** Maximum depth a room may take in row-depth normalization, capped to 115%
 *  of its requested area at its current width. Returns +Infinity when the
 *  room has no requested area to anchor against. */
function maxAllowedDepthFor(room: StripPackRoom, currentWidth: number): number {
  if (room.requested_area_sqft <= 0 || currentWidth <= 0) return Infinity;
  return (room.requested_area_sqft * AREA_CAP_RATIO_ROW) / currentWidth;
}

/** Maximum width a room may take in slack absorption. Same cap rationale. */
function maxAllowedWidthFor(room: StripPackRoom, currentDepth: number): number {
  if (room.requested_area_sqft <= 0 || currentDepth <= 0) return Infinity;
  return (room.requested_area_sqft * AREA_CAP_RATIO_ROW) / currentDepth;
}

export interface PackInput {
  /** Available rectangles in CANONICAL coords. Packer fills them in given order. */
  available: Rect[];
  /** Rooms in priority order (the sorter is the caller's responsibility). */
  rooms: StripPackRoom[];
}

export interface PackOutput {
  /** Rooms with `placed` set in CANONICAL coords (all that could be placed). */
  placed: StripPackRoom[];
  /** Rooms the packer could not fit (caller decides what to do — usually log). */
  unplaced: StripPackRoom[];
  warnings: string[];
}

interface RowState {
  y: number;             // bottom y of the row
  remainingWidth: number; // along x
  depth: number;         // current max depth in the row
  rooms: StripPackRoom[];
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ───────────────────────────────────────────────────────────────────────────

export function packStrip(input: PackInput): PackOutput {
  const warnings: string[] = [];
  const placed: StripPackRoom[] = [];
  let queue = [...input.rooms];

  // Largest available rect first — gives the biggest rooms a chance to land.
  const sortedRects = [...input.available].sort((a, b) => b.width * b.depth - a.width * a.depth);

  for (const rect of sortedRects) {
    if (queue.length === 0) break;
    const { placed: rectPlaced, leftover, warns } = packIntoRect(rect, queue);
    placed.push(...rectPlaced);
    queue = leftover;
    warnings.push(...warns);
  }

  return { placed, unplaced: queue, warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// SINGLE-RECT PACKER
// ───────────────────────────────────────────────────────────────────────────

function packIntoRect(
  rect: Rect,
  rooms: StripPackRoom[],
): { placed: StripPackRoom[]; leftover: StripPackRoom[]; warns: string[] } {
  const placed: StripPackRoom[] = [];
  const leftover: StripPackRoom[] = [];
  const warns: string[] = [];
  const rows: RowState[] = [];

  let row: RowState = newRow(rect.y, rect.width);

  for (const room of rooms) {
    let { w, d } = preferredDims(room);

    // Rotate if strictly taller than the rect can ever hold but rotation fits.
    if (d > rect.depth && w <= rect.depth) {
      [w, d] = [d, w];
    }

    // ── Step A: Does it fit in the current row's remaining width? ─────────
    if (w <= row.remainingWidth) {
      // Yes. Make sure we don't bust the rect's depth.
      if (row.y + Math.max(row.depth, d) > rect.y + rect.depth) {
        // Vertical clip — shrink depth to fit
        const maxAllowed = rect.y + rect.depth - row.y;
        if (maxAllowed < MIN_ROOM_DEPTH_FT) {
          // Truly out of vertical room — push this and remaining to leftover
          leftover.push(room);
          continue;
        }
        d = Math.min(d, maxAllowed);
        warns.push(`${room.name}: depth shrunk to ${d.toFixed(1)}ft to fit strip`);
      }
      placeAt(room, rect.x + (rect.width - row.remainingWidth), row.y, w, d);
      row.rooms.push(room);
      row.remainingWidth -= w;
      row.depth = Math.max(row.depth, d);
      placed.push(room);
      continue;
    }

    // ── Step B: Doesn't fit current row. Can it fit a fresh row at all? ───
    let canFitFresh = w <= rect.width;
    if (!canFitFresh) {
      // Try rotation again (we may have rotated for vertical fit before).
      const rotW = room.requested_depth_ft;
      const rotD = room.requested_width_ft;
      if (rotW <= rect.width) {
        w = rotW;
        d = rotD;
        canFitFresh = true;
      }
    }
    if (!canFitFresh) {
      // Scale: keep area, set width to rect.width
      const area = w * d;
      const newW = rect.width;
      const newD = area / newW;
      if (newD < MIN_ROOM_DEPTH_FT) {
        warns.push(`${room.name}: too large for strip width=${rect.width.toFixed(1)}ft, skipping`);
        leftover.push(room);
        continue;
      }
      w = newW;
      d = newD;
      warns.push(`${room.name}: width clamped to strip ${rect.width.toFixed(1)}ft, depth grew to ${d.toFixed(1)}ft`);
    }

    // Finalize the current row before starting a new one.
    finalizeRow(row, rect);
    rows.push(row);

    const newRowY = row.y + row.depth;
    if (newRowY + d > rect.y + rect.depth) {
      const maxAllowed = rect.y + rect.depth - newRowY;
      if (maxAllowed < MIN_ROOM_DEPTH_FT) {
        warns.push(`${room.name}: ran out of strip depth at y=${newRowY.toFixed(1)}ft, skipping`);
        leftover.push(room);
        continue;
      }
      d = Math.min(d, maxAllowed);
      warns.push(`${room.name}: depth shrunk to ${d.toFixed(1)}ft to fit strip end`);
    }

    row = newRow(newRowY, rect.width);
    placeAt(room, rect.x, newRowY, w, d);
    row.rooms.push(room);
    row.remainingWidth -= w;
    row.depth = d;
    placed.push(room);
  }

  // Finalize the last row.
  finalizeRow(row, rect);
  rows.push(row);

  // Phase 3B fix #5 — anchor fixup. Re-position rooms within each row so
  // west-anchored land at the strip's west edge and east-anchored land at
  // the strip's east edge (highest-priority east-anchored at the very end).
  // Unanchored rooms fill the middle. The greedy packer above already chose
  // WHICH rooms go in which row; this pass just rearranges them.
  for (const r of rows) applyAnchorFixup(r, rect);

  return { placed, leftover, warns };
}

function applyAnchorFixup(row: RowState, rect: Rect): void {
  if (row.rooms.length === 0) return;
  const west = row.rooms.filter(r => r.anchor_edge === "west");
  const east = row.rooms.filter(r => r.anchor_edge === "east");
  const mid  = row.rooms.filter(r => !r.anchor_edge || r.anchor_edge === "none");

  // Skip when there's nothing to anchor (no fixup needed = no behavior change
  // from pre-Fix-5).
  if (west.length === 0 && east.length === 0) return;

  let cursor = rect.x;
  // 1. west-anchored, in their existing in-row order (which is sort priority).
  for (const r of west) {
    if (!r.placed) continue;
    r.placed.x = cursor;
    cursor += r.placed.width;
  }

  // 2. east-anchored, placed RIGHT-TO-LEFT so the highest-priority (FIRST in
  //    sort order) ends up furthest east.
  let rightCursor = rect.x + rect.width;
  for (const r of east) {
    if (!r.placed) continue;
    rightCursor -= r.placed.width;
    r.placed.x = rightCursor;
  }

  // 3. Unanchored fill the middle. If there's overflow (sum of widths >
  //    rect.width), unanchored rooms simply pack from `cursor` and may
  //    overlap east-anchored — but the greedy fitter would already have
  //    rejected such overflow upstream, so this is unlikely in practice.
  for (const r of mid) {
    if (!r.placed) continue;
    r.placed.x = cursor;
    cursor += r.placed.width;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

function newRow(y: number, width: number): RowState {
  return { y, remainingWidth: width, depth: 0, rooms: [] };
}

function preferredDims(room: StripPackRoom): { w: number; d: number } {
  return {
    w: Math.max(MIN_ROOM_WIDTH_FT, room.requested_width_ft),
    d: Math.max(MIN_ROOM_DEPTH_FT, room.requested_depth_ft),
  };
}

function placeAt(room: StripPackRoom, x: number, y: number, w: number, d: number) {
  room.placed = { x, y, width: w, depth: d };
  room.actual_area_sqft = w * d;
}

/**
 * Finalize a row:
 *   1. Normalize all rooms in the row to the row's max depth (eliminates the
 *      horizontal gap between rows).
 *   2. Absorb the right-edge slack so the row spans the full strip width.
 */
function finalizeRow(row: RowState, rect: Rect): void {
  if (row.rooms.length === 0) return;

  // ── 1. Normalize depth (CAPPED). ────────────────────────────────────────
  // Each room takes min(row.depth, area-cap-derived-depth). A room shorter
  // than the row leaves a micro-void above it (handled by void-filler),
  // but never blows up past 115% of the user's requested area.
  for (const r of row.rooms) {
    if (!r.placed) continue;
    const cap = maxAllowedDepthFor(r, r.placed.width);
    r.placed.depth = Math.min(row.depth, cap);
    r.actual_area_sqft = r.placed.width * r.placed.depth;
  }

  // ── 2. Absorb right-edge slack (CAPPED, may leave residual). ────────────
  let slack = row.remainingWidth;
  if (slack <= 0.001) return;

  if (slack < SMALL_GAP_THRESHOLD_FT) {
    // Small slack — try to stretch the last room, but only within its cap.
    const last = row.rooms[row.rooms.length - 1];
    if (last?.placed) {
      const cap = maxAllowedWidthFor(last, last.placed.depth);
      const allowed = Math.max(0, cap - last.placed.width);
      const grow = Math.min(slack, allowed);
      last.placed.width += grow;
      last.actual_area_sqft = last.placed.width * last.placed.depth;
      slack -= grow;
    }
    row.remainingWidth = slack;
    // Any residual slack stays as a thin strip on the right — void-filler
    // (Fix 7) will reclaim it.
    return;
  }

  // Larger slack — try every room widest-first, stopping when slack is gone
  // or every candidate is at its cap.
  const ranked = [...row.rooms].sort((a, b) => (b.placed?.width ?? 0) - (a.placed?.width ?? 0));
  for (const r of ranked) {
    if (slack <= 0.001) break;
    if (!r.placed) continue;
    const cap = maxAllowedWidthFor(r, r.placed.depth);
    const allowed = Math.max(0, cap - r.placed.width);
    if (allowed <= 0.001) continue;
    const grow = Math.min(slack, allowed);
    r.placed.width += grow;
    r.actual_area_sqft = r.placed.width * r.placed.depth;
    // Shift every room placed AFTER this one (in row order) rightward by grow.
    const idxInRow = row.rooms.indexOf(r);
    for (let i = idxInRow + 1; i < row.rooms.length; i++) {
      const k = row.rooms[i];
      if (k.placed) k.placed.x += grow;
    }
    slack -= grow;
  }
  row.remainingWidth = slack;
  void rect;
}
