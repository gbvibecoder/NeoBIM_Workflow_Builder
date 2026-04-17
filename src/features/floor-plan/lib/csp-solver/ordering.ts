import type { ParsedConstraints, ParsedRoom } from "../structured-parser";
import type { RoomFunction } from "../room-vocabulary";
import {
  cellsAreAdjacent,
  cellsChebyshevDistance,
  domainSize,
  domainToCells,
  type CellIdx,
  type Domain,
} from "./domains";
import { isWetFunction, SOFT_PREFERRED_CELLS } from "./propagators";

export interface VariableState {
  id: string;
  room: ParsedRoom;
  domain: Domain;
}

/**
 * dom/wdeg variable ordering — pick unassigned variable with smallest
 * domain-size / (1 + weighted-degree). Tiebreak by descending area (bigger rooms
 * locked in early), then by id for determinism.
 */
export function selectVariable(
  variables: VariableState[],
  assignments: Map<string, CellIdx>,
  wdeg: Map<string, number>,
): VariableState | null {
  let best: VariableState | null = null;
  let bestScore = Infinity;

  for (const v of variables) {
    if (assignments.has(v.id)) continue;
    const size = domainSize(v.domain);
    if (size === 0) return v; // triggers immediate dead-end detection
    const weight = 1 + (wdeg.get(v.id) ?? 0);
    const score = size / weight;
    if (score < bestScore) {
      bestScore = score;
      best = v;
    } else if (score === bestScore && best) {
      const areaV = roomArea(v.room);
      const areaBest = roomArea(best.room);
      if (areaV > areaBest) best = v;
    }
  }
  return best;
}

function roomArea(r: ParsedRoom): number {
  if (r.dim_width_ft != null && r.dim_depth_ft != null) {
    return r.dim_width_ft * r.dim_depth_ft;
  }
  return 100;
}

/**
 * Soft score for assigning room R to cell C given the partial assignment.
 * Combines:
 *   - S1: adjacency_preferred (+25 per parsed adjacency_pair in same/adjacent cell)
 *   - S3: plumbing_cluster    (+5 per nearby wet room, capped +20)
 *   - S6: vastu_soft          (+10 if cell in SOFT_PREFERRED_CELLS[fn])
 */
export function valueScore(
  room: ParsedRoom,
  cell: CellIdx,
  constraints: ParsedConstraints,
  assignments: Map<string, CellIdx>,
  vastuRequired: boolean,
): number {
  let score = 0;

  // S1 — adjacency_preferred
  for (const adj of constraints.adjacency_pairs) {
    let otherId: string | null = null;
    if (adj.room_a_id === room.id) otherId = adj.room_b_id;
    else if (adj.room_b_id === room.id) otherId = adj.room_a_id;
    if (!otherId) continue;
    const otherCell = assignments.get(otherId);
    if (otherCell === undefined) continue;
    if (cellsAreAdjacent(cell, otherCell)) score += 25;
  }

  // S3 — plumbing_cluster
  if (isWetFunction(room.function)) {
    let wetNearby = 0;
    for (const other of constraints.rooms) {
      if (other.id === room.id) continue;
      if (!isWetFunction(other.function)) continue;
      const otherCell = assignments.get(other.id);
      if (otherCell === undefined) continue;
      if (cellsChebyshevDistance(cell, otherCell) <= 1) wetNearby++;
    }
    score += Math.min(20, wetNearby * 5);
  }

  // S6 — vastu_soft
  if (vastuRequired) {
    const preferred = SOFT_PREFERRED_CELLS[room.function as RoomFunction] ?? [];
    if (preferred.includes(cell)) score += 10;
  }

  return score;
}

export function orderValues(
  room: ParsedRoom,
  domain: Domain,
  constraints: ParsedConstraints,
  assignments: Map<string, CellIdx>,
  vastuRequired: boolean,
): CellIdx[] {
  const cells = domainToCells(domain);
  const scored = cells.map(c => ({ c, s: valueScore(room, c, constraints, assignments, vastuRequired) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.c);
}
