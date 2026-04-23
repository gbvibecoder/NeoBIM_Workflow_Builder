/* ─── IFC Enhance — Tier 3 roof footprint extractor ──────────────────────
   Axis-aligned MVP: computes the AABB of every roof-slab mesh, projects
   it onto the XZ plane, and records the top Y. Non-rectangular or rotated
   footprints degrade gracefully to their AABB — better footprint handling
   (polygon skeletonization, hip roofs on L-shaped plans) is Phase 3.5c
   territory. */

import { Box3, type Mesh } from "three";

export interface RoofFootprint {
  /** Axis-aligned world-space bounds on the XZ plane. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Top surface Y — parapet and gable-eave base both sit here. */
  topY: number;
  /** Convenience: precomputed centre of the footprint. */
  centerX: number;
  centerZ: number;
  /** Convenience: extents. */
  widthM: number; // X span
  depthM: number; // Z span
  /** Which axis is longer — drives "ridge along longer axis" heuristic. */
  longerAxis: "x" | "z";
}

/**
 * Extract an axis-aligned roof footprint from a set of roof-slab meshes.
 * Each mesh is expanded into a shared Box3; the world-space AABB becomes
 * the footprint. Throws only if the mesh set is empty — callers should
 * guard that path (the engine does, returning `resolvedStyle: "skipped"`).
 *
 * We trust Box3.expandByObject to respect world transforms so nested
 * groups or translated meshes report the right bounds.
 */
export function extractFootprint(meshes: Mesh[]): RoofFootprint {
  if (meshes.length === 0) {
    throw new Error("extractFootprint: no roof-slab meshes supplied");
  }

  const box = new Box3();
  for (const mesh of meshes) box.expandByObject(mesh);

  if (box.isEmpty()) {
    throw new Error("extractFootprint: union bounding box is empty");
  }

  const minX = box.min.x;
  const maxX = box.max.x;
  const minZ = box.min.z;
  const maxZ = box.max.z;
  const topY = box.max.y;

  const widthM = maxX - minX;
  const depthM = maxZ - minZ;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    topY,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    widthM,
    depthM,
    longerAxis: widthM >= depthM ? "x" : "z",
  };
}
