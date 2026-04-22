/* ─── IFC Enhance — classifier ────────────────────────────────────────────
   Every mesh in the model gets exactly one EnhanceTag. Tags drive material
   assignment in the catalog and Tier 1 engine. */

import { Box3, Group, type Mesh, Vector3 } from "three";
import type { EnhanceTag } from "./types";

/* IFC type codes — inlined for worker isolation (same as Viewport.tsx:28-60). */
const IFCWALL = 2391406946;
const IFCWALLSTANDARDCASE = 3512223829;
const IFCWINDOW = 3304561284;
const IFCDOOR = 395920057;
const IFCSLAB = 1529196076;
const IFCCOLUMN = 843113511;
const IFCBEAM = 753842376;
const IFCSTAIR = 331165859;
const IFCSTAIRFLIGHT = 4252922144;
const IFCRAILING = 2262370178;
const IFCROOF = 2016517767;
const IFCSPACE = 3856911033;

export interface WallPsetEntry {
  isExternal: boolean | null;
  fireRating: string | null;
}

/** Union bounding box for a mesh group (every Mesh in the array). */
function unionBox(meshes: Mesh[]): Box3 {
  const box = new Box3();
  for (const m of meshes) box.expandByObject(m);
  return box;
}

export function computeOuterBox(modelGroup: Group): Box3 {
  return new Box3().setFromObject(modelGroup);
}

/**
 * True iff meshBox touches any outer face of outerBox within `threshold`
 * (world-space metres). Used as the geometric wall-exterior heuristic when
 * Pset_WallCommon data is untrustworthy or missing.
 */
function touchesOuterFace(meshBox: Box3, outerBox: Box3, threshold: number): boolean {
  if (meshBox.isEmpty()) return false;
  return (
    Math.abs(meshBox.min.x - outerBox.min.x) <= threshold ||
    Math.abs(meshBox.max.x - outerBox.max.x) <= threshold ||
    Math.abs(meshBox.min.z - outerBox.min.z) <= threshold ||
    Math.abs(meshBox.max.z - outerBox.max.z) <= threshold
  );
}

/**
 * Decide whether Pset_WallCommon.IsExternal data is trustworthy for this
 * model. Rules:
 *   - If >80% of walls are null (absent Pset), untrustworthy.
 *   - If 100% are the same value (all true or all false), untrustworthy —
 *     basic.ifc ships all-false; treating that as "every wall is internal"
 *     would give a 100%-plaster building.
 */
function psetDataIsTrustworthy(
  wallExpressIDs: Set<number>,
  wallPsets: Map<number, WallPsetEntry>,
): boolean {
  if (wallExpressIDs.size === 0) return false;

  let nullCount = 0;
  let trueCount = 0;
  let falseCount = 0;
  for (const eid of wallExpressIDs) {
    const v = wallPsets.get(eid)?.isExternal ?? null;
    if (v === null) nullCount++;
    else if (v === true) trueCount++;
    else falseCount++;
  }

  const total = wallExpressIDs.size;
  const nullRatio = nullCount / total;
  if (nullRatio > 0.8) return false;

  /* All-same verdicts are diagnostic of a corrupt/incomplete Pset — basic.ifc
     flags 72/72 internal, realistic.ifc typically has a healthy mix. */
  const nonNull = trueCount + falseCount;
  if (nonNull > 0 && (trueCount === nonNull || falseCount === nonNull)) return false;

  return true;
}

export interface ClassifyResult {
  tags: Map<number, EnhanceTag>;
  counts: Partial<Record<EnhanceTag, number>>;
  /** True iff wall classification used Pset data; false iff it fell through
      to the geometric heuristic. Useful diagnostic. */
  wallsUsedPset: boolean;
}

export function classifyAll(
  meshMap: ReadonlyMap<number, Mesh[]>,
  typeMap: ReadonlyMap<number, number>,
  wallPsets: Map<number, WallPsetEntry>,
  modelGroup: Group,
): ClassifyResult {
  const tags = new Map<number, EnhanceTag>();
  const counts: Partial<Record<EnhanceTag, number>> = {};
  const bump = (tag: EnhanceTag) => { counts[tag] = (counts[tag] ?? 0) + 1; };

  const outerBox = computeOuterBox(modelGroup);
  const size = outerBox.getSize(new Vector3());
  const minDim = Math.min(size.x, size.y, size.z);
  const outerFaceThreshold = Math.max(minDim * 0.05, 0.1); // at least 10 cm

  /* Identify slabs up-front so we can pick the topmost as roof. */
  const slabMaxZ = new Map<number, number>();
  for (const [eid, meshes] of meshMap.entries()) {
    if (typeMap.get(eid) === IFCSLAB) {
      slabMaxZ.set(eid, unionBox(meshes).max.y);
    }
  }
  const topSlabZ = slabMaxZ.size > 0
    ? Math.max(...slabMaxZ.values())
    : Number.NEGATIVE_INFINITY;
  const topSlabThreshold = Math.max(minDim * 0.02, 0.05);

  /* Wall pool for the data-sanity check. */
  const wallExpressIDs = new Set<number>();
  for (const [eid, tid] of typeMap.entries()) {
    if (tid === IFCWALL || tid === IFCWALLSTANDARDCASE) wallExpressIDs.add(eid);
  }
  const trustPset = psetDataIsTrustworthy(wallExpressIDs, wallPsets);

  for (const [expressID, meshes] of meshMap.entries()) {
    const ifcType = typeMap.get(expressID);

    let tag: EnhanceTag = "other";

    if (ifcType === IFCSPACE) {
      tag = "space";
    } else if (ifcType === IFCWINDOW) {
      tag = "window-glass";
    } else if (ifcType === IFCDOOR) {
      tag = "door";
    } else if (ifcType === IFCCOLUMN) {
      tag = "column";
    } else if (ifcType === IFCBEAM) {
      tag = "beam";
    } else if (ifcType === IFCSTAIR || ifcType === IFCSTAIRFLIGHT) {
      tag = "stair";
    } else if (ifcType === IFCRAILING) {
      tag = "railing";
    } else if (ifcType === IFCROOF) {
      tag = "roof-slab";
    } else if (ifcType === IFCSLAB) {
      const zMax = slabMaxZ.get(expressID);
      tag = zMax !== undefined && Math.abs(zMax - topSlabZ) <= topSlabThreshold
        ? "roof-slab"
        : "floor-slab";
    } else if (ifcType === IFCWALL || ifcType === IFCWALLSTANDARDCASE) {
      const pset = wallPsets.get(expressID);
      if (trustPset && pset?.isExternal === true) {
        tag = "wall-exterior";
      } else if (trustPset && pset?.isExternal === false) {
        tag = "wall-interior";
      } else {
        /* Fall through to geometry — tougher but reliable for basic.ifc.
           A wall mesh whose bounding box kisses any outer vertical face of
           the model AABB is "exterior"; everything else is "interior". */
        const meshBox = unionBox(meshes);
        tag = touchesOuterFace(meshBox, outerBox, outerFaceThreshold)
          ? "wall-exterior"
          : "wall-interior";
      }
    }

    tags.set(expressID, tag);
    bump(tag);
  }

  /* Diagnostic — helps debug basic.ifc vs realistic.ifc classifier outcomes. */
  // eslint-disable-next-line no-console
  console.info("[enhance] classified:", counts, {
    totalWalls: wallExpressIDs.size,
    usedPset: trustPset,
  });

  return { tags, counts, wallsUsedPset: trustPset };
}
