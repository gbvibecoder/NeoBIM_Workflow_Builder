import type { ParsedConstraints, ParsedRoom, CenterDirection } from "../structured-parser";
import type { RoomFunction } from "../room-vocabulary";
import { logger } from "@/lib/logger";
import {
  CELL_CENTER,
  type CellIdx,
  cellCoords,
} from "./domains";
import type { MandalaAssignment } from "./mandala-csp";
import type { ConflictSet } from "./unsat-explainer";
import {
  rectCenter,
  rectOverlaps,
  rectTouchesCorner,
  rectsSharedEdgeLength,
  type Rect,
} from "./geometry-utils";

// ── Constants ──

export const GRID_FT = 0.5;
const STEPS_PER_FT = 2;
const DEFAULT_SLACK_FT = 2.0;
const MIN_SHARED_EDGE_FT = 3.0;
const DEFAULT_TIME_LIMIT_MS = 5000;
const DIM_TOLERANCE = 0.05;

const DEFAULT_DIMS_FT: Record<string, [number, number]> = {
  bedroom: [12, 11],
  master_bedroom: [14, 13],
  guest_bedroom: [12, 11],
  kids_bedroom: [11, 10],
  living: [16, 13],
  dining: [12, 11],
  kitchen: [10, 9],
  bathroom: [7, 5],
  master_bathroom: [9, 6],
  powder_room: [5, 4],
  walk_in_wardrobe: [7, 5],
  walk_in_closet: [7, 5],
  foyer: [8, 7],
  porch: [9, 6],
  verandah: [12, 8],
  balcony: [10, 4],
  corridor: [12, 4],
  staircase: [10, 8],
  utility: [6, 5],
  store: [6, 5],
  pooja: [5, 4],
  study: [10, 9],
  servant_quarter: [9, 8],
  other: [10, 8],
};

const MIN_DIM_FT: Record<string, number> = {
  bedroom: 8, master_bedroom: 10, guest_bedroom: 8, kids_bedroom: 7,
  living: 10, dining: 8, kitchen: 6,
  bathroom: 3, master_bathroom: 4, powder_room: 3,
  walk_in_wardrobe: 3, walk_in_closet: 3,
  foyer: 4, porch: 4, verandah: 5, balcony: 3,
  corridor: 3, staircase: 6, utility: 3,
  store: 3, pooja: 3, study: 6,
  servant_quarter: 6, other: 5,
};

const NEEDS_EXTERIOR_WALL: Set<RoomFunction> = new Set([
  "master_bedroom", "bedroom", "guest_bedroom", "kids_bedroom",
  "living", "dining", "kitchen", "study",
  "balcony", "verandah", "porch", "foyer",
]);

// ── Types ──

export interface FinePlacement {
  room_id: string;
  room_name: string;
  function: string;
  mandala_cell: CellIdx;
  mandala_direction: CenterDirection;
  x_ft: number;
  y_ft: number;
  width_ft: number;
  depth_ft: number;
}

export interface Stage3BOptions {
  timeLimitMs?: number;
  slackFt?: number;
  dimToleranceFactor?: number;
}

export interface Stage3BResult {
  feasible: boolean;
  placements: FinePlacement[];
  conflict: ConflictSet | null;
  iterations: number;
  elapsed_ms: number;
  relaxations_applied: string[];
  plot_width_ft: number;
  plot_depth_ft: number;
}

// ── Internal types ──

interface Variable {
  id: string;
  room: ParsedRoom;
  width_ft: number;
  depth_ft: number;
  mandala_cell: CellIdx;
  mandala_direction: CenterDirection;
  domain: Set<number>;
  parentId: string | null;
  yStride: number;
}

// ── Utility ──

function roomDims(room: ParsedRoom): [number, number] {
  if (room.dim_width_ft != null && room.dim_depth_ft != null) {
    return [room.dim_width_ft, room.dim_depth_ft];
  }
  return DEFAULT_DIMS_FT[room.function] ?? [10, 8];
}

function snap(v: number): number {
  return Math.round(v * STEPS_PER_FT) / STEPS_PER_FT;
}

function originKey(xIdx: number, yIdx: number, yStride: number): number {
  return xIdx * yStride + yIdx;
}

function decodeKey(key: number, yStride: number): { xIdx: number; yIdx: number } {
  return { xIdx: Math.floor(key / yStride), yIdx: key % yStride };
}

function keyToFt(key: number, yStride: number): { x: number; y: number } {
  const { xIdx, yIdx } = decodeKey(key, yStride);
  return { x: xIdx / STEPS_PER_FT, y: yIdx / STEPS_PER_FT };
}

function rectForVar(v: Variable, x: number, y: number): Rect {
  return { x, y, width: v.width_ft, depth: v.depth_ft };
}

function cellToBBox(cell: CellIdx, plotW: number, plotD: number): { x1: number; y1: number; x2: number; y2: number } {
  const { col, row } = cellCoords(cell);
  const cellW = plotW / 3;
  const cellD = plotD / 3;
  return {
    x1: col * cellW,
    y1: row * cellD,
    x2: (col + 1) * cellW,
    y2: (row + 1) * cellD,
  };
}

// ── Domain construction ──

function buildFullPlotDomain(widthFt: number, depthFt: number, plotW: number, plotD: number, yStride: number): Set<number> {
  const dom = new Set<number>();
  const xMaxIdx = Math.floor((plotW - widthFt) * STEPS_PER_FT);
  const yMaxIdx = Math.floor((plotD - depthFt) * STEPS_PER_FT);
  if (xMaxIdx < 0 || yMaxIdx < 0) return dom;
  for (let xi = 0; xi <= xMaxIdx; xi++) {
    for (let yi = 0; yi <= yMaxIdx; yi++) {
      dom.add(originKey(xi, yi, yStride));
    }
  }
  return dom;
}

// Map plot.facing diagonals to a single cardinal axis for Stage 3B wall-touch
// restriction (e.g. NE plot-facing → foyer touches east wall; SE → east; NW/SW → west).
const FACING_TO_WALL_SIDE: Record<string, "N" | "S" | "E" | "W"> = {
  N: "N", S: "S", E: "E", W: "W",
  NE: "E", SE: "E", NW: "W", SW: "W",
};

function buildInitialDomain(
  room: ParsedRoom,
  widthFt: number,
  depthFt: number,
  mandalaCell: CellIdx,
  plotW: number,
  plotD: number,
  slackFt: number,
  hasParent: boolean,
  plotFacing: string | null,
  isMainEntrance: boolean,
): Set<number> {
  const yStride = Math.floor(plotD * STEPS_PER_FT) + 1;

  // H4 corner pin — sacred user intent
  if (room.position_type === "corner" && room.position_direction && room.user_explicit_position) {
    const dom = new Set<number>();
    const dir = room.position_direction;
    if (dir === "NW") { dom.add(originKey(0, 0, yStride)); return dom; }
    if (dir === "NE") {
      const xIdx = Math.floor((plotW - widthFt) * STEPS_PER_FT);
      dom.add(originKey(xIdx, 0, yStride)); return dom;
    }
    if (dir === "SW") {
      const yIdx = Math.floor((plotD - depthFt) * STEPS_PER_FT);
      dom.add(originKey(0, yIdx, yStride)); return dom;
    }
    if (dir === "SE") {
      const xIdx = Math.floor((plotW - widthFt) * STEPS_PER_FT);
      const yIdx = Math.floor((plotD - depthFt) * STEPS_PER_FT);
      dom.add(originKey(xIdx, yIdx, yStride)); return dom;
    }
  }

  // H6 wall_centered pin — sacred user intent
  if (room.position_type === "wall_centered" && room.position_direction && room.user_explicit_position) {
    const dom = new Set<number>();
    const dir = room.position_direction;
    if (dir === "N") {
      const xIdx = Math.round((plotW / 2 - widthFt / 2) * STEPS_PER_FT);
      dom.add(originKey(Math.max(0, xIdx), 0, yStride)); return dom;
    }
    if (dir === "S") {
      const xIdx = Math.round((plotW / 2 - widthFt / 2) * STEPS_PER_FT);
      const yIdx = Math.floor((plotD - depthFt) * STEPS_PER_FT);
      dom.add(originKey(Math.max(0, xIdx), yIdx, yStride)); return dom;
    }
    if (dir === "E") {
      const xIdx = Math.floor((plotW - widthFt) * STEPS_PER_FT);
      const yIdx = Math.round((plotD / 2 - depthFt / 2) * STEPS_PER_FT);
      dom.add(originKey(xIdx, Math.max(0, yIdx), yStride)); return dom;
    }
    if (dir === "W") {
      const yIdx = Math.round((plotD / 2 - depthFt / 2) * STEPS_PER_FT);
      dom.add(originKey(0, Math.max(0, yIdx), yStride)); return dom;
    }
  }

  // H_MAIN_ENTRANCE_ROOM (Phase 7) — if this room owns the main-entrance door
  // and plot.facing is set, restrict origins so the room touches the facing wall.
  if (isMainEntrance && plotFacing && !room.user_explicit_position) {
    const side = FACING_TO_WALL_SIDE[plotFacing];
    if (side) {
      return buildWallTouchDomain(side, widthFt, depthFt, plotW, plotD, yStride);
    }
  }

  // No user hard constraint and attached children: full plot domain.
  return buildFullPlotDomain(widthFt, depthFt, plotW, plotD, yStride);
}

function buildWallTouchDomain(
  side: "N" | "S" | "E" | "W",
  widthFt: number,
  depthFt: number,
  plotW: number,
  plotD: number,
  yStride: number,
): Set<number> {
  const dom = new Set<number>();
  const xMaxIdx = Math.floor((plotW - widthFt) * STEPS_PER_FT);
  const yMaxIdx = Math.floor((plotD - depthFt) * STEPS_PER_FT);
  if (xMaxIdx < 0 || yMaxIdx < 0) return dom;

  if (side === "N") {
    for (let xi = 0; xi <= xMaxIdx; xi++) dom.add(originKey(xi, 0, yStride));
  } else if (side === "S") {
    for (let xi = 0; xi <= xMaxIdx; xi++) dom.add(originKey(xi, yMaxIdx, yStride));
  } else if (side === "W") {
    for (let yi = 0; yi <= yMaxIdx; yi++) dom.add(originKey(0, yi, yStride));
  } else {
    for (let yi = 0; yi <= yMaxIdx; yi++) dom.add(originKey(xMaxIdx, yi, yStride));
  }
  return dom;
}

// ── Propagators ──

function pruneNoOverlap(
  placedRect: Rect,
  unassignedVars: Variable[],
  placedYStride: number,
): { prunedBy: Map<string, number[]>; deadVarId: string | null } {
  const prunedBy = new Map<string, number[]>();
  for (const v of unassignedVars) {
    const removed: number[] = [];
    for (const key of v.domain) {
      const { x, y } = keyToFt(key, v.yStride);
      const candidate: Rect = { x, y, width: v.width_ft, depth: v.depth_ft };
      if (rectOverlaps(placedRect, candidate)) removed.push(key);
    }
    if (removed.length > 0) {
      for (const k of removed) v.domain.delete(k);
      prunedBy.set(v.id, removed);
      if (v.domain.size === 0) return { prunedBy, deadVarId: v.id };
    }
  }
  return { prunedBy, deadVarId: null };
}

function pruneAttachedEnsuite(
  parent: Variable,
  parentRect: Rect,
  unassignedVars: Variable[],
): { prunedBy: Map<string, number[]>; deadVarId: string | null } {
  const prunedBy = new Map<string, number[]>();
  for (const v of unassignedVars) {
    if (v.parentId !== parent.id) continue;
    const removed: number[] = [];
    for (const key of v.domain) {
      const { x, y } = keyToFt(key, v.yStride);
      const candidate: Rect = { x, y, width: v.width_ft, depth: v.depth_ft };
      if (rectsSharedEdgeLength(parentRect, candidate) < MIN_SHARED_EDGE_FT) removed.push(key);
    }
    if (removed.length > 0) {
      for (const k of removed) v.domain.delete(k);
      prunedBy.set(v.id, removed);
      if (v.domain.size === 0) return { prunedBy, deadVarId: v.id };
    }
  }
  return { prunedBy, deadVarId: null };
}

function restoreDomains(vars: Variable[], prunedBy: Map<string, number[]>): void {
  for (const v of vars) {
    const removed = prunedBy.get(v.id);
    if (removed) for (const k of removed) v.domain.add(k);
  }
}

// ── Variable ordering ──

function topoSort(variables: Variable[]): Variable[] {
  const byId = new Map(variables.map(v => [v.id, v]));
  const visited = new Set<string>();
  const result: Variable[] = [];

  function visit(v: Variable): void {
    if (visited.has(v.id)) return;
    visited.add(v.id);
    if (v.parentId) {
      const parent = byId.get(v.parentId);
      if (parent) visit(parent);
    }
    result.push(v);
  }

  for (const v of variables) visit(v);
  return result;
}

function selectVariable(
  variables: Variable[],
  assigned: Set<string>,
  wdeg: Map<string, number>,
): Variable | null {
  let best: Variable | null = null;
  let bestScore = Infinity;
  for (const v of variables) {
    if (assigned.has(v.id)) continue;
    const size = v.domain.size;
    if (size === 0) return v;
    const weight = 1 + (wdeg.get(v.id) ?? 0);
    const score = size / weight;
    if (score < bestScore) { bestScore = score; best = v; }
    else if (score === bestScore && best) {
      if (v.width_ft * v.depth_ft > best.width_ft * best.depth_ft) best = v;
    }
  }
  return best;
}

function valueScore(
  v: Variable,
  key: number,
  placedRects: Map<string, Rect>,
  constraints: ParsedConstraints,
  plotW: number,
  plotD: number,
): number {
  const { x, y } = keyToFt(key, v.yStride);
  const rect: Rect = { x, y, width: v.width_ft, depth: v.depth_ft };
  let score = 0;

  // Mandala-cell proximity (Phase 5 Sub-goal A): strong gravity toward the
  // Stage-3A-assigned cell center. Without this dominating, zone-positioned
  // rooms would drift to perimeter corners that happen to be in the wrong
  // mandala cell, degrading the scorecard's position component.
  const bbox = cellToBBox(v.mandala_cell, plotW, plotD);
  const cellCx = (bbox.x1 + bbox.x2) / 2;
  const cellCy = (bbox.y1 + bbox.y2) / 2;
  const rectC = rectCenter(rect);
  const dist = Math.hypot(rectC.x - cellCx, rectC.y - cellCy);
  const cellRadius = Math.min(plotW, plotD) / 6;
  const mandalaProximity = Math.max(0, 1 - dist / (cellRadius * 1.5));
  score += 100 * mandalaProximity;

  if (NEEDS_EXTERIOR_WALL.has(v.room.function as RoomFunction)) {
    const touchesPerim = x <= 0.01 || y <= 0.01 ||
      x + v.width_ft >= plotW - 0.01 || y + v.depth_ft >= plotD - 0.01;
    if (touchesPerim) score += 30;
  }

  for (const adj of constraints.adjacency_pairs) {
    let otherId: string | null = null;
    if (adj.room_a_id === v.id) otherId = adj.room_b_id;
    else if (adj.room_b_id === v.id) otherId = adj.room_a_id;
    if (!otherId) continue;
    const otherRect = placedRects.get(otherId);
    if (!otherRect) continue;
    const shared = rectsSharedEdgeLength(rect, otherRect);
    if (shared >= MIN_SHARED_EDGE_FT) score += 30;
    else {
      const oc = rectCenter(otherRect);
      const d = Math.hypot(rectC.x - oc.x, rectC.y - oc.y);
      score -= d * 0.5;
    }
  }

  return score;
}

function orderValues(
  v: Variable,
  placedRects: Map<string, Rect>,
  constraints: ParsedConstraints,
  plotW: number,
  plotD: number,
): number[] {
  const keys = [...v.domain];
  const scored = keys.map(k => ({ k, s: valueScore(v, k, placedRects, constraints, plotW, plotD) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.k);
}

// ── Main solver ──

function tryOnce(
  constraints: ParsedConstraints,
  mandalaAssignments: MandalaAssignment[],
  options: Required<Stage3BOptions>,
): Stage3BResult {
  const startTime = Date.now();
  const plotW = constraints.plot.width_ft ?? 50;
  const plotD = constraints.plot.depth_ft ?? 50;

  // Build variables
  const variables: Variable[] = [];
  const byId = new Map<string, ParsedRoom>();
  for (const r of constraints.rooms) byId.set(r.id, r);

  const assignmentByRoomId = new Map<string, MandalaAssignment>();
  for (const a of mandalaAssignments) assignmentByRoomId.set(a.room_id, a);

  const yStride = Math.floor(plotD * STEPS_PER_FT) + 1;

  for (const room of constraints.rooms) {
    const a = assignmentByRoomId.get(room.id);
    if (!a) continue;
    let [w, d] = roomDims(room);
    w = snap(Math.max(w, MIN_DIM_FT[room.function] ?? 5));
    d = snap(Math.max(d, MIN_DIM_FT[room.function] ?? 5));

    const isMainEntrance = (room.doors ?? []).some(dr => dr.is_main_entrance === true);
    const domain = buildInitialDomain(
      room, w, d, a.cell, plotW, plotD, options.slackFt,
      !!room.attached_to_room_id,
      constraints.plot.facing ?? null,
      isMainEntrance,
    );
    variables.push({
      id: room.id,
      room,
      width_ft: w,
      depth_ft: d,
      mandala_cell: a.cell,
      mandala_direction: a.cell_direction,
      domain,
      parentId: room.attached_to_room_id ?? null,
      yStride,
    });
  }

  if (variables.some(v => v.domain.size === 0)) {
    const dead = variables.find(v => v.domain.size === 0)!;
    return {
      feasible: false,
      placements: [],
      conflict: {
        variables: [dead.id],
        rule_ids: ["H3", "H4", "H6"],
        human_reason: `Room "${dead.room.name}" has no valid origin in its mandala cell (function=${dead.room.function}, dims=${dead.width_ft}x${dead.depth_ft}ft, cell=${dead.mandala_direction}). Consider relaxing dimensions or cell assignment.`,
      },
      iterations: 0,
      elapsed_ms: Date.now() - startTime,
      relaxations_applied: [],
      plot_width_ft: plotW,
      plot_depth_ft: plotD,
    };
  }

  const ordered = topoSort(variables);
  const assigned = new Set<string>();
  const placedRects = new Map<string, Rect>();
  const wdeg = new Map<string, number>();
  let iterations = 0;
  let lastConflict: ConflictSet | null = null;

  function timedOut(): boolean {
    return Date.now() - startTime > options.timeLimitMs;
  }

  function search(): boolean {
    iterations++;
    if (timedOut()) return false;

    const v = selectVariable(ordered, assigned, wdeg);
    if (!v) return true;
    if (v.domain.size === 0) {
      wdeg.set(v.id, (wdeg.get(v.id) ?? 0) + 1);
      lastConflict = {
        variables: [v.id, ...[...assigned]],
        rule_ids: ["H1", "H3", "H4"],
        human_reason: `Room "${v.room.name}" (${v.room.function}, ${v.width_ft}x${v.depth_ft}ft in ${v.mandala_direction}) has no feasible placement. Rooms already placed: ${[...assigned].length}. Likely dims too large for assigned cell + slack, or overlaps unavoidable.`,
      };
      return false;
    }

    const keys = orderValues(v, placedRects, constraints, plotW, plotD);

    for (const key of keys) {
      if (timedOut()) return false;

      const { x, y } = keyToFt(key, v.yStride);
      const rect = rectForVar(v, x, y);

      // Snapshot unassigned domain state
      const myPrevDomain = new Set(v.domain);
      const unassigned = ordered.filter(o => !assigned.has(o.id) && o.id !== v.id);

      assigned.add(v.id);
      placedRects.set(v.id, rect);
      v.domain = new Set([key]);

      const noOverlapRes = pruneNoOverlap(rect, unassigned, v.yStride);
      let attachedRes: { prunedBy: Map<string, number[]>; deadVarId: string | null } | null = null;
      let dead = false;

      if (noOverlapRes.deadVarId) {
        wdeg.set(noOverlapRes.deadVarId, (wdeg.get(noOverlapRes.deadVarId) ?? 0) + 1);
        const deadV = ordered.find(o => o.id === noOverlapRes.deadVarId);
        if (deadV) {
          lastConflict = {
            variables: [deadV.id, v.id, ...[...assigned]],
            rule_ids: ["H1"],
            human_reason: `Room "${deadV.room.name}" (${deadV.width_ft}x${deadV.depth_ft}ft) cannot be placed without overlapping "${v.room.name}" (${v.width_ft}x${v.depth_ft}ft at ${v.mandala_direction}) or other placed rooms. Total area demand likely exceeds plot.`,
          };
        }
        dead = true;
      } else {
        attachedRes = pruneAttachedEnsuite(v, rect, unassigned);
        if (attachedRes.deadVarId) {
          wdeg.set(attachedRes.deadVarId, (wdeg.get(attachedRes.deadVarId) ?? 0) + 1);
          const deadV = ordered.find(o => o.id === attachedRes!.deadVarId);
          if (deadV) {
            lastConflict = {
              variables: [deadV.id, v.id],
              rule_ids: ["H9"],
              human_reason: `Room "${deadV.room.name}" (attached to "${v.room.name}") cannot share a ${MIN_SHARED_EDGE_FT}ft+ edge with its parent. Parent placement or dims may block adjacency.`,
            };
          }
          dead = true;
        }
      }

      if (!dead && search()) return true;

      // Restore
      assigned.delete(v.id);
      placedRects.delete(v.id);
      v.domain = myPrevDomain;
      restoreDomains(unassigned, noOverlapRes.prunedBy);
      if (attachedRes) restoreDomains(unassigned, attachedRes.prunedBy);
    }

    return false;
  }

  const ok = search();
  const elapsed_ms = Date.now() - startTime;

  if (!ok) {
    return {
      feasible: false,
      placements: [],
      conflict: lastConflict,
      iterations,
      elapsed_ms,
      relaxations_applied: [],
      plot_width_ft: plotW,
      plot_depth_ft: plotD,
    };
  }

  const placements: FinePlacement[] = variables.map(v => {
    const rect = placedRects.get(v.id)!;
    return {
      room_id: v.id,
      room_name: v.room.name,
      function: v.room.function,
      mandala_cell: v.mandala_cell,
      mandala_direction: v.mandala_direction,
      x_ft: rect.x,
      y_ft: rect.y,
      width_ft: v.width_ft,
      depth_ft: v.depth_ft,
    };
  });

  return {
    feasible: true,
    placements,
    conflict: null,
    iterations,
    elapsed_ms,
    relaxations_applied: [],
    plot_width_ft: plotW,
    plot_depth_ft: plotD,
  };
}

export function solveStage3B(
  constraints: ParsedConstraints,
  mandalaAssignments: MandalaAssignment[],
  options: Stage3BOptions = {},
): Stage3BResult {
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const relaxations: string[] = [];

  // Try 1: default slack
  let res = tryOnce(constraints, mandalaAssignments, {
    timeLimitMs, slackFt: options.slackFt ?? DEFAULT_SLACK_FT, dimToleranceFactor: options.dimToleranceFactor ?? DIM_TOLERANCE,
  });
  if (res.feasible) {
    logger.debug(`[CSP-3B] feasible on first try: ${res.placements.length} rooms in ${res.elapsed_ms}ms`);
    return res;
  }

  // Try 2: larger slack
  relaxations.push("slack_ft: 2.0 -> 5.0 (mandala cell boundaries expanded)");
  res = tryOnce(constraints, mandalaAssignments, {
    timeLimitMs, slackFt: 5.0, dimToleranceFactor: options.dimToleranceFactor ?? DIM_TOLERANCE,
  });
  if (res.feasible) {
    logger.debug(`[CSP-3B] feasible with slack=5: ${res.placements.length} rooms in ${res.elapsed_ms}ms`);
    return { ...res, relaxations_applied: relaxations };
  }

  // Try 3: shrink oversized rooms to fit
  relaxations.push("dim_tolerance: 5% -> 10% (room dims may differ from user spec by up to 10%)");
  const shrunkConstraints: ParsedConstraints = {
    ...constraints,
    rooms: constraints.rooms.map(r => {
      if (r.dim_width_ft != null && r.dim_depth_ft != null) {
        return { ...r, dim_width_ft: r.dim_width_ft * 0.9, dim_depth_ft: r.dim_depth_ft * 0.9 };
      }
      return r;
    }),
  };
  res = tryOnce(shrunkConstraints, mandalaAssignments, {
    timeLimitMs, slackFt: 5.0, dimToleranceFactor: 0.1,
  });
  if (res.feasible) {
    logger.debug(`[CSP-3B] feasible with dim-shrink: ${res.placements.length} rooms in ${res.elapsed_ms}ms`);
    return { ...res, relaxations_applied: relaxations };
  }

  return { ...res, relaxations_applied: relaxations };
}
