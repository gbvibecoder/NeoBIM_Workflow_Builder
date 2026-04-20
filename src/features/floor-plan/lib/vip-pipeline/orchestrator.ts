/**
 * VIP Pipeline Orchestrator — Approach #17
 *
 * Runs the 7-stage Visual Intelligence Pipeline.
 * API keys are read from process.env by each stage directly.
 *
 * Fail-safe: ANY stage error is caught, logged with context, and
 * returns { success: false, shouldFallThrough: true } so route.ts
 * can fall through to PIPELINE_REF as a safety net.
 *
 * Phase 1.1: scaffolding only — returns shouldFallThrough immediately.
 * Planned implementation: Phase 1.2+
 */

import type { VIPPipelineConfig, VIPPipelineResult } from "./types";

export async function runVIPPipeline(
  config: VIPPipelineConfig,
): Promise<VIPPipelineResult> {
  const startMs = Date.now();

  try {
    // ── Phase 1.1: not yet implemented ──────────────────────────────
    // When stages are implemented (Phase 1.2+), this function will:
    //   1. Call each stage in sequence (Stage 2 runs models in parallel)
    //   2. Pass output of each stage as input to the next
    //   3. Retry Stage 4 if Stage 6 rejects quality
    //   4. Return the FloorPlanProject on success
    //
    // For now, signal the route to fall through to PIPELINE_REF.

    console.warn("[VIP] Pipeline not yet implemented (Phase 1.1 scaffold) — falling through");

    return {
      success: false,
      error: "VIP pipeline not yet implemented — Phase 1.1 scaffold",
      shouldFallThrough: true,
      timing: { totalMs: Date.now() - startMs },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[VIP] Unexpected error in orchestrator: ${message}`, err);

    return {
      success: false,
      error: message,
      shouldFallThrough: true,
      stage: "orchestrator",
      timing: { totalMs: Date.now() - startMs },
    };
  }
}
