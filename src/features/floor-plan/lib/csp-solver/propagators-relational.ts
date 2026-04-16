import type { ParsedAdjacency, ConnectsAllGroup } from "../structured-parser";
import type { Rect } from "./geometry-utils";
import { rectsSharedEdgeLength } from "./geometry-utils";

const STEPS_PER_FT = 2;
const MIN_SHARED_EDGE_FT = 3.0;
const DIRECTIONAL_SLACK_FT = 0.5;

interface VariableLike {
  id: string;
  width_ft: number;
  depth_ft: number;
  yStride: number;
  domain: Set<number>;
}

function keyToFt(key: number, yStride: number): { x: number; y: number } {
  const xIdx = Math.floor(key / yStride);
  const yIdx = key % yStride;
  return { x: xIdx / STEPS_PER_FT, y: yIdx / STEPS_PER_FT };
}

function candidateRect(v: VariableLike, key: number): Rect {
  const { x, y } = keyToFt(key, v.yStride);
  return { x, y, width: v.width_ft, depth: v.depth_ft };
}

function rectCx(r: Rect): number { return r.x + r.width / 2; }
function rectCy(r: Rect): number { return r.y + r.depth / 2; }

/**
 * Check if room_a at rect A is in the given compass direction from room_b at
 * rect B. Direction is WORLD-SOLVER Y-DOWN convention (low y = north).
 * Uses centroid comparison with a small slack to avoid micro-float false-negatives.
 */
function directionHolds(direction: string, a: Rect, b: Rect): boolean {
  const cax = rectCx(a), cay = rectCy(a);
  const cbx = rectCx(b), cby = rectCy(b);
  const s = DIRECTIONAL_SLACK_FT;
  switch (direction) {
    case "W":  return cax + s < cbx;
    case "E":  return cax > cbx + s;
    // Solver convention Y-DOWN: NORTH = low y, SOUTH = high y
    case "N":  return cay + s < cby;
    case "S":  return cay > cby + s;
    case "NW": return cax + s < cbx && cay + s < cby;
    case "NE": return cax > cbx + s && cay + s < cby;
    case "SW": return cax + s < cbx && cay > cby + s;
    case "SE": return cax > cbx + s && cay > cby + s;
    default:   return true;
  }
}

/**
 * After a variable is assigned, prune unassigned variables per each
 * directional adjacency_pair. A is in direction D from B means
 * A's centroid is in direction D from B's centroid.
 *
 * Covers relationships: flowing_into, leads_to, behind, door_connects.
 * Skipped for attached_ensuite (H9 already enforces edge share) and
 * between (H_BETWEEN handles ternary).
 */
export function pruneDirectionalAdjacency(
  variables: VariableLike[],
  placedRects: Map<string, Rect>,
  assignedIds: Set<string>,
  adjacencyPairs: ParsedAdjacency[],
  justAssignedId: string,
): { prunedBy: Map<string, number[]>; deadVarId: string | null } {
  const prunedBy = new Map<string, number[]>();
  const DIRECTIONAL_RELS = new Set(["flowing_into", "leads_to", "behind", "door_connects"]);

  for (const adj of adjacencyPairs) {
    if (!adj.direction) continue;
    if (!DIRECTIONAL_RELS.has(adj.relationship)) continue;

    const aAssigned = assignedIds.has(adj.room_a_id);
    const bAssigned = assignedIds.has(adj.room_b_id);
    // Only fire when the just-assigned room is one of the pair
    if (adj.room_a_id !== justAssignedId && adj.room_b_id !== justAssignedId) continue;

    if (aAssigned && bAssigned) {
      // Both already placed — check constraint; if violated, dead.
      const rA = placedRects.get(adj.room_a_id)!;
      const rB = placedRects.get(adj.room_b_id)!;
      if (!directionHolds(adj.direction, rA, rB)) {
        // Mark the later-assigned variable as conflict
        return { prunedBy, deadVarId: justAssignedId };
      }
      continue;
    }

    // One side just placed, the other unassigned — prune the unassigned.
    const otherId = aAssigned ? adj.room_b_id : adj.room_a_id;
    const placedId = aAssigned ? adj.room_a_id : adj.room_b_id;
    const placedRect = placedRects.get(placedId);
    if (!placedRect) continue;
    const otherVar = variables.find(v => v.id === otherId);
    if (!otherVar || assignedIds.has(otherId)) continue;

    const removed: number[] = [];
    for (const key of otherVar.domain) {
      const candidate = candidateRect(otherVar, key);
      // We need directionHolds(direction, room_a_rect, room_b_rect) to hold.
      const rA = aAssigned ? placedRect : candidate;
      const rB = aAssigned ? candidate : placedRect;
      if (!directionHolds(adj.direction, rA, rB)) removed.push(key);
    }
    if (removed.length > 0) {
      for (const k of removed) otherVar.domain.delete(k);
      prunedBy.set(otherVar.id, removed);
      if (otherVar.domain.size === 0) return { prunedBy, deadVarId: otherVar.id };
    }
  }

  return { prunedBy, deadVarId: null };
}

/**
 * For "between": room_a's centroid must lie in the bounding rect of
 * room_b's centroid and third_room_id's centroid. Fires only after both
 * B and C are placed.
 */
export function pruneBetween(
  variables: VariableLike[],
  placedRects: Map<string, Rect>,
  assignedIds: Set<string>,
  adjacencyPairs: ParsedAdjacency[],
): { prunedBy: Map<string, number[]>; deadVarId: string | null } {
  const prunedBy = new Map<string, number[]>();
  for (const adj of adjacencyPairs) {
    if (adj.relationship !== "between") continue;
    if (!adj.third_room_id) continue;
    if (assignedIds.has(adj.room_a_id)) continue;
    if (!assignedIds.has(adj.room_b_id) || !assignedIds.has(adj.third_room_id)) continue;

    const rB = placedRects.get(adj.room_b_id);
    const rC = placedRects.get(adj.third_room_id);
    if (!rB || !rC) continue;

    const xmin = Math.min(rectCx(rB), rectCx(rC));
    const xmax = Math.max(rectCx(rB), rectCx(rC));
    const ymin = Math.min(rectCy(rB), rectCy(rC));
    const ymax = Math.max(rectCy(rB), rectCy(rC));

    const aVar = variables.find(v => v.id === adj.room_a_id);
    if (!aVar) continue;

    const removed: number[] = [];
    for (const key of aVar.domain) {
      const c = candidateRect(aVar, key);
      const cax = rectCx(c), cay = rectCy(c);
      if (cax < xmin - 0.5 || cax > xmax + 0.5 || cay < ymin - 0.5 || cay > ymax + 0.5) {
        removed.push(key);
      }
    }
    if (removed.length > 0) {
      for (const k of removed) aVar.domain.delete(k);
      prunedBy.set(aVar.id, removed);
      if (aVar.domain.size === 0) return { prunedBy, deadVarId: aVar.id };
    }
  }
  return { prunedBy, deadVarId: null };
}

/**
 * For each connects_all_group, the connector must share >=3ft edge with every
 * connected_room. Prunes after each assignment to maintain the invariant.
 *
 * Caller can toggle the requirement (e.g. relax to best-effort on UNSAT) via
 * the minShareFt parameter.
 */
export function pruneConnectsAll(
  variables: VariableLike[],
  placedRects: Map<string, Rect>,
  assignedIds: Set<string>,
  groups: ConnectsAllGroup[],
  justAssignedId: string,
  minShareFt: number = MIN_SHARED_EDGE_FT,
): { prunedBy: Map<string, number[]>; deadVarId: string | null } {
  const prunedBy = new Map<string, number[]>();

  for (const group of groups) {
    const isConnector = justAssignedId === group.connector_id;
    const isMember = group.connected_room_ids.includes(justAssignedId);
    if (!isConnector && !isMember) continue;

    const connectorPlaced = placedRects.get(group.connector_id);

    if (connectorPlaced) {
      // Prune each unplaced connected room to candidates sharing >=minShareFt
      // edge with the connector.
      for (const memberId of group.connected_room_ids) {
        if (assignedIds.has(memberId)) continue;
        const memberVar = variables.find(v => v.id === memberId);
        if (!memberVar) continue;
        const removed: number[] = [];
        for (const key of memberVar.domain) {
          const c = candidateRect(memberVar, key);
          if (rectsSharedEdgeLength(connectorPlaced, c) < minShareFt) removed.push(key);
        }
        if (removed.length > 0) {
          for (const k of removed) memberVar.domain.delete(k);
          prunedBy.set(memberVar.id, removed);
          if (memberVar.domain.size === 0) return { prunedBy, deadVarId: memberVar.id };
        }
      }
    } else if (isMember) {
      // Connected room just placed, connector still unplaced — prune connector's
      // candidates to those that share >=minShareFt edge with THIS placed member.
      // (Full connectivity requirement is tightened as subsequent members place.)
      const connectorVar = variables.find(v => v.id === group.connector_id);
      if (!connectorVar) continue;
      if (assignedIds.has(group.connector_id)) continue;
      const placedMember = placedRects.get(justAssignedId);
      if (!placedMember) continue;
      const removed: number[] = [];
      for (const key of connectorVar.domain) {
        const c = candidateRect(connectorVar, key);
        if (rectsSharedEdgeLength(c, placedMember) < minShareFt) removed.push(key);
      }
      if (removed.length > 0) {
        for (const k of removed) connectorVar.domain.delete(k);
        prunedBy.set(connectorVar.id, removed);
        if (connectorVar.domain.size === 0) return { prunedBy, deadVarId: connectorVar.id };
      }
    }
  }

  return { prunedBy, deadVarId: null };
}
