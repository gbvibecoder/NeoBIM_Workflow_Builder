/**
 * Spec Merge — fan-in merge for parallel BriefSpec mutations.
 *
 * TR-028 (Item Decomposer), TR-030 (Trim Specifier), and TR-031
 * (Material Resolver) each run in parallel and each mutate a
 * copy of the BriefSpec. This module provides a structured merge
 * that preserves all three branches' mutations without clobber.
 *
 * @module
 */

import type { BriefSpec, BriefFurniture, BriefMaterial, TrimItem } from "@/features/brief-to-ifc/v3/types";

// ─── Type guard ──────────────────────────────────────────────────────────────

/** Returns true when `input` looks like a BriefSpec. Requires ALL five
 *  mandatory BriefSpec keys to be present — eliminates false positives
 *  on partial data or unrelated objects that happen to share a key. */
export function isBriefSpecLike(input: unknown): input is BriefSpec {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  // BriefSpec schema mandates: project, site, spaces, elements, materials.
  // All five must be present — partial matches are not BriefSpecs.
  const mandatoryKeys = ["project", "site", "spaces", "elements", "materials"] as const;
  return mandatoryKeys.every(key => key in obj);
}

// ─── Deep clone helper ───────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ─── Core merge ──────────────────────────────────────────────────────────────

/**
 * Merge multiple BriefSpec copies that were independently mutated by
 * parallel nodes (TR-028, TR-030, TR-031).
 *
 * Algorithm:
 *  1. Start from specs[0] as the deep-cloned base.
 *  2. For each overlay spec:
 *     - furniture[].parts: if overlay has populated parts for an item
 *       that's empty on base, copy overlay's parts.
 *     - trim[]: if overlay has non-empty trim and base is empty, copy.
 *     - material_id normalization: overlay's canonical material_id wins.
 *     - designRationale[]: union (deduplicate by itemId).
 *     - all other fields: last-populated-wins (never overwrite populated
 *       with empty/undefined).
 */
export function mergeBriefSpecs(specs: BriefSpec[]): BriefSpec {
  if (specs.length === 0) {
    throw new Error("mergeBriefSpecs requires at least one spec");
  }
  if (specs.length === 1) return deepClone(specs[0]);

  const base = deepClone(specs[0]);

  for (let i = 1; i < specs.length; i++) {
    const overlay = specs[i];
    mergeParts(base, overlay);
    mergeTrim(base, overlay);
    mergeMaterials(base, overlay);
    mergeDesignRationale(base, overlay);
    mergeScalarFields(base, overlay);
  }

  return base;
}

// ─── Per-field merge strategies ──────────────────────────────────────────────

/** Merge furniture items and their parts from overlay into base.
 *  Strategy: union by id. For parts within each item, also union by id
 *  (overlay wins on conflict). New items/parts from overlay are added. */
function mergeParts(base: BriefSpec, overlay: BriefSpec): void {
  if (!overlay.furniture?.length) return;
  if (!base.furniture) base.furniture = [];

  const baseMap = new Map<string, BriefFurniture>();
  for (const item of base.furniture) baseMap.set(item.id, item);

  for (const oItem of overlay.furniture) {
    const bItem = baseMap.get(oItem.id);
    if (!bItem) {
      // Overlay added a new furniture item — include it
      base.furniture.push(deepClone(oItem));
      baseMap.set(oItem.id, base.furniture[base.furniture.length - 1]);
      continue;
    }
    // Union parts by id — overlay wins on conflict, new parts are added
    if (oItem.parts && oItem.parts.length > 0) {
      if (!bItem.parts || bItem.parts.length === 0) {
        // Base has no parts — take overlay's entirely
        bItem.parts = deepClone(oItem.parts);
      } else {
        // Both have parts — union by id, overlay wins on conflict
        const basePartMap = new Map(bItem.parts.map(p => [p.id, p]));
        for (const oPart of oItem.parts) {
          if (basePartMap.has(oPart.id)) {
            // Overlay wins — replace base part
            const idx = bItem.parts.findIndex(p => p.id === oPart.id);
            if (idx >= 0) bItem.parts[idx] = deepClone(oPart);
          } else {
            // New part from overlay — add it
            bItem.parts.push(deepClone(oPart));
          }
        }
      }
    }
    // Copy material_id if overlay has a different one (overlay wins)
    if (oItem.material_id && oItem.material_id !== bItem.material_id) {
      bItem.material_id = oItem.material_id;
    }
  }
}

/** If overlay has non-empty trim and base is empty, adopt overlay's trim.
 *  If both have trim, union by id (overlay wins on conflict). */
function mergeTrim(base: BriefSpec, overlay: BriefSpec): void {
  if (!overlay.trim?.length) return;
  if (!base.trim || base.trim.length === 0) {
    base.trim = deepClone(overlay.trim);
    return;
  }
  // Union by id
  const existing = new Map<string, TrimItem>();
  for (const item of base.trim) existing.set(item.id, item);
  for (const oItem of overlay.trim) {
    if (!existing.has(oItem.id)) {
      base.trim.push(deepClone(oItem));
    }
  }
}

/** Normalize material_ids: if overlay provides canonical material_id
 *  values that differ from base, overlay wins. Applies to:
 *  - base.materials[].id
 *  - base.furniture[].material_id
 *  - base.furniture[].parts[].material_id
 *  - base.trim[].material_id */
function mergeMaterials(base: BriefSpec, overlay: BriefSpec): void {
  if (!overlay.materials?.length) return;
  if (!base.materials) base.materials = [];

  // Build a normalization map: for each overlay material, record its id
  const overlayMaterialIds = new Set<string>();
  const overlayMaterialMap = new Map<string, BriefMaterial>();
  for (const m of overlay.materials) {
    overlayMaterialIds.add(m.id);
    overlayMaterialMap.set(m.id, m);
  }

  // Detect newly normalized materials: materials in overlay but not in base
  const baseMaterialIds = new Set(base.materials.map(m => m.id));
  for (const oMat of overlay.materials) {
    if (!baseMaterialIds.has(oMat.id)) {
      // New material added by the resolver — adopt it
      base.materials.push(deepClone(oMat));
      baseMaterialIds.add(oMat.id);
    } else {
      // Update existing material properties (overlay wins for rgb, method, etc.)
      const bIdx = base.materials.findIndex(m => m.id === oMat.id);
      if (bIdx >= 0) {
        base.materials[bIdx] = deepClone(oMat);
      }
    }
  }

  // Apply material_id normalization across furniture + parts + trim
  // This handles cases where Material Resolver renamed material IDs
  // We look for a mapping pattern: old_id → new_id
  // For now, overlay material assignments on furniture items win
  if (overlay.furniture) {
    for (const oItem of overlay.furniture) {
      const bItem = base.furniture?.find(f => f.id === oItem.id);
      if (bItem && oItem.material_id) {
        bItem.material_id = oItem.material_id;
      }
      // Parts material_id normalization
      if (bItem?.parts && oItem.parts) {
        for (const oPart of oItem.parts) {
          const bPart = bItem.parts.find(p => p.id === oPart.id);
          if (bPart && oPart.material_id) {
            bPart.material_id = oPart.material_id;
          }
        }
      }
    }
  }

  if (overlay.trim) {
    for (const oTrim of overlay.trim) {
      const bTrim = base.trim?.find(t => t.id === oTrim.id);
      if (bTrim && oTrim.material_id) {
        bTrim.material_id = oTrim.material_id;
      }
    }
  }
}

/** Union designRationale entries, deduplicating by itemId. */
function mergeDesignRationale(base: BriefSpec, overlay: BriefSpec): void {
  if (!overlay.designRationale?.length) return;
  if (!base.designRationale || base.designRationale.length === 0) {
    base.designRationale = deepClone(overlay.designRationale);
    return;
  }
  const seen = new Set(base.designRationale.map(r => r.itemId));
  for (const entry of overlay.designRationale) {
    if (!seen.has(entry.itemId)) {
      base.designRationale.push(deepClone(entry));
      seen.add(entry.itemId);
    }
  }
}

/** For scalar/structural fields: last-populated-wins but never overwrite
 *  a populated field with empty/undefined. */
function mergeScalarFields(base: BriefSpec, overlay: BriefSpec): void {
  // archetype
  if (overlay.archetype && !base.archetype) {
    base.archetype = overlay.archetype;
  }
  // global_parameters
  if (overlay.global_parameters && !base.global_parameters) {
    base.global_parameters = deepClone(overlay.global_parameters);
  }
  // openings
  if (overlay.openings?.length && (!base.openings || base.openings.length === 0)) {
    base.openings = deepClone(overlay.openings);
  }
  // lighting
  if (overlay.lighting && !base.lighting) {
    base.lighting = deepClone(overlay.lighting);
  }
  // assumptions_made
  if (overlay.assumptions_made?.length && (!base.assumptions_made || base.assumptions_made.length === 0)) {
    base.assumptions_made = deepClone(overlay.assumptions_made);
  }
}
