/**
 * Tests for the BriefSpec fan-in merge function.
 * Verifies that parallel node mutations (TR-028, TR-030, TR-031)
 * are correctly merged without clobber.
 */

import { describe, it, expect } from "vitest";
import { mergeBriefSpecs, isBriefSpecLike } from "../utils/spec-merge";
import type { BriefSpec } from "@/features/brief-to-ifc/v3/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeBaseSpec(overrides: Partial<BriefSpec> = {}): BriefSpec {
  return {
    project: {
      name: "Test Project",
      type: "office",
      location: "Mumbai",
      description: "A test building",
    },
    site: {
      bounds_m: [40, 30],
      height_limit_m: 15,
      coordinate_origin: "sw_corner",
    },
    spaces: [
      {
        id: "s1",
        name: "Main Hall",
        long_name: "Main Hall",
        polygon_world_m: [[0,0],[10,0],[10,10],[0,10]],
        height_m: 3.5,
        occupancy_type: "office",
      },
    ],
    elements: [
      {
        id: "e1",
        type: "wall",
        origin_world_m: [0, 0, 0],
        dims_m: [10, 0.2, 3],
        material_id: "mat_concrete",
        description: "North wall",
        object_type: "Basic Wall",
        tag: "W01",
      },
    ],
    materials: [
      {
        id: "mat_concrete",
        name: "Concrete",
        rgb: [0.7, 0.7, 0.7],
        roughness: 0.8,
        method: "MATT",
        category: "Structural",
      },
    ],
    brand_language: {
      primary_text: "Modern office",
      approved_terms: ["clean", "modern"],
      forbidden_terms: ["rustic"],
    },
    furniture: [
      {
        id: "f1",
        type: "desk",
        count: 1,
        material_id: "mat_concrete",
        description: "Office desk",
      },
      {
        id: "f2",
        type: "chair",
        count: 4,
        material_id: "mat_concrete",
        description: "Office chairs",
      },
    ],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("mergeBriefSpecs", () => {
  it("merges decomposer output — populates furniture parts on base", () => {
    const base = makeBaseSpec();
    const decomposerOutput = makeBaseSpec({
      furniture: [
        {
          id: "f1",
          type: "desk",
          count: 1,
          material_id: "mat_concrete",
          description: "Office desk",
          parts: [
            {
              id: "p1",
              subtype: "desktop",
              origin_local_m: [0, 0, 0.7],
              dims_m: [1.2, 0.6, 0.03],
              material_id: "mat_concrete",
              shape: "box",
              rotation_z_rad: 0,
              ifc_class: "IfcFurnishingElement",
            },
            {
              id: "p2",
              subtype: "leg",
              origin_local_m: [0, 0, 0],
              dims_m: [0.05, 0.05, 0.7],
              material_id: "mat_concrete",
              shape: "box",
              rotation_z_rad: 0,
              ifc_class: "IfcFurnishingElement",
            },
          ],
        },
        {
          id: "f2",
          type: "chair",
          count: 4,
          material_id: "mat_concrete",
          description: "Office chairs",
        },
      ],
    });

    const merged = mergeBriefSpecs([base, decomposerOutput]);
    const desk = merged.furniture!.find(f => f.id === "f1")!;
    expect(desk.parts).toHaveLength(2);
    expect(desk.parts![0].id).toBe("p1");
    expect(desk.parts![1].id).toBe("p2");
    // f2 should remain unchanged (no parts)
    const chair = merged.furniture!.find(f => f.id === "f2")!;
    expect(chair.parts ?? []).toHaveLength(0);
  });

  it("merges trim output — populates base.trim", () => {
    const base = makeBaseSpec();
    const trimOutput = makeBaseSpec({
      trim: [
        {
          id: "t1",
          type: "skirting",
          hostId: "e1",
          dims_m: [10, 0.08, 0.1],
          material_id: "mat_concrete",
          rotation_z_rad: 0,
          ifc_class: "IfcCovering",
        },
      ],
    });

    const merged = mergeBriefSpecs([base, trimOutput]);
    expect(merged.trim).toHaveLength(1);
    expect(merged.trim![0].id).toBe("t1");
    expect(merged.trim![0].type).toBe("skirting");
  });

  it("merges material resolver — normalizes material_ids", () => {
    const base = makeBaseSpec();
    const matResolver = makeBaseSpec({
      materials: [
        {
          id: "mat_concrete",
          name: "Polished Concrete",
          rgb: [0.75, 0.75, 0.72],
          roughness: 0.3,
          method: "PHONG",
          category: "Structural",
        },
        {
          id: "mat_wood_oak",
          name: "Oak Wood",
          rgb: [0.6, 0.4, 0.2],
          roughness: 0.5,
          method: "MATT",
          category: "Interior",
        },
      ],
      furniture: [
        {
          id: "f1",
          type: "desk",
          count: 1,
          material_id: "mat_wood_oak",
          description: "Office desk",
        },
        {
          id: "f2",
          type: "chair",
          count: 4,
          material_id: "mat_concrete",
          description: "Office chairs",
        },
      ],
    });

    const merged = mergeBriefSpecs([base, matResolver]);
    // mat_wood_oak should be added
    expect(merged.materials.find(m => m.id === "mat_wood_oak")).toBeTruthy();
    // mat_concrete should be updated to resolver's values
    const concrete = merged.materials.find(m => m.id === "mat_concrete")!;
    expect(concrete.name).toBe("Polished Concrete");
    expect(concrete.roughness).toBe(0.3);
    // f1 should have mat_wood_oak
    expect(merged.furniture!.find(f => f.id === "f1")!.material_id).toBe("mat_wood_oak");
  });

  it("three-way merge: parts + trim + materials all survive", () => {
    const base = makeBaseSpec();

    const decomposer = makeBaseSpec({
      furniture: [
        {
          id: "f1",
          type: "desk",
          count: 1,
          material_id: "mat_concrete",
          description: "Office desk",
          parts: [
            { id: "p1", subtype: "desktop", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "mat_concrete", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
            { id: "p2", subtype: "leg", origin_local_m: [0,0,0], dims_m: [0.05,0.05,0.7], material_id: "mat_concrete", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          ],
        },
        { id: "f2", type: "chair", count: 4, material_id: "mat_concrete", description: "Office chairs" },
      ],
    });

    const trimSpec = makeBaseSpec({
      trim: [
        { id: "t1", type: "skirting", hostId: "e1", dims_m: [10, 0.08, 0.1], material_id: "mat_concrete", rotation_z_rad: 0, ifc_class: "IfcCovering" },
        { id: "t2", type: "door_handle", hostId: "e1", dims_m: [0.1, 0.05, 0.03], material_id: "mat_steel", rotation_z_rad: 0, ifc_class: "IfcDiscreteAccessory" },
      ],
    });

    const materialResolver = makeBaseSpec({
      materials: [
        { id: "mat_concrete", name: "Polished Concrete", rgb: [0.75, 0.75, 0.72], roughness: 0.3, method: "PHONG", category: "Structural" },
        { id: "mat_steel", name: "Brushed Steel", rgb: [0.8, 0.8, 0.82], roughness: 0.15, method: "METAL", category: "Hardware" },
      ],
    });

    const merged = mergeBriefSpecs([base, decomposer, trimSpec, materialResolver]);

    // Parts from decomposer survived
    expect(merged.furniture![0].parts).toHaveLength(2);
    // Trim from trimSpec survived
    expect(merged.trim).toHaveLength(2);
    // Materials from resolver survived
    expect(merged.materials.find(m => m.id === "mat_steel")).toBeTruthy();
    expect(merged.materials.find(m => m.id === "mat_concrete")!.method).toBe("PHONG");
    // No clobber: original structural data intact
    expect(merged.spaces).toHaveLength(1);
    expect(merged.elements).toHaveLength(1);
    expect(merged.project.name).toBe("Test Project");
  });

  it("merge order independence: (A,B,C) ≈ (C,B,A) semantically", () => {
    const base = makeBaseSpec();

    const withParts = makeBaseSpec({
      furniture: [
        {
          id: "f1", type: "desk", count: 1, material_id: "mat_concrete", description: "Office desk",
          parts: [
            { id: "p1", subtype: "desktop", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "mat_concrete", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          ],
        },
        { id: "f2", type: "chair", count: 4, material_id: "mat_concrete", description: "Office chairs" },
      ],
    });

    const withTrim = makeBaseSpec({
      trim: [
        { id: "t1", type: "skirting", hostId: "e1", material_id: "mat_concrete", rotation_z_rad: 0, ifc_class: "IfcCovering" },
      ],
    });

    const withMat = makeBaseSpec({
      materials: [
        { id: "mat_concrete", name: "Concrete", rgb: [0.7, 0.7, 0.7], roughness: 0.8, method: "MATT", category: "Structural" },
        { id: "mat_new", name: "New Material", rgb: [0.5, 0.5, 0.5], roughness: 0.5, method: "MATT", category: "Interior" },
      ],
    });

    const orderABC = mergeBriefSpecs([base, withParts, withTrim, withMat]);
    const orderCBA = mergeBriefSpecs([base, withMat, withTrim, withParts]);

    // Parts present in both orderings
    const partsABC = orderABC.furniture!.find(f => f.id === "f1")!.parts ?? [];
    const partsCBA = orderCBA.furniture!.find(f => f.id === "f1")!.parts ?? [];
    expect(partsABC.map(p => p.id).sort()).toEqual(partsCBA.map(p => p.id).sort());

    // Trim present in both
    expect(orderABC.trim!.map(t => t.id).sort()).toEqual(orderCBA.trim!.map(t => t.id).sort());

    // mat_new present in both
    expect(orderABC.materials.find(m => m.id === "mat_new")).toBeTruthy();
    expect(orderCBA.materials.find(m => m.id === "mat_new")).toBeTruthy();
  });

  it("throws when given empty array", () => {
    expect(() => mergeBriefSpecs([])).toThrow("at least one spec");
  });

  it("returns deep clone for single spec", () => {
    const base = makeBaseSpec();
    const result = mergeBriefSpecs([base]);
    // Modifying result shouldn't affect original
    result.project.name = "Changed";
    expect(base.project.name).toBe("Test Project");
  });
});

describe("isBriefSpecLike", () => {
  it("returns true for a valid BriefSpec-shaped object", () => {
    expect(isBriefSpecLike(makeBaseSpec())).toBe(true);
  });

  it("returns true for object with all 5 mandatory keys", () => {
    expect(isBriefSpecLike({ project: {}, site: {}, spaces: [], elements: [], materials: [] })).toBe(true);
  });

  it("returns false for partial objects missing mandatory keys", () => {
    // Only 2 keys — was previously a false positive, now correctly rejected
    expect(isBriefSpecLike({ project: {}, site: {} })).toBe(false);
    expect(isBriefSpecLike({ furniture: [], materials: [] })).toBe(false);
    // Missing one mandatory key
    expect(isBriefSpecLike({ project: {}, site: {}, spaces: [], elements: [] })).toBe(false);
  });

  it("returns false for non-BriefSpec objects", () => {
    expect(isBriefSpecLike(null)).toBe(false);
    expect(isBriefSpecLike(undefined)).toBe(false);
    expect(isBriefSpecLike("string")).toBe(false);
    expect(isBriefSpecLike(42)).toBe(false);
    expect(isBriefSpecLike({ foo: "bar" })).toBe(false);
    expect(isBriefSpecLike({ project: {} })).toBe(false);
  });
});
