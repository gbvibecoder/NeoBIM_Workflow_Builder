import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";

export function scoreGaps(project: FloorPlanProject, _expectation: PromptExpectation): MetricResult {
  const MAX = 5;
  const details: string[] = [];

  const floor = project.floors[0];
  if (!floor) return { score: 0, max: MAX, details: ["no floor in project"] };

  const wallCount = floor.walls.length;
  const roomCount = floor.rooms.length;
  const doorCount = floor.doors.length;

  const wallEndpoints = new Map<string, number>();
  for (const w of floor.walls) {
    const k1 = `${Math.round(w.centerline.start.x)},${Math.round(w.centerline.start.y)}`;
    const k2 = `${Math.round(w.centerline.end.x)},${Math.round(w.centerline.end.y)}`;
    wallEndpoints.set(k1, (wallEndpoints.get(k1) ?? 0) + 1);
    wallEndpoints.set(k2, (wallEndpoints.get(k2) ?? 0) + 1);
  }
  const danglingEndpoints = [...wallEndpoints.values()].filter(c => c < 2).length;

  let penalty = 0;
  if (danglingEndpoints > 0) {
    penalty += Math.min(3, danglingEndpoints);
    details.push(`${danglingEndpoints} dangling wall endpoints`);
  }
  if (roomCount > 0 && doorCount < Math.max(2, Math.floor(roomCount / 2))) {
    penalty += 1;
    details.push(`only ${doorCount} doors for ${roomCount} rooms`);
  }
  if (wallCount === 0) {
    penalty += MAX;
    details.push("no walls generated at all");
  }

  const score = Math.max(0, MAX - penalty);
  details.unshift(`walls=${wallCount}, rooms=${roomCount}, doors=${doorCount}`);
  return { score, max: MAX, details };
}
