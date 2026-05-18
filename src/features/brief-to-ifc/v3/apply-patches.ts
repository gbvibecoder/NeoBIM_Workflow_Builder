/**
 * Apply-Patches utility (Phase Beta 3).
 *
 * Pure function that takes a BriefSpec and a list of SpecPatch entries,
 * returns a NEW BriefSpec with the patches applied. Does NOT mutate input.
 */

import type { BriefSpec, SpecPatch } from "./types";

/**
 * Apply patches to a BriefSpec. Returns a new object — input is not mutated.
 */
export function applyPatches(spec: BriefSpec, patches: SpecPatch[]): BriefSpec {
  // Deep clone to avoid mutation
  const patched: BriefSpec = JSON.parse(JSON.stringify(spec));

  for (const patch of patches) {
    switch (patch.patch_type) {
      case "force_parts":
        applyForceParts(patched, patch);
        break;
      case "add_position":
        applyAddPosition(patched, patch);
        break;
      case "fix_size":
        applyFixSize(patched, patch);
        break;
      case "add_trim":
        applyAddTrim(patched, patch);
        break;
      case "increase_decomposition":
        applyIncreaseDecomposition(patched, patch);
        break;
      default:
        // eslint-disable-next-line no-console
        console.warn(`[apply-patches] Unknown patch type: ${(patch as SpecPatch).patch_type}`);
    }
  }

  return patched;
}

// ─── Per-type patch application ──────────────────────────────────────────

function applyForceParts(spec: BriefSpec, patch: SpecPatch): void {
  const item = spec.furniture?.find(f => f.id === patch.item_id);
  if (!item) {
    // eslint-disable-next-line no-console
    console.warn(`[apply-patches] force_parts: item ${patch.item_id} not found in furniture.`);
    return;
  }
  item.must_build = true;
  item.force_parts = true;
  // Mark all existing parts as mandatory
  if (item.parts) {
    for (const part of item.parts) {
      part.mandatory = true;
    }
  }
  // Set minimum part count hint from payload
  const payload = patch.payload as Record<string, unknown> | undefined;
  if (payload?.minimum_parts_count && typeof payload.minimum_parts_count === "number") {
    item.requested_part_count = payload.minimum_parts_count;
  }
}

function applyAddPosition(spec: BriefSpec, patch: SpecPatch): void {
  const payload = patch.payload as Record<string, unknown> | undefined;
  if (!payload) return;

  // Apply to furniture items with matching id
  const item = spec.furniture?.find(f => f.id === patch.item_id);
  if (!item) {
    // eslint-disable-next-line no-console
    console.warn(`[apply-patches] add_position: item ${patch.item_id} not found.`);
    return;
  }

  // Also update designRationale if present
  if (spec.designRationale) {
    const entry = spec.designRationale.find(r => r.itemId === patch.item_id);
    if (entry && Array.isArray(payload.position)) {
      entry.position = payload.position as [number, number, number];
      if (typeof payload.rotation_z_rad === "number") {
        entry.rotation_z_rad = payload.rotation_z_rad;
      }
    }
  }
}

function applyFixSize(spec: BriefSpec, patch: SpecPatch): void {
  const payload = patch.payload as Record<string, unknown> | undefined;
  if (!payload?.dims_m || !Array.isArray(payload.dims_m)) return;

  const item = spec.furniture?.find(f => f.id === patch.item_id);
  if (item?.bounding_box) {
    item.bounding_box = payload.dims_m as [number, number, number];
  }

  // Also fix in elements array
  const element = spec.elements?.find(e => e.id === patch.item_id);
  if (element) {
    element.dims_m = payload.dims_m as [number, number, number];
  }
}

function applyAddTrim(spec: BriefSpec, patch: SpecPatch): void {
  const payload = patch.payload as Record<string, unknown> | undefined;
  if (!payload?.trim_item || typeof payload.trim_item !== "object") return;

  if (!spec.trim) spec.trim = [];
  const trimItem = payload.trim_item as Record<string, unknown>;

  // Only add if not already present
  const exists = spec.trim.some(t => t.id === trimItem.id);
  if (!exists) {
    spec.trim.push(trimItem as BriefSpec["trim"] extends Array<infer T> ? T : never);
  }
}

function applyIncreaseDecomposition(spec: BriefSpec, patch: SpecPatch): void {
  const payload = patch.payload as Record<string, unknown> | undefined;
  if (!payload?.target_part_count || typeof payload.target_part_count !== "number") return;

  const item = spec.furniture?.find(f => f.id === patch.item_id);
  if (!item) {
    // eslint-disable-next-line no-console
    console.warn(`[apply-patches] increase_decomposition: item ${patch.item_id} not found.`);
    return;
  }
  item.requested_part_count = payload.target_part_count;
}
