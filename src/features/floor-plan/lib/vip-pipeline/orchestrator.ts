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
 * Phase 1.5+: remaining stages implemented incrementally.
 */

import type { VIPPipelineConfig, VIPPipelineResult } from "./types";
import { VIPLogger } from "./logger";
import type { VIPGenerationRecord } from "./logger";
import { prisma } from "@/lib/db";
import { runStage1PromptIntelligence } from "./stage-1-prompt";
import { runStage2ParallelImageGen } from "./stage-2-images";

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

        // Stage 2 succeeded. Stages 3-7 not yet implemented — fall through.
        // NOTE: If future phases introduce async stages that can hang
        // (Vercel timeout, API hang, etc.), we will need a "heartbeat" pattern:
        // persist a RUNNING row on entry, update status on completion.
        log.logFallThrough(
          "Stages 3-7 not yet implemented — Stage 1+2 succeeded, falling through",
        );
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
      error: "VIP pipeline Stages 3-7 not yet implemented",
      shouldFallThrough: true,
      timing: { stage1Ms, stage2Ms, totalMs: Date.now() - startMs },
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
