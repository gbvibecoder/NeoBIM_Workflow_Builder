/**
 * Phase 2.7D — polish fixes.
 *
 * Two separate contracts tested here:
 *
 * FIX 1 — municipality threading through Phase B.
 *   Stage 1's brief can infer a municipality (Mumbai, Bengaluru, …)
 *   which Stage 5 uses for setback-envelope resolution when the
 *   PHASE_2_4_SETBACKS flag is on. The monolithic orchestrator was
 *   already threading it. Phase B's Stage 5 call was silently
 *   dropping it. This test locks in that Phase B forwards the value.
 *
 * FIX 2 — Stage 7 logger "running" race.
 *   For sync stages that complete in <5ms, emitting logStageStart
 *   then logStageSuccess produced two concurrent Prisma writes which
 *   could race. Two fixes combine:
 *     (a) orchestrators now skip logStageStart(7), relying on
 *         finalizeStageEntry's synthesize-entry path to produce
 *         a single "success" entry.
 *     (b) VIPLogger.flushStageLog serializes onStageLog invocations
 *         via a promise chain so emit order is preserved even when
 *         callers mix start+success rapidly on other stages.
 */

import { describe, it, expect, vi } from "vitest";
import { VIPLogger } from "../logger";
import { runVIPPipelinePhaseB } from "../orchestrator-gated";
import type {
  StageLogEntry,
  VIPPipelineConfig,
  Stage1Output,
  Stage2Output,
} from "../types";
import type { ParsedConstraints } from "../../structured-parser";

// ─── FIX 1 — municipality threading ─────────────────────────────

vi.mock("../stage-3-jury", () => ({
  runStage3ExtractionJury: vi.fn().mockResolvedValue({
    output: {
      verdict: {
        score: 82, dimensions: {}, reasoning: "", recommendation: "pass", weakAreas: [],
      },
    },
    metrics: { inputTokens: 100, outputTokens: 50, costUsd: 0.013 },
  }),
  // Phase 2.12 — constants/helpers imported by orchestrator.ts. Score
  // 82 above recommends pass, so shouldRetryAtStage3 returning false
  // matches the existing single-attempt expectation.
  STAGE_2_MAX_RETRIES: 1,
  STAGE_3_RETRY_SCORE_THRESHOLD: 70,
  shouldRetryAtStage3: () => false,
  appendRetryHintToPrompts: (p: unknown) => p,
  buildStage3RetryHint: () => "",
}));
vi.mock("../stage-4-extract", () => ({
  runStage4RoomExtraction: vi.fn().mockResolvedValue({
    output: {
      extraction: {
        imageSize: { width: 1024, height: 1024 },
        plotBoundsPx: { x: 0, y: 0, w: 1024, h: 1024 },
        rooms: [
          { name: "Living", rectPx: { x: 0, y: 0, w: 100, h: 100 }, confidence: 0.9, labelAsShown: "L" },
        ],
        issues: [],
        expectedRoomsMissing: [],
        unexpectedRoomsFound: [],
      },
    },
    metrics: { inputTokens: 200, outputTokens: 80, costUsd: 0.012 },
  }),
}));
const stage5Spy = vi.fn().mockResolvedValue({
  output: {
    project: { floors: [{ rooms: [], walls: [], doors: [], windows: [] }], metadata: {} },
    issues: [],
  },
  metrics: { durationMs: 1, roomCount: 1, wallCount: 0, doorCount: 0, windowCount: 0 },
});
vi.mock("../stage-5-synthesis", () => ({
  runStage5Synthesis: (...args: unknown[]) => stage5Spy(...args),
}));
vi.mock("../stage-6-quality", () => ({
  runStage6QualityGate: vi.fn().mockResolvedValue({
    output: {
      verdict: {
        score: 85, dimensions: {}, reasoning: "", recommendation: "pass", weakAreas: [],
      },
    },
    metrics: { inputTokens: 400, outputTokens: 150, costUsd: 0.011 },
  }),
}));
vi.mock("../stage-7-deliver", () => ({
  runStage7Delivery: vi.fn().mockReturnValue({
    output: {
      project: { floors: [{ rooms: [], walls: [], doors: [], windows: [] }], metadata: {} },
    },
  }),
}));

function buildIntermediateWithMunicipality(municipality: string | undefined) {
  const stage1Output: Stage1Output = {
    brief: {
      projectType: "residential",
      roomList: [{ name: "Living", type: "living" }],
      plotWidthFt: 40,
      plotDepthFt: 40,
      facing: "north",
      styleCues: [],
      constraints: [],
      municipality,
      adjacencies: [],
    },
    imagePrompts: [{ model: "gpt-image-1.5", prompt: "...", styleGuide: "..." }],
  };
  const stage2Output: Stage2Output = {
    images: [{ model: "gpt-image-1.5", base64: "iVBORw0KGgo=", width: 1024, height: 1024, generationTimeMs: 1 }],
  };
  return {
    success: true as const, paused: true as const,
    stage1Output, stage2Output,
    gptImageBase64: "iVBORw0KGgo=",
    stage1Ms: 1, stage2Ms: 1, stage1CostUsd: 0.015, stage2CostUsd: 0.034,
  };
}

function parsedConstraints(): ParsedConstraints {
  return {
    plot: { width_ft: 40, depth_ft: 40, facing: null, shape: null, total_built_up_sqft: null },
    rooms: [], adjacency_pairs: [], connects_all_groups: [],
    vastu_required: false, special_features: [],
    constraint_budget: {} as unknown as ParsedConstraints["constraint_budget"],
    extraction_notes: "",
  };
}

describe("Phase 2.7D Fix 1 — Phase B threads brief.municipality into Stage 5", () => {
  it("forwards MUMBAI from Stage 1 brief to runStage5Synthesis", async () => {
    stage5Spy.mockClear();
    const intermediate = buildIntermediateWithMunicipality("MUMBAI");
    const config: VIPPipelineConfig = {
      prompt: "3bhk in mumbai",
      parsedConstraints: parsedConstraints(),
      logContext: { requestId: "r1", userId: "u1" },
    };
    await runVIPPipelinePhaseB({ intermediate, config, startMs: Date.now() - 1000 });
    expect(stage5Spy).toHaveBeenCalled();
    const input = stage5Spy.mock.calls[0][0] as Record<string, unknown>;
    expect(input.municipality).toBe("MUMBAI");
  });

  it("forwards undefined cleanly when brief has no municipality", async () => {
    stage5Spy.mockClear();
    const intermediate = buildIntermediateWithMunicipality(undefined);
    const config: VIPPipelineConfig = {
      prompt: "3bhk",
      parsedConstraints: parsedConstraints(),
      logContext: { requestId: "r2", userId: "u1" },
    };
    await runVIPPipelinePhaseB({ intermediate, config, startMs: Date.now() - 1000 });
    const input = stage5Spy.mock.calls[0][0] as Record<string, unknown>;
    expect(input.municipality).toBeUndefined();
  });
});

// ─── FIX 2 — Stage 7 logger race ────────────────────────────────

describe("Phase 2.7D Fix 2 — logger emits single success entry for sync stages", () => {
  it("logStageSuccess without a prior logStageStart produces ONE success entry", () => {
    const log = new VIPLogger("r1", "u1", "test");
    // Sync-stage pattern post-2.7D: only logStageSuccess is called.
    log.logStageSuccess(7, 3, { qualityScore: 85 });
    const entries = log.getStageLog();
    const s7 = entries.filter((e) => e.stage === 7);
    expect(s7).toHaveLength(1);
    expect(s7[0].status).toBe("success");
    expect(s7[0].completedAt).toBeDefined();
    expect(s7[0].output).toMatchObject({ qualityScore: 85 });
  });

  it("pre-2.7D pattern (start + immediate success) still resolves to success, not running", () => {
    // Locking in that the defensive finalize still works if someone
    // re-introduces logStageStart(7) by accident.
    const log = new VIPLogger("r2", "u1", "test");
    log.logStageStart(7);
    log.logStageSuccess(7, 3, { qualityScore: 85 });
    const entries = log.getStageLog();
    const s7 = entries.filter((e) => e.stage === 7);
    expect(s7).toHaveLength(1);
    expect(s7[0].status).toBe("success");
  });
});

describe("Phase 2.7D Fix 2 — onStageLog fires with 'success' final state for sync stages", () => {
  it("sync-stage pattern (logStageSuccess only) fires onStageLog once with status=success", () => {
    const received: StageLogEntry[][] = [];
    const log = new VIPLogger("r3", "u1", "test", (entries) => {
      received.push(entries.map((e) => ({ ...e })));
    });
    log.logStageSuccess(7, 3, { qualityScore: 85 });
    // Only the single finalize fired → exactly one snapshot captured.
    expect(received).toHaveLength(1);
    const only = received[0];
    const s7 = only.find((e) => e.stage === 7)!;
    expect(s7.status).toBe("success");
  });
});
