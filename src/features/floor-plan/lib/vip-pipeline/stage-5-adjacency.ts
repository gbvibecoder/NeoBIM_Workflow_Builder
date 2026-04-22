/**
 * Phase 2.9 — Stage 5 declared-adjacency enforcement (enhance mode only).
 *
 * The Stage 1 brief emits explicit adjacencies ({a, b, relationship}).
 * Phase 2.3's strip-pack "Option X" already enforces "attached" pairs
 * aggressively, but it runs on the strip-pack layout. In fidelity
 * mode we by-default preserve Stage 4's coords — which means the
 * declared ensuite adjacency (Master Bedroom ↔ Master Bathroom) is
 * not honoured if Stage 4 extracted the bath detached.
 *
 * This module adds a GENTLE enforcement pass for the enhance branch:
 *
 *   - Only for declarations with relationship ∈
 *     { "attached", "direct-access" }. The softer "adjacent" and
 *     "connected" relationships pass through unchanged.
 *   - Skip if the two rooms already share a wall.
 *   - Otherwise, move the SMALLER room flush against the larger
 *     room's edge nearest to the smaller's current center.
 *   - If the move would push the smaller room outside the plot, or
 *     make it overlap any OTHER room, the move is REVERTED for that
 *     pair and a skip reason is recorded.
 *
 * Design principles:
 *   - Non-destructive per pair. A failed pair leaves all rooms at
 *     their pre-move coords.
 *   - Declarative trace — every pair emits exactly one record with
 *     one of: already-satisfied, moved, skipped-out-of-bounds,
 *     skipped-would-overlap, skipped-room-missing, skipped-relationship.
 *   - Works on TransformedRoom[]; compatible with Phase 2.7C fidelity
 *     geometry pipeline (preserves room.name/type/confidence fields).
 */

import type { AdjacencyDeclaration, ArchitectBrief } from "./types";
import type { Rect } from "../strip-pack/types";
import type { TransformedRoom } from "./stage-5-synthesis";

// ─── Public types ────────────────────────────────────────────────

export type AdjacencyEnforcementAction =
  | "already-satisfied"
  | "moved"
  | "skipped-out-of-bounds"
  | "skipped-would-overlap"
  | "skipped-room-missing"
  | "skipped-relationship";

export interface AdjacencyEnforcementRecord {
  a: string;
  b: string;
  relationship: string;
  action: AdjacencyEnforcementAction;
  /** For "moved" records: the edge of the larger room the smaller was snapped to. */
  edge?: "left" | "right" | "top" | "bottom";
  note?: string;
}

export interface AdjacencyEnforcementResult {
  rooms: TransformedRoom[];
  records: AdjacencyEnforcementRecord[];
}

export interface AdjacencyEnforceInput {
  rooms: TransformedRoom[];
  adjacencies: AdjacencyDeclaration[];
  brief?: ArchitectBrief; // only used for context; not strictly required
  plotWidthFt: number;
  plotDepthFt: number;
}

// ─── Tunables ────────────────────────────────────────────────────

const SHARED_EDGE_EPS = 0.5; // feet — two edges within 0.5ft count as shared
const OVERLAP_TOLERANCE = 0.5; // feet² — overlaps smaller than this are ignored

// ─── Geometry helpers ────────────────────────────────────────────

function rectFromRoom(r: TransformedRoom): Rect {
  return { ...r.placed };
}

function areaOfRect(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.depth);
}

function sharesWall(a: Rect, b: Rect, eps = SHARED_EDGE_EPS): boolean {
  // Vertical shared edge
  if (
    Math.abs(a.x + a.width - b.x) < eps ||
    Math.abs(b.x + b.width - a.x) < eps
  ) {
    const y0 = Math.max(a.y, b.y);
    const y1 = Math.min(a.y + a.depth, b.y + b.depth);
    if (y1 - y0 > eps) return true;
  }
  // Horizontal shared edge
  if (
    Math.abs(a.y + a.depth - b.y) < eps ||
    Math.abs(b.y + b.depth - a.y) < eps
  ) {
    const x0 = Math.max(a.x, b.x);
    const x1 = Math.min(a.x + a.width, b.x + b.width);
    if (x1 - x0 > eps) return true;
  }
  return false;
}

function overlapArea(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.depth, b.y + b.depth);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function snap01(v: number): number {
  return Math.round(v * 10) / 10;
}

interface FlushCandidate {
  edge: "left" | "right" | "top" | "bottom";
  rect: Rect;
  distance: number;
}

/**
 * Produce all four flush-against-edge candidates (ordered by distance
 * from smaller's current center to the edge). Each candidate is the
 * rect smaller would occupy if placed flush against that edge of
 * larger, centered along the edge (clamped to larger's span).
 */
function flushCandidates(
  small: Rect,
  large: Rect,
  plotW: number,
  plotD: number,
): FlushCandidate[] {
  const sCx = small.x + small.width / 2;
  const sCy = small.y + small.depth / 2;

  const candidates: FlushCandidate[] = [];

  const pushCand = (
    edge: FlushCandidate["edge"],
    x: number,
    y: number,
  ): void => {
    if (
      x < 0 ||
      y < 0 ||
      x + small.width > plotW ||
      y + small.depth > plotD
    ) return;
    // Distance is from smaller's current center to the CENTER of the
    // proposed flush rect — this correctly identifies the side that
    // the smaller room is sitting on, not just the nearest edge line.
    const candCx = x + small.width / 2;
    const candCy = y + small.depth / 2;
    const dist = Math.hypot(sCx - candCx, sCy - candCy);
    candidates.push({
      edge,
      rect: { x, y, width: small.width, depth: small.depth },
      distance: dist,
    });
  };

  // Right edge of larger: flush at x = large.x + large.width
  pushCand(
    "right",
    large.x + large.width,
    Math.max(
      large.y,
      Math.min(large.y + large.depth - small.depth, sCy - small.depth / 2),
    ),
  );
  // Left edge
  pushCand(
    "left",
    large.x - small.width,
    Math.max(
      large.y,
      Math.min(large.y + large.depth - small.depth, sCy - small.depth / 2),
    ),
  );
  // Top edge: flush at y = large.y + large.depth
  pushCand(
    "top",
    Math.max(
      large.x,
      Math.min(large.x + large.width - small.width, sCx - small.width / 2),
    ),
    large.y + large.depth,
  );
  // Bottom edge
  pushCand(
    "bottom",
    Math.max(
      large.x,
      Math.min(large.x + large.width - small.width, sCx - small.width / 2),
    ),
    large.y - small.depth,
  );

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

// ─── Main entry ──────────────────────────────────────────────────

export function enforceDeclaredAdjacencies(
  input: AdjacencyEnforceInput,
): AdjacencyEnforcementResult {
  const rooms = input.rooms.map((r) => ({ ...r, placed: { ...r.placed } }));
  const records: AdjacencyEnforcementRecord[] = [];

  for (const decl of input.adjacencies ?? []) {
    const rel = decl.relationship;
    if (rel !== "attached" && rel !== "direct-access") {
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "skipped-relationship",
        note: `relationship "${rel}" not enforced in Phase 2.9`,
      });
      continue;
    }

    const idxA = rooms.findIndex((r) => r.name.toLowerCase() === decl.a.toLowerCase());
    const idxB = rooms.findIndex((r) => r.name.toLowerCase() === decl.b.toLowerCase());
    if (idxA < 0 || idxB < 0) {
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "skipped-room-missing",
        note:
          idxA < 0 && idxB < 0
            ? "both rooms missing from extraction"
            : idxA < 0
              ? `"${decl.a}" missing from extraction`
              : `"${decl.b}" missing from extraction`,
      });
      continue;
    }

    const rectA = rectFromRoom(rooms[idxA]);
    const rectB = rectFromRoom(rooms[idxB]);

    if (sharesWall(rectA, rectB)) {
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "already-satisfied",
      });
      continue;
    }

    // Smaller room moves. Larger room stays put.
    const aIsLarger = areaOfRect(rectA) >= areaOfRect(rectB);
    const largerIdx = aIsLarger ? idxA : idxB;
    const smallerIdx = aIsLarger ? idxB : idxA;
    const largerRect = aIsLarger ? rectA : rectB;
    const smallerRect = aIsLarger ? rectB : rectA;

    const candidates = flushCandidates(
      smallerRect,
      largerRect,
      input.plotWidthFt,
      input.plotDepthFt,
    );

    if (candidates.length === 0) {
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "skipped-out-of-bounds",
        note: "no edge of larger room can host smaller room inside plot bounds",
      });
      continue;
    }

    // Try the nearest edge first; if that candidate overlaps any OTHER
    // room, try the next one. If none work, skip.
    let applied = false;
    for (const cand of candidates) {
      const proposed: Rect = {
        x: snap01(cand.rect.x),
        y: snap01(cand.rect.y),
        width: snap01(cand.rect.width),
        depth: snap01(cand.rect.depth),
      };

      let bad = false;
      for (let k = 0; k < rooms.length; k++) {
        if (k === smallerIdx || k === largerIdx) continue;
        if (overlapArea(proposed, rooms[k].placed) > OVERLAP_TOLERANCE) {
          bad = true;
          break;
        }
      }
      if (bad) continue;

      rooms[smallerIdx] = { ...rooms[smallerIdx], placed: proposed };
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "moved",
        edge: cand.edge,
      });
      applied = true;
      break;
    }

    if (!applied) {
      records.push({
        a: decl.a,
        b: decl.b,
        relationship: rel,
        action: "skipped-would-overlap",
        note: "every candidate edge would overlap another room",
      });
    }
  }

  return { rooms, records };
}
