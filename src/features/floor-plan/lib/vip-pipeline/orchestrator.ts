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
 * Phase 1.5: 2-provider alignment (GPT Image 1.5 + Imagen 4).
 * Phase 1.6: Stage 3 (Extraction Readiness Jury) implemented.
 * Phase 1.7: Stage 4 (Room Extraction with GPT-4o Vision) implemented.
 * Phase 1.8+: remaining stages implemented incrementally.
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

/** Run Stage 4 extraction on a GPT image. Returns duration in ms. */
async function runStage4Block(
  gptImage: GeneratedImage,
  stage1Output: Stage1Output,
  log: VIPLogger,
): Promise<number> {
  log.logStageStart(4);
  const start = Date.now();
  try {
    const { output: stage4Output, metrics: stage4Metrics } =
      await runStage4RoomExtraction(
        { image: gptImage, brief: stage1Output.brief },
        log,
      );
    const ms = Date.now() - start;
    const ext = stage4Output.extraction;
    log.logStageSuccess(4, ms, {
      rooms: ext.rooms.length,
      missing: ext.expectedRoomsMissing.length,
      unexpected: ext.unexpectedRoomsFound.length,
      issues: ext.issues.length,
      cost: `$${stage4Metrics.costUsd.toFixed(3)}`,
    });
    log.logFallThrough(
      `Stages 5-7 not yet implemented — S1+S2+S3+S4 succeeded (${ext.rooms.length} rooms), falling through`,
    );
    return ms;
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    log.logStageFailure(4, ms, msg);
    log.logFallThrough(`Stage 4 failed: ${msg}`);
    return ms;
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

    try {
      const { output: stage1Output, metrics: stage1Metrics } =
        await runStage1PromptIntelligence(
          { prompt: config.prompt, parsedConstraints: config.parsedConstraints },
          log,
        );
      stage1Ms = Date.now() - stage1Start;

      log.logStageSuccess(1, stage1Ms, {
        rooms: stage1Output.brief.roomList.length,
        prompts: stage1Output.imagePrompts.length,
        cost: `$${stage1Metrics.costUsd.toFixed(3)}`,
      });

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

        // ── Stage 3: Extraction Readiness Jury ────────────────────────
        const gptImage = stage2Output.images.find(
          (i) => i.model === "gpt-image-1.5",
        );

        if (!gptImage || !gptImage.base64) {
          // Branch 2: GPT image missing — only Imagen succeeded
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

            if (v.recommendation === "pass") {
              // Branch 1a: PASS — run Stage 4 on original GPT image
              stage4Ms = await runStage4Block(
                gptImage,
                stage1Output,
                log,
              );
            } else if (v.recommendation === "retry") {
              // Branch 1b: RETRY — re-run Stage 2 GPT only (max 1 retry this phase)
              log.logStageStart(2, "Parallel Image Gen (GPT retry)");
              const retryStart = Date.now();
              try {
                const gptPrompt = stage1Output.imagePrompts.find(
                  (p) => p.model === "gpt-image-1.5",
                );
                if (gptPrompt) {
                  const weakHint =
                    v.weakAreas.length > 0
                      ? `\n\nIMPORTANT: Previous attempt scored poorly on: ${v.weakAreas.join(", ")}. Pay extra attention to these areas.`
                      : "";
                  const amendedPrompts = [
                    { ...gptPrompt, prompt: gptPrompt.prompt + weakHint },
                  ];
                  const { output: retryOutput } =
                    await runStage2ParallelImageGen(
                      { imagePrompts: amendedPrompts },
                      log,
                    );
                  const retryMs = Date.now() - retryStart;
                  log.logStageSuccess(2, retryMs, {
                    images: retryOutput.images.length,
                    note: "GPT retry after jury RETRY verdict",
                  });

                  // Run Stage 4 on the retried GPT image
                  const retriedGpt = retryOutput.images.find(
                    (i) => i.model === "gpt-image-1.5",
                  );
                  if (retriedGpt?.base64) {
                    stage4Ms = await runStage4Block(
                      retriedGpt,
                      stage1Output,
                      log,
                    );
                  } else {
                    log.logFallThrough(
                      `Jury RETRY: GPT re-gen succeeded but no base64 — falling through`,
                    );
                  }
                }
              } catch (retryErr) {
                const msg =
                  retryErr instanceof Error
                    ? retryErr.message
                    : String(retryErr);
                log.logStageFailure(
                  2,
                  Date.now() - retryStart,
                  `GPT retry failed: ${msg}`,
                );
                log.logFallThrough(
                  `Jury RETRY: GPT re-gen failed — falling through`,
                );
              }
            } else {
              // Branch 1c: FAIL
              log.logFallThrough(
                `Jury FAIL (score=${v.score}): ${v.reasoning.slice(0, 100)}`,
              );
            }
          } catch (stage3Err) {
            // Branch 3: Stage 3 API failure — fall through, don't retry
            stage3Ms = Date.now() - stage3Start;
            const msg =
              stage3Err instanceof Error
                ? stage3Err.message
                : String(stage3Err);
            log.logStageFailure(3, stage3Ms, msg);
            log.logFallThrough(`Stage 3 API failed: ${msg}`);
          }
        }
      } catch (stage2Err) {
        stage2Ms = Date.now() - stage2Start;
        const msg =
          stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
        log.logStageFailure(2, stage2Ms, msg);
        log.logFallThrough(`Stage 2 failed: ${msg}`);
      }
    } catch (stage1Err) {
      stage1Ms = Date.now() - stage1Start;
      const msg =
        stage1Err instanceof Error ? stage1Err.message : String(stage1Err);
      log.logStageFailure(1, stage1Ms, msg);
      log.logFallThrough(`Stage 1 failed: ${msg}`);
    }

    const result: VIPPipelineResult = {
      success: false,
      error: "VIP pipeline Stages 5-7 not yet implemented",
      shouldFallThrough: true,
      timing: { stage1Ms, stage2Ms, stage3Ms, stage4Ms, totalMs: Date.now() - startMs },
    };

    // Fire-and-forget DB persist — never blocks the response
    persistRecord(log.toDbRecord()).catch(() => {});

    return result;
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
