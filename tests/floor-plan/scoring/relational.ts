import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, getAllRooms, roomCentroid, bbox } from "./utils";

function directionHoldsRoomA_to_RoomB(
  direction: string,
  aCx: number, aCy: number,
  bCx: number, bCy: number,
): boolean {
  // Project coords are Y-UP (high y = north). Scorer convention matches the
  // rendered output.
  const s = 10; // mm slack
  switch (direction) {
    case "W":  return aCx + s < bCx;
    case "E":  return aCx > bCx + s;
    case "N":  return aCy > bCy + s;
    case "S":  return aCy + s < bCy;
    case "NW": return aCx + s < bCx && aCy > bCy + s;
    case "NE": return aCx > bCx + s && aCy > bCy + s;
    case "SW": return aCx + s < bCx && aCy + s < bCy;
    case "SE": return aCx > bCx + s && aCy + s < bCy;
    default:   return true;
  }
}

export function scoreRelational(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 10;
  const rels = expectation.expected_relational ?? [];
  if (rels.length === 0) return { score: MAX, max: MAX, details: ["no relational expectations"] };

  const rooms = getAllRooms(project);
  const details: string[] = [];
  let matched = 0;

  for (const r of rels) {
    const roomA = findMatchingRoom(rooms, r.a);
    const roomB = findMatchingRoom(rooms, r.b);
    if (!roomA || !roomB) {
      details.push(`MISS (rooms not found): ${r.a} ${r.direction}-of ${r.b}`);
      continue;
    }
    const cA = roomCentroid(roomA);
    const cB = roomCentroid(roomB);
    if (directionHoldsRoomA_to_RoomB(r.direction, cA.x, cA.y, cB.x, cB.y)) {
      matched++;
    } else {
      details.push(`MISS (direction): "${r.a}" should be ${r.direction} of "${r.b}" (actual: A@(${Math.round(cA.x)},${Math.round(cA.y)}) B@(${Math.round(cB.x)},${Math.round(cB.y)}))`);
    }
  }

  const score = Math.round((matched / rels.length) * MAX);
  details.unshift(`${matched}/${rels.length} directional relationships honored`);
  return { score, max: MAX, details };
}
