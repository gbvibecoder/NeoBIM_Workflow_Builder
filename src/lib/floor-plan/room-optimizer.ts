/**
 * Room Optimizer — AI-powered room swap suggestions
 *
 * Analyzes the current floor plan's Vastu compliance and suggests
 * room swaps that would improve the overall score.
 */

import type { Floor, Room } from "@/types/floor-plan-cad";
import { polygonCentroid, polygonBounds, floorBounds } from "@/lib/floor-plan/geometry";
import { analyzeVastuCompliance } from "./vastu-analyzer";
import {
  ALL_VASTU_RULES,
  DIRECTION_LABELS,
  type VastuDirection,
} from "./vastu-rules";

// ============================================================
// TYPES
// ============================================================

export interface SwapSuggestion {
  id: string;
  room_a_id: string;
  room_a_name: string;
  room_a_current_dir: VastuDirection;
  room_b_id: string;
  room_b_name: string;
  room_b_current_dir: VastuDirection;
  current_score: number;
  projected_score: number;
  improvement: number; // percentage points improvement
  reason: string;
  priority: "high" | "medium" | "low";
}

// ============================================================
// SWAP SUGGESTER
// ============================================================

export function suggestRoomSwaps(
  floor: Floor,
  northAngleDeg: number = 0,
  maxSuggestions: number = 5
): SwapSuggestion[] {
  const currentReport = analyzeVastuCompliance(floor, northAngleDeg);
  const currentScore = currentReport.score;

  // Only consider rooms with violations or acceptable status
  const violatingItems = currentReport.items.filter(
    (item) => item.status === "violation" || item.status === "acceptable"
  );

  if (violatingItems.length === 0) return [];

  const suggestions: SwapSuggestion[] = [];
  const rooms = floor.rooms;

  // Try all room pairs
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const roomA = rooms[i];
      const roomB = rooms[j];

      // Skip non-swappable pairs (e.g., corridor with bedroom)
      if (!canSwap(roomA, roomB)) continue;

      // Simulate the swap and compute new score
      const projected = simulateSwapScore(floor, roomA, roomB, northAngleDeg);
      const improvement = projected - currentScore;

      if (improvement > 0) {
        const dirA = getRoomDir(roomA, floor);
        const dirB = getRoomDir(roomB, floor);

        suggestions.push({
          id: `swap-${roomA.id}-${roomB.id}`,
          room_a_id: roomA.id,
          room_a_name: roomA.name,
          room_a_current_dir: dirA,
          room_b_id: roomB.id,
          room_b_name: roomB.name,
          room_b_current_dir: dirB,
          current_score: currentScore,
          projected_score: projected,
          improvement,
          reason: buildSwapReason(roomA, dirA, roomB, dirB),
          priority: improvement >= 10 ? "high" : improvement >= 5 ? "medium" : "low",
        });
      }
    }
  }

  // Sort by improvement descending
  suggestions.sort((a, b) => b.improvement - a.improvement);
  return suggestions.slice(0, maxSuggestions);
}

// ============================================================
// HELPERS
// ============================================================

function canSwap(a: Room, b: Room): boolean {
  // Don't swap circulation spaces or structural rooms
  const nonSwappable = ["corridor", "lobby", "foyer", "staircase", "elevator", "shaft", "fire_escape"];
  if (nonSwappable.includes(a.type) || nonSwappable.includes(b.type)) return false;

  // Don't swap rooms that are very different in size (>3x)
  if (a.area_sqm > 0 && b.area_sqm > 0) {
    const ratio = Math.max(a.area_sqm, b.area_sqm) / Math.min(a.area_sqm, b.area_sqm);
    if (ratio > 3) return false;
  }

  return true;
}

function simulateSwapScore(
  floor: Floor,
  roomA: Room,
  roomB: Room,
  northAngleDeg: number
): number {
  // Create a virtual floor with rooms' positions/directions swapped
  const swappedRooms = floor.rooms.map((r) => {
    if (r.id === roomA.id) {
      // Room A gets Room B's position/boundary
      return {
        ...r,
        boundary: roomB.boundary,
        label_position: roomB.label_position,
        area_sqm: roomB.area_sqm,
        perimeter_mm: roomB.perimeter_mm,
        wall_ids: roomB.wall_ids,
        vastu_direction: roomB.vastu_direction,
      };
    }
    if (r.id === roomB.id) {
      // Room B gets Room A's position/boundary
      return {
        ...r,
        boundary: roomA.boundary,
        label_position: roomA.label_position,
        area_sqm: roomA.area_sqm,
        perimeter_mm: roomA.perimeter_mm,
        wall_ids: roomA.wall_ids,
        vastu_direction: roomA.vastu_direction,
      };
    }
    return r;
  });

  const virtualFloor: Floor = { ...floor, rooms: swappedRooms };
  const report = analyzeVastuCompliance(virtualFloor, northAngleDeg);
  return report.score;
}

function getRoomDir(room: Room, floor: Floor): VastuDirection {
  if (room.vastu_direction) return room.vastu_direction;

  const bounds = floorBounds(floor.walls, floor.rooms);
  const cellW = bounds.width / 3;
  const cellH = bounds.height / 3;
  const centroid = polygonCentroid(room.boundary.points);

  const relX = centroid.x - bounds.min.x;
  const relY = centroid.y - bounds.min.y;
  let col = Math.max(0, Math.min(2, Math.floor(relX / cellW)));
  let row = Math.max(0, Math.min(2, Math.floor(relY / cellH)));
  const gridRow = 2 - row;

  const GRID: VastuDirection[][] = [
    ["NW", "N", "NE"],
    ["W", "CENTER", "E"],
    ["SW", "S", "SE"],
  ];
  return GRID[gridRow][col];
}

function buildSwapReason(
  a: Room,
  dirA: VastuDirection,
  b: Room,
  dirB: VastuDirection
): string {
  const labelA = DIRECTION_LABELS[dirA];
  const labelB = DIRECTION_LABELS[dirB];

  // Check what rules apply to each room type
  const rulesForA = ALL_VASTU_RULES.filter((r) =>
    r.category === "room_placement" && r.room_types.includes(a.type)
  );
  const rulesForB = ALL_VASTU_RULES.filter((r) =>
    r.category === "room_placement" && r.room_types.includes(b.type)
  );

  const parts: string[] = [];

  // Check if A would be better in B's position
  for (const rule of rulesForA) {
    if (rule.preferred_directions.includes(dirB) && !rule.preferred_directions.includes(dirA)) {
      parts.push(`${a.name} → ${labelB} (ideal for ${a.type.replace(/_/g, " ")})`);
      break;
    }
  }

  for (const rule of rulesForB) {
    if (rule.preferred_directions.includes(dirA) && !rule.preferred_directions.includes(dirB)) {
      parts.push(`${b.name} → ${labelA} (ideal for ${b.type.replace(/_/g, " ")})`);
      break;
    }
  }

  if (parts.length > 0) {
    return parts.join("; ");
  }

  return `Swapping ${a.name} (${labelA}) with ${b.name} (${labelB}) improves Vastu alignment.`;
}
