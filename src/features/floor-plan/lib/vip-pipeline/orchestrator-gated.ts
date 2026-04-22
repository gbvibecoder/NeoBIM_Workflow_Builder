/**
 * Phase 2.3 Workstream C — Image approval gate orchestrator.
 *
 * Splits the VIP pipeline into two phases so the user can review the
 * Stage 2 image before the expensive CAD extraction (Stages 3-7) runs.
 *
 *   Phase A (runVIPPipelinePhaseA):
 *     Stage 1 + Stage 2 → returns intermediate state with the GPT image.
 *
 *   Phase B (runVIPPipelinePhaseB):
 *     Stage 3 (jury) → Stage 4 (extract) → Stage 5 (synth) →
 *     Stage 6 (quality gate, no retry loop in gated mode) → Stage 7 (deliver).
 *
 * Gated mode intentionally skips the Stage-6 retry loop from the
 * monolithic runVIPPipeline: the user just picked this image, so
 * regenerating it silently would defeat the purpose of the gate.
 *
 * Backward compat: the existing runVIPPipeline is unchanged and still
 * drives the legacy (no-gate) code path.
 */

import type {
  VIPPipelineConfig,
  VIPPipelineResult,
  Stage1Output,
  Stage2Output,
} from "./types";
import { VIPLogger } from "./logger";
import { runStage1PromptIntelligence } from "./stage-1-prompt";
import { runStage2ParallelImageGen } from "./stage-2-images";
import { runStage3ExtractionJury } from "./stage-3-jury";
import { runStage4RoomExtraction } from "./stage-4-extract";
import { runStage5Synthesis } from "./stage-5-synthesis";
import { runStage6QualityGate } from "./stage-6-quality";
import { runStage7Delivery } from "./stage-7-deliver";

// ─── Phase A result shape ────────────────────────────────────────

export interface VIPPhaseAIntermediate {
  success: true;
  paused: true;
  stage1Output: Stage1Output;
  stage2Output: Stage2Output;
  /** GPT-image-1.5 base64 extracted from stage2Output.images for convenience. */
  gptImageBase64: string;
  stage1Ms: number;
  stage2Ms: number;
  stage1CostUsd: number;
  stage2CostUsd: number;
}

export type VIPPhaseAResult =
  | VIPPhaseAIntermediate
  | { success: false; error: string; shouldFallThrough: true; stage: string };

/**
 * Phase A: run Stage 1 + Stage 2 and pause for user approval.
 * Returns the intermediate state that callers (worker route) persist
 * into vip_jobs.intermediateBrief / .intermediateImage.
 */
export async function runVIPPipelinePhaseA(
  config: VIPPipelineConfig,
): Promise<VIPPhaseAResult> {
  const { requestId, userId } = config.logContext;
  const log = new VIPLogger(requestId, userId, config.prompt, config.onStageLog);
  if (config.existingStageLog) log.seedStageLog(config.existingStageLog);

  // Stage 1
  let stage1Output: Stage1Output;
  let stage1Ms = 0;
  let stage1CostUsd = 0;
  try {
    log.logStageStart(1);
    const t0 = Date.now();
    const { output, metrics } = await runStage1PromptIntelligence(
      { prompt: config.prompt, parsedConstraints: config.parsedConstraints },
      log,
    );
    stage1Output = output;
    stage1Ms = Date.now() - t0;
    stage1CostUsd = metrics.costUsd;
    log.logStageSuccess(1, stage1Ms, {
      rooms: output.brief.roomList.length,
      costUsd: metrics.costUsd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(1, 0, msg);
    return { success: false, error: msg, shouldFallThrough: true, stage: "stage1" };
  }

  // Stage 2
  try {
    log.logStageStart(2);
    const t0 = Date.now();
    const { output, metrics } = await runStage2ParallelImageGen(
      { imagePrompts: stage1Output.imagePrompts },
      log,
    );
    const stage2Ms = Date.now() - t0;
    log.logStageSuccess(2, stage2Ms, {
      images: output.images.length,
      costUsd: metrics.totalCostUsd,
    });

    const gptImage = output.images.find((i) => i.model === "gpt-image-1.5");
    if (!gptImage || !gptImage.base64) {
      return {
        success: false,
        error: "Stage 2: no usable GPT image produced",
        shouldFallThrough: true,
        stage: "stage2",
      };
    }

    return {
      success: true,
      paused: true,
      stage1Output,
      stage2Output: output,
      gptImageBase64: gptImage.base64,
      stage1Ms,
      stage2Ms,
      stage1CostUsd,
      stage2CostUsd: metrics.totalCostUsd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(2, 0, msg);
    return { success: false, error: msg, shouldFallThrough: true, stage: "stage2" };
  }
}

// ─── Phase B ─────────────────────────────────────────────────────

export interface VIPPhaseBInput {
  intermediate: VIPPhaseAIntermediate;
  config: VIPPipelineConfig;
  startMs: number;
}

/**
 * Phase B: resume from the approved intermediate state and run
 * Stages 3 → 7 linearly. No retry loop — user already approved the image.
 */
export async function runVIPPipelinePhaseB(
  input: VIPPhaseBInput,
): Promise<VIPPipelineResult> {
  const { intermediate, config } = input;
  const { requestId, userId } = config.logContext;
  const log = new VIPLogger(requestId, userId, config.prompt, config.onStageLog);
  if (config.existingStageLog) log.seedStageLog(config.existingStageLog);
  const startMs = input.startMs;

  // Re-seed logger with Phase-A cost/time so the final computeTotalCost is complete.
  log.logStageCost(1, intermediate.stage1CostUsd);
  log.logStageCost(2, intermediate.stage2CostUsd);

  const gptImage = intermediate.stage2Output.images.find((i) => i.model === "gpt-image-1.5");
  if (!gptImage?.base64) {
    return {
      success: false,
      error: "Phase B: GPT image missing from intermediate state",
      shouldFallThrough: true,
      timing: { totalMs: Date.now() - startMs },
    };
  }

  const timings: Record<string, number> = {};

  // Stage 3 — jury (advisory only in gated mode)
  // Phase 2.6.1: added logStageSuccess so the Logs Panel can flip the
  // Stage 3 row to ✓ when the jury finishes. Before this, logStageStart
  // pushed a running entry that was never finalized, and the stage
  // module's internal logStageCost only backfilled costUsd — leaving
  // the entry permanently as status="running" in VipJob.stageLog.
  try {
    log.logStageStart(3);
    const t0 = Date.now();
    const { output: s3Output, metrics: s3Metrics } =
      await runStage3ExtractionJury(
        { gptImage, brief: intermediate.stage1Output.brief },
        log,
      );
    timings.stage3Ms = Date.now() - t0;
    log.logStageSuccess(3, timings.stage3Ms, {
      score: s3Output.verdict.score,
      recommendation: s3Output.verdict.recommendation,
      costUsd: s3Metrics.costUsd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(3, 0, msg);
    // Stage 3 is advisory; continue on failure.
  }

  // Stage 4 — extraction
  let stage4Output;
  try {
    log.logStageStart(4);
    const t0 = Date.now();
    const res = await runStage4RoomExtraction(
      { image: gptImage, brief: intermediate.stage1Output.brief },
      log,
    );
    stage4Output = res.output;
    timings.stage4Ms = Date.now() - t0;
    log.logStageSuccess(4, timings.stage4Ms, {
      rooms: res.output.extraction.rooms.length,
      missing: res.output.extraction.expectedRoomsMissing.length,
      issues: res.output.extraction.issues.length,
      costUsd: res.metrics.costUsd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(4, 0, msg);
    return {
      success: false,
      error: `Stage 4 (extraction) failed: ${msg}`,
      shouldFallThrough: true,
      stage: "stage4",
      timing: { totalMs: Date.now() - startMs },
    };
  }

  // Stage 5 — synthesis
  let candidateProject;
  try {
    log.logStageStart(5);
    const t0 = Date.now();
    const { output, metrics } = await runStage5Synthesis(
      {
        extraction: stage4Output.extraction,
        plotWidthFt: intermediate.stage1Output.brief.plotWidthFt,
        plotDepthFt: intermediate.stage1Output.brief.plotDepthFt,
        facing: intermediate.stage1Output.brief.facing,
        parsedConstraints: config.parsedConstraints,
        adjacencies: intermediate.stage1Output.brief.adjacencies,
      },
      log,
    );
    candidateProject = output.project;
    timings.stage5Ms = Date.now() - t0;
    log.logStageSuccess(5, timings.stage5Ms, {
      rooms: metrics.roomCount,
      walls: metrics.wallCount,
      doors: metrics.doorCount,
      windows: metrics.windowCount,
      issues: output.issues.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(5, 0, msg);
    return {
      success: false,
      error: `Stage 5 (synthesis) failed: ${msg}`,
      shouldFallThrough: true,
      stage: "stage5",
      timing: { totalMs: Date.now() - startMs },
    };
  }

  // Stage 6 — quality gate (no retry in gated mode)
  let qualityScore = 0;
  let finalWeakAreas: string[] = [];
  try {
    log.logStageStart(6);
    const t0 = Date.now();
    const { output, metrics } = await runStage6QualityGate(
      {
        project: candidateProject,
        brief: intermediate.stage1Output.brief,
        parsedConstraints: config.parsedConstraints,
      },
      log,
    );
    qualityScore = output.verdict.score;
    finalWeakAreas = output.verdict.weakAreas;
    timings.stage6Ms = Date.now() - t0;
    log.logStageSuccess(6, timings.stage6Ms, {
      score: qualityScore,
      recommendation: output.verdict.recommendation,
      weakAreas: output.verdict.weakAreas,
      costUsd: metrics.costUsd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(6, 0, msg);
    // Stage 6 failure is non-fatal — deliver best-effort with score 0.
    qualityScore = 0;
  }

  // Stage 7 — delivery (synchronous, $0)
  // Phase 2.6.1: wrapped with logStageStart + logStageSuccess so the
  // Logs Panel reflects delivery completion. Previously Stage 7 wrote
  // no entry at all, so a completed job would render only 6 rows.
  log.logStageStart(7);
  const s7Start = Date.now();
  const totalCostUsd = log.computeTotalCost();
  const { output: s7Output } = runStage7Delivery(
    {
      project: candidateProject,
      qualityScore,
      totalCostUsd,
      totalMs: Date.now() - startMs,
      retried: false,
      weakAreas: finalWeakAreas,
    },
    log,
  );
  timings.stage7Ms = Date.now() - s7Start;
  log.logStageSuccess(7, timings.stage7Ms, { qualityScore });

  log.logSuccess(qualityScore);

  return {
    success: true,
    project: s7Output.project,
    qualityScore,
    retried: false,
    timing: {
      stage1Ms: intermediate.stage1Ms,
      stage2Ms: intermediate.stage2Ms,
      ...timings,
      totalMs: Date.now() - startMs,
    },
    warnings: [],
  };
}

// ─── Regenerate image only ──────────────────────────────────────

/**
 * Re-runs ONLY Stage 2 with the same Stage 1 brief — used when the
 * user hits "Regenerate image" in the approval gate. Returns a fresh
 * intermediate state that callers persist back onto the VipJob row.
 */
export async function runVIPPipelineRegenerateImage(
  stage1Output: Stage1Output,
  config: VIPPipelineConfig,
  startStage1Ms: number,
  startStage1CostUsd: number,
): Promise<VIPPhaseAResult> {
  const { requestId, userId } = config.logContext;
  const log = new VIPLogger(requestId, userId, config.prompt, config.onStageLog);
  if (config.existingStageLog) log.seedStageLog(config.existingStageLog);

  try {
    log.logStageStart(2, "Stage 2 (user-requested regenerate)");
    const t0 = Date.now();
    const { output, metrics } = await runStage2ParallelImageGen(
      { imagePrompts: stage1Output.imagePrompts },
      log,
    );
    const stage2Ms = Date.now() - t0;
    log.logStageSuccess(2, stage2Ms, {
      images: output.images.length,
      costUsd: metrics.totalCostUsd,
    });

    const gptImage = output.images.find((i) => i.model === "gpt-image-1.5");
    if (!gptImage || !gptImage.base64) {
      return {
        success: false,
        error: "Stage 2 regenerate: no usable GPT image produced",
        shouldFallThrough: true,
        stage: "stage2",
      };
    }

    return {
      success: true,
      paused: true,
      stage1Output,
      stage2Output: output,
      gptImageBase64: gptImage.base64,
      stage1Ms: startStage1Ms,
      stage2Ms,
      stage1CostUsd: startStage1CostUsd,
      stage2CostUsd: metrics.totalCostUsd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(2, 0, msg);
    return { success: false, error: msg, shouldFallThrough: true, stage: "stage2" };
  }
}
