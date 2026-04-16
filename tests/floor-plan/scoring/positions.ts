import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, quadrantOf, getAllRooms } from "./utils";

export function scorePositions(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 15;
  const rooms = getAllRooms(project);
  const expectedWithPos = expectation.expected_rooms.filter(r => r.position_direction);
  if (expectedWithPos.length === 0) return { score: MAX, max: MAX, details: ["no position expectations"] };

  const details: string[] = [];
  let matched = 0;

  for (const exp of expectedWithPos) {
    const r = findMatchingRoom(rooms, exp.name_substring, exp.function);
    if (!r) {
      details.push(`MISS (no room): ${exp.name_substring}`);
      continue;
    }
    const actual = quadrantOf(r, project);
    if (actual === exp.position_direction) {
      matched++;
    } else {
      details.push(`MISS (pos): ${exp.name_substring} expected ${exp.position_direction}, got ${actual}`);
    }
  }

  const score = Math.round((matched / expectedWithPos.length) * MAX);
  details.unshift(`${matched}/${expectedWithPos.length} positions matched`);
  return { score, max: MAX, details };
}
