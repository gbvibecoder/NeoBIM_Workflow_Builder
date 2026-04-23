/* ─── IFC Enhance — Tier 3 roof detector ──────────────────────────────────
   Pure helpers that decide which roof treatment to apply and locate the
   existing roof-slab meshes in the model.

   Storey detection is deliberately conservative: when the classifier can't
   distinguish a floor slab from a roof slab (or the model has neither), we
   fall through to "flat-terrace" so uncertain inputs always produce the
   safer architecturally-plausible result. */

import type { Mesh } from "three";
import type { EnhanceTag, RoofStyle } from "../types";

type EnhanceTagCounts = Partial<Record<EnhanceTag, number>>;

/**
 * Infer the storey count from the classifier's tag histogram.
 *
 * Heuristic: each non-topmost slab is a `floor-slab`, and the topmost slab
 * is always retagged to `roof-slab` by the classifier (see classifier.ts).
 * The storey count is therefore (# floor-slabs) + (1 if a roof-slab exists).
 * Result is floored at 1 storey.
 *
 * Fallback: if the classifier saw neither a floor-slab nor a roof-slab, we
 * cannot tell what's going on — return 2 so the style-resolver picks
 * flat-terrace rather than slicing a gable onto something that might
 * already have a roof authored in the IFC.
 */
export function detectStoreyCount(counts: EnhanceTagCounts): number {
  const floors = counts["floor-slab"];
  const roofs = counts["roof-slab"] ?? 0;
  if (floors === undefined && roofs === 0) return 2;
  const total = (floors ?? 0) + (roofs > 0 ? 1 : 0);
  return Math.max(1, total);
}

/**
 * Map the user's style preference + detected storey count to a concrete
 * roof style. "auto" → gable for single-storey, flat-terrace otherwise.
 * An explicit user choice ("gable" or "flat-terrace") wins regardless of
 * storey count so they can always override.
 */
export function resolveRoofStyle(
  userStyle: RoofStyle,
  storeyCount: number,
): "gable" | "flat-terrace" {
  if (userStyle === "gable") return "gable";
  if (userStyle === "flat-terrace") return "flat-terrace";
  /* userStyle === "auto" */
  return storeyCount === 1 ? "gable" : "flat-terrace";
}

/**
 * Collect every Three.js Mesh whose expressID the classifier tagged
 * "roof-slab". Returns a flat array — a single IFC element may have
 * multiple geometry parts, all of which must be hidden together.
 */
export function findRoofSlabMeshes(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): Mesh[] {
  const result: Mesh[] = [];
  for (const [expressID, meshes] of meshMap.entries()) {
    if (tags.get(expressID) === "roof-slab") {
      result.push(...meshes);
    }
  }
  return result;
}
