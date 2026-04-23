/* ─── IFC Enhance — Tier 3 polygon utilities ─────────────────────────────
   Pure 2D polygon helpers. No Three.js scene deps — only `Vector2` for
   point/vector storage. Polygons are represented as `Vector2[]` closed
   loops with an IMPLICIT close (last vertex != first). "Y" in this file
   is the ground-plane second axis, which in our world coordinates maps
   to world Z; never to world Y.

   All distances and tolerances are in world-space metres. */

import { Vector2 } from "three";
import type { RoofShapeType } from "../types";

/* ── Point-in-polygon (ray casting) ─────────────────────────────────── */

/**
 * True iff `(x, z)` is strictly inside `polygon`. On-edge points may go
 * either way — callers that care about boundary treatment should inset
 * the polygon first rather than relying on the exact behaviour here.
 *
 * Standard horizontal-ray algorithm: count edge crossings from the test
 * point to +∞ in the +x direction; odd = inside.
 */
export function pointInPolygon(x: number, z: number, polygon: Vector2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].y;
    const xj = polygon[j].x;
    const zj = polygon[j].y;
    /* Edge crosses the horizontal line through the test point. */
    const crosses = (zi > z) !== (zj > z);
    if (!crosses) continue;
    /* X coord where the edge intersects that horizontal line. */
    const xHit = ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (x < xHit) inside = !inside;
  }
  return inside;
}

/* ── Signed area / winding ─────────────────────────────────────────── */

/**
 * Shoelace signed area. Positive = CCW in (x, z); negative = CW. Degenerate
 * polygons (fewer than 3 vertices) return 0.
 */
export function signedPolygonArea(polygon: Vector2[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return 0.5 * sum;
}

/** Returns a CCW-oriented shallow copy (reverses if CW). Never mutates input. */
export function ensureCCW(polygon: Vector2[]): Vector2[] {
  if (signedPolygonArea(polygon) < 0) {
    return polygon.slice().reverse();
  }
  return polygon.slice();
}

/* ── Douglas–Peucker simplification ─────────────────────────────────── */

/**
 * Simplify a closed polygon by iteratively removing vertices whose
 * perpendicular distance from the line between their neighbours is below
 * `tolerance`. Classic Douglas–Peucker, adapted for closed loops by
 * running it twice from opposite anchor choices and keeping the union.
 *
 * No arbitrary vertex cap — a 200-sided smooth circle simplified at 5 cm
 * comes out as the same 200-sided smooth circle.
 */
export function simplifyDP(polygon: Vector2[], tolerance: number): Vector2[] {
  const n = polygon.length;
  if (n <= 3) return polygon.slice();

  /* Find the two farthest-apart points — anchors for the open-chain
     recursion. This preserves the overall extent even for pathological
     inputs. */
  let anchorA = 0;
  let anchorB = 1;
  let bestDist = -1;
  for (let i = 0; i < n; i++) {
    const pi = polygon[i];
    for (let j = i + 1; j < n; j++) {
      const pj = polygon[j];
      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const d = dx * dx + dy * dy;
      if (d > bestDist) {
        bestDist = d;
        anchorA = i;
        anchorB = j;
      }
    }
  }

  /* Split the ring into two open chains at the anchors; simplify each
     with the open-chain DP; rejoin. */
  const chain1: Vector2[] = [];
  for (let i = anchorA; i !== anchorB; i = (i + 1) % n) chain1.push(polygon[i]);
  chain1.push(polygon[anchorB]);

  const chain2: Vector2[] = [];
  for (let i = anchorB; i !== anchorA; i = (i + 1) % n) chain2.push(polygon[i]);
  chain2.push(polygon[anchorA]);

  const simp1 = simplifyOpenChain(chain1, tolerance);
  const simp2 = simplifyOpenChain(chain2, tolerance);

  /* Stitch — drop the duplicated anchor vertices. */
  const result: Vector2[] = [...simp1];
  for (let i = 1; i < simp2.length - 1; i++) result.push(simp2[i]);

  if (result.length < 3) return polygon.slice();
  return result;
}

function simplifyOpenChain(chain: Vector2[], tolerance: number): Vector2[] {
  const n = chain.length;
  if (n < 3) return chain.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpendicularDistance(chain[i], chain[a], chain[b]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxIdx >= 0 && maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx]);
      stack.push([maxIdx, b]);
    }
  }

  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(chain[i]);
  return out;
}

function perpendicularDistance(p: Vector2, a: Vector2, b: Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.hypot(px, py);
  }
  /* |AB × AP| / |AB| gives unsigned distance from P to the line through AB. */
  const cross = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x));
  return cross / Math.sqrt(lenSq);
}

/* ── Self-intersection test ──────────────────────────────────────── */

/**
 * O(n²) edge-pair sweep. Returns true iff any two non-adjacent edges
 * cross. Adjacent edges (sharing a vertex) are excluded by construction.
 * Good enough for ≤few-hundred-vertex polygons we'll see in practice.
 */
export function isSelfIntersecting(polygon: Vector2[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a0 = polygon[i];
    const a1 = polygon[(i + 1) % n];
    /* Skip edges (i, i+1) vs (i+1, i+2) — they share a vertex. And wrap
       edge (n-1, 0) vs (0, 1). */
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // wrap-adjacent
      const b0 = polygon[j];
      const b1 = polygon[(j + 1) % n];
      if (segmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function direction(a: Vector2, b: Vector2, c: Vector2): number {
  return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
}

/* ── Shape classification ───────────────────────────────────────── */

/**
 * Classify the polygon's macro shape for downstream routing:
 *   - `"rectangle"` — exactly 4 vertices with ~90° corners
 *   - `"circular"`  — ≥8 vertices, uniform edge lengths, vertices
 *                     equidistant from centroid
 *   - `"polygon"`   — everything else (L-shape, T-shape, hex, …)
 * Runs in O(n). Call AFTER simplification — otherwise a truly circular
 * polygon may arrive with thousands of near-collinear vertices.
 */
export function classifyShape(polygon: Vector2[]): RoofShapeType {
  const n = polygon.length;
  if (n < 3) return "polygon";

  /* Rectangle — exactly 4, all corners within ±5° of 90°. */
  if (n === 4 && allCornersRightAngled(polygon, 5)) return "rectangle";

  if (n >= 8) {
    /* Edge-length regularity: min/max edges within 1.5× of each other. */
    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < minEdge) minEdge = len;
      if (len > maxEdge) maxEdge = len;
    }
    const edgeRatio = maxEdge / Math.max(minEdge, 1e-9);

    /* Radial regularity: all vertices within ±10% of mean distance to
       centroid. */
    const c = polygonCentroid(polygon);
    let sum = 0;
    for (const v of polygon) sum += Math.hypot(v.x - c.x, v.y - c.y);
    const meanR = sum / n;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const v of polygon) {
      const r = Math.hypot(v.x - c.x, v.y - c.y);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    const radialDelta = (maxR - minR) / Math.max(meanR, 1e-9);

    if (edgeRatio < 1.5 && radialDelta < 0.2) return "circular";
  }

  return "polygon";
}

function allCornersRightAngled(polygon: Vector2[], toleranceDeg: number): boolean {
  const n = polygon.length;
  const tolRad = (toleranceDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];
    const ax = prev.x - curr.x;
    const ay = prev.y - curr.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const dot = ax * bx + ay * by;
    const magA = Math.hypot(ax, ay);
    const magB = Math.hypot(bx, by);
    if (magA === 0 || magB === 0) return false;
    const cos = dot / (magA * magB);
    const clamped = Math.max(-1, Math.min(1, cos));
    const angle = Math.acos(clamped);
    if (Math.abs(angle - Math.PI / 2) > tolRad) return false;
  }
  return true;
}

/* ── Centroid ───────────────────────────────────────────────────── */

/**
 * Area-weighted centroid of a simple polygon. Falls back to vertex mean
 * for degenerate (zero-area) inputs so callers always get a usable point.
 */
export function polygonCentroid(polygon: Vector2[]): Vector2 {
  const n = polygon.length;
  if (n === 0) return new Vector2(0, 0);
  if (n < 3) {
    let sx = 0;
    let sy = 0;
    for (const v of polygon) {
      sx += v.x;
      sy += v.y;
    }
    return new Vector2(sx / n, sy / n);
  }

  const signedA = signedPolygonArea(polygon);
  if (Math.abs(signedA) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const v of polygon) {
      sx += v.x;
      sy += v.y;
    }
    return new Vector2(sx / n, sy / n);
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const f = 1 / (6 * signedA);
  return new Vector2(cx * f, cy * f);
}

/* ── Inward offset (inset) ──────────────────────────────────────── */

/**
 * Offset each vertex inward by `distance` metres along its angle bisector.
 * Not a full straight-skeleton implementation — sharp concave reflex
 * angles can produce self-intersections for large insets. Adequate for
 * our use case (HVAC / stair clearance of ≤2 m on multi-metre buildings).
 *
 * Returns a new polygon; never mutates the input. Assumes CCW input.
 */
export function insetPolygon(polygon: Vector2[], distance: number): Vector2[] {
  const n = polygon.length;
  if (n < 3) return polygon.slice();
  if (distance <= 0) return polygon.slice();

  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    /* Inward normals for the two incident edges. For CCW polygons the
       inward normal to an edge (a→b) is `rot90CW(b - a) / |b - a|`. */
    const inA = inwardNormal(prev, curr);
    const inB = inwardNormal(curr, next);

    /* Vertex bisector — sum of the two inward normals. Normalise to
       turn it into a unit direction. */
    const bx = inA.x + inB.x;
    const by = inA.y + inB.y;
    const bLen = Math.hypot(bx, by);
    if (bLen < 1e-9) {
      /* Colinear edges — offset by the single inward normal direction. */
      out.push(new Vector2(curr.x + inA.x * distance, curr.y + inA.y * distance));
      continue;
    }
    /* The bisector's length along each incident normal is 1/sin(θ/2),
       where θ is the interior angle. We approximate by projecting the
       vertex offset onto one of the incident normals — simple and
       stable for angles away from 180°. */
    const dot = (bx * inA.x + by * inA.y) / bLen;
    const scale = distance / Math.max(dot, 0.1); // clamp — prevents blow-up on very-flat corners
    out.push(new Vector2(curr.x + (bx / bLen) * scale, curr.y + (by / bLen) * scale));
  }
  return out;
}

/** Inward unit normal to the edge (a → b) for a CCW polygon. */
function inwardNormal(a: Vector2, b: Vector2): Vector2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return new Vector2(0, 0);
  /* rot90CCW(v) = (-v.y, v.x). For a polygon with positive signed area
     (CCW per the shoelace convention used by `signedPolygonArea`), this
     normal points INTO the polygon's interior. Verified against unit
     square [(0,0),(1,0),(1,1),(0,1)] — edge (0,0)→(1,0) inward = (0,1). */
  return new Vector2(-dy / len, dx / len);
}
