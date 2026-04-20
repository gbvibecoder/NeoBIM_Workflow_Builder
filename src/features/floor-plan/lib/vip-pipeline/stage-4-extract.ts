/**
 * Stage 4: Room Extraction
 *
 * GPT-4o Vision extracts room rectangles ONLY from the winning image.
 * Output: normalized (0–1) coordinates per room. No walls, no doors.
 *
 * Planned implementation: Phase 1.2
 */

import type { Stage4Input, Stage4Output } from "./types";

export async function runStage4RoomExtraction(
  input: Stage4Input,
): Promise<Stage4Output> {
  throw new Error("Stage 4 (Room Extraction) not implemented — Phase 1.2");
}
