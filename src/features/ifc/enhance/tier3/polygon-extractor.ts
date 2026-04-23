/* ─── IFC Enhance — Tier 3 polygon-aware footprint extractor ─────────────
   Phase 3.5b upgrade: extracts the real 2D outline of the roof-slab from
   its top-facing triangles instead of the AABB. Pipeline:

     1. Walk every roof-slab mesh. For each triangle whose world-space
        normal points mostly up (n.y > 0.9), record its three world-space
        vertices.
     2. Build a shared-edge map (canonical key on sorted XZ endpoints).
        Any edge that appears in exactly one triangle is a boundary edge
        of the top face.
     3. Chain boundary edges into a closed loop by walking head→tail
        endpoints. On a clean slab there is exactly one closed loop; if
        there are multiple (courtyards, disjoint roof slabs), keep the
        longest loop as the outer boundary.
     4. Simplify with Douglas-Peucker at 5 cm tolerance, ensure CCW
        winding, and validate (no self-intersection, ≥3 vertices).
     5. On any pathological failure, fall back to the AABB rectangle
        and mark `isFallback: true` in the returned footprint.

   `RoofFootprint` itself lives in `src/features/ifc/enhance/types.ts` —
   it's part of the tier3 surface area now. */

import {
  Box3,
  BufferAttribute,
  type Mesh,
  Vector2,
  Vector3,
} from "three";
import type { RoofFootprint } from "../types";
import {
  classifyShape,
  ensureCCW,
  isSelfIntersecting,
  polygonCentroid,
  signedPolygonArea,
  simplifyDP,
} from "./polygon-utils";

/** Simplification tolerance in metres — below this, adjacent near-collinear
 *  vertices are collapsed. Chosen small enough to preserve smooth curves on
 *  circular footprints while discarding meshing noise. */
const DP_TOLERANCE_M = 0.05;

/** Quantise world coordinates (mm) before keying edges, so triangle-pair
 *  shared edges match even when the geometry stores them with tiny
 *  floating-point jitter. */
const EDGE_EPSILON_MM = 1;

/** Triangle is considered "top-facing" if its world-space normal has
 *  Y-component above this. 0.9 ≈ within 26° of vertical. */
const TOP_NORMAL_THRESHOLD = 0.9;

/** Epsilon for matching consecutive boundary edges' endpoints during the
 *  chain-walk, in metres. */
const CHAIN_EPSILON_M = 0.002;

interface WorldTriangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;
}

interface BoundaryEdge {
  v0: Vector2;
  v1: Vector2;
}

/**
 * Extract a polygon-aware roof footprint. Always returns a RoofFootprint
 * — never throws unless the input is entirely empty. On failure, falls
 * back to the AABB rectangle and sets `isFallback: true`.
 */
export function extractFootprint(meshes: Mesh[]): RoofFootprint {
  if (meshes.length === 0) {
    throw new Error("extractFootprint: no roof-slab meshes supplied");
  }

  try {
    const { triangles, topY } = collectTopFacingTriangles(meshes);
    if (triangles.length === 0) return aabbFallback(meshes, "no top-facing triangles");

    const edges = buildBoundaryEdges(triangles);
    if (edges.length < 3) return aabbFallback(meshes, "too few boundary edges");

    const loops = chainEdgesIntoLoops(edges);
    if (loops.length === 0) return aabbFallback(meshes, "no closed loop");

    if (loops.length > 1) {
      // eslint-disable-next-line no-console
      console.info(
        `[tier3] polygon-extractor: found ${loops.length} boundary loops; using the longest (outer).`,
      );
    }

    /* Longest loop = outer perimeter (courtyards, if any, are inner). */
    const outer = loops.reduce((best, loop) => (perimeter(loop) > perimeter(best) ? loop : best));

    if (outer.length < 3) return aabbFallback(meshes, "outer loop < 3 vertices");

    const ccw = ensureCCW(outer);
    const simplified = simplifyDP(ccw, DP_TOLERANCE_M);
    if (simplified.length < 3) return aabbFallback(meshes, "simplified < 3 vertices");
    if (isSelfIntersecting(simplified)) return aabbFallback(meshes, "self-intersecting");

    const centroid = polygonCentroid(simplified);
    const area = Math.abs(signedPolygonArea(simplified));
    const aabb = aabbOfPolygon(simplified);
    const widthM = aabb.maxX - aabb.minX;
    const depthM = aabb.maxZ - aabb.minZ;
    const shapeType = classifyShape(simplified);

    return {
      vertices: simplified,
      vertexCount: simplified.length,
      shapeType,
      topY,
      centerX: centroid.x,
      centerZ: centroid.y,
      areaM2: area,
      aabb,
      longerAxis: widthM >= depthM ? "x" : "z",
      isFallback: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return aabbFallback(meshes, `exception: ${msg}`);
  }
}

/* ── Triangle collection ─────────────────────────────────────────── */

function collectTopFacingTriangles(meshes: Mesh[]): {
  triangles: WorldTriangle[];
  topY: number;
} {
  const triangles: WorldTriangle[] = [];
  let topY = -Infinity;

  const localA = new Vector3();
  const localB = new Vector3();
  const localC = new Vector3();

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const geom = mesh.geometry;
    const pos = geom.getAttribute("position");
    if (!pos || pos.itemSize < 3) continue;
    const posAttr = pos as BufferAttribute;
    const index = geom.getIndex();

    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3 + 0) : t * 3 + 0;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      localA.fromBufferAttribute(posAttr, i0);
      localB.fromBufferAttribute(posAttr, i1);
      localC.fromBufferAttribute(posAttr, i2);
      const a = localA.clone().applyMatrix4(mesh.matrixWorld);
      const b = localB.clone().applyMatrix4(mesh.matrixWorld);
      const c = localC.clone().applyMatrix4(mesh.matrixWorld);

      const edge1 = b.clone().sub(a);
      const edge2 = c.clone().sub(a);
      const normal = edge1.cross(edge2);
      const mag = normal.length();
      if (mag < 1e-9) continue;
      normal.multiplyScalar(1 / mag);

      if (normal.y > TOP_NORMAL_THRESHOLD) {
        triangles.push({ a, b, c });
        const triTop = Math.max(a.y, b.y, c.y);
        if (triTop > topY) topY = triTop;
      }
    }
  }

  if (triangles.length === 0) {
    /* No top-facing triangles — fall back to the AABB's top. */
    const box = new Box3();
    for (const m of meshes) box.expandByObject(m);
    topY = box.max.y;
  }
  return { triangles, topY };
}

/* ── Boundary edge detection ─────────────────────────────────────── */

function buildBoundaryEdges(triangles: WorldTriangle[]): BoundaryEdge[] {
  const edgeCounts = new Map<
    string,
    { count: number; v0: Vector2; v1: Vector2 }
  >();

  for (const tri of triangles) {
    addEdge(edgeCounts, tri.a, tri.b);
    addEdge(edgeCounts, tri.b, tri.c);
    addEdge(edgeCounts, tri.c, tri.a);
  }

  const boundary: BoundaryEdge[] = [];
  for (const entry of edgeCounts.values()) {
    if (entry.count === 1) boundary.push({ v0: entry.v0, v1: entry.v1 });
  }
  return boundary;
}

function addEdge(
  map: Map<string, { count: number; v0: Vector2; v1: Vector2 }>,
  p: Vector3,
  q: Vector3,
): void {
  const key = canonicalEdgeKey(p.x, p.z, q.x, q.z);
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    map.set(key, {
      count: 1,
      v0: new Vector2(p.x, p.z),
      v1: new Vector2(q.x, q.z),
    });
  }
}

/** Order-independent edge key in the XZ plane — quantised to mm. */
function canonicalEdgeKey(x0: number, z0: number, x1: number, z1: number): string {
  const qx0 = Math.round(x0 * 1000 / EDGE_EPSILON_MM);
  const qz0 = Math.round(z0 * 1000 / EDGE_EPSILON_MM);
  const qx1 = Math.round(x1 * 1000 / EDGE_EPSILON_MM);
  const qz1 = Math.round(z1 * 1000 / EDGE_EPSILON_MM);
  const a = `${qx0}|${qz0}`;
  const b = `${qx1}|${qz1}`;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/* ── Edge chaining ───────────────────────────────────────────────── */

/**
 * Walk the boundary edges head-to-tail to reconstruct ordered loops.
 * Handles multiple disjoint loops (courtyards, multi-slab roofs). Edges
 * are consumed greedily — a well-formed slab yields one loop; malformed
 * inputs short-circuit out with whatever partial loops were found.
 */
function chainEdgesIntoLoops(edges: BoundaryEdge[]): Vector2[][] {
  /* Index edges by endpoint for O(1) neighbour lookup. */
  const endpointIndex = new Map<string, BoundaryEdge[]>();
  const pointKey = (p: Vector2): string =>
    `${Math.round(p.x * 1000 / EDGE_EPSILON_MM)}|${Math.round(p.y * 1000 / EDGE_EPSILON_MM)}`;
  for (const e of edges) {
    const k0 = pointKey(e.v0);
    const k1 = pointKey(e.v1);
    if (!endpointIndex.has(k0)) endpointIndex.set(k0, []);
    if (!endpointIndex.has(k1)) endpointIndex.set(k1, []);
    endpointIndex.get(k0)!.push(e);
    endpointIndex.get(k1)!.push(e);
  }

  const used = new Set<BoundaryEdge>();
  const loops: Vector2[][] = [];

  for (const seed of edges) {
    if (used.has(seed)) continue;
    const loop: Vector2[] = [seed.v0.clone()];
    let current: Vector2 = seed.v1.clone();
    used.add(seed);

    let safety = edges.length + 5;
    while (safety-- > 0) {
      loop.push(current.clone());
      if (nearlyEqual(current, seed.v0)) break;

      const k = pointKey(current);
      const candidates = endpointIndex.get(k) ?? [];
      let next: BoundaryEdge | null = null;
      let reversed = false;
      for (const cand of candidates) {
        if (used.has(cand)) continue;
        if (nearlyEqual(cand.v0, current)) {
          next = cand;
          reversed = false;
          break;
        }
        if (nearlyEqual(cand.v1, current)) {
          next = cand;
          reversed = true;
          break;
        }
      }
      if (!next) break; // disconnected — close what we have and try next seed
      used.add(next);
      current = (reversed ? next.v0 : next.v1).clone();
    }

    /* Drop the trailing duplicate close vertex — loop closure is implicit. */
    if (loop.length >= 2 && nearlyEqual(loop[loop.length - 1], loop[0])) {
      loop.pop();
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

function nearlyEqual(a: Vector2, b: Vector2): boolean {
  return Math.abs(a.x - b.x) < CHAIN_EPSILON_M && Math.abs(a.y - b.y) < CHAIN_EPSILON_M;
}

function perimeter(loop: Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/* ── AABB helpers ─────────────────────────────────────────────── */

function aabbOfPolygon(polygon: Vector2[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of polygon) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minZ) minZ = v.y;
    if (v.y > maxZ) maxZ = v.y;
  }
  return { minX, maxX, minZ, maxZ };
}

/* ── AABB fallback ───────────────────────────────────────────── */

/**
 * Produce a RoofFootprint that is an AABB rectangle. Used when polygon
 * extraction fails — e.g. meshes without top-facing triangles, broken
 * edge topology, self-intersection, or unexpected exceptions.
 */
function aabbFallback(meshes: Mesh[], reason: string): RoofFootprint {
  const box = new Box3();
  for (const m of meshes) box.expandByObject(m);
  if (box.isEmpty()) {
    throw new Error(`extractFootprint: AABB fallback failed (${reason}) — empty bounds`);
  }
  // eslint-disable-next-line no-console
  console.warn(`[tier3] Polygon extraction fell back to AABB: ${reason}`);

  const { minX, maxX, minZ, maxZ, maxY } = {
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    maxY: box.max.y,
  };
  const vertices: Vector2[] = [
    new Vector2(minX, minZ),
    new Vector2(maxX, minZ),
    new Vector2(maxX, maxZ),
    new Vector2(minX, maxZ),
  ];
  const widthM = maxX - minX;
  const depthM = maxZ - minZ;
  return {
    vertices,
    vertexCount: 4,
    shapeType: "rectangle",
    topY: maxY,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    areaM2: widthM * depthM,
    aabb: { minX, maxX, minZ, maxZ },
    longerAxis: widthM >= depthM ? "x" : "z",
    isFallback: true,
  };
}
