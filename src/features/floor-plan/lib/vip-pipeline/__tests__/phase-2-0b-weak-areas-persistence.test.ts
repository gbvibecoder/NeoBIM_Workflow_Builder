/**
 * Phase 2.0b — Verifies the fix for the weakAreas-persistence bug
 * surfaced by Gen 1 (VipJob cmo8dqmet000004l5jdrplfr6):
 *
 *   generation_quality_score = 57  ✓ correct
 *   generation_retried        = true ✓ correct
 *   generation_weak_areas     = []   ✗ WRONG — score <65 must have ≥1 weak dim
 *
 * Root cause was orchestrator.ts passing `weakAreas: []` hardcoded to
 * runStage7Delivery instead of the Stage 6 verdict. Fix tracks
 * finalWeakAreas alongside qualityScore/finalProject and passes it
 * through to Stage 7.
 *
 * These tests assert the FINAL weakAreas reaching Stage 7 matches
 * the attempt that produced the final qualityScore.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ─── Module-level mocks (hoisted) ───────────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    vipGeneration: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-1-prompt", () => ({
  runStage1PromptIntelligence: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-2-images", () => ({
  runStage2ParallelImageGen: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-3-jury", () => ({
  runStage3ExtractionJury: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-4-extract", () => ({
  runStage4RoomExtraction: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis", () => ({
  runStage5Synthesis: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-6-quality", () => ({
  runStage6QualityGate: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver", () => ({
  runStage7Delivery: vi.fn(),
}));

// ─── Shared fixtures ────────────────────────────────────────────
const mockProject = { floors: [], metadata: {} } as unknown as FloorPlanProject;

function stage1Ok() {
  return {
    output: {
      brief: {
        projectType: "villa",
        roomList: [{ name: "bedroom", type: "bedroom" }],
        plotWidthFt: 30,
        plotDepthFt: 40,
        facing: "north",
        styleCues: [],
        constraints: [],
      },
      imagePrompts: [{ model: "gpt-image-1.5", prompt: "x", styleGuide: "y" }],
    },
    metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function stage2Ok() {
  return {
    output: {
      images: [{
        model: "gpt-image-1.5",
        base64: "fake-base64",
        width: 1024,
        height: 1024,
        generationTimeMs: 10,
      }],
    },
    metrics: {
      totalCostUsd: 0.034,
      perModel: [{ model: "gpt-image-1.5", success: true, durationMs: 10, costUsd: 0.034 }],
    },
  };
}

function stage3Ok() {
  return {
    output: {
      verdict: {
        score: 80,
        dimensions: {
          roomCountMatch: 9, labelLegibility: 9, noDuplicateLabels: 10,
          orientation: 8, vastuCompliance: 8, wallCompleteness: 8,
          proportionalHierarchy: 7, extractability: 9,
        },
        reasoning: "ok",
        recommendation: "pass" as const,
        weakAreas: [],
      },
    },
    metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function stage4Ok() {
  return {
    output: {
      extraction: {
        imageSize: { width: 1024, height: 1024 },
        plotBoundsPx: null,
        rooms: [],
        issues: [],
        expectedRoomsMissing: [],
        unexpectedRoomsFound: [],
      },
    },
    metrics: { costUsd: 0 } as unknown as never,
  };
}

function stage5Ok() {
  return {
    output: { project: mockProject, issues: [] },
    metrics: {
      roomCount: 0, wallCount: 0, doorCount: 0, windowCount: 0,
    } as unknown as never,
  };
}

function stage6Result({
  score,
  recommendation,
  weakAreas,
}: {
  score: number;
  recommendation: "pass" | "retry" | "fail";
  weakAreas: string[];
}) {
  return {
    output: {
      verdict: {
        score,
        dimensions: {
          roomCountMatch: 5, noDuplicateNames: 5, dimensionPlausibility: 5,
          vastuCompliance: 5, orientationCorrect: 5, connectivity: 5,
          exteriorWindows: 5, bedroomPrivacy: 5, entranceDoor: 5,
        },
        reasoning: "test",
        recommendation,
        weakAreas,
      },
    },
    metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function stage7Ok() {
  return { output: { project: mockProject } };
}

const parsedConstraintsStub = {
  plot: {},
  rooms: [],
  adjacency_pairs: [],
  vastu_required: false,
  special_features: [],
} as unknown as Parameters<
  typeof import("@/features/floor-plan/lib/vip-pipeline/orchestrator")["runVIPPipeline"]
>[0]["parsedConstraints"];

// ─── Per-test setup ─────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks();

  const { runStage1PromptIntelligence } = await import("@/features/floor-plan/lib/vip-pipeline/stage-1-prompt");
  const { runStage2ParallelImageGen }   = await import("@/features/floor-plan/lib/vip-pipeline/stage-2-images");
  const { runStage3ExtractionJury }     = await import("@/features/floor-plan/lib/vip-pipeline/stage-3-jury");
  const { runStage4RoomExtraction }     = await import("@/features/floor-plan/lib/vip-pipeline/stage-4-extract");
  const { runStage5Synthesis }          = await import("@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis");
  const { runStage7Delivery }           = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");

  vi.mocked(runStage1PromptIntelligence).mockResolvedValue(stage1Ok());
  vi.mocked(runStage2ParallelImageGen).mockResolvedValue(stage2Ok());
  vi.mocked(runStage3ExtractionJury).mockResolvedValue(stage3Ok());
  vi.mocked(runStage4RoomExtraction).mockResolvedValue(stage4Ok());
  vi.mocked(runStage5Synthesis).mockResolvedValue(stage5Ok());
  vi.mocked(runStage7Delivery).mockReturnValue(stage7Ok());
});

// ─── Tests ──────────────────────────────────────────────────────

describe("Phase 2.0b — weak_areas persistence through orchestrator", () => {
  it("persists first-attempt weakAreas when score passes (no retry)", async () => {
    const { runStage6QualityGate } = await import("@/features/floor-plan/lib/vip-pipeline/stage-6-quality");
    vi.mocked(runStage6QualityGate).mockResolvedValue(
      stage6Result({ score: 75, recommendation: "pass", weakAreas: ["connectivity"] }),
    );

    const { runStage7Delivery } = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");
    const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");

    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-pass", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.retried).toBe(false);
    expect(vi.mocked(runStage7Delivery)).toHaveBeenCalledTimes(1);
    const stage7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(stage7Call.qualityScore).toBe(75);
    expect(stage7Call.weakAreas).toEqual(["connectivity"]);
  });

  it("persists RETRY weakAreas when retry beats original score", async () => {
    const { runStage6QualityGate } = await import("@/features/floor-plan/lib/vip-pipeline/stage-6-quality");
    vi.mocked(runStage6QualityGate)
      .mockResolvedValueOnce(stage6Result({ score: 55, recommendation: "retry", weakAreas: ["vastuCompliance", "connectivity"] }))
      .mockResolvedValueOnce(stage6Result({ score: 80, recommendation: "pass",  weakAreas: [] }));

    const { runStage7Delivery } = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");
    const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");

    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-retry-wins", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.retried).toBe(true);
    expect(vi.mocked(runStage6QualityGate)).toHaveBeenCalledTimes(2);

    const stage7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(stage7Call.qualityScore).toBe(80);
    expect(stage7Call.weakAreas).toEqual([]);
  });

  it("persists ORIGINAL weakAreas when retry does NOT beat original", async () => {
    const { runStage6QualityGate } = await import("@/features/floor-plan/lib/vip-pipeline/stage-6-quality");
    vi.mocked(runStage6QualityGate)
      .mockResolvedValueOnce(stage6Result({ score: 55, recommendation: "retry", weakAreas: ["vastuCompliance"] }))
      .mockResolvedValueOnce(stage6Result({ score: 50, recommendation: "retry", weakAreas: ["connectivity", "exteriorWindows"] }));

    const { runStage7Delivery } = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");
    const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");

    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-retry-loses", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.retried).toBe(true);

    const stage7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(stage7Call.qualityScore).toBe(55);
    expect(stage7Call.weakAreas).toEqual(["vastuCompliance"]);
  });

  it("Gen-1 regression: score <65 with retry must NOT persist empty weakAreas", async () => {
    // Mirrors the production failure observed on VipJob cmo8dqmet000004l5jdrplfr6:
    // overall 57, retried=true, but weak_areas persisted as [] — impossible by
    // construction (score <65 implies ≥1 dim <6/10). This test pins the fix.
    const { runStage6QualityGate } = await import("@/features/floor-plan/lib/vip-pipeline/stage-6-quality");
    vi.mocked(runStage6QualityGate)
      .mockResolvedValueOnce(stage6Result({ score: 57, recommendation: "retry", weakAreas: ["roomCountMatch", "connectivity"] }))
      .mockResolvedValueOnce(stage6Result({ score: 57, recommendation: "retry", weakAreas: ["exteriorWindows"] }));

    const { runStage7Delivery } = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");
    const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");

    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-gen1-regression", userId: "u" },
    });

    expect(result.success).toBe(true);
    const stage7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(stage7Call.weakAreas).not.toEqual([]);
    expect(stage7Call.weakAreas).toEqual(["roomCountMatch", "connectivity"]);
  });
});
