/**
 * Step 1 — classify ParsedRoom[] into StripPackRoom[].
 *
 * Assigns:
 *   - zone (PUBLIC / PRIVATE / SERVICE / WET / WORSHIP / CIRCULATION / OUTDOOR / ENTRANCE)
 *   - strip (FRONT / BACK / ENTRANCE / ATTACHED / SPINE)
 *   - default dimensions when the parser left them null
 *   - is_attached_to (for ensuites / wardrobes)
 *
 * Pure function. No mutation of the input. Deterministic.
 */
import type { ParsedRoom, ParsedConstraints } from "../structured-parser";
import type { StripPackRoom, RoomZone, StripAssignment, Facing } from "./types";

// ───────────────────────────────────────────────────────────────────────────
// LOOKUP TABLES
// ───────────────────────────────────────────────────────────────────────────

const ZONE_BY_FUNCTION: Readonly<Record<string, RoomZone>> = {
  // PRIVATE
  master_bedroom: "PRIVATE",
  bedroom: "PRIVATE",
  guest_bedroom: "PRIVATE",
  kids_bedroom: "PRIVATE",
  study: "PRIVATE",
  // PUBLIC
  living: "PUBLIC",
  dining: "PUBLIC",
  drawing_room: "PUBLIC",
  // ENTRANCE-ish (treated as FRONT special-cases by the entrance handler)
  foyer: "ENTRANCE",
  porch: "ENTRANCE",
  verandah: "ENTRANCE",
  // SERVICE
  kitchen: "SERVICE",
  pantry: "SERVICE",
  store: "SERVICE",
  utility: "SERVICE",
  laundry: "SERVICE",
  servant_quarter: "SERVICE",
  // WET
  bathroom: "WET",
  master_bathroom: "WET",
  ensuite: "WET",
  powder_room: "WET",
  toilet: "WET",
  // WORSHIP
  pooja: "WORSHIP",
  prayer: "WORSHIP",
  mandir: "WORSHIP",
  // CIRCULATION (the hallway IS the spine — these get filtered out)
  corridor: "CIRCULATION",
  hallway: "CIRCULATION",
  passage: "CIRCULATION",
  // OUTDOOR
  balcony: "OUTDOOR",
  sit_out: "OUTDOOR",
  // STRUCTURAL — pass through to BACK strip (rare in residential prompts)
  staircase: "SERVICE",
  walk_in_wardrobe: "PRIVATE",
  walk_in_closet: "PRIVATE",
};

/** Defaults sourced from pipeline-b-orchestrator.DEFAULT_DIMS_FT — kept in sync. */
const DEFAULT_DIMS: Readonly<Record<string, [number, number]>> = {
  bedroom: [12, 11],
  master_bedroom: [14, 13],
  guest_bedroom: [12, 11],
  kids_bedroom: [11, 10],
  living: [16, 13],
  dining: [12, 11],
  drawing_room: [12, 10],
  kitchen: [10, 9],
  bathroom: [7, 5],
  master_bathroom: [9, 6],
  ensuite: [8, 5],
  powder_room: [5, 4],
  toilet: [5, 4],
  walk_in_wardrobe: [7, 5],
  walk_in_closet: [7, 5],
  foyer: [8, 7],
  porch: [9, 6],
  verandah: [12, 8],
  balcony: [10, 4],
  corridor: [12, 4],
  hallway: [12, 4],
  staircase: [10, 8],
  utility: [6, 5],
  store: [6, 5],
  laundry: [6, 5],
  pantry: [6, 5],
  pooja: [5, 4],
  prayer: [5, 4],
  mandir: [5, 4],
  study: [10, 9],
  servant_quarter: [9, 8],
  sit_out: [10, 4],
  other: [10, 8],
};

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

function zoneFor(fn: string): RoomZone {
  return ZONE_BY_FUNCTION[fn] ?? "PRIVATE";
}

function defaultDims(fn: string): [number, number] {
  return DEFAULT_DIMS[fn] ?? DEFAULT_DIMS.other;
}

/** Compass directions on the entrance side of the plot. */
function frontDirections(facing: Facing): Set<string> {
  switch (facing) {
    case "north": return new Set(["N", "NE", "NW"]);
    case "south": return new Set(["S", "SE", "SW"]);
    case "east":  return new Set(["E", "NE", "SE"]);
    case "west":  return new Set(["W", "NW", "SW"]);
  }
}

function backDirections(facing: Facing): Set<string> {
  switch (facing) {
    case "north": return new Set(["S", "SE", "SW"]);
    case "south": return new Set(["N", "NE", "NW"]);
    case "east":  return new Set(["W", "NW", "SW"]);
    case "west":  return new Set(["E", "NE", "SE"]);
  }
}

/** Strip routing logic — see Section 5.1 of the brief. */
function stripFor(
  room: ParsedRoom,
  zone: RoomZone,
  facing: Facing,
  isAttached: boolean,
): StripAssignment {
  if (isAttached) return "ATTACHED";
  if (zone === "CIRCULATION") return "SPINE";
  if (zone === "ENTRANCE") return "ENTRANCE";

  // User-explicit position takes precedence over zone heuristics.
  const dir = room.position_direction;
  if (dir) {
    if (frontDirections(facing).has(dir)) return "FRONT";
    if (backDirections(facing).has(dir)) return "BACK";
  }

  switch (zone) {
    case "PUBLIC":  return "FRONT";
    case "PRIVATE": return "BACK";
    case "SERVICE": return "BACK";
    case "WET":     return "BACK";
    case "WORSHIP":
      // For Vastu-true, pooja goes NE — assigned via position_direction at parse
      // time. Here we default to BACK; if the user said NE explicitly they hit
      // the FRONT branch above (NE is FRONT for north-facing plots).
      return "BACK";
    case "OUTDOOR":
      // Balcony/sit-out attaches to the building edge — treated as BACK by
      // default, but a user-explicit position will route correctly above.
      return "BACK";
    default:        return "BACK";
  }
}

/** A room is "attached" if the parser told us, or if the name strongly implies it. */
function detectAttachedParent(room: ParsedRoom, allRooms: ParsedRoom[]): string | undefined {
  if (room.attached_to_room_id) {
    const parent = allRooms.find(r => r.id === room.attached_to_room_id);
    return parent?.id;
  }
  // Heuristic fallback: name contains an attachment cue + has exactly one
  // bedroom-typed room in its adjacency_pair set. We resolve the parent in the
  // sub-room-attacher; here we only need to TAG the room as attached.
  const lower = room.name.toLowerCase();
  const looksAttached =
    lower.includes("ensuite") ||
    lower.includes("attached") ||
    /walk[-_ ]?in/.test(lower);
  if (looksAttached) {
    // Best-effort: leave is_attached_to unset, the attacher will resolve it
    // from adjacency_pairs when it has the full picture. We still need to mark
    // it as ATTACHED so the strip-packer skips it.
    return ""; // sentinel: "attached, parent unknown — resolve later"
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export function classifyRooms(parsed: ParsedConstraints): StripPackRoom[] {
  const facing = (parsed.plot.facing ?? "north").toLowerCase() as Facing;
  const validFacing: Facing = (["north", "south", "east", "west"] as const).includes(facing)
    ? facing
    : "north";

  const adjacencyByRoomId = new Map<string, string[]>();
  for (const adj of parsed.adjacency_pairs) {
    if (!adjacencyByRoomId.has(adj.room_a_id)) adjacencyByRoomId.set(adj.room_a_id, []);
    if (!adjacencyByRoomId.has(adj.room_b_id)) adjacencyByRoomId.set(adj.room_b_id, []);
    adjacencyByRoomId.get(adj.room_a_id)!.push(adj.room_b_id);
    adjacencyByRoomId.get(adj.room_b_id)!.push(adj.room_a_id);
  }

  return parsed.rooms.map((r): StripPackRoom => {
    const fn = r.function;
    const zone = zoneFor(fn);

    const [defW, defD] = defaultDims(fn);
    const w = r.dim_width_ft ?? defW;
    const d = r.dim_depth_ft ?? defD;

    const parentSentinel = detectAttachedParent(r, parsed.rooms);
    const isAttached = parentSentinel !== undefined;
    const parentId = parentSentinel || undefined;

    const strip = stripFor(r, zone, validFacing, isAttached);
    const adjacencies = adjacencyByRoomId.get(r.id) ?? [];

    return {
      id: r.id,
      name: r.name,
      type: fn,
      requested_width_ft: w,
      requested_depth_ft: d,
      requested_area_sqft: w * d,
      zone,
      strip,
      position_preference: r.position_direction ?? undefined,
      adjacencies,
      is_attached_to: parentId,
      needs_exterior_wall: r.must_have_window_on != null || zone === "PUBLIC" || fn.includes("bedroom"),
      is_wet: r.is_wet,
      is_sacred: r.is_sacred,
    };
  });
}

/** Returns the explicit hallway/corridor width from the parsed rooms, else null. */
export function findHallwayWidth(rooms: StripPackRoom[]): number | null {
  for (const r of rooms) {
    if (r.zone === "CIRCULATION") {
      // Use the smaller dimension as "width" of the hallway; the longer
      // dimension is the spine length.
      return Math.min(r.requested_width_ft, r.requested_depth_ft);
    }
  }
  return null;
}

/** Convenience splitter for the orchestrator. */
export function splitByStrip(rooms: StripPackRoom[]): {
  front: StripPackRoom[];
  back: StripPackRoom[];
  entrance: StripPackRoom[];
  attached: StripPackRoom[];
  spine: StripPackRoom[];
} {
  const front: StripPackRoom[] = [];
  const back: StripPackRoom[] = [];
  const entrance: StripPackRoom[] = [];
  const attached: StripPackRoom[] = [];
  const spine: StripPackRoom[] = [];
  for (const r of rooms) {
    switch (r.strip) {
      case "FRONT":    front.push(r); break;
      case "BACK":     back.push(r); break;
      case "ENTRANCE": entrance.push(r); break;
      case "ATTACHED": attached.push(r); break;
      case "SPINE":    spine.push(r); break;
    }
  }
  return { front, back, entrance, attached, spine };
}
