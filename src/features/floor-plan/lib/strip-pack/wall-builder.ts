/**
 * Step 10 — generate wall segments from placed room rectangles + hallway.
 *
 * Algorithm:
 *   1. Treat the hallway spine as a virtual "room" with id "_HALLWAY_" so
 *      walls between rooms and the hallway emerge naturally.
 *   2. Emit each rectangle's 4 edges as candidate segments tagged with their
 *      room id and axis (horizontal | vertical).
 *   3. Group segments by axis + constant coordinate (collinear sets).
 *   4. Within each collinear group, run a sweep along the variable axis: at
 *      every break-point, record the set of room ids whose edge covers the
 *      interval. Emit one merged WallSegment per (interval, owner-set).
 *   5. Classify each emitted wall:
 *        - exactly 1 owner AND on the plot boundary → EXTERNAL
 *        - any other case → INTERNAL
 *      Internal walls between two rooms appear ONCE (the merge collapsed the
 *      two coincident edges into one segment with two owners).
 *
 * No T-junction splitting — downstream wall renderer handles intersections
 * because Wall.openings + offset_from_start_mm only need the centerline.
 */
import type { Rect, StripPackRoom, SpineLayout, WallSegment } from "./types";
import {
  WALL_THICKNESS_EXT_FT,
  WALL_THICKNESS_INT_FT,
  feq,
} from "./types";

/**
 * Sentinel id used for walls bordering the hallway spine. Kept in the
 * WallSegment.room_ids field so the door-placer (Fix 4) can identify
 * room↔hallway walls without re-running geometry checks. The converter
 * filters this sentinel out when emitting Wall.left_room_id /
 * Wall.right_room_id, so it never leaks into the FloorPlanProject.
 */
export const HALLWAY_SENTINEL_ID = "_HALLWAY_";

const HALLWAY_ID = HALLWAY_SENTINEL_ID;

interface RawEdge {
  axis: "horizontal" | "vertical";
  /** For horizontal: constant Y. For vertical: constant X. */
  k: number;
  /** Variable-axis range: [a, b] with a < b. */
  a: number;
  b: number;
  ownerId: string;
}

export interface WallBuildInput {
  rooms: StripPackRoom[];
  spine: SpineLayout;
  plot: Rect;
}

export function buildWalls(input: WallBuildInput): WallSegment[] {
  const edges: RawEdge[] = [];

  // Room edges
  for (const r of input.rooms) {
    if (!r.placed) continue;
    pushRectEdges(r.placed, r.id, edges);
  }
  // Hallway edges
  pushRectEdges(input.spine.spine, HALLWAY_ID, edges);

  const horizontal = edges.filter(e => e.axis === "horizontal");
  const vertical   = edges.filter(e => e.axis === "vertical");

  const walls: WallSegment[] = [];
  let nextId = 0;
  const newId = () => `w${++nextId}`;

  // Group + sweep horizontal edges by Y.
  const horizByY = groupBy(horizontal, e => e.k.toFixed(3));
  for (const group of horizByY.values()) {
    for (const seg of sweepCollinear(group)) {
      const isOnPlot = feq(seg.k, input.plot.y) || feq(seg.k, input.plot.y + input.plot.depth);
      walls.push({
        id: newId(),
        start: { x: seg.a, y: seg.k },
        end:   { x: seg.b, y: seg.k },
        thickness_ft: classifyThickness(seg.owners, isOnPlot),
        type: classifyType(seg.owners, isOnPlot),
        // Phase 3B fix #4: keep HALLWAY_SENTINEL_ID in owners so the
        // door-placer can identify room↔hallway walls. The converter strips
        // it before emitting Wall.left_room_id / Wall.right_room_id.
        room_ids: [...seg.owners],
        orientation: "horizontal",
      });
    }
  }

  // Group + sweep vertical edges by X.
  const vertByX = groupBy(vertical, e => e.k.toFixed(3));
  for (const group of vertByX.values()) {
    for (const seg of sweepCollinear(group)) {
      const isOnPlot = feq(seg.k, input.plot.x) || feq(seg.k, input.plot.x + input.plot.width);
      walls.push({
        id: newId(),
        start: { x: seg.k, y: seg.a },
        end:   { x: seg.k, y: seg.b },
        thickness_ft: classifyThickness(seg.owners, isOnPlot),
        type: classifyType(seg.owners, isOnPlot),
        // Phase 3B fix #4: keep HALLWAY_SENTINEL_ID in owners so the
        // door-placer can identify room↔hallway walls. The converter strips
        // it before emitting Wall.left_room_id / Wall.right_room_id.
        room_ids: [...seg.owners],
        orientation: "vertical",
      });
    }
  }

  return walls;
}

// ───────────────────────────────────────────────────────────────────────────
// EDGE EXTRACTION
// ───────────────────────────────────────────────────────────────────────────

function pushRectEdges(rect: Rect, id: string, out: RawEdge[]) {
  const xL = rect.x;
  const xR = rect.x + rect.width;
  const yB = rect.y;
  const yT = rect.y + rect.depth;
  out.push({ axis: "horizontal", k: yB, a: xL, b: xR, ownerId: id });
  out.push({ axis: "horizontal", k: yT, a: xL, b: xR, ownerId: id });
  out.push({ axis: "vertical",   k: xL, a: yB, b: yT, ownerId: id });
  out.push({ axis: "vertical",   k: xR, a: yB, b: yT, ownerId: id });
}

function groupBy<T>(arr: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

// ───────────────────────────────────────────────────────────────────────────
// SWEEP-LINE COLLINEAR MERGE
// ───────────────────────────────────────────────────────────────────────────

interface SweepSegment {
  k: number;       // constant axis (Y for horizontal, X for vertical)
  a: number;       // variable axis start
  b: number;       // variable axis end
  owners: string[]; // room ids whose edge covers [a, b]
}

function sweepCollinear(group: RawEdge[]): SweepSegment[] {
  if (group.length === 0) return [];
  const k = group[0].k;

  // Collect unique break-points along the variable axis.
  const breakSet = new Set<number>();
  for (const e of group) {
    breakSet.add(round3(e.a));
    breakSet.add(round3(e.b));
  }
  const breaks = [...breakSet].sort((p, q) => p - q);

  const out: SweepSegment[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    if (b - a < 1e-3) continue;
    const mid = (a + b) / 2;
    const owners: string[] = [];
    for (const e of group) {
      if (e.a < mid && mid < e.b) owners.push(e.ownerId);
    }
    if (owners.length === 0) continue;
    // Dedupe owners (a single room won't appear twice on the same edge
    // unless the edge was double-pushed — defensive).
    const uniq = [...new Set(owners)];
    out.push({ k, a, b, owners: uniq });
  }

  // Merge consecutive segments with the same owner set.
  const merged: SweepSegment[] = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.b - seg.a) < 1e-3 && sameSet(last.owners, seg.owners)) {
      last.b = seg.b;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const A = new Set(a);
  for (const x of b) if (!A.has(x)) return false;
  return true;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ───────────────────────────────────────────────────────────────────────────
// CLASSIFICATION
// ───────────────────────────────────────────────────────────────────────────

function classifyType(owners: string[], isOnPlot: boolean): "external" | "internal" {
  if (isOnPlot && owners.filter(o => o !== HALLWAY_ID).length <= 1 && !owners.includes(HALLWAY_ID)) {
    return "external";
  }
  // A wall on the plot boundary that ALSO is shared with the hallway is
  // technically external; but the hallway never touches the plot perimeter
  // since the spine sits inside. Defensive: still external if isOnPlot.
  if (isOnPlot && owners.filter(o => o !== HALLWAY_ID).length === 1) return "external";
  return "internal";
}

function classifyThickness(owners: string[], isOnPlot: boolean): number {
  return classifyType(owners, isOnPlot) === "external" ? WALL_THICKNESS_EXT_FT : WALL_THICKNESS_INT_FT;
}
