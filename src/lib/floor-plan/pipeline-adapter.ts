/**
 * Pipeline Adapter — converts AI pipeline output (FloorPlanGeometry) to
 * FloorPlanProject (professional CAD schema in mm).
 *
 * FloorPlanGeometry uses meters, origin top-left, Y-down.
 * FloorPlanProject uses mm, origin bottom-left, Y-up.
 *
 * Sprint 1 fixes:
 *  Bug 1 — Shared wall deduplication + interior wall generation from room adjacency
 *  Bug 2 — Smart door swing based on room types (IS:962 / NBC India)
 *  Bug 3 — Window centered on wall + room-type-appropriate sizing (IS:1038)
 *  Bug 4 — Correct hinge point calculation from wall geometry
 */

import type { FloorPlanGeometry } from "@/types/floor-plan";
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
import { smartPlaceDoors, smartPlaceWindows } from "./smart-placement";

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

// ============================================================
// CONSTANTS
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

// IS:1905 / NBC India wall thickness standards
const EXTERIOR_WALL_MM = 230;  // 9″ brick
const INTERIOR_WALL_MM = 150;  // 6″ brick

// Room types that require outward-swinging doors (safety — IS:962)
const WET_ROOMS: readonly RoomType[] = ["bathroom", "wc", "toilet", "utility", "laundry"];
// Circulation spaces — doors should swing away from these
const CIRCULATION_ROOMS: readonly RoomType[] = ["corridor", "lobby", "foyer", "staircase"];

// Window sizing by room type (IS:1038 / NBC India guidelines)
const WINDOW_SPECS: Record<string, { width: number; height: number; sill: number }> = {
  living_room:    { width: 1500, height: 1200, sill: 600 },
  dining_room:    { width: 1500, height: 1200, sill: 600 },
  bedroom:        { width: 1200, height: 1200, sill: 900 },
  master_bedroom: { width: 1500, height: 1200, sill: 900 },
  guest_bedroom:  { width: 1200, height: 1200, sill: 900 },
  kitchen:        { width: 1200, height: 1000, sill: 1050 },
  bathroom:       { width: 600,  height: 450,  sill: 1800 },
  wc:             { width: 600,  height: 450,  sill: 1800 },
  toilet:         { width: 600,  height: 450,  sill: 1800 },
  staircase:      { width: 900,  height: 1200, sill: 900 },
  home_office:    { width: 1200, height: 1200, sill: 900 },
  study:          { width: 1200, height: 1200, sill: 900 },
};

// ============================================================
// INTERNAL TYPES
// ============================================================

interface RoomRect {
  id: string;
  type: RoomType;
  x0: number; y0: number; // bottom-left (mm, Y-up)
  x1: number; y1: number; // top-right (mm, Y-up)
}

// ============================================================
// ROOM SNAPPING — close gaps between rooms
// ============================================================

/**
 * Snap room edges that are within tolerance to close AI-generated gaps.
 * GPT-4o often leaves 0.1m–0.5m gaps between rooms for visual spacing;
 * this pass closes them so shared wall detection works correctly.
 * Operates on RoomRect[] (mm, Y-up coordinates).
 */
function snapRoomRects(rects: RoomRect[], tol: number = 400): void {
  // Run 2 passes to propagate snapping (A snaps to B, then C snaps to new A)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];

        // Require vertical overlap for horizontal snapping and vice versa
        const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const hOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);

        // Horizontal: A-right → B-left
        if (vOverlap > 100) {
          const gapR = b.x0 - a.x1;
          if (gapR > 1 && gapR < tol) {
            const mid = (a.x1 + b.x0) / 2;
            a.x1 = mid;
            b.x0 = mid;
          }
          const gapL = a.x0 - b.x1;
          if (gapL > 1 && gapL < tol) {
            const mid = (b.x1 + a.x0) / 2;
            b.x1 = mid;
            a.x0 = mid;
          }
        }

        // Vertical: A-top → B-bottom
        if (hOverlap > 100) {
          const gapT = b.y0 - a.y1;
          if (gapT > 1 && gapT < tol) {
            const mid = (a.y1 + b.y0) / 2;
            a.y1 = mid;
            b.y0 = mid;
          }
          const gapB = a.y0 - b.y1;
          if (gapB > 1 && gapB < tol) {
            const mid = (b.y1 + a.y0) / 2;
            b.y1 = mid;
            a.y0 = mid;
          }
        }

        // Also snap nearly-aligned edges (e.g., two rooms whose tops are 50mm apart)
        if (hOverlap > 100) {
          if (Math.abs(a.y1 - b.y1) > 0 && Math.abs(a.y1 - b.y1) < tol / 2) {
            const avg = (a.y1 + b.y1) / 2;
            a.y1 = avg;
            b.y1 = avg;
          }
          if (Math.abs(a.y0 - b.y0) > 0 && Math.abs(a.y0 - b.y0) < tol / 2) {
            const avg = (a.y0 + b.y0) / 2;
            a.y0 = avg;
            b.y0 = avg;
          }
        }
        if (vOverlap > 100) {
          if (Math.abs(a.x1 - b.x1) > 0 && Math.abs(a.x1 - b.x1) < tol / 2) {
            const avg = (a.x1 + b.x1) / 2;
            a.x1 = avg;
            b.x1 = avg;
          }
          if (Math.abs(a.x0 - b.x0) > 0 && Math.abs(a.x0 - b.x0) < tol / 2) {
            const avg = (a.x0 + b.x0) / 2;
            a.x0 = avg;
            b.x0 = avg;
          }
        }
      }
    }
  }
}

/**
 * After snapping rects, update room boundary points + area to match.
 */
function syncRoomsToRects(rooms: Room[], rects: RoomRect[]): void {
  for (let i = 0; i < rooms.length && i < rects.length; i++) {
    const r = rects[i];
    const wMm = r.x1 - r.x0;
    const dMm = r.y1 - r.y0;
    rooms[i].boundary.points = [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ];
    rooms[i].area_sqm = (wMm * dMm) / 1_000_000;
    rooms[i].perimeter_mm = (wMm + dMm) * 2;
    rooms[i].label_position = { x: r.x0 + wMm / 2, y: r.y0 + dMm / 2 };
  }
}

// ============================================================
// MAIN ADAPTER
// ============================================================

export function convertGeometryToProject(
  geometry: FloorPlanGeometry,
  projectName: string = "AI-Generated Floor Plan",
  originalPrompt?: string,
): FloorPlanProject {
  const M = 1000; // meters → mm
  const buildingW = geometry.footprint.width * M;
  const buildingD = geometry.footprint.depth * M;

  const roomIdMap = new Map<string, string>();
  const roomRects: RoomRect[] = [];

  // ---- 1. Convert rooms (walls depend on room positions) ----
  const rooms: Room[] = geometry.rooms.map((gr) => {
    const id = genId("r");
    roomIdMap.set(gr.name, id);

    const wMm = gr.width * M;
    const dMm = gr.depth * M;
    const leftX = (gr.x ?? gr.center[0] - gr.width / 2) * M;
    const topY = (gr.y ?? gr.center[1] - gr.depth / 2) * M;

    // Y-down → Y-up flip
    const x0 = leftX;
    const y0 = buildingD - topY - dMm;

    const boundary: Point[] = [
      { x: x0, y: y0 },
      { x: x0 + wMm, y: y0 },
      { x: x0 + wMm, y: y0 + dMm },
      { x: x0, y: y0 + dMm },
    ];

    const area = gr.area ?? gr.width * gr.depth;
    const cadType = ROOM_TYPE_MAP[gr.type] ?? "custom";

    roomRects.push({ id, type: cadType, x0, y0, x1: x0 + wMm, y1: y0 + dMm });

    const cx = x0 + wMm / 2;
    const cy = y0 + dMm / 2;

    return {
      id,
      name: gr.name,
      type: cadType,
      boundary: { points: boundary },
      area_sqm: area,
      perimeter_mm: (wMm + dMm) * 2,
      natural_light_required: [
        "living_room", "bedroom", "master_bedroom", "kitchen",
        "dining_room", "study", "home_office",
      ].includes(cadType),
      ventilation_required: true,
      label_position: { x: cx, y: cy },
      wall_ids: [], // filled by assignRoomIds
      vastu_direction: computeVastuDirection(cx, cy, buildingW, buildingD),
    };
  });

  // ---- 1b. SNAP PASS — close AI-generated gaps between rooms ----
  // GPT-4o often leaves 0.1–0.5m gaps; this snaps adjacent edges together
  // so shared wall detection in step 2 works correctly.
  snapRoomRects(roomRects, 400); // 400mm tolerance
  syncRoomsToRects(rooms, roomRects);

  // ---- 2. Generate / convert walls (Bug 1: deduplication + room adjacency) ----
  const walls =
    geometry.walls.length > 0
      ? convertExistingWalls(geometry, M, buildingD)
      : generateWallsFromRooms(roomRects, buildingW, buildingD);

  assignRoomIds(walls, rooms, roomRects);

  // ---- 3. Doors — use smart placement when geometry has none ----
  const doors: Door[] = geometry.doors.length > 0
    ? convertDoors(geometry, M, buildingD, walls, rooms, roomIdMap)
    : [];

  // ---- 4. Windows — use smart placement when geometry has none ----
  const windows: CadWindow[] = geometry.windows.length > 0
    ? convertWindows(geometry, M, buildingD, walls, rooms)
    : [];

  // ---- 5. Assemble project ----
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

  // ---- 5b. Auto-place doors and windows when AI provided none ----
  if (doors.length === 0) {
    const doorResult = smartPlaceDoors(floor);
    floor.doors = doorResult.doors;
  }
  if (windows.length === 0) {
    const windowResult = smartPlaceWindows(floor);
    floor.windows = windowResult.windows;
  }

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
      carpet_area_sqm: geometry.rooms.reduce(
        (s, r) => s + (r.area ?? r.width * r.depth),
        0,
      ),
      original_prompt: originalPrompt,
      generation_model: "AI Pipeline",
      generation_timestamp: new Date().toISOString(),
    },
    settings: {
      units: "metric",
      display_unit: "m",
      scale: "1:100",
      grid_size_mm: 100,
      wall_thickness_mm: INTERIOR_WALL_MM,
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
// BUG 1 — WALL GENERATION + DEDUPLICATION
// ============================================================

function convertExistingWalls(
  geometry: FloorPlanGeometry,
  M: number,
  buildingD: number,
): Wall[] {
  const raw: Wall[] = geometry.walls.map((gw) => {
    const isExt = gw.type === "exterior";
    return {
      id: genId("w"),
      type: isExt ? ("exterior" as const) : ("interior" as const),
      material: "brick" as const,
      centerline: {
        start: { x: gw.start[0] * M, y: buildingD - gw.start[1] * M },
        end: { x: gw.end[0] * M, y: buildingD - gw.end[1] * M },
      },
      thickness_mm: isExt ? EXTERIOR_WALL_MM : INTERIOR_WALL_MM,
      height_mm: (geometry.wallHeight || 2.85) * M,
      openings: [],
      line_weight: isExt ? ("thick" as const) : ("medium" as const),
      is_load_bearing: isExt,
    };
  });

  return deduplicateWalls(raw, 100);
}

function generateWallsFromRooms(
  rects: RoomRect[],
  buildingW: number,
  buildingD: number,
): Wall[] {
  const walls: Wall[] = [];
  const TOL = 250; // tolerance for shared edge detection (increased from 100 — rooms snapped but may have residual offset)
  const BTOL = 300; // building-boundary tolerance
  const shared = new Set<string>();

  // 1. Shared edges between room pairs → single interior wall
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];

      // A-top ↔ B-bottom
      if (Math.abs(a.y1 - b.y0) < TOL) {
        const ox0 = Math.max(a.x0, b.x0);
        const ox1 = Math.min(a.x1, b.x1);
        if (ox1 - ox0 > TOL) {
          const y = (a.y1 + b.y0) / 2;
          walls.push(mkWall({ x: ox0, y }, { x: ox1, y }, "interior", INTERIOR_WALL_MM, a.id, b.id));
          shared.add(`${i}-top`);
          shared.add(`${j}-bottom`);
        }
      }
      // B-top ↔ A-bottom
      if (Math.abs(b.y1 - a.y0) < TOL) {
        const ox0 = Math.max(a.x0, b.x0);
        const ox1 = Math.min(a.x1, b.x1);
        if (ox1 - ox0 > TOL) {
          const y = (b.y1 + a.y0) / 2;
          walls.push(mkWall({ x: ox0, y }, { x: ox1, y }, "interior", INTERIOR_WALL_MM, b.id, a.id));
          shared.add(`${i}-bottom`);
          shared.add(`${j}-top`);
        }
      }
      // A-right ↔ B-left
      if (Math.abs(a.x1 - b.x0) < TOL) {
        const oy0 = Math.max(a.y0, b.y0);
        const oy1 = Math.min(a.y1, b.y1);
        if (oy1 - oy0 > TOL) {
          const x = (a.x1 + b.x0) / 2;
          walls.push(mkWall({ x, y: oy0 }, { x, y: oy1 }, "interior", INTERIOR_WALL_MM, a.id, b.id));
          shared.add(`${i}-right`);
          shared.add(`${j}-left`);
        }
      }
      // B-right ↔ A-left
      if (Math.abs(b.x1 - a.x0) < TOL) {
        const oy0 = Math.max(a.y0, b.y0);
        const oy1 = Math.min(a.y1, b.y1);
        if (oy1 - oy0 > TOL) {
          const x = (b.x1 + a.x0) / 2;
          walls.push(mkWall({ x, y: oy0 }, { x, y: oy1 }, "interior", INTERIOR_WALL_MM, b.id, a.id));
          shared.add(`${i}-left`);
          shared.add(`${j}-right`);
        }
      }
    }
  }

  // 2. Non-shared room edges → exterior (if on building boundary) or interior
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const edges: Array<{ key: string; s: Point; e: Point; boundary: boolean }> = [
      { key: `${i}-bottom`, s: { x: r.x0, y: r.y0 }, e: { x: r.x1, y: r.y0 }, boundary: r.y0 < BTOL },
      { key: `${i}-right`,  s: { x: r.x1, y: r.y0 }, e: { x: r.x1, y: r.y1 }, boundary: Math.abs(r.x1 - buildingW) < BTOL },
      { key: `${i}-top`,    s: { x: r.x1, y: r.y1 }, e: { x: r.x0, y: r.y1 }, boundary: Math.abs(r.y1 - buildingD) < BTOL },
      { key: `${i}-left`,   s: { x: r.x0, y: r.y1 }, e: { x: r.x0, y: r.y0 }, boundary: r.x0 < BTOL },
    ];
    for (const edge of edges) {
      if (shared.has(edge.key)) continue;
      const type = edge.boundary ? "exterior" : "interior";
      const thick = edge.boundary ? EXTERIOR_WALL_MM : INTERIOR_WALL_MM;
      walls.push(mkWall(edge.s, edge.e, type, thick, r.id, undefined));
    }
  }

  return deduplicateWalls(walls, TOL);
}

function mkWall(
  start: Point,
  end: Point,
  type: "exterior" | "interior",
  thickness: number,
  leftRoomId?: string,
  rightRoomId?: string,
): Wall {
  return {
    id: genId("w"),
    type,
    material: "brick",
    centerline: { start, end },
    thickness_mm: thickness,
    height_mm: 2850,
    left_room_id: leftRoomId,
    right_room_id: rightRoomId,
    openings: [],
    line_weight: type === "exterior" ? "thick" : "medium",
    is_load_bearing: type === "exterior",
  };
}

// ── Deduplication ──

function deduplicateWalls(walls: Wall[], tol: number): Wall[] {
  const used = new Set<number>();
  const result: Wall[] = [];

  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    let merged = walls[i];
    used.add(i);

    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;
      const m = tryMerge(merged, walls[j], tol);
      if (m) { merged = m; used.add(j); }
    }
    result.push(merged);
  }
  return result;
}

function tryMerge(a: Wall, b: Wall, tol: number): Wall | null {
  const aH = hLine(a.centerline, tol);
  const bH = hLine(b.centerline, tol);
  const aV = vLine(a.centerline, tol);
  const bV = vLine(b.centerline, tol);

  if (aH && bH) {
    const ay = (a.centerline.start.y + a.centerline.end.y) / 2;
    const by = (b.centerline.start.y + b.centerline.end.y) / 2;
    if (Math.abs(ay - by) > tol) return null;
    const [aMin, aMax] = xRange(a.centerline);
    const [bMin, bMax] = xRange(b.centerline);
    if (aMax + tol < bMin || bMax + tol < aMin) return null;
    const y = (ay + by) / 2;
    return mergedWall(a, b, { x: Math.min(aMin, bMin), y }, { x: Math.max(aMax, bMax), y });
  }
  if (aV && bV) {
    const ax = (a.centerline.start.x + a.centerline.end.x) / 2;
    const bx = (b.centerline.start.x + b.centerline.end.x) / 2;
    if (Math.abs(ax - bx) > tol) return null;
    const [aMin, aMax] = yRange(a.centerline);
    const [bMin, bMax] = yRange(b.centerline);
    if (aMax + tol < bMin || bMax + tol < aMin) return null;
    const x = (ax + bx) / 2;
    return mergedWall(a, b, { x, y: Math.min(aMin, bMin) }, { x, y: Math.max(aMax, bMax) });
  }

  // Diagonal walls: merge if collinear (same direction vector) and overlapping
  if (!aH && !aV && !bH && !bV) {
    const adx = a.centerline.end.x - a.centerline.start.x;
    const ady = a.centerline.end.y - a.centerline.start.y;
    const bdx = b.centerline.end.x - b.centerline.start.x;
    const bdy = b.centerline.end.y - b.centerline.start.y;
    const aLen = Math.sqrt(adx * adx + ady * ady);
    const bLen = Math.sqrt(bdx * bdx + bdy * bdy);
    if (aLen < 1 || bLen < 1) return null;
    // Normalize direction vectors
    const anx = adx / aLen, any_ = ady / aLen;
    const bnx = bdx / bLen, bny = bdy / bLen;
    // Check if parallel (cross product ≈ 0)
    const cross = anx * bny - any_ * bnx;
    if (Math.abs(cross) > 0.05) return null; // >~3° difference — not collinear
    // Check if on the same line (perpendicular distance between lines < tol)
    const dx = b.centerline.start.x - a.centerline.start.x;
    const dy = b.centerline.start.y - a.centerline.start.y;
    const perpDist = Math.abs(dx * (-any_) + dy * anx);
    if (perpDist > tol) return null;
    // Project all 4 endpoints onto the shared direction axis
    const projA0 = a.centerline.start.x * anx + a.centerline.start.y * any_;
    const projA1 = a.centerline.end.x * anx + a.centerline.end.y * any_;
    const projB0 = b.centerline.start.x * anx + b.centerline.start.y * any_;
    const projB1 = b.centerline.end.x * anx + b.centerline.end.y * any_;
    const aMinP = Math.min(projA0, projA1), aMaxP = Math.max(projA0, projA1);
    const bMinP = Math.min(projB0, projB1), bMaxP = Math.max(projB0, projB1);
    if (aMaxP + tol < bMinP || bMaxP + tol < aMinP) return null; // No overlap
    // Merged extent
    const minP = Math.min(aMinP, bMinP);
    const maxP = Math.max(aMaxP, bMaxP);
    const start: Point = { x: a.centerline.start.x + anx * (minP - projA0), y: a.centerline.start.y + any_ * (minP - projA0) };
    const end: Point = { x: a.centerline.start.x + anx * (maxP - projA0), y: a.centerline.start.y + any_ * (maxP - projA0) };
    return mergedWall(a, b, start, end);
  }

  return null;
}

function mergedWall(a: Wall, b: Wall, start: Point, end: Point): Wall {
  const isExt = a.type === "exterior" || b.type === "exterior";
  return {
    ...a,
    centerline: { start, end },
    thickness_mm: Math.max(a.thickness_mm, b.thickness_mm),
    type: isExt ? "exterior" : a.type,
    line_weight: isExt ? "thick" : a.line_weight,
    is_load_bearing: isExt || a.is_load_bearing,
    left_room_id: a.left_room_id ?? b.left_room_id,
    right_room_id: a.right_room_id ?? b.right_room_id,
  };
}

// ── Assign room IDs to walls + fill room.wall_ids ──

function assignRoomIds(walls: Wall[], rooms: Room[], rects: RoomRect[]): void {
  const TOL = 200;

  for (const wall of walls) {
    if (wall.left_room_id && wall.right_room_id) {
      // Already set — just update room.wall_ids
      for (const room of rooms) {
        if (room.id === wall.left_room_id || room.id === wall.right_room_id) {
          if (!room.wall_ids.includes(wall.id)) room.wall_ids.push(wall.id);
        }
      }
      continue;
    }

    const wmx = (wall.centerline.start.x + wall.centerline.end.x) / 2;
    const wmy = (wall.centerline.start.y + wall.centerline.end.y) / 2;
    const isH = hLine(wall.centerline, TOL);

    for (let ri = 0; ri < rects.length; ri++) {
      const r = rects[ri];
      const room = rooms[ri];

      if (isH) {
        const overlap = segOverlap(
          Math.min(wall.centerline.start.x, wall.centerline.end.x),
          Math.max(wall.centerline.start.x, wall.centerline.end.x),
          r.x0, r.x1,
        );
        if (overlap < TOL) continue;
        if (Math.abs(wmy - r.y0) < TOL || Math.abs(wmy - r.y1) < TOL) {
          assignRoom(wall, room);
        }
      } else {
        const overlap = segOverlap(
          Math.min(wall.centerline.start.y, wall.centerline.end.y),
          Math.max(wall.centerline.start.y, wall.centerline.end.y),
          r.y0, r.y1,
        );
        if (overlap < TOL) continue;
        if (Math.abs(wmx - r.x0) < TOL || Math.abs(wmx - r.x1) < TOL) {
          assignRoom(wall, room);
        }
      }
    }
  }
}

function assignRoom(wall: Wall, room: Room): void {
  if (!wall.left_room_id) wall.left_room_id = room.id;
  else if (!wall.right_room_id && wall.left_room_id !== room.id) wall.right_room_id = room.id;
  if (!room.wall_ids.includes(wall.id)) room.wall_ids.push(wall.id);
}

// ============================================================
// BUG 2 — SMART DOOR SWING
// ============================================================

function computeDoorSwing(
  wallId: string,
  walls: Wall[],
  rooms: Room[],
): { direction: "left" | "right"; opensTo: "inside" | "outside" } {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return { direction: "left", opensTo: "inside" };

  const leftRoom = rooms.find((r) => r.id === wall.left_room_id);
  const rightRoom = rooms.find((r) => r.id === wall.right_room_id);

  // Bathroom / WC: door must swing outward (NBC safety — if person collapses)
  if (leftRoom && (WET_ROOMS as readonly string[]).includes(leftRoom.type)) {
    return { direction: "right", opensTo: "outside" };
  }
  if (rightRoom && (WET_ROOMS as readonly string[]).includes(rightRoom.type)) {
    return { direction: "left", opensTo: "outside" };
  }

  // Corridor / lobby: swing toward the room (away from circulation)
  if (leftRoom && (CIRCULATION_ROOMS as readonly string[]).includes(leftRoom.type)) {
    return { direction: "right", opensTo: "inside" };
  }
  if (rightRoom && (CIRCULATION_ROOMS as readonly string[]).includes(rightRoom.type)) {
    return { direction: "left", opensTo: "inside" };
  }

  // Default: swing into the larger room, hinge on right
  const la = leftRoom?.area_sqm ?? 0;
  const ra = rightRoom?.area_sqm ?? 0;
  return la >= ra
    ? { direction: "right", opensTo: "inside" }
    : { direction: "left", opensTo: "inside" };
}

// ============================================================
// BUGS 2 + 4 — DOOR CONVERSION
// ============================================================

function convertDoors(
  geometry: FloorPlanGeometry,
  M: number,
  buildingD: number,
  walls: Wall[],
  rooms: Room[],
  roomIdMap: Map<string, string>,
): Door[] {
  return geometry.doors.map((gd, idx) => {
    // Locate wall by projecting door world-position onto all walls
    const doorWorld: Point = {
      x: gd.position[0] * M,
      y: buildingD - gd.position[1] * M,
    };
    const wall = findNearestWall(doorWorld, walls);
    const wallId = wall?.id ?? walls[0]?.id ?? genId("w");
    const widthMm = gd.width * M;

    // Position along wall
    let pos = wall ? projectOntoWall(doorWorld, wall) : widthMm;
    if (wall) {
      const wLen = segLen(wall);
      pos = Math.max(50, Math.min(pos, wLen - widthMm - 50));
    }

    // Smart swing (Bug 2)
    const { direction: swingDir, opensTo } = computeDoorSwing(wallId, walls, rooms);

    const isMainEntrance =
      gd.type === "double" ||
      (wall?.type === "exterior" && idx === geometry.doors.length - 1);

    // Hinge + leaf (Bug 4)
    const hinge = computeHingePoint(wall, pos, widthMm, swingDir);
    const leafEnd = computeLeafEndPoint(wall, hinge, widthMm);

    const wAngle = wall
      ? (Math.atan2(
          wall.centerline.end.y - wall.centerline.start.y,
          wall.centerline.end.x - wall.centerline.start.x,
        ) * 180) / Math.PI
      : 0;

    return {
      id: genId("d"),
      type: isMainEntrance ? ("main_entrance" as const) : ("single_swing" as const),
      wall_id: wallId,
      width_mm: widthMm,
      height_mm: 2100,
      thickness_mm: 45,
      position_along_wall_mm: pos,
      swing_direction: swingDir,
      swing_angle_deg: 90,
      opens_to: opensTo,
      symbol: {
        hinge_point: hinge,
        arc_radius_mm: widthMm,
        arc_start_angle_deg: swingDir === "left" ? wAngle - 180 : wAngle,
        arc_end_angle_deg: 90,
        leaf_end_point: leafEnd,
      },
      connects_rooms: (gd.connectsRooms?.map((rn) => roomIdMap.get(rn) ?? "") ?? [
        wall?.left_room_id ?? "",
        wall?.right_room_id ?? "",
      ]) as [string, string],
    };
  });
}

// ============================================================
// BUG 3 — WINDOW CONVERSION (centered + room-type sizing)
// ============================================================

function convertWindows(
  geometry: FloorPlanGeometry,
  M: number,
  buildingD: number,
  walls: Wall[],
  rooms: Room[],
): CadWindow[] {
  return geometry.windows.map((gw) => {
    const winPos: Point = { x: gw.position[0] * M, y: buildingD - gw.position[1] * M };
    const wall = findNearestExteriorWall(winPos, walls);
    const wallId = wall?.id ?? walls[0]?.id ?? "";

    // Room-type-aware sizing
    const adj = wall
      ? rooms.find((r) => r.id === wall.left_room_id || r.id === wall.right_room_id)
      : undefined;
    const specs = adj ? WINDOW_SPECS[adj.type] ?? null : null;

    const widthMm = gw.width * M;
    const heightMm = (gw.height || (specs?.height ?? 1200) / M) * M;
    const sillMm = (gw.sillHeight || (specs?.sill ?? 900) / M) * M;

    // Center on projected point (Bug 3)
    let pos = 0;
    if (wall) {
      pos = projectOntoWall(winPos, wall) - widthMm / 2;
      const wLen = segLen(wall);
      pos = Math.max(100, Math.min(pos, wLen - widthMm - 100));
    }

    const symStart = ptOnWall(wall, pos);
    const symEnd = ptOnWall(wall, pos + widthMm);

    return {
      id: genId("win"),
      type: "casement" as const,
      wall_id: wallId,
      width_mm: widthMm,
      height_mm: heightMm,
      sill_height_mm: sillMm,
      position_along_wall_mm: pos,
      symbol: {
        start_point: symStart,
        end_point: symEnd,
        glass_lines: [{ start: symStart, end: symEnd }],
      },
      glazing: "double" as const,
      operable: true,
    };
  });
}

// ============================================================
// BUG 4 — HINGE POINT + LEAF END COMPUTATION
// ============================================================

function computeHingePoint(
  wall: Wall | null,
  posAlongWall: number,
  doorWidth: number,
  swingDir: "left" | "right",
): Point {
  if (!wall) return { x: 0, y: 0 };
  const offset = swingDir === "left" ? posAlongWall : posAlongWall + doorWidth;
  const cl = ptOnWall(wall, offset);
  const len = segLen(wall);
  if (len === 0) return cl;
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  const nx = -dy / len;
  const ny = dx / len;
  const half = wall.thickness_mm / 2;
  return { x: cl.x + nx * half, y: cl.y + ny * half };
}

function computeLeafEndPoint(wall: Wall | null, hinge: Point, doorWidth: number): Point {
  if (!wall) return { x: hinge.x, y: hinge.y + doorWidth };
  const len = segLen(wall);
  if (len === 0) return { x: hinge.x, y: hinge.y + doorWidth };
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  const nx = -dy / len;
  const ny = dx / len;
  return { x: hinge.x + nx * doorWidth, y: hinge.y + ny * doorWidth };
}

// ============================================================
// GEOMETRY HELPERS
// ============================================================

function hLine(l: { start: Point; end: Point }, tol: number): boolean {
  return Math.abs(l.start.y - l.end.y) < tol;
}
function vLine(l: { start: Point; end: Point }, tol: number): boolean {
  return Math.abs(l.start.x - l.end.x) < tol;
}
function xRange(l: { start: Point; end: Point }): [number, number] {
  return [Math.min(l.start.x, l.end.x), Math.max(l.start.x, l.end.x)];
}
function yRange(l: { start: Point; end: Point }): [number, number] {
  return [Math.min(l.start.y, l.end.y), Math.max(l.start.y, l.end.y)];
}
function segOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}
function segLen(wall: Wall): number {
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectOntoWall(p: Point, wall: Wall): number {
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((p.x - wall.centerline.start.x) * dx + (p.y - wall.centerline.start.y) * dy) / len2;
  return Math.max(0, Math.min(1, t)) * Math.sqrt(len2);
}

function ptOnWall(wall: Wall | null, offset: number): Point {
  if (!wall) return { x: 0, y: 0 };
  const len = segLen(wall);
  if (len === 0) return wall.centerline.start;
  const t = offset / len;
  return {
    x: wall.centerline.start.x + (wall.centerline.end.x - wall.centerline.start.x) * t,
    y: wall.centerline.start.y + (wall.centerline.end.y - wall.centerline.start.y) * t,
  };
}

function ptToSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
}

function findNearestWall(pos: Point, walls: Wall[]): Wall | null {
  let best: Wall | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const d = ptToSegDist(pos, w.centerline.start, w.centerline.end);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

function findNearestExteriorWall(pos: Point, walls: Wall[]): Wall | null {
  let best: Wall | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    if (w.type !== "exterior") continue;
    const d = ptToSegDist(pos, w.centerline.start, w.centerline.end);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best ?? findNearestWall(pos, walls);
}

type VDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";

function computeVastuDirection(cx: number, cy: number, bw: number, bh: number): VDir {
  const rx = cx / bw;
  const ry = cy / bh;
  const col = rx < 0.333 ? 0 : rx < 0.667 ? 1 : 2;
  const row = ry < 0.333 ? 0 : ry < 0.667 ? 1 : 2;
  const GRID: VDir[][] = [
    ["SW", "S", "SE"],
    ["W", "CENTER", "E"],
    ["NW", "N", "NE"],
  ];
  return GRID[row][col];
}
