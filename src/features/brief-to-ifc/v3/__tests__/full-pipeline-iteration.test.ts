/**
 * Full pipeline integration test: self-correcting iteration flow.
 *
 * Simulates: iteration 1 quality 55 (4 items collapsed) →
 * Spec Patcher generates 2 force_parts patches →
 * iteration 2 quality 82 (all parts present) →
 * bestIteration=2, finalQualityScore=82.
 */

import { describe, it, expect } from "vitest";
import { patchAndIterate } from "../spec-patcher";
import type { BriefSpec } from "../types";
import type { RebuildIterationResult, RebuildOptions } from "../agent-rebuild-orchestrator";

function makeTailorSpec(): BriefSpec {
  return {
    project: {
      name: "Tailor's Workshop",
      type: "retail",
      location: "Mumbai",
      description: "Compact 3m x 2.5m bespoke tailor's workshop",
    },
    site: { bounds_m: [3, 2.5], height_limit_m: 2.7, coordinate_origin: "sw_corner" },
    spaces: [{
      id: "sp-workshop",
      name: "Workshop",
      long_name: "Main Workshop",
      polygon_world_m: [[0,0],[3,0],[3,2.5],[0,2.5]],
      height_m: 2.7,
      occupancy_type: "retail",
    }],
    elements: [{
      id: "W-south",
      type: "wall",
      origin_world_m: [0,0,0],
      dims_m: [3, 0.15, 2.7],
      material_id: "mat-plaster",
      description: "South wall",
      object_type: "Basic Wall",
      tag: "W01",
    }],
    materials: [
      { id: "mat-plaster", name: "White Plaster", rgb: [0.95, 0.95, 0.92], roughness: 0.7, method: "MATT", category: "Interior" },
      { id: "mat-oak", name: "Oak Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" },
    ],
    brand_language: { primary_text: "Bespoke tailoring", approved_terms: ["craft", "quality"], forbidden_terms: [] },
    furniture: [
      {
        id: "FURN-CUTTABLE",
        type: "cutting_table",
        count: 1,
        material_id: "mat-oak",
        description: "Oak cutting table 2.2m x 0.9m with green felt top",
        anchor_space_id: "sp-workshop",
        parts: [
          { id: "CT-top", subtype: "tabletop", origin_local_m: [0,0,0.85], dims_m: [2.2, 0.9, 0.05], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-felt", subtype: "felt-cover", origin_local_m: [0.01,0.01,0.90], dims_m: [2.18, 0.88, 0.005], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-leg1", subtype: "leg", origin_local_m: [0.05,0.05,0], dims_m: [0.06, 0.06, 0.85], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-leg2", subtype: "leg", origin_local_m: [2.09,0.05,0], dims_m: [0.06, 0.06, 0.85], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-leg3", subtype: "leg", origin_local_m: [0.05,0.79,0], dims_m: [0.06, 0.06, 0.85], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-leg4", subtype: "leg", origin_local_m: [2.09,0.79,0], dims_m: [0.06, 0.06, 0.85], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "CT-apron", subtype: "apron", origin_local_m: [0.05,0,0.75], dims_m: [2.10, 0.05, 0.10], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
        ],
      },
      {
        id: "FURN-SEWING",
        type: "sewing_machine",
        count: 1,
        material_id: "mat-oak",
        description: "Industrial sewing machine on the cutting table",
        anchor_space_id: "sp-workshop",
        parts: [
          { id: "SM-base", subtype: "base-plate", origin_local_m: [0,0,0], dims_m: [0.4, 0.25, 0.03], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "SM-body", subtype: "machine-body", origin_local_m: [0.05,0.02,0.03], dims_m: [0.30, 0.20, 0.25], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "SM-arm", subtype: "arm", origin_local_m: [0.05,0.08,0.28], dims_m: [0.25, 0.05, 0.05], material_id: "mat-oak", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
        ],
      },
    ],
  };
}

describe("self-correcting pipeline: iteration 1 quality 55 → iteration 2 quality 82", () => {
  it("completes 2 iterations with correct metrics", async () => {
    let rebuildCallCount = 0;

    // Mock rebuild: iteration 2 returns much better quality
    const mockRebuild = async (
      spec: BriefSpec,
      opts: RebuildOptions,
    ): Promise<RebuildIterationResult> => {
      rebuildCallCount++;
      return {
        iteration: opts.iteration,
        ifcUrl: `https://r2.example/tailor-v${opts.iteration}.ifc`,
        qualityScore: 82,
        partsCoverage: 0.95,
        trimCoverage: 0.8,
        entityCount: 2081,
        elapsedMs: 120000,
        costUsd: 0.18,
        verifierMismatches: [], // All parts present after patching
        visionIssues: [],
      };
    };

    // Mock patches: force_parts on both collapsed items
    const mockPatchFn = async () => [
      {
        item_id: "FURN-CUTTABLE",
        patch_type: "force_parts" as const,
        rationale: "Cutting table collapsed to single box — 1 of 7 parts",
        payload: { item_id: "FURN-CUTTABLE", minimum_parts_count: 7 },
      },
      {
        item_id: "FURN-SEWING",
        patch_type: "force_parts" as const,
        rationale: "Sewing machine collapsed to single box — 1 of 3 parts",
        payload: { item_id: "FURN-SEWING", minimum_parts_count: 3 },
      },
    ];

    // Initial result: quality 55, 4 items collapsed
    const initialResult: RebuildIterationResult = {
      iteration: 1,
      ifcUrl: "https://r2.example/tailor-v1.ifc",
      qualityScore: 55,
      partsCoverage: 0.4,
      trimCoverage: 0.5,
      entityCount: 876,
      elapsedMs: 90000,
      costUsd: 0.15,
      verifierMismatches: [
        {
          type: "missing_parts",
          item_id: "FURN-CUTTABLE",
          item_type: "cutting_table",
          expected: 7,
          actual: 1,
          severity: "high",
          description: "Cutting table: expected 7 parts, found 1",
          suggested_patch: "force_parts",
        },
        {
          type: "missing_parts",
          item_id: "FURN-SEWING",
          item_type: "sewing_machine",
          expected: 3,
          actual: 1,
          severity: "high",
          description: "Sewing machine: expected 3 parts, found 1",
          suggested_patch: "force_parts",
        },
      ],
      visionIssues: [],
    };

    const result = await patchAndIterate(
      { spec: makeTailorSpec(), currentResult: initialResult, runId: "test-tailor-run" },
      { rebuildFn: mockRebuild, patchFn: mockPatchFn, qualityThreshold: 75, partsThreshold: 0.85 },
    );

    // Assertions — self-correcting pipeline proof
    expect(result.iterations).toHaveLength(2);
    expect(result.bestIteration).toBe(2);
    expect(result.finalQualityScore).toBe(82);
    expect(result.patches_applied).toHaveLength(2);
    expect(result.patches_applied.every(p => p.patch_type === "force_parts")).toBe(true);
    expect(result.patches_applied[0].item_id).toBe("FURN-CUTTABLE");
    expect(result.patches_applied[1].item_id).toBe("FURN-SEWING");
    expect(result.finalIfcUrl).toBe("https://r2.example/tailor-v2.ifc");
    expect(result.finalEntityCount).toBe(2081);
    expect(result.total_cost_usd).toBeCloseTo(0.15 + 0.18, 2);
    expect(rebuildCallCount).toBe(1); // Only 1 rebuild needed (quality met threshold)
    expect(result.summary).toContain("2 times");
    expect(result.summary).toContain("best=#2");
    expect(result.summary).toContain("82/100");
  });
});
