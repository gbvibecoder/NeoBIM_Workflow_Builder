"""
Wall segmentation — group parser walls into named WallSegmentDrafts.

Source of truth: DESIGN.md §6.3 + 02_ALGORITHMS Problem 2.

Algorithm overview (5 steps):
  1. Build endpoint→junction lookup (quantized to JUNCTION_TOLERANCE_MM = 20mm).
  2. Detect the external perimeter: walls whose BOTH endpoints sit at CORNER
     junctions form the closed loop. (For Vamshi-style orthogonal plans this
     finds the 4 outer walls.)
  3. Walk the perimeter clockwise starting from min-x/min-y corner, splitting
     at every CORNER junction. Each collinear run between corners becomes one
     external segment, labeled P_EXT_1, P_EXT_2, ... in walk order.
  4. Treat remaining walls (not in the perimeter) as open chains. A chain
     groups collinear walls connected through END / T_JOIN junctions (collinearity
     within ANGLE_COLLINEAR_TOL_DEG = 3°). Each chain becomes one internal segment.
  5. Assign internal IDs: sort chains by length_mm DESC, then by min_start_x ASC,
     then by start_y ASC. Number them starting at P_INT_{N+1} where N is the
     number of externals (matches Vamshi: externals 1..4 → internals 5..10).

Determinism: pure function, no random, no datetime.now(). Same parser output
⇒ same WallSegmentDraft list in the same order, bit-for-bit.

R-refinement status: R1 (corner ownership) ships in PR 6 corner_handler.
This module produces is_closed_loop + endpoint_junction_types, which Problem 3
(orientation_inferrer) consumes per DESIGN §6.4 priority ladder.
"""

from __future__ import annotations

import math
from typing import Optional

from .constants import (
    ANGLE_COLLINEAR_TOL_DEG,
    JUNCTION_TOLERANCE_MM,
)
from .types import ParserJunction, ParserWall, WallSegmentDraft

# ──────────────────────────────────────────────────────────────────────────────
# Geometry helpers (private)
# ──────────────────────────────────────────────────────────────────────────────


def _quantize_point(point: tuple[float, float]) -> tuple[int, int]:
    """Snap an (x, y) point onto the JUNCTION_TOLERANCE_MM grid so endpoints
    that should meet at the same junction get the same lookup key.

    This mirrors parser kos_drawing_geometry.py:_detect_junctions clustering
    behaviour (which uses the same 20mm grid)."""
    cell = JUNCTION_TOLERANCE_MM
    return (round(point[0] / cell), round(point[1] / cell))


def _points_close(p1: tuple[float, float], p2: tuple[float, float]) -> bool:
    """True iff two points are within JUNCTION_TOLERANCE_MM."""
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= JUNCTION_TOLERANCE_MM


def _other_endpoint(
    wall: ParserWall, given_endpoint: tuple[float, float]
) -> tuple[float, float]:
    """Return whichever of (wall.start, wall.end) is NOT `given_endpoint`."""
    return wall.end if _points_close(wall.start, given_endpoint) else wall.start


def _is_collinear(angle_a: float, angle_b: float) -> bool:
    """Two parser angles (both in [0, 180)) are collinear within
    ANGLE_COLLINEAR_TOL_DEG. Uses modular comparison (so 179.9° and 0.1°
    are considered collinear)."""
    delta = abs(angle_a - angle_b) % 180.0
    return delta < ANGLE_COLLINEAR_TOL_DEG or delta > (180.0 - ANGLE_COLLINEAR_TOL_DEG)


def _angle_of_displacement(dx: float, dy: float) -> float:
    """Direction angle in [0, 360) of a displacement vector."""
    return math.degrees(math.atan2(dy, dx)) % 360.0


# ──────────────────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────────────────


def segment_walls(
    walls: tuple[ParserWall, ...],
    junctions: tuple[ParserJunction, ...],
) -> list[WallSegmentDraft]:
    """Group parser walls into WallSegmentDrafts per DESIGN.md §6.3.

    Returns:
        Ordered list of WallSegmentDraft with deterministic IDs:
          - Externals first, labeled P_EXT_1..P_EXT_N in clockwise walk order
            from the min-x/min-y perimeter corner.
          - Internals next, labeled P_INT_{N+1}..P_INT_{N+M} after sorting
            by length_mm DESC, then min_start_x ASC, then start_y ASC.

    Empty input → empty output (no exception).
    """
    if not walls:
        return []

    walls_by_id: dict[str, ParserWall] = {w.id: w for w in walls}
    point_to_junction = _build_endpoint_lookup(junctions)

    # ── Step 1+2: identify perimeter walls ──────────────────────────────
    perimeter_ids = _find_perimeter_wall_ids(walls_by_id, point_to_junction)

    # ── Step 3: walk perimeter clockwise, split into segments ───────────
    external_drafts: list[WallSegmentDraft] = []
    if perimeter_ids:
        walk = _walk_perimeter_clockwise(perimeter_ids, walls_by_id, point_to_junction)
        external_drafts = _split_perimeter_into_segments(walk, walls_by_id, point_to_junction)

    # ── Step 4: open chains for remaining walls ─────────────────────────
    perimeter_set = set(perimeter_ids)
    remaining_ids = [w.id for w in walls if w.id not in perimeter_set]
    internal_drafts = _walk_open_chains(remaining_ids, walls_by_id, point_to_junction)

    # ── Step 5: assign deterministic IDs ────────────────────────────────
    drafts: list[WallSegmentDraft] = []
    for i, d in enumerate(external_drafts):
        drafts.append(_with_id(d, f"P_EXT_{i + 1}"))

    n_externals = len(external_drafts)
    # Sort internals: length DESC, then min_start_x ASC, then start_y ASC.
    internal_drafts.sort(
        key=lambda d: (
            -d.length_mm,
            min(p[0] for p in d.plan_polyline),
            min(p[1] for p in d.plan_polyline),
        )
    )
    for i, d in enumerate(internal_drafts):
        drafts.append(_with_id(d, f"P_INT_{n_externals + 1 + i}"))

    return drafts


# ──────────────────────────────────────────────────────────────────────────────
# Step 1: endpoint → junction lookup
# ──────────────────────────────────────────────────────────────────────────────


def _build_endpoint_lookup(
    junctions: tuple[ParserJunction, ...],
) -> dict[tuple[int, int], ParserJunction]:
    """Build a quantized (grid_x, grid_y) → ParserJunction map. Used for O(1)
    junction lookup from a wall's endpoint coordinates."""
    return {_quantize_point(j.point): j for j in junctions}


def _junction_at(
    point: tuple[float, float],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> Optional[ParserJunction]:
    return point_to_junction.get(_quantize_point(point))


# ──────────────────────────────────────────────────────────────────────────────
# Step 2: identify perimeter walls
# ──────────────────────────────────────────────────────────────────────────────


def _find_perimeter_wall_ids(
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> list[str]:
    """Return the wall ids that form a closed external perimeter.

    Heuristic: a wall is part of the perimeter iff BOTH its endpoints sit at
    CORNER junctions (wall_count == 2). For orthogonal plans like Vamshi
    this finds the outer rectangle's 4 walls.

    Returns [] if no closed perimeter is detected (e.g. all walls are internal
    partitions, or the perimeter is split by openings into walls with END
    junctions — handled later by collinear-chain merging in PR enhancement).
    """
    candidates: list[str] = []
    for w in walls_by_id.values():
        start_j = _junction_at(w.start, point_to_junction)
        end_j = _junction_at(w.end, point_to_junction)
        if start_j is None or end_j is None:
            continue
        if start_j.type == "CORNER" and end_j.type == "CORNER":
            candidates.append(w.id)
    # Sanity: a closed perimeter needs at least 4 walls (rectangle minimum).
    if len(candidates) < 4:
        return []
    return candidates


# ──────────────────────────────────────────────────────────────────────────────
# Step 3: walk perimeter clockwise + split at corners
# ──────────────────────────────────────────────────────────────────────────────


def _walk_perimeter_clockwise(
    perimeter_ids: list[str],
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> list[ParserWall]:
    """Walk the perimeter starting at the (min-x, min-y) corner, choosing the
    first wall that goes in the "east" direction (angle 0°) when possible —
    this places `P_EXT_1` along the south edge for typical CAD-coord plans
    (matches Vamshi: P_EXT_1 = south, P_EXT_2 = east, P_EXT_3 = north,
    P_EXT_4 = west).

    For the orthogonal-rectangle case this produces the correct 4-wall walk.
    Non-orthogonal or complex perimeters are deferred to a future enhancement.
    """
    perim_walls = [walls_by_id[wid] for wid in perimeter_ids]
    # Find the (min-x, min-y) corner among all perimeter endpoints.
    all_endpoints = [(p, w) for w in perim_walls for p in (w.start, w.end)]
    start_point, _ = min(all_endpoints, key=lambda kv: (kv[0][0], kv[0][1]))

    # The two perimeter walls meeting at this corner. Pick the one whose
    # displacement direction has angle closest to 0° (east). That gives
    # clockwise-visual (math-CCW) ordering for CAD coords with y up.
    perim_set = set(perimeter_ids)
    j = _junction_at(start_point, point_to_junction)
    if j is None:
        return []
    initial_candidates = [
        walls_by_id[wid] for wid in j.wall_ids if wid in perim_set
    ]

    def _displacement_angle_from(wall: ParserWall) -> float:
        other = _other_endpoint(wall, start_point)
        return _angle_of_displacement(other[0] - start_point[0], other[1] - start_point[1])

    # Sort by displacement angle ASC — angle 0° (east) comes first, then 90°
    # (north), then 180° (west), then 270° (south).
    initial_candidates.sort(key=_displacement_angle_from)
    if not initial_candidates:
        return []
    first_wall = initial_candidates[0]

    # Walk forward, threading through corner junctions until we return to start.
    walk: list[ParserWall] = [first_wall]
    visited: set[str] = {first_wall.id}
    current_far_endpoint = _other_endpoint(first_wall, start_point)
    current_wall = first_wall

    while True:
        j = _junction_at(current_far_endpoint, point_to_junction)
        if j is None:
            break
        next_candidates = [
            walls_by_id[wid]
            for wid in j.wall_ids
            if wid in perim_set and wid != current_wall.id and wid not in visited
        ]
        if not next_candidates:
            break       # back at start (visited closed the loop) or chain terminated
        next_wall = next_candidates[0]
        walk.append(next_wall)
        visited.add(next_wall.id)
        current_far_endpoint = _other_endpoint(next_wall, current_far_endpoint)
        current_wall = next_wall

    return walk


def _split_perimeter_into_segments(
    walk: list[ParserWall],
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> list[WallSegmentDraft]:
    """Split the perimeter walk into collinear segments — each consecutive run
    of collinear walls (separated by END junctions, e.g. opening edges)
    becomes one segment. A CORNER junction always ends the current segment.

    For Vamshi-style 4-wall rectangles each wall is its own segment (because
    walls meet only at CORNER junctions). For plans with openings on the
    perimeter, multiple walls may merge into one segment.
    """
    if not walk:
        return []

    segments: list[WallSegmentDraft] = []
    current_run: list[ParserWall] = []

    def _flush_run() -> None:
        if current_run:
            segments.append(_build_draft_from_walls(current_run, is_closed_loop=True,
                                                    endpoint_junction_types=()))
            current_run.clear()

    # Walk along the perimeter. For each wall, decide whether to continue the
    # current run (collinear with previous) or start a new segment (corner).
    prev_wall: Optional[ParserWall] = None
    # The "current trailing endpoint" — the endpoint we just arrived at after
    # walking the previous wall.
    trailing_endpoint: Optional[tuple[float, float]] = None

    for w in walk:
        if prev_wall is None:
            current_run.append(w)
            # Determine the trailing endpoint: the far end of the first wall in
            # the walk direction. For perimeter walk we start at min corner,
            # so first wall's "trailing end" is the one farther from start.
            trailing_endpoint = w.end  # placeholder; properly computed below
        else:
            # Determine the junction between prev_wall and w
            shared_junction = _shared_endpoint(prev_wall, w)
            j = _junction_at(shared_junction, point_to_junction) if shared_junction else None
            if (
                j is not None
                and j.type == "CORNER"
                and not _is_collinear(prev_wall.angle_degrees, w.angle_degrees)
            ):
                # Non-collinear corner: close out the current run, start new.
                _flush_run()
                current_run.append(w)
            else:
                # Collinear continuation (END junction or X_JOIN that preserves direction)
                current_run.append(w)

        prev_wall = w

    _flush_run()
    return segments


def _shared_endpoint(
    w1: ParserWall, w2: ParserWall
) -> Optional[tuple[float, float]]:
    """Return the endpoint coordinate shared between two walls (within
    JUNCTION_TOLERANCE_MM), or None if they don't share an endpoint."""
    for p1 in (w1.start, w1.end):
        for p2 in (w2.start, w2.end):
            if _points_close(p1, p2):
                return p1
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Step 4: open chains for internal walls
# ──────────────────────────────────────────────────────────────────────────────


def _walk_open_chains(
    remaining_ids: list[str],
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> list[WallSegmentDraft]:
    """Walk each remaining wall as an open chain. A chain extends through END
    or T_JOIN junctions whenever the next wall is collinear with the current
    one. Each chain becomes one WallSegmentDraft.

    Single isolated walls (both ends END, no neighbours) become their own
    one-wall chains.
    """
    remaining = set(remaining_ids)
    visited: set[str] = set()
    chains: list[WallSegmentDraft] = []

    # Walk in deterministic order so repeated runs produce the same chain order.
    for wid in sorted(remaining):
        if wid in visited:
            continue
        chain_walls, end_types = _walk_chain_from(
            walls_by_id[wid], remaining, visited, walls_by_id, point_to_junction
        )
        if chain_walls:
            draft = _build_draft_from_walls(
                chain_walls, is_closed_loop=False, endpoint_junction_types=end_types
            )
            chains.append(draft)
    return chains


def _walk_chain_from(
    start: ParserWall,
    remaining: set[str],
    visited: set[str],
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> tuple[list[ParserWall], tuple[str, ...]]:
    """Extend a chain from `start` in both directions, collecting all collinear
    walls reachable through END / T_JOIN junctions. Returns (chain_walls,
    (junction_type_at_left_end, junction_type_at_right_end))."""
    visited.add(start.id)
    walls_left: list[ParserWall] = []   # walls extended from start.start
    walls_right: list[ParserWall] = []  # walls extended from start.end

    # Extend toward start.start
    curr = start
    far = curr.start
    while True:
        next_wall = _next_collinear_neighbour(
            curr, far, remaining, visited, walls_by_id, point_to_junction
        )
        if next_wall is None:
            break
        walls_left.insert(0, next_wall)
        visited.add(next_wall.id)
        far = _other_endpoint(next_wall, far)
        curr = next_wall

    left_end_point = far

    # Extend toward start.end
    curr = start
    far = curr.end
    while True:
        next_wall = _next_collinear_neighbour(
            curr, far, remaining, visited, walls_by_id, point_to_junction
        )
        if next_wall is None:
            break
        walls_right.append(next_wall)
        visited.add(next_wall.id)
        far = _other_endpoint(next_wall, far)
        curr = next_wall

    right_end_point = far

    chain = walls_left + [start] + walls_right

    # Determine the junction types at the two chain ends.
    left_junction = _junction_at(left_end_point, point_to_junction)
    right_junction = _junction_at(right_end_point, point_to_junction)
    left_type = left_junction.type if left_junction else "END"
    right_type = right_junction.type if right_junction else "END"

    return (chain, (left_type, right_type))


def _next_collinear_neighbour(
    curr_wall: ParserWall,
    far_endpoint: tuple[float, float],
    remaining: set[str],
    visited: set[str],
    walls_by_id: dict[str, ParserWall],
    point_to_junction: dict[tuple[int, int], ParserJunction],
) -> Optional[ParserWall]:
    """At the junction sitting at `far_endpoint`, find the next collinear
    wall in `remaining` that isn't visited. None if no such neighbour."""
    j = _junction_at(far_endpoint, point_to_junction)
    if j is None:
        return None
    if j.type not in ("END", "T_JOIN"):
        # CORNER and X_JOIN break collinearity → no continuation here
        return None
    candidates = [
        walls_by_id[wid]
        for wid in j.wall_ids
        if wid != curr_wall.id and wid in remaining and wid not in visited
    ]
    collinear = [
        w for w in candidates if _is_collinear(curr_wall.angle_degrees, w.angle_degrees)
    ]
    if not collinear:
        return None
    # Deterministic tiebreak: lexicographic wall id ordering
    collinear.sort(key=lambda w: w.id)
    return collinear[0]


# ──────────────────────────────────────────────────────────────────────────────
# Draft construction helpers
# ──────────────────────────────────────────────────────────────────────────────


def _build_draft_from_walls(
    walls_in_segment: list[ParserWall],
    is_closed_loop: bool,
    endpoint_junction_types: tuple[str, ...],
) -> WallSegmentDraft:
    """Build a WallSegmentDraft (id="" — assigned later) from a list of walls
    treated as a single segment."""
    if not walls_in_segment:
        raise ValueError("_build_draft_from_walls called with empty list")
    # Build polyline by chaining wall endpoints. Use the first wall's start as
    # the polyline start; track which endpoint of each subsequent wall is the
    # continuation.
    polyline: list[tuple[float, float]] = []
    current_far: Optional[tuple[float, float]] = None
    for i, w in enumerate(walls_in_segment):
        if i == 0:
            polyline.append(w.start)
            polyline.append(w.end)
            current_far = w.end
        else:
            # Pick the endpoint of w that DOESN'T match current_far (i.e. the
            # one we walked TO when extending the chain).
            if _points_close(w.start, current_far):
                polyline.append(w.end)
                current_far = w.end
            else:
                polyline.append(w.start)
                current_far = w.start

    # length_mm: plan-extent — Euclidean distance between polyline start and
    # end. For a closed perimeter walk this is 0 (start == end), so fall back
    # to sum-of-wall-lengths in that case. For straight chains it equals the
    # Euclidean span (correct A11 plan-extent).
    if len(polyline) >= 2:
        start_pt, end_pt = polyline[0], polyline[-1]
        plan_extent = math.hypot(end_pt[0] - start_pt[0], end_pt[1] - start_pt[1])
        if plan_extent < 1.0:    # degenerate (closed loop or near-coincident)
            plan_extent = sum(w.length_mm for w in walls_in_segment)
    else:
        plan_extent = sum(w.length_mm for w in walls_in_segment)

    return WallSegmentDraft(
        id="",
        source_wall_ids=tuple(w.id for w in walls_in_segment),
        plan_polyline=tuple(polyline),
        length_mm=plan_extent,
        is_closed_loop=is_closed_loop,
        endpoint_junction_types=endpoint_junction_types,
    )


def _with_id(draft: WallSegmentDraft, new_id: str) -> WallSegmentDraft:
    """Return a copy of `draft` with the id field replaced. Frozen-friendly."""
    import dataclasses
    return dataclasses.replace(draft, id=new_id)
