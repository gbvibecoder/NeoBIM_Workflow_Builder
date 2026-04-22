/**
 * Phase 2.12 — Vision-Jury Retry Loop.
 *
 * Before 2.12 the Stage 3 jury verdict was advisory only — the pipeline
 * always proceeded to Stage 4 with the first Stage 2 image, even when
 * the jury recommended retry. This wasted a ~$0.03 GPT-4o extraction
 * pass on images the jury had already flagged as unextractable.
 *
 * Phase 2.12 wires the Stage 3 verdict into a bounded retry:
 *   - `shouldRetryAtStage3(verdict, retryCount)` returns true when the
 *     verdict is sub-pass AND we still have retry budget.
 *   - `STAGE_2_MAX_RETRIES = 1` caps the loop at one regen (2 total
 *     Stage 2+3 passes). Prevents unbounded cost on a stuck prompt.
 *   - The orchestrator appends a retry hint to the GPT-Image prompt
 *     via `appendRetryHintToPrompts`; Stage 1 is not mutated.
 *   - `visionJuryRetries` is stamped into Stage 7 telemetry and the
 *     pipeline result so downstream consumers can observe the count.
 *
 * These tests cover the pure predicate + prompt helpers, then drive the
 * orchestrator end-to-end with mocked stage runners to verify the loop,
 * cost tracking, retry budget, and failure-mode fallbacks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type {
  Stage3Output,
  JuryVerdict,
  JuryDimension,
  ImageGenPrompt,
} from "../types";

// ─── Module-level mocks (hoisted) ───────────────────────────────────

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
// We need the REAL stage-3-jury exports (predicate + constants) because
// the orchestrator uses them directly. Only the API call itself is mocked.
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-3-jury", async () => {
  const actual =
    await vi.importActual<typeof import("@/features/floor-plan/lib/vip-pipeline/stage-3-jury")>(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury",
    );
  return {
    ...actual,
    runStage3ExtractionJury: vi.fn(),
  };
});
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

// ─── Shared fixtures ────────────────────────────────────────────────

const mockProject = { floors: [], metadata: {} } as unknown as FloorPlanProject;

const ALL_DIMS_NEUTRAL: Record<JuryDimension, number> = {
  roomCountMatch: 7,
  labelLegibility: 7,
  noDuplicateLabels: 7,
  orientation: 7,
  vastuCompliance: 7,
  wallCompleteness: 7,
  proportionalHierarchy: 7,
  extractability: 7,
};

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
        adjacencies: [],
      },
      imagePrompts: [
        {
          model: "gpt-image-1.5",
          prompt: "BASE_PROMPT",
          styleGuide: "styled",
        } as ImageGenPrompt,
      ],
    },
    metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function stage2Ok(marker = "fake-base64") {
  return {
    output: {
      images: [
        {
          model: "gpt-image-1.5",
          base64: marker,
          width: 1024,
          height: 1024,
          generationTimeMs: 10,
        },
      ],
    },
    metrics: {
      totalCostUsd: 0.034,
      perModel: [
        {
          model: "gpt-image-1.5",
          success: true,
          durationMs: 10,
          costUsd: 0.034,
        },
      ],
    },
  };
}

function stage3Verdict(
  score: number,
  recommendation: JuryVerdict["recommendation"],
  weakAreas: string[] = [],
): Stage3Output {
  return {
    verdict: {
      score,
      dimensions: ALL_DIMS_NEUTRAL,
      reasoning: "fixture",
      recommendation,
      weakAreas,
    },
  };
}

function stage3Result(
  score: number,
  recommendation: JuryVerdict["recommendation"],
  weakAreas: string[] = [],
) {
  return {
    output: stage3Verdict(score, recommendation, weakAreas),
    metrics: { inputTokens: 100, outputTokens: 50, costUsd: 0.013 },
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
    metrics: { costUsd: 0.03 } as unknown as never,
  };
}

function stage5Ok() {
  return {
    output: { project: mockProject, issues: [] },
    metrics: {
      roomCount: 0,
      wallCount: 0,
      doorCount: 0,
      windowCount: 0,
    } as unknown as never,
  };
}

function stage6Pass() {
  return {
    output: {
      verdict: {
        score: 85,
        dimensions: {} as Record<string, number>,
        reasoning: "pass",
        recommendation: "pass" as const,
        weakAreas: [],
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

// ─── Per-test setup ─────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();

  const { runStage1PromptIntelligence } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-1-prompt"
  );
  const { runStage2ParallelImageGen } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
  );
  const { runStage4RoomExtraction } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-4-extract"
  );
  const { runStage5Synthesis } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis"
  );
  const { runStage6QualityGate } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-6-quality"
  );
  const { runStage7Delivery } = await import(
    "@/features/floor-plan/lib/vip-pipeline/stage-7-deliver"
  );

  vi.mocked(runStage1PromptIntelligence).mockResolvedValue(stage1Ok());
  vi.mocked(runStage2ParallelImageGen).mockResolvedValue(stage2Ok());
  vi.mocked(runStage4RoomExtraction).mockResolvedValue(stage4Ok());
  vi.mocked(runStage5Synthesis).mockResolvedValue(stage5Ok());
  vi.mocked(runStage6QualityGate).mockResolvedValue(stage6Pass());
  vi.mocked(runStage7Delivery).mockReturnValue(stage7Ok());
});

// ═══════════════════════════════════════════════════════════════════
// 1. Pure predicate (no mocks, no orchestrator)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 2.12 — shouldRetryAtStage3 predicate", () => {
  it("does NOT retry a passing verdict (score >= 70)", async () => {
    const { shouldRetryAtStage3 } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    expect(shouldRetryAtStage3(stage3Verdict(72, "pass"), 0)).toBe(false);
    expect(shouldRetryAtStage3(stage3Verdict(100, "pass"), 0)).toBe(false);
  });

  it("DOES retry when recommendation === 'retry'", async () => {
    const { shouldRetryAtStage3 } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    expect(
      shouldRetryAtStage3(
        stage3Verdict(55, "retry", ["labelLegibility"]),
        0,
      ),
    ).toBe(true);
  });

  it("DOES retry when recommendation === 'fail' (score < 70 branch)", async () => {
    const { shouldRetryAtStage3 } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    // recommendation 'fail' (score < 50) still satisfies `score < 70`
    expect(shouldRetryAtStage3(stage3Verdict(30, "fail"), 0)).toBe(true);
  });

  it("respects retry budget — returns false once retryCount === STAGE_2_MAX_RETRIES", async () => {
    const { shouldRetryAtStage3, STAGE_2_MAX_RETRIES } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    // Same bad verdict, but budget is exhausted
    expect(
      shouldRetryAtStage3(
        stage3Verdict(30, "fail"),
        STAGE_2_MAX_RETRIES,
      ),
    ).toBe(false);
  });

  it("STAGE_2_MAX_RETRIES is exactly 1 (hard-cap guards the cost spiral)", async () => {
    const { STAGE_2_MAX_RETRIES, STAGE_3_RETRY_SCORE_THRESHOLD } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    expect(STAGE_2_MAX_RETRIES).toBe(1);
    expect(STAGE_3_RETRY_SCORE_THRESHOLD).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Retry-hint prompt builder (pure)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 2.12 — appendRetryHintToPrompts", () => {
  it("appends the retry hint to the GPT-Image prompt only", async () => {
    const { appendRetryHintToPrompts } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const verdict = stage3Verdict(40, "fail", [
      "labelLegibility",
      "roomCountMatch",
    ]).verdict;
    const prompts: ImageGenPrompt[] = [
      { model: "gpt-image-1.5", prompt: "BASE", styleGuide: "s" },
      // A hypothetical second provider — must pass through untouched
      { model: "some-other-model", prompt: "UNTOUCHED", styleGuide: "s" },
    ];
    const out = appendRetryHintToPrompts(prompts, verdict, 1);
    expect(out[0].prompt).toContain("BASE");
    expect(out[0].prompt).toContain("[RETRY ATTEMPT 1]");
    expect(out[0].prompt).toContain("40/100");
    expect(out[0].prompt).toContain("labelLegibility");
    expect(out[0].prompt).toContain("roomCountMatch");
    // Non-GPT prompts pass through
    expect(out[1].prompt).toBe("UNTOUCHED");
  });

  it("does not mutate the input prompts array", async () => {
    const { appendRetryHintToPrompts } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const original: ImageGenPrompt[] = [
      { model: "gpt-image-1.5", prompt: "ORIGINAL", styleGuide: "s" },
    ];
    const verdict = stage3Verdict(55, "retry").verdict;
    appendRetryHintToPrompts(original, verdict, 1);
    expect(original[0].prompt).toBe("ORIGINAL");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Orchestrator — retry loop integration
// ═══════════════════════════════════════════════════════════════════

describe("Phase 2.12 — orchestrator integration", () => {
  it("happy path: Stage 3 passes → NO retry, Stage 2 runs exactly once", async () => {
    const { runStage2ParallelImageGen } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
    );
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const { runStage7Delivery } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-7-deliver"
    );
    vi.mocked(runStage3ExtractionJury).mockResolvedValue(
      stage3Result(85, "pass"),
    );

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-happy", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.visionJuryRetries).toBe(0);
    expect(vi.mocked(runStage2ParallelImageGen)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runStage3ExtractionJury)).toHaveBeenCalledTimes(1);
    const s7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(s7Call.visionJuryRetries).toBe(0);
  });

  it("retry path: Stage 3 recommends 'retry' → Stage 2+3 re-run once with hint", async () => {
    const { runStage2ParallelImageGen } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
    );
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const { runStage7Delivery } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-7-deliver"
    );

    vi.mocked(runStage2ParallelImageGen)
      .mockResolvedValueOnce(stage2Ok("first-attempt-b64"))
      .mockResolvedValueOnce(stage2Ok("retry-attempt-b64"));

    vi.mocked(runStage3ExtractionJury)
      .mockResolvedValueOnce(stage3Result(55, "retry", ["labelLegibility"]))
      .mockResolvedValueOnce(stage3Result(82, "pass"));

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-retry-wins", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.visionJuryRetries).toBe(1);
    expect(vi.mocked(runStage2ParallelImageGen)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runStage3ExtractionJury)).toHaveBeenCalledTimes(2);

    // The retry Stage 2 call received prompts with the retry hint baked in
    const retryS2Call =
      vi.mocked(runStage2ParallelImageGen).mock.calls[1][0];
    expect(retryS2Call.imagePrompts[0].prompt).toContain("[RETRY ATTEMPT 1]");
    expect(retryS2Call.imagePrompts[0].prompt).toContain("labelLegibility");

    // The retry Stage 3 call saw the retry image, not the original
    const retryS3Call =
      vi.mocked(runStage3ExtractionJury).mock.calls[1][0];
    expect(retryS3Call.gptImage.base64).toBe("retry-attempt-b64");

    // Stage 7 telemetry reflects the retry
    const s7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(s7Call.visionJuryRetries).toBe(1);
  });

  it("retry budget: still-bad retry verdict does NOT trigger a second retry", async () => {
    const { runStage2ParallelImageGen } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
    );
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );

    // Both attempts score badly — but STAGE_2_MAX_RETRIES caps at 1
    vi.mocked(runStage3ExtractionJury)
      .mockResolvedValueOnce(stage3Result(40, "fail", ["wallCompleteness"]))
      .mockResolvedValueOnce(stage3Result(45, "fail", ["roomCountMatch"]));

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-budget", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.visionJuryRetries).toBe(1);
    // Exactly 2 Stage-2 invocations (initial + 1 retry) — not 3
    expect(vi.mocked(runStage2ParallelImageGen)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runStage3ExtractionJury)).toHaveBeenCalledTimes(2);
  });

  it("Stage 2 retry failure: keeps original image and proceeds without extra attempts", async () => {
    const { runStage2ParallelImageGen } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
    );
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const { runStage4RoomExtraction } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-4-extract"
    );

    vi.mocked(runStage2ParallelImageGen)
      .mockResolvedValueOnce(stage2Ok("keep-me-b64"))
      .mockRejectedValueOnce(new Error("rate limited"));

    vi.mocked(runStage3ExtractionJury).mockResolvedValueOnce(
      stage3Result(50, "retry", ["extractability"]),
    );

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-s2-retry-fail", userId: "u" },
    });

    expect(result.success).toBe(true);
    // The loop only incremented retries if Stage 2 produced a valid image;
    // when the retry Stage 2 call throws, the counter was already bumped
    // (we decided to retry), so 1 is the accepted value.
    if (!result.success) return;
    expect(result.visionJuryRetries).toBe(1);
    // Stage 4 runs on the ORIGINAL image because the retry failed
    const s4Call = vi.mocked(runStage4RoomExtraction).mock.calls[0][0];
    expect(s4Call.image.base64).toBe("keep-me-b64");
  });

  it("Stage 3 failure on initial attempt: no retry fires, pipeline proceeds", async () => {
    const { runStage2ParallelImageGen } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-2-images"
    );
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const { runStage4RoomExtraction } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-4-extract"
    );

    vi.mocked(runStage3ExtractionJury).mockRejectedValueOnce(
      new Error("anthropic 500"),
    );

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-s3-fail", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.visionJuryRetries).toBe(0);
    // Stage 2 runs exactly once — we can't decide to retry without a verdict
    expect(vi.mocked(runStage2ParallelImageGen)).toHaveBeenCalledTimes(1);
    // Stage 4 still receives the original image
    expect(vi.mocked(runStage4RoomExtraction)).toHaveBeenCalledTimes(1);
  });

  it("telemetry: visionJuryRetries propagates to Stage 7 and pipeline result", async () => {
    const { runStage3ExtractionJury } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-3-jury"
    );
    const { runStage7Delivery } = await import(
      "@/features/floor-plan/lib/vip-pipeline/stage-7-deliver"
    );
    vi.mocked(runStage3ExtractionJury)
      .mockResolvedValueOnce(stage3Result(60, "retry", ["vastuCompliance"]))
      .mockResolvedValueOnce(stage3Result(78, "pass"));

    const { runVIPPipeline } = await import(
      "@/features/floor-plan/lib/vip-pipeline/orchestrator"
    );
    const result = await runVIPPipeline({
      prompt: "test",
      parsedConstraints: parsedConstraintsStub,
      logContext: { requestId: "r-telemetry", userId: "u" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Pipeline-level surface
    expect(result.visionJuryRetries).toBe(1);
    // Stage 7 input
    const s7Call = vi.mocked(runStage7Delivery).mock.calls[0][0];
    expect(s7Call.visionJuryRetries).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Stage 7 delivery stamps the retry count onto project metadata
// ═══════════════════════════════════════════════════════════════════
// Uses vi.importActual to bypass the module-level mock and exercise
// the REAL stamping logic in stage-7-deliver.ts.

describe("Phase 2.12 — Stage 7 stamps generation_vision_jury_retries", () => {
  it("writes 0 when visionJuryRetries is unset (back-compat with pre-2.12 callers)", async () => {
    const mod = await vi.importActual<
      typeof import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver")
    >("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");

    const project = {
      floors: [],
      metadata: {},
    } as unknown as FloorPlanProject;
    mod.runStage7Delivery({
      project,
      qualityScore: 85,
      totalCostUsd: 0.12,
      totalMs: 1000,
      retried: false,
      weakAreas: [],
    });
    const meta = project.metadata as unknown as Record<string, unknown>;
    expect(meta.generation_vision_jury_retries).toBe(0);
  });

  it("writes the passed-in count when provided", async () => {
    const mod = await vi.importActual<
      typeof import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver")
    >("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");

    const project = {
      floors: [],
      metadata: {},
    } as unknown as FloorPlanProject;
    mod.runStage7Delivery({
      project,
      qualityScore: 85,
      totalCostUsd: 0.16,
      totalMs: 1000,
      retried: false,
      weakAreas: [],
      visionJuryRetries: 1,
    });
    const meta = project.metadata as unknown as Record<string, unknown>;
    expect(meta.generation_vision_jury_retries).toBe(1);
  });
});
