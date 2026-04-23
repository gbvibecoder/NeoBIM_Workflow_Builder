/**
 * Stage 7: Delivery
 *
 * Stamps final metadata onto FloorPlanProject and returns it.
 * Pure code — no API calls. <5ms execution.
 */

import type { Stage7Input, Stage7Output } from "./types";
import type { VIPLogger } from "./logger";

/**
 * Phase 2.7A: derived banner tone for the UI. Stage 6's LLM-level
 * `recommendation` field isn't piped through Stage7Input today, so we
 * compute a deterministic recommendation from `qualityScore` thresholds
 * that match the banner contract in FloorPlanViewer:
 *   score >= 80 → "pass"   (green banner)
 *   score >= 65 → "retry"  (yellow banner — usable but below target)
 *   score <  65 → "fail"   (red banner — quality gate failed)
 *
 * Exported so tests and the viewer can share the same thresholds.
 */
export type VipQualityRecommendation = "pass" | "retry" | "fail";

export function deriveQualityRecommendation(score: number): VipQualityRecommendation {
  if (!Number.isFinite(score)) return "fail";
  if (score >= 80) return "pass";
  if (score >= 65) return "retry";
  return "fail";
}

export function runStage7Delivery(
  input: Stage7Input,
  logger?: VIPLogger,
): { output: Stage7Output } {
  const project = input.project;

  // Stamp VIP generation metadata (additive — preserves existing fields)
  const meta = project.metadata as unknown as Record<string, unknown>;
  meta.generation_model = "vip-pipeline";
  meta.generation_quality_score = input.qualityScore;
  meta.generation_quality_recommendation = deriveQualityRecommendation(input.qualityScore);
  meta.generation_cost_usd = input.totalCostUsd;
  meta.generation_time_ms = input.totalMs;
  meta.generation_retried = input.retried;
  // Phase 2.12 — vision-jury retry count (0 = first image passed jury).
  meta.generation_vision_jury_retries = input.visionJuryRetries ?? 0;
  meta.generation_weak_areas = input.weakAreas;
  meta.generation_timestamp = new Date().toISOString();

  if (logger) logger.logStageCost(7, 0);

  return { output: { project } };
}
