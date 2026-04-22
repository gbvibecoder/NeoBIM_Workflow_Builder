/**
 * Phase 2.6.1 — runVIPPipelinePhaseB should finalize every stage's
 * log entry on the happy path. Before this fix, the function called
 * logStageStart(3|4|5|6) but never the matching logStageSuccess, and
 * Stage 7 wasn't logged at all. Entries were stuck at status="running"
 * in vip_jobs.stageLog even after the pipeline completed successfully.
 *
 * This test mocks the 5 Phase-B stage runners, drives Phase B through
 * a seeded intermediate (as if Phase A already completed), and asserts
 * that the final stage log has exactly 7 success entries — stages 1-2
 * carried over from the seed, 3-7 finalized by Phase B.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted stage-runner mocks ───────────────────────────────────

vi.mock("../stage-3-jury", () => ({
  runStage3ExtractionJury: vi.fn().mockResolvedValue({
    output: {
      verdict: {
        score: 82,
        dimensions: {} as Record<string, number>,
        reasoning: "ok",
        recommendation: "pass",
        weakAreas: [],
      },
    },
    metrics: { inputTokens: 100, outputTokens: 50, costUsd: 0.013 },
  }),
}));

vi.mock("../stage-4-extract", () => ({
  runStage4RoomExtraction: vi.fn().mockResolvedValue({
    output: {
      extraction: {
        imageSize: { width: 1024, height: 1024 },
        plotBoundsPx: { x: 0, y: 0, w: 1024, h: 1024 },
        rooms: [
          { name: "Living Room", rectPx: { x: 0, y: 0, w: 100, h: 100 }, confidence: 0.9, labelAsShown: "LIVING" },
          { name: "Bedroom", rectPx: { x: 100, y: 0, w: 100, h: 100 }, confidence: 0.9, labelAsShown: "BEDROOM" },
        ],
        issues: [],
        expectedRoomsMissing: [],
        unexpectedRoomsFound: [],
      },
    },
    metrics: { inputTokens: 200, outputTokens: 80, costUsd: 0.012 },
  }),
}));

vi.mock("../stage-5-synthesis", () => ({
  runStage5Synthesis: vi.fn().mockResolvedValue({
    output: {
      project: {
        // Minimal FloorPlanProject-shaped stub — sufficient because Phase
        // B only reads it to hand to Stage 6, which is itself mocked.
        metadata: { generation_cost_usd: 0 },
      },
      issues: [],
    },
    metrics: {
      roomCount: 2,
      wallCount: 8,
      doorCount: 2,
      windowCount: 2,
    },
  }),
}));

vi.mock("../stage-6-quality", () => ({
  runStage6QualityGate: vi.fn().mockResolvedValue({
    output: {
      verdict: {
        score: 88,
        dimensions: {} as Record<string, number>,
        reasoning: "good",
        recommendation: "pass",
        weakAreas: [],
      },
    },
    metrics: { inputTokens: 400, outputTokens: 150, costUsd: 0.011 },
  }),
}));

vi.mock("../stage-7-deliver", () => ({
  runStage7Delivery: vi.fn().mockReturnValue({
    output: {
      project: { metadata: { generation_cost_usd: 0.11 } },
    },
  }),
}));

// ── Imports (after mocks) ────────────────────────────────────────

import { runVIPPipelinePhaseB } from "../orchestrator-gated";
import type {
  StageLogEntry,
  VIPPipelineConfig,
  Stage1Output,
  Stage2Output,
} from "../types";

function buildIntermediate() {
  const stage1Output: Stage1Output = {
    brief: {
      projectType: "residential",
      roomList: [{ name: "Living Room", type: "living" }],
      plotWidthFt: 40,
      plotDepthFt: 40,
      facing: "N",
      styleCues: [],
      constraints: [],
      adjacencies: [],
    },
    imagePrompts: [
      { model: "gpt-image-1.5", prompt: "...", styleGuide: "..." },
    ],
  };
  const gptImageBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
  const stage2Output: Stage2Output = {
    images: [
      {
        model: "gpt-image-1.5",
        base64: gptImageBase64,
        width: 1024,
        height: 1024,
        generationTimeMs: 18_000,
      },
    ],
  };
  return {
    success: true as const,
    paused: true as const,
    stage1Output,
    stage2Output,
    gptImageBase64,
    stage1Ms: 8_000,
    stage2Ms: 18_000,
    stage1CostUsd: 0.015,
    stage2CostUsd: 0.034,
  };
}

function buildParsedConstraints() {
  // Minimal shape for config.parsedConstraints — Phase B forwards it
  // to Stage 5 which is mocked, so the contents don't matter.
  return {
    plot: {
      width_ft: 40,
      depth_ft: 40,
      facing: null,
      shape: null,
      total_built_up_sqft: null,
    },
    rooms: [],
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: false,
    special_features: [],
    constraint_budget: {} as Record<string, unknown>,
    extraction_notes: "",
  } as unknown as VIPPipelineConfig["parsedConstraints"];
}

describe("Phase 2.6.1 — Phase B finalizes every stage's log entry", () => {
  let stageLogSnapshots: StageLogEntry[][] = [];

  beforeEach(() => {
    stageLogSnapshots = [];
  });

  it("runs Stages 3-7 and ends with 7 success entries (including seeded 1-2)", async () => {
    const intermediate = buildIntermediate();
    const existingStageLog: StageLogEntry[] = [
      {
        stage: 1,
        name: "Prompt Intelligence",
        status: "success",
        startedAt: "2026-04-22T12:00:00.000Z",
        completedAt: "2026-04-22T12:00:08.000Z",
        durationMs: 8_000,
        costUsd: 0.015,
      },
      {
        stage: 2,
        name: "Parallel Image Gen",
        status: "success",
        startedAt: "2026-04-22T12:00:08.001Z",
        completedAt: "2026-04-22T12:00:26.000Z",
        durationMs: 18_000,
        costUsd: 0.034,
      },
    ];

    const config: VIPPipelineConfig = {
      prompt: "3bhk in pune",
      parsedConstraints: buildParsedConstraints(),
      logContext: { requestId: "req-1", userId: "user-1" },
      onStageLog: (entries) => {
        stageLogSnapshots.push(entries.map((e) => ({ ...e })));
      },
      existingStageLog,
    };

    const result = await runVIPPipelinePhaseB({
      intermediate,
      config,
      startMs: Date.now() - 30_000,
    });

    expect(result.success).toBe(true);

    const final = stageLogSnapshots[stageLogSnapshots.length - 1];
    expect(final).toBeDefined();

    // Stages present in the final log
    expect(final.map((e) => e.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // Every entry is success
    for (const e of final) {
      expect(e.status).toBe("success");
      expect(e.completedAt).toBeDefined();
    }

    // Stage 3 meta reflects the verdict
    const s3 = final.find((e) => e.stage === 3)!;
    expect(s3.summary).toMatch(/score: 82/);
    expect(s3.costUsd).toBeCloseTo(0.013);

    // Stage 4 reflects rooms + cost
    const s4 = final.find((e) => e.stage === 4)!;
    expect(s4.summary).toMatch(/rooms: 2/);
    expect(s4.costUsd).toBeCloseTo(0.012);

    // Stage 5 reflects the synthesis metrics
    const s5 = final.find((e) => e.stage === 5)!;
    expect(s5.summary).toMatch(/walls: 8/);
    expect(s5.output).toMatchObject({ rooms: 2, walls: 8, doors: 2, windows: 2 });

    // Stage 6 reflects quality score + cost
    const s6 = final.find((e) => e.stage === 6)!;
    expect(s6.summary).toMatch(/score: 88/);
    expect(s6.costUsd).toBeCloseTo(0.011);

    // Stage 7 reflects qualityScore
    const s7 = final.find((e) => e.stage === 7)!;
    expect(s7.output).toMatchObject({ qualityScore: 88 });
    // Stage 7 is synchronous / $0 — no cost persisted by the orchestrator.
    expect(s7.costUsd).toBeUndefined();
  });

  it("Stage 4 failure is terminal and the Stage 4 entry is finalized as failed", async () => {
    const stage4 = await import("../stage-4-extract");
    vi.mocked(stage4.runStage4RoomExtraction).mockRejectedValueOnce(
      new Error("Vision API 500"),
    );

    const intermediate = buildIntermediate();
    const existingStageLog: StageLogEntry[] = [
      { stage: 1, name: "Prompt Intelligence", status: "success", startedAt: "t", completedAt: "t", durationMs: 1, costUsd: 0.015 },
      { stage: 2, name: "Parallel Image Gen",  status: "success", startedAt: "t", completedAt: "t", durationMs: 1, costUsd: 0.034 },
    ];
    const config: VIPPipelineConfig = {
      prompt: "3bhk",
      parsedConstraints: buildParsedConstraints(),
      logContext: { requestId: "req-2", userId: "user-1" },
      onStageLog: (entries) => {
        stageLogSnapshots.push(entries.map((e) => ({ ...e })));
      },
      existingStageLog,
    };

    const result = await runVIPPipelinePhaseB({
      intermediate,
      config,
      startMs: Date.now() - 30_000,
    });

    expect(result.success).toBe(false);

    const final = stageLogSnapshots[stageLogSnapshots.length - 1];
    const s4 = final.find((e) => e.stage === 4)!;
    expect(s4.status).toBe("failed");
    expect(s4.error).toMatch(/Vision API 500/);

    // Stages 5-7 never ran, so they should NOT appear in the final log.
    expect(final.find((e) => e.stage === 5)).toBeUndefined();
    expect(final.find((e) => e.stage === 6)).toBeUndefined();
    expect(final.find((e) => e.stage === 7)).toBeUndefined();
  });
});
