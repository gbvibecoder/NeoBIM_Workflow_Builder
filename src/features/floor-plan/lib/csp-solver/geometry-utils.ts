export interface Rect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export const GEOM_TOL = 0.01;

export function rectOverlaps(a: Rect, b: Rect, tol = GEOM_TOL): boolean {
  return !(
    a.x + a.width <= b.x + tol ||
    b.x + b.width <= a.x + tol ||
    a.y + a.depth <= b.y + tol ||
    b.y + b.depth <= a.y + tol
  );
}

export function rectIntersectionArea(a: Rect, b: Rect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

/** Longest length of shared edge between two rects; 0 if non-adjacent. */
export function rectsSharedEdgeLength(a: Rect, b: Rect, tol = GEOM_TOL): number {
  if (Math.abs(a.x + a.width - b.x) < tol) {
    const overlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    return Math.max(0, overlap);
  }
  if (Math.abs(b.x + b.width - a.x) < tol) {
    const overlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    return Math.max(0, overlap);
  }
  if (Math.abs(a.y + a.depth - b.y) < tol) {
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    return Math.max(0, overlap);
  }
  if (Math.abs(b.y + b.depth - a.y) < tol) {
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    return Math.max(0, overlap);
  }
  return 0;
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.depth / 2 };
}

export type PlotSide = "N" | "S" | "E" | "W";

export function rectPerimeterTouch(r: Rect, plotW: number, plotD: number, tol = GEOM_TOL): PlotSide[] {
  const sides: PlotSide[] = [];
  if (r.y <= tol) sides.push("N");
  if (r.y + r.depth >= plotD - tol) sides.push("S");
  if (r.x <= tol) sides.push("W");
  if (r.x + r.width >= plotW - tol) sides.push("E");
  return sides;
}

/** Does the rect touch BOTH of the two plot walls corresponding to the given corner? */
export function rectTouchesCorner(r: Rect, dir: "NW" | "NE" | "SW" | "SE", plotW: number, plotD: number, tol = GEOM_TOL): boolean {
  const sides = rectPerimeterTouch(r, plotW, plotD, tol);
  switch (dir) {
    case "NW": return sides.includes("N") && sides.includes("W");
    case "NE": return sides.includes("N") && sides.includes("E");
    case "SW": return sides.includes("S") && sides.includes("W");
    case "SE": return sides.includes("S") && sides.includes("E");
  }
}

/** For position_type="wall_centered": centroid within 15% of wall midpoint. */
export function rectCenteredOnWall(r: Rect, dir: "N" | "S" | "E" | "W", plotW: number, plotD: number, tol = 0.15): boolean {
  const c = rectCenter(r);
  switch (dir) {
    case "N":
      return Math.abs(c.x - plotW / 2) <= plotW * tol && r.y <= GEOM_TOL * 10;
    case "S":
      return Math.abs(c.x - plotW / 2) <= plotW * tol && Math.abs(r.y + r.depth - plotD) <= GEOM_TOL * 10;
    case "E":
      return Math.abs(c.y - plotD / 2) <= plotD * tol && Math.abs(r.x + r.width - plotW) <= GEOM_TOL * 10;
    case "W":
      return Math.abs(c.y - plotD / 2) <= plotD * tol && r.x <= GEOM_TOL * 10;
  }
}
