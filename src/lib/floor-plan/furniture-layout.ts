/**
 * AI Furniture Auto-Layout
 *
 * Places furniture intelligently based on room type, size, and wall configuration.
 * Follows Indian residential furniture standards.
 */

import type { Floor, Room, Wall, Door, FurnitureInstance, Point, RoomType } from "@/types/floor-plan-cad";
import { polygonBounds, wallLength, lineDirection, addPoints, scalePoint, distance } from "./geometry";

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================
// FURNITURE SET DEFINITIONS (per room type)
// ============================================================

interface FurnitureSpec {
  catalogId: string;
  priority: number;       // Higher = place first
  minRoomArea?: number;   // Skip if room is smaller
  wallPlacement: "anchor" | "opposite" | "adjacent" | "center" | "near-door" | "far-from-door" | "near-window";
  offsetFromWall?: number; // mm from wall face (default: 50)
}

const ROOM_FURNITURE: Partial<Record<RoomType, FurnitureSpec[]>> = {
  master_bedroom: [
    { catalogId: "bed-king",    priority: 10, wallPlacement: "anchor" },
    { catalogId: "nightstand",  priority: 8,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "wardrobe",    priority: 9,  wallPlacement: "opposite" },
    { catalogId: "dresser",     priority: 5,  wallPlacement: "adjacent", minRoomArea: 14 },
    { catalogId: "armchair",    priority: 3,  wallPlacement: "adjacent", minRoomArea: 16 },
  ],
  bedroom: [
    { catalogId: "bed-queen",   priority: 10, wallPlacement: "anchor" },
    { catalogId: "nightstand",  priority: 7,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "wardrobe",    priority: 9,  wallPlacement: "opposite" },
    { catalogId: "desk-study",  priority: 5,  wallPlacement: "adjacent", minRoomArea: 11 },
  ],
  guest_bedroom: [
    { catalogId: "bed-queen",   priority: 10, wallPlacement: "anchor" },
    { catalogId: "nightstand",  priority: 7,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "wardrobe",    priority: 8,  wallPlacement: "opposite" },
  ],
  living_room: [
    { catalogId: "sofa-3seat",  priority: 10, wallPlacement: "anchor" },
    { catalogId: "coffee-table", priority: 9, wallPlacement: "center" },
    { catalogId: "tv-unit",     priority: 8,  wallPlacement: "opposite" },
    { catalogId: "side-table",  priority: 4,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "armchair",    priority: 3,  wallPlacement: "adjacent", minRoomArea: 18 },
    { catalogId: "bookshelf",   priority: 2,  wallPlacement: "adjacent", minRoomArea: 20 },
  ],
  dining_room: [
    { catalogId: "dining-table-6", priority: 10, wallPlacement: "center", minRoomArea: 10 },
    { catalogId: "dining-table-4", priority: 10, wallPlacement: "center" },
  ],
  kitchen: [
    { catalogId: "kitchen-counter", priority: 10, wallPlacement: "anchor" },
    { catalogId: "stove-4burner",   priority: 9,  wallPlacement: "anchor" },
    { catalogId: "sink-kitchen",    priority: 8,  wallPlacement: "near-window" },
    { catalogId: "refrigerator",    priority: 7,  wallPlacement: "adjacent" },
  ],
  study: [
    { catalogId: "desk-study",   priority: 10, wallPlacement: "near-window" },
    { catalogId: "office-chair", priority: 9,  wallPlacement: "center" },
    { catalogId: "bookshelf",    priority: 7,  wallPlacement: "opposite" },
  ],
  home_office: [
    { catalogId: "office-desk",  priority: 10, wallPlacement: "near-window" },
    { catalogId: "office-chair", priority: 9,  wallPlacement: "center" },
    { catalogId: "filing-cabinet", priority: 6, wallPlacement: "adjacent" },
    { catalogId: "bookshelf",    priority: 5,  wallPlacement: "opposite" },
  ],
  bathroom: [
    { catalogId: "toilet",       priority: 10, wallPlacement: "far-from-door" },
    { catalogId: "washbasin",    priority: 9,  wallPlacement: "near-door" },
    { catalogId: "shower-enclosure", priority: 7, wallPlacement: "adjacent", minRoomArea: 3 },
    { catalogId: "bathtub",      priority: 5,  wallPlacement: "opposite", minRoomArea: 4.5 },
  ],
  toilet: [
    { catalogId: "toilet",       priority: 10, wallPlacement: "far-from-door" },
    { catalogId: "washbasin",    priority: 9,  wallPlacement: "near-door" },
  ],
  utility: [
    { catalogId: "washing-machine", priority: 10, wallPlacement: "anchor" },
  ],
};

// ============================================================
// CATALOG DIMENSIONS (simplified — matches furniture-catalog.ts)
// ============================================================

const CATALOG_DIMS: Record<string, { width: number; depth: number }> = {
  "bed-king":        { width: 1950, depth: 2050 },
  "bed-queen":       { width: 1650, depth: 2050 },
  "bed-single":      { width: 1000, depth: 2000 },
  "nightstand":      { width: 500,  depth: 450 },
  "wardrobe":        { width: 1800, depth: 600 },
  "dresser":         { width: 1200, depth: 500 },
  "desk-study":      { width: 1200, depth: 600 },
  "armchair":        { width: 850,  depth: 850 },
  "sofa-3seat":      { width: 2200, depth: 900 },
  "sofa-2seat":      { width: 1600, depth: 900 },
  "coffee-table":    { width: 1200, depth: 600 },
  "tv-unit":         { width: 1800, depth: 450 },
  "side-table":      { width: 500,  depth: 500 },
  "bookshelf":       { width: 1200, depth: 350 },
  "dining-table-6":  { width: 1800, depth: 900 },
  "dining-table-4":  { width: 1200, depth: 800 },
  "dining-table-round": { width: 1100, depth: 1100 },
  "dining-chair":    { width: 450,  depth: 450 },
  "kitchen-counter": { width: 2400, depth: 600 },
  "sink-kitchen":    { width: 800,  depth: 600 },
  "stove-4burner":   { width: 600,  depth: 600 },
  "refrigerator":    { width: 700,  depth: 700 },
  "kitchen-island":  { width: 1500, depth: 800 },
  "toilet":          { width: 400,  depth: 700 },
  "washbasin":       { width: 600,  depth: 450 },
  "bathtub":         { width: 750,  depth: 1700 },
  "shower-enclosure": { width: 900, depth: 900 },
  "vanity-unit":     { width: 900,  depth: 500 },
  "washing-machine": { width: 600,  depth: 600 },
  "office-desk":     { width: 1500, depth: 750 },
  "office-chair":    { width: 550,  depth: 550 },
  "filing-cabinet":  { width: 450,  depth: 600 },
  "conference-table": { width: 2400, depth: 1200 },
  "credenza":        { width: 1500, depth: 450 },
  "microwave-stand": { width: 600,  depth: 450 },
};

// ============================================================
// WALL CLASSIFICATION FOR PLACEMENT
// ============================================================

interface WallInfo {
  wall: Wall;
  length: number;
  hasDoor: boolean;
  hasWindow: boolean;
  side: "top" | "bottom" | "left" | "right";
  midpoint: Point;
}

function classifyRoomWalls(room: Room, floor: Floor): WallInfo[] {
  const roomWallIds = new Set(room.wall_ids);
  const roomWalls = floor.walls.filter(
    (w) => roomWallIds.has(w.id) || w.left_room_id === room.id || w.right_room_id === room.id
  );

  const bounds = polygonBounds(room.boundary.points);
  const cx = bounds.center.x;
  const cy = bounds.center.y;

  return roomWalls.map((wall) => {
    const len = wallLength(wall);
    const mid = {
      x: (wall.centerline.start.x + wall.centerline.end.x) / 2,
      y: (wall.centerline.start.y + wall.centerline.end.y) / 2,
    };

    // Classify wall side relative to room center
    const isHoriz = Math.abs(wall.centerline.start.y - wall.centerline.end.y) <
      Math.abs(wall.centerline.start.x - wall.centerline.end.x);

    let side: WallInfo["side"];
    if (isHoriz) {
      side = mid.y > cy ? "top" : "bottom";
    } else {
      side = mid.x > cx ? "right" : "left";
    }

    const hasDoor = floor.doors.some((d) => d.wall_id === wall.id);
    const hasWindow = floor.windows.some((w) => w.wall_id === wall.id);

    return { wall, length: len, hasDoor, hasWindow, side, midpoint: mid };
  });
}

function findAnchorWall(walls: WallInfo[]): WallInfo | null {
  // Anchor = longest wall without doors
  const candidates = walls.filter((w) => !w.hasDoor);
  if (candidates.length === 0) {
    // Fallback: longest wall overall
    return walls.sort((a, b) => b.length - a.length)[0] ?? null;
  }
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function findOppositeWall(anchor: WallInfo, walls: WallInfo[]): WallInfo | null {
  const oppSide = anchor.side === "top" ? "bottom" : anchor.side === "bottom" ? "top" : anchor.side === "left" ? "right" : "left";
  return walls.find((w) => w.side === oppSide) ?? null;
}

function findAdjacentWall(anchor: WallInfo, walls: WallInfo[], usedSides: Set<string>): WallInfo | null {
  const adjSides = anchor.side === "top" || anchor.side === "bottom" ? ["left", "right"] : ["top", "bottom"];
  return walls.find((w) => adjSides.includes(w.side) && !usedSides.has(w.side)) ?? null;
}

function findWallWithWindow(walls: WallInfo[]): WallInfo | null {
  return walls.find((w) => w.hasWindow) ?? null;
}

function findDoorWall(walls: WallInfo[]): WallInfo | null {
  return walls.find((w) => w.hasDoor) ?? null;
}

// ============================================================
// PLACEMENT ALGORITHM
// ============================================================

export interface FurnitureLayoutResult {
  furniture: FurnitureInstance[];
  issues: PlacementIssue[];
}

interface PlacementIssue {
  severity: "error" | "warning" | "info";
  message: string;
  roomId?: string;
}

/**
 * Auto-furnish a single room.
 */
export function layoutRoomFurniture(room: Room, floor: Floor): FurnitureLayoutResult {
  const specs = ROOM_FURNITURE[room.type];
  if (!specs) return { furniture: [], issues: [] };

  const furniture: FurnitureInstance[] = [];
  const issues: PlacementIssue[] = [];
  const walls = classifyRoomWalls(room, floor);
  const bounds = polygonBounds(room.boundary.points);
  const usedSides = new Set<string>();

  if (walls.length === 0) {
    issues.push({ severity: "warning", message: `No walls found for ${room.name}`, roomId: room.id });
    return { furniture, issues };
  }

  const anchor = findAnchorWall(walls);
  if (!anchor) return { furniture, issues };

  // Sort specs by priority (highest first) and filter by room area
  const applicableSpecs = specs
    .filter((s) => !s.minRoomArea || room.area_sqm >= s.minRoomArea)
    .sort((a, b) => b.priority - a.priority);

  // For dining room: choose table size based on area
  const adjustedSpecs = applicableSpecs.filter((s) => {
    if (room.type === "dining_room") {
      if (s.catalogId === "dining-table-6" && room.area_sqm >= 10) return true;
      if (s.catalogId === "dining-table-4" && room.area_sqm < 10) return true;
      if (s.catalogId === "dining-table-6" && room.area_sqm < 10) return false;
    }
    return true;
  });

  // Track placed rectangles for overlap checking
  const placedRects: Array<{ x: number; y: number; w: number; d: number }> = [];

  for (const spec of adjustedSpecs) {
    const dims = CATALOG_DIMS[spec.catalogId];
    if (!dims) continue;

    const offset = spec.offsetFromWall ?? 50;
    let position: Point | null = null;
    let rotation = 0;

    // Determine target wall based on placement strategy
    let targetWall: WallInfo | null = null;
    switch (spec.wallPlacement) {
      case "anchor":
        targetWall = anchor;
        break;
      case "opposite":
        targetWall = findOppositeWall(anchor, walls);
        break;
      case "adjacent":
        targetWall = findAdjacentWall(anchor, walls, usedSides);
        break;
      case "near-window":
        targetWall = findWallWithWindow(walls) ?? findAdjacentWall(anchor, walls, usedSides);
        break;
      case "near-door":
        targetWall = findDoorWall(walls) ?? anchor;
        break;
      case "far-from-door": {
        const doorWall = findDoorWall(walls);
        if (doorWall) {
          targetWall = findOppositeWall(doorWall, walls) ?? findAdjacentWall(doorWall, walls, usedSides);
        }
        if (!targetWall) targetWall = anchor;
        break;
      }
      case "center":
        // Place in room center
        position = { x: bounds.center.x, y: bounds.center.y };
        break;
    }

    if (!position && targetWall) {
      position = computeWallPosition(targetWall, dims, offset, bounds, placedRects);
      rotation = getRotationForWall(targetWall);
      if (targetWall.side) usedSides.add(targetWall.side);
    }

    if (!position) {
      // Fallback: place in room center area
      position = {
        x: bounds.center.x + (Math.random() - 0.5) * bounds.width * 0.3,
        y: bounds.center.y + (Math.random() - 0.5) * bounds.height * 0.3,
      };
    }

    // Check overlap with already-placed furniture
    const rect = { x: position.x, y: position.y, w: dims.width, d: dims.depth };
    const overlaps = placedRects.some(
      (pr) =>
        Math.abs(rect.x - pr.x) < (rect.w + pr.w) / 2 + 100 &&
        Math.abs(rect.y - pr.y) < (rect.d + pr.d) / 2 + 100
    );

    if (overlaps) continue; // Skip this piece — no room

    placedRects.push(rect);

    furniture.push({
      id: genId("furn"),
      catalog_id: spec.catalogId,
      position,
      rotation_deg: rotation,
      scale: 1,
      room_id: room.id,
      locked: false,
    });
  }

  // Verify clearance to doors (minimum 600mm passage)
  for (const fi of furniture) {
    const dims = CATALOG_DIMS[fi.catalog_id];
    if (!dims) continue;

    for (const door of floor.doors) {
      const wall = floor.walls.find((w) => w.id === door.wall_id);
      if (!wall) continue;

      const dir = lineDirection(wall.centerline);
      const doorCenter = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm + door.width_mm / 2));
      const dist = distance(fi.position, doorCenter);

      if (dist < 600 + Math.max(dims.width, dims.depth) / 2) {
        issues.push({
          severity: "warning",
          message: `Furniture near door in ${room.name} — may block passage`,
          roomId: room.id,
        });
        break;
      }
    }
  }

  return { furniture, issues };
}

/**
 * Auto-furnish all rooms in a floor.
 */
export function layoutAllFurniture(floor: Floor): FurnitureLayoutResult {
  const allFurniture: FurnitureInstance[] = [];
  const allIssues: PlacementIssue[] = [];

  for (const room of floor.rooms) {
    const result = layoutRoomFurniture(room, floor);
    allFurniture.push(...result.furniture);
    allIssues.push(...result.issues);
  }

  return { furniture: allFurniture, issues: allIssues };
}

// ============================================================
// POSITION HELPERS
// ============================================================

function computeWallPosition(
  wallInfo: WallInfo,
  dims: { width: number; depth: number },
  offset: number,
  roomBounds: ReturnType<typeof polygonBounds>,
  placed: Array<{ x: number; y: number; w: number; d: number }>,
): Point | null {
  const wall = wallInfo.wall;
  const dir = lineDirection(wall.centerline);
  const mid = wallInfo.midpoint;

  // Place centered along wall, offset perpendicular toward room center
  const toCenter = {
    x: roomBounds.center.x - mid.x,
    y: roomBounds.center.y - mid.y,
  };
  const dist = Math.sqrt(toCenter.x * toCenter.x + toCenter.y * toCenter.y);
  const normToCenter = dist > 0 ? { x: toCenter.x / dist, y: toCenter.y / dist } : { x: 0, y: 1 };

  const perpOffset = offset + dims.depth / 2;
  return {
    x: mid.x + normToCenter.x * perpOffset,
    y: mid.y + normToCenter.y * perpOffset,
  };
}

function getRotationForWall(wallInfo: WallInfo): number {
  switch (wallInfo.side) {
    case "top": return 180;
    case "bottom": return 0;
    case "left": return 90;
    case "right": return 270;
    default: return 0;
  }
}
