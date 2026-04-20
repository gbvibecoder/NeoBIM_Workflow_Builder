/**
 * Stage 7: Delivery
 *
 * Stamps final metadata onto FloorPlanProject and returns it.
 * Pure code — no API calls. <5ms execution.
 */

import type { Stage7Input, Stage7Output } from "./types";
import type { VIPLogger } from "./logger";

export function runStage7Delivery(
  input: Stage7Input,
  logger?: VIPLogger,
): { output: Stage7Output } {
  const project = input.project;

  // Stamp VIP generation metadata (additive — preserves existing fields)
  const meta = project.metadata as unknown as Record<string, unknown>;
  meta.generation_model = "vip-pipeline";
  meta.generation_quality_score = input.qualityScore;
  meta.generation_cost_usd = input.totalCostUsd;
  meta.generation_time_ms = input.totalMs;
  meta.generation_retried = input.retried;
  meta.generation_weak_areas = input.weakAreas;
  meta.generation_timestamp = new Date().toISOString();

  if (logger) logger.logStageCost(7, 0);

  return { output: { project } };
}
