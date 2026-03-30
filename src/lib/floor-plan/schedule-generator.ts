/**
 * Schedule Generator
 *
 * Generates AEC-standard schedules from a FloorPlanProject:
 *  1. Area Schedule   — room-by-room areas with numbering
 *  2. Door Schedule   — all doors with sizes, types, materials
 *  3. Window Schedule — all windows with sizes, types, sill heights
 *
 * All internal measurements are in mm (matching the CAD data model).
 * Output values are converted to human-readable units (m, sqm, sqft, mm).
 */

import type {
  FloorPlanProject,
  Floor,
  DoorType,
  CadWindow,
} from "@/types/floor-plan-cad";
import { polygonBounds } from "./geometry";

// ============================================================
// AREA SCHEDULE
// ============================================================

export interface AreaScheduleRow {
  room_number: number;
  floor_name: string;
  room_name: string;
  room_type: string;
  width_m: number;
  length_m: number;
  area_sqm: number;
  area_sqft: number;
  carpet_area_sqm: number;
  vastu_direction?: string;
}

const SQM_TO_SQFT = 10.764;
const CARPET_FACTOR = 0.85;

export function generateAreaSchedule(
  project: FloorPlanProject,
): AreaScheduleRow[] {
  const rows: AreaScheduleRow[] = [];
  let roomNumber = 1;

  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const bounds = polygonBounds(room.boundary.points);
      const width_m = parseFloat((bounds.width / 1000).toFixed(2));
      const length_m = parseFloat((bounds.height / 1000).toFixed(2));
      const area_sqm = parseFloat(room.area_sqm.toFixed(2));
      const area_sqft = parseFloat((area_sqm * SQM_TO_SQFT).toFixed(2));
      const carpet_area_sqm = parseFloat(
        (area_sqm * CARPET_FACTOR).toFixed(2),
      );

      rows.push({
        room_number: roomNumber++,
        floor_name: floor.name,
        room_name: room.name,
        room_type: room.type,
        width_m,
        length_m,
        area_sqm,
        area_sqft,
        carpet_area_sqm,
        vastu_direction: room.vastu_direction ?? undefined,
      });
    }
  }

  return rows;
}

// ============================================================
// DOOR SCHEDULE
// ============================================================

export interface DoorScheduleRow {
  door_number: number;
  floor_name: string;
  door_type: string;
  width_mm: number;
  height_mm: number;
  swing_direction: string;
  connects: string; // "Room A -> Room B"
  material: string;
}

const DOOR_MATERIAL_DEFAULTS: Record<string, string> = {
  main_entrance: "Teak wood",
  service_entrance: "Steel",
  fire_rated: "Steel (fire-rated)",
  sliding: "Aluminium frame, glass",
  pocket: "Flush (plywood)",
  bi_fold: "Flush (plywood)",
  french: "Hardwood frame, glass",
  revolving: "Aluminium frame, glass",
  barn: "Reclaimed wood",
  garage: "Steel (sectional)",
};
const DEFAULT_DOOR_MATERIAL = "Flush (plywood)";

function doorMaterial(type: DoorType): string {
  return DOOR_MATERIAL_DEFAULTS[type] ?? DEFAULT_DOOR_MATERIAL;
}

function buildRoomLookup(floor: Floor): Map<string, string> {
  const map = new Map<string, string>();
  for (const room of floor.rooms) {
    map.set(room.id, room.name);
  }
  return map;
}

export function generateDoorSchedule(
  project: FloorPlanProject,
): DoorScheduleRow[] {
  const rows: DoorScheduleRow[] = [];
  let doorNumber = 1;

  for (const floor of project.floors) {
    const roomLookup = buildRoomLookup(floor);

    for (const door of floor.doors) {
      const [roomA_id, roomB_id] = door.connects_rooms;
      const roomA = roomLookup.get(roomA_id) ?? "Exterior";
      const roomB = roomLookup.get(roomB_id) ?? "Exterior";

      rows.push({
        door_number: doorNumber++,
        floor_name: floor.name,
        door_type: formatLabel(door.type),
        width_mm: door.width_mm,
        height_mm: door.height_mm,
        swing_direction: `${formatLabel(door.swing_direction)} (${formatLabel(door.opens_to)})`,
        connects: `${roomA} \u2192 ${roomB}`,
        material: doorMaterial(door.type),
      });
    }
  }

  return rows;
}

// ============================================================
// WINDOW SCHEDULE
// ============================================================

export interface WindowScheduleRow {
  window_number: number;
  floor_name: string;
  window_type: string;
  width_mm: number;
  height_mm: number;
  sill_height_mm: number;
  glazing: string;
  operable: boolean;
  room_name: string;
}

/**
 * Determine which room a window belongs to by matching its wall_id
 * against each room's wall_ids list.
 */
function findRoomForWindow(floor: Floor, window: CadWindow): string {
  for (const room of floor.rooms) {
    if (room.wall_ids.includes(window.wall_id)) {
      return room.name;
    }
  }

  // Fallback: check wall left/right room references
  const wall = floor.walls.find((w) => w.id === window.wall_id);
  if (wall) {
    const roomId = wall.left_room_id ?? wall.right_room_id;
    if (roomId) {
      const room = floor.rooms.find((r) => r.id === roomId);
      if (room) return room.name;
    }
  }

  return "Unassigned";
}

export function generateWindowSchedule(
  project: FloorPlanProject,
): WindowScheduleRow[] {
  const rows: WindowScheduleRow[] = [];
  let windowNumber = 1;

  for (const floor of project.floors) {
    for (const window of floor.windows) {
      rows.push({
        window_number: windowNumber++,
        floor_name: floor.name,
        window_type: formatLabel(window.type),
        width_mm: window.width_mm,
        height_mm: window.height_mm,
        sill_height_mm: window.sill_height_mm,
        glazing: formatLabel(window.glazing),
        operable: window.operable,
        room_name: findRoomForWindow(floor, window),
      });
    }
  }

  return rows;
}

// ============================================================
// CSV EXPORT HELPERS
// ============================================================

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines */
function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    const values = headers.map((h) => csvEscape(row[h]));
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

export function areaScheduleToCSV(rows: AreaScheduleRow[]): string {
  const headers: (keyof AreaScheduleRow)[] = [
    "room_number",
    "floor_name",
    "room_name",
    "room_type",
    "width_m",
    "length_m",
    "area_sqm",
    "area_sqft",
    "carpet_area_sqm",
    "vastu_direction",
  ];
  return toCsv(headers, rows as unknown as Record<string, unknown>[]);
}

export function doorScheduleToCSV(rows: DoorScheduleRow[]): string {
  const headers: (keyof DoorScheduleRow)[] = [
    "door_number",
    "floor_name",
    "door_type",
    "width_mm",
    "height_mm",
    "swing_direction",
    "connects",
    "material",
  ];
  return toCsv(headers, rows as unknown as Record<string, unknown>[]);
}

export function windowScheduleToCSV(rows: WindowScheduleRow[]): string {
  const headers: (keyof WindowScheduleRow)[] = [
    "window_number",
    "floor_name",
    "window_type",
    "width_mm",
    "height_mm",
    "sill_height_mm",
    "glazing",
    "operable",
    "room_name",
  ];
  return toCsv(headers, rows as unknown as Record<string, unknown>[]);
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/** Convert snake_case type strings to human-readable labels: "main_entrance" -> "Main Entrance" */
function formatLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
