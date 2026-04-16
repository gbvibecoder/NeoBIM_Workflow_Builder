import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation } from "../types";
import { projectBbox } from "./utils";

export function scoreMainEntrance(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 5;
  const expectedSide = expectation.expected_main_entrance_side;
  if (!expectedSide) return { score: MAX, max: MAX, details: ["no main_entrance expectation"] };

  const details: string[] = [];
  const floor = project.floors[0];
  if (!floor) return { score: 0, max: MAX, details: ["no floor"] };

  const mainDoor = floor.doors.find(d => d.type === "main_entrance");
  if (!mainDoor) {
    details.push("no main_entrance door in project");
    return { score: 0, max: MAX, details };
  }

  const wall = floor.walls.find(w => w.id === mainDoor.wall_id);
  if (!wall) {
    details.push("main_entrance door wall_id not found");
    return { score: 0, max: MAX, details };
  }

  const pb = projectBbox(project);
  if (!pb) return { score: 0, max: MAX, details: ["no bbox"] };

  const sx = wall.centerline.start.x, sy = wall.centerline.start.y;
  const ex = wall.centerline.end.x, ey = wall.centerline.end.y;
  const tol = 50; // mm

  let actualSide: "N" | "S" | "E" | "W" | null = null;
  // Y-UP world: high y = north. A horizontal wall at y ≈ pb.maxY is N, at y ≈ pb.minY is S.
  if (Math.abs(sy - ey) < tol) {
    if (Math.abs(sy - pb.maxY) < tol) actualSide = "N";
    else if (Math.abs(sy - pb.minY) < tol) actualSide = "S";
  } else if (Math.abs(sx - ex) < tol) {
    if (Math.abs(sx - pb.maxX) < tol) actualSide = "E";
    else if (Math.abs(sx - pb.minX) < tol) actualSide = "W";
  }

  if (actualSide === expectedSide) {
    details.push(`main_entrance on ${actualSide} wall ✓`);
    return { score: MAX, max: MAX, details };
  }
  details.push(`main_entrance on ${actualSide ?? "interior"} wall, expected ${expectedSide}`);
  return { score: 0, max: MAX, details };
}
