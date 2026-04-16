import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, roomDimsFt, getAllRooms } from "./utils";

const TOLERANCE = 0.05;

export function scoreDims(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 15;
  const rooms = getAllRooms(project);
  const expectedWithDims = expectation.expected_rooms.filter(r => r.dim_width_ft && r.dim_depth_ft);
  if (expectedWithDims.length === 0) return { score: MAX, max: MAX, details: ["no dim expectations"] };

  const details: string[] = [];
  let matched = 0;

  for (const exp of expectedWithDims) {
    const r = findMatchingRoom(rooms, exp.name_substring, exp.function);
    if (!r) {
      details.push(`MISS (no room): ${exp.name_substring}`);
      continue;
    }
    const { width_ft, depth_ft } = roomDimsFt(r);
    const wOk = Math.abs(width_ft - exp.dim_width_ft!) / exp.dim_width_ft! <= TOLERANCE;
    const dOk = Math.abs(depth_ft - exp.dim_depth_ft!) / exp.dim_depth_ft! <= TOLERANCE;
    const swappedOk = !wOk || !dOk
      ? Math.abs(width_ft - exp.dim_depth_ft!) / exp.dim_depth_ft! <= TOLERANCE &&
        Math.abs(depth_ft - exp.dim_width_ft!) / exp.dim_width_ft! <= TOLERANCE
      : false;
    if ((wOk && dOk) || swappedOk) {
      matched++;
    } else {
      details.push(`MISS (dim): ${exp.name_substring} expected ${exp.dim_width_ft}x${exp.dim_depth_ft}ft, got ${width_ft.toFixed(1)}x${depth_ft.toFixed(1)}ft`);
    }
  }

  const score = Math.round((matched / expectedWithDims.length) * MAX);
  details.unshift(`${matched}/${expectedWithDims.length} dims within ±${TOLERANCE * 100}%`);
  return { score, max: MAX, details };
}
