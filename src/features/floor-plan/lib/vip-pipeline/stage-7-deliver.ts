/**
 * Stage 7: Delivery
 *
 * Converts StripPackResult → FloorPlanProject via the existing
 * strip-pack converter (toFloorPlanProject). No new converter needed.
 *
 * Planned implementation: Phase 1.5
 */

import type { Stage7Input } from "./types";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

export async function runStage7Delivery(
  input: Stage7Input,
): Promise<FloorPlanProject> {
  throw new Error("Stage 7 (Delivery) not implemented — Phase 1.5");
}
