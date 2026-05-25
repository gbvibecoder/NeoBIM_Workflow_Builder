"""Shared geometry helpers for opening (door/window) detection — Phase 5C-3.

Used by the DXF detector (``kos_opening_dxf``) and the PDF detector
(``kos_opening_pdf``). Pure functions: no ezdxf / fitz imports here. Inputs
are wall dicts (the parser-canonical shape from
:func:`kos_drawing_geometry._seg_to_wall`) and (x, y) tuples in millimetres.

Why a separate module:
  - Detector tiers 2/3/4 share the same geometric primitives: project a point
    onto a wall axis, measure perpendicular distance, test whether two walls
    are collinear with a gap between them. Putting these in the detector
    files themselves would duplicate ~120 LOC per format.
  - The opening_overlaps / dedupe / sort helpers live in
    ``kos_drawing_geometry`` (alongside the ParserOpening record). This module
    holds the "near the wall" / "in the gap" primitives — i.e. helpers that
    operate on wall geometry, not on opening records.

All thresholds in this module are cited inline. The numerics are calibrated
against the 5C-3 Vamshi ground-truth fixture set (tests/fixtures/openings/).
"""

from __future__ import annotations

import math
import re
from typing import Iterable

# ── thresholds (citations inline) ─────────────────────────────────────────────

# Wall-axis projection tolerance. The "point lies on the wall axis" predicate
# accepts the projection if perpendicular distance ≤ this many millimetres.
# Calibrated to the wall thickness band: real walls are 50–500mm, so a point
# within 250mm of the centreline is plausibly "on the wall". Tighter than that
# rejects PDF-rendered arcs whose centres render with ~150mm jitter.
POINT_ON_WALL_PERP_TOL_MM: float = 250.0

# Two walls are "collinear" (candidates to bracket a wall-gap opening) when
# their angle difference is ≤ this many degrees. Mirrors
# kos_drawing_geometry.THICKNESS_ANGLE_TOL_DEG (3°) since that's what the
# parser's own collinear merger already uses for the thickness pass.
COLLINEAR_ANGLE_TOL_DEG: float = 3.0

# Two collinear walls form a "wall-gap opening" when their facing endpoints
# are separated by between [GAP_MIN, GAP_MAX] mm AND their perpendicular
# offset is ≤ POINT_ON_WALL_PERP_TOL_MM. Min: smallest door width in Vamshi
# (750mm) minus jamb thickness ~110mm. Max: largest typical opening width
# (2400mm — see 5C-3 prompt §3 PR 2 threshold table).
GAP_MIN_WIDTH_MM: float = 600.0
GAP_MAX_WIDTH_MM: float = 2400.0

# Annotation-text-near-wall and arc-near-wall both use the same perpendicular
# tolerance band. Specifying the constant here so detectors can reference it
# rather than re-deriving from POINT_ON_WALL_PERP_TOL_MM.
NEAR_WALL_DEFAULT_PERP_TOL_MM: float = 300.0

# Regex for "D1 900x2100" / "W2 1200x1500" / "DR 900 x 2100" style annotations.
# Captures: kind ("D"/"W"/"DR"/"WIN"/"WND"), label number (optional), width, height.
# Inline citation: 5C-3 prompt §3 PR 2 "ANNOTATION_TEXT_REGEX" table row.
ANNOTATION_TEXT_RE = re.compile(
    r"""
    (?P<kind>D R | W I N | W N D | D | W)         # door/window kind
    \s* (?P<num>\d{1,3})?                          # optional label number ("D1", "W12")
    \s* (?P<width>\d{3,4})                         # width in mm (600..2400 range)
    \s* [x×*]                                      # × separator
    \s* (?P<height>\d{3,4})                        # height in mm
    """,
    re.IGNORECASE | re.VERBOSE,
)


# ── basic geometry ────────────────────────────────────────────────────────────


def project_point_to_wall(
    wall: dict,
    point: tuple[float, float],
) -> tuple[float, float] | None:
    """Project ``point`` onto the wall's axis.

    Returns ``(position_along_wall_mm, perpendicular_distance_mm)`` where
    ``position_along_wall_mm`` is measured from ``wall["start"]`` and may be
    negative or > wall length (caller decides whether to accept those).

    Returns ``None`` if the wall is degenerate (length 0).
    """
    ax, ay = wall["start"]
    bx, by = wall["end"]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length == 0:
        return None
    ux, uy = dx / length, dy / length
    px, py = point
    # Along-axis scalar (signed).
    t = (px - ax) * ux + (py - ay) * uy
    # Perpendicular distance (unsigned).
    perp = abs((px - ax) * (-uy) + (py - ay) * ux)
    return t, perp


def point_lies_on_wall(
    wall: dict,
    point: tuple[float, float],
    perp_tol_mm: float = POINT_ON_WALL_PERP_TOL_MM,
    margin_mm: float = 0.0,
) -> bool:
    """True iff ``point`` projects to a position INSIDE the wall extent
    AND its perpendicular distance to the wall axis is ≤ ``perp_tol_mm``.

    ``margin_mm`` slightly extends the wall extent on each end so e.g. a
    door swing arc centred 50mm before the wall start still counts as "on
    the wall". Default 0 — caller opts in.
    """
    projected = project_point_to_wall(wall, point)
    if projected is None:
        return False
    t, perp = projected
    if perp > perp_tol_mm:
        return False
    length = float(wall["length_mm"])
    return -margin_mm <= t <= length + margin_mm


def arc_near_wall(
    centre: tuple[float, float],
    radius_mm: float,
    walls: Iterable[dict],
    perp_tol_mm: float = NEAR_WALL_DEFAULT_PERP_TOL_MM,
) -> tuple[str, float] | None:
    """Find the wall whose axis the arc centre sits closest to.

    Returns ``(wall_id, position_along_wall_mm)`` for the best match (smallest
    perpendicular distance below ``perp_tol_mm`` AND projection inside extent),
    or ``None`` if no wall qualifies.

    Used by detector Tier 2: door swing arcs have their hinge at the
    door-jamb, which sits on the wall axis. The arc radius ≈ door width.
    Caller validates radius_mm separately against the SWING_ARC_RADIUS range.
    """
    best: tuple[str, float] | None = None
    best_perp = math.inf

    # radius is captured for future use (caller already validates the range;
    # we keep the parameter to keep the signature stable across detector PRs).
    _ = radius_mm

    for w in walls:
        projected = project_point_to_wall(w, centre)
        if projected is None:
            continue
        t, perp = projected
        if perp > perp_tol_mm:
            continue
        length = float(w["length_mm"])
        if t < 0 or t > length:
            continue
        if perp < best_perp:
            best_perp = perp
            best = (w["id"], t)
    return best


def text_near_wall(
    insertion_point: tuple[float, float],
    walls: Iterable[dict],
    perp_tol_mm: float = NEAR_WALL_DEFAULT_PERP_TOL_MM * 2.0,  # text floats further
    margin_mm: float = 300.0,
) -> tuple[str, float] | None:
    """Find the wall closest to a text insertion point.

    Higher perp tolerance than arc detection because annotations are
    typically placed alongside the wall, not on it. ``margin_mm`` allows the
    annotation to sit slightly before/after the wall extent (common for
    leader callouts).

    Returns ``(wall_id, position_along_wall_mm)`` or ``None`` if no wall is
    within tolerance. Position is CLAMPED to [0, wall_length] so the caller
    gets a usable position even when the annotation floats just past the
    wall end.
    """
    best: tuple[str, float] | None = None
    best_perp = math.inf

    for w in walls:
        projected = project_point_to_wall(w, insertion_point)
        if projected is None:
            continue
        t, perp = projected
        if perp > perp_tol_mm:
            continue
        length = float(w["length_mm"])
        if t < -margin_mm or t > length + margin_mm:
            continue
        if perp < best_perp:
            best_perp = perp
            # Clamp to wall extent for downstream consumers.
            clamped_t = min(max(t, 0.0), length)
            best = (w["id"], clamped_t)
    return best


def parse_annotation_text(text: str) -> tuple[str, float, float] | None:
    """Parse a door/window annotation like ``"D1 900x2100"``.

    Returns ``(opening_type, width_mm, height_mm)`` on match, ``None`` on
    no match. ``opening_type`` is "door" if the prefix starts with D/DR,
    "window" if W/WIN/WND.

    Width and height are bounded by the regex itself (300..9999mm), but the
    caller must still validate against detector-tier-specific min/max bands.
    """
    if not text:
        return None
    match = ANNOTATION_TEXT_RE.search(text)
    if not match:
        return None
    kind = match.group("kind").upper().replace(" ", "")
    width = float(match.group("width"))
    height = float(match.group("height"))
    if width <= 0 or height <= 0:
        return None
    if kind in ("D", "DR"):
        opening_type = "door"
    elif kind in ("W", "WIN", "WND"):
        opening_type = "window"
    else:
        # Defensive: regex shouldn't match anything else, but if it does we
        # fall through to None rather than guessing.
        return None
    return opening_type, width, height


# ── wall-gap detection ────────────────────────────────────────────────────────


def gap_in_collinear_walls(
    wall_a: dict,
    wall_b: dict,
    angle_tol_deg: float = COLLINEAR_ANGLE_TOL_DEG,
    perp_tol_mm: float = POINT_ON_WALL_PERP_TOL_MM,
    gap_min_mm: float = GAP_MIN_WIDTH_MM,
    gap_max_mm: float = GAP_MAX_WIDTH_MM,
) -> tuple[tuple[float, float], float] | None:
    """If ``wall_a`` and ``wall_b`` are collinear with a [GAP_MIN, GAP_MAX]
    millimetre gap between their facing endpoints, return the gap centre and
    width. Otherwise return ``None``.

    Algorithm:
      1. Reject if angle difference > angle_tol_deg (modulo 180° because
         a wall pointing left→right is the same axis as right→left).
      2. Reject if either endpoint of wall_b is more than perp_tol_mm
         off wall_a's axis (not actually collinear, just parallel).
      3. Project both endpoints of wall_b onto wall_a's axis. Find the
         smallest along-axis distance between any endpoint of wall_a and
         any endpoint of wall_b that does NOT overlap wall_a's extent.
      4. If that distance is in [gap_min_mm, gap_max_mm], emit the gap.

    Returns ``((gap_centre_x, gap_centre_y), gap_width_mm)``. The gap centre
    is on wall_a's axis at the midpoint between the two facing endpoints.
    """
    # Step 1 — angle filter.
    ang_a = float(wall_a["angle_degrees"])
    ang_b = float(wall_b["angle_degrees"])
    da = abs(ang_a - ang_b)
    da = min(da, 180.0 - da)  # normalise modulo 180°
    if da > angle_tol_deg:
        return None

    # Step 2 — perpendicular distance check using wall_a as reference axis.
    bx0, by0 = wall_b["start"]
    bx1, by1 = wall_b["end"]
    p0 = project_point_to_wall(wall_a, (bx0, by0))
    p1 = project_point_to_wall(wall_a, (bx1, by1))
    if p0 is None or p1 is None:
        return None
    t0, perp0 = p0
    t1, perp1 = p1
    if max(perp0, perp1) > perp_tol_mm:
        return None

    # Step 3 — find facing endpoints (smallest non-overlapping along-axis gap).
    length_a = float(wall_a["length_mm"])
    a_starts = [0.0, length_a]  # along-axis positions of wall_a endpoints
    b_starts = [t0, t1]

    # The gap is the segment between the smallest a_end and the larger b_start
    # (or vice-versa). We compute the four candidate gaps (each combination of
    # a-endpoint and b-endpoint) and pick the smallest POSITIVE gap, i.e. one
    # where wall_b's endpoint sits OUTSIDE wall_a's extent.
    best_gap: float | None = None
    best_midpoint_t: float | None = None

    for ta_end in a_starts:
        for tb_end in b_starts:
            # Gap = |distance between the two endpoints along axis|.
            gap = abs(tb_end - ta_end)
            # Reject "overlap" cases: the b endpoint must not sit INSIDE
            # wall_a's extent — that's an overlap, not a gap.
            # We approximate "outside" as: the OTHER b endpoint must be on
            # the same side of wall_a as this endpoint.
            other_tb = t1 if tb_end == t0 else t0
            # Both b endpoints are on the same side of wall_a means
            # both are < 0 or both are > length_a.
            if (tb_end < 0 and other_tb < 0):
                # b is entirely before a; gap is to a's start (ta_end == 0)
                if ta_end != 0.0:
                    continue
            elif (tb_end > length_a and other_tb > length_a):
                # b is entirely after a; gap is to a's end
                if ta_end != length_a:
                    continue
            else:
                # b crosses or overlaps wall_a — not a clean gap.
                continue

            if best_gap is None or gap < best_gap:
                best_gap = gap
                best_midpoint_t = (ta_end + tb_end) / 2.0

    if best_gap is None or best_midpoint_t is None:
        return None

    # Step 4 — width band filter.
    if best_gap < gap_min_mm or best_gap > gap_max_mm:
        return None

    # Compute the gap centre in world coordinates (on wall_a's axis).
    ax, ay = wall_a["start"]
    bx, by = wall_a["end"]
    dx, dy = bx - ax, by - ay
    if length_a == 0:
        return None
    ux, uy = dx / length_a, dy / length_a
    centre_x = ax + ux * best_midpoint_t
    centre_y = ay + uy * best_midpoint_t

    return (centre_x, centre_y), best_gap
