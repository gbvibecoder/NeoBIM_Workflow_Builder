/**
 * Stage 2: Parallel Image Generation
 *
 * Fires 2–5 image models in parallel. Each model receives a tailored
 * prompt from Stage 1. API keys read from process.env per model.
 *
 * Planned implementation: Phase 1.3
 */

import type { Stage2Input, Stage2Output } from "./types";

export async function runStage2ImageGeneration(
  input: Stage2Input,
): Promise<Stage2Output> {
  throw new Error("Stage 2 (Image Generation) not implemented — Phase 1.3");
}
