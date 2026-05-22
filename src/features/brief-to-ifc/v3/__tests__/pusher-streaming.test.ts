/**
 * Pusher iteration-progress streaming tests (Phase Beta 3 gap-close).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BriefSpec } from "../types";
import type { RebuildIterationResult, RebuildOptions } from "../agent-rebuild-orchestrator";

// Mock pusher-server
const mockPusherTrigger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher-server", () => ({
  pusherTrigger: (...args: unknown[]) => mockPusherTrigger(...args),
}));

function makeSpec(): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Test", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [{ id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk" }],
  };
}

function makeInitialResult(): RebuildIterationResult {
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
      { type: "missing_parts", item_id: "f1", expected: 5, actual: 1, severity: "high", description: "Collapsed" },
    ],
    visionIssues: [],
  };
}

beforeEach(() => {
  mockPusherTrigger.mockClear();
});

describe("Pusher iteration-progress streaming", () => {
  it("emits iteration-start before rebuild and iteration-complete after", async () => {
    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => ({
      iteration: opts.iteration,
      ifcUrl: "https://r2.example/v2.ifc",
      qualityScore: 82,
      partsCoverage: 0.95,
      trimCoverage: 0.8,
      entityCount: 2100,
      elapsedMs: 60000,
      costUsd: 0.12,
      verifierMismatches: [],
      visionIssues: [],
    });

    const { patchAndIterate } = await import("../spec-patcher");
    await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run-123" },
      {
        rebuildFn: mockRebuild,
        patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }],
      },
    );

    // Find iteration-start call
    const startCalls = mockPusherTrigger.mock.calls.filter(
      (c: unknown[]) => c[1] === "iteration-start",
    );
    expect(startCalls.length).toBeGreaterThanOrEqual(1);
    expect(startCalls[0][0]).toBe("private-bf-v3-test-run-123");
    expect(startCalls[0][2].iteration).toBe(2);

    // Find iteration-complete call
    const completeCalls = mockPusherTrigger.mock.calls.filter(
      (c: unknown[]) => c[1] === "iteration-complete",
    );
    expect(completeCalls.length).toBeGreaterThanOrEqual(1);
    expect(completeCalls[0][2].qualityScore).toBe(82);
    expect(completeCalls[0][2].isBest).toBe(true);
  });

  it("emits iteration-final after all iterations complete", async () => {
    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => ({
      iteration: opts.iteration,
      ifcUrl: "https://r2.example/v2.ifc",
      qualityScore: 82,
      partsCoverage: 0.95,
      trimCoverage: 0.8,
      entityCount: 2100,
      elapsedMs: 60000,
      costUsd: 0.12,
      verifierMismatches: [],
      visionIssues: [],
    });

    const { patchAndIterate } = await import("../spec-patcher");
    await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run-final" },
      {
        rebuildFn: mockRebuild,
        patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }],
      },
    );

    const finalCalls = mockPusherTrigger.mock.calls.filter(
      (c: unknown[]) => c[1] === "iteration-final",
    );
    expect(finalCalls.length).toBe(1);
    expect(finalCalls[0][2].bestIteration).toBe(2);
    expect(finalCalls[0][2].finalQualityScore).toBe(82);
    expect(finalCalls[0][2].totalIterations).toBe(2);
  });

  it("pusher failure does not break iteration logic", async () => {
    // Make pusher throw
    mockPusherTrigger.mockRejectedValue(new Error("Pusher down"));

    const mockRebuild = async (_s: BriefSpec, opts: RebuildOptions): Promise<RebuildIterationResult> => ({
      iteration: opts.iteration,
      ifcUrl: "https://r2.example/v2.ifc",
      qualityScore: 80,
      partsCoverage: 0.9,
      trimCoverage: 0.8,
      entityCount: 2000,
      elapsedMs: 50000,
      costUsd: 0.10,
      verifierMismatches: [],
      visionIssues: [],
    });

    const { patchAndIterate } = await import("../spec-patcher");

    // Should NOT throw even though pusher is broken
    // Note: pusherTrigger from @/lib/pusher-server already swallows errors
    // internally, but even if it didn't, the iteration must survive
    const result = await patchAndIterate(
      { spec: makeSpec(), currentResult: makeInitialResult(), runId: "test-run-broken" },
      {
        rebuildFn: mockRebuild,
        patchFn: async () => [{ item_id: "f1", patch_type: "force_parts" as const, rationale: "Fix", payload: {} }],
      },
    );

    // Iteration still completed successfully
    expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    expect(result.bestIteration).toBe(2);
  });
});
