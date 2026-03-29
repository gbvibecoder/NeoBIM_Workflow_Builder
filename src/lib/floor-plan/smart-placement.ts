/**
 * Smart Door & Window Placement — AI-powered architectural placement
 *
 * Follows Indian architectural practice:
 * - Doors placed based on room adjacency graph + architectural connection rules
 * - Windows placed only on exterior walls, sized per IS:1038 / NBC 2016
 * - Both functions usable from pipeline OR as toolbar "Auto-place" actions
 */

import type {
  Floor, Wall, Room, Door, CadWindow, Point, RoomType,
} from "@/types/floor-plan-cad";
import {
  wallLength, lineDirection, perpendicularLeft, addPoints, scalePoint,
  polygonBounds, polygonCentroid, wallAngle,
} from "./geometry";

// ============================================================
// ID GENERATOR
// ============================================================

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================
// ADJACENCY GRAPH
// ============================================================

export interface AdjacencyEdge {
  roomAId: string;
  roomBId: string;
  wallId: string;
  wallLength_mm: number;
}

export interface AdjacencyGraph {
  edges: AdjacencyEdge[];
  adjacencyMap: Map<string, string[]>; // roomId → adjacent roomIds
  exteriorRooms: Set<string>;          // rooms with at least one exterior wall
}

export function buildAdjacencyGraph(floor: Floor): AdjacencyGraph {
  const edges: AdjacencyEdge[] = [];
  const adjacencyMap = new Map<string, string[]>();
  const exteriorRooms = new Set<string>();

  // Initialize
  for (const room of floor.rooms) {
    adjacencyMap.set(room.id, []);
  }

  for (const wall of floor.walls) {
    const a = wall.left_room_id;
    const b = wall.right_room_id;

    if (a && b && a !== b) {
      // Avoid duplicate edges
      const existing = edges.find(
        (e) => (e.roomAId === a && e.roomBId === b) || (e.roomAId === b && e.roomBId === a)
      );
      if (!existing) {
        edges.push({ roomAId: a, roomBId: b, wallId: wall.id, wallLength_mm: wallLength(wall) });
        adjacencyMap.get(a)?.push(b);
        adjacencyMap.get(b)?.push(a);
      }
    }

    if (wall.type === "exterior") {
      if (a) exteriorRooms.add(a);
      if (b) exteriorRooms.add(b);
    }
  }

  return { edges, adjacencyMap, exteriorRooms };
}

/**
 * Check that all rooms are reachable from any room via doors.
 * Returns unreachable room IDs.
 */
export function findUnreachableRooms(floor: Floor): string[] {
  if (floor.rooms.length === 0) return [];

  const doorConnections = new Map<string, Set<string>>();
  for (const room of floor.rooms) doorConnections.set(room.id, new Set());

  for (const door of floor.doors) {
    const [a, b] = door.connects_rooms;
    if (a && b) {
      doorConnections.get(a)?.add(b);
      doorConnections.get(b)?.add(a);
    }
  }

  // BFS from first room
  const visited = new Set<string>();
  if (floor.rooms.length === 0) return [];
  const queue = [floor.rooms[0].id];
  visited.add(floor.rooms[0].id);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = doorConnections.get(current);
    if (neighbors) {
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
  }

  return floor.rooms.filter((r) => !visited.has(r.id)).map((r) => r.id);
}

// ============================================================
// ROOM TYPE CLASSIFICATION
// ============================================================

const CIRCULATION: RoomType[] = ["corridor", "lobby", "foyer"];
const PRIVATE: RoomType[] = ["bedroom", "master_bedroom", "guest_bedroom", "study", "home_office"];
const WET: RoomType[] = ["bathroom", "toilet", "wc"];
const PUBLIC: RoomType[] = ["living_room", "dining_room"];
const SERVICE: RoomType[] = ["kitchen", "utility", "laundry", "store_room", "pantry"];
const OUTDOOR: RoomType[] = ["balcony", "terrace", "verandah"];

function isType(type: RoomType, group: RoomType[]): boolean {
  return group.includes(type);
}

// ============================================================
// DOOR CONNECTION RULES
// ============================================================

/** Should these two room types have a door between them? */
function shouldConnect(typeA: RoomType, typeB: RoomType): boolean {
  // Circulation connects to everything except other circulation
  if (isType(typeA, CIRCULATION) && !isType(typeB, CIRCULATION)) return true;
  if (isType(typeB, CIRCULATION) && !isType(typeA, CIRCULATION)) return true;

  // Public rooms connect to each other
  if (isType(typeA, PUBLIC) && isType(typeB, PUBLIC)) return true;

  // Kitchen connects to dining/living
  if (typeA === "kitchen" && isType(typeB, PUBLIC)) return true;
  if (typeB === "kitchen" && isType(typeA, PUBLIC)) return true;

  // Kitchen connects to utility
  if (typeA === "kitchen" && isType(typeB, SERVICE)) return true;
  if (typeB === "kitchen" && isType(typeA, SERVICE)) return true;

  // Bathroom connects to its bedroom (if adjacent)
  if (isType(typeA, WET) && isType(typeB, PRIVATE)) return true;
  if (isType(typeB, WET) && isType(typeA, PRIVATE)) return true;

  // Outdoor connects to adjacent rooms
  if (isType(typeA, OUTDOOR) || isType(typeB, OUTDOOR)) return true;

  // Puja room connects to private/public
  if (typeA === "puja_room" || typeB === "puja_room") return true;

  // Bedroom should NOT connect to another bedroom (go through corridor)
  if (isType(typeA, PRIVATE) && isType(typeB, PRIVATE)) return false;

  return false;
}

/** Should a bedroom→bathroom connection be preferred over corridor→bathroom? */
function isAttachedBathroom(bathId: string, bedroomId: string, floor: Floor): boolean {
  const bath = floor.rooms.find((r) => r.id === bathId);
  const bedroom = floor.rooms.find((r) => r.id === bedroomId);
  if (!bath || !bedroom) return false;

  // If bathroom is small and adjacent to exactly one bedroom, it's attached
  return bath.area_sqm < 5 && isType(bedroom.type, PRIVATE);
}

// ============================================================
// DOOR SIZING & TYPE RULES
// ============================================================

function getDoorWidthForConnection(typeA: RoomType, typeB: RoomType): number {
  // Main entrance
  if (typeA === "lobby" || typeA === "foyer" || typeB === "lobby" || typeB === "foyer") return 1050;

  // Bathroom doors are narrower
  if (isType(typeA, WET) || isType(typeB, WET)) return 750;

  // Kitchen/utility
  if (isType(typeA, SERVICE) || isType(typeB, SERVICE)) return 800;

  // Standard internal
  return 900;
}

function getDoorType(typeA: RoomType, typeB: RoomType, isMainEntrance: boolean): Door["type"] {
  if (isMainEntrance) return "main_entrance";
  if (isType(typeA, OUTDOOR) || isType(typeB, OUTDOOR)) return "sliding";
  return "single_swing";
}

// ============================================================
// SWING DIRECTION LOGIC
// ============================================================

function computeSwingDirection(
  roomA: Room, roomB: Room, wall: Wall
): { swing: "left" | "right"; opensTo: "inside" | "outside" } {
  // Wet rooms: door swings outward (away from wet room)
  const aIsWet = isType(roomA.type, WET);
  const bIsWet = isType(roomB.type, WET);

  // Determine "inside" as the smaller/wet room side
  if (aIsWet) return { swing: "left", opensTo: "outside" };
  if (bIsWet) return { swing: "right", opensTo: "outside" };

  // Circulation rooms: door swings away from corridor
  if (isType(roomA.type, CIRCULATION)) return { swing: "right", opensTo: "inside" };
  if (isType(roomB.type, CIRCULATION)) return { swing: "left", opensTo: "inside" };

  // Default: swing into larger room
  return roomA.area_sqm >= roomB.area_sqm
    ? { swing: "left", opensTo: "inside" }
    : { swing: "right", opensTo: "inside" };
}

// ============================================================
// HINGE & SYMBOL GEOMETRY
// ============================================================

function computeDoorSymbol(
  wall: Wall,
  posAlongWall: number,
  doorWidth: number,
  swingDir: "left" | "right",
  opensTo: "inside" | "outside",
): Door["symbol"] {
  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2;

  // Door opening start/end on the wall
  const doorStart = addPoints(wall.centerline.start, scalePoint(dir, posAlongWall));
  const doorEnd = addPoints(doorStart, scalePoint(dir, doorWidth));

  // Hinge at one end, offset perpendicular by half wall thickness
  const perpSign = opensTo === "inside" ? 1 : -1;
  const hingeBase = swingDir === "left" ? doorStart : doorEnd;
  const hinge = addPoints(hingeBase, scalePoint(norm, halfT * perpSign));

  // Leaf end: perpendicular from hinge
  const leafEnd = addPoints(hinge, scalePoint(norm, doorWidth * perpSign));

  // Arc angles based on wall angle
  const wAngle = wallAngle(wall) * (180 / Math.PI);
  const arcStart = swingDir === "left" ? wAngle : wAngle + 180;
  const arcEnd = arcStart + (perpSign > 0 ? 90 : -90);

  return {
    hinge_point: hinge,
    arc_radius_mm: doorWidth,
    arc_start_angle_deg: arcStart,
    arc_end_angle_deg: arcEnd,
    leaf_end_point: leafEnd,
  };
}

// ============================================================
// SMART DOOR PLACEMENT
// ============================================================

export interface PlacementIssue {
  severity: "error" | "warning" | "info";
  message: string;
  roomId?: string;
}

export interface DoorPlacementResult {
  doors: Door[];
  issues: PlacementIssue[];
}

export function smartPlaceDoors(floor: Floor): DoorPlacementResult {
  const graph = buildAdjacencyGraph(floor);
  const doors: Door[] = [];
  const issues: PlacementIssue[] = [];
  const usedWallSegments: Map<string, Array<{ start: number; end: number }>> = new Map();

  // Track which room pairs already have doors
  const connectedPairs = new Set<string>();

  // 1. Find main entrance — exterior wall of lobby/foyer/living, or largest public room
  const entranceRoom = floor.rooms.find((r) => r.type === "foyer" || r.type === "lobby")
    ?? floor.rooms.find((r) => r.type === "living_room")
    ?? floor.rooms.filter((r) => isType(r.type, PUBLIC)).sort((a, b) => b.area_sqm - a.area_sqm)[0]
    ?? undefined;

  if (entranceRoom) {
    const entranceWall = findExteriorWallForRoom(entranceRoom, floor);
    if (entranceWall) {
      const doorWidth = 1050;
      const pos = findDoorPosition(entranceWall, doorWidth, usedWallSegments, floor);
      if (pos !== null) {
        const mainDoor = createDoor(
          entranceWall, pos, doorWidth, "main_entrance",
          [entranceRoom.id, ""], { swing: "left", opensTo: "inside" }
        );
        doors.push(mainDoor);
        markUsed(entranceWall.id, pos, doorWidth, usedWallSegments);
      }
    } else {
      issues.push({ severity: "warning", message: `No exterior wall found for main entrance (${entranceRoom.name})`, roomId: entranceRoom.id });
    }
  }

  // 2. Place doors for all adjacency edges that should be connected
  for (const edge of graph.edges) {
    const roomA = floor.rooms.find((r) => r.id === edge.roomAId);
    const roomB = floor.rooms.find((r) => r.id === edge.roomBId);
    if (!roomA || !roomB) continue;

    if (!shouldConnect(roomA.type, roomB.type)) continue;

    const pairKey = [edge.roomAId, edge.roomBId].sort().join("|");
    if (connectedPairs.has(pairKey)) continue;

    const wall = floor.walls.find((w) => w.id === edge.wallId);
    if (!wall) continue;

    const doorWidth = getDoorWidthForConnection(roomA.type, roomB.type);
    const pos = findDoorPosition(wall, doorWidth, usedWallSegments, floor);
    if (pos === null) {
      issues.push({ severity: "warning", message: `Cannot fit door between ${roomA.name} and ${roomB.name} — wall too short or occupied` });
      continue;
    }

    const doorType = getDoorType(roomA.type, roomB.type, false);
    const { swing, opensTo } = computeSwingDirection(roomA, roomB, wall);

    const door = createDoor(wall, pos, doorWidth, doorType, [roomA.id, roomB.id], { swing, opensTo });
    doors.push(door);
    markUsed(wall.id, pos, doorWidth, usedWallSegments);
    connectedPairs.add(pairKey);
  }

  // 3. Check connectivity — ensure all rooms are reachable
  const tempFloor = { ...floor, doors };
  const unreachable = findUnreachableRooms(tempFloor);
  for (const roomId of unreachable) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) {
      issues.push({
        severity: "error",
        message: `${room.name} is not reachable — no door connects it to the rest of the plan`,
        roomId,
      });
    }
  }

  // 4. Check for swing conflicts (doors on same wall whose arcs overlap)
  checkSwingConflicts(doors, floor, issues);

  return { doors, issues };
}

// ============================================================
// DOOR PLACEMENT HELPERS
// ============================================================

function findExteriorWallForRoom(room: Room, floor: Floor): Wall | null {
  const roomWallIds = new Set(room.wall_ids);
  const exteriorWalls = floor.walls.filter(
    (w) => w.type === "exterior" && (roomWallIds.has(w.id) || w.left_room_id === room.id || w.right_room_id === room.id)
  );
  if (exteriorWalls.length === 0) return null;
  // Prefer longest exterior wall
  return exteriorWalls.sort((a, b) => wallLength(b) - wallLength(a))[0] ?? null;
}

function findDoorPosition(
  wall: Wall,
  doorWidth: number,
  usedSegments: Map<string, Array<{ start: number; end: number }>>,
  floor: Floor,
): number | null {
  const wLen = wallLength(wall);
  const MIN_FROM_CORNER = 200;
  const minPos = MIN_FROM_CORNER;
  const maxPos = wLen - doorWidth - MIN_FROM_CORNER;
  if (maxPos < minPos) return null;

  // Check against existing used segments on this wall
  const used = usedSegments.get(wall.id) ?? [];

  // Also check existing doors/windows on this wall
  const existingOnWall: Array<{ start: number; end: number }> = [
    ...floor.doors.filter((d) => d.wall_id === wall.id).map((d) => ({ start: d.position_along_wall_mm, end: d.position_along_wall_mm + d.width_mm })),
    ...floor.windows.filter((w) => w.wall_id === wall.id).map((w) => ({ start: w.position_along_wall_mm, end: w.position_along_wall_mm + w.width_mm })),
    ...used,
  ];

  // Try preferred position: 200mm from start
  const candidates = [minPos, maxPos, (minPos + maxPos) / 2];
  for (const candidate of candidates) {
    const doorStart = candidate;
    const doorEnd = candidate + doorWidth;
    const fits = existingOnWall.every(
      (seg) => doorEnd + 100 <= seg.start || doorStart >= seg.end + 100
    );
    if (fits && doorStart >= minPos && doorEnd <= wLen - MIN_FROM_CORNER) {
      return candidate;
    }
  }

  return null;
}

function markUsed(wallId: string, pos: number, width: number, map: Map<string, Array<{ start: number; end: number }>>) {
  if (!map.has(wallId)) map.set(wallId, []);
  map.get(wallId)!.push({ start: pos, end: pos + width });
}

function createDoor(
  wall: Wall,
  pos: number,
  width: number,
  type: Door["type"],
  connectsRooms: [string, string],
  swing: { swing: "left" | "right"; opensTo: "inside" | "outside" },
): Door {
  const symbol = computeDoorSymbol(wall, pos, width, swing.swing, swing.opensTo);
  return {
    id: genId("d"),
    wall_id: wall.id,
    type,
    width_mm: width,
    height_mm: type === "main_entrance" ? 2100 : 2100,
    thickness_mm: 45,
    position_along_wall_mm: pos,
    swing_direction: swing.swing,
    swing_angle_deg: 90,
    opens_to: swing.opensTo,
    symbol,
    connects_rooms: connectsRooms,
  };
}

function checkSwingConflicts(doors: Door[], floor: Floor, issues: PlacementIssue[]) {
  // Group doors by wall
  const byWall = new Map<string, Door[]>();
  for (const d of doors) {
    if (!byWall.has(d.wall_id)) byWall.set(d.wall_id, []);
    byWall.get(d.wall_id)!.push(d);
  }

  for (const [wallId, wallDoors] of byWall) {
    if (wallDoors.length < 2) continue;
    // Check if any two doors' positions overlap with swing clearance
    for (let i = 0; i < wallDoors.length; i++) {
      for (let j = i + 1; j < wallDoors.length; j++) {
        const a = wallDoors[i];
        const b = wallDoors[j];
        const gap = Math.abs(
          (a.position_along_wall_mm + a.width_mm / 2) - (b.position_along_wall_mm + b.width_mm / 2)
        );
        if (gap < (a.width_mm + b.width_mm) / 2 + 100) {
          issues.push({
            severity: "warning",
            message: `Two doors on the same wall may have swing conflicts — consider pocket or sliding doors`,
          });
        }
      }
    }
  }
}

// ============================================================
// SMART WINDOW PLACEMENT
// ============================================================

/** Window sizing rules per room type (IS:1038 compliant) */
const WINDOW_SPECS: Record<string, { width: number; height: number; sill: number; type: CadWindow["type"] }> = {
  living_room:     { width: 1500, height: 1200, sill: 600,  type: "casement" },
  dining_room:     { width: 1500, height: 1200, sill: 600,  type: "casement" },
  bedroom:         { width: 1200, height: 1200, sill: 900,  type: "casement" },
  master_bedroom:  { width: 1500, height: 1200, sill: 900,  type: "casement" },
  guest_bedroom:   { width: 1200, height: 1200, sill: 900,  type: "casement" },
  kitchen:         { width: 1200, height: 1000, sill: 1050, type: "casement" },
  study:           { width: 1200, height: 1200, sill: 900,  type: "casement" },
  home_office:     { width: 1200, height: 1200, sill: 900,  type: "casement" },
  bathroom:        { width: 600,  height: 450,  sill: 1800, type: "awning" },
  toilet:          { width: 600,  height: 450,  sill: 1800, type: "awning" },
  wc:              { width: 600,  height: 450,  sill: 1800, type: "awning" },
  utility:         { width: 900,  height: 900,  sill: 1200, type: "awning" },
  laundry:         { width: 900,  height: 900,  sill: 1200, type: "awning" },
  staircase:       { width: 600,  height: 1500, sill: 600,  type: "fixed" },
  puja_room:       { width: 900,  height: 1000, sill: 900,  type: "casement" },
  corridor:        { width: 600,  height: 900,  sill: 1200, type: "fixed" },
};

const DEFAULT_WINDOW = { width: 1200, height: 1200, sill: 900, type: "casement" as const };

export interface WindowPlacementResult {
  windows: CadWindow[];
  issues: PlacementIssue[];
}

export function smartPlaceWindows(floor: Floor): WindowPlacementResult {
  const windows: CadWindow[] = [];
  const issues: PlacementIssue[] = [];
  const usedSegments: Map<string, Array<{ start: number; end: number }>> = new Map();

  // Pre-populate used segments from existing doors
  for (const door of floor.doors) {
    markUsed(door.wall_id, door.position_along_wall_mm, door.width_mm, usedSegments);
  }

  // Find exterior walls per room
  for (const room of floor.rooms) {
    // Skip rooms that don't need windows
    if (isType(room.type, CIRCULATION) && room.type !== "lobby") continue;
    if (room.type === "elevator" || room.type === "shaft" || room.type === "fire_escape") continue;

    const spec = WINDOW_SPECS[room.type] ?? DEFAULT_WINDOW;
    const roomWallIds = new Set(room.wall_ids);

    // Find exterior walls for this room
    const exteriorWalls = floor.walls.filter(
      (w) => w.type === "exterior" && (roomWallIds.has(w.id) || w.left_room_id === room.id || w.right_room_id === room.id)
    );

    if (exteriorWalls.length === 0) {
      // Only warn for habitable rooms
      if (room.natural_light_required || isType(room.type, [...PRIVATE, ...PUBLIC])) {
        issues.push({
          severity: "warning",
          message: `${room.name} has no exterior wall — cannot place windows for natural light`,
          roomId: room.id,
        });
      }
      continue;
    }

    // Target window area: IS:1038 recommends 1/6 of floor area for adequate daylighting.
    // NBC 2016 minimum is 1/10 for ventilation (checked separately below).
    const requiredWindowArea = room.area_sqm * 1_000_000 / 6; // mm² (IS:1038 target)
    let placedWindowArea = 0;

    // Place windows on exterior walls, preferring longest walls first
    const sortedWalls = [...exteriorWalls].sort((a, b) => wallLength(b) - wallLength(a));

    for (const wall of sortedWalls) {
      if (placedWindowArea >= requiredWindowArea) break;

      const wLen = wallLength(wall);
      const MIN_FROM_CORNER = 600;
      const MIN_FROM_DOOR = 500;

      // Find available position centered on wall
      const used = usedSegments.get(wall.id) ?? [];
      const winWidth = spec.width;
      const idealPos = (wLen - winWidth) / 2;
      const minPos = MIN_FROM_CORNER;
      const maxPos = wLen - winWidth - MIN_FROM_CORNER;

      if (maxPos < minPos) continue; // Wall too short

      // Try centered first, then offset positions
      const candidates = [
        Math.max(minPos, Math.min(idealPos, maxPos)),
        minPos,
        maxPos,
      ];

      let placed = false;
      for (const candidate of candidates) {
        if (placed) break;
        const wStart = candidate;
        const wEnd = candidate + winWidth;

        const fits = used.every(
          (seg) => wEnd + MIN_FROM_DOOR <= seg.start || wStart >= seg.end + MIN_FROM_DOOR
        );

        if (fits && wStart >= minPos) {
          const win: CadWindow = {
            id: genId("win"),
            wall_id: wall.id,
            type: spec.type,
            width_mm: winWidth,
            height_mm: spec.height,
            sill_height_mm: spec.sill,
            position_along_wall_mm: candidate,
            symbol: {
              start_point: { x: 0, y: 0 },
              end_point: { x: winWidth, y: 0 },
              glass_lines: [],
            },
            glazing: "double",
            operable: spec.type !== "fixed",
          };
          windows.push(win);
          markUsed(wall.id, candidate, winWidth, usedSegments);
          placedWindowArea += winWidth * spec.height;
          placed = true;
        }
      }
    }

    // Check ventilation compliance — NBC 2016 minimum: 1/10 of floor area
    // (distinct from IS:1038 daylighting target of 1/6 used above for placement)
    const roomFloorArea_sqm = room.area_sqm;
    const roomWindowArea_sqm = placedWindowArea / 1_000_000;
    const ratio = roomFloorArea_sqm > 0 ? roomWindowArea_sqm / roomFloorArea_sqm : 0;

    if (ratio < 1 / 10 && room.natural_light_required !== false) {
      const needed = (roomFloorArea_sqm / 10 - roomWindowArea_sqm).toFixed(2);
      issues.push({
        severity: "warning",
        message: `${room.name}: window area (${roomWindowArea_sqm.toFixed(2)} sqm) is ${(ratio * 100).toFixed(1)}% of floor area — need ${needed} sqm more for NBC 2016 ventilation minimum (10%)`,
        roomId: room.id,
      });
    }
  }

  return { windows, issues };
}
