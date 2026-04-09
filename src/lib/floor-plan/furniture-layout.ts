/**
 * AI Furniture Auto-Layout
 *
 * Places furniture intelligently based on room type, size, and wall configuration.
 * Follows Indian residential furniture standards.
 */

import type { Floor, Room, Wall, Door, FurnitureInstance, Point, RoomType } from "@/types/floor-plan-cad";
import { wallLength, lineDirection, addPoints, scalePoint } from "@/lib/floor-plan/geometry";
import { getCatalogItem } from "@/lib/floor-plan/furniture-catalog";

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

/** Select bed size based on room area */
function selectBedCatalogId(roomType: RoomType, areaSqm: number): string {
  if (roomType === "master_bedroom") {
    return areaSqm >= 14 ? "bed-king" : "bed-queen";
  }
  if (areaSqm < 10) return "bed-single";
  if (areaSqm < 14) return "bed-queen";
  return "bed-queen";
}

const ROOM_FURNITURE: Partial<Record<RoomType, FurnitureSpec[]>> = {
  master_bedroom: [
    { catalogId: "bed-king",    priority: 10, wallPlacement: "anchor" }, // swapped adaptively below
    { catalogId: "nightstand",  priority: 8,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "wardrobe",    priority: 9,  wallPlacement: "opposite" },
    { catalogId: "dresser",     priority: 5,  wallPlacement: "adjacent", minRoomArea: 14 },
    { catalogId: "armchair",    priority: 3,  wallPlacement: "adjacent", minRoomArea: 16 },
  ],
  bedroom: [
    { catalogId: "bed-queen",   priority: 10, wallPlacement: "anchor" }, // swapped adaptively below
    { catalogId: "nightstand",  priority: 7,  wallPlacement: "anchor", offsetFromWall: 0 },
    { catalogId: "wardrobe",    priority: 9,  wallPlacement: "opposite" },
    { catalogId: "desk-study",  priority: 5,  wallPlacement: "adjacent", minRoomArea: 11 },
  ],
  guest_bedroom: [
    { catalogId: "bed-queen",   priority: 10, wallPlacement: "anchor" }, // swapped adaptively below
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
  // ── NEW ROOM TYPES — Indian homes ──
  puja_room: [
    { catalogId: "puja-mandir", priority: 10, wallPlacement: "anchor" },
    { catalogId: "diya-stand", priority: 5,  wallPlacement: "adjacent" },
  ],
  servant_quarter: [
    { catalogId: "bed-single",    priority: 10, wallPlacement: "anchor" },
    { catalogId: "small-cupboard", priority: 7,  wallPlacement: "opposite" },
  ],
  balcony: [
    { catalogId: "outdoor-chair", priority: 10, wallPlacement: "near-window" },
    { catalogId: "planter",       priority: 5,  wallPlacement: "adjacent" },
  ],
  terrace: [
    { catalogId: "outdoor-chair", priority: 10, wallPlacement: "anchor" },
    { catalogId: "planter",       priority: 5,  wallPlacement: "adjacent" },
  ],
  verandah: [
    { catalogId: "outdoor-chair", priority: 10, wallPlacement: "anchor" },
    { catalogId: "planter",       priority: 5,  wallPlacement: "adjacent" },
  ],
  foyer: [
    { catalogId: "shoe-cabinet",  priority: 10, wallPlacement: "anchor" },
    { catalogId: "console-table", priority: 5,  wallPlacement: "opposite" },
  ],
  lobby: [
    { catalogId: "console-table", priority: 10, wallPlacement: "anchor" },
  ],
  store_room: [
    { catalogId: "storage-shelf", priority: 10, wallPlacement: "anchor" },
  ],
  pantry: [
    { catalogId: "kitchen-counter", priority: 10, wallPlacement: "anchor" },
    { catalogId: "refrigerator",    priority: 7,  wallPlacement: "adjacent" },
  ],
  laundry: [
    { catalogId: "washing-machine", priority: 10, wallPlacement: "anchor" },
    { catalogId: "clothes-rack",    priority: 5,  wallPlacement: "opposite" },
  ],
  walk_in_closet: [
    { catalogId: "wardrobe",    priority: 10, wallPlacement: "anchor" },
    { catalogId: "dresser",     priority: 5,  wallPlacement: "opposite" },
  ],
  dressing_room: [
    { catalogId: "dresser",     priority: 10, wallPlacement: "anchor" },
    { catalogId: "wardrobe",    priority: 7,  wallPlacement: "opposite" },
  ],
  parking: [
    { catalogId: "car-outline", priority: 10, wallPlacement: "center", minRoomArea: 12 },
  ],
  garage: [
    { catalogId: "car-outline", priority: 10, wallPlacement: "center", minRoomArea: 12 },
  ],
};

// ============================================================
// CATALOG DIMENSIONS — sourced from furniture-catalog.ts (single source of truth)
// ============================================================

function getCatalogDims(catalogId: string): { width: number; depth: number } {
  const item = getCatalogItem(catalogId);
  if (item) return { width: item.width_mm, depth: item.depth_mm };
  // Fallback for unknown items
  return { width: 600, depth: 600 };
}

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

  const pts = room.boundary.points;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

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
 * Compute room interior bounds (inset from boundary to avoid wall overlap).
 * Returns minX, maxX, minY, maxY in mm.
 */
function getRoomInterior(room: Room, wallInset: number = 100): {
  minX: number; maxX: number; minY: number; maxY: number;
  cx: number; cy: number; w: number; h: number;
} {
  const pts = room.boundary.points;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs) + wallInset;
  const maxX = Math.max(...xs) - wallInset;
  const minY = Math.min(...ys) + wallInset;
  const maxY = Math.max(...ys) - wallInset;
  return {
    minX, maxX, minY, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    w: maxX - minX, h: maxY - minY,
  };
}

/**
 * Build door swing zones — quarter-circle arcs that must stay clear.
 * Returns array of {x, y, radius} circles to keep free.
 */
function getDoorSwingZones(room: Room, floor: Floor): Array<{ x: number; y: number; radius: number }> {
  const zones: Array<{ x: number; y: number; radius: number }> = [];
  for (const door of floor.doors) {
    const wall = floor.walls.find(w => w.id === door.wall_id);
    if (!wall) continue;
    // Only care about doors touching this room
    if (wall.left_room_id !== room.id && wall.right_room_id !== room.id) continue;

    const dir = lineDirection(wall.centerline);
    const doorCenter = addPoints(
      wall.centerline.start,
      scalePoint(dir, door.position_along_wall_mm + door.width_mm / 2),
    );
    zones.push({ x: doorCenter.x, y: doorCenter.y, radius: door.width_mm + 200 });
  }
  return zones;
}

/**
 * Check if a furniture bounding box is fully inside the room interior.
 */
function isInsideRoom(
  pos: Point, w: number, d: number, rotation: number,
  interior: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  // Swap w/d for 90° or 270° rotation
  const isRotated = rotation === 90 || rotation === 270;
  const hw = (isRotated ? d : w) / 2;
  const hd = (isRotated ? w : d) / 2;

  return (
    pos.x - hw >= interior.minX &&
    pos.x + hw <= interior.maxX &&
    pos.y - hd >= interior.minY &&
    pos.y + hd <= interior.maxY
  );
}

/**
 * Clamp a furniture position to stay inside the room interior.
 */
function clampToRoom(
  pos: Point, w: number, d: number, rotation: number,
  interior: { minX: number; maxX: number; minY: number; maxY: number },
): Point {
  const isRotated = rotation === 90 || rotation === 270;
  const hw = (isRotated ? d : w) / 2;
  const hd = (isRotated ? w : d) / 2;

  return {
    x: Math.max(interior.minX + hw, Math.min(interior.maxX - hw, pos.x)),
    y: Math.max(interior.minY + hd, Math.min(interior.maxY - hd, pos.y)),
  };
}

/**
 * Check if a position conflicts with any door swing zone.
 */
function inDoorSwingZone(
  pos: Point, w: number, d: number, rotation: number,
  swingZones: Array<{ x: number; y: number; radius: number }>,
): boolean {
  const isRotated = rotation === 90 || rotation === 270;
  const hw = (isRotated ? d : w) / 2;
  const hd = (isRotated ? w : d) / 2;

  for (const zone of swingZones) {
    // Closest point on furniture rect to the swing center
    const closestX = Math.max(pos.x - hw, Math.min(pos.x + hw, zone.x));
    const closestY = Math.max(pos.y - hd, Math.min(pos.y + hd, zone.y));
    const dx = closestX - zone.x;
    const dy = closestY - zone.y;
    if (dx * dx + dy * dy < zone.radius * zone.radius) return true;
  }
  return false;
}

/**
 * Try placing furniture along a wall with slide attempts.
 * Returns position + rotation, or null if can't fit.
 */
function tryPlaceOnWall(
  wallInfo: WallInfo,
  dims: { width: number; depth: number },
  offset: number,
  interior: { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number },
  placedRects: Array<{ x: number; y: number; w: number; d: number }>,
  swingZones: Array<{ x: number; y: number; radius: number }>,
): { position: Point; rotation: number } | null {
  const rotation = getRotationForWall(wallInfo);
  const isRotated = rotation === 90 || rotation === 270;
  const fw = isRotated ? dims.depth : dims.width;
  const fd = isRotated ? dims.width : dims.depth;

  // Wall-side determines placement axis
  const wallSide = wallInfo.side;
  let fixedAxis: "x" | "y";
  let fixedValue: number;
  let slideMin: number;
  let slideMax: number;

  if (wallSide === "bottom") {
    fixedAxis = "y"; fixedValue = interior.minY + fd / 2 + offset;
    slideMin = interior.minX + fw / 2; slideMax = interior.maxX - fw / 2;
  } else if (wallSide === "top") {
    fixedAxis = "y"; fixedValue = interior.maxY - fd / 2 - offset;
    slideMin = interior.minX + fw / 2; slideMax = interior.maxX - fw / 2;
  } else if (wallSide === "left") {
    fixedAxis = "x"; fixedValue = interior.minX + fd / 2 + offset;
    slideMin = interior.minY + fw / 2; slideMax = interior.maxY - fw / 2;
  } else {
    fixedAxis = "x"; fixedValue = interior.maxX - fd / 2 - offset;
    slideMin = interior.minY + fw / 2; slideMax = interior.maxY - fw / 2;
  }

  if (slideMin > slideMax) return null; // Room too small for this item

  // Try 5 positions along wall: center, then offset left/right
  const center = (slideMin + slideMax) / 2;
  const step = (slideMax - slideMin) / 4;
  const candidates = [center, center - step, center + step, slideMin + fw / 2, slideMax - fw / 2];

  for (const slidePos of candidates) {
    if (slidePos < slideMin || slidePos > slideMax) continue;

    const pos: Point = fixedAxis === "y"
      ? { x: slidePos, y: fixedValue }
      : { x: fixedValue, y: slidePos };

    // Check room boundary
    if (!isInsideRoom(pos, dims.width, dims.depth, rotation, interior)) continue;

    // Check door swing zones
    if (inDoorSwingZone(pos, dims.width, dims.depth, rotation, swingZones)) continue;

    // Check overlap with placed furniture (200mm clearance)
    const overlaps = placedRects.some(pr =>
      Math.abs(pos.x - pr.x) < (fw + pr.w) / 2 + 200 &&
      Math.abs(pos.y - pr.y) < (fd + pr.d) / 2 + 200
    );
    if (overlaps) continue;

    return { position: pos, rotation };
  }

  return null; // Can't fit on this wall
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
  const interior = getRoomInterior(room, 100);
  const swingZones = getDoorSwingZones(room, floor);
  const usedSides = new Set<string>();

  if (walls.length === 0 || interior.w < 600 || interior.h < 600) {
    return { furniture, issues };
  }

  const anchor = findAnchorWall(walls);
  if (!anchor) return { furniture, issues };

  // Sort specs by priority (highest first) and filter by room area
  const applicableSpecs = specs
    .filter((s) => !s.minRoomArea || room.area_sqm >= s.minRoomArea)
    .sort((a, b) => b.priority - a.priority);

  // Adaptive furniture selection based on room area
  const adjustedSpecs = applicableSpecs
    .map((s) => {
      // Adapt bed size to room area
      if (s.catalogId.startsWith("bed-")) {
        return { ...s, catalogId: selectBedCatalogId(room.type, room.area_sqm) };
      }
      // For living room: use 2-seat sofa in small rooms
      if (room.type === "living_room" && s.catalogId === "sofa-3seat" && room.area_sqm < 15) {
        return { ...s, catalogId: "sofa-2seat" };
      }
      return s;
    })
    .filter((s) => {
      // For dining room: choose table size based on area
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
    const dims = getCatalogDims(spec.catalogId);
    if (!dims) continue;

    // Skip if furniture larger than room interior
    if (dims.width > interior.w + 100 && dims.depth > interior.h + 100) continue;
    if (dims.depth > interior.w + 100 && dims.width > interior.h + 100) continue;

    const offset = spec.offsetFromWall ?? 50;
    let placed = false;

    if (spec.wallPlacement === "center") {
      // Center placement — try room center, avoiding door swings
      const pos: Point = { x: interior.cx, y: interior.cy };
      const clamped = clampToRoom(pos, dims.width, dims.depth, 0, interior);
      if (!inDoorSwingZone(clamped, dims.width, dims.depth, 0, swingZones)) {
        const overlaps = placedRects.some(pr =>
          Math.abs(clamped.x - pr.x) < (dims.width + pr.w) / 2 + 200 &&
          Math.abs(clamped.y - pr.y) < (dims.depth + pr.d) / 2 + 200
        );
        if (!overlaps) {
          placedRects.push({ x: clamped.x, y: clamped.y, w: dims.width, d: dims.depth });
          furniture.push({
            id: genId("furn"), catalog_id: spec.catalogId,
            position: clamped, rotation_deg: 0, scale: 1, room_id: room.id, locked: false,
          });
          placed = true;
        }
      }
    } else {
      // Wall-based placement — determine target wall(s), try each
      const targetWalls: WallInfo[] = [];
      switch (spec.wallPlacement) {
        case "anchor":
          if (anchor) targetWalls.push(anchor);
          break;
        case "opposite":
          { const opp = findOppositeWall(anchor, walls); if (opp) targetWalls.push(opp); }
          break;
        case "adjacent":
          { const adj = findAdjacentWall(anchor, walls, usedSides); if (adj) targetWalls.push(adj); }
          // Fallback to other adjacent
          { const adj2 = findAdjacentWall(anchor, walls, new Set()); if (adj2 && !targetWalls.includes(adj2)) targetWalls.push(adj2); }
          break;
        case "near-window":
          { const ww = findWallWithWindow(walls); if (ww) targetWalls.push(ww); }
          { const adj = findAdjacentWall(anchor, walls, usedSides); if (adj && !targetWalls.includes(adj)) targetWalls.push(adj); }
          break;
        case "near-door":
          { const dw = findDoorWall(walls); if (dw) targetWalls.push(dw); }
          if (anchor && !targetWalls.includes(anchor)) targetWalls.push(anchor);
          break;
        case "far-from-door": {
          const doorWall = findDoorWall(walls);
          if (doorWall) {
            const opp = findOppositeWall(doorWall, walls);
            if (opp) targetWalls.push(opp);
            const adj = findAdjacentWall(doorWall, walls, usedSides);
            if (adj && !targetWalls.includes(adj)) targetWalls.push(adj);
          }
          if (anchor && !targetWalls.includes(anchor)) targetWalls.push(anchor);
          break;
        }
      }

      // Try each target wall in order
      for (const tw of targetWalls) {
        const result = tryPlaceOnWall(tw, dims, offset, interior, placedRects, swingZones);
        if (result) {
          placedRects.push({
            x: result.position.x, y: result.position.y,
            w: (result.rotation === 90 || result.rotation === 270) ? dims.depth : dims.width,
            d: (result.rotation === 90 || result.rotation === 270) ? dims.width : dims.depth,
          });
          furniture.push({
            id: genId("furn"), catalog_id: spec.catalogId,
            position: result.position, rotation_deg: result.rotation,
            scale: 1, room_id: room.id, locked: false,
          });
          if (tw.side) usedSides.add(tw.side);
          placed = true;
          break;
        }
      }
    }

    // If wall placement failed, try all walls as last resort
    if (!placed && spec.wallPlacement !== "center") {
      for (const w of walls) {
        if (placedRects.length > 0 && w === anchor) continue; // already tried
        const result = tryPlaceOnWall(w, dims, offset, interior, placedRects, swingZones);
        if (result) {
          placedRects.push({
            x: result.position.x, y: result.position.y,
            w: (result.rotation === 90 || result.rotation === 270) ? dims.depth : dims.width,
            d: (result.rotation === 90 || result.rotation === 270) ? dims.width : dims.depth,
          });
          furniture.push({
            id: genId("furn"), catalog_id: spec.catalogId,
            position: result.position, rotation_deg: result.rotation,
            scale: 1, room_id: room.id, locked: false,
          });
          break;
        }
      }
    }
    // If still can't place: skip silently (better no furniture than clipped furniture)
  }

  // ── Post-placement validation ──
  // Remove any furniture that ended up in a door swing zone, outside room,
  // or overlapping another placed item.
  const validated: FurnitureInstance[] = [];
  const validatedRects: Array<{ x: number; y: number; w: number; d: number }> = [];

  for (const fi of furniture) {
    const dims = getCatalogDims(fi.catalog_id);
    if (!dims) { validated.push(fi); continue; }

    // Final room boundary check
    if (!isInsideRoom(fi.position, dims.width, dims.depth, fi.rotation_deg, interior)) {
      fi.position = clampToRoom(fi.position, dims.width, dims.depth, fi.rotation_deg, interior);
    }

    // Final door swing check — remove if blocking
    if (inDoorSwingZone(fi.position, dims.width, dims.depth, fi.rotation_deg, swingZones)) {
      issues.push({ severity: "info", message: `Removed ${fi.catalog_id} in ${room.name} — blocks door swing`, roomId: room.id });
      continue;
    }

    // Final furniture-to-furniture overlap check (50mm tolerance)
    const fw = fi.rotation_deg === 90 || fi.rotation_deg === 270 ? dims.depth : dims.width;
    const fd = fi.rotation_deg === 90 || fi.rotation_deg === 270 ? dims.width : dims.depth;
    const overlapsExisting = validatedRects.some(pr =>
      Math.abs(fi.position.x - pr.x) < (fw + pr.w) / 2 + 50 &&
      Math.abs(fi.position.y - pr.y) < (fd + pr.d) / 2 + 50
    );
    if (overlapsExisting) {
      issues.push({ severity: "info", message: `Removed ${fi.catalog_id} in ${room.name} — overlaps another item`, roomId: room.id });
      continue;
    }

    validatedRects.push({ x: fi.position.x, y: fi.position.y, w: fw, d: fd });
    validated.push(fi);
  }

  return { furniture: validated, issues };
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
// ROTATION HELPER
// ============================================================

function getRotationForWall(wallInfo: WallInfo): number {
  switch (wallInfo.side) {
    case "top": return 180;
    case "bottom": return 0;
    case "left": return 90;
    case "right": return 270;
    default: return 0;
  }
}
