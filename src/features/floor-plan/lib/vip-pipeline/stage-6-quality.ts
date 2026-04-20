/**
 * Stage 6: Quality Gate
 *
 * Claude Sonnet as architect critic. Checks proportions, adjacency,
 * natural light access, circulation. Returns pass/fail + issues.
 * If fail, orchestrator retries Stage 4 with feedback (max 2 retries).
 *
 * Planned implementation: Phase 1.6
 */

import type { Stage6Input, Stage6Output } from "./types";

export async function runStage6QualityGate(
  input: Stage6Input,
): Promise<Stage6Output> {
  throw new Error("Stage 6 (Quality Gate) not implemented — Phase 1.6");
}
