/**
 * Hit Detection for Floor Plan Interactive Editing
 *
 * Determines which entity the user clicked on.
 * Priority: furniture > door/window > wall > room
 */

import type { Point, Floor, Wall, Door, CadWindow, Room, FurnitureInstance } from "@/types/floor-plan-cad";
import {
  wallToRectangle,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  distance,
  midpoint,
  wallLength,
} from "@/lib/floor-plan/geometry";
import { getCatalogItem } from "@/lib/floor-plan/furniture-catalog";

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface HitResult {
  entityType: "wall" | "door" | "window" | "room" | "furniture";
  entityId: string;
}

export interface WallProjection {
  wall: Wall;
  positionAlongWall_mm: number;
  distanceFromWall_mm: number;
  projectedPoint: Point;
}

// ============================================================
// MAIN HIT TEST
// ============================================================

/**
 * Returns the topmost entity under the given world point.
 * Tests in priority order: furniture > door > window > wall > room.
 */
export function hitTest(
  worldPoint: Point,
  floor: Floor,
  tolerance_mm: number = 150
): HitResult | null {
  // Test furniture (highest priority — small targets on top)
  for (const furn of floor.furniture) {
    if (pointInFurniture(worldPoint, furn)) {
      return { entityType: "furniture", entityId: furn.id };
    }
  }

  // Test doors (small targets, high priority)
  for (const door of floor.doors) {
    const wall = floor.walls.find((w) => w.id === door.wall_id);
    if (!wall) continue;
    if (pointNearDoor(worldPoint, door, wall, tolerance_mm)) {
      return { entityType: "door", entityId: door.id };
    }
  }

  // Test windows
  for (const win of floor.windows) {
    const wall = floor.walls.find((w) => w.id === win.wall_id);
    if (!wall) continue;
    if (pointNearWindow(worldPoint, win, wall, tolerance_mm)) {
      return { entityType: "window", entityId: win.id };
    }
  }

  // Test walls
  for (const wall of floor.walls) {
    if (pointInWallRect(worldPoint, wall, tolerance_mm * 0.5)) {
      return { entityType: "wall", entityId: wall.id };
    }
  }

  // Test rooms
  for (const room of floor.rooms) {
    if (pointInPolygon(worldPoint, room.boundary.points)) {
      return { entityType: "room", entityId: room.id };
    }
  }

  return null;
}

// ============================================================
// POINT-IN-POLYGON (Ray casting)
// ============================================================

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============================================================
// WALL HIT TEST
// ============================================================

function pointInWallRect(point: Point, wall: Wall, tolerance_mm: number): boolean {
  const corners = wallToRectangle(wall);
  // Expand the rectangle by tolerance
  const expanded = expandPolygon(corners, tolerance_mm);
  return pointInPolygon(point, expanded);
}

function expandPolygon(points: Point[], amount: number): Point[] {
  // Simple expansion: move each point outward from centroid
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return p;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  });
}

// ============================================================
// DOOR / WINDOW HIT TEST
// ============================================================

function pointNearDoor(point: Point, door: Door, wall: Wall, tolerance: number): boolean {
  const bbox = getOpeningBBox(wall, door.position_along_wall_mm, door.width_mm, tolerance);
  return pointInPolygon(point, bbox);
}

function pointNearWindow(point: Point, win: CadWindow, wall: Wall, tolerance: number): boolean {
  const bbox = getOpeningBBox(wall, win.position_along_wall_mm, win.width_mm, tolerance);
  return pointInPolygon(point, bbox);
}

function getOpeningBBox(
  wall: Wall,
  posAlongWall: number,
  width: number,
  tolerance: number
): Point[] {
  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2 + tolerance;

  const start = addPoints(wall.centerline.start, scalePoint(dir, posAlongWall - tolerance));
  const end = addPoints(wall.centerline.start, scalePoint(dir, posAlongWall + width + tolerance));

  return [
    addPoints(start, scalePoint(norm, halfT)),
    addPoints(end, scalePoint(norm, halfT)),
    addPoints(end, scalePoint(norm, -halfT)),
    addPoints(start, scalePoint(norm, -halfT)),
  ];
}

// ============================================================
// WALL PROJECTION (for door/window placement)
// ============================================================

/**
 * Projects a world point onto a wall's centerline.
 * Returns position along wall and perpendicular distance.
 */
export function projectOntoWall(point: Point, wall: Wall): WallProjection {
  const s = wall.centerline.start;
  const e = wall.centerline.end;
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return {
      wall,
      positionAlongWall_mm: 0,
      distanceFromWall_mm: distance(point, s),
      projectedPoint: { ...s },
    };
  }

  const t = Math.max(0, Math.min(1, ((point.x - s.x) * dx + (point.y - s.y) * dy) / lenSq));
  const projX = s.x + t * dx;
  const projY = s.y + t * dy;
  const projectedPoint = { x: projX, y: projY };
  const distFromWall = distance(point, projectedPoint);
  const posAlongWall = t * Math.sqrt(lenSq);

  return {
    wall,
    positionAlongWall_mm: posAlongWall,
    distanceFromWall_mm: distFromWall,
    projectedPoint,
  };
}

/**
 * Finds the nearest wall to a point (for door/window ghost placement).
 * Returns null if no wall is within maxDistance_mm.
 */
export function findNearestWall(
  point: Point,
  walls: Wall[],
  maxDistance_mm: number = 500
): WallProjection | null {
  let best: WallProjection | null = null;

  for (const wall of walls) {
    const proj = projectOntoWall(point, wall);
    if (proj.distanceFromWall_mm <= maxDistance_mm) {
      if (!best || proj.distanceFromWall_mm < best.distanceFromWall_mm) {
        best = proj;
      }
    }
  }

  return best;
}

// ============================================================
// HANDLE HIT TEST
// ============================================================

export type HandleType =
  | "wall-endpoint-start"
  | "wall-endpoint-end"
  | "wall-midpoint"
  | "door-slide"
  | "window-slide";

export interface HandleHit {
  type: HandleType;
  entityId: string;
  worldPosition: Point;
}

/**
 * Tests if a screen-space click hits any selection handle.
 * Handles are 10px radius on screen.
 */
export function hitTestHandles(
  worldPoint: Point,
  selectedIds: string[],
  floor: Floor,
  hitRadius_mm: number
): HandleHit | null {
  for (const id of selectedIds) {
    // Wall handles
    const wall = floor.walls.find((w) => w.id === id);
    if (wall) {
      // Endpoint start
      if (distance(worldPoint, wall.centerline.start) < hitRadius_mm) {
        return { type: "wall-endpoint-start", entityId: id, worldPosition: wall.centerline.start };
      }
      // Endpoint end
      if (distance(worldPoint, wall.centerline.end) < hitRadius_mm) {
        return { type: "wall-endpoint-end", entityId: id, worldPosition: wall.centerline.end };
      }
      // Midpoint (center of centerline)
      const mid = midpoint(wall.centerline.start, wall.centerline.end);
      if (distance(worldPoint, mid) < hitRadius_mm) {
        return { type: "wall-midpoint", entityId: id, worldPosition: mid };
      }
    }

    // Door handle (center of door along wall)
    const door = floor.doors.find((d) => d.id === id);
    if (door) {
      const dWall = floor.walls.find((w) => w.id === door.wall_id);
      if (dWall) {
        const dir = lineDirection(dWall.centerline);
        const center = addPoints(
          dWall.centerline.start,
          scalePoint(dir, door.position_along_wall_mm + door.width_mm / 2)
        );
        if (distance(worldPoint, center) < hitRadius_mm) {
          return { type: "door-slide", entityId: id, worldPosition: center };
        }
      }
    }

    // Window handle
    const win = floor.windows.find((w) => w.id === id);
    if (win) {
      const wWall = floor.walls.find((w) => w.id === win.wall_id);
      if (wWall) {
        const dir = lineDirection(wWall.centerline);
        const center = addPoints(
          wWall.centerline.start,
          scalePoint(dir, win.position_along_wall_mm + win.width_mm / 2)
        );
        if (distance(worldPoint, center) < hitRadius_mm) {
          return { type: "window-slide", entityId: id, worldPosition: center };
        }
      }
    }
  }

  return null;
}

// ============================================================
// RUBBER BAND SELECTION
// ============================================================

/**
 * Returns IDs of all entities whose bounding box intersects the rubber band rectangle.
 */
export function rubberBandSelect(
  start: Point,
  end: Point,
  floor: Floor
): string[] {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const ids: string[] = [];

  // Walls
  for (const wall of floor.walls) {
    const corners = wallToRectangle(wall);
    if (polygonIntersectsRect(corners, minX, minY, maxX, maxY)) {
      ids.push(wall.id);
    }
  }

  // Doors
  for (const door of floor.doors) {
    const wall = floor.walls.find((w) => w.id === door.wall_id);
    if (!wall) continue;
    const bbox = getOpeningBBox(wall, door.position_along_wall_mm, door.width_mm, 0);
    if (polygonIntersectsRect(bbox, minX, minY, maxX, maxY)) {
      ids.push(door.id);
    }
  }

  // Windows
  for (const win of floor.windows) {
    const wall = floor.walls.find((w) => w.id === win.wall_id);
    if (!wall) continue;
    const bbox = getOpeningBBox(wall, win.position_along_wall_mm, win.width_mm, 0);
    if (polygonIntersectsRect(bbox, minX, minY, maxX, maxY)) {
      ids.push(win.id);
    }
  }

  // Furniture
  for (const furn of floor.furniture) {
    const bb = furnitureBBox(furn);
    if (bb && bb.min.x <= maxX && bb.max.x >= minX && bb.min.y <= maxY && bb.max.y >= minY) {
      ids.push(furn.id);
    }
  }

  return ids;
}

function polygonIntersectsRect(
  polygon: Point[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  // Check if any polygon vertex is inside rect
  for (const p of polygon) {
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return true;
  }
  // Check if any rect corner is inside polygon
  const rectCorners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  for (const c of rectCorners) {
    if (pointInPolygon(c, polygon)) return true;
  }
  return false;
}

// ============================================================
// FURNITURE HIT TEST
// ============================================================

function pointInFurniture(point: Point, instance: FurnitureInstance): boolean {
  const catalog = getCatalogItem(instance.catalog_id);
  if (!catalog) return false;

  // Transform point into furniture local space (undo position + rotation)
  const dx = point.x - instance.position.x;
  const dy = point.y - instance.position.y;
  const rad = (-instance.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = (dx * cos - dy * sin) / instance.scale;
  const localY = (dx * sin + dy * cos) / instance.scale;

  // Simple AABB check in local space
  return localX >= 0 && localX <= catalog.width_mm && localY >= 0 && localY <= catalog.depth_mm;
}

export function furnitureBBox(instance: FurnitureInstance): { min: Point; max: Point } | null {
  const catalog = getCatalogItem(instance.catalog_id);
  if (!catalog) return null;
  const w = catalog.width_mm * instance.scale;
  const d = catalog.depth_mm * instance.scale;
  const ox = instance.position.x;
  const oy = instance.position.y;
  const rad = (instance.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Compute all 4 rotated corners and find AABB
  const localCorners: [number, number][] = [[0, 0], [w, 0], [w, d], [0, d]];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lx, ly] of localCorners) {
    const rx = ox + lx * cos - ly * sin;
    const ry = oy + lx * sin + ly * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// ============================================================
// CONNECTED WALLS
// ============================================================

/**
 * Finds walls connected to a given wall (sharing endpoints within tolerance).
 */
export function findConnectedWalls(
  wall: Wall,
  allWalls: Wall[],
  tolerance: number = 50
): Array<{ wall: Wall; sharedEndpoint: "start" | "end"; matchedEndpoint: "start" | "end" }> {
  const result: Array<{ wall: Wall; sharedEndpoint: "start" | "end"; matchedEndpoint: "start" | "end" }> = [];

  for (const other of allWalls) {
    if (other.id === wall.id) continue;

    // Check all 4 endpoint pairings
    if (distance(wall.centerline.start, other.centerline.start) < tolerance) {
      result.push({ wall: other, sharedEndpoint: "start", matchedEndpoint: "start" });
    } else if (distance(wall.centerline.start, other.centerline.end) < tolerance) {
      result.push({ wall: other, sharedEndpoint: "start", matchedEndpoint: "end" });
    } else if (distance(wall.centerline.end, other.centerline.start) < tolerance) {
      result.push({ wall: other, sharedEndpoint: "end", matchedEndpoint: "start" });
    } else if (distance(wall.centerline.end, other.centerline.end) < tolerance) {
      result.push({ wall: other, sharedEndpoint: "end", matchedEndpoint: "end" });
    }
  }

  return result;
}
