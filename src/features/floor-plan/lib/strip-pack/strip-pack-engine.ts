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
import { rectArea, rectOverlap, normalizeFacing } from "./types";
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

  // ── Step 2: spine ──────────────────────────────────────────────────────
  // Spine is computed before adjacency grouping so strip capacities can be
  // checked during coercion (Phase 3C fix A).
  const spine = planSpine({ width_ft: plotW, depth_ft: plotD, facing: validFacing }, classified);

  // ── Step 1b: build adjacency groups + coerce strips (Phase 3B fix #6) ──
  // Members of a connected adjacency component are coerced to the same strip
  // IFF the strip has capacity to hold them (Phase 3C fix A). Otherwise rooms
  // keep their natural strip assignment and the adjacency is satisfied via a
  // hallway door — still architecturally valid, just not a shared wall.
  // group_id is set regardless so the sorter keeps siblings contiguous.
  applyAdjacencyGroups(classified, parsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id })), spine, warnings);

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
  const frontResult = packInStrip(spine.remaining_front, frontSorted, validFacing, "FRONT", spine, warnings);
  const backResult  = packInStrip([spine.back_strip],     backSorted,  validFacing, "BACK",  spine, warnings);

  // ── Step 7b: overflow placement (Phase 3C fix B) ────────────────────────
  // Rooms that wouldn't fit in their assigned strip get a second chance in
  // any empty rectangle of the plot — including the opposite strip. Rule:
  // never silently skip a room. Shrink to 80% and rotate as fallbacks.
  const overflowCandidates = [...frontResult.unplaced, ...backResult.unplaced];
  const overflowPlaced = overflowCandidates.length > 0
    ? placeOverflowRooms(
        overflowCandidates,
        [...preplaced, ...frontResult.placed, ...backResult.placed],
        plot,
        spine,
        warnings,
      )
    : [];

  // ── Step 8: attach sub-rooms ───────────────────────────────────────────
  const allBeforeAttach = [...preplaced, ...frontResult.placed, ...backResult.placed, ...overflowPlaced];
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
  spine: SpineLayout,
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

  // Phase 3C fix A — capacity threshold for coercion. 85% leaves margin for
  // entrance cutout, row-packing gaps, and sub-room attachment.
  const CAPACITY_UTILIZATION = 0.85;
  const frontCap = spine.front_strip.width * spine.front_strip.depth;
  const backCap  = spine.back_strip.width  * spine.back_strip.depth;

  for (const [root, members] of buckets) {
    if (members.length < 2) continue;
    // Strip coercion: largest room with position preference wins; otherwise
    // largest overall.
    const withPos = members.filter(r => !!r.position_preference);
    const leader = (withPos.length > 0 ? withPos : members)
      .reduce((best, cur) => (cur.requested_area_sqft > best.requested_area_sqft ? cur : best));
    const target = leader.strip;

    // Capacity check: can the target strip actually hold the group?
    if (target === "FRONT" || target === "BACK") {
      const memberIds = new Set(members.map(m => m.id));
      const existingAreaInStrip = rooms
        .filter(r => r.strip === target && !memberIds.has(r.id))
        .reduce((s, r) => s + r.requested_area_sqft, 0);
      const groupArea = members.reduce((s, r) => s + r.requested_area_sqft, 0);
      const cap = target === "FRONT" ? frontCap : backCap;
      if (existingAreaInStrip + groupArea > cap * CAPACITY_UTILIZATION) {
        // Too much — keep natural strip assignments. Still tag with group_id
        // so the sorter keeps siblings contiguous inside each strip.
        for (const r of members) r.group_id = root;
        warnings.push(
          `adjacency group [${members.map(m => m.name).join(", ")}]: too large for ${target} strip ` +
          `(${Math.round(existingAreaInStrip + groupArea)} sqft vs ${Math.round(cap * CAPACITY_UTILIZATION)} sqft usable). ` +
          `Keeping natural strips — adjacency via hallway.`
        );
        continue;
      }
    }

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
): { placed: StripPackRoom[]; unplaced: StripPackRoom[] } {
  if (rooms.length === 0 || rects.length === 0) return { placed: [], unplaced: rooms };

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
  // NOTE: unplaced rooms are NOT warned here — overflow placement will retry
  // them in the opposite strip / plot voids before giving up (Phase 3C fix B).
  if (packed.unplaced.length > 0) {
    warnings.push(`${strip} strip: ${packed.unplaced.length} room(s) pushed to overflow (${packed.unplaced.map(r => r.name).join(", ")})`);
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

  return { placed: packed.placed, unplaced: packed.unplaced };
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

// ───────────────────────────────────────────────────────────────────────────
// OVERFLOW PLACEMENT (Phase 3C fix B)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Last-resort placement for rooms the strip-packer couldn't fit. Scans the
 * whole plot for the first empty axis-aligned rectangle large enough to hold
 * the room, in this order: original, rotated, 80% shrunk, 80% shrunk rotated.
 * Rule: never silently skip a room.
 *
 * Blockers are the spine and every already-placed room rect. Attached rooms
 * (which haven't been placed yet) are NOT considered — they're small and
 * attachSubRooms has its own fallback logic.
 */
function placeOverflowRooms(
  unplaced: StripPackRoom[],
  placedRooms: StripPackRoom[],
  plot: Rect,
  spine: SpineLayout,
  warnings: string[],
): StripPackRoom[] {
  const newlyPlaced: StripPackRoom[] = [];
  const STEP = 0.5;
  const MIN_DIM = 4;
  const SHRINK = 0.8;

  // Sort unplaced biggest-first so large rooms get the biggest voids.
  const queue = [...unplaced].sort(
    (a, b) => b.requested_area_sqft - a.requested_area_sqft,
  );

  for (const room of queue) {
    const blockers: Rect[] = [spine.spine];
    for (const r of placedRooms) if (r.placed) blockers.push(r.placed);
    for (const r of newlyPlaced) if (r.placed) blockers.push(r.placed);

    const w = Math.max(room.requested_width_ft, MIN_DIM);
    const d = Math.max(room.requested_depth_ft, MIN_DIM);

    const attempts: Array<{ w: number; d: number; tag: string }> = [
      { w, d, tag: "original" },
      { w: d, d: w, tag: "rotated" },
    ];
    const sw = w * SHRINK;
    const sd = d * SHRINK;
    if (sw >= MIN_DIM && sd >= MIN_DIM) {
      attempts.push({ w: sw, d: sd, tag: "shrunk 20%" });
      attempts.push({ w: sd, d: sw, tag: "shrunk 20% rotated" });
    }

    let placed: Rect | null = null;
    let placedTag = "";
    for (const a of attempts) {
      const fit = scanPlotForFit(a.w, a.d, plot, blockers, STEP);
      if (fit) {
        placed = fit;
        placedTag = a.tag;
        break;
      }
    }

    if (!placed) {
      warnings.push(`${room.name}: COULD NOT PLACE — no void large enough anywhere in plot (critical failure)`);
      continue;
    }

    room.placed = placed;
    room.actual_area_sqft = placed.width * placed.depth;
    newlyPlaced.push(room);
    warnings.push(`${room.name}: overflow-placed (${placedTag}) at (${placed.x.toFixed(1)}, ${placed.y.toFixed(1)}) ${placed.width.toFixed(1)}×${placed.depth.toFixed(1)}ft`);
  }

  return newlyPlaced;
}

/** Grid-scan the plot for the first position where a w×d rect fits without
 *  overlapping any blocker. Returns null if no such position exists. */
function scanPlotForFit(
  w: number,
  d: number,
  plot: Rect,
  blockers: Rect[],
  step: number,
): Rect | null {
  if (w + plot.x > plot.width + plot.x + 1e-6) return null;
  if (d + plot.y > plot.depth + plot.y + 1e-6) return null;
  const xEnd = plot.x + plot.width - w;
  const yEnd = plot.y + plot.depth - d;
  for (let y = plot.y; y <= yEnd + 1e-6; y += step) {
    for (let x = plot.x; x <= xEnd + 1e-6; x += step) {
      const candidate: Rect = { x, y, width: w, depth: d };
      let blocked = false;
      for (const b of blockers) {
        if (rectOverlap(candidate, b) > 1e-3) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return candidate;
    }
  }
  return null;
}
