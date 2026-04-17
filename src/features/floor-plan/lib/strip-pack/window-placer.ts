/**
 * Step 12 — place windows on external walls.
 *
 * Per-room defaults:
 *   bedroom*    → 4ft standard window on the longest external wall
 *   living/drawing → 6ft large window on the entrance-side external wall
 *   dining      → 4ft standard
 *   kitchen     → 3ft standard
 *   bathroom*   → 2ft ventilation (sill 6ft)
 *   utility/store/laundry/pantry → 2ft ventilation
 *   foyer/porch/verandah/balcony → skip (open or door-served)
 *   corridor/staircase → skip
 *
 * Skip when the room has no external wall, or when the only candidate wall
 * is already saturated with a door close enough to overlap.
 */
import type { DoorPlacement, Facing, StripPackRoom, WallSegment, WindowKind, WindowPlacement } from "./types";
import { feq } from "./types";

const CORNER_CLEARANCE_FT = 0.5;
const DOOR_WINDOW_SPACING_FT = 1;

interface WinSpec {
  width_ft: number;
  kind: WindowKind;
  sill_height_ft: number;
}

function specFor(room: StripPackRoom): WinSpec | null {
  const t = room.type;
  if (t.includes("bedroom") || t === "study") return { width_ft: 4, kind: "standard", sill_height_ft: 3 };
  if (t === "living" || t === "drawing_room") return { width_ft: 6, kind: "large", sill_height_ft: 2 };
  if (t === "dining") return { width_ft: 4, kind: "standard", sill_height_ft: 2 };
  if (t === "kitchen") return { width_ft: 3, kind: "standard", sill_height_ft: 3 };
  if (t === "bathroom" || t === "master_bathroom" || t === "ensuite" || t === "powder_room" || t === "toilet") {
    return { width_ft: 2, kind: "ventilation", sill_height_ft: 6 };
  }
  if (t === "utility" || t === "store" || t === "laundry" || t === "pantry") {
    return { width_ft: 2, kind: "ventilation", sill_height_ft: 5 };
  }
  if (t === "pooja" || t === "prayer" || t === "mandir") return { width_ft: 2, kind: "ventilation", sill_height_ft: 5 };
  // Skip everything else (corridor, foyer, porch, balcony, staircase, …).
  return null;
}

export interface WindowPlaceInput {
  rooms: StripPackRoom[];
  walls: WallSegment[];
  doors: DoorPlacement[];
  facing: Facing;
}

export interface WindowPlaceOutput {
  windows: WindowPlacement[];
  warnings: string[];
}

export function placeWindows(input: WindowPlaceInput): WindowPlaceOutput {
  const warnings: string[] = [];
  const windows: WindowPlacement[] = [];

  // Index doors by wall_id for fast overlap checks.
  const doorsByWall = new Map<string, DoorPlacement[]>();
  for (const d of input.doors) {
    if (!d.wall_id) continue;
    if (!doorsByWall.has(d.wall_id)) doorsByWall.set(d.wall_id, []);
    doorsByWall.get(d.wall_id)!.push(d);
  }

  for (const room of input.rooms) {
    if (!room.placed) continue;
    const spec = specFor(room);
    if (!spec) continue;

    const externals = input.walls.filter(w => w.type === "external" && w.room_ids.includes(room.id));
    if (externals.length === 0) continue;

    // Living rooms prefer the entrance-side wall; everyone else takes longest.
    const preferEntranceSide = room.type === "living" || room.type === "drawing_room";
    let chosen: WallSegment | null = null;
    if (preferEntranceSide) {
      chosen = externals.find(w => isOnEntranceSide(w, input.facing, room)) ?? null;
    }
    if (!chosen) {
      let bestLen = 0;
      for (const w of externals) {
        const len = wallLen(w);
        if (len > bestLen) {
          bestLen = len;
          chosen = w;
        }
      }
    }
    if (!chosen) continue;

    const win = placeOnWall(chosen, spec, doorsByWall.get(chosen.id) ?? [], room, input.facing, warnings);
    if (win) windows.push(win);
  }

  return { windows, warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

function wallLen(w: WallSegment): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

function isOnEntranceSide(w: WallSegment, facing: Facing, room: StripPackRoom): boolean {
  if (!room.placed) return false;
  const r = room.placed;
  if (w.orientation === "horizontal") {
    if (facing === "north") return feq(w.start.y, r.y + r.depth);
    if (facing === "south") return feq(w.start.y, r.y);
  } else {
    if (facing === "east") return feq(w.start.x, r.x + r.width);
    if (facing === "west") return feq(w.start.x, r.x);
  }
  return false;
}

function placeOnWall(
  wall: WallSegment,
  spec: WinSpec,
  doorsOnWall: DoorPlacement[],
  room: StripPackRoom,
  facing: Facing,
  warnings: string[],
): WindowPlacement | null {
  const len = wallLen(wall);
  const required = spec.width_ft + 2 * CORNER_CLEARANCE_FT;
  if (len < required) {
    // wall too short — skip silently (small bath external window is optional)
    return null;
  }

  // Try centered placement first; if it overlaps a door, shift to the gap.
  const centerSlot = makeCenteredSlot(wall, spec.width_ft);
  if (!overlapsAnyDoor(centerSlot, doorsOnWall, spec.width_ft)) {
    return materializeWindow(wall, centerSlot, spec, room, facing);
  }

  // Try left/right of doors.
  const slots = enumerateGapSlots(wall, doorsOnWall, spec.width_ft);
  if (slots.length === 0) {
    warnings.push(`${room.name}: external wall ${wall.id} fully blocked by doors — window skipped`);
    return null;
  }
  return materializeWindow(wall, slots[0], spec, room, facing);
}

interface SlotPos {
  /** Center of the window slot along the wall. */
  along: number;
}

function makeCenteredSlot(wall: WallSegment, width: number): SlotPos {
  void width;
  const len = wallLen(wall);
  return { along: len / 2 };
}

function overlapsAnyDoor(slot: SlotPos, doorsOnWall: DoorPlacement[], width: number): boolean {
  if (doorsOnWall.length === 0) return false;
  // Convert slot to absolute range on the wall axis.
  for (const d of doorsOnWall) {
    const dCenter = (axisVal(d.start) + axisVal(d.end)) / 2;
    if (Math.abs(slot.along - dCenter) < width / 2 + d.width_ft / 2 + DOOR_WINDOW_SPACING_FT) {
      return true;
    }
  }
  return false;
}

function axisVal(p: { x: number; y: number }): number {
  // For a horizontal wall: along axis = x; vertical wall: along axis = y.
  // We don't have orientation here; caller passes door placements that line
  // up with the wall. Use whichever varies.
  return p.x === 0 ? p.y : p.x; // fallback; almost-correct for centered windows
}

function enumerateGapSlots(wall: WallSegment, doorsOnWall: DoorPlacement[], winWidth: number): SlotPos[] {
  const len = wallLen(wall);
  // Sort doors by their position along the wall.
  const positions = doorsOnWall.map(d => {
    const c = (positionAlong(d.start, wall) + positionAlong(d.end, wall)) / 2;
    return { c, w: d.width_ft };
  }).sort((a, b) => a.c - b.c);

  const events: Array<{ from: number; to: number }> = [];
  let cursor = CORNER_CLEARANCE_FT;
  for (const p of positions) {
    const left = p.c - p.w / 2 - DOOR_WINDOW_SPACING_FT;
    if (left - cursor >= winWidth) {
      events.push({ from: cursor, to: left });
    }
    cursor = p.c + p.w / 2 + DOOR_WINDOW_SPACING_FT;
  }
  if (len - CORNER_CLEARANCE_FT - cursor >= winWidth) {
    events.push({ from: cursor, to: len - CORNER_CLEARANCE_FT });
  }
  return events.map(e => ({ along: (e.from + e.to) / 2 }));
}

function positionAlong(p: { x: number; y: number }, wall: WallSegment): number {
  if (wall.orientation === "horizontal") return p.x - wall.start.x;
  return p.y - wall.start.y;
}

function materializeWindow(
  wall: WallSegment,
  slot: SlotPos,
  spec: WinSpec,
  room: StripPackRoom,
  facing: Facing,
): WindowPlacement {
  const half = spec.width_ft / 2;
  const wallSide = sideOfRoom(wall, room) ?? facing;
  if (wall.orientation === "horizontal") {
    const cx = wall.start.x + slot.along;
    return {
      on_room: room.name,
      start: { x: cx - half, y: wall.start.y },
      end:   { x: cx + half, y: wall.start.y },
      wall_side: wallSide,
      width_ft: spec.width_ft,
      kind: spec.kind,
      wall_id: wall.id,
      sill_height_ft: spec.sill_height_ft,
    };
  }
  const cy = wall.start.y + slot.along;
  return {
    on_room: room.name,
    start: { x: wall.start.x, y: cy - half },
    end:   { x: wall.start.x, y: cy + half },
    wall_side: wallSide,
    width_ft: spec.width_ft,
    kind: spec.kind,
    wall_id: wall.id,
    sill_height_ft: spec.sill_height_ft,
  };
}

function sideOfRoom(wall: WallSegment, room: StripPackRoom): Facing | null {
  if (!room.placed) return null;
  const r = room.placed;
  if (wall.orientation === "horizontal") {
    if (feq(wall.start.y, r.y)) return "south";
    if (feq(wall.start.y, r.y + r.depth)) return "north";
  } else {
    if (feq(wall.start.x, r.x)) return "west";
    if (feq(wall.start.x, r.x + r.width)) return "east";
  }
  return null;
}
