import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, getAllRooms, bbox } from "./utils";

const MIN_SHARED_MM = 3 * 304.8;

function roomRect(r: Room) {
  const b = bbox(r.boundary.points);
  return { x: b.minX, y: b.minY, width: b.width, depth: b.height };
}

function rectsShareEdgeMm(a: ReturnType<typeof roomRect>, b: ReturnType<typeof roomRect>): number {
  const tol = 50;
  if (Math.abs(a.x + a.width - b.x) < tol || Math.abs(b.x + b.width - a.x) < tol) {
    return Math.max(0, Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y));
  }
  if (Math.abs(a.y + a.depth - b.y) < tol || Math.abs(b.y + b.depth - a.y) < tol) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  }
  return 0;
}

export function scoreHallway(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 5;
  const expectedConnects = expectation.expected_hallway_connects ?? [];
  if (expectedConnects.length === 0) return { score: MAX, max: MAX, details: ["no hallway connectivity expectation"] };

  const details: string[] = [];
  const rooms = getAllRooms(project);

  const hallway = rooms.find(r => /hallway|corridor|passage/i.test(r.name));
  if (!hallway) {
    details.push("no hallway/corridor room found");
    return { score: 0, max: MAX, details };
  }
  const hRect = roomRect(hallway);

  let connected = 0;
  for (const needle of expectedConnects) {
    const r = findMatchingRoom(rooms, needle);
    if (!r) { details.push(`room not found: ${needle}`); continue; }
    const rect = roomRect(r);
    const shared = rectsShareEdgeMm(hRect, rect);
    if (shared >= MIN_SHARED_MM - 50) connected++;
    else details.push(`"${needle}" shares ${(shared / 304.8).toFixed(1)}ft with hallway (need >=3ft)`);
  }

  const score = Math.round((connected / expectedConnects.length) * MAX);
  details.unshift(`${connected}/${expectedConnects.length} rooms connected to hallway`);
  return { score, max: MAX, details };
}
