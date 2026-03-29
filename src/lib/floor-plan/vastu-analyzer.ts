/**
 * Vastu Shastra Compliance Analyzer
 *
 * Analyzes a floor plan against Vastu Shastra rules by:
 * 1. Computing the floor bounding box
 * 2. Dividing it into a 3×3 directional grid (Vastu Purusha Mandala)
 * 3. Mapping each room's centroid to a direction zone
 * 4. Checking room placements against the rules
 */

import type { Floor, Room, Door, Wall, Point } from "@/types/floor-plan-cad";
import { polygonCentroid, polygonBounds, floorBounds } from "@/lib/floor-plan/geometry";
import {
  ALL_VASTU_RULES,
  DIRECTION_LABELS,
  type VastuDirection,
  type VastuSeverity,
  type VastuRule,
} from "./vastu-rules";

// ============================================================
// TYPES
// ============================================================

export type VastuGrade = "A+" | "A" | "B+" | "B" | "C" | "D" | "F";

export interface VastuReportItem {
  rule_id: string;
  rule: VastuRule;
  room_id: string | null;
  room_name: string | null;
  actual_direction: VastuDirection;
  status: "pass" | "acceptable" | "violation";
  severity: VastuSeverity;
  message: string;
  remedy: string;
  penalty_applied: number;
}

export interface VastuReport {
  score: number; // 0-100
  grade: VastuGrade;
  total_rules_checked: number;
  passes: number;
  acceptable: number;
  violations: number;
  items: VastuReportItem[];
  suggestions: string[];
  zone_grid: ZoneGrid;
}

export interface ZoneGrid {
  bounds: { min: Point; max: Point; width: number; height: number };
  cell_width: number;
  cell_height: number;
  /** 3×3 grid: [row][col] where row 0=top(N), col 0=left(W) */
  cells: ZoneCell[][];
}

export interface ZoneCell {
  direction: VastuDirection;
  bounds: { min: Point; max: Point };
  rooms_in_zone: string[]; // room IDs
}

// ============================================================
// ZONE GRID — 3×3 Directional Grid
// ============================================================

/**
 * Maps row/col indices to Vastu directions.
 * Row 0 = top (North side), Row 2 = bottom (South side)
 * Col 0 = left (West side), Col 2 = right (East side)
 *
 * Layout:
 *   NW  N   NE
 *   W   C   E
 *   SW  S   SE
 */
const GRID_DIRECTIONS: VastuDirection[][] = [
  ["NW", "N", "NE"],
  ["W", "CENTER", "E"],
  ["SW", "S", "SE"],
];

export function computeZoneGrid(floor: Floor): ZoneGrid {
  const bounds = floorBounds(floor.walls, floor.rooms);
  const cellW = bounds.width > 0 ? bounds.width / 3 : 1000;
  const cellH = bounds.height > 0 ? bounds.height / 3 : 1000;

  const cells: ZoneCell[][] = [];
  for (let row = 0; row < 3; row++) {
    cells[row] = [];
    for (let col = 0; col < 3; col++) {
      // Row 0 = top = North, so y goes from max down
      const minX = bounds.min.x + col * cellW;
      const maxX = minX + cellW;
      // Y-up coordinate: row 0 is North (top), so row 0 has highest Y
      const maxY = bounds.max.y - row * cellH;
      const minY = maxY - cellH;

      cells[row][col] = {
        direction: GRID_DIRECTIONS[row][col],
        bounds: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
        rooms_in_zone: [],
      };
    }
  }

  // Map rooms to zones
  for (const room of floor.rooms) {
    const centroid = polygonCentroid(room.boundary.points);
    const dir = getDirectionForPoint(centroid, bounds, cellW, cellH);
    const { row, col } = directionToGridIndex(dir);
    cells[row][col].rooms_in_zone.push(room.id);
  }

  return { bounds, cell_width: cellW, cell_height: cellH, cells };
}

/** Get the Vastu direction for a point within the floor bounding box */
export function getDirectionForPoint(
  point: Point,
  bounds: { min: Point; max: Point; width: number; height: number },
  cellW: number,
  cellH: number
): VastuDirection {
  const relX = point.x - bounds.min.x;
  const relY = point.y - bounds.min.y; // Y-up: 0 = bottom (south)

  let col = Math.floor(relX / cellW);
  let row = Math.floor(relY / cellH);

  // Clamp
  col = Math.max(0, Math.min(2, col));
  row = Math.max(0, Math.min(2, row));

  // Convert from Y-up row (0=south) to grid row (0=north)
  const gridRow = 2 - row;

  return GRID_DIRECTIONS[gridRow][col];
}

/** Get the Vastu direction for a room based on its centroid */
export function getRoomDirection(
  room: Room,
  floor: Floor
): VastuDirection {
  // If direction is already set on the room, use it
  if (room.vastu_direction) return room.vastu_direction;

  const bounds = floorBounds(floor.walls, floor.rooms);
  const cellW = bounds.width > 0 ? bounds.width / 3 : 1000;
  const cellH = bounds.height > 0 ? bounds.height / 3 : 1000;
  if (cellW < 1 || cellH < 1) return "CENTER";
  const centroid = polygonCentroid(room.boundary.points);

  return getDirectionForPoint(centroid, bounds, cellW, cellH);
}

function directionToGridIndex(dir: VastuDirection): { row: number; col: number } {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (GRID_DIRECTIONS[r][c] === dir) return { row: r, col: c };
    }
  }
  return { row: 1, col: 1 }; // CENTER fallback
}

// ============================================================
// MAIN ANALYZER
// ============================================================

export function analyzeVastuCompliance(
  floor: Floor,
  northAngleDeg: number = 0
): VastuReport {
  const items: VastuReportItem[] = [];
  const grid = computeZoneGrid(floor);
  let totalPenalty = 0;
  let maxPossiblePenalty = 0;

  // ---- Room placement rules ----
  for (const rule of ALL_VASTU_RULES) {
    if (rule.category === "room_placement") {
      const matchingRooms = floor.rooms.filter(
        (r) => rule.room_types.includes(r.type)
      );

      if (matchingRooms.length === 0) continue; // Rule doesn't apply

      for (const room of matchingRooms) {
        const dir = getRoomDirection(room, floor);
        const item = evaluateRoomRule(rule, room, dir);
        items.push(item);
        totalPenalty += item.penalty_applied;
        maxPossiblePenalty += rule.penalty_points;
      }
    }
  }

  // ---- Entrance rules ----
  const mainEntrance = floor.doors.find(
    (d) => d.type === "main_entrance" || d.type === "service_entrance"
  );
  if (mainEntrance) {
    const entranceWall = floor.walls.find((w) => w.id === mainEntrance.wall_id);
    if (entranceWall) {
      const entranceDir = getEntranceDirection(entranceWall, floor);
      for (const rule of ALL_VASTU_RULES.filter((r) => r.category === "entrance")) {
        const item = evaluateEntranceRule(rule, entranceDir, mainEntrance.id);
        items.push(item);
        totalPenalty += item.penalty_applied;
        maxPossiblePenalty += rule.penalty_points;
      }
    }
  }

  // ---- General/Element rules (Brahmasthan check) ----
  const brahmasthanRule = ALL_VASTU_RULES.find((r) => r.id === "V-EL-003");
  if (brahmasthanRule) {
    const centerRooms = floor.rooms.filter((r) => {
      const dir = getRoomDirection(r, floor);
      return dir === "CENTER";
    });
    const heavyInCenter = centerRooms.some((r) =>
      ["bathroom", "toilet", "wc", "staircase", "store_room", "kitchen"].includes(r.type)
    );
    maxPossiblePenalty += brahmasthanRule.penalty_points;
    if (heavyInCenter) {
      items.push({
        rule_id: brahmasthanRule.id,
        rule: brahmasthanRule,
        room_id: centerRooms[0]?.id ?? null,
        room_name: centerRooms[0]?.name ?? null,
        actual_direction: "CENTER",
        status: "violation",
        severity: brahmasthanRule.severity,
        message: `Heavy/negative room "${centerRooms.find((r) => ["bathroom", "toilet", "wc", "staircase", "store_room", "kitchen"].includes(r.type))?.name}" found in the Brahmasthan (center).`,
        remedy: brahmasthanRule.remedy,
        penalty_applied: brahmasthanRule.penalty_points,
      });
      totalPenalty += brahmasthanRule.penalty_points;
    } else {
      items.push({
        rule_id: brahmasthanRule.id,
        rule: brahmasthanRule,
        room_id: null,
        room_name: null,
        actual_direction: "CENTER",
        status: centerRooms.length === 0 ? "pass" : "acceptable",
        severity: "info",
        message: centerRooms.length === 0
          ? "Brahmasthan (center) is free of heavy structures."
          : `Center has rooms but no heavy/negative elements.`,
        remedy: "",
        penalty_applied: 0,
      });
    }
  }

  // ---- Compute score ----
  const score = maxPossiblePenalty > 0
    ? Math.max(0, Math.round(100 - (totalPenalty / maxPossiblePenalty) * 100))
    : 100;

  const grade = scoreToGrade(score);
  const passes = items.filter((i) => i.status === "pass").length;
  const acceptable = items.filter((i) => i.status === "acceptable").length;
  const violations = items.filter((i) => i.status === "violation").length;

  // ---- Generate suggestions ----
  const suggestions: string[] = [];
  const criticalViolations = items.filter(
    (i) => i.status === "violation" && i.severity === "critical"
  );
  for (const v of criticalViolations) {
    suggestions.push(`${v.rule.title}: ${v.remedy}`);
  }
  if (violations > 0 && criticalViolations.length === 0) {
    suggestions.push("Consider swapping room positions to improve Vastu compliance.");
  }
  if (score >= 80) {
    suggestions.push("Overall layout has good Vastu alignment. Minor adjustments can further improve.");
  }

  return {
    score,
    grade,
    total_rules_checked: items.length,
    passes,
    acceptable,
    violations,
    items,
    suggestions,
    zone_grid: grid,
  };
}

// ============================================================
// HELPERS
// ============================================================

function evaluateRoomRule(
  rule: VastuRule,
  room: Room,
  direction: VastuDirection
): VastuReportItem {
  const dirLabel = DIRECTION_LABELS[direction];

  if (rule.preferred_directions.includes(direction)) {
    return {
      rule_id: rule.id,
      rule,
      room_id: room.id,
      room_name: room.name,
      actual_direction: direction,
      status: "pass",
      severity: "info",
      message: `${room.name} is in ${dirLabel} — ideal placement per Vastu.`,
      remedy: "",
      penalty_applied: 0,
    };
  }

  if (rule.acceptable_directions.includes(direction)) {
    return {
      rule_id: rule.id,
      rule,
      room_id: room.id,
      room_name: room.name,
      actual_direction: direction,
      status: "acceptable",
      severity: "info",
      message: `${room.name} is in ${dirLabel} — acceptable but not ideal. Preferred: ${rule.preferred_directions.map((d) => DIRECTION_LABELS[d]).join(", ")}.`,
      remedy: rule.remedy,
      penalty_applied: Math.round(rule.penalty_points * 0.3),
    };
  }

  if (rule.avoid_directions.includes(direction)) {
    return {
      rule_id: rule.id,
      rule,
      room_id: room.id,
      room_name: room.name,
      actual_direction: direction,
      status: "violation",
      severity: rule.severity,
      message: `${room.name} is in ${dirLabel} — strongly discouraged. Should be in ${rule.preferred_directions.map((d) => DIRECTION_LABELS[d]).join(" or ")}.`,
      remedy: rule.remedy,
      penalty_applied: rule.penalty_points,
    };
  }

  // Neutral direction (not in any list)
  return {
    rule_id: rule.id,
    rule,
    room_id: room.id,
    room_name: room.name,
    actual_direction: direction,
    status: "acceptable",
    severity: "info",
    message: `${room.name} is in ${dirLabel} — neutral placement.`,
    remedy: rule.remedy,
    penalty_applied: Math.round(rule.penalty_points * 0.2),
  };
}

function evaluateEntranceRule(
  rule: VastuRule,
  direction: VastuDirection,
  doorId: string
): VastuReportItem {
  const dirLabel = DIRECTION_LABELS[direction];

  if (rule.preferred_directions.includes(direction)) {
    return {
      rule_id: rule.id,
      rule,
      room_id: doorId,
      room_name: "Main Entrance",
      actual_direction: direction,
      status: "pass",
      severity: "info",
      message: `Main entrance faces ${dirLabel} — excellent per Vastu.`,
      remedy: "",
      penalty_applied: 0,
    };
  }

  if (rule.avoid_directions.includes(direction)) {
    return {
      rule_id: rule.id,
      rule,
      room_id: doorId,
      room_name: "Main Entrance",
      actual_direction: direction,
      status: "violation",
      severity: rule.severity,
      message: `Main entrance faces ${dirLabel} — inauspicious. Preferred: ${rule.preferred_directions.map((d) => DIRECTION_LABELS[d]).join(", ")}.`,
      remedy: rule.remedy,
      penalty_applied: rule.penalty_points,
    };
  }

  return {
    rule_id: rule.id,
    rule,
    room_id: doorId,
    room_name: "Main Entrance",
    actual_direction: direction,
    status: "acceptable",
    severity: "minor",
    message: `Main entrance faces ${dirLabel} — acceptable.`,
    remedy: rule.remedy,
    penalty_applied: Math.round(rule.penalty_points * 0.3),
  };
}

function getEntranceDirection(wall: Wall, floor: Floor): VastuDirection {
  const bounds = floorBounds(floor.walls, floor.rooms);

  // Determine which exterior wall the entrance is on
  const mx = (wall.centerline.start.x + wall.centerline.end.x) / 2;
  const my = (wall.centerline.start.y + wall.centerline.end.y) / 2;
  const isHorizontal = Math.abs(wall.centerline.start.y - wall.centerline.end.y) <
    Math.abs(wall.centerline.start.x - wall.centerline.end.x);

  if (isHorizontal) {
    // South wall (y ≈ min) or North wall (y ≈ max)
    if (my < bounds.center.y) return "S";
    return "N";
  } else {
    // West wall (x ≈ min) or East wall (x ≈ max)
    if (mx < bounds.center.x) return "W";
    return "E";
  }
}

function scoreToGrade(score: number): VastuGrade {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}
