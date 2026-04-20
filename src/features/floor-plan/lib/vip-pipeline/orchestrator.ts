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
 * Phase 1.4+: remaining stages implemented incrementally.
 */

import type { VIPPipelineConfig, VIPPipelineResult } from "./types";
import { VIPLogger } from "./logger";
import type { VIPGenerationRecord } from "./logger";
import { prisma } from "@/lib/db";
import { runStage1PromptIntelligence } from "./stage-1-prompt";

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

      // Stage 1 succeeded. Stages 2-7 not yet implemented — fall through
      // to PIPELINE_REF. The Stage 1 output is logged but not used yet.
      // NOTE: In Phase 1.3 the orchestrator completes synchronously before
      // returning, so status always transitions to FALL_THROUGH/SUCCESS/FAILED
      // before persist. If future phases introduce async stages that can hang
      // (Vercel timeout, API hang, etc.), we will need a "heartbeat" pattern:
      // persist a RUNNING row on entry, update status on completion.
      log.logFallThrough(
        "Stages 2-7 not yet implemented — Stage 1 succeeded, falling through",
      );
    } catch (stage1Err) {
      stage1Ms = Date.now() - stage1Start;
      const msg =
        stage1Err instanceof Error ? stage1Err.message : String(stage1Err);
      log.logStageFailure(1, stage1Ms, msg);
      log.logFallThrough(`Stage 1 failed: ${msg}`);
    }

    const result: VIPPipelineResult = {
      success: false,
      error: "VIP pipeline Stages 2-7 not yet implemented",
      shouldFallThrough: true,
      timing: { stage1Ms, totalMs: Date.now() - startMs },
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
