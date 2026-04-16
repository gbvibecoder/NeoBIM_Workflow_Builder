/**
 * Step 8 — attach ensuite / walk-in / attached bathroom to its parent room.
 *
 * Algorithm:
 *   For each child with `is_attached_to`:
 *     1. Find the parent in the already-placed list.
 *     2. Try four carve options (north / south / east / west of parent):
 *          - shrink the parent on that side by the child's matching dim
 *          - child takes the freed slice; child's other dim = parent's full dim
 *     3. Reject carve options that would (a) overlap any other placed room,
 *        (b) leave the parent below MIN_ROOM size, or (c) leave the child
 *        below MIN_ROOM size.
 *     4. Among feasible options, pick the one that keeps the parent's aspect
 *        ratio closest to the requested ratio. Tie-break: side AWAY from the
 *        hallway (parent retains hallway access by default).
 *
 * Guarantees: child shares a wall with parent by construction.
 */
import type { Rect, StripPackRoom, SpineLayout, Facing } from "./types";
import { rectOverlap } from "./types";

const MIN_PARENT_WIDTH_FT = 7;
const MIN_PARENT_DEPTH_FT = 7;
const MIN_CHILD_WIDTH_FT = 4;
const MIN_CHILD_DEPTH_FT = 4;

type Side = "north" | "south" | "east" | "west";

interface CarveCandidate {
  side: Side;
  parent: Rect;
  child: Rect;
  aspectScore: number; // lower is better
}

export interface AttachInput {
  /** All rooms after strip-packing — placed rooms have .placed set. */
  allPlaced: StripPackRoom[];
  /** Attached rooms to wire into their parents. .placed undefined initially. */
  attached: StripPackRoom[];
  spine: SpineLayout;
  plot: Rect;
}

export interface AttachOutput {
  /** Updated allPlaced (with parent rectangles shrunk + children inserted). */
  rooms: StripPackRoom[];
  warnings: string[];
}

export function attachSubRooms(input: AttachInput): AttachOutput {
  const warnings: string[] = [];
  const all = input.allPlaced.map(r => ({ ...r })); // shallow copy for safe mutation
  const facing = input.spine.entrance_side;

  // Resolve "" sentinel parents from the classifier: when the classifier
  // tagged a room as attached but couldn't pick a parent, try to find one
  // via the room's adjacency list (must reference a single bedroom-like room).
  for (const child of input.attached) {
    if (child.is_attached_to === undefined || child.is_attached_to !== "") continue;
    const candidate = child.adjacencies
      .map(id => all.find(r => r.id === id))
      .find(r => r && (r.zone === "PRIVATE" || r.type.includes("bedroom")));
    if (candidate) child.is_attached_to = candidate.id;
  }

  for (const child of input.attached) {
    if (!child.is_attached_to) {
      warnings.push(`${child.name}: attached child with no resolvable parent — left unplaced`);
      continue;
    }
    const parent = all.find(r => r.id === child.is_attached_to);
    if (!parent || !parent.placed) {
      warnings.push(`${child.name}: parent ${child.is_attached_to} not placed — left unplaced`);
      continue;
    }

    const candidates = enumerateCarves(parent.placed, child, child.is_wet);
    const feasible = candidates.filter(c =>
      isInside(c.parent, input.plot) &&
      isInside(c.child, input.plot) &&
      !overlapsAny(c.parent, all, parent.id) &&
      !overlapsAny(c.child, all, parent.id, child.id),
    );
    if (feasible.length === 0) {
      warnings.push(`${child.name}: no feasible carve option from parent ${parent.name} — left unplaced`);
      continue;
    }

    // Prefer the side away from the hallway, then by aspect score.
    feasible.sort((a, b) => {
      const aPref = sideAwayFromHallway(facing, parent.placed!, input.spine) === a.side ? 0 : 1;
      const bPref = sideAwayFromHallway(facing, parent.placed!, input.spine) === b.side ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return a.aspectScore - b.aspectScore;
    });
    const winner = feasible[0];

    parent.placed = winner.parent;
    parent.actual_area_sqft = winner.parent.width * winner.parent.depth;

    const childCopy: StripPackRoom = {
      ...child,
      placed: winner.child,
      actual_area_sqft: winner.child.width * winner.child.depth,
    };
    all.push(childCopy);
  }

  return { rooms: all, warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// CARVE OPTIONS
// ───────────────────────────────────────────────────────────────────────────

function enumerateCarves(parent: Rect, child: StripPackRoom, _isWet: boolean): CarveCandidate[] {
  const cw = Math.max(MIN_CHILD_WIDTH_FT, child.requested_width_ft);
  const cd = Math.max(MIN_CHILD_DEPTH_FT, child.requested_depth_ft);
  const out: CarveCandidate[] = [];

  // SOUTH: shrink parent on its south edge; child stretches across parent width.
  if (parent.depth - cd >= MIN_PARENT_DEPTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y + cd, width: parent.width, depth: parent.depth - cd };
    const newChild:  Rect = { x: parent.x, y: parent.y, width: parent.width, depth: cd };
    out.push({ side: "south", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // NORTH: shrink parent on its north edge.
  if (parent.depth - cd >= MIN_PARENT_DEPTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y, width: parent.width, depth: parent.depth - cd };
    const newChild:  Rect = { x: parent.x, y: parent.y + parent.depth - cd, width: parent.width, depth: cd };
    out.push({ side: "north", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // EAST: shrink parent on its east edge; child stretches across parent depth.
  if (parent.width - cw >= MIN_PARENT_WIDTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y, width: parent.width - cw, depth: parent.depth };
    const newChild:  Rect = { x: parent.x + parent.width - cw, y: parent.y, width: cw, depth: parent.depth };
    out.push({ side: "east", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // WEST: shrink parent on its west edge.
  if (parent.width - cw >= MIN_PARENT_WIDTH_FT) {
    const newParent: Rect = { x: parent.x + cw, y: parent.y, width: parent.width - cw, depth: parent.depth };
    const newChild:  Rect = { x: parent.x, y: parent.y, width: cw, depth: parent.depth };
    out.push({ side: "west", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  return out;
}

function aspectDistortion(orig: Rect, newRect: Rect): number {
  const origRatio = orig.width / Math.max(orig.depth, 0.01);
  const newRatio = newRect.width / Math.max(newRect.depth, 0.01);
  return Math.abs(Math.log(origRatio) - Math.log(newRatio));
}

function isInside(r: Rect, container: Rect): boolean {
  return r.x >= container.x - 1e-3 &&
         r.y >= container.y - 1e-3 &&
         r.x + r.width  <= container.x + container.width  + 1e-3 &&
         r.y + r.depth  <= container.y + container.depth  + 1e-3;
}

function overlapsAny(rect: Rect, rooms: StripPackRoom[], ...excludeIds: string[]): boolean {
  for (const r of rooms) {
    if (excludeIds.includes(r.id)) continue;
    if (!r.placed) continue;
    if (rectOverlap(rect, r.placed) > 1e-3) return true;
  }
  return false;
}

/**
 * For a given parent's placed rect, return the side of the parent that faces
 * AWAY from the hallway. We prefer to carve on this side so the parent keeps
 * its door to the hallway intact.
 */
function sideAwayFromHallway(facing: Facing, _parent: Rect, _spine: SpineLayout): Side {
  // For north-facing: hallway is between front (north) and back (south) strips.
  //   - Front-strip rooms have hallway on their SOUTH → "away" = NORTH.
  //   - Back-strip rooms have hallway on their NORTH → "away" = SOUTH.
  // We don't know which strip the parent was in without checking, but the
  // parent's y vs spine.y tells us:
  if (facing === "north") {
    return _parent.y >= _spine.spine.y + _spine.spine.depth ? "north" : "south";
  }
  if (facing === "south") {
    return _parent.y >= _spine.spine.y + _spine.spine.depth ? "south" : "north";
  }
  if (facing === "east") {
    return _parent.x >= _spine.spine.x + _spine.spine.width ? "east" : "west";
  }
  return _parent.x >= _spine.spine.x + _spine.spine.width ? "west" : "east";
}
