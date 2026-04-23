/**
 * VIP Pipeline Orchestrator — Approach #17
 *
 * Fail-safe: ANY error is caught, logged with context, and returns
 * { success: false, shouldFallThrough: true } so route.ts falls
 * through to PIPELINE_REF.
 *
 * Phase 1.1: returns shouldFallThrough immediately.
 * Phase 1.2: adds structured logging + DB persistence.
 * Phase 1.3: Stage 1 (Prompt Intelligence) implemented.
 * Phase 1.4: Stage 2 (Parallel Image Generation) implemented.
 * Phase 1.5: 2-provider alignment (GPT Image 1.5 + Imagen 4). Phase 2.0a: Imagen removed (dead code).
 * Phase 1.6: Stage 3 (Extraction Readiness Jury) implemented.
 * Phase 1.7: Stage 4 (Room Extraction with GPT-4o Vision) implemented.
 * Phase 1.8: Stage 5 (Synthesis: pixels → feet → FloorPlanProject).
 * Phase 1.9: Background jobs (QStash + VipJob).
 * Phase 1.10: Stage 6 (Quality Gate) + Stage 7 (Delivery) + retry loop.
 * Phase 2.12: Stage 3 vision-jury retry loop — regenerates Stage 2
 *   once when the jury flags the image, BEFORE Stage 4 burns GPT-4o
 *   tokens on a bad extraction target.
 */

import type { VIPPipelineConfig, VIPPipelineResult, GeneratedImage, Stage3Output } from "./types";
import type { Stage1Output, ExtractedRoomsDriftMetrics } from "./types";
import { VIPLogger } from "./logger";
import type { VIPGenerationRecord } from "./logger";
import { prisma } from "@/lib/db";
import { runStage1PromptIntelligence } from "./stage-1-prompt";
import { runStage2ParallelImageGen } from "./stage-2-images";
import {
  runStage3ExtractionJury,
  shouldRetryAtStage3,
  appendRetryHintToPrompts,
  STAGE_2_MAX_RETRIES,
} from "./stage-3-jury";
import { runStage4RoomExtraction } from "./stage-4-extract";
import { runStage5Synthesis } from "./stage-5-synthesis";
import { runStage6QualityGate } from "./stage-6-quality";
import { runStage7Delivery } from "./stage-7-deliver";
import type { ParsedConstraints } from "../structured-parser";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

interface Stage4And5Result {
  stage4Ms: number;
  stage5Ms: number;
  project?: FloorPlanProject;
  /** Phase 2.10.3 — piped from Stage 4 extraction to Stage 6 for weighted penalty. */
  driftMetrics?: ExtractedRoomsDriftMetrics;
}

/** Run Stage 4 extraction + Stage 5 synthesis on a GPT image. */
async function runStage4And5Block(
  gptImage: GeneratedImage,
  stage1Output: Stage1Output,
  config: VIPPipelineConfig,
  parsedConstraints: ParsedConstraints,
  log: VIPLogger,
): Promise<Stage4And5Result> {
  let stage4Ms = 0;
  let stage5Ms = 0;

  // ── Stage 4: Room Extraction ──
  log.logStageStart(4);
  const s4Start = Date.now();
  let stage4Output: Awaited<ReturnType<typeof runStage4RoomExtraction>>["output"];
  try {
    const { output, metrics: stage4Metrics } =
      await runStage4RoomExtraction(
        { image: gptImage, brief: stage1Output.brief },
        log,
      );
    stage4Ms = Date.now() - s4Start;
    stage4Output = output;
    const ext = output.extraction;
    log.logStageSuccess(4, stage4Ms, {
      rooms: ext.rooms.length,
      missing: ext.expectedRoomsMissing.length,
      unexpected: ext.unexpectedRoomsFound.length,
      issues: ext.issues.length,
      cost: `$${stage4Metrics.costUsd.toFixed(3)}`,
    });
    await fireProgress(config, 60, "stage4");
  } catch (err) {
    stage4Ms = Date.now() - s4Start;
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(4, stage4Ms, msg);
    log.logFallThrough(`Stage 4 failed: ${msg}`);
    return { stage4Ms, stage5Ms };
  }

  // ── Stage 5: Synthesis ──
  log.logStageStart(5);
  const s5Start = Date.now();
  try {
    const { output: s5Output, metrics: s5Metrics } =
      await runStage5Synthesis(
        {
          extraction: stage4Output.extraction,
          plotWidthFt: stage1Output.brief.plotWidthFt,
          plotDepthFt: stage1Output.brief.plotDepthFt,
          facing: stage1Output.brief.facing,
          parsedConstraints,
          municipality: stage1Output.brief.municipality,
          adjacencies: stage1Output.brief.adjacencies,
          // Phase 2.9: brief + userPrompt for the fidelity-mode
          // scenario classifier and dimension enhancer.
          brief: stage1Output.brief,
          userPrompt: config.prompt,
        },
        log,
      );
    stage5Ms = Date.now() - s5Start;
    log.logStageSuccess(5, stage5Ms, {
      rooms: s5Metrics.roomCount,
      walls: s5Metrics.wallCount,
      doors: s5Metrics.doorCount,
      windows: s5Metrics.windowCount,
      issues: s5Output.issues.length,
      path: s5Metrics.path ?? "strip-pack",
      // Phase 2.9: classifier + enhancement telemetry (mirrors
      // orchestrator-gated). Undefined on strip-pack path.
      enhancement: s5Metrics.enhancement
        ? {
            classified: s5Metrics.enhancement.classification.enhanceDimensions,
            plotSize: s5Metrics.enhancement.classification.plotSizeCategory,
            biasDetected: s5Metrics.enhancement.classification.hasGridSquareBias,
            residential: s5Metrics.enhancement.classification.isResidential,
            reasons: s5Metrics.enhancement.classification.reasonsForFallback,
            dimCorrectionApplied: s5Metrics.enhancement.dimensionCorrection.applied,
            dimCorrectionRollback:
              s5Metrics.enhancement.dimensionCorrection.rollbackReason,
            adjEnforcementApplied: s5Metrics.enhancement.adjacencyEnforcement.applied,
            adjEnforcementRollback:
              s5Metrics.enhancement.adjacencyEnforcement.rollbackReason,
          }
        : undefined,
    });
    await fireProgress(config, 75, "stage5");

    return {
      stage4Ms,
      stage5Ms,
      project: s5Output.project,
      driftMetrics: stage4Output.extraction.driftMetrics,
    };
  } catch (err) {
    stage5Ms = Date.now() - s5Start;
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(5, stage5Ms, msg);
    log.logFallThrough(`Stage 5 failed: ${msg}`);
    return { stage4Ms, stage5Ms };
  }
}

/**
 * Phase 2.12 — combined result of the Stage 2 + Stage 3 retry loop.
 * `gptImage` is the final accepted image (initial or retried) when
 * available. `stage3Output` is the verdict attached to that image;
 * undefined when Stage 3 itself failed or there was no image to score.
 * Timings record the INITIAL attempt for the legacy timing fields —
 * retry work is logged via the stage-log-store, not the scalar timings.
 */
interface Stage2And3Result {
  gptImage?: GeneratedImage;
  stage3Output?: Stage3Output;
  visionJuryRetries: number;
  stage2Ms?: number;
  stage3Ms?: number;
}

/**
 * Run Stage 2 (image gen) then Stage 3 (jury), with up to
 * STAGE_2_MAX_RETRIES regenerations when Stage 3 signals the image is
 * too weak for extraction. Phase 2.12.
 *
 * Design notes:
 *   - The retry hint is appended to the GPT-Image prompt only; Stage 1
 *     prompts are not mutated (a fresh copy is built per attempt).
 *   - If Stage 2 fails on a retry, we keep the last accepted image
 *     rather than aborting — the original still had *some* signal.
 *   - If Stage 3 fails on any attempt, we break out of the loop and
 *     proceed with whatever gptImage we have, since the decision
 *     predicate needs a verdict.
 *   - Only the initial attempt's timings are returned; retry timings
 *     flow through the VIPLogger's stage-log entries for observability.
 */
async function runStage2And3WithRetry(
  stage1Output: Stage1Output,
  config: VIPPipelineConfig,
  log: VIPLogger,
): Promise<Stage2And3Result> {
  let gptImage: GeneratedImage | undefined;
  let stage3Output: Stage3Output | undefined;
  let visionJuryRetries = 0;
  let stage2Ms: number | undefined;
  let stage3Ms: number | undefined;

  for (let attempt = 0; attempt <= STAGE_2_MAX_RETRIES; attempt++) {
    // ── Stage 2 ──
    log.logStageStart(
      2,
      attempt > 0 ? `Stage 2 (vision-jury retry ${attempt})` : undefined,
    );
    const s2Start = Date.now();
    let attemptImages: GeneratedImage[] = [];
    try {
      const prompts =
        attempt === 0 || !stage3Output
          ? stage1Output.imagePrompts
          : appendRetryHintToPrompts(
              stage1Output.imagePrompts,
              stage3Output.verdict,
              attempt,
            );
      const { output, metrics } = await runStage2ParallelImageGen(
        { imagePrompts: prompts },
        log,
      );
      attemptImages = output.images;
      const ms = Date.now() - s2Start;
      if (attempt === 0) stage2Ms = ms;

      const successModels = output.images.map((i) => i.model);
      const failedModels = metrics.perModel
        .filter((m) => !m.success)
        .map((m) => m.model);

      log.logStageSuccess(2, ms, {
        images: output.images.length,
        succeeded: successModels.join(", "),
        failed: failedModels.length > 0 ? failedModels.join(", ") : "none",
        cost: `$${metrics.totalCostUsd.toFixed(3)}`,
        retryAttempt: attempt,
      });
      await fireProgress(
        config,
        35,
        attempt > 0 ? `stage2_retry${attempt}` : "stage2",
      );
    } catch (stage2Err) {
      const ms = Date.now() - s2Start;
      if (attempt === 0) stage2Ms = ms;
      const msg = stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
      log.logStageFailure(2, ms, msg);
      // Initial failure: nothing to do. Retry failure: we keep the
      // prior-accepted image (gptImage remains set from attempt 0).
      break;
    }

    const attemptGpt = attemptImages.find((i) => i.model === "gpt-image-1.5");
    if (!attemptGpt || !attemptGpt.base64) {
      if (attempt === 0) {
        // No usable image from initial attempt — emit a synthetic Stage 3
        // failure for telemetry parity with the pre-2.12 code path.
        log.logStageStart(3);
        log.logStageFailure(3, 0, "No GPT image to evaluate — skipping jury");
        log.logFallThrough(
          "Stage 3 skipped: no GPT image for extraction jury",
        );
      }
      break;
    }
    // Accept this attempt's image as the current best. If Stage 3 on
    // the retry later disagrees, we're out of retry budget anyway.
    gptImage = attemptGpt;

    // ── Stage 3 ──
    log.logStageStart(
      3,
      attempt > 0 ? `Stage 3 (retry attempt ${attempt})` : undefined,
    );
    const s3Start = Date.now();
    try {
      const { output, metrics } = await runStage3ExtractionJury(
        { gptImage: attemptGpt, brief: stage1Output.brief },
        log,
      );
      stage3Output = output;
      const ms = Date.now() - s3Start;
      if (attempt === 0) stage3Ms = ms;
      const v = output.verdict;
      log.logStageSuccess(3, ms, {
        score: v.score,
        recommendation: v.recommendation,
        weakAreas: v.weakAreas.length > 0 ? v.weakAreas.join(", ") : "none",
        retryAttempt: attempt,
        cost: `$${metrics.costUsd.toFixed(3)}`,
      });
      await fireProgress(
        config,
        45,
        attempt > 0 ? `stage3_retry${attempt}` : "stage3",
      );
    } catch (stage3Err) {
      const ms = Date.now() - s3Start;
      if (attempt === 0) stage3Ms = ms;
      const msg = stage3Err instanceof Error ? stage3Err.message : String(stage3Err);
      log.logStageFailure(3, ms, msg);
      // Without a verdict we can't drive the retry decision — exit
      // the loop and let Stage 4+5 run on the current gptImage.
      stage3Output = undefined;
      break;
    }

    if (!shouldRetryAtStage3(stage3Output, attempt)) break;
    visionJuryRetries++;
    // Loop continues to next attempt with the retry hint baked in.
  }

  return { gptImage, stage3Output, visionJuryRetries, stage2Ms, stage3Ms };
}

/** Fire progress callback. Never throws — errors are logged and swallowed. */
async function fireProgress(
  config: VIPPipelineConfig,
  progress: number,
  stage: string,
): Promise<void> {
  if (!config.onProgress) return;
  try {
    await config.onProgress(progress, stage);
  } catch (err) {
    console.warn(
      `[VIP] onProgress(${progress}, ${stage}) failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function runVIPPipeline(
  config: VIPPipelineConfig,
): Promise<VIPPipelineResult> {
  const { requestId, userId } = config.logContext;
  const log = new VIPLogger(requestId, userId, config.prompt, config.onStageLog);
  if (config.existingStageLog) log.seedStageLog(config.existingStageLog);
  const startMs = Date.now();

  try {
    log.logStart();

    // ── Stage 1: Prompt Intelligence ──────────────────────────────
    log.logStageStart(1);
    const stage1Start = Date.now();
    let stage1Ms: number | undefined;
    let stage2Ms: number | undefined;
    let stage3Ms: number | undefined;
    let stage4Ms: number | undefined;
    let stage5Ms: number | undefined;
    let candidateProject: FloorPlanProject | undefined;
    let candidateDriftMetrics: ExtractedRoomsDriftMetrics | undefined;
    let stage1Output: Awaited<ReturnType<typeof runStage1PromptIntelligence>>["output"] | undefined;
    // Phase 2.12: count of vision-jury-triggered Stage 2 regenerations.
    let visionJuryRetries = 0;

    try {
      const { output: s1Out, metrics: stage1Metrics } =
        await runStage1PromptIntelligence(
          { prompt: config.prompt, parsedConstraints: config.parsedConstraints },
          log,
        );
      stage1Output = s1Out;
      stage1Ms = Date.now() - stage1Start;

      log.logStageSuccess(1, stage1Ms, {
        rooms: s1Out.brief.roomList.length,
        prompts: s1Out.imagePrompts.length,
        cost: `$${stage1Metrics.costUsd.toFixed(3)}`,
      });
      await fireProgress(config, 20, "stage1");

      // ── Stage 2 + Stage 3 (Phase 2.12 vision-jury retry loop) ────
      // The helper runs Stage 2 → Stage 3 with up to
      // STAGE_2_MAX_RETRIES (=1) regenerations when the jury flags
      // the image. Each iteration logs its own stage rows through
      // VIPLogger. Timings record the INITIAL attempt so VIPTiming
      // stays comparable to pre-2.12 runs; retry timings flow via
      // the stage-log store (visible in the Pipeline Logs panel).
      const s23 = await runStage2And3WithRetry(stage1Output, config, log);
      stage2Ms = s23.stage2Ms;
      stage3Ms = s23.stage3Ms;
      visionJuryRetries = s23.visionJuryRetries;

      if (s23.gptImage) {
        // Stage 3 verdict is advisory for Stage 4 branching in the
        // pre-2.12 sense — the retry loop above has already acted on
        // it. S4+5 now run on the best gptImage we have. Stage 6
        // continues to drive its own downstream retry (quality-gate).
        const s45 = await runStage4And5Block(
          s23.gptImage,
          stage1Output,
          config,
          config.parsedConstraints,
          log,
        );
        stage4Ms = s45.stage4Ms;
        stage5Ms = s45.stage5Ms;
        if (s45.project) candidateProject = s45.project;
        if (s45.driftMetrics) candidateDriftMetrics = s45.driftMetrics;
      }
    } catch (stage1Err) {
      stage1Ms = Date.now() - stage1Start;
      const msg = stage1Err instanceof Error ? stage1Err.message : String(stage1Err);
      log.logStageFailure(1, stage1Ms, msg);
    }

    // ── Stage 6: Quality Gate ────────────────────────────────────
    let stage6Ms: number | undefined;
    let stage7Ms: number | undefined;
    let qualityScore = 0;
    let retryCount = 0;
    let finalProject: FloorPlanProject | undefined;
    // Tracks the Stage 6 verdict.weakAreas matching the attempt that
    // produced the final qualityScore — initial verdict if no retry,
    // retry verdict if retry beat original.
    let finalWeakAreas: string[] = [];

    if (candidateProject) {
      log.logStageStart(6);
      const s6Start = Date.now();
      try {
        const { output: s6Output, metrics: s6Metrics } = await runStage6QualityGate(
          {
            project: candidateProject,
            brief: stage1Output!.brief,
            parsedConstraints: config.parsedConstraints,
            driftMetrics: candidateDriftMetrics,
          },
          log,
        );
        stage6Ms = Date.now() - s6Start;
        qualityScore = s6Output.verdict.score;
        finalWeakAreas = s6Output.verdict.weakAreas;
        log.logStageSuccess(6, stage6Ms, {
          score: qualityScore,
          recommendation: s6Output.verdict.recommendation,
          weakAreas: s6Output.verdict.weakAreas.length > 0 ? s6Output.verdict.weakAreas.join(", ") : "none",
          cost: `$${s6Metrics.costUsd.toFixed(3)}`,
        });
        await fireProgress(config, 85, "stage6");

        if (s6Output.verdict.recommendation === "pass") {
          finalProject = candidateProject;
        } else if (s6Output.verdict.recommendation === "retry" && retryCount === 0) {
          // ── RETRY LOOP (max 1) ──
          retryCount = 1;
          await fireProgress(config, 86, "retry");
          log.logStageStart(2, "Stage 2 GPT retry (quality gate)");

          try {
            const gptPrompt = stage1Output!.imagePrompts.find((p) => p.model === "gpt-image-1.5");
            if (gptPrompt) {
              const weakHint = `\n\nIMPORTANT: Previous attempt scored ${qualityScore}/100. Scored poorly on: ${s6Output.verdict.weakAreas.join(", ")}. Pay extra attention.`;
              const { output: retryS2 } = await runStage2ParallelImageGen(
                { imagePrompts: [{ ...gptPrompt, prompt: gptPrompt.prompt + weakHint }] }, log,
              );
              const retriedGpt = retryS2.images.find((i) => i.model === "gpt-image-1.5");
              if (retriedGpt?.base64) {
                await fireProgress(config, 90, "retry");
                const retryS45 = await runStage4And5Block(
                  retriedGpt, stage1Output!, config, config.parsedConstraints, log,
                );
                if (retryS45.project) {
                  await fireProgress(config, 95, "retry");
                  // Re-run Stage 6 on retry result
                  log.logStageStart(6, "Quality Gate (retry)");
                  const { output: retryS6 } = await runStage6QualityGate(
                    {
                      project: retryS45.project,
                      brief: stage1Output!.brief,
                      parsedConstraints: config.parsedConstraints,
                      driftMetrics: retryS45.driftMetrics,
                    },
                    log,
                  );
                  const retryScore = retryS6.verdict.score;
                  log.logStageSuccess(6, Date.now() - s6Start, { score: retryScore, note: "retry attempt" });
                  // Keep the better result
                  if (retryScore > qualityScore) {
                    finalProject = retryS45.project;
                    qualityScore = retryScore;
                    finalWeakAreas = retryS6.verdict.weakAreas;
                  } else {
                    finalProject = candidateProject;
                    // finalWeakAreas keeps the original-attempt value
                  }
                }
              }
            }
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            log.logStageFailure(2, 0, `Retry loop failed: ${msg}`);
            // Keep original candidateProject
            finalProject = candidateProject;
          }
          if (!finalProject) finalProject = candidateProject;
        } else if (s6Output.verdict.recommendation === "fail") {
          // Quality gate failed — but still deliver if score > 0
          if (qualityScore > 0) finalProject = candidateProject;
        }
      } catch (s6Err) {
        stage6Ms = Date.now() - s6Start;
        const msg = s6Err instanceof Error ? s6Err.message : String(s6Err);
        log.logStageFailure(6, stage6Ms, msg);
        // Stage 6 API failure — deliver candidate without quality score
        finalProject = candidateProject;
        qualityScore = 0;
      }
    }

    // ── Stage 7: Delivery ────────────────────────────────────────
    if (finalProject) {
      // Phase 2.7D: dropped logStageStart(7). Stage 7 is sync + <5ms,
      // so the start/success pair raced Prisma persists and sometimes
      // froze the row as status="running". logStageSuccess on its own
      // triggers finalizeStageEntry's synthesize-entry fallback, which
      // writes a single success entry — no running intermediate.
      const s7Start = Date.now();
      const totalCostUsd = log.computeTotalCost();
      const { output: s7Output } = runStage7Delivery({
        project: finalProject,
        qualityScore,
        totalCostUsd,
        totalMs: Date.now() - startMs,
        retried: retryCount > 0,
        weakAreas: finalWeakAreas,
        visionJuryRetries,
      }, log);
      stage7Ms = Date.now() - s7Start;
      log.logStageSuccess(7, stage7Ms, { qualityScore, visionJuryRetries });
      await fireProgress(config, 100, "stage7");
      log.logSuccess(qualityScore);

      persistRecord(log.toDbRecord()).catch(() => {});

      return {
        success: true,
        project: s7Output.project,
        qualityScore,
        retried: retryCount > 0,
        visionJuryRetries,
        timing: { stage1Ms, stage2Ms, stage3Ms, stage4Ms, stage5Ms, stage6Ms, stage7Ms, totalMs: Date.now() - startMs },
        warnings: [],
      };
    }

    // ── No project produced — fall through ──
    log.logFallThrough("Pipeline produced no project");
    persistRecord(log.toDbRecord()).catch(() => {});

    return {
      success: false,
      error: "Pipeline produced no project",
      shouldFallThrough: true,
      timing: { stage1Ms, stage2Ms, stage3Ms, stage4Ms, stage5Ms, stage6Ms, totalMs: Date.now() - startMs },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.logFailure(message);

    // Fire-and-forget DB persist
    persistRecord(log.toDbRecord()).catch(() => {});

    return {
      success: false,
      error: message,
      shouldFallThrough: true,
      stage: "orchestrator",
      timing: { totalMs: Date.now() - startMs },
    };
  }
}

/** Persist a VipGeneration row. Never throws — logs failure and moves on. */
async function persistRecord(record: VIPGenerationRecord): Promise<void> {
  try {
    await prisma.vipGeneration.create({
      data: {
        requestId: record.requestId,
        userId: record.userId,
        prompt: record.prompt,
        status: record.status,
        pipelineUsed: record.pipelineUsed,
        stageTimings: record.stageTimings ?? undefined,
        stageCosts: record.stageCosts ?? undefined,
        stageErrors:
          Object.keys(record.stageErrors).length > 0
            ? record.stageErrors
            : undefined,
        finalScore: record.finalScore,
        totalDurationMs: record.totalDurationMs,
        totalCostUsd: record.totalCostUsd,
        fallThroughReason: record.fallThroughReason,
      },
    });
  } catch (err) {
    console.error(
      `[VIP:${record.requestId.slice(0, 8)}] DB persist failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
