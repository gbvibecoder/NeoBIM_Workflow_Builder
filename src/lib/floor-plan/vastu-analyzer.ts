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
  status: "pass" | "acceptable" | "violation" | "advisory";
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
  advisories: number;
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

/**
 * Get room direction with rotation applied for non-zero north angle.
 * Rotates the room centroid by -angleRad around (midX, midY) before zone lookup.
 */
function getRoomDirectionWithRotation(
  room: Room,
  floor: Floor,
  angleRad: number,
  midX: number,
  midY: number,
): VastuDirection {
  if (room.vastu_direction) return room.vastu_direction;

  const bounds = floorBounds(floor.walls, floor.rooms);
  const cellW = bounds.width > 0 ? bounds.width / 3 : 1000;
  const cellH = bounds.height > 0 ? bounds.height / 3 : 1000;
  if (cellW < 1 || cellH < 1) return "CENTER";

  const centroid = polygonCentroid(room.boundary.points);

  // Apply rotation when building is not aligned to cardinal directions
  if (Math.abs(angleRad) > 0.001) {
    const cosA = Math.cos(-angleRad);
    const sinA = Math.sin(-angleRad);
    const dx = centroid.x - midX;
    const dy = centroid.y - midY;
    const rotatedPoint: Point = {
      x: cosA * dx - sinA * dy + midX,
      y: sinA * dx + cosA * dy + midY,
    };
    return getDirectionForPoint(rotatedPoint, bounds, cellW, cellH);
  }

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

  // Pre-compute rotation parameters for non-zero north angle.
  // When the building is rotated, we rotate room centroids by -northAngleDeg
  // around the building center before determining their Vastu zone.
  const angleRad = (northAngleDeg * Math.PI) / 180;
  const bounds = floorBounds(floor.walls, floor.rooms);
  const midX = (bounds.min.x + bounds.max.x) / 2;
  const midY = (bounds.min.y + bounds.max.y) / 2;

  // ---- Room placement rules ----
  // For each room, find the MOST SPECIFIC matching rule to avoid conflicting evaluations.
  // E.g., "master_bedroom" should use V-RP-001 (preferred: SW), not V-RP-007 (bedroom, preferred: W/NW).
  const roomPlacementRules = ALL_VASTU_RULES.filter(r => r.category === "room_placement");
  const evaluatedRoomIds = new Set<string>();

  for (const room of floor.rooms) {
    // Find all rules that match this room's type
    const matchingRules = roomPlacementRules.filter(rule =>
      rule.room_types.includes(room.type)
    );
    if (matchingRules.length === 0) continue;

    // Pick the most specific rule using a priority system:
    // Higher penalty_points → more important rule takes precedence.
    // Among equal penalties, prefer rules with fewer room_types (more specific).
    // This avoids the fragile "string length = specificity" heuristic.
    const bestRule = matchingRules.sort((a, b) => {
      // 1. Higher penalty = more important rule
      if (a.penalty_points !== b.penalty_points) return b.penalty_points - a.penalty_points;
      // 2. Fewer room_types = more specific rule
      return a.room_types.length - b.room_types.length;
    })[0];

    const dir = getRoomDirectionWithRotation(room, floor, angleRad, midX, midY);
    const item = evaluateRoomRule(bestRule, room, dir);
    items.push(item);
    totalPenalty += item.penalty_applied;
    maxPossiblePenalty += bestRule.penalty_points;
    evaluatedRoomIds.add(room.id);
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
      const dir = getRoomDirectionWithRotation(r, floor, angleRad, midX, midY);
      return dir === "CENTER";
    });
    const heavyInCenter = centerRooms.some((r) =>
      ["bathroom", "toilet", "wc", "staircase", "store_room", "kitchen", "utility", "laundry", "servant_quarter"].includes(r.type)
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

  // ---- Element rules (V-EL-001, V-EL-002) ----
  const elementWaterRule = ALL_VASTU_RULES.find((r) => r.id === "V-EL-001");
  if (elementWaterRule) {
    // Water elements (bathrooms, utility with water) should be in NE
    const waterRooms = floor.rooms.filter((r) =>
      ["bathroom", "toilet", "wc", "utility", "laundry"].includes(r.type)
    );
    if (waterRooms.length > 0) {
      maxPossiblePenalty += elementWaterRule.penalty_points;
      // Check if majority of water rooms are in preferred/acceptable zones
      const waterDirs = waterRooms.map((r) =>
        getRoomDirectionWithRotation(r, floor, angleRad, midX, midY)
      );
      const inPreferred = waterDirs.filter((d) =>
        elementWaterRule.preferred_directions.includes(d)
      ).length;
      const inAvoid = waterDirs.filter((d) =>
        elementWaterRule.avoid_directions.includes(d)
      ).length;

      if (inPreferred >= waterRooms.length / 2) {
        items.push({
          rule_id: elementWaterRule.id, rule: elementWaterRule,
          room_id: null, room_name: "Water rooms",
          actual_direction: waterDirs[0],
          status: "pass", severity: "info",
          message: "Water elements (bathrooms/utility) are concentrated in NE/N — good Vastu placement.",
          remedy: "", penalty_applied: 0,
        });
      } else if (inAvoid > 0) {
        const penalty = elementWaterRule.penalty_points;
        totalPenalty += penalty;
        items.push({
          rule_id: elementWaterRule.id, rule: elementWaterRule,
          room_id: waterRooms.find((r) => elementWaterRule.avoid_directions.includes(
            getRoomDirectionWithRotation(r, floor, angleRad, midX, midY)
          ))?.id ?? null,
          room_name: "Water rooms",
          actual_direction: waterDirs.find((d) => elementWaterRule.avoid_directions.includes(d)) ?? waterDirs[0],
          status: "violation", severity: elementWaterRule.severity,
          message: `Water elements found in ${waterDirs.filter((d) => elementWaterRule.avoid_directions.includes(d)).map((d) => DIRECTION_LABELS[d]).join(", ")} — should be in NE/N.`,
          remedy: elementWaterRule.remedy, penalty_applied: penalty,
        });
      } else {
        items.push({
          rule_id: elementWaterRule.id, rule: elementWaterRule,
          room_id: null, room_name: "Water rooms",
          actual_direction: waterDirs[0],
          status: "acceptable", severity: "info",
          message: "Water elements are in acceptable positions but not ideally in NE/N.",
          remedy: elementWaterRule.remedy, penalty_applied: Math.round(elementWaterRule.penalty_points * 0.15),
        });
        totalPenalty += Math.round(elementWaterRule.penalty_points * 0.15);
      }
    }
  }

  const elementHeavyRule = ALL_VASTU_RULES.find((r) => r.id === "V-EL-002");
  if (elementHeavyRule) {
    // Heavy structures (staircase, store rooms, columns) should be in SW
    const heavyRooms = floor.rooms.filter((r) =>
      ["staircase", "store_room", "garage", "parking", "elevator"].includes(r.type)
    );
    if (heavyRooms.length > 0) {
      maxPossiblePenalty += elementHeavyRule.penalty_points;
      const heavyDirs = heavyRooms.map((r) =>
        getRoomDirectionWithRotation(r, floor, angleRad, midX, midY)
      );
      const inAvoid = heavyDirs.filter((d) =>
        elementHeavyRule.avoid_directions.includes(d)
      ).length;

      if (heavyDirs.some((d) => elementHeavyRule.preferred_directions.includes(d))) {
        items.push({
          rule_id: elementHeavyRule.id, rule: elementHeavyRule,
          room_id: null, room_name: "Heavy structures",
          actual_direction: heavyDirs[0],
          status: "pass", severity: "info",
          message: "Heavy structures are placed in SW — correct Vastu placement.",
          remedy: "", penalty_applied: 0,
        });
      } else if (inAvoid > 0) {
        totalPenalty += elementHeavyRule.penalty_points;
        items.push({
          rule_id: elementHeavyRule.id, rule: elementHeavyRule,
          room_id: heavyRooms[0]?.id ?? null, room_name: "Heavy structures",
          actual_direction: heavyDirs.find((d) => elementHeavyRule.avoid_directions.includes(d)) ?? heavyDirs[0],
          status: "violation", severity: elementHeavyRule.severity,
          message: `Heavy structures found in NE/N/E — should be in SW for stability.`,
          remedy: elementHeavyRule.remedy, penalty_applied: elementHeavyRule.penalty_points,
        });
      } else {
        items.push({
          rule_id: elementHeavyRule.id, rule: elementHeavyRule,
          room_id: null, room_name: "Heavy structures",
          actual_direction: heavyDirs[0],
          status: "acceptable", severity: "info",
          message: "Heavy structures are in acceptable positions.",
          remedy: elementHeavyRule.remedy, penalty_applied: 0,
        });
      }
    }
  }

  // ---- Orientation rules (V-OR-001, V-OR-002) ----
  const alignRule = ALL_VASTU_RULES.find((r) => r.id === "V-OR-001");
  if (alignRule) {
    maxPossiblePenalty += alignRule.penalty_points;
    // Building is aligned if north angle is near 0, 90, 180, or 270 (within 10°)
    const normalizedAngle = ((northAngleDeg % 360) + 360) % 360;
    const nearestCardinal = Math.round(normalizedAngle / 90) * 90;
    const deviation = Math.abs(normalizedAngle - nearestCardinal);
    const isAligned = deviation <= 10;

    if (isAligned) {
      items.push({
        rule_id: alignRule.id, rule: alignRule,
        room_id: null, room_name: "Building",
        actual_direction: "N", status: "pass", severity: "info",
        message: "Building is aligned to cardinal directions — ideal per Vastu.",
        remedy: "", penalty_applied: 0,
      });
    } else {
      totalPenalty += alignRule.penalty_points;
      items.push({
        rule_id: alignRule.id, rule: alignRule,
        room_id: null, room_name: "Building",
        actual_direction: "N", status: "violation", severity: alignRule.severity,
        message: `Building is rotated ${deviation.toFixed(0)}° from cardinal alignment.`,
        remedy: alignRule.remedy, penalty_applied: alignRule.penalty_points,
      });
    }
  }

  const neLowestRule = ALL_VASTU_RULES.find((r) => r.id === "V-OR-002");
  if (neLowestRule) {
    maxPossiblePenalty += neLowestRule.penalty_points;
    // NE should have the least built-up mass (smallest total room area in NE zone)
    const neRoomIds = grid.cells[0][2].rooms_in_zone; // row 0, col 2 = NE
    const swRoomIds = grid.cells[2][0].rooms_in_zone; // row 2, col 0 = SW
    const neArea = neRoomIds.reduce((sum, id) => {
      const r = floor.rooms.find((rm) => rm.id === id);
      return sum + (r?.area_sqm ?? 0);
    }, 0);
    const swArea = swRoomIds.reduce((sum, id) => {
      const r = floor.rooms.find((rm) => rm.id === id);
      return sum + (r?.area_sqm ?? 0);
    }, 0);

    if (neArea <= swArea || neRoomIds.length === 0) {
      items.push({
        rule_id: neLowestRule.id, rule: neLowestRule,
        room_id: null, room_name: "NE Zone",
        actual_direction: "NE", status: "pass", severity: "info",
        message: "NE zone has less built-up mass than SW — correct per Vastu.",
        remedy: "", penalty_applied: 0,
      });
    } else {
      totalPenalty += neLowestRule.penalty_points;
      items.push({
        rule_id: neLowestRule.id, rule: neLowestRule,
        room_id: null, room_name: "NE Zone",
        actual_direction: "NE", status: "violation", severity: neLowestRule.severity,
        message: `NE zone (${neArea.toFixed(1)} sqm) has more mass than SW zone (${swArea.toFixed(1)} sqm) — NE should be lightest.`,
        remedy: neLowestRule.remedy, penalty_applied: neLowestRule.penalty_points,
      });
    }
  }

  // ---- General rules (V-GN-001 through V-GN-007) ----
  const gnRules = ALL_VASTU_RULES.filter((r) => r.category === "general" && r.id.startsWith("V-GN"));

  for (const rule of gnRules) {
    switch (rule.id) {
      case "V-GN-001": {
        // Staircase turns clockwise — advisory (cannot determine rotation from 2D plan)
        const stairs = floor.rooms.filter((r) => r.type === "staircase");
        if (stairs.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          items.push({
            rule_id: rule.id, rule,
            room_id: stairs[0].id, room_name: stairs[0].name,
            actual_direction: getRoomDirectionWithRotation(stairs[0], floor, angleRad, midX, midY),
            status: "advisory", severity: "info",
            message: "Verify staircase turns clockwise when ascending — cannot be determined from 2D plan.",
            remedy: rule.remedy, penalty_applied: 0,
          });
        }
        break;
      }
      case "V-GN-002": {
        // Kitchen stove faces East — advisory (depends on furniture placement)
        const kitchens = floor.rooms.filter((r) => r.type === "kitchen");
        if (kitchens.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          // Check if kitchen has any furniture; if stove-type exists, check wall orientation
          const kitchenFurniture = floor.furniture.filter((f) => f.room_id === kitchens[0].id);
          const hasStove = kitchenFurniture.some((f) =>
            f.catalog_id?.includes("stove") || f.catalog_id?.includes("cooktop")
          );
          if (hasStove) {
            items.push({
              rule_id: rule.id, rule,
              room_id: kitchens[0].id, room_name: kitchens[0].name,
              actual_direction: getRoomDirectionWithRotation(kitchens[0], floor, angleRad, midX, midY),
              status: "advisory", severity: "info",
              message: "Kitchen has stove placed — verify the cook faces East while cooking.",
              remedy: rule.remedy, penalty_applied: 0,
            });
          } else {
            items.push({
              rule_id: rule.id, rule,
              room_id: kitchens[0].id, room_name: kitchens[0].name,
              actual_direction: getRoomDirectionWithRotation(kitchens[0], floor, angleRad, midX, midY),
              status: "advisory", severity: "info",
              message: "Place cooking stove on the East or South wall of the kitchen so the cook faces East.",
              remedy: rule.remedy, penalty_applied: 0,
            });
          }
        }
        break;
      }
      case "V-GN-003": {
        // Bed head direction South/East — advisory
        const bedrooms = floor.rooms.filter((r) =>
          ["master_bedroom", "bedroom", "guest_bedroom"].includes(r.type)
        );
        if (bedrooms.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          items.push({
            rule_id: rule.id, rule,
            room_id: bedrooms[0].id, room_name: `${bedrooms.length} bedroom(s)`,
            actual_direction: getRoomDirectionWithRotation(bedrooms[0], floor, angleRad, midX, midY),
            status: "advisory", severity: "info",
            message: "Place beds with headboard against South or East wall. Never sleep with head towards North.",
            remedy: rule.remedy, penalty_applied: 0,
          });
        }
        break;
      }
      case "V-GN-004": {
        // Toilet seat on N-S axis — advisory
        const bathrooms = floor.rooms.filter((r) =>
          ["bathroom", "toilet", "wc"].includes(r.type)
        );
        if (bathrooms.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          items.push({
            rule_id: rule.id, rule,
            room_id: bathrooms[0].id, room_name: `${bathrooms.length} bathroom(s)`,
            actual_direction: getRoomDirectionWithRotation(bathrooms[0], floor, angleRad, midX, midY),
            status: "advisory", severity: "info",
            message: "Orient toilet seats on the North-South axis (facing North or South).",
            remedy: rule.remedy, penalty_applied: 0,
          });
        }
        break;
      }
      case "V-GN-005": {
        // Puja room door — two shutters
        const pujaRooms = floor.rooms.filter((r) => r.type === "puja_room");
        if (pujaRooms.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          // Check if puja room has a double-swing door
          const pujaDoors = floor.doors.filter((d) =>
            d.connects_rooms.includes(pujaRooms[0].id)
          );
          const hasDouble = pujaDoors.some((d) => d.type === "double_swing" || d.type === "french");
          if (hasDouble) {
            items.push({
              rule_id: rule.id, rule,
              room_id: pujaRooms[0].id, room_name: pujaRooms[0].name,
              actual_direction: getRoomDirectionWithRotation(pujaRooms[0], floor, angleRad, midX, midY),
              status: "pass", severity: "info",
              message: "Puja room has double-leaf door — excellent per Vastu.",
              remedy: "", penalty_applied: 0,
            });
          } else {
            totalPenalty += rule.penalty_points;
            items.push({
              rule_id: rule.id, rule,
              room_id: pujaRooms[0].id, room_name: pujaRooms[0].name,
              actual_direction: getRoomDirectionWithRotation(pujaRooms[0], floor, angleRad, midX, midY),
              status: "violation", severity: rule.severity,
              message: "Puja room should have a double-leaf (two-shutter) door opening inward.",
              remedy: rule.remedy, penalty_applied: rule.penalty_points,
            });
          }
        }
        break;
      }
      case "V-GN-006": {
        // No mirror facing bed — advisory
        const bedrooms = floor.rooms.filter((r) =>
          ["master_bedroom", "bedroom"].includes(r.type)
        );
        if (bedrooms.length > 0) {
          maxPossiblePenalty += rule.penalty_points;
          // Check if bedroom has dresser furniture (implies mirror)
          const hasDresser = bedrooms.some((br) =>
            floor.furniture.some((f) => f.room_id === br.id &&
              (f.catalog_id?.includes("dresser") || f.catalog_id?.includes("vanity"))
            )
          );
          items.push({
            rule_id: rule.id, rule,
            room_id: bedrooms[0].id, room_name: `${bedrooms.length} bedroom(s)`,
            actual_direction: getRoomDirectionWithRotation(bedrooms[0], floor, angleRad, midX, midY),
            status: "advisory", severity: "info",
            message: hasDresser
              ? "Bedroom has dresser/mirror — ensure it does not directly face the bed."
              : "If adding mirrors to bedrooms, place on a wall perpendicular to the bed, not opposite.",
            remedy: rule.remedy, penalty_applied: 0,
          });
        }
        break;
      }
      case "V-GN-007": {
        // Open space in NE — check NE zone occupancy
        maxPossiblePenalty += rule.penalty_points;
        const neCell = grid.cells[0][2]; // row 0, col 2 = NE
        const neCellArea = grid.cell_width * grid.cell_height / 1_000_000; // to sqm
        const neBuiltArea = neCell.rooms_in_zone.reduce((sum, id) => {
          const r = floor.rooms.find((rm) => rm.id === id);
          return sum + (r?.area_sqm ?? 0);
        }, 0);
        const neOccupancy = neCellArea > 0 ? neBuiltArea / neCellArea : 0;

        if (neOccupancy <= 0.5) {
          items.push({
            rule_id: rule.id, rule,
            room_id: null, room_name: "NE Zone",
            actual_direction: "NE", status: "pass", severity: "info",
            message: `NE zone is ${((1 - neOccupancy) * 100).toFixed(0)}% open — good Vastu compliance.`,
            remedy: "", penalty_applied: 0,
          });
        } else if (neOccupancy <= 0.85) {
          const penalty = Math.round(rule.penalty_points * 0.15);
          totalPenalty += penalty;
          items.push({
            rule_id: rule.id, rule,
            room_id: null, room_name: "NE Zone",
            actual_direction: "NE", status: "acceptable", severity: "info",
            message: `NE zone is ${((1 - neOccupancy) * 100).toFixed(0)}% open — acceptable but more open space recommended.`,
            remedy: rule.remedy, penalty_applied: penalty,
          });
        } else {
          totalPenalty += rule.penalty_points;
          items.push({
            rule_id: rule.id, rule,
            room_id: null, room_name: "NE Zone",
            actual_direction: "NE", status: "violation", severity: rule.severity,
            message: `NE zone is ${((1 - neOccupancy) * 100).toFixed(0)}% open — too heavily built up. Keep NE corner lighter.`,
            remedy: rule.remedy, penalty_applied: rule.penalty_points,
          });
        }
        break;
      }
    }
  }

  // ---- Compute score ----
  const score = maxPossiblePenalty > 0
    ? Math.max(0, Math.round(100 - (totalPenalty / maxPossiblePenalty) * 100))
    : 100;

  const grade = scoreToGrade(score);
  const passes = items.filter((i) => i.status === "pass").length;
  const acceptable = items.filter((i) => i.status === "acceptable").length;
  const advisories = items.filter((i) => i.status === "advisory").length;
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
    advisories,
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
      penalty_applied: Math.round(rule.penalty_points * 0.15),
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
    penalty_applied: 0, // Neutral placement: no penalty (room is not in avoid zone)
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

  // Use threshold of 25% from edge to detect corner (intercardinal) directions
  const xThreshold = bounds.width * 0.25;
  const yThreshold = bounds.height * 0.25;
  const isNorth = my > bounds.max.y - yThreshold;
  const isSouth = my < bounds.min.y + yThreshold;
  const isEast = mx > bounds.max.x - xThreshold;
  const isWest = mx < bounds.min.x + xThreshold;

  // Intercardinal directions for corner entrances
  if (isNorth && isEast) return "NE";
  if (isNorth && isWest) return "NW";
  if (isSouth && isEast) return "SE";
  if (isSouth && isWest) return "SW";

  // Cardinal directions
  const isHorizontal = Math.abs(wall.centerline.start.y - wall.centerline.end.y) <
    Math.abs(wall.centerline.start.x - wall.centerline.end.x);

  if (isHorizontal) {
    if (my < bounds.center.y) return "S";
    return "N";
  } else {
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
