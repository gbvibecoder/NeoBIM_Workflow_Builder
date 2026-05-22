/**
 * Apply-Patches utility tests (Phase Beta 3).
 */

import { describe, it, expect } from "vitest";
import { applyPatches } from "../apply-patches";
import type { BriefSpec, SpecPatch } from "../types";

function makeSpec(): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Test", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [{ id: "e1", type: "wall", origin_world_m: [0,0,0], dims_m: [10, 0.2, 3], material_id: "m1", description: "Wall", object_type: "Wall", tag: "W1" }],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [
      {
        id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk",
        parts: [
          { id: "p1", subtype: "top", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "p2", subtype: "leg", origin_local_m: [0,0,0], dims_m: [0.05,0.05,0.7], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
        ],
      },
    ],
    designRationale: [
      { itemId: "f1", position: [2.0, 1.5, 0], rotation_z_rad: 0, rationale: "Against north wall" },
    ],
  };
}

describe("applyPatches", () => {
  it("force_parts sets must_build + force_parts + mandatory on all parts", () => {
    const patch: SpecPatch = {
      item_id: "f1",
      patch_type: "force_parts",
      rationale: "Item was collapsed in previous build",
      payload: { item_id: "f1", minimum_parts_count: 5 },
    };

    const patched = applyPatches(makeSpec(), [patch]);
    const item = patched.furniture!.find(f => f.id === "f1")!;

    expect(item.must_build).toBe(true);
    expect(item.force_parts).toBe(true);
    expect(item.requested_part_count).toBe(5);
    expect(item.parts![0].mandatory).toBe(true);
    expect(item.parts![1].mandatory).toBe(true);
  });

  it("add_position updates designRationale position", () => {
    const patch: SpecPatch = {
      item_id: "f1",
      patch_type: "add_position",
      rationale: "Move to center",
      payload: { item_id: "f1", position: [5.0, 4.0, 0], rotation_z_rad: 1.57 },
    };

    const patched = applyPatches(makeSpec(), [patch]);
    const rationale = patched.designRationale!.find(r => r.itemId === "f1")!;

    expect(rationale.position[0]).toBe(5.0);
    expect(rationale.position[1]).toBe(4.0);
    expect(rationale.rotation_z_rad).toBe(1.57);
  });

  it("fix_size overrides element dims_m", () => {
    const patch: SpecPatch = {
      item_id: "e1",
      patch_type: "fix_size",
      rationale: "Wall too short",
      payload: { item_id: "e1", dims_m: [12, 0.2, 3.5] },
    };

    const patched = applyPatches(makeSpec(), [patch]);
    const element = patched.elements.find(e => e.id === "e1")!;

    expect(element.dims_m).toEqual([12, 0.2, 3.5]);
  });

  it("add_trim appends to spec.trim array", () => {
    const patch: SpecPatch = {
      item_id: "t1",
      patch_type: "add_trim",
      rationale: "Missing skirting",
      payload: {
        trim_item: {
          id: "t1", type: "skirting", hostId: "e1",
          dims_m: [10, 0.08, 0.1], material_id: "m1", ifc_class: "IfcCovering",
          rotation_z_rad: 0,
        },
      },
    };

    const patched = applyPatches(makeSpec(), [patch]);
    expect(patched.trim).toHaveLength(1);
    expect(patched.trim![0].id).toBe("t1");
  });

  it("does not mutate input spec (purity)", () => {
    const original = makeSpec();
    const originalJson = JSON.stringify(original);

    applyPatches(original, [{
      item_id: "f1",
      patch_type: "force_parts",
      rationale: "Test",
      payload: { item_id: "f1", minimum_parts_count: 10 },
    }]);

    expect(JSON.stringify(original)).toBe(originalJson);
  });

  it("non-existent item_id is a no-op", () => {
    const spec = makeSpec();
    const patched = applyPatches(spec, [{
      item_id: "DOES-NOT-EXIST",
      patch_type: "force_parts",
      rationale: "Test",
      payload: {},
    }]);

    // No crash, no mutation
    expect(patched.furniture).toHaveLength(1);
    expect(patched.furniture![0].must_build).toBeUndefined();
  });

  it("increase_decomposition sets requested_part_count", () => {
    const patch: SpecPatch = {
      item_id: "f1",
      patch_type: "increase_decomposition",
      rationale: "Too few parts",
      payload: { item_id: "f1", current_part_count: 2, target_part_count: 8, rationale: "Need more" },
    };

    const patched = applyPatches(makeSpec(), [patch]);
    expect(patched.furniture![0].requested_part_count).toBe(8);
  });
});
