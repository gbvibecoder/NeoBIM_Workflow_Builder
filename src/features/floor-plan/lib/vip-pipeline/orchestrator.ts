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
 */

import type { VIPPipelineConfig, VIPPipelineResult, GeneratedImage } from "./types";
import type { Stage1Output } from "./types";
import { VIPLogger } from "./logger";
import type { VIPGenerationRecord } from "./logger";
import { prisma } from "@/lib/db";
import { runStage1PromptIntelligence } from "./stage-1-prompt";
import { runStage2ParallelImageGen } from "./stage-2-images";
import { runStage3ExtractionJury } from "./stage-3-jury";
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
    });
    await fireProgress(config, 75, "stage5");

    return { stage4Ms, stage5Ms, project: s5Output.project };
  } catch (err) {
    stage5Ms = Date.now() - s5Start;
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(5, stage5Ms, msg);
    log.logFallThrough(`Stage 5 failed: ${msg}`);
    return { stage4Ms, stage5Ms };
  }
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
  const log = new VIPLogger(requestId, userId, config.prompt);
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
    let stage1Output: Awaited<ReturnType<typeof runStage1PromptIntelligence>>["output"] | undefined;

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

      // ── Stage 2: Parallel Image Generation ────────────────────────
      log.logStageStart(2);
      const stage2Start = Date.now();

      try {
        const { output: stage2Output, metrics: stage2Metrics } =
          await runStage2ParallelImageGen(
            { imagePrompts: stage1Output.imagePrompts },
            log,
          );
        stage2Ms = Date.now() - stage2Start;

        const successModels = stage2Output.images.map((i) => i.model);
        const failedModels = stage2Metrics.perModel
          .filter((m) => !m.success)
          .map((m) => m.model);

        log.logStageSuccess(2, stage2Ms, {
          images: stage2Output.images.length,
          succeeded: successModels.join(", "),
          failed: failedModels.length > 0 ? failedModels.join(", ") : "none",
          cost: `$${stage2Metrics.totalCostUsd.toFixed(3)}`,
        });
        await fireProgress(config, 35, "stage2");

        // ── Stage 3: Extraction Readiness Jury ────────────────────────
        const gptImage = stage2Output.images.find(
          (i) => i.model === "gpt-image-1.5",
        );

        if (!gptImage || !gptImage.base64) {
          // GPT-Image-1.5 produced no usable image (content filter /
          // missing base64). With Imagen removed we have no fallback,
          // but Stage 2 would have thrown upstream if all providers
          // failed — so this only trips if base64 is empty.
          log.logStageStart(3);
          log.logStageFailure(3, 0, "No GPT image to evaluate — skipping jury");
          log.logFallThrough(
            "Stage 3 skipped: no GPT image for extraction jury",
          );
        } else {
          log.logStageStart(3);
          const stage3Start = Date.now();

          try {
            const { output: stage3Output, metrics: stage3Metrics } =
              await runStage3ExtractionJury(
                { gptImage, brief: stage1Output.brief },
                log,
              );
            stage3Ms = Date.now() - stage3Start;

            const v = stage3Output.verdict;
            log.logStageSuccess(3, stage3Ms, {
              score: v.score,
              recommendation: v.recommendation,
              weakAreas:
                v.weakAreas.length > 0 ? v.weakAreas.join(", ") : "none",
              cost: `$${stage3Metrics.costUsd.toFixed(3)}`,
            });
            await fireProgress(config, 45, "stage3");

            // Stage 3 verdict is advisory — v.recommendation is logged
            // above for telemetry but does NOT branch behavior here. S4+5
            // always run on the GPT image; the Stage 6 quality gate
            // decides whether to retry. Phase 1.6 had three pass/retry/
            // fail branches that all called runStage4And5Block with
            // identical args (intended retry never implemented at this
            // layer) — collapsed in Phase 2.0a.
            const s45 = await runStage4And5Block(
              gptImage, stage1Output, config, config.parsedConstraints, log,
            );
            stage4Ms = s45.stage4Ms;
            stage5Ms = s45.stage5Ms;
            if (s45.project) candidateProject = s45.project;
          } catch (stage3Err) {
            // Branch 3: Stage 3 API failure — skip jury, run S4+5 directly
            stage3Ms = Date.now() - stage3Start;
            const msg = stage3Err instanceof Error ? stage3Err.message : String(stage3Err);
            log.logStageFailure(3, stage3Ms, msg);
            // Still try S4+5 without jury feedback
            const s45 = await runStage4And5Block(
              gptImage, stage1Output, config, config.parsedConstraints, log,
            );
            stage4Ms = s45.stage4Ms;
            stage5Ms = s45.stage5Ms;
            if (s45.project) candidateProject = s45.project;
          }
        }
      } catch (stage2Err) {
        stage2Ms = Date.now() - stage2Start;
        const msg = stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
        log.logStageFailure(2, stage2Ms, msg);
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
          { project: candidateProject, brief: stage1Output!.brief, parsedConstraints: config.parsedConstraints },
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
                    { project: retryS45.project, brief: stage1Output!.brief, parsedConstraints: config.parsedConstraints }, log,
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
      log.logStageStart(7);
      const s7Start = Date.now();
      const totalCostUsd = log.computeTotalCost();
      const { output: s7Output } = runStage7Delivery({
        project: finalProject,
        qualityScore,
        totalCostUsd,
        totalMs: Date.now() - startMs,
        retried: retryCount > 0,
        weakAreas: finalWeakAreas,
      }, log);
      stage7Ms = Date.now() - s7Start;
      log.logStageSuccess(7, stage7Ms, { qualityScore });
      await fireProgress(config, 100, "stage7");
      log.logSuccess(qualityScore);

      persistRecord(log.toDbRecord()).catch(() => {});

      return {
        success: true,
        project: s7Output.project,
        qualityScore,
        retried: retryCount > 0,
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
