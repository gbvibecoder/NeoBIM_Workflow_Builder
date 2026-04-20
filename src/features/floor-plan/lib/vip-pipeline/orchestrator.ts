/**
 * VIP Pipeline Orchestrator — Approach #17
 *
 * Fail-safe: ANY error is caught, logged with context, and returns
 * { success: false, shouldFallThrough: true } so route.ts falls
 * through to PIPELINE_REF.
 *
 * Phase 1.1: returns shouldFallThrough immediately.
 * Phase 1.2: adds structured logging + DB persistence.
 * Phase 1.3+: stages implemented incrementally.
 */

import type { VIPPipelineConfig, VIPPipelineResult } from "./types";
import { VIPLogger } from "./logger";
import type { VIPGenerationRecord } from "./logger";
import { prisma } from "@/lib/db";

export async function runVIPPipeline(
  config: VIPPipelineConfig,
): Promise<VIPPipelineResult> {
  const { requestId, userId } = config.logContext;
  const log = new VIPLogger(requestId, userId, config.prompt);
  const startMs = Date.now();

  try {
    log.logStart();

    // ── Phase 1.1: not yet implemented ──────────────────────────────
    // When stages are implemented (Phase 1.3+), this function will:
    //   1. Call each stage in sequence (Stage 2 runs models in parallel)
    //   2. Pass output of each stage as input to the next
    //   3. Retry Stage 4 if Stage 6 rejects quality
    //   4. Return the FloorPlanProject on success

    log.logFallThrough("VIP pipeline not yet implemented — Phase 1.1 scaffold");

    // NOTE: In Phase 1.2 the orchestrator completes synchronously before
    // returning, so status always transitions to FALL_THROUGH/SUCCESS/FAILED
    // before persist. If Phase 1.3+ introduces async stages that can hang
    // (Vercel timeout, API hang, etc.), we will need a "heartbeat" pattern:
    // persist a RUNNING row on entry, update status on completion. Not
    // required for Phase 1.2.

    const result: VIPPipelineResult = {
      success: false,
      error: "VIP pipeline not yet implemented — Phase 1.1 scaffold",
      shouldFallThrough: true,
      timing: { totalMs: Date.now() - startMs },
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
