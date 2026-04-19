/**
 * Step 11 — place doors on shared walls.
 *
 * Order of resolution:
 *   1. Adjacency-pair doors. For each parsed adjacency (a ↔ b), find the
 *      wall whose owner-set contains both a and b, place a 3ft door
 *      centered on it.
 *   2. Hallway doors. For every room that has not yet been served by an
 *      adjacency door, find a wall that lies on the spine boundary AND
 *      whose owner-set contains the room. Place a 3ft door centered on it.
 *   3. Fallback. For any room STILL without a door, find ANY internal wall
 *      it shares with another room and place a door on it. Logs a warning
 *      because this means the room isn't adjacent to the hallway and the
 *      strip-packer's connectivity guarantee was somehow weakened.
 *   4. Main entrance. The PORCH (or FOYER if no porch) gets a 3.5ft door
 *      on its external wall facing the entrance side.
 *
 * Door width: 3ft default; shrunk to 2.5ft when the shared wall is short;
 * skipped with warning when even 2.5ft + 1ft of corner clearance won't fit.
 */
import type { DoorPlacement, Facing, Rect, SpineLayout, StripPackRoom, WallSegment } from "./types";
import { feq } from "./types";
import { HALLWAY_SENTINEL_ID } from "./wall-builder";

const DEFAULT_DOOR_WIDTH_FT = 3;
const NARROW_DOOR_WIDTH_FT = 2.5;
const MAIN_ENTRANCE_DOOR_WIDTH_FT = 3.5;
const CORNER_CLEARANCE_FT = 0.5;
/** Phase 3H: tighter clearance for short walls connecting isolated rooms.
 *  0.25ft (3in) each side — architecturally acceptable for internal doors. */
const TIGHT_CORNER_CLEARANCE_FT = 0.25;
const MIN_WALL_FOR_NARROW_DOOR_FT = NARROW_DOOR_WIDTH_FT + 2 * CORNER_CLEARANCE_FT;
const MIN_WALL_FOR_TIGHT_DOOR_FT = NARROW_DOOR_WIDTH_FT + 2 * TIGHT_CORNER_CLEARANCE_FT;

export interface DoorPlaceInput {
  rooms: StripPackRoom[];
  walls: WallSegment[];
  spine: SpineLayout;
  adjacencyPairs: Array<{ a: string; b: string }>;
  /** Optional: explicit porch/foyer to place the main entrance on. */
  porchId?: string;
  foyerId?: string;
}

export interface DoorPlaceOutput {
  doors: DoorPlacement[];
  warnings: string[];
}

export function placeDoors(input: DoorPlaceInput): DoorPlaceOutput {
  const warnings: string[] = [];
  const doors: DoorPlacement[] = [];
  const roomById = new Map(input.rooms.filter(r => r.placed).map(r => [r.id, r]));
  const servedRooms = new Set<string>();

  // ── 1. Adjacency doors ─────────────────────────────────────────────────
  for (const pair of input.adjacencyPairs) {
    const ra = roomById.get(pair.a);
    const rb = roomById.get(pair.b);
    if (!ra || !rb) continue;
    const wall = findInternalWallBetween(input.walls, pair.a, pair.b);
    if (!wall) {
      warnings.push(`adjacency ${ra.name} ↔ ${rb.name}: no shared wall — door skipped`);
      continue;
    }
    const door = makeDoorOnWall(wall, [ra.name, rb.name], DEFAULT_DOOR_WIDTH_FT, warnings, doors);
    if (door) {
      doors.push(door);
      servedRooms.add(pair.a);
      servedRooms.add(pair.b);
    }
  }

  // ── 1.5 — Foyer MUST have a hallway door ───────────────────────────────
  // The Porch↔Foyer adjacency in step 1 marks foyer as "served", but the
  // foyer's architectural job is to BRIDGE the entrance to the interior.
  // Without a foyer→hallway door, BFS from the main entrance dead-ends at
  // the foyer and every interior room becomes orphaned. Force a hallway
  // door here when a shared wall exists (the entrance-handler already
  // extends the foyer to the spine for n/s-facing plots).
  if (input.foyerId) {
    const foyer = roomById.get(input.foyerId);
    if (foyer) {
      const hasHallwayDoor = doors.some(
        d =>
          (d.between[0] === foyer.name || d.between[1] === foyer.name) &&
          (d.between[0] === "hallway" || d.between[1] === "hallway"),
      );
      if (!hasHallwayDoor) {
        const wall = findHallwayWallFor(input.walls, input.spine, input.foyerId);
        if (wall) {
          const door = makeDoorOnWall(wall, [foyer.name, "hallway"], DEFAULT_DOOR_WIDTH_FT, warnings, doors);
          if (door) {
            doors.push(door);
            servedRooms.add(input.foyerId);
          }
        } else {
          warnings.push(`foyer ${foyer.name}: no shared wall with hallway — vestibule disconnected from interior`);
        }
      }
    }
  }

  // ── 2. Hallway doors for rooms adjacent to the spine ───────────────────
  // Previously skipped any room already "served" by a step-1 adjacency door.
  // That broke connectivity: Dining↔Living (adjacency door) + Living and
  // Dining both share a wall with the hallway, but NEITHER got a hallway
  // door, leaving the whole cluster orphaned from the circulation graph.
  //
  // New rule: skip only when the room ALREADY has a door to the hallway.
  // A room adjacent to the spine deserves a hallway door regardless of any
  // adjacency doors it may also have.
  for (const room of input.rooms) {
    if (!room.placed) continue;
    const alreadyHasHallwayDoor = doors.some(
      d =>
        (d.between[0] === room.name || d.between[1] === room.name) &&
        (d.between[0] === "hallway" || d.between[1] === "hallway"),
    );
    if (alreadyHasHallwayDoor) continue;
    const wall = findHallwayWallFor(input.walls, input.spine, room.id);
    if (!wall) continue;
    const door = makeDoorOnWall(wall, [room.name, "hallway"], DEFAULT_DOOR_WIDTH_FT, warnings, doors);
    if (door) {
      doors.push(door);
      servedRooms.add(room.id);
    }
  }

  // ── 3. Fallback: any internal wall ─────────────────────────────────────
  // Phase 3H fix: prefer walls connecting to rooms ALREADY served (connected
  // to circulation). Without this, rooms in BACK row 1 (Bed4, CommonBath)
  // connect to each other but never to a hallway-connected room, creating
  // an isolated orphan cluster. Run multiple passes — each pass connects at
  // least one new room to the served graph, expanding the reachable set.
  const unservedCount = input.rooms.filter(r => r.placed && !servedRooms.has(r.id)).length;
  for (let pass = 0; pass < unservedCount + 1; pass++) {
    let progress = false;
    for (const room of input.rooms) {
      if (!room.placed) continue;
      if (servedRooms.has(room.id)) continue;
      // Prefer walls connecting to a served room (connected to circulation).
      const wall = findConnectedInternalWallFor(input.walls, room.id, servedRooms)
        ?? findAnyInternalWallFor(input.walls, room.id);
      if (!wall) {
        if (pass === unservedCount) {
          warnings.push(`${room.name}: no shared wall available — room is unreachable`);
        }
        continue;
      }
      const otherId = wall.room_ids.find(id => id !== room.id) ?? "neighbor";
      const otherName = otherId === HALLWAY_SENTINEL_ID
        ? "hallway"
        : roomById.get(otherId)?.name ?? "neighbor";
      const door = makeDoorOnWall(wall, [room.name, otherName], DEFAULT_DOOR_WIDTH_FT, warnings, doors);
      if (door) {
        doors.push(door);
        servedRooms.add(room.id);
        progress = true;
        if (otherName !== "hallway") {
          warnings.push(`${room.name}: door fallback to ${otherName} (no hallway adjacency)`);
        }
      }
    }
    if (!progress) break;
  }

  // ── 4. Main entrance ───────────────────────────────────────────────────
  const entry = input.porchId
    ? roomById.get(input.porchId)
    : input.foyerId
      ? roomById.get(input.foyerId)
      : null;
  if (entry && entry.placed) {
    const wall = findExternalEntranceWall(input.walls, entry, input.spine.entrance_side);
    if (wall) {
      const door = makeDoorOnWall(wall, [entry.name, "exterior"], MAIN_ENTRANCE_DOOR_WIDTH_FT, warnings, doors);
      if (door) {
        door.is_main_entrance = true;
        doors.push(door);
      }
    } else {
      warnings.push(`${entry.name}: no external wall on entrance side — main entrance door skipped`);
    }
  }

  return { doors, warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// WALL LOOKUPS
// ───────────────────────────────────────────────────────────────────────────

function findInternalWallBetween(walls: WallSegment[], aId: string, bId: string): WallSegment | null {
  for (const w of walls) {
    if (w.type !== "internal") continue;
    if (w.room_ids.includes(aId) && w.room_ids.includes(bId)) return w;
  }
  return null;
}

/**
 * Phase 3B fix #4 — find any wall whose owner-set includes BOTH this room
 * AND the hallway sentinel. The wall-builder now keeps HALLWAY_SENTINEL_ID
 * in WallSegment.room_ids precisely so this check is robust on both sides
 * of the spine. The fallback (geometric isOnSpineEdge check against rooms
 * with HALLWAY-only walls — e.g. when an entire spine edge ended up with
 * empty real owners) is still applied as a safety net.
 */
function findHallwayWallFor(walls: WallSegment[], spine: SpineLayout, roomId: string): WallSegment | null {
  let best: WallSegment | null = null;
  let bestLen = 0;
  for (const w of walls) {
    if (w.type !== "internal") continue;
    const ownsRoom = w.room_ids.includes(roomId);
    const ownsHallway = w.room_ids.includes(HALLWAY_SENTINEL_ID);
    if (!ownsRoom || !ownsHallway) continue;
    const len = wallLength(w);
    if (len > bestLen) {
      bestLen = len;
      best = w;
    }
  }
  if (best) return best;

  // Geometric fallback: a wall on the spine edge whose owner-set contains
  // the room (covers any case where wall-builder dropped the hallway tag).
  for (const w of walls) {
    if (w.type !== "internal") continue;
    if (!w.room_ids.includes(roomId)) continue;
    if (!isOnSpineEdge(w, spine.spine)) continue;
    const len = wallLength(w);
    if (len > bestLen) {
      bestLen = len;
      best = w;
    }
  }
  return best;
}

/**
 * Phase 3H: prefer walls connecting to rooms already in the served set
 * (connected to circulation). This prevents isolated orphan clusters where
 * rooms connect to each other but never to the hallway-connected graph.
 */
function findConnectedInternalWallFor(
  walls: WallSegment[],
  roomId: string,
  servedRooms: Set<string>,
): WallSegment | null {
  let best: WallSegment | null = null;
  let bestLen = 0;
  for (const w of walls) {
    if (w.type !== "internal") continue;
    if (!w.room_ids.includes(roomId)) continue;
    const others = w.room_ids.filter(id => id !== roomId);
    // At least one other owner must be served (connected to circulation)
    // or be the hallway itself.
    const connected = others.some(id => id === HALLWAY_SENTINEL_ID || servedRooms.has(id));
    if (!connected) continue;
    const len = wallLength(w);
    // Phase 3H: only return walls long enough for a door. Otherwise the
    // caller gets a connected wall, tries to place a door, fails (too
    // short), and falls through to an unconnected wall — creating an
    // orphan cluster.
    if (len < MIN_WALL_FOR_TIGHT_DOOR_FT) continue;
    if (len > bestLen) {
      bestLen = len;
      best = w;
    }
  }
  return best;
}

function findAnyInternalWallFor(walls: WallSegment[], roomId: string): WallSegment | null {
  let best: WallSegment | null = null;
  let bestLen = 0;
  for (const w of walls) {
    if (w.type !== "internal") continue;
    if (!w.room_ids.includes(roomId)) continue;
    // Need at least one OTHER owner besides this room. The other owner may
    // be a real room id or HALLWAY_SENTINEL_ID — either is acceptable as a
    // door target.
    const others = w.room_ids.filter(id => id !== roomId);
    if (others.length === 0) continue;
    const len = wallLength(w);
    if (len > bestLen) {
      bestLen = len;
      best = w;
    }
  }
  return best;
}

function findExternalEntranceWall(walls: WallSegment[], room: StripPackRoom, facing: Facing): WallSegment | null {
  if (!room.placed) return null;
  let best: WallSegment | null = null;
  let bestLen = 0;
  for (const w of walls) {
    if (w.type !== "external") continue;
    if (!w.room_ids.includes(room.id)) continue;
    // Check side of room
    const onSide = isOnRoomSide(w, room.placed, facing);
    if (!onSide) continue;
    const len = wallLength(w);
    if (len > bestLen) {
      bestLen = len;
      best = w;
    }
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ───────────────────────────────────────────────────────────────────────────

function wallLength(w: WallSegment): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

function isOnSpineEdge(w: WallSegment, spine: Rect): boolean {
  const { start, end } = w;
  if (w.orientation === "horizontal") {
    return feq(start.y, spine.y) || feq(start.y, spine.y + spine.depth);
  }
  return feq(start.x, spine.x) || feq(start.x, spine.x + spine.width);
  void end;
}

function isOnRoomSide(w: WallSegment, room: Rect, facing: Facing): boolean {
  if (w.orientation === "horizontal") {
    if (facing === "north") return feq(w.start.y, room.y + room.depth);
    if (facing === "south") return feq(w.start.y, room.y);
  } else {
    if (facing === "east") return feq(w.start.x, room.x + room.width);
    if (facing === "west") return feq(w.start.x, room.x);
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// DOOR PLACEMENT ON A WALL
// ───────────────────────────────────────────────────────────────────────────

function makeDoorOnWall(
  wall: WallSegment,
  between: [string, string],
  preferredWidth: number,
  warnings: string[],
  existingDoors?: DoorPlacement[],
): DoorPlacement | null {
  const len = wallLength(wall);
  let width = preferredWidth;
  let clearance = CORNER_CLEARANCE_FT;
  if (len < width + 2 * CORNER_CLEARANCE_FT) {
    if (len >= MIN_WALL_FOR_NARROW_DOOR_FT) {
      width = NARROW_DOOR_WIDTH_FT;
    } else if (len >= MIN_WALL_FOR_TIGHT_DOOR_FT) {
      // Phase 3H: tight clearance for short walls — prevents orphan clusters
      // when the only wall connecting to the main graph is 3ft.
      width = NARROW_DOOR_WIDTH_FT;
      clearance = TIGHT_CORNER_CLEARANCE_FT;
    } else {
      warnings.push(`wall ${wall.id}: ${len.toFixed(1)}ft too short for door between ${between[0]} and ${between[1]}`);
      return null;
    }
  }

  // Check for existing doors on this wall and offset to avoid overlap
  const doorsOnWall = existingDoors?.filter(d => d.wall_id === wall.id) ?? [];
  const halfDoor = width / 2;

  if (wall.orientation === "horizontal") {
    let cx = (wall.start.x + wall.end.x) / 2;
    // Offset if overlapping an existing door
    for (const existing of doorsOnWall) {
      const eCx = (existing.start.x + existing.end.x) / 2;
      const minDist = halfDoor + existing.width_ft / 2 + CORNER_CLEARANCE_FT;
      if (Math.abs(cx - eCx) < minDist) {
        // Try placing to the right of the existing door
        const rightCx = eCx + minDist;
        const leftCx = eCx - minDist;
        const wallMin = Math.min(wall.start.x, wall.end.x) + clearance + halfDoor;
        const wallMax = Math.max(wall.start.x, wall.end.x) - clearance - halfDoor;
        if (rightCx <= wallMax) cx = rightCx;
        else if (leftCx >= wallMin) cx = leftCx;
        else {
          warnings.push(`wall ${wall.id}: no room for second door between ${between[0]} and ${between[1]}`);
          return null;
        }
      }
    }
    return {
      start: { x: cx - halfDoor, y: wall.start.y },
      end:   { x: cx + halfDoor, y: wall.start.y },
      between,
      width_ft: width,
      orientation: "horizontal",
      wall_id: wall.id,
    };
  }
  let cy = (wall.start.y + wall.end.y) / 2;
  // Offset if overlapping an existing door
  for (const existing of doorsOnWall) {
    const eCy = (existing.start.y + existing.end.y) / 2;
    const minDist = halfDoor + existing.width_ft / 2 + CORNER_CLEARANCE_FT;
    if (Math.abs(cy - eCy) < minDist) {
      const upCy = eCy + minDist;
      const downCy = eCy - minDist;
      const wallMin = Math.min(wall.start.y, wall.end.y) + clearance + halfDoor;
      const wallMax = Math.max(wall.start.y, wall.end.y) - clearance - halfDoor;
      if (upCy <= wallMax) cy = upCy;
      else if (downCy >= wallMin) cy = downCy;
      else {
        warnings.push(`wall ${wall.id}: no room for second door between ${between[0]} and ${between[1]}`);
        return null;
      }
    }
  }
  return {
    start: { x: wall.start.x, y: cy - halfDoor },
    end:   { x: wall.start.x, y: cy + halfDoor },
    between,
    width_ft: width,
    orientation: "vertical",
    wall_id: wall.id,
  };
}
