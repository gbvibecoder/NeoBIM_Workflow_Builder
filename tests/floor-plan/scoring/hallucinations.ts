import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, getAllRooms } from "./utils";

export function scoreHallucinations(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 10;
  const rooms = getAllRooms(project);
  const details: string[] = [];

  let forbiddenHits = 0;
  for (const forbidden of expectation.forbidden_rooms) {
    const sub = forbidden.toLowerCase();
    const hit = rooms.find(r => r.name.toLowerCase().includes(sub));
    if (hit) {
      forbiddenHits++;
      details.push(`FORBIDDEN: "${forbidden}" appeared as "${hit.name}"`);
    }
  }

  const expectedSubstrings = expectation.expected_rooms.map(e => e.name_substring.toLowerCase());
  let extraRooms = 0;
  for (const room of rooms) {
    const matchesExpected = expectedSubstrings.some(sub => room.name.toLowerCase().includes(sub));
    const matchesByFunction = expectation.expected_rooms.some(
      e => room.type.toLowerCase().includes(e.function.toLowerCase())
    );
    if (!matchesExpected && !matchesByFunction) {
      extraRooms++;
      details.push(`EXTRA: ${room.name} (${room.type})`);
    }
  }

  const score = Math.max(0, MAX - 5 * forbiddenHits - 1 * extraRooms);
  details.unshift(`${forbiddenHits} forbidden, ${extraRooms} extra rooms`);
  return { score, max: MAX, details };
}
