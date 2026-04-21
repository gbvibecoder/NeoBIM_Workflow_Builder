/**
 * Phase 2.4 P0-B — deterministic Stage 6 dimension evaluators.
 *
 * These read FloorPlanProject data that already exists post-Stage-5
 * and produce a 1-10 score. They complement the LLM-scored dimensions
 * without adding model cost.
 *
 * Exported for direct unit testing (stage-6-quality.ts stays the
 * integration surface).
 */

import type { FloorPlanProject, Room, Door, RoomType } from "@/types/floor-plan-cad";
import type { ArchitectBrief } from "./types";

export interface DimensionResult {
  score: number; // 1-10 (Stage 6 scale)
  reason: string;
}

const BEDROOM_TYPES: RoomType[] = ["bedroom", "master_bedroom", "guest_bedroom"];
const COMMON_AREA_TYPES: RoomType[] = [
  "living_room",
  "dining_room",
  "kitchen",
  "lobby",
  "foyer",
];

// ─── bedroomPrivacy ──────────────────────────────────────────────

export function evaluateBedroomPrivacy(
  project: FloorPlanProject,
): DimensionResult {
  const floor = project.floors[0];
  if (!floor) return { score: 10, reason: "No floor (N/A)" };

  const roomById = new Map<string, Room>(floor.rooms.map((r) => [r.id, r]));
  const bedrooms = floor.rooms.filter((r) => BEDROOM_TYPES.includes(r.type));
  if (bedrooms.length === 0) return { score: 10, reason: "No bedrooms (N/A)" };

  let leakyCount = 0;
  const leakyNames: string[] = [];

  for (const bed of bedrooms) {
    const doors = floor.doors.filter((d: Door) =>
      d.connects_rooms?.includes(bed.id),
    );
    let opensToCommon = false;
    for (const d of doors) {
      const otherId = d.connects_rooms.find((id) => id !== bed.id);
      if (!otherId) continue;
      const other = roomById.get(otherId);
      if (!other) continue;
      if (COMMON_AREA_TYPES.includes(other.type)) {
        opensToCommon = true;
        break;
      }
    }
    if (opensToCommon) {
      leakyCount += 1;
      leakyNames.push(bed.name);
    }
  }

  if (leakyCount === 0) {
    return { score: 10, reason: `All ${bedrooms.length} bedrooms private` };
  }
  if (leakyCount === 1) {
    return { score: 7, reason: `${leakyNames[0]} opens to a common area` };
  }
  return {
    score: 1,
    reason: `${leakyCount} bedrooms open to common areas: ${leakyNames.join(", ")}`,
  };
}

// ─── entranceDoor ────────────────────────────────────────────────

type Facing = "N" | "S" | "E" | "W";

function polygonBounds(points: { x: number; y: number }[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function wallCardinalSide(
  wall: { centerline: { start: { x: number; y: number }; end: { x: number; y: number } } },
  plot: { minX: number; maxX: number; minY: number; maxY: number },
): Facing | null {
  const dx = Math.abs(wall.centerline.end.x - wall.centerline.start.x);
  const dy = Math.abs(wall.centerline.end.y - wall.centerline.start.y);
  const midX = (wall.centerline.start.x + wall.centerline.end.x) / 2;
  const midY = (wall.centerline.start.y + wall.centerline.end.y) / 2;
  const plotWidth = plot.maxX - plot.minX;
  const plotHeight = plot.maxY - plot.minY;
  if (plotWidth <= 0 || plotHeight <= 0) return null;

  const tolerance = Math.min(plotWidth, plotHeight) * 0.15;

  if (dx > dy) {
    // Horizontal wall → north or south
    if (Math.abs(midY - plot.maxY) <= tolerance) return "N";
    if (Math.abs(midY - plot.minY) <= tolerance) return "S";
  } else {
    // Vertical wall → east or west
    if (Math.abs(midX - plot.maxX) <= tolerance) return "E";
    if (Math.abs(midX - plot.minX) <= tolerance) return "W";
  }
  return null;
}

function normalizeFacing(s: string | undefined): Facing | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  if (t === "N" || t === "NORTH") return "N";
  if (t === "S" || t === "SOUTH") return "S";
  if (t === "E" || t === "EAST") return "E";
  if (t === "W" || t === "WEST") return "W";
  return null;
}

function adjacent(a: Facing, b: Facing): boolean {
  const pairs: Record<Facing, Facing[]> = {
    N: ["E", "W"],
    S: ["E", "W"],
    E: ["N", "S"],
    W: ["N", "S"],
  };
  return pairs[a].includes(b);
}

export function evaluateEntranceDoor(
  project: FloorPlanProject,
  brief: ArchitectBrief,
): DimensionResult {
  const floor = project.floors[0];
  if (!floor) return { score: 5, reason: "No floor (neutral)" };

  const expected = normalizeFacing(brief.facing);
  if (!expected) {
    return { score: 5, reason: `Unknown facing "${brief.facing}" (neutral)` };
  }

  const mainDoor = floor.doors.find((d) => d.type === "main_entrance");
  if (!mainDoor) {
    return { score: 5, reason: "No main_entrance door found (neutral)" };
  }

  const wall = floor.walls.find((w) => w.id === mainDoor.wall_id);
  if (!wall) {
    return { score: 5, reason: "Main door references unknown wall (neutral)" };
  }

  const plot = polygonBounds(floor.boundary.points);
  const side = wallCardinalSide(wall, plot);
  if (!side) {
    return { score: 5, reason: "Main door wall not on a cardinal edge (neutral)" };
  }

  if (side === expected) {
    return { score: 10, reason: `Main entrance on ${side} as declared` };
  }
  if (adjacent(side, expected)) {
    return {
      score: 5,
      reason: `Main entrance on ${side} — adjacent to declared ${expected}`,
    };
  }
  return {
    score: 1,
    reason: `Main entrance on ${side} — opposite of declared ${expected}`,
  };
}
