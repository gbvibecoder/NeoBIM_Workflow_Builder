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
import { layoutAllFurniture } from "./furniture-layout";

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
  const inputRoomCount = geometry.rooms.length;
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

  // Validate: room count preserved through conversion
  if (rooms.length !== inputRoomCount) {
    console.error(`[STAGE-3] Room loss during conversion: ${inputRoomCount} → ${rooms.length}`);
  }

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

  // ---- 5b2. Enforce window ratios — add windows to rooms below NBC 10% minimum ----
  try {
    ensureWindowRatios(floor);
  } catch {
    // Non-critical: plan works without extra windows
  }

  // ---- 5c. Auto-furnish rooms (safe — skips rooms on failure) ----
  try {
    const furnResult = layoutAllFurniture(floor);
    if (furnResult.furniture.length > 0) {
      floor.furniture = furnResult.furniture;
    }
  } catch {
    // Non-critical: floor plan works without furniture
  }

  // ---- 5d. Generate staircase geometry for staircase rooms ----
  try {
    generateStaircaseGeometry(floor);
  } catch {
    // Non-critical: floor plan works without stair treads
  }

  // ---- 5e. Smart annotations from original prompt ----
  if (originalPrompt) {
    try {
      generateSmartAnnotations(floor, originalPrompt);
    } catch {
      // Non-critical: floor plan works without annotations
    }
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
        arc_end_angle_deg: swingDir === "left"
          ? wAngle - 180 + (opensTo === "inside" ? 90 : -90)
          : wAngle + (opensTo === "inside" ? 90 : -90),
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

// ============================================================
// WINDOW RATIO ENFORCEMENT — ensure every habitable room has windows
// ============================================================

function pipelineWallLength(wall: Wall): number {
  const dx = wall.centerline.end.x - wall.centerline.start.x;
  const dy = wall.centerline.end.y - wall.centerline.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Post-placement pass: for any habitable room with < 10% window-to-floor ratio,
 * add windows on the longest available wall (exterior preferred, interior as fallback).
 */
function ensureWindowRatios(floor: Floor): void {
  const SKIP_TYPES = new Set([
    "corridor", "lobby", "foyer", "staircase", "elevator", "shaft",
    "store_room", "walk_in_closet", "dressing_room", "pantry",
  ]);
  const SKIP_NAMES = /corridor|passage|stair|closet|storage|store|pantry/i;

  for (const room of floor.rooms) {
    if (SKIP_TYPES.has(room.type) || SKIP_NAMES.test(room.name)) continue;

    // Calculate current window area for this room
    const roomWallIds = new Set(room.wall_ids);
    const roomWindows = floor.windows.filter(w => roomWallIds.has(w.wall_id));
    const windowArea = roomWindows.reduce((s, w) => s + w.width_mm * w.height_mm * 0.7, 0);
    const floorArea = room.area_sqm * 1_000_000; // mm²
    if (floorArea <= 0) continue;
    const ratio = windowArea / floorArea;

    if (ratio >= 0.10) continue; // Already meets NBC 10% minimum

    // Find walls of this room sorted by length (longest first)
    const roomWalls = floor.walls.filter(w =>
      w.left_room_id === room.id || w.right_room_id === room.id
    );
    if (roomWalls.length === 0) continue;

    // Prefer exterior walls, then any wall
    const sortedWalls = [...roomWalls].sort((a, b) => {
      const aExt = a.type === "exterior" ? 0 : 1;
      const bExt = b.type === "exterior" ? 0 : 1;
      if (aExt !== bExt) return aExt - bExt;
      return pipelineWallLength(b) - pipelineWallLength(a);
    });

    let currentWindowArea = windowArea;
    const targetWindowArea = floorArea * 0.10;

    for (const wall of sortedWalls) {
      if (currentWindowArea >= targetWindowArea) break;

      const wLen = pipelineWallLength(wall);
      if (wLen < 800) continue; // Wall too short for a window

      // Check what's already on this wall
      const existingOnWall = [
        ...floor.doors.filter(d => d.wall_id === wall.id),
        ...floor.windows.filter(w => w.wall_id === wall.id),
      ];
      const usedLength = existingOnWall.reduce((s, item) => {
        const w = "width_mm" in item ? item.width_mm : 900;
        return s + w;
      }, 0);
      const available = wLen - usedLength - 600; // 300mm margin each side
      if (available < 600) continue;

      const winWidth = Math.min(1500, Math.max(600, available * 0.7));
      const winHeight = 1200;

      // Find a position that doesn't overlap existing openings
      const minPos = 300;
      const maxPos = wLen - winWidth - 300;
      if (maxPos < minPos) continue;

      // Try center position
      const pos = Math.max(minPos, Math.min((wLen - winWidth) / 2, maxPos));

      // Verify no overlap with existing
      const overlaps = existingOnWall.some(item => {
        const itemPos = "position_along_wall_mm" in item ? item.position_along_wall_mm : 0;
        const itemWidth = "width_mm" in item ? item.width_mm : 900;
        return pos + winWidth + 100 > itemPos && pos < itemPos + itemWidth + 100;
      });
      if (overlaps) continue;

      floor.windows.push({
        id: genId("win"),
        wall_id: wall.id,
        type: "casement",
        width_mm: winWidth,
        height_mm: winHeight,
        sill_height_mm: 900,
        position_along_wall_mm: pos,
        symbol: {
          start_point: { x: 0, y: 0 },
          end_point: { x: winWidth, y: 0 },
          glass_lines: [],
        },
        glazing: "double",
        operable: true,
      });

      currentWindowArea += winWidth * winHeight * 0.7;
    }
  }
}

// ============================================================
// SMART ANNOTATIONS FROM PROMPT
// ============================================================

/** Keyword → annotation text mapping for room-specific features */
const ANNOTATION_KEYWORDS: Array<{
  pattern: RegExp;
  roomTypes: string[];
  text: string;
}> = [
  { pattern: /double\s*height/i, roomTypes: ["living_room", "foyer"], text: "Dbl Height" },
  { pattern: /(?:kitchen\s+)?island/i, roomTypes: ["kitchen"], text: "Kitchen Island" },
  { pattern: /western\s*(?:style\s*)?(?:toilet|wc|commode)/i, roomTypes: ["bathroom", "wc", "toilet"], text: "Western WC" },
  { pattern: /indian\s*(?:style\s*)?(?:toilet|wc)/i, roomTypes: ["bathroom", "wc", "toilet"], text: "Indian WC" },
  { pattern: /walk[\s-]*in\s*(?:closet|wardrobe)/i, roomTypes: ["bedroom", "master_bedroom", "walk_in_closet", "dressing_room"], text: "Walk-in Closet" },
  { pattern: /french\s*(?:window|door)/i, roomTypes: ["living_room", "bedroom", "master_bedroom", "balcony"], text: "French Window" },
  { pattern: /modular\s*kitchen/i, roomTypes: ["kitchen"], text: "Modular Kitchen" },
  { pattern: /(?:open|combined)\s*(?:plan|layout|kitchen)/i, roomTypes: ["living_room", "dining_room", "kitchen"], text: "Open Plan" },
  { pattern: /(?:dry|wet)\s*kitchen/i, roomTypes: ["kitchen"], text: "Dry + Wet Kitchen" },
  { pattern: /(?:servant|maid|staff)\s*(?:quarter|room)/i, roomTypes: ["servant_quarter", "bedroom"], text: "Servant Quarter" },
  { pattern: /(?:home\s*)?theater|(?:home\s*)?cinema/i, roomTypes: ["custom"], text: "Home Theater" },
  { pattern: /gym|workout/i, roomTypes: ["custom"], text: "Home Gym" },
  { pattern: /pooja|puja|prayer|mandir/i, roomTypes: ["puja_room", "custom"], text: "Pooja Room" },
  { pattern: /jacuzzi|hot\s*tub/i, roomTypes: ["bathroom", "master_bedroom"], text: "Jacuzzi" },
  { pattern: /(?:rain\s*)?shower/i, roomTypes: ["bathroom"], text: "Rain Shower" },
  { pattern: /terrace\s*garden/i, roomTypes: ["terrace", "balcony"], text: "Terrace Garden" },
  { pattern: /sit[\s-]*out|(?:covered\s*)?verandah/i, roomTypes: ["verandah", "balcony"], text: "Verandah" },

  // ── Cultural / Architectural ──
  { pattern: /tulsi|tulasi/i, roomTypes: ["courtyard", "custom", "balcony"], text: "Tulsi Platform" },
  { pattern: /swing\s*seat/i, roomTypes: ["verandah", "balcony", "living_room"], text: "Swing Seating" },
  { pattern: /pillar/i, roomTypes: ["verandah", "foyer", "living_room"], text: "Pillared" },
  { pattern: /courtyard/i, roomTypes: ["courtyard", "custom"], text: "Open Courtyard" },
  { pattern: /thinnai/i, roomTypes: ["verandah", "custom"], text: "Thinnai" },

  // ── Furniture / Fixtures ──
  { pattern: /grab\s*(?:bar|rail)/i, roomTypes: ["bathroom", "wc", "toilet"], text: "Grab Rails" },
  { pattern: /anti[\s-]*skid/i, roomTypes: ["bathroom", "wc", "toilet"], text: "Anti-Skid Floor" },
  { pattern: /display\s*showcase/i, roomTypes: ["living_room", "dining_room", "custom"], text: "Display Showcase" },
  { pattern: /(?:projector|projection)/i, roomTypes: ["custom", "living_room", "bedroom"], text: "Projector Setup" },
  { pattern: /recliner/i, roomTypes: ["custom", "living_room", "bedroom"], text: "Recliners" },
  { pattern: /dual\s*(?:vanity|basin)/i, roomTypes: ["bathroom", "master_bedroom"], text: "Dual Vanity" },
  { pattern: /breakfast\s*(?:bar|counter|nook)/i, roomTypes: ["kitchen", "dining_room"], text: "Breakfast Bar" },
  { pattern: /exhaust|chimney/i, roomTypes: ["kitchen"], text: "Exhaust/Chimney" },
  { pattern: /cloth\s*dry|drying\s*(?:line|area)/i, roomTypes: ["utility", "balcony", "custom"], text: "Drying Area" },
  { pattern: /study\s*corner|competitive\s*exam/i, roomTypes: ["bedroom", "custom"], text: "Study Corner" },
  { pattern: /gaming\s*setup/i, roomTypes: ["bedroom", "custom"], text: "Gaming Setup" },
  { pattern: /vanity\s*table/i, roomTypes: ["bedroom", "custom"], text: "Vanity Table" },
  { pattern: /tv\s*wall/i, roomTypes: ["living_room", "bedroom", "custom"], text: "TV Wall" },
  { pattern: /photo\s*gallery/i, roomTypes: ["hallway", "custom"], text: "Photo Gallery" },
  { pattern: /toy\s*storage/i, roomTypes: ["bedroom", "custom"], text: "Toy Storage" },
  { pattern: /bathtub|bath\s*tub/i, roomTypes: ["bathroom"], text: "Bathtub" },
  { pattern: /two[\s-]*wheeler/i, roomTypes: ["custom", "parking"], text: "Two-Wheeler" },

  // ── Luxury / Farmhouse Features ──
  { pattern: /wrought\s*iron/i, roomTypes: ["staircase", "balcony", "verandah"], text: "Wrought Iron" },
  { pattern: /clawfoot|claw[\s-]*foot/i, roomTypes: ["bathroom", "master_bedroom"], text: "Clawfoot Tub" },
  { pattern: /surround\s*sound|7[\.\s]*1/i, roomTypes: ["custom", "living_room"], text: "Surround Sound" },
  { pattern: /jhula|jhoola/i, roomTypes: ["verandah", "balcony", "living_room"], text: "Jhula Swing" },
  { pattern: /emergency[\s-]*call|call[\s-]*bell/i, roomTypes: ["bathroom", "bedroom"], text: "Emergency Bell" },
  { pattern: /rosewood/i, roomTypes: ["bedroom", "master_bedroom", "living_room"], text: "Rosewood" },
  { pattern: /bunk\s*bed/i, roomTypes: ["bedroom"], text: "Bunk Bed" },
  { pattern: /window\s*seat/i, roomTypes: ["bedroom", "living_room", "study"], text: "Window Seat" },
  { pattern: /art[\s-]*corner/i, roomTypes: ["bedroom", "custom"], text: "Art Corner" },
  { pattern: /herb\s*garden/i, roomTypes: ["kitchen", "balcony", "custom"], text: "Herb Garden" },
  { pattern: /pergola/i, roomTypes: ["terrace", "balcony", "custom"], text: "Pergola" },
  { pattern: /raised\s*planter/i, roomTypes: ["terrace", "balcony", "custom"], text: "Raised Planters" },
  { pattern: /temperature[\s-]*control/i, roomTypes: ["custom", "kitchen"], text: "Temp Controlled" },
  { pattern: /sound[\s-]*proof/i, roomTypes: ["custom", "bedroom"], text: "Soundproofed" },
  { pattern: /garden\s*view/i, roomTypes: ["bedroom", "living_room", "dining_room"], text: "Garden View" },
  { pattern: /sunset\s*view/i, roomTypes: ["bedroom", "living_room", "balcony"], text: "Sunset View" },
  { pattern: /morning[\s-]*sun/i, roomTypes: ["bedroom", "kitchen", "puja_room"], text: "Morning Sun" },
  { pattern: /sitar|music[\s-]*corner/i, roomTypes: ["bedroom", "custom"], text: "Music Corner" },
  { pattern: /telescope|stargazing/i, roomTypes: ["terrace", "balcony"], text: "Stargazing" },
  { pattern: /hammock/i, roomTypes: ["terrace", "balcony", "verandah"], text: "Hammock" },
  { pattern: /fire[\s-]*pit/i, roomTypes: ["terrace", "custom"], text: "Fire Pit" },
  { pattern: /bbq|barbecue/i, roomTypes: ["terrace", "kitchen", "custom"], text: "BBQ Area" },
];

/**
 * Find a room by looking at prompt context around a keyword match.
 * If a keyword like "grab rails" appears near "parents bedroom", return that room.
 */
function findRoomByPromptContext(
  rooms: Floor["rooms"],
  pattern: RegExp,
  prompt: string,
): Floor["rooms"][number] | null {
  try {
    pattern.lastIndex = 0;
    const match = pattern.exec(prompt);
    if (!match) return null;

    // Extract ~80 chars before the keyword to find the room name
    const contextStart = Math.max(0, match.index - 80);
    const context = prompt.substring(contextStart, match.index + match[0].length + 30);

    // Check which room name appears in this context
    for (const room of rooms) {
      const KEEP_SHORT = new Set(["wc", "ac", "tv", "hob"]);
      const roomWords = room.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 || KEEP_SHORT.has(w));
      if (roomWords.some(w => context.includes(w)) && room.area_sqm >= 3) {
        return room;
      }
    }
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Scan the original prompt for room-specific features and add leader-line annotations.
 * Appears as text labels with leader lines on the floor plan — professional practice.
 */
function generateSmartAnnotations(floor: Floor, prompt: string): void {
  const p = prompt.toLowerCase();

  for (const kw of ANNOTATION_KEYWORDS) {
    if (!kw.pattern.test(p)) continue;

    // Find the best matching room: prefer type match, fall back to name match
    // Skip small rooms (< 4 sqm) to avoid label overlap
    let room = floor.rooms.find(r => kw.roomTypes.includes(r.type) && r.area_sqm >= 4);
    if (!room) {
      // Try matching by room name context — find the room mentioned near this keyword
      room = findRoomByPromptContext(floor.rooms, kw.pattern, p) ?? undefined;
    }
    if (!room) continue;

    // Avoid duplicate annotations
    if (floor.annotations.some(a => a.text === kw.text)) continue;

    // Place annotation near room center with a leader line from the corner
    const labelPos = {
      x: room.label_position.x + 200,
      y: room.label_position.y + 400,
    };
    const leaderStart = room.label_position;
    const leaderEnd = labelPos;

    floor.annotations.push({
      id: genId("ann"),
      type: "leader",
      position: labelPos,
      text: kw.text,
      font_size_mm: 100,
      rotation_deg: 0,
      leader_line: [leaderStart, leaderEnd],
    });
  }
}

// ============================================================
// STAIRCASE GEOMETRY GENERATION
// ============================================================

/**
 * Generate proper Stair objects for staircase rooms.
 * Indian residential standards:
 *   - Floor height: 3000mm
 *   - Riser: 175mm → ~17 risers per flight
 *   - Tread: 250mm
 *   - Width: 1200mm (min residential)
 *   - Half-landing for U-turn
 */
function generateStaircaseGeometry(floor: Floor): void {
  const FLOOR_HEIGHT_MM = floor.floor_to_floor_height_mm || 3000;
  const RISER_HEIGHT = 175;
  const TREAD_DEPTH = 250;
  const STAIR_WIDTH = 1200;
  const numRisers = Math.round(FLOOR_HEIGHT_MM / RISER_HEIGHT);
  const halfRisers = Math.ceil(numRisers / 2);

  const staircaseRooms = floor.rooms.filter(
    r => r.type === "staircase" || r.name.toLowerCase().includes("staircase"),
  );

  for (const room of staircaseRooms) {
    const bounds = room.boundary.points;
    if (bounds.length < 4) continue;

    // Room bounding box
    const xs = bounds.map(p => p.x);
    const ys = bounds.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const roomW = maxX - minX;
    const roomD = maxY - minY;

    // Determine stair orientation (treads along longer dimension)
    const isVertical = roomD > roomW;

    // Generate tread lines
    const treads: Array<{ start: Point; end: Point }> = [];
    const flightLength = halfRisers * TREAD_DEPTH;

    if (isVertical) {
      // Treads are horizontal lines, flight goes up Y
      const x0 = minX + (roomW - STAIR_WIDTH) / 2;
      const x1 = x0 + STAIR_WIDTH;
      const startY = minY + 100; // small margin

      for (let i = 0; i < halfRisers && startY + i * TREAD_DEPTH < maxY - 200; i++) {
        const y = startY + i * TREAD_DEPTH;
        treads.push({ start: { x: x0, y }, end: { x: x1, y } });
      }
    } else {
      // Treads are vertical lines, flight goes along X
      const y0 = minY + (roomD - STAIR_WIDTH) / 2;
      const y1 = y0 + STAIR_WIDTH;
      const startX = minX + 100;

      for (let i = 0; i < halfRisers && startX + i * TREAD_DEPTH < maxX - 200; i++) {
        const x = startX + i * TREAD_DEPTH;
        treads.push({ start: { x, y: y0 }, end: { x, y: y1 } });
      }
    }

    // Direction arrow (start → end of flight)
    const upStart = treads.length > 0 ? treads[0].start : { x: minX, y: minY };
    const upEnd = treads.length > 0 ? treads[treads.length - 1].start : { x: maxX, y: maxY };

    // Landing at mid-point
    const landingDepth = STAIR_WIDTH;

    const stair = {
      id: genId("stair"),
      type: "dog_leg" as const,
      boundary: room.boundary,
      num_risers: numRisers,
      riser_height_mm: RISER_HEIGHT,
      tread_depth_mm: TREAD_DEPTH,
      width_mm: STAIR_WIDTH,
      landing_depth_mm: landingDepth,
      up_direction: { start: upStart, end: upEnd },
      treads,
      has_railing: true,
      railing_side: "both" as const,
      connects_floors: [floor.level, floor.level + 1] as [number, number],
    };

    floor.stairs.push(stair);

    // Add UP/DN annotation
    const labelPos = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
    const label = floor.level === 0 ? "UP" : "DN / UP";

    floor.annotations.push({
      id: genId("ann"),
      type: "text",
      position: labelPos,
      text: label,
      font_size_mm: 120,
      rotation_deg: isVertical ? 0 : 90,
    });
  }
}

// ============================================================
// MULTI-FLOOR CONVERSION
// ============================================================

/** Input shape from layout engine — avoids circular import */
interface PlacedRoomInput {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  area: number;
}

/**
 * Convert a multi-floor layout to a FloorPlanProject with multiple Floor objects.
 * Each floor is converted independently using convertGeometryToProject,
 * then merged into a single project.
 *
 * ADDITIVE: uses existing convertGeometryToProject per floor.
 */
export function convertMultiFloorToProject(
  floorLayouts: Array<{
    level: number;
    rooms: PlacedRoomInput[];
    footprintWidth: number;
    footprintDepth: number;
  }>,
  projectName: string = "AI-Generated Floor Plan",
  originalPrompt?: string,
): FloorPlanProject {
  if (floorLayouts.length === 0) {
    return convertGeometryToProject(
      { footprint: { width: 10, depth: 10 }, wallHeight: 3, walls: [], doors: [], windows: [], rooms: [] },
      projectName,
      originalPrompt,
    );
  }

  const FLOOR_NAMES: Record<number, string> = {
    0: "Ground Floor",
    1: "First Floor",
    2: "Second Floor",
    3: "Third Floor",
  };

  const totalInputRooms = floorLayouts.reduce((s, fl) => s + fl.rooms.length, 0);
  const floors: Floor[] = [];

  for (const fl of floorLayouts) {
    const geometry: FloorPlanGeometry = {
      footprint: { width: fl.footprintWidth, depth: fl.footprintDepth },
      wallHeight: 3.0,
      walls: [],
      doors: [],
      windows: [],
      rooms: fl.rooms.map(r => ({
        name: r.name,
        type: r.type as FloorPlanGeometry["rooms"][number]["type"],
        x: r.x,
        y: r.y,
        width: r.width,
        depth: r.depth,
        center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
        area: r.area,
      })),
    };

    const singleProject = convertGeometryToProject(geometry, projectName, originalPrompt);
    const floor = singleProject.floors[0];

    floor.name = FLOOR_NAMES[fl.level] ?? `Floor ${fl.level}`;
    floor.level = fl.level;

    floors.push(floor);
  }

  // Validate: room count preserved through multi-floor conversion
  const totalOutputRooms = floors.reduce((s, f) => s + f.rooms.length, 0);
  if (totalOutputRooms !== totalInputRooms) {
    console.error(`[STAGE-3] Multi-floor room loss: ${totalInputRooms} → ${totalOutputRooms}`);
  }
  console.log(`[STAGE-3] Rooms in project: ${totalOutputRooms}`, floors.map(f => `Floor ${f.level}: ${f.rooms.map(r => r.name).join(", ")}`));

  // Build unified project with all floors
  const firstGeom = floorLayouts[0];
  const totalCarpet = floorLayouts.reduce(
    (s, fl) => s + fl.rooms.reduce((rs, r) => rs + r.area, 0),
    0,
  );

  return {
    id: genId("proj"),
    name: projectName,
    version: "1.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential",
      building_type: `${floorLayouts.length}-floor layout`,
      num_floors: floorLayouts.length,
      plot_area_sqm: firstGeom.footprintWidth * firstGeom.footprintDepth,
      carpet_area_sqm: totalCarpet,
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
    floors,
  };
}
