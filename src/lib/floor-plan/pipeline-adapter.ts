/**
 * Pipeline Adapter — converts AI pipeline output (FloorPlanGeometry) to
 * FloorPlanProject (professional CAD schema in mm).
 *
 * FloorPlanGeometry uses meters, origin top-left, Y-down.
 * FloorPlanProject uses mm, origin bottom-left, Y-up.
 */

import type { FloorPlanGeometry, FloorPlanRoom, FloorPlanWall } from "@/types/floor-plan";
import type {
  FloorPlanProject,
  Floor,
  Wall,
  Room,
  Door,
  CadWindow,
  Point,
  RoomType,
} from "@/types/floor-plan-cad";

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

// ============================================================
// ROOM TYPE MAPPING
// ============================================================

const ROOM_TYPE_MAP: Record<string, RoomType> = {
  living: "living_room",
  bedroom: "bedroom",
  kitchen: "kitchen",
  dining: "dining_room",
  bathroom: "bathroom",
  veranda: "verandah",
  hallway: "corridor",
  storage: "store_room",
  office: "home_office",
  balcony: "balcony",
  patio: "terrace",
  entrance: "foyer",
  utility: "utility",
  closet: "walk_in_closet",
  passage: "corridor",
  studio: "bedroom",
  staircase: "staircase",
  other: "custom",
};

// ============================================================
// MAIN ADAPTER
// ============================================================

export function convertGeometryToProject(
  geometry: FloorPlanGeometry,
  projectName: string = "AI-Generated Floor Plan",
  originalPrompt?: string
): FloorPlanProject {
  const M = 1000; // meters to mm
  const buildingW = geometry.footprint.width * M;
  const buildingD = geometry.footprint.depth * M;

  // Track generated IDs for cross-referencing
  const wallIdMap = new Map<number, string>();
  const roomIdMap = new Map<string, string>();

  // ---- Convert walls ----
  const walls: Wall[] = geometry.walls.map((gw, idx) => {
    const id = genId("w");
    wallIdMap.set(idx, id);

    // Convert from meters (Y-down) to mm (Y-up)
    const startMm: Point = {
      x: gw.start[0] * M,
      y: buildingD - gw.start[1] * M, // flip Y
    };
    const endMm: Point = {
      x: gw.end[0] * M,
      y: buildingD - gw.end[1] * M, // flip Y
    };

    return {
      id,
      type: gw.type === "exterior" ? "exterior" as const : "interior" as const,
      material: gw.type === "exterior" ? "brick" as const : "brick" as const,
      centerline: { start: startMm, end: endMm },
      thickness_mm: (gw.thickness || 0.15) * M,
      height_mm: (geometry.wallHeight || 2.85) * M,
      openings: [],
      line_weight: gw.type === "exterior" ? "thick" as const : "medium" as const,
      is_load_bearing: gw.type === "exterior",
    };
  });

  // If no walls from geometry, generate boundary walls
  if (walls.length === 0) {
    const ext = 230; // mm, standard exterior wall
    walls.push(
      { id: genId("w"), type: "exterior", material: "brick", centerline: { start: { x: 0, y: 0 }, end: { x: buildingW, y: 0 } }, thickness_mm: ext, height_mm: 2850, openings: [], line_weight: "thick", is_load_bearing: true },
      { id: genId("w"), type: "exterior", material: "brick", centerline: { start: { x: buildingW, y: 0 }, end: { x: buildingW, y: buildingD } }, thickness_mm: ext, height_mm: 2850, openings: [], line_weight: "thick", is_load_bearing: true },
      { id: genId("w"), type: "exterior", material: "brick", centerline: { start: { x: buildingW, y: buildingD }, end: { x: 0, y: buildingD } }, thickness_mm: ext, height_mm: 2850, openings: [], line_weight: "thick", is_load_bearing: true },
      { id: genId("w"), type: "exterior", material: "brick", centerline: { start: { x: 0, y: buildingD }, end: { x: 0, y: 0 } }, thickness_mm: ext, height_mm: 2850, openings: [], line_weight: "thick", is_load_bearing: true },
    );
  }

  // ---- Convert rooms ----
  const rooms: Room[] = geometry.rooms.map((gr) => {
    const id = genId("r");
    roomIdMap.set(gr.name, id);

    const wMm = gr.width * M;
    const dMm = gr.depth * M;

    // Position: geometry uses top-left origin Y-down
    // We need bottom-left origin Y-up
    const leftX = (gr.x ?? gr.center[0] - gr.width / 2) * M;
    const topY = (gr.y ?? gr.center[1] - gr.depth / 2) * M;

    // Convert to Y-up: bottom-left corner
    const x0 = leftX;
    const y0 = buildingD - topY - dMm; // flip Y

    const boundary: Point[] = [
      { x: x0, y: y0 },
      { x: x0 + wMm, y: y0 },
      { x: x0 + wMm, y: y0 + dMm },
      { x: x0, y: y0 + dMm },
    ];

    const area = gr.area ?? (gr.width * gr.depth);
    const cadType = ROOM_TYPE_MAP[gr.type] ?? "custom";

    // Determine Vastu direction from centroid position in building
    const cx = x0 + wMm / 2;
    const cy = y0 + dMm / 2;
    const vastuDir = computeVastuDirection(cx, cy, buildingW, buildingD);

    // Find walls that bound this room
    const wallIds = findBoundingWalls(boundary, walls);

    return {
      id,
      name: gr.name,
      type: cadType,
      boundary: { points: boundary },
      area_sqm: area,
      perimeter_mm: (wMm + dMm) * 2,
      natural_light_required: ["living_room", "bedroom", "master_bedroom", "kitchen", "dining_room", "study", "home_office"].includes(cadType),
      ventilation_required: true,
      label_position: { x: cx, y: cy },
      wall_ids: wallIds,
      vastu_direction: vastuDir,
    };
  });

  // ---- Convert doors ----
  const doors: Door[] = geometry.doors.map((gd) => {
    const wallId = wallIdMap.get(gd.wallId) ?? walls[0]?.id ?? genId("w");
    const wall = walls.find((w) => w.id === wallId);
    const widthMm = gd.width * M;

    // Determine position along the wall
    const posAlongWall = gd.position ? gd.position[0] * M : widthMm;

    // Determine if main entrance (first door or connects to outside)
    const isMainEntrance = gd.type === "double" || (gd.connectsRooms && gd.connectsRooms.includes(""));

    return {
      id: genId("d"),
      type: isMainEntrance ? "main_entrance" as const : "single_swing" as const,
      wall_id: wallId,
      width_mm: widthMm,
      height_mm: 2100,
      thickness_mm: 45,
      position_along_wall_mm: posAlongWall,
      swing_direction: "left" as const,
      swing_angle_deg: 90,
      opens_to: "inside" as const,
      symbol: {
        hinge_point: { x: 0, y: 0 },
        arc_radius_mm: widthMm,
        arc_start_angle_deg: 0,
        arc_end_angle_deg: 90,
        leaf_end_point: { x: 0, y: widthMm },
      },
      connects_rooms: (gd.connectsRooms?.map((rn) => roomIdMap.get(rn) ?? "") ?? ["", ""]) as [string, string],
    };
  });

  // ---- Convert windows ----
  const windows: CadWindow[] = geometry.windows.map((gw) => {
    // Find the nearest exterior wall for this window
    const winPos: Point = { x: gw.position[0] * M, y: buildingD - gw.position[1] * M };
    const nearestWall = findNearestExteriorWall(winPos, walls);

    return {
      id: genId("win"),
      type: "casement" as const,
      wall_id: nearestWall?.id ?? walls[0]?.id ?? "",
      width_mm: gw.width * M,
      height_mm: (gw.height || 1.2) * M,
      sill_height_mm: (gw.sillHeight || 0.9) * M,
      position_along_wall_mm: 500, // Default offset
      symbol: {
        start_point: { x: 0, y: 0 },
        end_point: { x: gw.width * M, y: 0 },
        glass_lines: [],
      },
      glazing: "double" as const,
      operable: true,
    };
  });

  // ---- Assemble project ----
  const floor: Floor = {
    id: genId("floor"),
    name: "Ground Floor",
    level: 0,
    floor_to_floor_height_mm: (geometry.wallHeight || 3) * M,
    slab_thickness_mm: 150,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: buildingW, y: 0 },
        { x: buildingW, y: buildingD },
        { x: 0, y: buildingD },
      ],
    },
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
    id: genId("proj"),
    name: projectName,
    version: "1.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential",
      building_type: `${geometry.rooms.length}-room layout`,
      num_floors: 1,
      plot_area_sqm: geometry.footprint.width * geometry.footprint.depth,
      carpet_area_sqm: geometry.rooms.reduce((s, r) => s + (r.area ?? r.width * r.depth), 0),
      original_prompt: originalPrompt,
      generation_model: "AI Pipeline",
      generation_timestamp: new Date().toISOString(),
    },
    settings: {
      units: "metric",
      display_unit: "m",
      scale: "1:100",
      grid_size_mm: 100,
      wall_thickness_mm: 150,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: true,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: true,
    },
    floors: [floor],
  };
}

// ============================================================
// HELPERS
// ============================================================

type VDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";

function computeVastuDirection(cx: number, cy: number, bw: number, bh: number): VDir {
  const rx = cx / bw; // 0 = left (W), 1 = right (E)
  const ry = cy / bh; // 0 = bottom (S), 1 = top (N) (Y-up)

  let col = rx < 0.333 ? 0 : rx < 0.667 ? 1 : 2;
  let row = ry < 0.333 ? 0 : ry < 0.667 ? 1 : 2;

  const GRID: VDir[][] = [
    ["SW", "S", "SE"],
    ["W", "CENTER", "E"],
    ["NW", "N", "NE"],
  ];
  return GRID[row][col];
}

function findBoundingWalls(roomBoundary: Point[], walls: Wall[]): string[] {
  const result: string[] = [];
  const TOLERANCE = 200; // mm

  for (const wall of walls) {
    const ws = wall.centerline.start;
    const we = wall.centerline.end;
    const wmx = (ws.x + we.x) / 2;
    const wmy = (ws.y + we.y) / 2;

    // Check if wall midpoint is near any edge of the room boundary
    for (let i = 0; i < roomBoundary.length; i++) {
      const a = roomBoundary[i];
      const b = roomBoundary[(i + 1) % roomBoundary.length];
      const emx = (a.x + b.x) / 2;
      const emy = (a.y + b.y) / 2;

      const dx = Math.abs(wmx - emx);
      const dy = Math.abs(wmy - emy);

      if (dx < TOLERANCE || dy < TOLERANCE) {
        // Check alignment: wall and edge should be roughly parallel
        const isHorizWall = Math.abs(ws.y - we.y) < Math.abs(ws.x - we.x);
        const isHorizEdge = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);

        if (isHorizWall === isHorizEdge) {
          result.push(wall.id);
          break;
        }
      }
    }
  }

  return result;
}

function findNearestExteriorWall(pos: Point, walls: Wall[]): Wall | null {
  let best: Wall | null = null;
  let bestDist = Infinity;

  for (const wall of walls) {
    if (wall.type !== "exterior") continue;

    const mx = (wall.centerline.start.x + wall.centerline.end.x) / 2;
    const my = (wall.centerline.start.y + wall.centerline.end.y) / 2;
    const dist = Math.sqrt((pos.x - mx) ** 2 + (pos.y - my) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      best = wall;
    }
  }

  return best;
}
