import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { findMatchingRoom, getAllRooms, projectBbox } from "./utils";

function wallSide(wall: { centerline: { start: { x: number; y: number }; end: { x: number; y: number } } }, pb: ReturnType<typeof projectBbox>): "N" | "S" | "E" | "W" | null {
  if (!pb) return null;
  const { start, end } = wall.centerline;
  const tol = 50;
  if (Math.abs(start.y - end.y) < tol) {
    if (Math.abs(start.y - pb.maxY) < tol) return "N";
    if (Math.abs(start.y - pb.minY) < tol) return "S";
  } else if (Math.abs(start.x - end.x) < tol) {
    if (Math.abs(start.x - pb.maxX) < tol) return "E";
    if (Math.abs(start.x - pb.minX) < tol) return "W";
  }
  return null;
}

export function scoreWindows(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 5;
  const expectedWindows = expectation.expected_windows ?? [];
  if (expectedWindows.length === 0) return { score: MAX, max: MAX, details: ["no window expectations"] };

  const details: string[] = [];
  const floor = project.floors[0];
  if (!floor) return { score: 0, max: MAX, details: ["no floor"] };

  const pb = projectBbox(project);
  const rooms = getAllRooms(project);

  // Build a map from each external wall id to its side
  const wallSideMap = new Map<string, "N" | "S" | "E" | "W">();
  for (const w of floor.walls) {
    const side = wallSide(w, pb);
    if (side) wallSideMap.set(w.id, side);
  }

  // A window "matches" if there's at least one window in the project whose
  // wall is on the expected side AND whose wall is external (in wallSideMap).
  // We approximate per-room ownership by centroid proximity to the named room.
  let matched = 0;
  for (const ew of expectedWindows) {
    const room = findMatchingRoom(rooms, ew.room);
    if (!room) { details.push(`room not found: ${ew.room}`); continue; }

    const found = floor.windows.some(win => {
      const side = wallSideMap.get(win.wall_id);
      return side === ew.wall;
    });
    if (found) matched++;
    else details.push(`no window on ${ew.wall} wall for "${ew.room}"`);
  }

  const score = Math.round((matched / expectedWindows.length) * MAX);
  details.unshift(`${matched}/${expectedWindows.length} windows on expected walls`);
  return { score, max: MAX, details };
}
