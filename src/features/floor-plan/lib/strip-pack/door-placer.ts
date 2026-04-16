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
const MIN_WALL_FOR_NARROW_DOOR_FT = NARROW_DOOR_WIDTH_FT + 2 * CORNER_CLEARANCE_FT;

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
    const door = makeDoorOnWall(wall, [ra.name, rb.name], DEFAULT_DOOR_WIDTH_FT, warnings);
    if (door) {
      doors.push(door);
      servedRooms.add(pair.a);
      servedRooms.add(pair.b);
    }
  }

  // ── 2. Hallway doors for unserved rooms ────────────────────────────────
  for (const room of input.rooms) {
    if (!room.placed) continue;
    if (servedRooms.has(room.id)) continue;
    const wall = findHallwayWallFor(input.walls, input.spine, room.id);
    if (!wall) continue;
    const door = makeDoorOnWall(wall, [room.name, "hallway"], DEFAULT_DOOR_WIDTH_FT, warnings);
    if (door) {
      doors.push(door);
      servedRooms.add(room.id);
    }
  }

  // ── 3. Fallback: any internal wall ─────────────────────────────────────
  for (const room of input.rooms) {
    if (!room.placed) continue;
    if (servedRooms.has(room.id)) continue;
    const wall = findAnyInternalWallFor(input.walls, room.id);
    if (!wall) {
      warnings.push(`${room.name}: no shared wall available — room is unreachable`);
      continue;
    }
    const otherId = wall.room_ids.find(id => id !== room.id) ?? "neighbor";
    const otherName = otherId === HALLWAY_SENTINEL_ID
      ? "hallway"
      : roomById.get(otherId)?.name ?? "neighbor";
    const door = makeDoorOnWall(wall, [room.name, otherName], DEFAULT_DOOR_WIDTH_FT, warnings);
    if (door) {
      doors.push(door);
      servedRooms.add(room.id);
      // Don't tag as a "fallback" warning when we still ended up on the
      // hallway — that's the desired outcome.
      if (otherName !== "hallway") {
        warnings.push(`${room.name}: door fallback to ${otherName} (no hallway adjacency)`);
      }
    }
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
      const door = makeDoorOnWall(wall, [entry.name, "exterior"], MAIN_ENTRANCE_DOOR_WIDTH_FT, warnings);
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
): DoorPlacement | null {
  const len = wallLength(wall);
  let width = preferredWidth;
  if (len < width + 2 * CORNER_CLEARANCE_FT) {
    if (len >= MIN_WALL_FOR_NARROW_DOOR_FT) {
      width = NARROW_DOOR_WIDTH_FT;
    } else {
      warnings.push(`wall ${wall.id}: ${len.toFixed(1)}ft too short for door between ${between[0]} and ${between[1]}`);
      return null;
    }
  }
  const halfDoor = width / 2;
  if (wall.orientation === "horizontal") {
    const cx = (wall.start.x + wall.end.x) / 2;
    return {
      start: { x: cx - halfDoor, y: wall.start.y },
      end:   { x: cx + halfDoor, y: wall.start.y },
      between,
      width_ft: width,
      orientation: "horizontal",
      wall_id: wall.id,
    };
  }
  const cy = (wall.start.y + wall.end.y) / 2;
  return {
    start: { x: wall.start.x, y: cy - halfDoor },
    end:   { x: wall.start.x, y: cy + halfDoor },
    between,
    width_ft: width,
    orientation: "vertical",
    wall_id: wall.id,
  };
}
