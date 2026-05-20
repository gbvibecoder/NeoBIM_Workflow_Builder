/**
 * Hotfix: dims_m tolerance — accept 2 or 3 numbers, normalize height.
 *
 * Production execution 6x0r194x5c32 failed at TR-025 because Opus
 * emitted furniture parts with 2-element dims_m ([w,d]) instead of
 * 3 ([w,d,h]). Same fragility class as the pitch_x_m hotfix.
 */

import { describe, expect, it } from "vitest";
import {
  furniturePartSchema,
  briefFurnitureSchema,
  briefElementSchema,
  briefSpecSchema,
  trimItemSchema,
  designRationaleSchema,
} from "../types";

describe("dims_m tolerance (hotfix)", () => {
  // ─── furniturePartSchema.dims_m ───────────────────────────────

  it("part dims_m with 3 numbers [0.4,0.3,0.2] passes unchanged", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "top", origin_local_m: [0, 0, 0.7],
      dims_m: [0.4, 0.3, 0.2], material_id: "mat-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dims_m).toEqual([0.4, 0.3, 0.2]);
    }
  });

  it("part dims_m with 2 numbers [0.4,0.3] passes, normalized to [0.4,0.3,0.3]", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "leg", origin_local_m: [0, 0, 0],
      dims_m: [0.4, 0.3], material_id: "mat-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // height = min(0.4, 0.3) = 0.3
      expect(result.data.dims_m).toEqual([0.4, 0.3, 0.3]);
    }
  });

  it("part dims_m with 2 numbers [0.4,0.6] → height = 0.4 (min of w,d)", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "base", origin_local_m: [0, 0, 0],
      dims_m: [0.4, 0.6], material_id: "mat-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dims_m).toEqual([0.4, 0.6, 0.4]);
    }
  });

  it("dims_m with 1 number FAILS (too few)", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "leg", origin_local_m: [0, 0, 0],
      dims_m: [0.4], material_id: "mat-1",
    });
    expect(result.success).toBe(false);
  });

  it("dims_m with 4 numbers FAILS (too many)", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "leg", origin_local_m: [0, 0, 0],
      dims_m: [0.4, 0.3, 0.2, 0.1], material_id: "mat-1",
    });
    expect(result.success).toBe(false);
  });

  // ─── EXACT PRODUCTION REPRO ──────────────────────────────────

  it("EXACT production repro: furniture[1].parts[0].dims_m = [w,d] (length 2) passes after fix", () => {
    // This is the exact failing shape from execution 6x0r194x5c32
    const partWith2Dims = {
      id: "podcast-desk-top",
      subtype: "desk_surface",
      origin_local_m: [0, 0, 0.72],
      dims_m: [1.2, 0.6], // Opus emitted 2 numbers, missing height
      shape: "box" as const,
      rotation_z_rad: 0,
      material_id: "mat-laminate-oak",
      ifc_class: "IfcFurnishingElement" as const,
    };

    const result = furniturePartSchema.safeParse(partWith2Dims);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dims_m).toHaveLength(3);
      expect(result.data.dims_m[2]).toBeGreaterThan(0);
      // height = min(1.2, 0.6) = 0.6
      expect(result.data.dims_m).toEqual([1.2, 0.6, 0.6]);
    }
  });

  // ─── position/offset tolerance ─────────────────────────────────

  it("part origin_local_m [x,y] (length 2) normalized to [x,y,0]", () => {
    const result = furniturePartSchema.safeParse({
      id: "p1", subtype: "leg", origin_local_m: [0.5, 0.3],
      dims_m: [0.1, 0.1, 0.7], material_id: "mat-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin_local_m).toEqual([0.5, 0.3, 0]);
    }
  });

  // ─── parent furniture bounding_box ────────────────────────────

  it("parent furniture bounding_box with 2 numbers normalized to 3", () => {
    const result = briefFurnitureSchema.safeParse({
      id: "f1", type: "desk", count: 1,
      bounding_box: [1.5, 0.8], // missing height
      material_id: "mat-1", description: "test desk",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // height = min(1.5, 0.8) = 0.8
      expect(result.data.bounding_box).toEqual([1.5, 0.8, 0.8]);
    }
  });

  // ─── briefElement dims_m ──────────────────────────────────────

  it("element dims_m with 2 numbers normalized to 3", () => {
    const result = briefElementSchema.safeParse({
      id: "e1", type: "furniture",
      origin_world_m: [2, 3, 0], dims_m: [1.0, 0.5],
      material_id: "mat-1", description: "test", object_type: "", tag: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dims_m).toEqual([1.0, 0.5, 0.5]);
    }
  });

  // ─── trim dims_m ──────────────────────────────────────────────

  it("trim dims_m with 2 numbers normalized to 3", () => {
    const result = trimItemSchema.safeParse({
      id: "t1", type: "skirting", hostId: "sp-1",
      dims_m: [5.0, 0.075], material_id: "mat-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dims_m).toEqual([5.0, 0.075, 0.075]);
    }
  });

  // ─── designRationale position ─────────────────────────────────

  it("design rationale position [x,y] normalized to [x,y,0]", () => {
    const result = designRationaleSchema.safeParse({
      itemId: "desk-1", position: [3.0, 2.5],
      rotation_z_rad: 0, rationale: "Center of room",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toEqual([3.0, 2.5, 0]);
    }
  });

  // ─── Full integration: BriefSpec with short dims ──────────────

  it("full BriefSpec with 2-element part dims parses successfully", () => {
    const spec = {
      project: { name: "Test", type: "office", location: "Mumbai", description: "Test" },
      site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
      spaces: [{ id: "sp-1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "Office" }],
      elements: [],
      materials: [{ id: "mat-1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.7, method: "MATT", category: "wood" }],
      brand_language: { primary_text: "", approved_terms: [], forbidden_terms: [] },
      furniture: [
        {
          id: "mixing-desk",
          type: "mixing_desk",
          count: 1,
          material_id: "mat-1",
          description: "Pro mixing desk",
          parts: [
            { id: "desk-top", subtype: "surface", origin_local_m: [0, 0, 0.72], dims_m: [1.2, 0.6], material_id: "mat-1" },
            { id: "desk-leg-1", subtype: "leg", origin_local_m: [0.05, 0.05], dims_m: [0.05, 0.05, 0.72], material_id: "mat-1" },
          ],
        },
      ],
    };
    const result = briefSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
    if (result.success) {
      const part0 = result.data.furniture![0].parts![0];
      expect(part0.dims_m).toHaveLength(3);
      expect(part0.dims_m[2]).toBeGreaterThan(0);
      // origin_local_m on desk-leg-1 was [x,y] → [x,y,0]
      const part1 = result.data.furniture![0].parts![1];
      expect(part1.origin_local_m).toEqual([0.05, 0.05, 0]);
    }
  });
});
