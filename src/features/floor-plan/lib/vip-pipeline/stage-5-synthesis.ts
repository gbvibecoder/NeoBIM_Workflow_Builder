/**
 * Stage 5: Synthesis
 *
 * Scales normalized room rectangles to plot dimensions (feet, Y-UP, SW origin).
 * Feeds into existing buildWalls() / placeDoors() / placeWindows().
 * Output: StripPackResult (compatible with existing converter).
 *
 * Planned implementation: Phase 1.5
 */

import type { Stage5Input } from "./types";
import type { StripPackResult } from "../strip-pack/types";

export async function runStage5Synthesis(
  input: Stage5Input,
): Promise<StripPackResult> {
  throw new Error("Stage 5 (Synthesis) not implemented — Phase 1.5");
}
