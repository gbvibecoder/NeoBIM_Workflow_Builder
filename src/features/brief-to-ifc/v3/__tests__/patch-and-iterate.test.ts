/**
 * patchAndIterate iterative rebuild loop tests (Phase Beta 3 Section 2).
 */

import { describe, it, expect } from "vitest";
import { patchAndIterate } from "../spec-patcher";
import type { BriefSpec, SpecPatch } from "../types";
import type { RebuildIterationResult, RebuildOptions } from "../agent-rebuild-orchestrator";

function makeSpec(): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Test", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk", parts: [
        { id: "p1", subtype: "top", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
      ]},
      { id: "f2", type: "chair", count: 1, material_id: "m1", description: "Chair", parts: [
        { id: "p2", subtype: "seat", origin_local_m: [0,0,0.4], dims_m: [0.5,0.5,0.05], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
      ]},
    ],
  };
}

function makeInitialResult(overrides?: Partial<RebuildIterationResult>): RebuildIterationResult {
  return {
    iteration: 1,
    ifcUrl: "https://r2.example/v1.ifc",
    qualityScore: 55,
    partsCoverage: 0.4,
    trimCoverage: 0.5,
    entityCount: 1200,
    elapsedMs: 45000,
    costUsd: 0.15,
    verifierMismatches: [
      { type: "missing_parts", item_id: "f1", expected: 5, actual: 1, severity: "high", description: "Desk collapsed" },
      { type: "missing_parts", item_id: "f2", expected: 3, actual: 1, severity: "high", description: "Chair collapsed" },
    ],
    visionIssues: [],
    ...overrides,
  };
}

describe("patchAndIterate", () => {
  it("quality 55 → patched → quality 82, bestIteration=2", async () => {
    let rebuildCallCount = 0;
    const mockRebuild = async (_spec: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => {
      rebuildCallCount++;
      return {
        iteration: opts.iteration,
        ifcUrl: `https://r2.example/v${opts.iteration}.ifc`,
        qualityScore: 82,
        partsCoverage: 0.95,
        trimCoverage: 0.8,
        entityCount: 2100,
        elapsedMs: 60000,
        costUsd: 0.12,
        verifierMismatches: [],
        visionIssues: [],
      };
    };

    const mockPatchFn = async () => [
      { item_id: "f1", patch_type: "force_parts" as const, rationale: "Collapsed", payload: {} },
      { item_id: "f2", patch_type: "force_parts" as const, rationale: "Collapsed", payload: {} },
    ];

    const result = await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run" },
      { rebuildFn: mockRebuild, patchFn: mockPatchFn },
    );

    expect(result.iterations).toHaveLength(2);
    expect(result.bestIteration).toBe(2);
    expect(result.finalQualityScore).toBe(82);
    expect(result.patches_applied).toHaveLength(2);
    expect(result.finalIfcUrl).toBe("https://r2.example/v2.ifc");
    expect(rebuildCallCount).toBe(1);
  });

  it("quality 55 → patched → quality 60, bestIteration=2 (still best)", async () => {
    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => ({
      iteration: opts.iteration,
      ifcUrl: "https://r2.example/v2.ifc",
      qualityScore: 60, // improved but still below threshold
      partsCoverage: 0.6,
      trimCoverage: 0.5,
      entityCount: 1500,
      elapsedMs: 50000,
      costUsd: 0.12,
      verifierMismatches: [{ type: "missing_parts", item_id: "f1", expected: 5, actual: 3, severity: "med", description: "Partial" }],
      visionIssues: [],
    });

    const result = await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run" },
      { rebuildFn: mockRebuild, patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }] },
    );

    expect(result.bestIteration).toBe(2); // 60 > 55
    expect(result.finalQualityScore).toBe(60);
  });

  it("quality 55 → patched → quality 50, bestIteration=1 (keep original)", async () => {
    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => ({
      iteration: opts.iteration,
      ifcUrl: "https://r2.example/v2.ifc",
      qualityScore: 50, // regression
      partsCoverage: 0.3,
      trimCoverage: 0.4,
      entityCount: 900,
      elapsedMs: 50000,
      costUsd: 0.12,
      verifierMismatches: [{ type: "missing_parts", item_id: "f1", expected: 5, actual: 1, severity: "high", description: "Still collapsed" }],
      visionIssues: [],
    });

    const result = await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run" },
      { rebuildFn: mockRebuild, patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }] },
    );

    expect(result.bestIteration).toBe(1); // original was better
    expect(result.finalIfcUrl).toBe("https://r2.example/v1.ifc");
  });

  it("early exit: quality 80 first try, no iteration", async () => {
    let rebuildCalled = false;
    const mockRebuild = async (): Promise<RebuildIterationResult> => {
      rebuildCalled = true;
      return makeInitialResult();
    };

    const result = await patchAndIterate(
      {
        spec: makeSpec(),
        currentResult: makeInitialResult({ qualityScore: 80, partsCoverage: 0.9, verifierMismatches: [] }),
        runId: "test-run",
      },
      { rebuildFn: mockRebuild, patchFn: async () => [] },
    );

    expect(rebuildCalled).toBe(false);
    expect(result.iterations).toHaveLength(1);
    expect(result.bestIteration).toBe(1);
  });

  it("cost cap stops further iterations", async () => {
    let rebuildCount = 0;
    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => {
      rebuildCount++;
      return {
        iteration: opts.iteration,
        ifcUrl: `https://r2.example/v${opts.iteration}.ifc`,
        qualityScore: 60,
        partsCoverage: 0.5,
        trimCoverage: 0.5,
        entityCount: 1500,
        elapsedMs: 50000,
        costUsd: 0.30, // expensive
        verifierMismatches: [{ type: "missing_parts", item_id: "f1", expected: 5, actual: 2, severity: "high", description: "Still missing" }],
        visionIssues: [],
      };
    };

    const result = await patchAndIterate(
      {
        spec: makeSpec(),
        currentResult: makeInitialResult({ costUsd: 0.30 }), // already expensive
        runId: "test-run",
      },
      {
        rebuildFn: mockRebuild,
        patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }],
        costBudgetUsd: 0.50, // tight budget
      },
    );

    // Should have done at most 1 rebuild (cost cap after: 0.30 + 0.30 = 0.60 > 0.50)
    expect(rebuildCount).toBeLessThanOrEqual(1);
    expect(result.total_cost_usd).toBeLessThanOrEqual(0.65);
  });

  it("summary mentions iteration count and best", async () => {
    const result = await patchAndIterate(
      {
        spec: makeSpec(),
        currentResult: makeInitialResult({ qualityScore: 90, partsCoverage: 0.95, verifierMismatches: [] }),
        runId: "test-run",
      },
      { patchFn: async () => [] },
    );

    expect(result.summary).toContain("1 time");
    expect(result.summary).toContain("best=#1");
  });
});
