import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, getAllRooms } from "./utils";

export function scoreCompleteness(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 25;
  const rooms = getAllRooms(project);
  const total = expectation.expected_rooms.length;
  if (total === 0) return { score: MAX, max: MAX, details: ["no expected rooms"] };

  const details: string[] = [];
  let matched = 0;
  for (const exp of expectation.expected_rooms) {
    const r = findMatchingRoom(rooms, exp.name_substring, exp.function);
    if (r) {
      matched++;
    } else {
      details.push(`MISSING: ${exp.name_substring} (${exp.function})`);
    }
  }

  const score = Math.round((matched / total) * MAX);
  details.unshift(`matched ${matched}/${total} expected rooms`);
  return { score, max: MAX, details };
}
