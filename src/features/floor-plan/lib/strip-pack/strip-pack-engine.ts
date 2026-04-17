/**
 * Strip-pack engine orchestrator.
 *
 * Calls the 12 steps of the brief in order. Pure computation, no LLM calls.
 *
 * Coordinate strategy:
 *   The strip-packer operates in a CANONICAL frame (x=0 west, y=0 hallway-edge,
 *   rows stack upward). The orchestrator transforms each strip's available
 *   rectangles to canonical, packs, and transforms the placed rooms back to
 *   plot coordinates. Four explicit cases (one per facing) — no clever
 *   coordinate hackery.
 */
import type { ParsedConstraints } from "../structured-parser";
import type {
  Facing,
  Rect,
  StripPackResult,
  StripPackRoom,
  StripPackMetrics,
  SpineLayout,
} from "./types";
import { rectArea, normalizeFacing } from "./types";
import { classifyRooms, splitByStrip } from "./room-classifier";
import { planSpine } from "./spine-placer";
import { placeEntrance } from "./entrance-handler";
import { sortForPacking } from "./room-sorter";
import { packStrip } from "./strip-packer";
import { attachSubRooms } from "./sub-room-attacher";
import { fillVoids } from "./void-filler";
import { buildWalls } from "./wall-builder";
import { placeDoors } from "./door-placer";
import { placeWindows } from "./window-placer";

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export async function runStripPackEngine(parsed: ParsedConstraints): Promise<StripPackResult> {
  const warnings: string[] = [];

  const validFacing: Facing = normalizeFacing(parsed.plot.facing);

  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 50;
  const plot: Rect = { x: 0, y: 0, width: plotW, depth: plotD };

  // ── Step 1: classify ───────────────────────────────────────────────────
  const classified = classifyRooms(parsed);

  // ── Step 1b: build adjacency groups + coerce strips (Phase 3B fix #6) ──
  // Members of a connected adjacency component are coerced to the same strip
  // (largest room with a position preference wins; otherwise the largest
  // overall). Then group_id is set so the sorter keeps them contiguous, so
  // the greedy packer puts them in the same row whenever it fits — which is
  // exactly what the door-placer needs to find a shared wall for the
  // adjacency door later.
  applyAdjacencyGroups(classified, parsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id })), warnings);

  // ── Step 2: spine ──────────────────────────────────────────────────────
  const spine = planSpine({ width_ft: plotW, depth_ft: plotD, facing: validFacing }, classified);

  // ── Step 3: entrance carve-out ─────────────────────────────────────────
  const ent = placeEntrance(spine, classified);
  spine.entrance_rooms = ent.entranceCutout ? [ent.entranceCutout] : [];
  spine.remaining_front = ent.remainingFront;

  // ── Step 4: separate attached + entrance rooms from main packing list ──
  const { front, back, attached } = splitByStrip(classified);
  // Pull porch/foyer (placed by entrance) out of the front list.
  const placedEntranceIds = new Set([ent.porch?.id, ent.foyer?.id].filter((x): x is string => !!x));
  const frontMain = front.filter(r => !placedEntranceIds.has(r.id));

  // Pre-placed rooms from the entrance handler.
  const preplaced: StripPackRoom[] = [];
  if (ent.porch) preplaced.push(ent.porch);
  if (ent.foyer) preplaced.push(ent.foyer);

  // ── Step 5: sort front + back ──────────────────────────────────────────
  const frontSorted = sortForPacking(frontMain);
  const backSorted  = sortForPacking(back);

  // ── Steps 6 + 7: pack front + back through canonical transform ─────────
  const frontPlaced = packInStrip(spine.remaining_front, frontSorted, validFacing, "FRONT", spine, warnings);
  const backPlaced  = packInStrip([spine.back_strip],     backSorted,  validFacing, "BACK",  spine, warnings);

  // ── Step 8: attach sub-rooms ───────────────────────────────────────────
  const allBeforeAttach = [...preplaced, ...frontPlaced, ...backPlaced];
  const attachOut = attachSubRooms({
    allPlaced: allBeforeAttach,
    attached,
    spine,
    plot,
  });
  warnings.push(...attachOut.warnings);
  let allRooms = attachOut.rooms;

  // ── Step 9: fill voids ─────────────────────────────────────────────────
  const fillOut = fillVoids({ plot, rooms: allRooms, spine });
  warnings.push(...fillOut.warnings);
  allRooms = fillOut.rooms;

  // ── Step 10: walls ─────────────────────────────────────────────────────
  const walls = buildWalls({ rooms: allRooms, spine, plot });

  // Wire wall_ids back onto rooms for consumers that want them.
  const wallsByRoom = new Map<string, string[]>();
  for (const w of walls) {
    for (const id of w.room_ids) {
      if (!wallsByRoom.has(id)) wallsByRoom.set(id, []);
      wallsByRoom.get(id)!.push(w.id);
    }
  }
  for (const r of allRooms) r.wall_ids = wallsByRoom.get(r.id) ?? [];

  // ── Step 11: doors ─────────────────────────────────────────────────────
  const adjacencyPairs = parsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id }));
  const doorOut = placeDoors({
    rooms: allRooms,
    walls,
    spine,
    adjacencyPairs,
    porchId: ent.porch?.id,
    foyerId: ent.foyer?.id,
  });
  warnings.push(...doorOut.warnings);

  // ── Step 12: windows ───────────────────────────────────────────────────
  const winOut = placeWindows({
    rooms: allRooms,
    walls,
    doors: doorOut.doors,
    facing: validFacing,
  });
  warnings.push(...winOut.warnings);

  // ── Metrics ────────────────────────────────────────────────────────────
  const metrics = computeMetricsImpl(allRooms, spine, plot, parsed.adjacency_pairs.length);

  return {
    rooms: allRooms,
    spine,
    walls,
    doors: doorOut.doors,
    windows: winOut.windows,
    plot,
    metrics,
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ADJACENCY GROUPS (Phase 3B fix #6)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Builds connected components from adjacency pairs over the room set, then:
 *   1. coerces every member of a multi-member group to the SAME strip
 *      (largest room with a position preference dictates; otherwise largest
 *      overall),
 *   2. tags each grouped room with `group_id = <root id>` so the sorter
 *      keeps them contiguous in the input queue.
 *
 * Attached rooms (sub-rooms of a parent) are excluded from grouping — the
 * sub-room-attacher handles those independently.
 */
function applyAdjacencyGroups(
  rooms: StripPackRoom[],
  pairs: Array<{ a: string; b: string }>,
  warnings: string[],
): void {
  if (pairs.length === 0) return;
  const eligible = rooms.filter(r => r.strip !== "ATTACHED" && r.strip !== "SPINE");
  const eligibleIds = new Set(eligible.map(r => r.id));
  if (eligible.length === 0) return;

  // Union-find
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p)!);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  for (const r of eligible) parent.set(r.id, r.id);
  for (const { a, b } of pairs) {
    if (!eligibleIds.has(a) || !eligibleIds.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Bucket by root
  const buckets = new Map<string, StripPackRoom[]>();
  for (const r of eligible) {
    const root = find(r.id);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root)!.push(r);
  }

  for (const [root, members] of buckets) {
    if (members.length < 2) continue;
    // Strip coercion: largest room with position preference wins; otherwise
    // largest overall.
    const withPos = members.filter(r => !!r.position_preference);
    const leader = (withPos.length > 0 ? withPos : members)
      .reduce((best, cur) => (cur.requested_area_sqft > best.requested_area_sqft ? cur : best));
    const target = leader.strip;
    let coerced = 0;
    for (const r of members) {
      if (r.strip !== target && r.strip !== "ATTACHED" && r.strip !== "SPINE") {
        r.strip = target;
        coerced++;
      }
      r.group_id = root;
    }
    if (coerced > 0) {
      warnings.push(`adjacency group [${members.map(m => m.name).join(", ")}]: coerced ${coerced} room(s) to ${target} strip (leader: ${leader.name})`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// CANONICAL TRANSFORM + PACK
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pack rooms into a list of strip rectangles. Handles all four facings + both
 * strips by transforming to a canonical frame (x=0 west, y=0 hallway-edge,
 * rows stack upward) before invoking the packer, then transforming each
 * placed rect back to plot coordinates.
 */
function packInStrip(
  rects: Rect[],
  rooms: StripPackRoom[],
  facing: Facing,
  strip: "FRONT" | "BACK",
  spine: SpineLayout,
  warnings: string[],
): StripPackRoom[] {
  if (rooms.length === 0 || rects.length === 0) return [];

  // Build the plot-space hallway-edge for this strip.
  const isHorizontalSpine = facing === "north" || facing === "south";
  const isVertical = !isHorizontalSpine;
  // For each rect, compute its canonical-equivalent rect.
  //   For horizontal spine (N/S facing): canonical_x = plot_x; canonical_y = plot_y - hallwayY (or mirrored).
  //   For vertical   spine (E/W facing): canonical_x = plot_y; canonical_y = plot_x - hallwayX (or mirrored).
  //
  // Determine the hallway anchor for this strip:
  //   FRONT north-facing → hallway on south of front (anchor y = spine top)
  //   BACK  north-facing → hallway on north of back  (anchor y = spine bottom)
  //   FRONT south-facing → hallway on north of front (anchor y = spine bottom)
  //   BACK  south-facing → hallway on south of back  (anchor y = spine top)
  //   FRONT east-facing  → hallway on west of front  (anchor x = spine right)
  //   BACK  east-facing  → hallway on east of back   (anchor x = spine left)
  //   FRONT west-facing  → hallway on east of front  (anchor x = spine left)
  //   BACK  west-facing  → hallway on west of back   (anchor x = spine right)

  const spineLeft   = spine.spine.x;
  const spineRight  = spine.spine.x + spine.spine.width;
  const spineBottom = spine.spine.y;
  const spineTop    = spine.spine.y + spine.spine.depth;

  // Sign + anchor for "growing away from hallway" along the perpendicular axis.
  // sign = +1 means canonical_y grows in the same direction as the perpendicular plot axis.
  let anchor: number; // value of perpendicular plot coord at hallway edge
  let sign: 1 | -1;
  if (isHorizontalSpine) {
    if ((facing === "north" && strip === "FRONT") || (facing === "south" && strip === "BACK")) {
      anchor = (facing === "north") ? spineTop : spineBottom;
      sign = +1; // canonical y grows = plot y grows
    } else {
      anchor = (facing === "north") ? spineBottom : spineTop;
      sign = -1; // canonical y grows = plot y shrinks
    }
  } else {
    if ((facing === "east" && strip === "FRONT") || (facing === "west" && strip === "BACK")) {
      anchor = (facing === "east") ? spineRight : spineLeft;
      sign = +1; // canonical y grows = plot x grows
    } else {
      anchor = (facing === "east") ? spineLeft : spineRight;
      sign = -1;
    }
  }

  // Canonical rect builder.
  function toCanonical(r: Rect): Rect {
    if (isHorizontalSpine) {
      const cy = sign === +1 ? r.y - anchor : anchor - (r.y + r.depth);
      return { x: r.x, y: cy, width: r.width, depth: r.depth };
    }
    // Vertical spine: swap axes.
    const cy = sign === +1 ? r.x - anchor : anchor - (r.x + r.width);
    return { x: r.y, y: cy, width: r.depth, depth: r.width };
  }

  // Rooms are passed through unchanged — the packer's notion of width/depth
  // matches canonical X/Y, which the back-transform reverses for vertical spines.
  const canonicalRects = rects.map(toCanonical);

  const packed = packStrip({ available: canonicalRects, rooms });
  warnings.push(...packed.warnings);
  for (const r of packed.unplaced) {
    warnings.push(`${r.name}: could not fit in ${strip.toLowerCase()} strip`);
  }

  // Transform placed canonical rects back to plot coordinates.
  for (const room of packed.placed) {
    if (!room.placed) continue;
    const c = room.placed;
    if (isHorizontalSpine) {
      const py = sign === +1 ? c.y + anchor : anchor - (c.y + c.depth);
      room.placed = { x: c.x, y: py, width: c.width, depth: c.depth };
    } else {
      const px = sign === +1 ? c.y + anchor : anchor - (c.y + c.depth);
      const py = c.x;
      room.placed = { x: px, y: py, width: c.depth, depth: c.width };
    }
    room.actual_area_sqft = room.placed.width * room.placed.depth;
  }

  return packed.placed;
}

// ───────────────────────────────────────────────────────────────────────────
// METRICS
// ───────────────────────────────────────────────────────────────────────────

function computeMetricsImpl(
  rooms: StripPackRoom[],
  spine: SpineLayout,
  plot: Rect,
  requiredAdjacencies: number,
): StripPackMetrics {
  const total_rooms = rooms.length;
  // Efficiency
  let occupied = spine.spine.width * spine.spine.depth;
  for (const r of rooms) if (r.placed) occupied += r.placed.width * r.placed.depth;
  const plotArea = rectArea(plot);
  const efficiency_pct = plotArea > 0 ? Math.min(100, (occupied / plotArea) * 100) : 0;
  const void_area_sqft = Math.max(0, plotArea - occupied);

  // Door coverage + adjacency are computed elsewhere by the caller against the
  // door list; we return placeholders here and the caller fills them in.
  return {
    efficiency_pct: Math.round(efficiency_pct * 10) / 10,
    void_area_sqft: Math.round(void_area_sqft),
    door_coverage_pct: 0,
    orphan_rooms: [],
    adjacency_satisfaction_pct: 0,
    total_rooms,
    rooms_with_doors: 0,
    required_adjacencies: requiredAdjacencies,
    satisfied_adjacencies: 0,
  };
}

/**
 * Public helper to recompute door-driven metrics after the engine returns.
 * Kept separate so the orchestrator can populate them with the actual door
 * list — placeMetricsImpl can't see doors from inside its scope.
 */
export function fillDoorMetrics(result: StripPackResult): StripPackResult {
  const roomsWithDoors = new Set<string>();
  for (const d of result.doors) {
    for (const name of d.between) {
      if (name === "hallway" || name === "exterior") continue;
      roomsWithDoors.add(name);
    }
  }
  // Match by name back to room ids — names are the source of truth in DoorPlacement.between.
  const placedRoomNames = new Set(result.rooms.filter(r => r.placed).map(r => r.name));
  const served = [...roomsWithDoors].filter(n => placedRoomNames.has(n)).length;
  const door_coverage_pct = result.metrics.total_rooms > 0
    ? Math.round((served / result.metrics.total_rooms) * 1000) / 10
    : 0;
  const orphan_rooms = [...placedRoomNames].filter(n => !roomsWithDoors.has(n));

  // Adjacency satisfaction: count adjacency-tagged door pairs.
  const totalReq = result.metrics.required_adjacencies;
  let satisfied = 0;
  for (const d of result.doors) {
    if (d.between.includes("hallway") || d.between.includes("exterior")) continue;
    satisfied++;
  }
  const adjacency_satisfaction_pct = totalReq > 0
    ? Math.round((Math.min(satisfied, totalReq) / totalReq) * 1000) / 10
    : 100;

  return {
    ...result,
    metrics: {
      ...result.metrics,
      rooms_with_doors: served,
      door_coverage_pct,
      orphan_rooms,
      satisfied_adjacencies: Math.min(satisfied, totalReq),
      adjacency_satisfaction_pct,
    },
  };
}
