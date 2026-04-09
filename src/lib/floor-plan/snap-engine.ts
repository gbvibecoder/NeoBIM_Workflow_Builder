/**
 * Snap Engine for Floor Plan Interactive Editing
 *
 * Collects snap candidates from walls, grid, and intersections.
 * Returns the nearest candidate to the cursor, prioritized by type.
 */

import type { Point, Wall } from "@/types/floor-plan-cad";
import {
  distance,
  midpoint,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  wallLength,
  segmentIntersection,
} from "@/lib/floor-plan/geometry";

// ============================================================
// TYPES
// ============================================================

export type SnapType = "endpoint" | "intersection" | "midpoint" | "face" | "grid";

export interface SnapResult {
  point: Point;
  type: SnapType;
  entityId?: string;
}

// ============================================================
// MAIN SNAP FUNCTION
// ============================================================

/**
 * Finds the best snap candidate near the cursor.
 * Priority: endpoint > intersection > midpoint > face > grid
 */
export function findSnap(
  cursor: Point,
  walls: Wall[],
  gridSize_mm: number,
  snapEnabled: boolean,
  radius_mm: number = 200
): SnapResult | null {
  if (!snapEnabled) return null;

  const candidates: Array<SnapResult & { dist: number; priority: number }> = [];

  const TYPE_PRIORITY: Record<SnapType, number> = {
    endpoint: 0,
    intersection: 1,
    midpoint: 2,
    face: 3,
    grid: 4,
  };

  // 1. Endpoint snaps (wall start/end points)
  for (const wall of walls) {
    const dStart = distance(cursor, wall.centerline.start);
    if (dStart < radius_mm) {
      candidates.push({
        point: { ...wall.centerline.start },
        type: "endpoint",
        entityId: wall.id,
        dist: dStart,
        priority: TYPE_PRIORITY.endpoint,
      });
    }
    const dEnd = distance(cursor, wall.centerline.end);
    if (dEnd < radius_mm) {
      candidates.push({
        point: { ...wall.centerline.end },
        type: "endpoint",
        entityId: wall.id,
        dist: dEnd,
        priority: TYPE_PRIORITY.endpoint,
      });
    }
  }

  // 2. Intersection snaps (where wall centerlines cross)
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const ix = segmentIntersection(
        walls[i].centerline.start,
        walls[i].centerline.end,
        walls[j].centerline.start,
        walls[j].centerline.end
      );
      if (ix) {
        const d = distance(cursor, ix);
        if (d < radius_mm) {
          candidates.push({
            point: ix,
            type: "intersection",
            dist: d,
            priority: TYPE_PRIORITY.intersection,
          });
        }
      }
    }
  }

  // 3. Midpoint snaps
  for (const wall of walls) {
    const mid = midpoint(wall.centerline.start, wall.centerline.end);
    const d = distance(cursor, mid);
    if (d < radius_mm) {
      candidates.push({
        point: mid,
        type: "midpoint",
        entityId: wall.id,
        dist: d,
        priority: TYPE_PRIORITY.midpoint,
      });
    }
  }

  // 4. Face snaps (nearest point on wall face edges)
  for (const wall of walls) {
    const facePt = nearestPointOnWallFace(cursor, wall);
    if (facePt) {
      const d = distance(cursor, facePt);
      if (d < radius_mm) {
        candidates.push({
          point: facePt,
          type: "face",
          entityId: wall.id,
          dist: d,
          priority: TYPE_PRIORITY.face,
        });
      }
    }
  }

  // 5. Grid snap
  const gridX = Math.round(cursor.x / gridSize_mm) * gridSize_mm;
  const gridY = Math.round(cursor.y / gridSize_mm) * gridSize_mm;
  const gridPt = { x: gridX, y: gridY };
  const gridDist = distance(cursor, gridPt);
  if (gridDist < radius_mm) {
    candidates.push({
      point: gridPt,
      type: "grid",
      dist: gridDist,
      priority: TYPE_PRIORITY.grid,
    });
  }

  if (candidates.length === 0) return null;

  // Sort: by priority first, then by distance
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.dist - b.dist;
  });

  const best = candidates[0];
  return { point: best.point, type: best.type, entityId: best.entityId };
}

// ============================================================
// ORTHO CONSTRAINT
// ============================================================

/**
 * Constrains a point to be horizontal or vertical relative to an origin.
 * Returns the constrained point.
 */
export function applyOrthoConstraint(point: Point, origin: Point): Point {
  const dx = Math.abs(point.x - origin.x);
  const dy = Math.abs(point.y - origin.y);

  if (dx >= dy) {
    // Horizontal — keep X, use origin's Y
    return { x: point.x, y: origin.y };
  } else {
    // Vertical — keep Y, use origin's X
    return { x: origin.x, y: point.y };
  }
}

/**
 * Snaps a value to the nearest grid increment.
 */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Applies grid snap to a point.
 */
export function snapPointToGrid(point: Point, gridSize: number): Point {
  return {
    x: snapToGrid(point.x, gridSize),
    y: snapToGrid(point.y, gridSize),
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Nearest point on a wall's face edges (all 4 sides of the rectangle).
 */
function nearestPointOnWallFace(point: Point, wall: Wall): Point | null {
  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2;

  // 4 corners of wall rectangle
  const sL = addPoints(wall.centerline.start, scalePoint(norm, halfT));
  const sR = addPoints(wall.centerline.start, scalePoint(norm, -halfT));
  const eL = addPoints(wall.centerline.end, scalePoint(norm, halfT));
  const eR = addPoints(wall.centerline.end, scalePoint(norm, -halfT));

  // All 4 edges: 2 parallel faces + 2 perpendicular end faces
  const segments: [Point, Point][] = [
    [sL, eL],  // left face (parallel)
    [sR, eR],  // right face (parallel)
    [sL, sR],  // start end face (perpendicular)
    [eL, eR],  // end face (perpendicular)
  ];

  let best: Point | null = null;
  let bestDist = Infinity;
  for (const [a, b] of segments) {
    const p = nearestPointOnSegment(point, a, b);
    const d = distance(point, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { ...a };

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
