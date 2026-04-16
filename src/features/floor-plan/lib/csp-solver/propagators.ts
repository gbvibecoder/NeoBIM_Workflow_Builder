import type { ParsedRoom, ParsedConstraints, CompassDirection, CenterDirection } from "../structured-parser";
import type { RoomFunction } from "../room-vocabulary";

type CompassOrCenter = CenterDirection;
import {
  ALL_CELLS,
  CELL_CENTER,
  CELL_E,
  CELL_N,
  CELL_NE,
  CELL_NW,
  CELL_S,
  CELL_SE,
  CELL_SW,
  CELL_W,
  CORNER_CELLS,
  type CellIdx,
  type Domain,
  directionToCell,
  domainIntersect,
  domainRemove,
  domainSize,
  domainToCells,
  maskOf,
  singleton,
} from "./domains";

const HARD_VASTU_AVOID: Partial<Record<RoomFunction, CellIdx[]>> = {
  master_bedroom: [CELL_NE, CELL_SE],
  kitchen: [CELL_NE, CELL_SW, CELL_N],
  pooja: [CELL_S, CELL_SW, CELL_SE, CELL_W],
  staircase: [CELL_CENTER, CELL_NE],
};

const ENTRANCE_FUNCTIONS: Set<RoomFunction> = new Set(["foyer", "porch"]);
const ENTRANCE_AVOID: CellIdx[] = [CELL_S, CELL_SW, CELL_W];

// Mandala cells allowed per plot.facing for the main-entrance room.
// Diagonal facings (NE/NW/SE/SW) allow the three surrounding cells.
export const FACING_MANDALA_CELLS: Partial<Record<string, CellIdx[]>> = {
  N:  [CELL_N, CELL_NW, CELL_NE],
  S:  [CELL_S, CELL_SW, CELL_SE],
  E:  [CELL_E, CELL_NE, CELL_SE],
  W:  [CELL_W, CELL_NW, CELL_SW],
  NE: [CELL_NE, CELL_N, CELL_E],
  NW: [CELL_NW, CELL_N, CELL_W],
  SE: [CELL_SE, CELL_S, CELL_E],
  SW: [CELL_SW, CELL_S, CELL_W],
};

export function hasMainEntranceDoor(room: ParsedRoom): boolean {
  return (room.doors ?? []).some(d => d.is_main_entrance === true);
}

const BRAHMASTHAN_FORBIDDEN: Set<RoomFunction> = new Set([
  "kitchen", "bathroom", "master_bathroom", "powder_room", "staircase", "store",
]);
const BRAHMASTHAN_ALLOWED_FUNCTIONS: Set<RoomFunction> = new Set([
  "corridor", "foyer", "balcony", "other",
]);

const WET_FUNCTIONS: Set<RoomFunction> = new Set([
  "bathroom", "master_bathroom", "powder_room", "kitchen", "utility",
]);

const HEAVY_FUNCTIONS: Set<RoomFunction> = new Set([
  "master_bedroom", "staircase", "store",
]);

export interface VariableInit {
  room: ParsedRoom;
  initialDomain: Domain;
  /** Hard-constraint rule ids that touched this variable's domain (for unsat attribution) */
  appliedRules: string[];
}

/**
 * Compute initial domain for a single room variable by applying H4/H5/H7/H8
 * plus H_MAIN_ENTRANCE_ROOM (Phase 7) for the room owning the main-entrance
 * door on a plot with an explicit facing direction.
 *
 * Returns empty domain (0) if the room's hard constraints contradict each
 * other before search even begins.
 */
export function computeInitialDomain(
  room: ParsedRoom,
  vastuRequired: boolean,
  plotFacing: CompassOrCenter | null = null,
): VariableInit {
  let d: Domain = ALL_CELLS;
  const appliedRules: string[] = [];
  const fn = room.function as RoomFunction;

  // H4 / H5 — user explicit placement is sacred
  if (room.position_type === "corner" && room.position_direction) {
    const c = directionToCell(room.position_direction);
    d = singleton(c);
    appliedRules.push(`H4(corner=${room.position_direction})`);
  } else if (room.position_type === "zone" && room.position_direction) {
    const c = directionToCell(room.position_direction);
    d = singleton(c);
    appliedRules.push(`H5(zone=${room.position_direction})`);
  } else if (room.position_type === "wall_centered" && room.position_direction) {
    const c = directionToCell(room.position_direction);
    d = singleton(c);
    appliedRules.push(`H5(wall_centered=${room.position_direction})`);
  }

  // H_MAIN_ENTRANCE_ROOM (Phase 7) — room with is_main_entrance door must be in
  // a mandala cell on the plot.facing side. Skipped when user has explicit position.
  if (plotFacing && plotFacing !== "CENTER" && hasMainEntranceDoor(room) && !room.user_explicit_position) {
    const allowed = FACING_MANDALA_CELLS[plotFacing];
    if (allowed) {
      d = domainIntersect(d, maskOf(allowed));
      appliedRules.push(`H_MAIN_ENTRANCE_ROOM(facing=${plotFacing})`);
    }
  }

  // H7 — Vastu avoid (only if vastu_required AND no explicit user position)
  if (vastuRequired && !room.user_explicit_position) {
    const avoidList = HARD_VASTU_AVOID[fn];
    if (avoidList) {
      d = domainIntersect(d, ~maskOf(avoidList) & ALL_CELLS);
      const ruleId = fn === "master_bedroom" ? "V-RP-001"
        : fn === "kitchen" ? "V-RP-002"
        : fn === "pooja" ? "V-RP-005"
        : fn === "staircase" ? "V-RP-012" : "V-Vastu";
      appliedRules.push(`H7(${ruleId})`);
    }
    if (ENTRANCE_FUNCTIONS.has(fn)) {
      d = domainIntersect(d, ~maskOf(ENTRANCE_AVOID) & ALL_CELLS);
      appliedRules.push(`H7(V-EN-001)`);
    }
  }

  // H8 — Brahmasthan (CENTER) open
  if (vastuRequired && BRAHMASTHAN_FORBIDDEN.has(fn)) {
    d = domainRemove(d, CELL_CENTER);
    appliedRules.push(`H8(V-EL-003)`);
  }

  return { room, initialDomain: d, appliedRules };
}

/**
 * Corner uniqueness: at most ONE room with position_type="corner" per mandala corner cell.
 * Called during forward-checking after each assignment.
 *
 * Returns the variable ids whose domains were pruned, or null if an empty domain is
 * produced (caller must backtrack).
 */
export function propagateCornerUniqueness(
  variableRoomById: Map<string, ParsedRoom>,
  domainById: Map<string, Domain>,
  assignments: Map<string, CellIdx>,
  justAssignedVarId: string,
): { prunedVars: string[] } | { dead: true; deadVarId: string } {
  const assignedCell = assignments.get(justAssignedVarId);
  if (assignedCell === undefined) return { prunedVars: [] };
  const assignedRoom = variableRoomById.get(justAssignedVarId);
  if (!assignedRoom) return { prunedVars: [] };

  if (assignedRoom.position_type !== "corner") return { prunedVars: [] };
  if (((CORNER_CELLS >> assignedCell) & 1) !== 1) return { prunedVars: [] };

  const prunedVars: string[] = [];
  for (const [otherId, otherRoom] of variableRoomById.entries()) {
    if (otherId === justAssignedVarId) continue;
    if (assignments.has(otherId)) continue;
    if (otherRoom.position_type !== "corner") continue;

    const otherDomain = domainById.get(otherId) ?? ALL_CELLS;
    const newDomain = domainRemove(otherDomain, assignedCell);
    if (newDomain !== otherDomain) {
      domainById.set(otherId, newDomain);
      prunedVars.push(otherId);
      if (newDomain === 0) {
        return { dead: true, deadVarId: otherId };
      }
    }
  }
  return { prunedVars };
}

/** Is a room considered "wet" (plumbing concentration preference)? */
export function isWetFunction(fn: string): boolean {
  return WET_FUNCTIONS.has(fn as RoomFunction);
}

/** Is a room considered "heavy" in Vastu terms (weight preference to SW)? */
export function isHeavyFunction(fn: string): boolean {
  return HEAVY_FUNCTIONS.has(fn as RoomFunction);
}

export function brahmasthanForbiddenFn(fn: string): boolean {
  return BRAHMASTHAN_FORBIDDEN.has(fn as RoomFunction);
}

export function brahmasthanAllowedFn(fn: string): boolean {
  return BRAHMASTHAN_ALLOWED_FUNCTIONS.has(fn as RoomFunction);
}

/** Hard-Vastu rule ids for this function (for conflict attribution and UNSAT reason text) */
export function hardVastuRulesFor(fn: string): string[] {
  const out: string[] = [];
  if (HARD_VASTU_AVOID[fn as RoomFunction]) {
    if (fn === "master_bedroom") out.push("V-RP-001");
    if (fn === "kitchen") out.push("V-RP-002");
    if (fn === "pooja") out.push("V-RP-005");
    if (fn === "staircase") out.push("V-RP-012");
  }
  if (ENTRANCE_FUNCTIONS.has(fn as RoomFunction)) out.push("V-EN-001");
  if (BRAHMASTHAN_FORBIDDEN.has(fn as RoomFunction)) out.push("V-EL-003");
  return out;
}

/**
 * Soft preferred direction(s) per function. Used by value ordering (S6).
 * Subset of vastu-rules.ts preferred_directions filtered to our 24 functions.
 * NOT used to filter domains — purely advisory for ordering feasible values.
 */
export const SOFT_PREFERRED_CELLS: Partial<Record<RoomFunction, CellIdx[]>> = {
  master_bedroom: [CELL_SW, CELL_S, CELL_W],
  bedroom: [CELL_W, CELL_NW, CELL_N, CELL_S],
  guest_bedroom: [CELL_NW, CELL_W, CELL_N],
  kids_bedroom: [CELL_W, CELL_NW, CELL_N],
  living: [CELL_N, CELL_NE, CELL_E, CELL_NW],
  dining: [CELL_W, CELL_E, CELL_N],
  kitchen: [CELL_SE, CELL_E, CELL_S],
  bathroom: [CELL_NW, CELL_W, CELL_S],
  master_bathroom: [CELL_NW, CELL_W, CELL_S],
  powder_room: [CELL_NW, CELL_W],
  pooja: [CELL_NE, CELL_N, CELL_E],
  study: [CELL_N, CELL_NE, CELL_E, CELL_W],
  staircase: [CELL_SW, CELL_S, CELL_W, CELL_NW, CELL_SE],
  utility: [CELL_NW, CELL_W, CELL_SE],
  store: [CELL_SW, CELL_NW, CELL_W],
  foyer: [CELL_N, CELL_E, CELL_NE, CELL_NW, CELL_SE],
  porch: [CELL_N, CELL_E, CELL_NE, CELL_NW, CELL_SE],
  verandah: [CELL_N, CELL_E, CELL_NE],
  balcony: [CELL_N, CELL_E, CELL_NE],
  corridor: [CELL_CENTER, CELL_W, CELL_E, CELL_N, CELL_S],
  servant_quarter: [CELL_SE, CELL_NW, CELL_S, CELL_W],
  walk_in_wardrobe: [CELL_W, CELL_SW, CELL_NW],
  walk_in_closet: [CELL_W, CELL_SW, CELL_NW],
  other: [],
};

/** For debugging — label each domain's set bits */
export function labelDomain(d: Domain): string {
  return `{${domainToCells(d).map(c => ["NW","N","NE","W","C","E","SW","S","SE"][c]).join(",")}} (size=${domainSize(d)})`;
}
