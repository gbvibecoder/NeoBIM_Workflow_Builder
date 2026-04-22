/**
 * Phase 2.7C — Stage 5 Fidelity Mode
 *
 * Preserves Stage 4's extracted room rectangles as the source of truth
 * for the CAD geometry. Derives walls directly from the room edges,
 * places doors at the mid-point of shared interior edges, places
 * windows on the remaining exterior edges by room type. No Option X
 * (adjacency enforcement that moves rooms), no setback shift/clip,
 * no strip-pack re-layout.
 *
 * The goal is a round-trip guarantee: when the user approves the
 * Stage 2 image in the gate, the final CAD matches that image's
 * structure — walls where the image shows walls, rooms where the
 * image shows rooms. Shortcomings in Stage 4 extraction surface as
 * issues in Stage 6's verdict instead of being smoothed over by
 * mutation passes.
 *
 * Dispatched from runStage5Synthesis when Stage 4's average
 * confidence >= 0.75 AND plotBoundsPx is non-null. Override with
 * env var VIP_FORCE_STRIP_PACK=true to go back to the legacy path.
 */

import type {
  Stage5Input,
  Stage5Output,
  AdjacencyDeclaration,
} from "./types";
import type { VIPLogger } from "./logger";
import type {
  StripPackRoom,
  StripPackResult,
  SpineLayout,
  Rect,
  Facing,
  WallSegment,
  DoorPlacement,
  WindowPlacement,
  RoomZone,
} from "../strip-pack/types";
import {
  normalizeFacing,
  WALL_THICKNESS_EXT_FT,
  WALL_THICKNESS_INT_FT,
  feq,
  rectOverlap,
} from "../strip-pack/types";
import { toFloorPlanProject } from "../strip-pack/converter";
import {
  resolvePlotBounds,
  transformToFeet,
  inferZone,
  isWet,
  isSacred,
  type Stage5Metrics,
  type Phase29Telemetry,
  type TransformedRoom,
} from "./stage-5-synthesis";
import { classifyScenario } from "./stage-5-classifier";
import {
  applyDimensionCorrection,
  detectOverlaps,
  clipAllToPlot,
} from "./stage-5-enhance";
import { enforceDeclaredAdjacencies } from "./stage-5-adjacency";

// Shared epsilon for feet-space comparisons. Pixel→feet scaling plus
// the 0.1ft rounding below make 0.15ft a safe tolerance for "same edge"
// matching without munging distinct rooms.
const EDGE_EPS = 0.15;

// Default opening widths.
const INTERIOR_DOOR_WIDTH_FT = 3;
const ENTRANCE_DOOR_WIDTH_FT = 3.5;
const STANDARD_WINDOW_FT = 3;
const LARGE_WINDOW_FT = 4;
const VENT_WINDOW_FT = 1.5;

// ─── Snap / bound helpers ───────────────────────────────────────

function snap01(v: number): number {
  return Math.round(v * 10) / 10;
}

function snapRooms(rooms: TransformedRoom[]): void {
  for (const r of rooms) {
    r.placed.x = snap01(r.placed.x);
    r.placed.y = snap01(r.placed.y);
    r.placed.width = snap01(r.placed.width);
    r.placed.depth = snap01(r.placed.depth);
  }
}

// ─── StripPackRoom construction ─────────────────────────────────

function buildFidelityRooms(transformed: TransformedRoom[]): StripPackRoom[] {
  return transformed.map((r, i) => {
    const zone = inferZone(r.type);
    return {
      id: `vipf-${i}`,
      name: r.name,
      type: r.type,
      requested_width_ft: r.placed.width,
      requested_depth_ft: r.placed.depth,
      requested_area_sqft: r.placed.width * r.placed.depth,
      zone,
      strip: "FRONT" as const,
      adjacencies: [],
      needs_exterior_wall: !isWet(r.type) && zone !== "CIRCULATION",
      is_wet: isWet(r.type),
      is_sacred: isSacred(r.type),
      placed: r.placed,
      actual_area_sqft: r.placed.width * r.placed.depth,
    };
  });
}

// ─── Wall derivation ────────────────────────────────────────────
//
// For each room, each of its 4 edges (N/E/S/W) is considered. Edges
// that match another room's opposing edge (right-of-A == left-of-B,
// Y-spans overlap) become ONE interior wall covering the overlap.
// Whatever remains of the edge after subtracting all shared intervals
// becomes exterior walls. Result: every room's perimeter is fully
// covered, no duplicated interior walls.

interface Interval {
  a: number;
  b: number;
}

function unionIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((x, y) => x.a - y.a);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.a <= last.b + EDGE_EPS) {
      last.b = Math.max(last.b, cur.b);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function subtractIntervals(edge: Interval, holes: Interval[]): Interval[] {
  // Edge = [edge.a, edge.b]. Remove each hole. Result: disjoint intervals.
  const merged = unionIntervals(holes);
  const out: Interval[] = [];
  let cursor = edge.a;
  for (const h of merged) {
    if (h.b <= cursor + EDGE_EPS) continue;
    if (h.a >= edge.b - EDGE_EPS) break;
    const hA = Math.max(cursor, h.a);
    const hB = Math.min(edge.b, h.b);
    if (hA > cursor + EDGE_EPS) out.push({ a: cursor, b: hA });
    cursor = Math.max(cursor, hB);
  }
  if (cursor < edge.b - EDGE_EPS) out.push({ a: cursor, b: edge.b });
  return out;
}

interface SharedEdge {
  axis: "vertical" | "horizontal";
  coord: number; // x for vertical, y for horizontal
  span: Interval; // y-range for vertical, x-range for horizontal
  roomA: string; // id
  roomB: string; // id
}

function deriveWalls(rooms: StripPackRoom[]): WallSegment[] {
  const walls: WallSegment[] = [];
  let idCounter = 0;
  const mkId = () => `w${idCounter++}`;

  // 1. Find all shared edges (interior walls).
  const shared: SharedEdge[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const A = rooms[i].placed;
    if (!A) continue;
    for (let j = i + 1; j < rooms.length; j++) {
      const B = rooms[j].placed;
      if (!B) continue;

      // Vertical: A.right == B.left OR A.left == B.right
      const coordV =
        feq(A.x + A.width, B.x, EDGE_EPS)
          ? A.x + A.width
          : feq(B.x + B.width, A.x, EDGE_EPS)
            ? A.x
            : null;
      if (coordV !== null) {
        const y0 = Math.max(A.y, B.y);
        const y1 = Math.min(A.y + A.depth, B.y + B.depth);
        if (y1 > y0 + EDGE_EPS) {
          shared.push({
            axis: "vertical",
            coord: coordV,
            span: { a: y0, b: y1 },
            roomA: rooms[i].id,
            roomB: rooms[j].id,
          });
        }
      }

      // Horizontal: A.top == B.bottom OR A.bottom == B.top
      const coordH =
        feq(A.y + A.depth, B.y, EDGE_EPS)
          ? A.y + A.depth
          : feq(B.y + B.depth, A.y, EDGE_EPS)
            ? A.y
            : null;
      if (coordH !== null) {
        const x0 = Math.max(A.x, B.x);
        const x1 = Math.min(A.x + A.width, B.x + B.width);
        if (x1 > x0 + EDGE_EPS) {
          shared.push({
            axis: "horizontal",
            coord: coordH,
            span: { a: x0, b: x1 },
            roomA: rooms[i].id,
            roomB: rooms[j].id,
          });
        }
      }
    }
  }

  // Emit interior wall segments (one per shared edge).
  for (const s of shared) {
    if (s.axis === "vertical") {
      walls.push({
        id: mkId(),
        start: { x: s.coord, y: s.span.a },
        end: { x: s.coord, y: s.span.b },
        thickness_ft: WALL_THICKNESS_INT_FT,
        type: "internal",
        room_ids: [s.roomA, s.roomB],
        orientation: "vertical",
      });
    } else {
      walls.push({
        id: mkId(),
        start: { x: s.span.a, y: s.coord },
        end: { x: s.span.b, y: s.coord },
        thickness_ft: WALL_THICKNESS_INT_FT,
        type: "internal",
        room_ids: [s.roomA, s.roomB],
        orientation: "horizontal",
      });
    }
  }

  // 2. Exterior walls = room edges minus union of shared intervals on that edge.
  for (const room of rooms) {
    const R = room.placed;
    if (!R) continue;
    const rightX = R.x + R.width;
    const topY = R.y + R.depth;

    // For each of the 4 edges, collect all shared intervals that LIVE on that edge.
    const sharedOnLeft = shared
      .filter((s) => s.axis === "vertical" && feq(s.coord, R.x, EDGE_EPS) && (s.roomA === room.id || s.roomB === room.id))
      .map((s) => s.span);
    const sharedOnRight = shared
      .filter((s) => s.axis === "vertical" && feq(s.coord, rightX, EDGE_EPS) && (s.roomA === room.id || s.roomB === room.id))
      .map((s) => s.span);
    const sharedOnBottom = shared
      .filter((s) => s.axis === "horizontal" && feq(s.coord, R.y, EDGE_EPS) && (s.roomA === room.id || s.roomB === room.id))
      .map((s) => s.span);
    const sharedOnTop = shared
      .filter((s) => s.axis === "horizontal" && feq(s.coord, topY, EDGE_EPS) && (s.roomA === room.id || s.roomB === room.id))
      .map((s) => s.span);

    const exteriorLeft = subtractIntervals({ a: R.y, b: R.y + R.depth }, sharedOnLeft);
    const exteriorRight = subtractIntervals({ a: R.y, b: R.y + R.depth }, sharedOnRight);
    const exteriorBottom = subtractIntervals({ a: R.x, b: R.x + R.width }, sharedOnBottom);
    const exteriorTop = subtractIntervals({ a: R.x, b: R.x + R.width }, sharedOnTop);

    for (const seg of exteriorLeft) {
      walls.push({
        id: mkId(),
        start: { x: R.x, y: seg.a },
        end: { x: R.x, y: seg.b },
        thickness_ft: WALL_THICKNESS_EXT_FT,
        type: "external",
        room_ids: [room.id],
        orientation: "vertical",
      });
    }
    for (const seg of exteriorRight) {
      walls.push({
        id: mkId(),
        start: { x: rightX, y: seg.a },
        end: { x: rightX, y: seg.b },
        thickness_ft: WALL_THICKNESS_EXT_FT,
        type: "external",
        room_ids: [room.id],
        orientation: "vertical",
      });
    }
    for (const seg of exteriorBottom) {
      walls.push({
        id: mkId(),
        start: { x: seg.a, y: R.y },
        end: { x: seg.b, y: R.y },
        thickness_ft: WALL_THICKNESS_EXT_FT,
        type: "external",
        room_ids: [room.id],
        orientation: "horizontal",
      });
    }
    for (const seg of exteriorTop) {
      walls.push({
        id: mkId(),
        start: { x: seg.a, y: topY },
        end: { x: seg.b, y: topY },
        thickness_ft: WALL_THICKNESS_EXT_FT,
        type: "external",
        room_ids: [room.id],
        orientation: "horizontal",
      });
    }
  }

  return walls;
}

// ─── Door placement ─────────────────────────────────────────────

function isCirculation(type: string): boolean {
  return ["living", "drawing_room", "hall", "hallway", "corridor", "passage", "foyer"].includes(type);
}

function lookupRoom(rooms: StripPackRoom[], id: string): StripPackRoom | undefined {
  return rooms.find((r) => r.id === id);
}

function placeFidelityDoors(
  rooms: StripPackRoom[],
  walls: WallSegment[],
  facing: Facing,
  plotW: number,
  plotD: number,
  _adjacencies: AdjacencyDeclaration[],
): DoorPlacement[] {
  const doors: DoorPlacement[] = [];

  // 1. One door per unique pair of rooms that share an interior wall.
  //    If a pair shares multiple wall segments (L-shape contact), pick
  //    the longest segment.
  const bestByPair = new Map<string, WallSegment>();
  for (const w of walls) {
    if (w.type !== "internal" || w.room_ids.length !== 2) continue;
    const [a, b] = [...w.room_ids].sort();
    const key = `${a}|${b}`;
    const len = segmentLength(w);
    const cur = bestByPair.get(key);
    if (!cur || segmentLength(cur) < len) bestByPair.set(key, w);
  }

  for (const [, w] of bestByPair) {
    const doorWidth = Math.min(INTERIOR_DOOR_WIDTH_FT, segmentLength(w) - 0.4);
    if (doorWidth < 1.5) continue; // Wall too short to host a door cleanly.

    const [aName, bName] = w.room_ids.map(
      (id) => lookupRoom(rooms, id)?.name ?? id,
    );
    // Ordering convention: primary (circulation) first, secondary second.
    const aRoom = lookupRoom(rooms, w.room_ids[0]);
    const bRoom = lookupRoom(rooms, w.room_ids[1]);
    const aIsPrimary = aRoom ? isCirculation(aRoom.type) : false;
    const bIsPrimary = bRoom ? isCirculation(bRoom.type) : false;
    const between: [string, string] =
      aIsPrimary && !bIsPrimary
        ? [aName, bName]
        : bIsPrimary && !aIsPrimary
          ? [bName, aName]
          : [aName, bName];

    if (w.orientation === "vertical") {
      const midY = (w.start.y + w.end.y) / 2;
      doors.push({
        start: { x: w.start.x, y: midY - doorWidth / 2 },
        end: { x: w.start.x, y: midY + doorWidth / 2 },
        between,
        width_ft: doorWidth,
        orientation: "vertical",
        wall_id: w.id,
      });
    } else {
      const midX = (w.start.x + w.end.x) / 2;
      doors.push({
        start: { x: midX - doorWidth / 2, y: w.start.y },
        end: { x: midX + doorWidth / 2, y: w.start.y },
        between,
        width_ft: doorWidth,
        orientation: "horizontal",
        wall_id: w.id,
      });
    }
  }

  // 2. Entrance door — place on the exterior wall of a circulation-ish
  //    room (living / foyer / porch) along the facing edge. If no such
  //    room touches the facing edge, pick the largest room on it.
  const entranceWall = pickEntranceWall(rooms, walls, facing, plotW, plotD);
  if (entranceWall) {
    const w = entranceWall;
    const len = segmentLength(w);
    const doorWidth = Math.min(ENTRANCE_DOOR_WIDTH_FT, Math.max(2.5, len - 0.4));
    const roomName = lookupRoom(rooms, w.room_ids[0])?.name ?? "entrance";
    if (w.orientation === "horizontal") {
      const midX = (w.start.x + w.end.x) / 2;
      doors.push({
        start: { x: midX - doorWidth / 2, y: w.start.y },
        end: { x: midX + doorWidth / 2, y: w.start.y },
        between: [roomName, "exterior"],
        width_ft: doorWidth,
        orientation: "horizontal",
        wall_id: w.id,
        is_main_entrance: true,
      });
    } else {
      const midY = (w.start.y + w.end.y) / 2;
      doors.push({
        start: { x: w.start.x, y: midY - doorWidth / 2 },
        end: { x: w.start.x, y: midY + doorWidth / 2 },
        between: [roomName, "exterior"],
        width_ft: doorWidth,
        orientation: "vertical",
        wall_id: w.id,
        is_main_entrance: true,
      });
    }
  }

  return doors;
}

function segmentLength(w: WallSegment): number {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Pick the exterior wall most likely to host the main entrance. */
function pickEntranceWall(
  rooms: StripPackRoom[],
  walls: WallSegment[],
  facing: Facing,
  plotW: number,
  plotD: number,
): WallSegment | null {
  // Filter to exterior walls that lie on the plot's facing edge.
  const isOnFacingEdge = (w: WallSegment): boolean => {
    if (w.type !== "external") return false;
    switch (facing) {
      case "north":
        return feq(w.start.y, plotD, EDGE_EPS) && feq(w.end.y, plotD, EDGE_EPS);
      case "south":
        return feq(w.start.y, 0, EDGE_EPS) && feq(w.end.y, 0, EDGE_EPS);
      case "east":
        return feq(w.start.x, plotW, EDGE_EPS) && feq(w.end.x, plotW, EDGE_EPS);
      case "west":
        return feq(w.start.x, 0, EDGE_EPS) && feq(w.end.x, 0, EDGE_EPS);
    }
  };

  const facingWalls = walls.filter(isOnFacingEdge);
  if (facingWalls.length === 0) return null;

  // Score each wall by the attached room's suitability as entrance host.
  const typePriority: Record<string, number> = {
    foyer: 10, porch: 9, living: 8, drawing_room: 8, hall: 7,
    hallway: 6, corridor: 6, dining: 5, kitchen: 3,
  };

  let best: WallSegment | null = null;
  let bestScore = -Infinity;
  for (const w of facingWalls) {
    const room = lookupRoom(rooms, w.room_ids[0]);
    const prio = room ? (typePriority[room.type] ?? 1) : 1;
    const len = segmentLength(w);
    // Prefer high-priority rooms, then longer walls.
    const score = prio * 100 + len;
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

// ─── Window placement ───────────────────────────────────────────

function shouldHaveWindow(type: string): { width: number; kind: "standard" | "large" | "ventilation"; sill: number } | null {
  if (["living", "drawing_room", "hall"].includes(type)) {
    return { width: LARGE_WINDOW_FT, kind: "large", sill: 2.5 };
  }
  if (["bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom", "study"].includes(type)) {
    return { width: STANDARD_WINDOW_FT, kind: "standard", sill: 3 };
  }
  if (["dining", "kitchen"].includes(type)) {
    return { width: STANDARD_WINDOW_FT, kind: "standard", sill: 3 };
  }
  if (["bathroom", "master_bathroom", "powder_room", "toilet"].includes(type)) {
    return { width: VENT_WINDOW_FT, kind: "ventilation", sill: 6 };
  }
  if (["utility", "laundry"].includes(type)) {
    return { width: VENT_WINDOW_FT, kind: "ventilation", sill: 6 };
  }
  // Hallway, corridor, pooja, store, closet → no window by default.
  return null;
}

function placeFidelityWindows(
  rooms: StripPackRoom[],
  walls: WallSegment[],
  doors: DoorPlacement[],
  _facing: Facing,
  plotW: number,
  plotD: number,
): WindowPlacement[] {
  const windows: WindowPlacement[] = [];
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const doorWallIds = new Set(doors.map((d) => d.wall_id).filter(Boolean));

  for (const w of walls) {
    if (w.type !== "external") continue;
    if (w.room_ids.length !== 1) continue;
    const room = roomsById.get(w.room_ids[0]);
    if (!room) continue;
    const policy = shouldHaveWindow(room.type);
    if (!policy) continue;

    const len = segmentLength(w);
    if (len < policy.width + 0.5) continue; // Wall too short.

    // Skip walls that already host a door to avoid overlaps (rare given
    // entrance is the only exterior door; still defensive).
    if (doorWallIds.has(w.id)) continue;

    const wallSide: Facing = ((): Facing => {
      if (w.orientation === "horizontal") {
        return feq(w.start.y, plotD, EDGE_EPS) ? "north" : feq(w.start.y, 0, EDGE_EPS) ? "south" : "north";
      }
      return feq(w.start.x, plotW, EDGE_EPS) ? "east" : feq(w.start.x, 0, EDGE_EPS) ? "west" : "north";
    })();

    if (w.orientation === "horizontal") {
      const midX = (w.start.x + w.end.x) / 2;
      windows.push({
        on_room: room.name,
        start: { x: midX - policy.width / 2, y: w.start.y },
        end: { x: midX + policy.width / 2, y: w.start.y },
        wall_side: wallSide,
        width_ft: policy.width,
        kind: policy.kind,
        wall_id: w.id,
        sill_height_ft: policy.sill,
      });
    } else {
      const midY = (w.start.y + w.end.y) / 2;
      windows.push({
        on_room: room.name,
        start: { x: w.start.x, y: midY - policy.width / 2 },
        end: { x: w.start.x, y: midY + policy.width / 2 },
        wall_side: wallSide,
        width_ft: policy.width,
        kind: policy.kind,
        wall_id: w.id,
        sill_height_ft: policy.sill,
      });
    }
  }

  return windows;
}

// ─── Validation (flag, don't fix) ──────────────────────────────

function validateFidelity(
  rooms: StripPackRoom[],
  plotWidthFt: number,
  plotDepthFt: number,
  doors: DoorPlacement[],
): string[] {
  const issues: string[] = [];

  // Overlap check.
  for (let i = 0; i < rooms.length; i++) {
    const A = rooms[i].placed;
    if (!A) continue;
    for (let j = i + 1; j < rooms.length; j++) {
      const B = rooms[j].placed;
      if (!B) continue;
      const ov = rectOverlap(A, B);
      if (ov > 0.5) {
        issues.push(
          `fidelity: rooms "${rooms[i].name}" and "${rooms[j].name}" overlap by ${ov.toFixed(1)} sqft (preserved as-is)`,
        );
      }
    }
  }

  // Out-of-bounds check.
  for (const r of rooms) {
    const p = r.placed;
    if (!p) continue;
    if (p.x < -0.15 || p.y < -0.15 || p.x + p.width > plotWidthFt + 0.15 || p.y + p.depth > plotDepthFt + 0.15) {
      issues.push(
        `fidelity: room "${r.name}" extends beyond plot bounds (preserved as-is)`,
      );
    }
  }

  // Orphan check — rooms with no walls.
  for (const r of rooms) {
    if (!r.wall_ids || r.wall_ids.length === 0) {
      issues.push(`fidelity: room "${r.name}" has no derived walls (unexpected)`);
    }
  }

  // Connectivity heuristic — need at least roomCount - 1 doors for a tree.
  if (doors.length < rooms.length - 1 && rooms.length > 1) {
    issues.push(
      `fidelity: only ${doors.length} doors for ${rooms.length} rooms — some rooms may be disconnected in the extracted image`,
    );
  }

  return issues;
}

// ─── Synthetic spine stub ───────────────────────────────────────
//
// StripPackResult requires a SpineLayout even though fidelity mode
// doesn't use a corridor-as-spine concept. If a hallway room exists,
// use its rect; otherwise mock a centered sliver just to satisfy the
// type. Downstream renderers ignore spine geometry in favor of the
// explicit walls we supply.

function buildStubSpine(
  rooms: StripPackRoom[],
  plotW: number,
  plotD: number,
  facing: Facing,
): SpineLayout {
  const hallway = rooms.find((r) => r.type === "hallway" || r.type === "corridor" || r.type === "passage");
  // Phase 2.11.1 — fidelity mode's spine is ALWAYS synthetic: the Rect is
  // only here to satisfy SpineLayout's shape contract. Set synthetic=true
  // so the converter skips emitting a phantom "Hallway" Room. When the
  // extraction contains a real corridor/hallway room, that room is
  // already in `rooms` and will be emitted by the normal for-loop in
  // converter.buildRooms — we never want DOUBLE emission.
  const hallwayRect: Rect = hallway?.placed
    ? hallway.placed
    : { x: 0, y: plotD * 0.5, width: plotW, depth: 0.01 };
  const entranceSide: Facing = facing;
  return {
    spine: hallwayRect,
    front_strip: { x: 0, y: 0, width: plotW, depth: plotD * 0.5 },
    back_strip: { x: 0, y: plotD * 0.5, width: plotW, depth: plotD * 0.5 },
    entrance_rooms: [],
    remaining_front: [{ x: 0, y: 0, width: plotW, depth: plotD * 0.5 }],
    orientation: hallwayRect.width >= hallwayRect.depth ? "horizontal" : "vertical",
    entrance_side: entranceSide,
    hallway_width_ft: Math.max(3.5, hallwayRect.depth),
    synthetic: true,
  };
}

// ─── Re-exported zone type (for tests) ─────────────────────────
export type { RoomZone };

// ─── Main entry ─────────────────────────────────────────────────

export async function runStage5FidelityMode(
  input: Stage5Input,
  logger?: VIPLogger,
): Promise<{ output: Stage5Output; metrics: Stage5Metrics }> {
  const startMs = Date.now();
  const issues: string[] = [];
  const {
    extraction,
    plotWidthFt,
    plotDepthFt,
    facing,
    parsedConstraints,
  } = input;

  const avgConfidence =
    extraction.rooms.length > 0
      ? extraction.rooms.reduce((s, r) => s + r.confidence, 0) / extraction.rooms.length
      : 0;

  // 1. Plot bounds.
  const plotBoundsPx = resolvePlotBounds(extraction, issues);

  // 2. Pixel → feet transform (shared helper; no mutation of original rooms).
  const transformed = transformToFeet(
    extraction.rooms,
    plotBoundsPx,
    plotWidthFt,
    plotDepthFt,
    issues,
  );
  if (transformed.length === 0) {
    throw new Error("Stage 5 (fidelity): all rooms eliminated during transform");
  }
  snapRooms(transformed);

  // 3. Dedupe names in place (do NOT reshape/move). This matters when
  //    Stage 4 returned duplicate labels; giving each a unique name
  //    keeps the renderer + adjacency evaluator honest.
  const seen = new Map<string, number>();
  for (const r of transformed) {
    const key = r.name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) {
      const newName = `${r.name} ${n + 1}`;
      issues.push(
        `fidelity: duplicate "${r.labelAsShown}" renamed to "${newName}" (position preserved)`,
      );
      r.name = newName;
    }
  }

  // 4. Populate types from parsed constraints (for classification only).
  for (const room of transformed) {
    const pr = parsedConstraints.rooms?.find(
      (p) => p.name.toLowerCase() === room.name.toLowerCase(),
    );
    if (pr) room.type = pr.function;
  }

  // 5b. Phase 2.9 — adaptive dimension enhancement + adjacency
  //     enforcement. Classifier-gated so that we only mutate when the
  //     scenario is boring enough (rectangular plot, sane room count,
  //     residential prompt, grid-square bias detected). Every pass is
  //     rolled back cleanly if it introduces overlaps or clipping —
  //     the pre-correction state is the guaranteed fallback.
  const enhancement = runPhase29Enhancement(
    transformed,
    input,
    plotWidthFt,
    plotDepthFt,
    issues,
  );
  const enhanced = enhancement.rooms;

  // 6. Build StripPackRooms with .placed preserved from (possibly
  //    enhanced) transformed rooms.
  const spRooms = buildFidelityRooms(enhanced);

  // 6. Derive walls directly from room edges.
  const walls = deriveWalls(spRooms);

  // 7. Wire wall_ids onto rooms.
  const wallsByRoom = new Map<string, string[]>();
  for (const w of walls) {
    for (const id of w.room_ids) {
      if (!wallsByRoom.has(id)) wallsByRoom.set(id, []);
      wallsByRoom.get(id)!.push(w.id);
    }
  }
  for (const r of spRooms) r.wall_ids = wallsByRoom.get(r.id) ?? [];

  // 8. Doors + windows.
  const nFacing = normalizeFacing(facing);
  const doors = placeFidelityDoors(
    spRooms,
    walls,
    nFacing,
    plotWidthFt,
    plotDepthFt,
    input.adjacencies ?? [],
  );
  const windows = placeFidelityWindows(spRooms, walls, doors, nFacing, plotWidthFt, plotDepthFt);

  // 9. Validation (flag, don't fix).
  issues.push(...validateFidelity(spRooms, plotWidthFt, plotDepthFt, doors));

  // 10. StripPackResult + convert.
  const plotRect: Rect = { x: 0, y: 0, width: plotWidthFt, depth: plotDepthFt };
  const spine = buildStubSpine(spRooms, plotWidthFt, plotDepthFt, nFacing);
  const totalRoomArea = spRooms.reduce((s, r) => s + (r.actual_area_sqft ?? 0), 0);
  const plotArea = plotWidthFt * plotDepthFt;

  const stripPackResult: StripPackResult = {
    rooms: spRooms,
    spine,
    walls,
    doors,
    windows,
    plot: plotRect,
    metrics: {
      efficiency_pct: Math.round((totalRoomArea / plotArea) * 100),
      void_area_sqft: Math.max(0, plotArea - totalRoomArea),
      door_coverage_pct:
        spRooms.length > 0
          ? Math.round(
              (new Set(doors.flatMap((d) => d.between)).size / spRooms.length) * 100,
            )
          : 0,
      orphan_rooms: [],
      adjacency_satisfaction_pct: 0, // not scored in fidelity mode
      total_rooms: spRooms.length,
      rooms_with_doors: new Set(doors.flatMap((d) => d.between)).size,
      required_adjacencies: 0,
      satisfied_adjacencies: 0,
    },
    warnings: issues,
  };

  const project = toFloorPlanProject(
    stripPackResult,
    parsedConstraints,
    `VIP floor plan fidelity (${plotWidthFt}×${plotDepthFt}ft ${facing}-facing)`,
  );
  const meta = project.metadata as unknown as Record<string, unknown>;
  meta.generation_model = "vip-pipeline";
  meta.generation_stage5_path = "fidelity";
  meta.generation_stage4_avg_confidence = Math.round(avgConfidence * 100) / 100;

  if (logger) logger.logStageCost(5, 0);

  return {
    output: { project, issues },
    metrics: {
      durationMs: Date.now() - startMs,
      roomCount: spRooms.length,
      wallCount: walls.length,
      doorCount: doors.length,
      windowCount: windows.length,
      path: "fidelity",
      avgConfidence,
      enhancement: enhancement.telemetry,
    },
  };
}

// ─── Phase 2.9: adaptive enhancement ────────────────────────────

interface Phase29Result {
  rooms: TransformedRoom[];
  telemetry: Phase29Telemetry;
}

/**
 * Phase 2.9 enhancement: run the classifier, then (if gated ON) apply
 * dimension correction + declared-adjacency enforcement, with a fresh
 * overlap check after each pass. Each pass is either kept in full or
 * rolled back in full — never partially applied.
 *
 * Order matters:
 *   1. Dimension correction FIRST (rooms get their right sizes).
 *   2. Adjacency enforcement SECOND (smaller room snaps to larger's
 *      edge; works best once larger is at its true size).
 *   3. Final plot-clip safety net (last line of defense).
 *
 * Any step that produces an overlap or can't run cleanly is reverted.
 */
function runPhase29Enhancement(
  transformed: TransformedRoom[],
  input: Stage5Input,
  plotWidthFt: number,
  plotDepthFt: number,
  issues: string[],
): Phase29Result {
  const classification = classifyScenario({
    extraction: input.extraction,
    brief: input.brief,
    userPrompt: input.userPrompt,
    plotWidthFt,
    plotDepthFt,
  });

  const telemetry: Phase29Telemetry = {
    classification: {
      enhanceDimensions: classification.enhanceDimensions,
      isRectangular: classification.isRectangular,
      plotSqft: classification.plotSqft,
      plotSizeCategory: classification.plotSizeCategory,
      isResidential: classification.isResidential,
      hasGridSquareBias: classification.hasGridSquareBias,
      roomCount: classification.roomCount,
      reasonsForFallback: classification.reasonsForFallback,
    },
    dimensionCorrection: { attempted: false, applied: false, records: [] },
    adjacencyEnforcement: { attempted: false, applied: false, records: [] },
  };

  let current = transformed;

  // ─ Pass 1: dimension correction (only when classifier allows). ─
  if (classification.enhanceDimensions && input.brief) {
    telemetry.dimensionCorrection.attempted = true;
    const snapshot = current.map((r) => ({ ...r, placed: { ...r.placed } }));
    const correction = applyDimensionCorrection({
      rooms: current,
      brief: input.brief,
      plotWidthFt,
      plotDepthFt,
    });
    telemetry.dimensionCorrection.records = correction.applied.map((r) => ({
      room: r.room,
      originalArea: r.originalArea,
      targetArea: r.targetArea,
      correctedArea: r.correctedArea,
      action: r.action,
      note: r.note,
    }));

    const overlaps = detectOverlaps(correction.rooms);
    if (overlaps.length > 0) {
      const reason =
        `rollback — correction produced ${overlaps.length} overlap` +
        `${overlaps.length === 1 ? "" : "s"} (${overlaps
          .slice(0, 3)
          .map((o) => `${o.a}×${o.b}`)
          .join(", ")})`;
      telemetry.dimensionCorrection.rollbackReason = reason;
      issues.push(`fidelity 2.9: dimension correction reverted — ${reason}`);
      current = snapshot;
    } else {
      telemetry.dimensionCorrection.applied = true;
      current = correction.rooms;
    }
  }

  // ─ Pass 2: declared-adjacency enforcement. ─
  const declaredPairs = (input.adjacencies ?? []).filter(
    (d) => d.relationship === "attached" || d.relationship === "direct-access",
  );
  if (classification.enhanceDimensions && declaredPairs.length > 0) {
    telemetry.adjacencyEnforcement.attempted = true;
    const snapshot = current.map((r) => ({ ...r, placed: { ...r.placed } }));
    const adj = enforceDeclaredAdjacencies({
      rooms: current,
      adjacencies: input.adjacencies ?? [],
      brief: input.brief,
      plotWidthFt,
      plotDepthFt,
    });
    telemetry.adjacencyEnforcement.records = adj.records.map((r) => ({
      a: r.a,
      b: r.b,
      relationship: r.relationship,
      action: r.action,
      edge: r.edge,
      note: r.note,
    }));

    const overlaps = detectOverlaps(adj.rooms);
    if (overlaps.length > 0) {
      const reason =
        `rollback — adjacency enforcement produced ${overlaps.length} overlap` +
        `${overlaps.length === 1 ? "" : "s"} (${overlaps
          .slice(0, 3)
          .map((o) => `${o.a}×${o.b}`)
          .join(", ")})`;
      telemetry.adjacencyEnforcement.rollbackReason = reason;
      issues.push(`fidelity 2.9: adjacency enforcement reverted — ${reason}`);
      current = snapshot;
    } else {
      telemetry.adjacencyEnforcement.applied = true;
      current = adj.rooms;
    }
  }

  // ─ Final safety net: clip any drift to plot bounds. ─
  if (telemetry.dimensionCorrection.applied || telemetry.adjacencyEnforcement.applied) {
    const clipResult = clipAllToPlot(current, plotWidthFt, plotDepthFt);
    if (clipResult.clips.length > 0) {
      for (const c of clipResult.clips) {
        issues.push(
          `fidelity 2.9: clipped "${c.room}" to plot bounds after enhancement`,
        );
      }
      current = clipResult.rooms;
    }
  }

  return { rooms: current, telemetry };
}

// ─── Test-only exports ──────────────────────────────────────────

export const __internals = {
  deriveWalls,
  placeFidelityDoors,
  placeFidelityWindows,
  validateFidelity,
  buildFidelityRooms,
  shouldDispatchFidelity,
  runPhase29Enhancement,
};

/**
 * Shared dispatch predicate used by runStage5Synthesis to pick which
 * path to run. Exported + tested separately so the thresholds stay
 * deterministic and we don't mock env vars in integration tests.
 */
export function shouldDispatchFidelity(
  extraction: Stage5Input["extraction"],
  env: Record<string, string | undefined> = process.env,
): { use: boolean; avgConfidence: number; reason: string } {
  if (env.VIP_FORCE_STRIP_PACK === "true") {
    return { use: false, avgConfidence: 0, reason: "VIP_FORCE_STRIP_PACK=true" };
  }
  // Phase 2.4 setback enforcement (shift + clip) is implemented inside
  // the strip-pack path. When the flag is on, the operator explicitly
  // wants setback-compliant geometry even if that means deviating from
  // the approved image — so fidelity mode steps aside.
  if (env.PHASE_2_4_SETBACKS === "true") {
    return { use: false, avgConfidence: 0, reason: "PHASE_2_4_SETBACKS=true (strip-pack owns setbacks)" };
  }
  if (!extraction || extraction.rooms.length === 0) {
    return { use: false, avgConfidence: 0, reason: "no rooms extracted" };
  }
  if (!extraction.plotBoundsPx) {
    return { use: false, avgConfidence: 0, reason: "no plotBounds" };
  }
  const avgConfidence =
    extraction.rooms.reduce((s, r) => s + r.confidence, 0) / extraction.rooms.length;
  if (avgConfidence < 0.75) {
    return { use: false, avgConfidence, reason: `avgConfidence ${avgConfidence.toFixed(2)} < 0.75` };
  }
  return { use: true, avgConfidence, reason: `avgConfidence ${avgConfidence.toFixed(2)} >= 0.75` };
}
