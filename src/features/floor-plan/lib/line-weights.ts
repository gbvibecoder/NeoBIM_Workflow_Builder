/**
 * Centralized Line Weight System — IS:962 / ISO 128 / ANSI Y14.2
 *
 * Architectural plan hierarchy (heaviest → lightest):
 *  Thick  0.7mm — Cut elements (walls sectioned by cutting plane)
 *  Medium 0.5mm — Doors, windows, visible outlines
 *  Thin   0.35mm — Dimensions, extension lines, hatching
 *  Fine   0.18mm — Grid, construction lines
 *
 * Weights adapt to zoom so thin lines don't vanish at overview scales
 * and thick lines don't overwhelm at detail scales.
 */

export type LWKey =
  | "wall-ext" | "wall-int" | "wall-part" | "wall-hatch" | "wall-junc"
  | "door-leaf" | "door-arc" | "door-hinge"
  | "win-frame" | "win-glass"
  | "dim-line" | "dim-tick" | "dim-ext" | "dim-overall"
  | "furn" | "furn-detail"
  | "grid-major" | "grid-minor"
  | "col" | "stair" | "stair-tread";

//                          base   min   max
const BASE: Record<LWKey, [number, number, number]> = {
  "wall-ext":    [2.4,  1.5, 3.5],
  "wall-int":    [1.6,  1.0, 2.5],
  "wall-part":   [1.0,  0.6, 1.8],
  "wall-hatch":  [0.35, 0.2, 0.6],
  "wall-junc":   [2.4,  1.5, 3.5],

  "door-leaf":   [1.4,  0.8, 2.0],
  "door-arc":    [0.6,  0.3, 1.0],
  "door-hinge":  [1.0,  0.5, 1.5],

  "win-frame":   [1.2,  0.7, 1.8],
  "win-glass":   [1.6,  0.8, 2.2],

  "dim-line":    [0.35, 0.2,  0.6],
  "dim-tick":    [0.7,  0.4,  1.2],
  "dim-ext":     [0.25, 0.15, 0.5],
  "dim-overall": [0.5,  0.3,  0.8],

  "furn":        [0.7,  0.4, 1.2],
  "furn-detail": [0.4,  0.2, 0.8],

  "grid-major":  [0.5,  0.3, 0.8],
  "grid-minor":  [0.25, 0.15, 0.4],

  "col":         [1.8,  1.0, 2.8],
  "stair":       [1.4,  0.8, 2.0],
  "stair-tread": [0.6,  0.3, 1.0],
};

const REF_ZOOM = 0.08;

/** Get the screen-pixel stroke width for a given element at current zoom. */
export function lw(key: LWKey, zoom: number): number {
  const [base, min, max] = BASE[key];
  // Gentle adaptation: pow(0.3) gives ~1.23× at half zoom, ~0.81× at double
  const factor = Math.pow(REF_ZOOM / Math.max(zoom, 0.005), 0.3);
  return Math.max(min, Math.min(max, base * factor));
}

/**
 * Compute 45° diagonal hatch line segments clipped to a convex screen-space polygon.
 * Used for brick masonry hatching (ANSI31 pattern).
 */
export function computeHatchSegments(
  screenCorners: { x: number; y: number }[],
  spacingPx: number,
): [number, number, number, number][] {
  const segments: [number, number, number, number][] = [];
  const n = screenCorners.length;
  if (n < 3) return segments;

  // 45° hatch lines: y = x + c  →  sweep c across polygon
  const cVals = screenCorners.map((p) => p.y - p.x);
  const cMin = Math.min(...cVals);
  const cMax = Math.max(...cVals);

  for (let c = cMin + spacingPx; c < cMax; c += spacingPx) {
    const hits: { x: number; y: number }[] = [];

    for (let i = 0; i < n; i++) {
      const p1 = screenCorners[i];
      const p2 = screenCorners[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const denom = dy - dx;
      if (Math.abs(denom) < 1e-6) continue;

      const t = (p1.x - p1.y + c) / denom;
      if (t < -0.001 || t > 1.001) continue;

      hits.push({ x: p1.x + t * dx, y: p1.y + t * dy });
    }

    if (hits.length >= 2) {
      hits.sort((a, b) => a.x - b.x);
      segments.push([hits[0].x, hits[0].y, hits[1].x, hits[1].y]);
    }
  }

  return segments;
}
