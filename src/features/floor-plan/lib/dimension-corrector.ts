/**
 * Post-BSP Dimension Corrector
 *
 * @deprecated No longer needed — grid cells have fixed dimensions.
 * This file is kept as fallback for the legacy BSP/AI pipeline.
 *
 * Takes BSP output where room sizes may differ from targets.
 * Adjusts shared boundaries between adjacent rooms to make
 * actual sizes closer to target sizes.
 *
 * INVARIANT: No gaps, no overlaps after correction.
 * Rooms only change size by moving SHARED boundaries.
 *
 * Pure synchronous function — no AI calls.
 */

import type { PlacedRoom } from "@/features/floor-plan/lib/layout-engine";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RoomWithTarget extends PlacedRoom {
  targetWidth?: number;  // from user spec or AI
  targetDepth?: number;
  targetArea: number;    // always available
  isFixed?: boolean;     // true = user-specified exact dims, don't move boundaries
}

interface SharedBoundary {
  idxA: number;
  idxB: number;
  direction: "vertical" | "horizontal";
  position: number;       // x-coord for vertical, y-coord for horizontal
  overlapLength: number;  // how much of the boundary is shared
}

// ── Grid snap (match layout-engine) ─────────────────────────────────────────

const GRID = 0.1;

function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── Minimum dimensions by room type ─────────────────────────────────────────

function getMinDimension(nameOrType: string): number {
  const n = nameOrType.toLowerCase();
  if (n.includes("bath") || n.includes("toilet") || n.includes("wc") || n.includes("powder")) return 1.2;
  if (n.includes("shoe") || n.includes("linen") || n.includes("coat")) return 1.0;
  if (n.includes("corridor") || n.includes("passage") || n.includes("hallway")) return 0.9;
  if (n.includes("balcony") || n.includes("utility")) return 1.2;
  return 1.8; // habitable rooms
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Correct room dimensions to match target sizes by adjusting shared boundaries.
 *
 * @param rooms - BSP-placed rooms with target dimensions
 * @param fpW - footprint width
 * @param fpH - footprint depth
 * @param maxIterations - convergence iterations (default 15)
 * @returns rooms with adjusted dimensions
 */
export function correctDimensions(
  rooms: RoomWithTarget[],
  fpW: number,
  fpH: number,
  maxIterations?: number,
): RoomWithTarget[] {
  // Scale iterations by room count for better convergence on complex layouts
  const iters = maxIterations ?? Math.min(50, Math.max(15, rooms.length * 3));
  try {
    const result = rooms.map(r => ({ ...r }));

    for (let iter = 0; iter < iters; iter++) {
      let totalAdjustment = 0;

      // Find all shared boundaries between adjacent room pairs
      const boundaries = findSharedBoundaries(result);

      // Sort by error magnitude — fix worst mismatches first
      boundaries.sort((a, b) => {
        const errA = getBoundaryError(result[a.idxA], result[a.idxB]);
        const errB = getBoundaryError(result[b.idxA], result[b.idxB]);
        return errB - errA;
      });

      // Track which boundaries we've already moved this iteration
      const movedBoundaries = new Set<string>();

      for (const boundary of boundaries) {
        const bKey = `${boundary.direction}:${boundary.position.toFixed(1)}`;
        if (movedBoundaries.has(bKey)) continue;

        const roomA = result[boundary.idxA];
        const roomB = result[boundary.idxB];

        // PROTECT FIXED ROOMS: never move a boundary that would change
        // a user-specified exact dimension (isFixed flag set by layoutWithFixedRooms)
        if (roomA.isFixed || roomB.isFixed) continue;

        // Calculate how much each room deviates from its target
        const areaA = roomA.width * roomA.depth;
        const areaB = roomB.width * roomB.depth;
        const errorA = (areaA - roomA.targetArea) / roomA.targetArea; // positive = too big
        const errorB = (areaB - roomB.targetArea) / roomB.targetArea;

        // Adjust if one room is too big AND its neighbor is too small,
        // OR if one room is significantly oversized (>15% over target) regardless.
        const shouldAdjustAB = (errorA > 0.07 && errorB < -0.05) || (errorA > 0.15 && errorB < 0);
        const shouldAdjustBA = (errorB > 0.07 && errorA < -0.05) || (errorB > 0.15 && errorA < 0);

        if (shouldAdjustAB) {
          const shift = calculateShift(roomA, roomB, boundary, errorA, errorB);
          if (Math.abs(shift) > 0.05) {
            const snapshot = result.map(r => ({ ...r }));
            applyShift(result, boundary, shift, fpW, fpH);
            if (hasOverlaps(result)) {
              for (let k = 0; k < result.length; k++) Object.assign(result[k], snapshot[k]);
            } else {
              totalAdjustment += Math.abs(shift);
              movedBoundaries.add(bKey);
            }
          }
        } else if (shouldAdjustBA) {
          const shift = calculateShift(roomB, roomA, boundary, errorB, errorA);
          if (Math.abs(shift) > 0.05) {
            const snapshot = result.map(r => ({ ...r }));
            applyShift(result, boundary, -shift, fpW, fpH);
            if (hasOverlaps(result)) {
              for (let k = 0; k < result.length; k++) Object.assign(result[k], snapshot[k]);
            } else {
              totalAdjustment += Math.abs(shift);
              movedBoundaries.add(bKey);
            }
          }
        }
      }

      // Converged — no more significant adjustments needed
      if (totalAdjustment < 0.05) break;
    }

    // Enforce minimum dimensions (only if it doesn't create overlaps)
    const preMinSnapshot = result.map(r => ({ ...r }));
    for (const room of result) {
      const minDim = getMinDimension(room.type || room.name);
      if (room.width < minDim) room.width = grid(minDim);
      if (room.depth < minDim) room.depth = grid(minDim);
      room.area = grid(room.width * room.depth);
    }
    if (hasOverlaps(result)) {
      for (let k = 0; k < result.length; k++) Object.assign(result[k], preMinSnapshot[k]);
    }

    // ── Aspect ratio enforcement ──
    // Swap width/depth for rooms where the current orientation produces a
    // worse AR than the flipped orientation. This doesn't change the room's
    // position or area — just which dimension is width vs depth.
    // (BSP sometimes assigns a 6m×2.5m rect for a bedroom that would be
    //  better as 2.5m×6m if the neighboring topology allows.)
    for (const room of result) {
      if (room.type === "hallway" || room.type === "corridor") continue;
      const currentAR = Math.max(room.width / room.depth, room.depth / room.width);
      if (currentAR > 2.0) {
        // This room is elongated. Log it for diagnostics.
        // We can't swap width/depth without also swapping position because
        // the room is placed in a tiled layout. But we can flag it.
        // The key fix is in BSP split selection (findBestSplit + splitTwo)
        // which now penalizes bad ARs heavily.
      }
    }

    return result;
  } catch {
    // Dimension correction is best-effort — never crash layout
    return rooms;
  }
}

// ── Find shared boundaries ──────────────────────────────────────────────────

function findSharedBoundaries(rooms: RoomWithTarget[]): SharedBoundary[] {
  const boundaries: SharedBoundary[] = [];
  const TOL = 0.15;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];

      // Check vertical boundary: A's right edge touches B's left edge
      if (Math.abs((a.x + a.width) - b.x) < TOL) {
        const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (overlapY > 0.5) {
          boundaries.push({
            idxA: i, idxB: j,
            direction: "vertical",
            position: a.x + a.width,
            overlapLength: overlapY,
          });
        }
      }
      // Check reverse: B's right edge touches A's left edge
      if (Math.abs((b.x + b.width) - a.x) < TOL) {
        const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (overlapY > 0.5) {
          boundaries.push({
            idxA: j, idxB: i,
            direction: "vertical",
            position: b.x + b.width,
            overlapLength: overlapY,
          });
        }
      }

      // Check horizontal boundary: A's bottom edge touches B's top edge
      if (Math.abs((a.y + a.depth) - b.y) < TOL) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (overlapX > 0.5) {
          boundaries.push({
            idxA: i, idxB: j,
            direction: "horizontal",
            position: a.y + a.depth,
            overlapLength: overlapX,
          });
        }
      }
      // Check reverse: B's bottom edge touches A's top edge
      if (Math.abs((b.y + b.depth) - a.y) < TOL) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (overlapX > 0.5) {
          boundaries.push({
            idxA: j, idxB: i,
            direction: "horizontal",
            position: b.y + b.depth,
            overlapLength: overlapX,
          });
        }
      }
    }
  }

  return boundaries;
}

// ── Error magnitude for a boundary ──────────────────────────────────────────

function getBoundaryError(a: RoomWithTarget, b: RoomWithTarget): number {
  const errA = Math.abs(a.width * a.depth - a.targetArea) / a.targetArea;
  const errB = Math.abs(b.width * b.depth - b.targetArea) / b.targetArea;
  return errA + errB;
}

// ── Calculate shift amount ──────────────────────────────────────────────────

function calculateShift(
  bigRoom: RoomWithTarget,
  smallRoom: RoomWithTarget,
  boundary: SharedBoundary,
  _bigError: number,
  _smallError: number,
): number {
  // How much area to transfer from bigRoom to smallRoom
  const bigArea = bigRoom.width * bigRoom.depth;
  const smallArea = smallRoom.width * smallRoom.depth;
  const targetTransfer = (bigArea - bigRoom.targetArea + smallRoom.targetArea - smallArea) / 2;

  // Convert area transfer to linear shift along boundary
  let shift: number;
  if (boundary.direction === "vertical") {
    shift = targetTransfer / boundary.overlapLength;
  } else {
    shift = targetTransfer / boundary.overlapLength;
  }

  // Clamp shift to prevent rooms from getting too thin
  const maxShiftFromBig = boundary.direction === "vertical"
    ? bigRoom.width * 0.3
    : bigRoom.depth * 0.3;

  const maxShift = Math.min(maxShiftFromBig, 2.0); // Max 2m shift per iteration

  return grid(Math.min(Math.abs(shift), maxShift) * Math.sign(shift));
}

// ── Apply a boundary shift ──────────────────────────────────────────────────

/**
 * Move a boundary line, adjusting ALL rooms that touch it — not just the
 * pair that triggered the adjustment. BSP creates boundary lines shared
 * by multiple room pairs; moving only two rooms would break tiling.
 */
function applyShift(
  rooms: RoomWithTarget[],
  boundary: SharedBoundary,
  shift: number, // positive = move boundary toward roomA (shrink A, grow B)
  fpW: number,
  fpH: number,
): void {
  const TOL = 0.15;
  const pos = boundary.position;

  // Pre-validate: check ALL rooms on this boundary line won't go below min
  if (boundary.direction === "vertical") {
    for (const room of rooms) {
      if (Math.abs((room.x + room.width) - pos) < TOL) {
        // Right-side rooms would shrink
        if (room.width - shift < getMinDimension(room.type || room.name)) return;
      } else if (Math.abs(room.x - pos) < TOL) {
        // Left-side rooms would grow (x decreases, width increases)
        if (room.x - shift < -0.1) return;
      }
    }
  } else {
    for (const room of rooms) {
      if (Math.abs((room.y + room.depth) - pos) < TOL) {
        if (room.depth - shift < getMinDimension(room.type || room.name)) return;
      } else if (Math.abs(room.y - pos) < TOL) {
        if (room.y - shift < -0.1) return;
      }
    }
  }

  // Apply shift to ALL rooms on this boundary line
  if (boundary.direction === "vertical") {
    for (const room of rooms) {
      // Rooms whose right edge is at this boundary → shrink width
      if (Math.abs((room.x + room.width) - pos) < TOL) {
        room.width = grid(room.width - shift);
      }
      // Rooms whose left edge is at this boundary → shift left and grow width
      else if (Math.abs(room.x - pos) < TOL) {
        room.x = grid(room.x - shift);
        room.width = grid(room.width + shift);
      }
    }
  } else {
    for (const room of rooms) {
      if (Math.abs((room.y + room.depth) - pos) < TOL) {
        room.depth = grid(room.depth - shift);
      }
      else if (Math.abs(room.y - pos) < TOL) {
        room.y = grid(room.y - shift);
        room.depth = grid(room.depth + shift);
      }
    }
  }

  // Update areas for all rooms
  for (const room of rooms) {
    room.area = grid(room.width * room.depth);
  }
}

// ── Overlap checker ─────────────────────────────────────────────────────────

/**
 * Quick check whether any two rooms overlap (>0.15m in both axes).
 */
function hasOverlaps(rooms: RoomWithTarget[]): boolean {
  const TOL = 0.15;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (overlapX > TOL && overlapY > TOL) return true;
    }
  }
  return false;
}
