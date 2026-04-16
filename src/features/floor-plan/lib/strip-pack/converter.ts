/**
 * Convert StripPackResult (feet, Y-UP, plot origin SW) to FloorPlanProject
 * (millimeters, Y-UP, same origin convention used by the renderer).
 *
 * Renderer contract notes (verified against pipeline-b-orchestrator.fineProject):
 *   - Point.{x,y} are millimeters.
 *   - Y-UP: high y = north on screen. We are already Y-UP throughout the
 *     strip-pack engine — no Y flip needed here.
 *   - Wall.centerline is the geometric midline of the wall.
 *   - Door.symbol must include hinge_point, arc, leaf_end_point even if the
 *     viewer doesn't render them (other consumers do).
 *   - CadWindow.symbol.glass_lines describes the glass panes (2 lines for
 *     double glazing).
 */
import type {
  CadWindow,
  Door,
  DoorSymbol,
  Floor,
  FloorPlanProject,
  Polygon,
  Room,
  RoomType,
  Wall,
  WindowSymbol,
} from "@/types/floor-plan-cad";
import type { ParsedConstraints } from "../structured-parser";
import type {
  DoorPlacement,
  Rect,
  StripPackResult,
  StripPackRoom,
  WallSegment,
  WindowPlacement,
} from "./types";
import {
  FT_TO_MM,
  SQM_PER_SQFT,
} from "./types";

const HALLWAY_ID = "_HALLWAY_";

/** Mirrors pipeline-b-orchestrator.functionToRoomType so the renderer + room
 *  colors stay consistent across pipelines. */
function functionToRoomType(fn: string): RoomType {
  const map: Record<string, RoomType> = {
    bedroom: "bedroom",
    master_bedroom: "master_bedroom",
    guest_bedroom: "guest_bedroom",
    kids_bedroom: "bedroom",
    living: "living_room",
    dining: "dining_room",
    drawing_room: "living_room",
    kitchen: "kitchen",
    bathroom: "bathroom",
    master_bathroom: "bathroom",
    ensuite: "bathroom",
    powder_room: "toilet",
    toilet: "toilet",
    walk_in_wardrobe: "walk_in_closet",
    walk_in_closet: "walk_in_closet",
    foyer: "foyer",
    porch: "verandah",
    verandah: "verandah",
    balcony: "balcony",
    corridor: "corridor",
    hallway: "corridor",
    passage: "corridor",
    staircase: "staircase",
    utility: "utility",
    store: "store_room",
    laundry: "utility",
    pantry: "store_room",
    pooja: "puja_room",
    prayer: "puja_room",
    mandir: "puja_room",
    study: "study",
    servant_quarter: "servant_quarter",
    other: "custom",
  };
  return map[fn] ?? "custom";
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export function toFloorPlanProject(
  result: StripPackResult,
  parsed: ParsedConstraints,
  projectName?: string,
): FloorPlanProject {
  const name = projectName
    ?? (parsed.plot.facing ? `${parsed.plot.facing}-facing plan (T1 strip-pack)` : "Floor plan (T1 strip-pack)");

  const rooms = buildRooms(result);
  const walls = buildWallObjects(result.walls, rooms);
  const doors = buildDoors(result.doors, walls, rooms);
  const windows = buildWindows(result.windows, walls);

  // Wire wall.openings[] for doors + windows.
  attachOpeningsToWalls(walls, doors, windows);

  const floorBoundary: Polygon = rectToPolygon({
    x: 0, y: 0, width: result.plot.width, depth: result.plot.depth,
  });

  const totalAreaSqm = rooms.reduce((s, r) => s + r.area_sqm, 0);

  const floor: Floor = {
    id: "floor-0",
    name: "Ground Floor",
    level: 0,
    floor_to_floor_height_mm: 3000,
    slab_thickness_mm: 150,
    boundary: floorBoundary,
    walls,
    rooms,
    doors,
    windows,
    stairs: [],
    columns: [],
    furniture: [],
    fixtures: [],
    annotations: [],
    dimensions: [],
    zones: [],
  };

  return {
    id: `t1-${Date.now()}`,
    name,
    version: "1.0.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential",
      building_type: "house",
      built_up_area_sqm: totalAreaSqm,
      carpet_area_sqm: totalAreaSqm * 0.85,
      num_floors: 1,
      generation_model: "strip-pack-T1",
      generation_timestamp: new Date().toISOString(),
    },
    settings: {
      units: "metric",
      display_unit: "ft",
      scale: "1:100",
      grid_size_mm: 152,
      wall_thickness_mm: 150,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: parsed.vastu_required,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: false,
    },
    floors: [floor],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ROOMS
// ───────────────────────────────────────────────────────────────────────────

function buildRooms(result: StripPackResult): Room[] {
  const out: Room[] = [];
  // Hallway as a Room (renderer expects circulation rooms in the schedule).
  const spineRect = result.spine.spine;
  out.push({
    id: HALLWAY_ID,
    name: "Hallway",
    type: "corridor",
    boundary: rectToPolygon(spineRect),
    area_sqm: spineRect.width * spineRect.depth * SQM_PER_SQFT,
    perimeter_mm: 2 * (spineRect.width + spineRect.depth) * FT_TO_MM,
    natural_light_required: false,
    ventilation_required: false,
    label_position: {
      x: (spineRect.x + spineRect.width / 2) * FT_TO_MM,
      y: (spineRect.y + spineRect.depth / 2) * FT_TO_MM,
    },
    wall_ids: [],
  });

  for (const r of result.rooms) {
    if (!r.placed) continue;
    const p = r.placed;
    out.push({
      id: r.id,
      name: r.name,
      type: functionToRoomType(r.type),
      boundary: rectToPolygon(p),
      area_sqm: p.width * p.depth * SQM_PER_SQFT,
      perimeter_mm: 2 * (p.width + p.depth) * FT_TO_MM,
      natural_light_required: !["bathroom", "master_bathroom", "powder_room", "toilet", "store", "utility", "pantry"].includes(r.type),
      ventilation_required: true,
      label_position: {
        x: (p.x + p.width / 2) * FT_TO_MM,
        y: (p.y + p.depth / 2) * FT_TO_MM,
      },
      wall_ids: r.wall_ids ?? [],
    });
  }
  return out;
}

function rectToPolygon(rect: Rect): Polygon {
  const x = rect.x * FT_TO_MM;
  const y = rect.y * FT_TO_MM;
  const w = rect.width * FT_TO_MM;
  const d = rect.depth * FT_TO_MM;
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + d },
      { x, y: y + d },
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// WALLS
// ───────────────────────────────────────────────────────────────────────────

function buildWallObjects(segments: WallSegment[], rooms: Room[]): Wall[] {
  const roomIdSet = new Set(rooms.map(r => r.id));
  return segments.map((seg): Wall => {
    const owners = seg.room_ids.filter(id => roomIdSet.has(id));
    const start = { x: seg.start.x * FT_TO_MM, y: seg.start.y * FT_TO_MM };
    const end   = { x: seg.end.x   * FT_TO_MM, y: seg.end.y   * FT_TO_MM };
    return {
      id: seg.id,
      type: seg.type === "external" ? "exterior" : "interior",
      material: seg.type === "external" ? "brick" : "block",
      centerline: { start, end },
      thickness_mm: seg.thickness_ft * FT_TO_MM,
      height_mm: 3000,
      left_room_id: owners[0],
      right_room_id: owners[1],
      openings: [], // populated by attachOpeningsToWalls
      line_weight: seg.type === "external" ? "thick" : "medium",
      is_load_bearing: seg.type === "external",
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// DOORS
// ───────────────────────────────────────────────────────────────────────────

function buildDoors(placements: DoorPlacement[], walls: Wall[], rooms: Room[]): Door[] {
  const wallById = new Map(walls.map(w => [w.id, w]));
  const roomIdByName = new Map(rooms.map(r => [r.name, r.id]));
  const out: Door[] = [];
  let idx = 0;
  for (const p of placements) {
    if (!p.wall_id) continue;
    const wall = wallById.get(p.wall_id);
    if (!wall) continue;

    const widthMm = p.width_ft * FT_TO_MM;
    const startMm = { x: p.start.x * FT_TO_MM, y: p.start.y * FT_TO_MM };
    const endMm   = { x: p.end.x   * FT_TO_MM, y: p.end.y   * FT_TO_MM };
    const wallStart = wall.centerline.start;
    const wallEnd   = wall.centerline.end;
    const wallVec = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y };
    const wallLen = Math.hypot(wallVec.x, wallVec.y);
    const doorMid = { x: (startMm.x + endMm.x) / 2, y: (startMm.y + endMm.y) / 2 };
    const fromStart = { x: doorMid.x - wallStart.x, y: doorMid.y - wallStart.y };
    const positionAlong = wallLen > 0
      ? (fromStart.x * wallVec.x + fromStart.y * wallVec.y) / wallLen
      : 0;

    // Symbol — hinge_point at one door end, leaf perpendicular to wall.
    const hinge = startMm;
    const leafDir = p.orientation === "horizontal"
      ? { x: 0, y: widthMm } // horizontal wall → leaf swings in +y
      : { x: widthMm, y: 0 }; // vertical wall   → leaf swings in +x
    const leafEnd = { x: hinge.x + leafDir.x, y: hinge.y + leafDir.y };
    const symbol: DoorSymbol = {
      hinge_point: hinge,
      arc_radius_mm: widthMm,
      arc_start_angle_deg: 0,
      arc_end_angle_deg: 90,
      leaf_end_point: leafEnd,
    };

    const aId = roomIdByName.get(p.between[0])
      ?? (p.between[0] === "hallway" ? HALLWAY_ID : "");
    const bId = roomIdByName.get(p.between[1])
      ?? (p.between[1] === "hallway" ? HALLWAY_ID : p.between[1] === "exterior" ? "" : "");

    out.push({
      id: `d${idx++}`,
      type: p.is_main_entrance ? "main_entrance" : "single_swing",
      wall_id: wall.id,
      width_mm: widthMm,
      height_mm: 2100,
      thickness_mm: 40,
      position_along_wall_mm: Math.max(0, positionAlong - widthMm / 2),
      swing_direction: "right",
      swing_angle_deg: 90,
      opens_to: "inside",
      symbol,
      connects_rooms: [aId, bId],
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// WINDOWS
// ───────────────────────────────────────────────────────────────────────────

function buildWindows(placements: WindowPlacement[], walls: Wall[]): CadWindow[] {
  const wallById = new Map(walls.map(w => [w.id, w]));
  const out: CadWindow[] = [];
  let idx = 0;
  for (const p of placements) {
    if (!p.wall_id) continue;
    const wall = wallById.get(p.wall_id);
    if (!wall) continue;

    const widthMm = p.width_ft * FT_TO_MM;
    const startMm = { x: p.start.x * FT_TO_MM, y: p.start.y * FT_TO_MM };
    const endMm   = { x: p.end.x   * FT_TO_MM, y: p.end.y   * FT_TO_MM };

    const wallStart = wall.centerline.start;
    const wallEnd   = wall.centerline.end;
    const wallVec = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y };
    const wallLen = Math.hypot(wallVec.x, wallVec.y);
    const winMid = { x: (startMm.x + endMm.x) / 2, y: (startMm.y + endMm.y) / 2 };
    const fromStart = { x: winMid.x - wallStart.x, y: winMid.y - wallStart.y };
    const positionAlong = wallLen > 0
      ? (fromStart.x * wallVec.x + fromStart.y * wallVec.y) / wallLen
      : 0;

    // 2 parallel glass lines slightly offset perpendicular to the wall
    const offset = 50; // 50mm offset
    const perp = wallLen > 0
      ? { x: -wallVec.y / wallLen * offset, y: wallVec.x / wallLen * offset }
      : { x: 0, y: 0 };
    const symbol: WindowSymbol = {
      start_point: startMm,
      end_point: endMm,
      glass_lines: [
        { start: { x: startMm.x + perp.x, y: startMm.y + perp.y }, end: { x: endMm.x + perp.x, y: endMm.y + perp.y } },
        { start: { x: startMm.x - perp.x, y: startMm.y - perp.y }, end: { x: endMm.x - perp.x, y: endMm.y - perp.y } },
      ],
    };

    out.push({
      id: `w${idx++}`,
      type: p.kind === "large" ? "casement" : p.kind === "ventilation" ? "awning" : "fixed",
      wall_id: wall.id,
      width_mm: widthMm,
      height_mm: p.kind === "large" ? 1500 : p.kind === "ventilation" ? 600 : 1200,
      sill_height_mm: p.sill_height_ft * FT_TO_MM,
      position_along_wall_mm: Math.max(0, positionAlong - widthMm / 2),
      symbol,
      glazing: "double",
      operable: p.kind !== "ventilation",
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// WALL ↔ OPENING WIRING
// ───────────────────────────────────────────────────────────────────────────

function attachOpeningsToWalls(walls: Wall[], doors: Door[], windows: CadWindow[]): void {
  const wallById = new Map(walls.map(w => [w.id, w]));
  let openIdx = 0;
  for (const d of doors) {
    const wall = wallById.get(d.wall_id);
    if (!wall) continue;
    wall.openings.push({
      id: `op${openIdx++}`,
      type: "door",
      ref_id: d.id,
      offset_from_start_mm: d.position_along_wall_mm,
      width_mm: d.width_mm,
      sill_height_mm: 0,
      head_height_mm: d.height_mm,
    });
  }
  for (const w of windows) {
    const wall = wallById.get(w.wall_id);
    if (!wall) continue;
    wall.openings.push({
      id: `op${openIdx++}`,
      type: "window",
      ref_id: w.id,
      offset_from_start_mm: w.position_along_wall_mm,
      width_mm: w.width_mm,
      sill_height_mm: w.sill_height_mm,
      head_height_mm: w.sill_height_mm + w.height_mm,
    });
  }
}
