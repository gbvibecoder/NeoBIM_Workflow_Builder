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

/**
 * Phase 3B fix #3 — sub-room guards.
 *
 * The previous carve enumerator handed the child the parent's FULL width
 * (or depth) on the carve side, which inflated the child far past requested
 * AND shrank the parent below livable size. Three guards now apply:
 *   A. Parent area after carve ≥ 70% of parent's requested area.
 *   B. Child area after carve ≤ 130% of child's requested area.
 *   C. Parent area after carve > Child area after carve.
 *
 * Children are also CLIPPED to their requested dimensions so they don't
 * stretch across the parent's full edge — the leftover slice becomes a
 * micro-void that the void-filler reclaims.
 *
 * If every carve fails all three guards, the least-bad option (smallest
 * combined distortion) is accepted with a warning. Better than skipping
 * the child entirely or letting it cannibalize the parent.
 */
const PARENT_MIN_AREA_RATIO = 0.70;
const CHILD_MAX_AREA_RATIO = 1.30;

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

    const candidates = enumerateCarves(parent.placed, child);
    const feasibleByGeometry = candidates.filter(c =>
      isInside(c.parent, input.plot) &&
      isInside(c.child, input.plot) &&
      !overlapsAny(c.parent, all, parent.id) &&
      !overlapsAny(c.child, all, parent.id, child.id),
    );
    if (feasibleByGeometry.length === 0) {
      warnings.push(`${child.name}: no feasible carve option from parent ${parent.name} — left unplaced`);
      continue;
    }

    // Apply the three Phase 3B guards.
    const parentReqArea = parent.requested_area_sqft || (parent.placed.width * parent.placed.depth);
    const childReqArea  = child.requested_area_sqft  || (child.requested_width_ft * child.requested_depth_ft);
    const parentMinArea = parentReqArea * PARENT_MIN_AREA_RATIO;
    const childMaxArea  = childReqArea  * CHILD_MAX_AREA_RATIO;

    const annotated = feasibleByGeometry.map(c => {
      const pa = c.parent.width * c.parent.depth;
      const ca = c.child.width * c.child.depth;
      return {
        ...c,
        parentArea: pa,
        childArea: ca,
        guardA: pa >= parentMinArea,
        guardB: ca <= childMaxArea,
        guardC: pa > ca,
        // Combined penalty for graceful degradation when no candidate passes:
        // weighted parent shrinkage + child overgrowth + aspect distortion.
        penalty:
          Math.max(0, parentMinArea - pa) / Math.max(1, parentReqArea) * 2 +
          Math.max(0, ca - childMaxArea) / Math.max(1, childReqArea) +
          c.aspectScore * 0.3,
      };
    });

    const passing = annotated.filter(c => c.guardA && c.guardB && c.guardC);
    const awayFrom = sideAwayFromHallway(facing, parent.placed!, input.spine);
    let pool = passing;
    if (pool.length === 0) {
      // Graceful degradation. Filter to AWAY-from-hallway sides first so the
      // parent retains its spine adjacency even when no candidate passes the
      // size guards. Otherwise the parent becomes orphaned from circulation.
      const awayCandidates = annotated.filter(c => c.side === awayFrom);
      const base = awayCandidates.length > 0 ? awayCandidates : annotated;
      pool = [...base].sort((a, b) => a.penalty - b.penalty).slice(0, 1);
      warnings.push(
        `${child.name} attached to ${parent.name}: no carve passes all guards — picked least-bad ` +
        `(parent ${pool[0].parentArea.toFixed(0)}/${parentReqArea.toFixed(0)} sqft, ` +
        `child ${pool[0].childArea.toFixed(0)}/${childReqArea.toFixed(0)} sqft, side=${pool[0].side})`,
      );
    }

    // Prefer the side away from the hallway, then by penalty (lower is better).
    pool.sort((a, b) => {
      const aPref = a.side === awayFrom ? 0 : 1;
      const bPref = b.side === awayFrom ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return a.penalty - b.penalty;
    });
    const winner = pool[0];

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

function enumerateCarves(parent: Rect, child: StripPackRoom): CarveCandidate[] {
  const reqW = Math.max(MIN_CHILD_WIDTH_FT, child.requested_width_ft);
  const reqD = Math.max(MIN_CHILD_DEPTH_FT, child.requested_depth_ft);
  const out: CarveCandidate[] = [];

  // CLIP the child to its requested dimensions. The residual between the
  // child and the carved parent edge becomes a void that void-filler
  // reclaims. Center-anchor the child along the shared edge — previously
  // the child was west/south-corner anchored, which meant a sibling's later
  // perpendicular carve on that same corner destroyed the shared wall
  // between child and parent (Phase 3E fix — Ensuite-Master short-wall).
  const childWClipped = Math.min(parent.width, reqW);
  const childDClipped = Math.min(parent.depth, reqD);
  const xCenter = parent.x + (parent.width - childWClipped) / 2;
  const yCenter = parent.y + (parent.depth - childDClipped) / 2;

  // SOUTH: parent shrinks on its south edge; child at south, centered in x.
  if (parent.depth - reqD >= MIN_PARENT_DEPTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y + reqD, width: parent.width, depth: parent.depth - reqD };
    const newChild:  Rect = { x: xCenter, y: parent.y, width: childWClipped, depth: reqD };
    out.push({ side: "south", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // NORTH: parent shrinks on its north edge; child at north, centered in x.
  if (parent.depth - reqD >= MIN_PARENT_DEPTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y, width: parent.width, depth: parent.depth - reqD };
    const newChild:  Rect = { x: xCenter, y: parent.y + parent.depth - reqD, width: childWClipped, depth: reqD };
    out.push({ side: "north", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // EAST: parent shrinks on its east edge; child at east, centered in y.
  if (parent.width - reqW >= MIN_PARENT_WIDTH_FT) {
    const newParent: Rect = { x: parent.x, y: parent.y, width: parent.width - reqW, depth: parent.depth };
    const newChild:  Rect = { x: parent.x + parent.width - reqW, y: yCenter, width: reqW, depth: childDClipped };
    out.push({ side: "east", parent: newParent, child: newChild, aspectScore: aspectDistortion(parent, newParent) });
  }

  // WEST: parent shrinks on its west edge; child at west, centered in y.
  if (parent.width - reqW >= MIN_PARENT_WIDTH_FT) {
    const newParent: Rect = { x: parent.x + reqW, y: parent.y, width: parent.width - reqW, depth: parent.depth };
    const newChild:  Rect = { x: parent.x, y: yCenter, width: reqW, depth: childDClipped };
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
function sideAwayFromHallway(facing: Facing, parent: Rect, spine: SpineLayout): Side {
  // "Away" means the parent edge opposite to where the spine (hallway) lies.
  // Identify which side of the spine the parent is on, then return the
  // parent edge pointing AWAY from the spine.
  if (facing === "north" || facing === "south") {
    const spineTop = spine.spine.y + spine.spine.depth;
    // Parent north of spine → hallway is on its south → AWAY = north.
    return parent.y >= spineTop ? "north" : "south";
  }
  const spineRight = spine.spine.x + spine.spine.width;
  // Parent east of spine → hallway is on its west → AWAY = east.
  return parent.x >= spineRight ? "east" : "west";
}
