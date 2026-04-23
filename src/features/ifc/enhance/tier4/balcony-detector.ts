/* ─── IFC Enhance — Tier 4 polygon-aware balcony detector ────────────────
   Phase 4a hotfix: the old AABB-edge detector emitted straight railings
   along the full slab edge even when only a sub-section cantilevered past
   the walls, producing mid-air-ending railings on basic.ifc. This rewrite
   reuses Phase 3.5b's polygon-aware approach:

     1. For each floor-slab mesh (NOT roof-slab — classifier handles
        that), extract the TOP polygon by collecting top-facing triangles,
        chaining boundary edges into a closed loop, simplifying with
        Douglas-Peucker and forcing CCW winding. Helpers come from
        `tier3/polygon-utils.ts` which is exported for reuse.
     2. Compute the wall footprint as the union AABB of every
        `wall-exterior` mesh. A rectangle is a coarse approximation but
        sound for most buildings; upgrading to a polygonal wall footprint
        is a Phase 4c task.
     3. Subtract the wall rectangle from each slab polygon. Decomposition:
          P \ R = (P ∩ x<minX) ∪ (P ∩ x>maxX)
                ∪ (P ∩ [minX,maxX] ∩ z<minZ)
                ∪ (P ∩ [minX,maxX] ∩ z>maxZ)
        Each component is computed with Sutherland-Hodgman half-plane
        clipping. Fragments below `BALCONY_DETECT.minAreaM2` are dropped
        as drip-edge noise.
     4. Each balcony polygon carries its `railSegments` — the subset of
        its edges that come from the original slab perimeter (not from
        the clipping lines). Synthetic edges that lie along the wall
        AABB boundary are excluded via a post-hoc on-line test.
     5. Belt-and-suspenders: drop the topmost floor-slab (guards against
        a classifier miss that kept the real roof as a "floor-slab").
     6. User rule `skipTopmostAlways`: always drop the topmost BALCONY
        from the result list. Prevents the highest-level cantilever from
        competing with the tier 3 parapet/roof treatment, even in models
        where the roof slab wasn't classified correctly. */

import { Box3, type BufferAttribute, type Mesh, Vector2, Vector3 } from "three";
import { BALCONY_DETECT } from "../constants";
import type { BalconyPolygon, EnhanceTag } from "../types";
import {
  ensureCCW,
  isSelfIntersecting,
  signedPolygonArea,
  simplifyDP,
} from "../tier3/polygon-utils";

/** Polygon with explicit rectangle bounds. */
interface RectBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Per-slab intermediate — grouped by expressID to match classifier shape. */
interface SlabGroup {
  expressID: number;
  meshes: Mesh[];
  topY: number;
}

/* ── Epsilon used for on-line edge classification (1 cm). */
const SYNTHETIC_EPS_M = 0.01;

/**
 * Detect cantilever balcony polygons in the model. Returns an array of
 * `BalconyPolygon` with rail-segment provenance — each polygon carries
 * only the subset of its edges that correspond to real slab perimeter
 * (so the railing builder doesn't run a rail along the wall).
 */
export function detectBalconyPolygons(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): BalconyPolygon[] {
  const wallBox = computeWallAABB(meshMap, tags);
  if (!wallBox || wallBox.isEmpty()) return [];
  const wallRect: RectBounds = {
    minX: wallBox.min.x,
    maxX: wallBox.max.x,
    minZ: wallBox.min.z,
    maxZ: wallBox.max.z,
  };

  const slabGroups = groupFloorSlabs(meshMap, tags);
  if (slabGroups.length === 0) return [];

  /* Belt-and-suspenders: drop topmost floor-slab (guards against classifier
     miss on borderline-close slabs). Safe when there's more than one. */
  let candidates = slabGroups;
  if (BALCONY_DETECT.excludeTopSlab && candidates.length > 1) {
    const sorted = [...candidates].sort((a, b) => b.topY - a.topY);
    candidates = sorted.slice(1);
  }

  const allBalconies: BalconyPolygon[] = [];

  for (const slab of candidates) {
    const slabPoly = extractTopPolygon(slab.meshes);
    if (!slabPoly) continue;

    const balconies = subtractRectangle(
      slabPoly,
      wallRect,
      slab.topY,
    );
    for (const bal of balconies) {
      if (bal.areaM2 >= BALCONY_DETECT.minAreaM2) {
        allBalconies.push(bal);
      }
    }
  }

  /* Sort topmost-first, then drop topmost per user rule. */
  allBalconies.sort((a, b) => b.slabY - a.slabY);
  if (BALCONY_DETECT.skipTopmostAlways && allBalconies.length > 0) {
    return allBalconies.slice(1);
  }
  return allBalconies;
}

/* ═══════════════════════════════════════════════════════════════════
   Slab grouping
   ═══════════════════════════════════════════════════════════════════ */

function groupFloorSlabs(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): SlabGroup[] {
  const out: SlabGroup[] = [];
  for (const [expressID, meshes] of meshMap.entries()) {
    if (tags.get(expressID) !== "floor-slab") continue;
    if (meshes.length === 0) continue;

    /* Combined top-Y across sub-meshes. */
    const box = new Box3();
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      box.expandByObject(m);
    }
    if (box.isEmpty()) continue;
    out.push({ expressID, meshes, topY: box.max.y });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   Wall footprint AABB
   ═══════════════════════════════════════════════════════════════════ */

function computeWallAABB(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): Box3 | null {
  const pool: Mesh[] = [];
  for (const [expressID, meshes] of meshMap.entries()) {
    if (tags.get(expressID) === "wall-exterior") pool.push(...meshes);
  }
  /* Fall through to the full model bounds if no exterior walls tagged. */
  if (pool.length === 0) {
    for (const meshes of meshMap.values()) pool.push(...meshes);
  }
  if (pool.length === 0) return null;

  const box = new Box3();
  for (const m of pool) {
    m.updateMatrixWorld(true);
    box.expandByObject(m);
  }
  return box;
}

/* ═══════════════════════════════════════════════════════════════════
   Top-face polygon extraction (per slab)
   ═══════════════════════════════════════════════════════════════════ */

/** Top-facing normal threshold (≈ within 26° of vertical). */
const TOP_NORMAL_THRESHOLD = 0.9;
/** Edge canonicalisation — quantise to mm. */
const EDGE_QUANTISE_PER_M = 1000;
/** Chain-walk matching tolerance (2 mm). */
const CHAIN_EPSILON_M = 0.002;

/**
 * Extract the top polygon of a slab from its top-facing triangles. Light
 * adaptation of tier3's polygon-extractor for per-slab use, keeping the
 * pipeline inside tier4. Returns null on any pathological failure.
 */
function extractTopPolygon(meshes: Mesh[]): Vector2[] | null {
  const triangles = collectTopFacingTriangles(meshes);
  if (triangles.length === 0) return null;

  const boundary = buildBoundaryEdges(triangles);
  if (boundary.length < 3) return null;

  const loops = chainEdgesIntoLoops(boundary);
  if (loops.length === 0) return null;

  /* Largest loop = outer perimeter (courtyards would be smaller inner). */
  const outer = loops.reduce((best, loop) =>
    perimeterOf(loop) > perimeterOf(best) ? loop : best,
  );
  if (outer.length < 3) return null;

  const ccw = ensureCCW(outer);
  const simplified = simplifyDP(ccw, BALCONY_DETECT.simplifyToleranceM);
  if (simplified.length < 3) return null;
  if (isSelfIntersecting(simplified)) return null;

  return simplified;
}

interface WorldTri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
}

function collectTopFacingTriangles(meshes: Mesh[]): WorldTri[] {
  const tris: WorldTri[] = [];
  const localA = new Vector3();
  const localB = new Vector3();
  const localC = new Vector3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!pos) continue;
    const index = mesh.geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3 + 0) : t * 3 + 0;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      localA.fromBufferAttribute(pos, i0);
      localB.fromBufferAttribute(pos, i1);
      localC.fromBufferAttribute(pos, i2);
      const a = localA.clone().applyMatrix4(mesh.matrixWorld);
      const b = localB.clone().applyMatrix4(mesh.matrixWorld);
      const c = localC.clone().applyMatrix4(mesh.matrixWorld);
      const e1 = b.clone().sub(a);
      const e2 = c.clone().sub(a);
      const normal = e1.cross(e2);
      const mag = normal.length();
      if (mag < 1e-9) continue;
      normal.multiplyScalar(1 / mag);
      if (normal.y > TOP_NORMAL_THRESHOLD) tris.push({ a, b, c });
    }
  }
  return tris;
}

interface BoundaryEdge {
  v0: Vector2;
  v1: Vector2;
}

function buildBoundaryEdges(tris: WorldTri[]): BoundaryEdge[] {
  const edgeCounts = new Map<string, { count: number; v0: Vector2; v1: Vector2 }>();
  const add = (p: Vector3, q: Vector3) => {
    const key = canonKey(p.x, p.z, q.x, q.z);
    const ex = edgeCounts.get(key);
    if (ex) ex.count += 1;
    else edgeCounts.set(key, { count: 1, v0: new Vector2(p.x, p.z), v1: new Vector2(q.x, q.z) });
  };
  for (const t of tris) {
    add(t.a, t.b);
    add(t.b, t.c);
    add(t.c, t.a);
  }
  const out: BoundaryEdge[] = [];
  for (const entry of edgeCounts.values()) {
    if (entry.count === 1) out.push({ v0: entry.v0, v1: entry.v1 });
  }
  return out;
}

function canonKey(x0: number, z0: number, x1: number, z1: number): string {
  const qx0 = Math.round(x0 * EDGE_QUANTISE_PER_M);
  const qz0 = Math.round(z0 * EDGE_QUANTISE_PER_M);
  const qx1 = Math.round(x1 * EDGE_QUANTISE_PER_M);
  const qz1 = Math.round(z1 * EDGE_QUANTISE_PER_M);
  const a = `${qx0}|${qz0}`;
  const b = `${qx1}|${qz1}`;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function chainEdgesIntoLoops(edges: BoundaryEdge[]): Vector2[][] {
  const endpointIndex = new Map<string, BoundaryEdge[]>();
  const pointKey = (p: Vector2): string =>
    `${Math.round(p.x * EDGE_QUANTISE_PER_M)}|${Math.round(p.y * EDGE_QUANTISE_PER_M)}`;
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
  const near = (a: Vector2, b: Vector2) =>
    Math.abs(a.x - b.x) < CHAIN_EPSILON_M && Math.abs(a.y - b.y) < CHAIN_EPSILON_M;

  for (const seed of edges) {
    if (used.has(seed)) continue;
    const loop: Vector2[] = [seed.v0.clone()];
    let current = seed.v1.clone();
    used.add(seed);
    let safety = edges.length + 5;
    while (safety-- > 0) {
      loop.push(current.clone());
      if (near(current, seed.v0)) break;
      const candidates = endpointIndex.get(pointKey(current)) ?? [];
      let next: BoundaryEdge | null = null;
      let reversed = false;
      for (const cand of candidates) {
        if (used.has(cand)) continue;
        if (near(cand.v0, current)) { next = cand; reversed = false; break; }
        if (near(cand.v1, current)) { next = cand; reversed = true; break; }
      }
      if (!next) break;
      used.add(next);
      current = (reversed ? next.v0 : next.v1).clone();
    }
    if (loop.length >= 2 && near(loop[loop.length - 1], loop[0])) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function perimeterOf(loop: Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/* ═══════════════════════════════════════════════════════════════════
   Polygon – rectangle subtraction
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Compute slabPoly \ rect as the union of four disjoint regions:
 *   - West:  {x < rect.minX}
 *   - East:  {x > rect.maxX}
 *   - South: {rect.minX <= x <= rect.maxX, z < rect.minZ}
 *   - North: {rect.minX <= x <= rect.maxX, z > rect.maxZ}
 * Each is computed via Sutherland-Hodgman half-plane clipping. Empty
 * fragments are discarded.
 *
 * Edge classification for `railSegments`: after clipping, an edge is
 * "synthetic" (lies along a wall AABB boundary line) iff both endpoints
 * are within `SYNTHETIC_EPS_M` of the same rect boundary line. Real
 * edges get a railing; synthetic edges do not.
 */
function subtractRectangle(
  slabPoly: Vector2[],
  rect: RectBounds,
  slabY: number,
): BalconyPolygon[] {
  const fragments: Vector2[][] = [];

  /* West: x < minX → keep where (x - minX) <= 0. */
  fragments.push(
    clipHalfPlane(slabPoly, (p) => p.x - rect.minX),
  );
  /* East: x > maxX → keep where (maxX - x) <= 0. */
  fragments.push(
    clipHalfPlane(slabPoly, (p) => rect.maxX - p.x),
  );
  /* South: minX<=x<=maxX AND z<minZ. 3 half-plane clips. */
  const southBand = clipHalfPlane(
    clipHalfPlane(slabPoly, (p) => rect.minX - p.x),
    (p) => p.x - rect.maxX,
  );
  fragments.push(clipHalfPlane(southBand, (p) => p.y - rect.minZ));
  /* North: minX<=x<=maxX AND z>maxZ. 3 half-plane clips. */
  const northBand = clipHalfPlane(
    clipHalfPlane(slabPoly, (p) => rect.minX - p.x),
    (p) => p.x - rect.maxX,
  );
  fragments.push(clipHalfPlane(northBand, (p) => rect.maxZ - p.y));

  const out: BalconyPolygon[] = [];
  for (const frag of fragments) {
    if (frag.length < 3) continue;
    const area = Math.abs(signedPolygonArea(frag));
    if (area < 1e-6) continue;
    const railSegments = classifyRealEdges(frag, rect);
    out.push({
      points: ensureCCW(frag),
      railSegments,
      slabY,
      areaM2: area,
    });
  }
  return out;
}

/**
 * Sutherland-Hodgman single half-plane clip. Keep the portion of
 * `polygon` where `f(p) <= 0` (inside-of-half-plane convention).
 */
function clipHalfPlane(
  polygon: Vector2[],
  f: (p: Vector2) => number,
): Vector2[] {
  const n = polygon.length;
  if (n === 0) return [];
  const out: Vector2[] = [];
  let prev = polygon[n - 1];
  let prevSide = f(prev);
  for (let i = 0; i < n; i++) {
    const curr = polygon[i];
    const currSide = f(curr);
    const prevInside = prevSide <= 0;
    const currInside = currSide <= 0;
    if (prevInside && currInside) {
      out.push(curr);
    } else if (prevInside && !currInside) {
      const t = prevSide / (prevSide - currSide);
      out.push(new Vector2(
        prev.x + t * (curr.x - prev.x),
        prev.y + t * (curr.y - prev.y),
      ));
    } else if (!prevInside && currInside) {
      const t = prevSide / (prevSide - currSide);
      out.push(new Vector2(
        prev.x + t * (curr.x - prev.x),
        prev.y + t * (curr.y - prev.y),
      ));
      out.push(curr);
    }
    prev = curr;
    prevSide = currSide;
  }
  return out;
}

/**
 * Classify each edge of the balcony polygon. An edge is "real" (gets a
 * railing) iff it does NOT lie along any of the wall-AABB boundary
 * lines. Synthetic closures (added by the clip) are filtered out.
 */
function classifyRealEdges(
  polygon: Vector2[],
  rect: RectBounds,
): Array<{ start: Vector2; end: Vector2 }> {
  const n = polygon.length;
  const out: Array<{ start: Vector2; end: Vector2 }> = [];
  const onLine = (a: number, b: number, target: number) =>
    Math.abs(a - target) < SYNTHETIC_EPS_M &&
    Math.abs(b - target) < SYNTHETIC_EPS_M;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const synthetic =
      onLine(a.x, b.x, rect.minX) ||
      onLine(a.x, b.x, rect.maxX) ||
      onLine(a.y, b.y, rect.minZ) ||
      onLine(a.y, b.y, rect.maxZ);
    if (!synthetic) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len >= 1e-4) {
        out.push({ start: a.clone(), end: b.clone() });
      }
    }
  }
  return out;
}
