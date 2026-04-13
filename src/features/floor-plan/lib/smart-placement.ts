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
} from "@/features/floor-plan/lib/geometry";
import type { TemplateConnection } from "@/features/floor-plan/lib/typology-templates";

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
// CIRCULATION PRIORITY RULES
// ============================================================

/**
 * For each room type, the ordered priority list of neighbor types to prefer
 * when choosing which wall gets the door. First match wins.
 */
const DOOR_WALL_PRIORITY: Partial<Record<string, string[]>> = {
  bedroom: ["corridor", "hallway", "passage", "foyer"],
  master_bedroom: ["corridor", "hallway", "passage", "foyer"],
  guest_bedroom: ["corridor", "hallway", "passage", "foyer"],
  children_bedroom: ["corridor", "hallway", "passage", "foyer"],

  bathroom: ["bedroom", "master_bedroom", "guest_bedroom", "corridor", "hallway"],
  master_bathroom: ["master_bedroom", "corridor", "hallway"],
  toilet: ["corridor", "hallway", "passage", "foyer"],
  powder_room: ["foyer", "corridor", "hallway"],

  kitchen: ["dining_room", "corridor", "living_room", "hallway"],
  living_room: ["foyer", "entrance_lobby", "corridor", "dining_room"],
  dining_room: ["living_room", "kitchen", "corridor"],

  utility: ["kitchen", "corridor", "hallway"],
  laundry: ["kitchen", "utility", "corridor"],
  store_room: ["kitchen", "corridor", "utility"],
  servant_quarter: ["corridor", "hallway"],

  balcony: ["living_room", "master_bedroom", "bedroom", "dining_room"],
  verandah: ["living_room", "foyer", "corridor"],
  terrace: ["corridor", "living_room", "bedroom"],

  study: ["corridor", "hallway", "passage"],
  home_office: ["corridor", "hallway", "passage"],
  puja_room: ["corridor", "foyer", "living_room"],
};

/**
 * Door position preference along the wall (mm from start).
 * Bedrooms/bathrooms: near corner (leaves long wall for furniture).
 * Kitchen: center (doesn't block counter).
 * Living room: golden ratio position.
 */
function getPreferredDoorOffset(
  roomType: string,
  wLen: number,
  doorWidth: number,
): number | null {
  const minFromCorner = 200;
  const maxPos = wLen - doorWidth - minFromCorner;
  if (maxPos < minFromCorner) return null;

  switch (roomType) {
    case "bedroom":
    case "master_bedroom":
    case "guest_bedroom":
    case "children_bedroom":
      // Near corner — leaves long wall for bed/wardrobe
      return minFromCorner + 100; // 300mm from wall start

    case "bathroom":
    case "master_bathroom":
    case "toilet":
    case "powder_room":
      // Near corner — leaves wall for fixtures
      return minFromCorner;

    case "kitchen":
      // Center — doesn't block counter runs
      return Math.round((wLen - doorWidth) / 2);

    case "living_room":
    case "drawing_room":
      // Golden ratio from one end — creates balanced entry sight line
      return Math.round(Math.min((wLen - doorWidth) * 0.382, maxPos));

    default:
      return null; // use default sweep logic
  }
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

/**
 * Smart door placement with circulation-flow awareness.
 *
 * @param floor - The floor to place doors on (rooms + walls must be set)
 * @param connections - Optional template connections (from TypologyTemplate)
 *                      to guide which room pairs get doors and on which walls
 */
export function smartPlaceDoors(
  floor: Floor,
  connections?: TemplateConnection[],
): DoorPlacementResult {
  const graph = buildAdjacencyGraph(floor);
  const doors: Door[] = [];
  const issues: PlacementIssue[] = [];
  const usedWallSegments: Map<string, Array<{ start: number; end: number }>> = new Map();
  const connectedPairs = new Set<string>();

  // Build name→Room and type→Room[] lookups for connection matching
  const roomByName = new Map<string, Room>();
  const roomsByType = new Map<string, Room[]>();
  for (const r of floor.rooms) {
    roomByName.set(r.name, r);
    if (!roomsByType.has(r.type)) roomsByType.set(r.type, []);
    roomsByType.get(r.type)!.push(r);
  }

  // ── 1. Main entrance ──
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

  // ── 2. Connection-guided door placement (when template connections available) ──
  if (connections && connections.length > 0) {
    placeDoorsFromConnections(connections, floor, graph, doors, issues, usedWallSegments, connectedPairs, roomsByType);
  }

  // ── 3. Circulation-priority door placement (for any remaining unconnected rooms) ──
  placeDoorsFromPriority(floor, graph, doors, issues, usedWallSegments, connectedPairs);

  // ── 4. Fallback: standard adjacency-based placement for still-unconnected pairs ──
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
    const posType = isType(roomA.type, CIRCULATION) ? roomB.type : roomA.type;
    const pos = findDoorPositionForRoom(wall, doorWidth, posType, usedWallSegments, floor);
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

  // ── 5. Connectivity guarantee — ensure all rooms are reachable ──
  const tempFloor = { ...floor, doors };
  const unreachable = findUnreachableRooms(tempFloor);
  for (const roomId of unreachable) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (!room) continue;

    let fixed = false;
    for (const edge of graph.edges) {
      const isEdgeForRoom = edge.roomAId === roomId || edge.roomBId === roomId;
      if (!isEdgeForRoom) continue;
      const otherRoomId = edge.roomAId === roomId ? edge.roomBId : edge.roomAId;
      if (unreachable.includes(otherRoomId)) continue;

      const wall = floor.walls.find((w) => w.id === edge.wallId);
      if (!wall) continue;
      const doorWidth = 800;
      const pos = findDoorPosition(wall, doorWidth, usedWallSegments, floor);
      if (pos === null) continue;

      const otherRoom = floor.rooms.find((r) => r.id === otherRoomId);
      const door = createDoor(wall, pos, doorWidth, "single_swing",
        [roomId, otherRoomId],
        { swing: "left", opensTo: "inside" });
      doors.push(door);
      markUsed(wall.id, pos, doorWidth, usedWallSegments);
      issues.push({
        severity: "info",
        message: `Auto-placed fallback door for ${room.name} → ${otherRoom?.name ?? "adjacent room"}`,
        roomId,
      });
      fixed = true;
      break;
    }

    if (!fixed) {
      issues.push({
        severity: "error",
        message: `${room.name} is not reachable — no shared wall found for fallback door`,
        roomId,
      });
    }
  }

  // ── 6. Post-placement validation ──
  checkSwingConflicts(doors, floor, issues);
  validateDoorPrivacy(doors, floor, issues);

  return { doors, issues };
}

// ============================================================
// CONNECTION-GUIDED DOOR PLACEMENT
// ============================================================

/**
 * Place doors guided by template connections (slot-based topology).
 * Template connections use slot IDs (e.g., "bedroom1", "corridor").
 * We match them to CAD rooms by type since slot IDs aren't preserved in CAD.
 */
function placeDoorsFromConnections(
  connections: TemplateConnection[],
  floor: Floor,
  graph: AdjacencyGraph,
  doors: Door[],
  issues: PlacementIssue[],
  usedWallSegments: Map<string, Array<{ start: number; end: number }>>,
  connectedPairs: Set<string>,
  roomsByType: Map<string, Room[]>,
): void {
  // Build a slot-to-roomType mapping from the connections
  // Slot IDs like "bedroom1", "bath2", "living" map to room types
  const slotToType = buildSlotTypeMap();

  // Track which rooms have been used for each slot (to handle "bedroom1" vs "bedroom2")
  const usedRoomsForType = new Map<string, Set<string>>();

  // Sort connections: required first, then by connection type (door before open/adjacent)
  const sorted = [...connections]
    .filter(c => c.type === 'door')
    .sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));

  for (const conn of sorted) {
    const typeFrom = slotToType.get(conn.from);
    const typeTo = slotToType.get(conn.to);
    if (!typeFrom || !typeTo) continue;

    // Find actual rooms matching these types
    const roomFrom = findUnusedRoom(typeFrom, roomsByType, usedRoomsForType);
    const roomTo = findUnusedRoom(typeTo, roomsByType, usedRoomsForType);
    if (!roomFrom || !roomTo) continue;

    const pairKey = [roomFrom.id, roomTo.id].sort().join("|");
    if (connectedPairs.has(pairKey)) continue;

    // Find the shared wall between these rooms
    const sharedEdge = graph.edges.find(
      e => (e.roomAId === roomFrom.id && e.roomBId === roomTo.id) ||
           (e.roomAId === roomTo.id && e.roomBId === roomFrom.id),
    );
    if (!sharedEdge) continue;

    const wall = floor.walls.find(w => w.id === sharedEdge.wallId);
    if (!wall) continue;

    const doorWidth = getDoorWidthForConnection(roomFrom.type, roomTo.type);
    // Use the non-circulation room's type for position preference (e.g., bedroom → near corner)
    const posRoomType = isType(roomFrom.type, CIRCULATION) ? roomTo.type : roomFrom.type;
    const pos = findDoorPositionForRoom(wall, doorWidth, posRoomType, usedWallSegments, floor);
    if (pos === null) continue;

    const doorType = getDoorType(roomFrom.type, roomTo.type, false);
    const { swing, opensTo } = computeSwingDirection(roomFrom, roomTo, wall);

    const door = createDoor(wall, pos, doorWidth, doorType, [roomFrom.id, roomTo.id], { swing, opensTo });
    doors.push(door);
    markUsed(wall.id, pos, doorWidth, usedWallSegments);
    connectedPairs.add(pairKey);

    // Mark these rooms as used for their slot
    markRoomUsed(typeFrom, roomFrom.id, usedRoomsForType);
    markRoomUsed(typeTo, roomTo.id, usedRoomsForType);
  }
}

/** Map template slot IDs to canonical room types */
function buildSlotTypeMap(): Map<string, string> {
  const map = new Map<string, string>();
  // Standard slot IDs used across all templates
  const slotPatterns: Record<string, string> = {
    bedroom1: "master_bedroom", bedroom2: "bedroom", bedroom3: "bedroom",
    bedroom4: "bedroom", bedroom5: "bedroom",
    bath1: "master_bathroom", bath2: "bathroom", bath3: "bathroom",
    bath4: "bathroom", bath5: "bathroom",
    living: "living_room", dining: "dining_room", kitchen: "kitchen",
    corridor: "corridor", balcony: "balcony", utility: "utility",
    pooja: "puja_room", staircase: "staircase",
    servant: "servant_quarter", servant_bath: "servant_toilet",
    drawing: "drawing_room", terrace: "terrace",
    study: "study", foyer: "foyer",
    // Commercial
    cabin1: "cabin", cabin2: "cabin", conference: "conference_room",
    workspace: "open_workspace", reception: "reception",
    waiting: "waiting_area", toilet: "commercial_toilet",
    pantry: "pantry", server: "server_room", breakroom: "break_room",
    parking: "parking",
  };
  for (const [slot, type] of Object.entries(slotPatterns)) {
    map.set(slot, type);
  }
  return map;
}

function findUnusedRoom(
  roomType: string,
  roomsByType: Map<string, Room[]>,
  usedRooms: Map<string, Set<string>>,
): Room | null {
  const candidates = roomsByType.get(roomType);
  if (!candidates) return null;
  const used = usedRooms.get(roomType);
  for (const room of candidates) {
    if (!used || !used.has(room.id)) return room;
  }
  // All used — return first anyway (allow reuse for shared connections)
  return candidates[0] ?? null;
}

function markRoomUsed(
  roomType: string,
  roomId: string,
  usedRooms: Map<string, Set<string>>,
): void {
  if (!usedRooms.has(roomType)) usedRooms.set(roomType, new Set());
  usedRooms.get(roomType)!.add(roomId);
}

// ============================================================
// CIRCULATION-PRIORITY DOOR PLACEMENT
// ============================================================

/**
 * For rooms not yet connected by the template path, use DOOR_WALL_PRIORITY
 * to pick the best neighbor type for door placement.
 */
function placeDoorsFromPriority(
  floor: Floor,
  graph: AdjacencyGraph,
  doors: Door[],
  issues: PlacementIssue[],
  usedWallSegments: Map<string, Array<{ start: number; end: number }>>,
  connectedPairs: Set<string>,
): void {
  for (const room of floor.rooms) {
    // Skip if room already has at least one door
    const alreadyConnected = doors.some(d =>
      d.connects_rooms.includes(room.id),
    );
    if (alreadyConnected) continue;

    const priorities = DOOR_WALL_PRIORITY[room.type];
    if (!priorities) continue;

    const adjacentIds = graph.adjacencyMap.get(room.id) ?? [];
    let placed = false;

    // Try each priority neighbor type in order
    for (const prefType of priorities) {
      if (placed) break;
      for (const adjId of adjacentIds) {
        if (placed) break;
        const adjRoom = floor.rooms.find(r => r.id === adjId);
        if (!adjRoom || adjRoom.type !== prefType) continue;

        const pairKey = [room.id, adjRoom.id].sort().join("|");
        if (connectedPairs.has(pairKey)) { placed = true; break; }

        // Find the shared wall
        const edge = graph.edges.find(e =>
          (e.roomAId === room.id && e.roomBId === adjRoom.id) ||
          (e.roomAId === adjRoom.id && e.roomBId === room.id),
        );
        if (!edge) continue;

        const wall = floor.walls.find(w => w.id === edge.wallId);
        if (!wall) continue;

        const doorWidth = getDoorWidthForConnection(room.type, adjRoom.type);
        const pos = findDoorPositionForRoom(wall, doorWidth, room.type, usedWallSegments, floor);
        if (pos === null) continue;

        const doorType = getDoorType(room.type, adjRoom.type, false);
        const { swing, opensTo } = computeSwingDirection(room, adjRoom, wall);

        const door = createDoor(wall, pos, doorWidth, doorType, [room.id, adjRoom.id], { swing, opensTo });
        doors.push(door);
        markUsed(wall.id, pos, doorWidth, usedWallSegments);
        connectedPairs.add(pairKey);
        placed = true;
      }
    }
  }
}

// ============================================================
// POST-PLACEMENT VALIDATION
// ============================================================

/** Check that no bathroom door opens directly into a public living/dining area */
function validateDoorPrivacy(doors: Door[], floor: Floor, issues: PlacementIssue[]): void {
  for (const door of doors) {
    const [idA, idB] = door.connects_rooms;
    const roomA = floor.rooms.find(r => r.id === idA);
    const roomB = floor.rooms.find(r => r.id === idB);
    if (!roomA || !roomB) continue;

    const hasBath = isType(roomA.type, WET) || isType(roomB.type, WET);
    const hasPublic = isType(roomA.type, PUBLIC) || isType(roomB.type, PUBLIC);

    if (hasBath && hasPublic) {
      const bathRoom = isType(roomA.type, WET) ? roomA : roomB;
      const pubRoom = isType(roomA.type, PUBLIC) ? roomA : roomB;
      issues.push({
        severity: "warning",
        message: `Bathroom "${bathRoom.name}" door opens into public room "${pubRoom.name}" — privacy concern`,
        roomId: bathRoom.id,
      });
    }
  }
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
  const MIN_GAP = 100;           // minimum gap between door edge and any element
  const SWEEP_STEP = 50;         // 50mm sweep resolution
  const IDEAL_CORNER_DIST = 300; // preferred distance from corners
  const WINDOW_CLEARANCE = 400;  // preferred clearance from windows

  const minPos = MIN_FROM_CORNER;
  const maxPos = wLen - doorWidth - MIN_FROM_CORNER;
  if (maxPos < minPos) return null;

  // Collect all existing obstacles on this wall
  const used = usedSegments.get(wall.id) ?? [];
  const existingOnWall: Array<{ start: number; end: number; isWindow?: boolean }> = [
    ...floor.doors.filter((d) => d.wall_id === wall.id).map((d) => ({
      start: d.position_along_wall_mm, end: d.position_along_wall_mm + d.width_mm,
    })),
    ...floor.windows.filter((w) => w.wall_id === wall.id).map((w) => ({
      start: w.position_along_wall_mm, end: w.position_along_wall_mm + w.width_mm, isWindow: true,
    })),
    ...used.map((s) => ({ ...s })),
  ];

  // Full wall sweep: evaluate every valid position and pick the best-scoring one
  let bestPos: number | null = null;
  let bestScore = -Infinity;

  for (let pos = minPos; pos <= maxPos; pos += SWEEP_STEP) {
    const doorStart = pos;
    const doorEnd = pos + doorWidth;

    // Hard constraint: must not overlap any existing element (with MIN_GAP clearance)
    const fits = existingOnWall.every(
      (seg) => doorEnd + MIN_GAP <= seg.start || doorStart >= seg.end + MIN_GAP
    );
    if (!fits) continue;

    // Scoring: higher is better
    let score = 0;

    // 1. Corner distance: prefer 300mm+, penalize <200mm (already excluded), reward center-ish
    const distFromStart = doorStart;
    const distFromEnd = wLen - doorEnd;
    const minCornerDist = Math.min(distFromStart, distFromEnd);
    if (minCornerDist >= IDEAL_CORNER_DIST) score += 10;
    else score += (minCornerDist / IDEAL_CORNER_DIST) * 10;

    // 2. Window clearance: prefer distance from windows
    for (const seg of existingOnWall) {
      if (!seg.isWindow) continue;
      const gapToWindow = Math.min(
        Math.abs(doorStart - seg.end),
        Math.abs(doorEnd - seg.start)
      );
      if (gapToWindow >= WINDOW_CLEARANCE) score += 5;
      else score += (gapToWindow / WINDOW_CLEARANCE) * 5;
    }

    // 3. Door-to-door spacing: maximize distance from other doors
    for (const seg of existingOnWall) {
      if (seg.isWindow) continue;
      const gapToDoor = Math.min(
        Math.abs(doorStart - seg.end),
        Math.abs(doorEnd - seg.start)
      );
      score += Math.min(gapToDoor / 1000, 3); // up to 3 points for 1m+ spacing
    }

    // 4. Centering preference: slight bias toward wall center (natural circulation flow)
    const wallCenter = wLen / 2;
    const doorCenter = doorStart + doorWidth / 2;
    const centerDeviation = Math.abs(doorCenter - wallCenter) / (wLen / 2);
    score += (1 - centerDeviation) * 4; // up to 4 points for perfect centering

    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  return bestPos;
}

/**
 * Find door position with room-type-aware preference.
 *
 * Uses getPreferredDoorOffset() to bias position (e.g., bedrooms near corner,
 * kitchens centered), then falls back to the standard sweep if the preferred
 * position is blocked.
 */
function findDoorPositionForRoom(
  wall: Wall,
  doorWidth: number,
  roomType: string,
  usedSegments: Map<string, Array<{ start: number; end: number }>>,
  floor: Floor,
): number | null {
  const wLen = wallLength(wall);
  const preferred = getPreferredDoorOffset(roomType, wLen, doorWidth);

  if (preferred !== null) {
    // Check if preferred position is clear
    const MIN_GAP = 100;
    const used = usedSegments.get(wall.id) ?? [];
    const existingOnWall = [
      ...floor.doors.filter(d => d.wall_id === wall.id).map(d => ({
        start: d.position_along_wall_mm, end: d.position_along_wall_mm + d.width_mm,
      })),
      ...floor.windows.filter(w => w.wall_id === wall.id).map(w => ({
        start: w.position_along_wall_mm, end: w.position_along_wall_mm + w.width_mm,
      })),
      ...used,
    ];

    const doorStart = preferred;
    const doorEnd = preferred + doorWidth;
    const fits = existingOnWall.every(
      seg => doorEnd + MIN_GAP <= seg.start || doorStart >= seg.end + MIN_GAP,
    );
    if (fits && doorStart >= 200 && doorEnd <= wLen - 200) {
      return preferred;
    }
  }

  // Fall back to standard sweep
  return findDoorPosition(wall, doorWidth, usedSegments, floor);
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
    height_mm: type === "main_entrance" ? 2200 : 2100,
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

  for (const [, wallDoors] of byWall) {
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

    // Score and sort exterior walls by architectural suitability for this room type.
    // Not just longest-first — consider room function and wall orientation.
    const sortedWalls = [...exteriorWalls].sort((a, b) => {
      let scoreA = wallLength(a) / 1000; // base: longer walls score higher (in meters)
      let scoreB = wallLength(b) / 1000;

      // Bedrooms: prefer wall OPPOSITE the door (door wall is typically the shortest/internal side)
      // This maximizes light on the occupied area and avoids window behind bed headboard.
      if (room.type === "bedroom" || room.type === "master_bedroom" || room.type === "guest_bedroom") {
        const doorOnA = floor.doors.some((d) => d.wall_id === a.id);
        const doorOnB = floor.doors.some((d) => d.wall_id === b.id);
        if (!doorOnA) scoreA += 3; // prefer walls WITHOUT doors
        if (!doorOnB) scoreB += 3;
      }

      // Living/dining: prefer the widest wall for maximum daylight
      if (room.type === "living_room" || room.type === "dining_room") {
        scoreA += wallLength(a) / 2000; // extra weight on length
        scoreB += wallLength(b) / 2000;
      }

      return scoreB - scoreA; // descending by score
    });

    for (const wall of sortedWalls) {
      if (placedWindowArea >= requiredWindowArea) break;

      const wLen = wallLength(wall);
      const MIN_FROM_CORNER = 600;
      const MIN_FROM_DOOR = 500;
      const winWidth = spec.width;
      const minPos = MIN_FROM_CORNER;
      const maxPos = wLen - winWidth - MIN_FROM_CORNER;

      if (maxPos < minPos) continue; // Wall too short

      // Allow MULTIPLE windows per wall for large rooms that need more light.
      // Try up to 3 window positions: center, left offset, right offset.
      const idealPos = (wLen - winWidth) / 2;
      const candidates = [
        Math.max(minPos, Math.min(idealPos, maxPos)),
        minPos,
        maxPos,
      ];

      for (const candidate of candidates) {
        if (placedWindowArea >= requiredWindowArea) break;
        const wStart = candidate;
        const wEnd = candidate + winWidth;

        const used = usedSegments.get(wall.id) ?? [];
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
        }
      }
    }

    // ── Cross-ventilation pass: large rooms (>15 sqm) need windows on 2+ walls ──
    // Prefer OPPOSITE walls for effective cross-ventilation (not adjacent walls).
    try {
      const wallsWithWindows = new Set(
        windows.filter(w => {
          const rWallIds = new Set(room.wall_ids);
          return rWallIds.has(w.wall_id);
        }).map(w => w.wall_id)
      );
      const needsCrossVent = room.area_sqm > 15 && wallsWithWindows.size < 2;
      if (needsCrossVent) {
        // Find the wall with the first window to determine its orientation
        const firstWindowWall = floor.walls.find((w) => wallsWithWindows.has(w.id));
        // Sort candidate walls: prefer opposite orientation (perpendicular/opposite) over adjacent
        const crossVentCandidates = sortedWalls.filter((w) => !wallsWithWindows.has(w.id));
        if (firstWindowWall) {
          const isFirstHorizontal = Math.abs(firstWindowWall.centerline.start.y - firstWindowWall.centerline.end.y) <
            Math.abs(firstWindowWall.centerline.start.x - firstWindowWall.centerline.end.x);
          crossVentCandidates.sort((a, b) => {
            const isAHoriz = Math.abs(a.centerline.start.y - a.centerline.end.y) <
              Math.abs(a.centerline.start.x - a.centerline.end.x);
            const isBHoriz = Math.abs(b.centerline.start.y - b.centerline.end.y) <
              Math.abs(b.centerline.start.x - b.centerline.end.x);
            // Prefer walls with SAME orientation (parallel = opposite wall) for cross-ventilation
            const aOpposite = isAHoriz === isFirstHorizontal ? 1 : 0;
            const bOpposite = isBHoriz === isFirstHorizontal ? 1 : 0;
            if (aOpposite !== bOpposite) return bOpposite - aOpposite;
            return wallLength(b) - wallLength(a);
          });
        }
        for (const wall of crossVentCandidates) {
          const wLen = wallLength(wall);
          const winWidth = spec.width;
          const minPos = 600;
          const maxPos = wLen - winWidth - 600;
          if (maxPos < minPos) continue;
          const idealPos = (wLen - winWidth) / 2;
          const candidate = Math.max(minPos, Math.min(idealPos, maxPos));
          const used = usedSegments.get(wall.id) ?? [];
          const fits = used.every(
            (seg) => candidate + winWidth + 500 <= seg.start || candidate >= seg.end + 500
          );
          if (fits) {
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
            break; // One additional wall is enough
          }
        }
      }
    } catch { /* cross-vent is best-effort */ }

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

// ============================================================
// ENHANCED VALIDATION — Phase 5 additions
// ============================================================

/**
 * Validate door swing arcs against walls and other doors.
 * IS:962 compliance — swing arcs must not collide with any obstacle.
 *
 * @returns Issues found during validation
 */
export function validateDoorSwingArcs(floor: Floor): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  for (let i = 0; i < floor.doors.length; i++) {
    const door = floor.doors[i];
    if (door.type === "sliding" || door.type === "pocket") continue; // no swing arc

    const wall = floor.walls.find(w => w.id === door.wall_id);
    if (!wall) continue;

    const arcRadius = door.width_mm;

    // Check against other doors on the same wall
    for (let j = i + 1; j < floor.doors.length; j++) {
      const other = floor.doors[j];
      if (other.wall_id !== door.wall_id) continue;

      // Check if swing arcs overlap
      const doorCenter = door.position_along_wall_mm + door.width_mm / 2;
      const otherCenter = other.position_along_wall_mm + other.width_mm / 2;
      const minDist = (door.width_mm + other.width_mm) / 2 + 100; // 100mm clearance

      if (Math.abs(doorCenter - otherCenter) < minDist) {
        issues.push({
          severity: "warning",
          message: `Door swing conflict: ${door.id} and ${other.id} on same wall — arcs overlap. Consider sliding door.`,
        });
      }
    }

    // Check door-to-corner minimum distance
    const wLen = wallLength(wall);
    const doorStart = door.position_along_wall_mm;
    const doorEnd = doorStart + door.width_mm;
    const MIN_CORNER_DIST = door.type === "main_entrance" ? 300 : 200; // IS:962

    if (doorStart < MIN_CORNER_DIST) {
      issues.push({
        severity: "warning",
        message: `Door ${door.id} is ${doorStart}mm from wall start — minimum ${MIN_CORNER_DIST}mm from corner required (IS:962)`,
      });
    }
    if (wLen - doorEnd < MIN_CORNER_DIST) {
      issues.push({
        severity: "warning",
        message: `Door ${door.id} is ${Math.round(wLen - doorEnd)}mm from wall end — minimum ${MIN_CORNER_DIST}mm from corner required`,
      });
    }
  }

  return issues;
}

/**
 * Validate egress door requirements.
 * NBC 2016 Part 4 — door swing direction based on occupancy and room type.
 */
export function validateEgressDoors(floor: Floor): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  for (const door of floor.doors) {
    const connectedRooms = door.connects_rooms.map(id =>
      floor.rooms.find(r => r.id === id)
    ).filter(Boolean) as Room[];

    // Rooms >50 sqm: door should swing outward (direction of travel)
    for (const room of connectedRooms) {
      if (room.area_sqm > 50 && door.opens_to === "inside") {
        issues.push({
          severity: "warning",
          message: `${room.name} (${room.area_sqm.toFixed(1)} sqm) > 50 sqm — door should swing outward for egress (NBC Part 4)`,
          roomId: room.id,
        });
      }
    }

    // Bathrooms: should swing outward or be sliding (emergency access)
    const wetRoom = connectedRooms.find(r => isType(r.type, WET));
    if (wetRoom && door.opens_to === "inside" && door.type !== "sliding") {
      // Only warn if it swings INTO the wet room (which blocks emergency access)
      // The computeSwingDirection already handles this, but validate it
      issues.push({
        severity: "info",
        message: `${wetRoom.name}: bathroom door should swing outward or be sliding for emergency access (IS:962)`,
        roomId: wetRoom.id,
      });
    }
  }

  return issues;
}

/**
 * Validate window sill heights per room type.
 * NBC 2016 + IS:1038 compliance.
 */
export function validateWindowSillHeights(floor: Floor): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  for (const win of floor.windows) {
    const wall = floor.walls.find(w => w.id === win.wall_id);
    if (!wall) continue;

    // Find the room this window belongs to
    const roomId = wall.left_room_id ?? wall.right_room_id;
    const room = roomId ? floor.rooms.find(r => r.id === roomId) : null;
    if (!room) continue;

    const sill = win.sill_height_mm;

    // Bedrooms: sill ≤ 1000mm for egress
    if (isType(room.type, PRIVATE) && sill > 1000) {
      issues.push({
        severity: "warning",
        message: `${room.name}: window sill ${sill}mm exceeds 1000mm max for bedroom egress (NBC §8.4)`,
        roomId: room.id,
      });
    }

    // Bathrooms: sill ≥ 1200mm for privacy
    if (isType(room.type, WET) && sill < 1200) {
      issues.push({
        severity: "info",
        message: `${room.name}: bathroom window sill ${sill}mm — recommend ≥1200mm for privacy`,
        roomId: room.id,
      });
    }

    // Staircases: sill ≥ 1000mm for fall prevention
    if (room.type === "staircase" && sill < 1000) {
      issues.push({
        severity: "warning",
        message: `${room.name}: staircase window sill ${sill}mm — must be ≥1000mm for fall prevention`,
        roomId: room.id,
      });
    }
  }

  return issues;
}

/**
 * Validate that every bedroom has at least one egress window.
 * NBC 2016 — safety critical requirement.
 *
 * Egress window: clear opening ≥ 500mm wide AND ≥ 500mm tall, sill ≤ 1000mm.
 */
export function validateEgressWindows(floor: Floor): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  const bedrooms = floor.rooms.filter(r => isType(r.type, PRIVATE));

  for (const bedroom of bedrooms) {
    const roomWallIds = new Set(bedroom.wall_ids);
    const roomWindows = floor.windows.filter(w => {
      const wall = floor.walls.find(wl => wl.id === w.wall_id);
      if (!wall) return false;
      return roomWallIds.has(wall.id) || wall.left_room_id === bedroom.id || wall.right_room_id === bedroom.id;
    });

    // Check if at least one window meets egress requirements
    const hasEgressWindow = roomWindows.some(w =>
      w.width_mm >= 500 && w.height_mm >= 500 && w.sill_height_mm <= 1000
    );

    if (!hasEgressWindow) {
      issues.push({
        severity: "error",
        message: `${bedroom.name}: no egress window found. Every bedroom MUST have a window ≥500×500mm with sill ≤1000mm (NBC fire safety)`,
        roomId: bedroom.id,
      });
    }
  }

  return issues;
}

/**
 * Check ventilation operable area requirement.
 * NBC 2016 §8.4.7 — openable area ≥ floor_area/20.
 */
export function validateOperableWindowArea(floor: Floor): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  for (const room of floor.rooms) {
    if (!room.ventilation_required) continue;
    if (isType(room.type, CIRCULATION)) continue;

    const roomWallIds = new Set(room.wall_ids);
    const roomWindows = floor.windows.filter(w => {
      const wall = floor.walls.find(wl => wl.id === w.wall_id);
      if (!wall) return false;
      return roomWallIds.has(wall.id) || wall.left_room_id === room.id || wall.right_room_id === room.id;
    });

    // Calculate operable window area (only operable windows count)
    const operableArea = roomWindows
      .filter(w => w.operable)
      .reduce((s, w) => s + (w.width_mm * w.height_mm) / 1_000_000, 0); // sqm

    const minRequired = room.area_sqm / 20; // NBC §8.4.7

    if (operableArea < minRequired && room.area_sqm > 0) {
      issues.push({
        severity: "warning",
        message: `${room.name}: operable window area ${operableArea.toFixed(2)} sqm < required ${minRequired.toFixed(2)} sqm (floor_area/20, NBC §8.4.7)`,
        roomId: room.id,
      });
    }
  }

  return issues;
}

/**
 * Get door width for a connection, considering double-door rules.
 * IS:962 — main entrance ≥1200mm uses double leaf.
 */
export function getEnhancedDoorWidth(typeA: RoomType, typeB: RoomType, isMainEntrance: boolean, roomArea?: number): { width: number; isDouble: boolean } {
  if (isMainEntrance) {
    return { width: 1200, isDouble: true }; // 2 × 600mm leaves
  }

  // Conference/board room > 20 sqm: double door
  if (roomArea && roomArea > 20) {
    if (typeA === "conference_room" || typeB === "conference_room" ||
        typeA === "board_room" || typeB === "board_room") {
      return { width: 1200, isDouble: true };
    }
  }

  // Pooja room: traditionally double leaf
  if (typeA === "puja_room" || typeB === "puja_room") {
    return { width: 1000, isDouble: true };
  }

  // Standard sizing
  return { width: getDoorWidthForConnection(typeA, typeB), isDouble: false };
}

/**
 * Run all enhanced validations on a floor.
 * @returns Combined issues from all validations
 */
export function runEnhancedPlacementValidation(floor: Floor): PlacementIssue[] {
  return [
    ...validateDoorSwingArcs(floor),
    ...validateEgressDoors(floor),
    ...validateWindowSillHeights(floor),
    ...validateEgressWindows(floor),
    ...validateOperableWindowArea(floor),
  ];
}
