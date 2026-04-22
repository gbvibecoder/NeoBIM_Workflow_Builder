/* ─── IFC Enhance — Tier 2 placement utilities ───────────────────────────
   Pure functions. No renderer deps. Deterministic given a seed. */

import { Box3, type Group, Vector2, Vector3 } from "three";

export interface FootprintRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface BuildingBoundsResult {
  box: Box3;
  center: Vector3;
  footprint: FootprintRect;
  /** Max horizontal extent (m). */
  maxExtentM: number;
  /** Max 3D extent (m) — includes height. */
  maxExtent3D: number;
}

/**
 * AABB of everything under `modelGroup`. Assumes Y-up (matches Viewport
 * setup). Returns a footprint rect over X/Z plus min/max Y for ground
 * placement.
 */
export function getBuildingBounds(modelGroup: Group): BuildingBoundsResult {
  const box = new Box3().setFromObject(modelGroup);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const footprint: FootprintRect = {
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    minY: box.min.y,
    maxY: box.max.y,
  };
  const maxExtentM = Math.max(size.x, size.z);
  const maxExtent3D = Math.max(size.x, size.y, size.z);
  return { box, center, footprint, maxExtentM, maxExtent3D };
}

/**
 * Derive a deterministic 32-bit seed from a bounding box so the same
 * building always scatters trees the same way. Uses cyrb53-style mixing on
 * the six AABB scalars.
 */
export function seedFromBox(box: Box3): number {
  const values = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const v of values) {
    /* Quantise to mm so floating-point noise doesn't make seeds drift. */
    const quant = Math.round(v * 1000) | 0;
    h1 = Math.imul(h1 ^ quant, 2654435761);
    h2 = Math.imul(h2 ^ quant, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/**
 * Mulberry32 — 32-bit seedable PRNG. Returns a function yielding 0..1.
 * 6 LoC, no dependency, entirely deterministic.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Axis-aligned point-in-rect test. */
export function pointInRect(x: number, z: number, rect: FootprintRect): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * Signed XZ distance from (x,z) to a rectangle. Positive outside, negative
 * (or zero) inside. Useful for "distance to nearest wall/road edge".
 */
export function signedDistToRect(x: number, z: number, rect: FootprintRect): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  const outside = Math.hypot(dx, dz);
  if (outside > 0) return outside;
  /* Inside — negative, equal to -(distance to nearest edge). */
  const insideDist = Math.min(
    x - rect.minX,
    rect.maxX - x,
    z - rect.minZ,
    rect.maxZ - z,
  );
  return -insideDist;
}

export interface PoissonParams {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  minSpacingM: number;
  /** Max candidate generations before giving up. */
  maxAttempts: number;
  /** Hard cap on accepted points. */
  maxPoints: number;
  rng: () => number;
  /** Returns true to reject a candidate. */
  rejectIf: (x: number, z: number) => boolean;
}

/**
 * Best-candidate Poisson-disk sampling in a 2D rectangle. Simpler than the
 * full Bridson algorithm — good enough for scattering ≤50 trees with
 * natural-looking spacing. Deterministic given the rng.
 */
export function poissonDiskSample(params: PoissonParams): Vector2[] {
  const { bounds, minSpacingM, maxAttempts, maxPoints, rng, rejectIf } = params;
  const accepted: Vector2[] = [];
  const minSpacingSq = minSpacingM * minSpacingM;

  const widthX = bounds.maxX - bounds.minX;
  const widthZ = bounds.maxZ - bounds.minZ;
  if (widthX <= 0 || widthZ <= 0) return accepted;

  for (let attempt = 0; attempt < maxAttempts && accepted.length < maxPoints; attempt++) {
    const x = bounds.minX + rng() * widthX;
    const z = bounds.minZ + rng() * widthZ;
    if (rejectIf(x, z)) continue;

    let tooClose = false;
    for (const p of accepted) {
      const dx = p.x - x;
      const dz = p.y - z;
      if (dx * dx + dz * dz < minSpacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    accepted.push(new Vector2(x, z));
  }

  return accepted;
}

/**
 * Axis-aligned expand of a rect by a uniform buffer. Useful for
 * "footprint + 2.5m exclusion".
 */
export function expandRect(rect: FootprintRect, by: number): FootprintRect {
  return {
    minX: rect.minX - by,
    maxX: rect.maxX + by,
    minZ: rect.minZ - by,
    maxZ: rect.maxZ + by,
    minY: rect.minY,
    maxY: rect.maxY,
  };
}
