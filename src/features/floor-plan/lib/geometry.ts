/**
 * Floor Plan Geometry Utilities
 *
 * Wall junction computation, polygon operations, and coordinate transforms.
 * All coordinates in mm. Canvas Y is flipped (architectural Y-up → canvas Y-down).
 */

import type { Point, Wall, Line, Polygon } from "@/types/floor-plan-cad";

// ============================================================
// POINT OPERATIONS
// ============================================================

export function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtractPoints(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scalePoint(p: Point, s: number): Point {
  return { x: p.x * s, y: p.y * s };
}

export function normalizeVector(v: Point): Point {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function perpendicularLeft(v: Point): Point {
  return { x: -v.y, y: v.x };
}

export function perpendicularRight(v: Point): Point {
  return { x: v.y, y: -v.x };
}

export function dotProduct(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function crossProduct(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

// ============================================================
// LINE OPERATIONS
// ============================================================

export function lineLength(line: Line): number {
  return distance(line.start, line.end);
}

export function lineDirection(line: Line): Point {
  return normalizeVector(subtractPoints(line.end, line.start));
}

export function lineNormal(line: Line): Point {
  const dir = lineDirection(line);
  return perpendicularLeft(dir);
}

export function pointAlongLine(line: Line, t: number): Point {
  return {
    x: line.start.x + (line.end.x - line.start.x) * t,
    y: line.start.y + (line.end.y - line.start.y) * t,
  };
}

export function pointAtOffsetAlongLine(line: Line, offset_mm: number): Point {
  const len = lineLength(line);
  if (len === 0) return line.start;
  const t = offset_mm / len;
  return pointAlongLine(line, t);
}

/** Find intersection of two infinite lines. Returns null if parallel. */
export function lineIntersection(
  a1: Point, a2: Point,
  b1: Point, b2: Point
): Point | null {
  const d1 = subtractPoints(a2, a1);
  const d2 = subtractPoints(b2, b1);
  const cross = crossProduct(d1, d2);
  if (Math.abs(cross) < 1e-6) return null;
  const d = subtractPoints(b1, a1);
  const t = crossProduct(d, d2) / cross;
  return { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
}

/** Find intersection of two finite line segments. Returns null if no intersection within both segments. */
export function segmentIntersection(
  a1: Point, a2: Point,
  b1: Point, b2: Point
): Point | null {
  const d1 = subtractPoints(a2, a1);
  const d2 = subtractPoints(b2, b1);
  const cross = crossProduct(d1, d2);
  if (Math.abs(cross) < 1e-6) return null;
  const d = subtractPoints(b1, a1);
  const t = crossProduct(d, d2) / cross;
  const u = crossProduct(d, d1) / cross;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
}

// ============================================================
// WALL GEOMETRY
// ============================================================

export interface WallPolygon {
  wall_id: string;
  /** 4 corners of the wall rectangle [top-left, top-right, bottom-right, bottom-left] */
  corners: [Point, Point, Point, Point];
  /** Outline points after junction adjustment */
  outline: Point[];
  /** The wall reference */
  wall: Wall;
}

/** Compute the 4 corners of a wall rectangle from its centerline and thickness */
export function wallToRectangle(wall: Wall): [Point, Point, Point, Point] {
  const dir = lineDirection(wall.centerline);
  const normal = perpendicularLeft(dir);
  const halfThick = wall.thickness_mm / 2;

  const offset = scalePoint(normal, halfThick);
  const s = wall.centerline.start;
  const e = wall.centerline.end;

  return [
    addPoints(s, offset),    // start-left (top-left when horizontal)
    addPoints(e, offset),    // end-left (top-right)
    subtractPoints(e, offset), // end-right (bottom-right)
    subtractPoints(s, offset), // start-right (bottom-left)
  ];
}

/** Check if two walls share an endpoint (within tolerance) */
export function wallsShareEndpoint(a: Wall, b: Wall, tolerance: number = 50): boolean {
  const endpoints_a = [a.centerline.start, a.centerline.end];
  const endpoints_b = [b.centerline.start, b.centerline.end];
  for (const pa of endpoints_a) {
    for (const pb of endpoints_b) {
      if (distance(pa, pb) < tolerance) return true;
    }
  }
  return false;
}

/** Get shared endpoint between two walls */
export function getSharedEndpoint(a: Wall, b: Wall, tolerance: number = 50): Point | null {
  const points = [
    { a: a.centerline.start, b: b.centerline.start },
    { a: a.centerline.start, b: b.centerline.end },
    { a: a.centerline.end, b: b.centerline.start },
    { a: a.centerline.end, b: b.centerline.end },
  ];
  for (const p of points) {
    if (distance(p.a, p.b) < tolerance) {
      return midpoint(p.a, p.b);
    }
  }
  return null;
}

/** Compute wall polygons with proper junction handling */
export function computeWallPolygons(walls: Wall[]): WallPolygon[] {
  return walls.map((wall) => {
    const corners = wallToRectangle(wall);
    return {
      wall_id: wall.id,
      corners,
      outline: [...corners],
      wall,
    };
  });
}

/** Extend wall corners at L-junctions to form clean mitered corners */
export function adjustLJunctions(
  polygons: WallPolygon[],
  walls: Wall[],
  tolerance: number = 50
): void {
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const shared = getSharedEndpoint(walls[i], walls[j], tolerance);
      if (!shared) continue;

      const poly_i = polygons[i];
      const poly_j = polygons[j];
      const wi = walls[i];
      const wj = walls[j];

      // Determine which end of each wall is at the junction
      const iAtStart = distance(wi.centerline.start, shared) < tolerance;
      const jAtStart = distance(wj.centerline.start, shared) < tolerance;

      // Get the face edges of each wall at the junction
      const [iSL, iEL, iER, iSR] = poly_i.corners;
      const [jSL, jEL, jER, jSR] = poly_j.corners;

      // Left face of wall i
      const iLeftStart = iAtStart ? iSL : iEL;
      const iLeftEnd = iAtStart ? iEL : iSL;
      // Right face of wall i
      const iRightStart = iAtStart ? iSR : iER;
      const iRightEnd = iAtStart ? iER : iSR;

      // Left face of wall j
      const jLeftStart = jAtStart ? jSL : jEL;
      const jLeftEnd = jAtStart ? jEL : jSL;
      // Right face of wall j
      const jRightStart = jAtStart ? jSR : jER;
      const jRightEnd = jAtStart ? jER : jSR;

      // Extend faces to meet at intersection
      const int1 = lineIntersection(iLeftStart, iLeftEnd, jLeftStart, jLeftEnd);
      const int2 = lineIntersection(iLeftStart, iLeftEnd, jRightStart, jRightEnd);
      const int3 = lineIntersection(iRightStart, iRightEnd, jLeftStart, jLeftEnd);
      const int4 = lineIntersection(iRightStart, iRightEnd, jRightStart, jRightEnd);

      // Update the junction corners to the outermost intersections
      if (int1 && int4) {
        // Update poly_i's junction end
        const idx_i_start = iAtStart ? 0 : 1;
        const idx_i_end = iAtStart ? 3 : 2;
        // Update poly_j's junction end
        const idx_j_start = jAtStart ? 0 : 1;
        const idx_j_end = jAtStart ? 3 : 2;

        // Use the intersection that extends both walls to meet
        if (int1) poly_i.outline[idx_i_start] = int1;
        if (int4) poly_i.outline[idx_i_end] = int4;
        if (int1) poly_j.outline[idx_j_start] = int1;
        if (int4) poly_j.outline[idx_j_end] = int4;
      }
    }
  }
}

// ============================================================
// POLYGON OPERATIONS
// ============================================================

/** Compute area of a polygon using the shoelace formula. Returns positive for CCW. */
export function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/** Compute area-weighted centroid of a polygon (shoelace formula) */
export function polygonCentroid(points: Point[]): Point {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    signedArea += cross;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
  }
  if (Math.abs(signedArea) < 1e-10) {
    // Degenerate polygon — fall back to simple average
    let sx = 0, sy = 0;
    for (const p of points) { sx += p.x; sy += p.y; }
    return { x: sx / n, y: sy / n };
  }
  const a6 = signedArea * 3; // 6A / 2 = 3 * signedArea
  return { x: cx / a6, y: cy / a6 };
}

/** Compute bounding box of a polygon */
export function polygonBounds(points: Point[]): {
  min: Point;
  max: Point;
  width: number;
  height: number;
  center: Point;
} {
  if (points.length === 0) {
    return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 }, width: 0, height: 0, center: { x: 0, y: 0 } };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width: maxX - minX,
    height: maxY - minY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/** Get bounding box of the entire floor plan */
export function floorBounds(walls: Wall[], rooms: { boundary: Polygon }[]): {
  min: Point;
  max: Point;
  width: number;
  height: number;
  center: Point;
} {
  const allPoints: Point[] = [];

  for (const wall of walls) {
    const corners = wallToRectangle(wall);
    allPoints.push(...corners);
  }

  for (const room of rooms) {
    allPoints.push(...room.boundary.points);
  }

  if (allPoints.length === 0) {
    return { min: { x: 0, y: 0 }, max: { x: 10000, y: 10000 }, width: 10000, height: 10000, center: { x: 5000, y: 5000 } };
  }

  return polygonBounds(allPoints);
}

// ============================================================
// COORDINATE TRANSFORMS (World ↔ Screen)
// ============================================================

export interface Viewport {
  x: number; // world center x
  y: number; // world center y
  zoom: number; // px per mm
  canvasWidth: number;
  canvasHeight: number;
}

/** Convert world coordinates (mm, Y-up) to screen coordinates (px, Y-down) */
export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) * viewport.zoom + viewport.canvasWidth / 2,
    y: viewport.canvasHeight / 2 - (point.y - viewport.y) * viewport.zoom,
  };
}

/** Convert screen coordinates to world coordinates */
export function screenToWorld(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.canvasWidth / 2) / viewport.zoom + viewport.x,
    y: -(screen.y - viewport.canvasHeight / 2) / viewport.zoom + viewport.y,
  };
}

/** Convert world distance (mm) to screen pixels */
export function worldToScreenDistance(mm: number, zoom: number): number {
  return mm * zoom;
}

/** Calculate zoom level to fit bounds in viewport with padding */
export function zoomToFit(
  bounds: { width: number; height: number; center: Point },
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 0.1
): Viewport {
  const padW = canvasWidth * (1 - padding * 2);
  const padH = canvasHeight * (1 - padding * 2);
  const zoomX = padW / bounds.width;
  const zoomY = padH / bounds.height;
  const zoom = Math.min(zoomX, zoomY);

  return {
    x: bounds.center.x,
    y: bounds.center.y,
    zoom: Math.max(0.01, Math.min(zoom, 10)),
    canvasWidth,
    canvasHeight,
  };
}

// ============================================================
// WALL OPENING POSITION HELPERS
// ============================================================

/** Get the world position of an opening on a wall */
export function getOpeningPosition(wall: Wall, offset_mm: number, width_mm: number): {
  start: Point;
  end: Point;
  center: Point;
  normal: Point;
} {
  const dir = lineDirection(wall.centerline);
  const normal = perpendicularLeft(dir);
  const wallStart = wall.centerline.start;

  const start = addPoints(wallStart, scalePoint(dir, offset_mm));
  const end = addPoints(wallStart, scalePoint(dir, offset_mm + width_mm));
  const center = midpoint(start, end);

  return { start, end, center, normal };
}

/** Calculate the angle of a wall in radians (0 = horizontal right) */
export function wallAngle(wall: Wall): number {
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  return Math.atan2(dy, dx);
}

/** Calculate wall length in mm */
export function wallLength(wall: Wall): number {
  return distance(wall.centerline.start, wall.centerline.end);
}
