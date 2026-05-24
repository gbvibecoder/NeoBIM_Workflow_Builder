"""Tests for wall_segmenter.segment_walls — DESIGN.md §6.3.

Coverage:
  - Empty input → empty output
  - Single isolated wall (END/END) → 1 internal draft
  - Simple rectangle (4 perimeter walls + 4 corner junctions) → 4 P_EXT_1..4
    in clockwise walk order
  - Vamshi-style 10-segment synth: 4 externals + 6 internals → 4 P_EXT +
    6 P_INT_5..P_INT_10 numbered by length-desc tiebreak
  - Tiebreak ordering: equal-length internals sorted by min_start_x ASC
  - Plan polyline preservation
  - Determinism: repeated calls produce identical drafts
"""

from __future__ import annotations

from app.services.kos_panel_grid_mapper import (
    ParserJunction,
    ParserWall,
    WallSegmentDraft,
    segment_walls,
)

# ──────────────────────────────────────────────────────────────────────────────
# Fixture builders
# ──────────────────────────────────────────────────────────────────────────────


def _w(
    wid: str,
    start: tuple[float, float],
    end: tuple[float, float],
    thickness: float = 110.0,
    layer: str = "A-WALL-1",
) -> ParserWall:
    """Quick parser-wall constructor — auto-computes length and angle."""
    import math
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(dy, dx)) % 180.0
    return ParserWall(
        id=wid, start=start, end=end, length_mm=round(length, 2),
        thickness_mm=thickness, angle_degrees=round(angle, 2),
        layer=layer, detection_tier=1, confidence=0.85,
    )


def _j(
    point: tuple[float, float],
    junction_type: str,
    wall_ids: tuple[str, ...],
) -> ParserJunction:
    return ParserJunction(
        point=point, type=junction_type,
        wall_ids=wall_ids, wall_count=len(wall_ids),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Vamshi 10-segment synthesized input (per DESIGN §2.3 reference profile)
# ──────────────────────────────────────────────────────────────────────────────
#
# Rectangular perimeter: 9370 × 6692, origin at (0,0).
#   P_EXT_1 (south, length 9370)
#   P_EXT_2 (east,  length 6692)
#   P_EXT_3 (north, length 9370)
#   P_EXT_4 (west,  length 6692)
# 6 internal walls with lengths: 6537, 3632, 3016, 3016, 2963, 2101.
# Expected internal IDs after sort by length desc + tiebreak by min_start_x ASC:
#   P_INT_5 = 6537 (uniquely longest)
#   P_INT_6 = 3632
#   P_INT_7 = 3016 (smaller x)
#   P_INT_8 = 3016 (larger x)
#   P_INT_9 = 2963
#   P_INT_10 = 2101
# ──────────────────────────────────────────────────────────────────────────────


def _vamshi_synth() -> tuple[tuple[ParserWall, ...], tuple[ParserJunction, ...]]:
    """Synthesize a 10-segment Vamshi-style parser output.

    Layout:
      Perimeter (4 walls) — w0..w3 forming a 9370×6692 rectangle.
      Internals — 6 single-wall partitions placed so each has 1 T_JOIN end
      (where it meets a perimeter wall) and 1 END (free).
    """
    # Perimeter walls (clockwise from SW corner — south → east → north → west)
    w0 = _w("w0", (0, 0),       (9370, 0),    155)    # south — P_EXT_1
    w1 = _w("w1", (9370, 0),    (9370, 6692), 155)    # east  — P_EXT_2
    w2 = _w("w2", (9370, 6692), (0, 6692),    155)    # north — P_EXT_3
    w3 = _w("w3", (0, 6692),    (0, 0),       155)    # west  — P_EXT_4

    # Internals (each touches the south wall w0 at one end, ends free at the other)
    w10 = _w("w10", (2000, 0), (2000, 6537), 110)  # 6537 → P_INT_5
    w11 = _w("w11", (3000, 0), (3000, 3632), 110)  # 3632 → P_INT_6
    w12 = _w("w12", (4000, 0), (4000, 3016), 110)  # 3016, min_x=4000 → P_INT_7
    w13 = _w("w13", (6000, 0), (6000, 3016), 110)  # 3016, min_x=6000 → P_INT_8
    w14 = _w("w14", (7000, 0), (7000, 2963), 110)  # 2963 → P_INT_9
    w15 = _w("w15", (8000, 0), (8000, 2101), 110)  # 2101 → P_INT_10

    walls = (w0, w1, w2, w3, w10, w11, w12, w13, w14, w15)

    # Perimeter corners.
    # The south wall w0 is broken by 6 T_JOINs where internals branch off, so the
    # actual perimeter corners are just at the 4 building corners. The internal
    # T_JOIN points are NOT corners.
    j_sw = _j((0, 0),       "CORNER", ("w0", "w3"))
    j_se = _j((9370, 0),    "CORNER", ("w0", "w1"))
    j_ne = _j((9370, 6692), "CORNER", ("w1", "w2"))
    j_nw = _j((0, 6692),    "CORNER", ("w2", "w3"))

    # T_JOIN where each internal wall meets the south perimeter wall w0.
    # Each is a 3-wall junction: {south wall w0, internal wall, south wall w0
    # again} — but parser convention groups by wall_ids unique. Realistically
    # the south wall w0 isn't split; it passes through the T_JOIN. For this
    # synthesized input, treat each T_JOIN as 2 walls meeting: south w0 +
    # 1 internal. That's a wall_count==2 — but the algorithm doesn't pick it
    # as a perimeter (only walls with BOTH ends at CORNER count).
    # We mark these as T_JOIN with wall_count=3, listing both perimeter wall
    # plus the internal, mirroring parser behaviour (where a long wall reaching
    # a T-branch produces wall_count==3 because the wall continues on both sides).
    # For PR 4 synth purposes, the segmenter doesn't read wall_count to detect
    # T_JOIN — it uses the .type attribute directly.
    j_internal_tjoins = tuple(
        _j(
            (x, 0),
            "T_JOIN",
            ("w0", iid),
        )
        for x, iid in [
            (2000, "w10"),
            (3000, "w11"),
            (4000, "w12"),
            (6000, "w13"),
            (7000, "w14"),
            (8000, "w15"),
        ]
    )

    # END junctions at the free top end of each internal.
    j_internal_ends = (
        _j((2000, 6537), "END", ("w10",)),
        _j((3000, 3632), "END", ("w11",)),
        _j((4000, 3016), "END", ("w12",)),
        _j((6000, 3016), "END", ("w13",)),
        _j((7000, 2963), "END", ("w14",)),
        _j((8000, 2101), "END", ("w15",)),
    )

    junctions = (j_sw, j_se, j_ne, j_nw) + j_internal_tjoins + j_internal_ends
    return (walls, junctions)


# ──────────────────────────────────────────────────────────────────────────────
# Empty / degenerate inputs
# ──────────────────────────────────────────────────────────────────────────────


def test_segment_walls_empty_input_returns_empty_list() -> None:
    assert segment_walls((), ()) == []


def test_segment_walls_single_isolated_wall() -> None:
    """One wall with both ends as END junctions → 1 internal segment, no externals."""
    w = _w("w0", (0, 0), (1000, 0))
    j1 = _j((0, 0), "END", ("w0",))
    j2 = _j((1000, 0), "END", ("w0",))
    drafts = segment_walls((w,), (j1, j2))
    assert len(drafts) == 1
    assert drafts[0].id == "P_INT_1"
    assert drafts[0].is_closed_loop is False
    assert drafts[0].endpoint_junction_types == ("END", "END")
    assert drafts[0].source_wall_ids == ("w0",)
    assert drafts[0].length_mm == 1000.0


# ──────────────────────────────────────────────────────────────────────────────
# Simple rectangle (4-wall closed perimeter)
# ──────────────────────────────────────────────────────────────────────────────


def test_segment_walls_simple_rectangle_produces_4_p_ext() -> None:
    """Perimeter-only rectangle → P_EXT_1..P_EXT_4 in clockwise walk order."""
    w0 = _w("w0", (0, 0), (1000, 0))         # south
    w1 = _w("w1", (1000, 0), (1000, 500))    # east
    w2 = _w("w2", (1000, 500), (0, 500))     # north
    w3 = _w("w3", (0, 500), (0, 0))          # west
    js = (
        _j((0, 0),       "CORNER", ("w0", "w3")),
        _j((1000, 0),    "CORNER", ("w0", "w1")),
        _j((1000, 500),  "CORNER", ("w1", "w2")),
        _j((0, 500),     "CORNER", ("w2", "w3")),
    )
    drafts = segment_walls((w0, w1, w2, w3), js)
    assert len(drafts) == 4
    ids = [d.id for d in drafts]
    assert ids == ["P_EXT_1", "P_EXT_2", "P_EXT_3", "P_EXT_4"]
    assert all(d.is_closed_loop for d in drafts)
    assert all(d.endpoint_junction_types == () for d in drafts)


def test_simple_rectangle_walk_starts_with_south_edge() -> None:
    """P_EXT_1 must be the south edge (the wall east-going from min-x/min-y)."""
    w0 = _w("w0", (0, 0), (1000, 0))         # south
    w1 = _w("w1", (1000, 0), (1000, 500))    # east
    w2 = _w("w2", (1000, 500), (0, 500))     # north
    w3 = _w("w3", (0, 500), (0, 0))          # west
    js = (
        _j((0, 0), "CORNER", ("w0", "w3")),
        _j((1000, 0), "CORNER", ("w0", "w1")),
        _j((1000, 500), "CORNER", ("w1", "w2")),
        _j((0, 500), "CORNER", ("w2", "w3")),
    )
    drafts = segment_walls((w0, w1, w2, w3), js)
    # P_EXT_1 should contain w0 (south)
    assert "w0" in drafts[0].source_wall_ids
    assert "w1" in drafts[1].source_wall_ids   # east
    assert "w2" in drafts[2].source_wall_ids   # north
    assert "w3" in drafts[3].source_wall_ids   # west


# ──────────────────────────────────────────────────────────────────────────────
# Vamshi-style 10-segment test (the prompt's load-bearing requirement)
# ──────────────────────────────────────────────────────────────────────────────


def test_vamshi_synth_produces_4_externals_plus_6_internals() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    assert len(drafts) == 10


def test_vamshi_synth_external_ids_are_p_ext_1_through_4() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    external_ids = [d.id for d in drafts if d.is_closed_loop]
    assert external_ids == ["P_EXT_1", "P_EXT_2", "P_EXT_3", "P_EXT_4"]


def test_vamshi_synth_internal_ids_are_p_int_5_through_10() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    internal_ids = [d.id for d in drafts if not d.is_closed_loop]
    assert internal_ids == [
        "P_INT_5", "P_INT_6", "P_INT_7", "P_INT_8", "P_INT_9", "P_INT_10"
    ]


def test_vamshi_synth_internal_length_desc_tiebreak() -> None:
    """6 internal lengths: 6537, 3632, 3016, 3016, 2963, 2101 →
    sorted desc with tiebreak → P_INT_5..P_INT_10."""
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    by_id = {d.id: d for d in drafts}
    assert by_id["P_INT_5"].length_mm == 6537.0
    assert by_id["P_INT_6"].length_mm == 3632.0
    assert by_id["P_INT_7"].length_mm == 3016.0   # min_x = 4000
    assert by_id["P_INT_8"].length_mm == 3016.0   # min_x = 6000 (tie broken by min_x ASC)
    assert by_id["P_INT_9"].length_mm == 2963.0
    assert by_id["P_INT_10"].length_mm == 2101.0


def test_vamshi_synth_p_int_8_tiebreak_min_start_x_is_6000() -> None:
    """P_INT_7 vs P_INT_8 are both 3016mm long; tiebreak by min_start_x ASC.
    P_INT_8 is the rightmost (min_x=6000) of the two."""
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    p_int_8 = next(d for d in drafts if d.id == "P_INT_8")
    min_x = min(p[0] for p in p_int_8.plan_polyline)
    assert min_x == 6000


def test_vamshi_synth_externals_have_closed_loop_flag() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    externals = [d for d in drafts if d.id.startswith("P_EXT_")]
    assert all(d.is_closed_loop for d in externals)
    assert all(d.endpoint_junction_types == () for d in externals)


def test_vamshi_synth_internals_have_open_chain_endpoints() -> None:
    """Each Vamshi internal has T_JOIN at base (meeting south perimeter)
    and END at top (free)."""
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    internals = [d for d in drafts if d.id.startswith("P_INT_")]
    for d in internals:
        assert d.is_closed_loop is False
        assert set(d.endpoint_junction_types) == {"T_JOIN", "END"}


# ──────────────────────────────────────────────────────────────────────────────
# plan_polyline preservation
# ──────────────────────────────────────────────────────────────────────────────


def test_plan_polyline_for_simple_internal() -> None:
    """A single-wall chain's polyline must contain both endpoints."""
    w = _w("w0", (0, 0), (5000, 0))
    j1 = _j((0, 0), "END", ("w0",))
    j2 = _j((5000, 0), "END", ("w0",))
    [draft] = segment_walls((w,), (j1, j2))
    assert draft.plan_polyline == ((0, 0), (5000, 0))


def test_plan_polyline_length_matches_euclidean_extent_for_straight_chain() -> None:
    w = _w("w0", (0, 0), (3000, 0))
    j1 = _j((0, 0), "END", ("w0",))
    j2 = _j((3000, 0), "END", ("w0",))
    [draft] = segment_walls((w,), (j1, j2))
    # plan-extent = Euclidean distance start→end = 3000mm
    assert draft.length_mm == 3000.0


# ──────────────────────────────────────────────────────────────────────────────
# Determinism — same input ⇒ same output drafts in same order
# ──────────────────────────────────────────────────────────────────────────────


def test_segment_walls_is_deterministic() -> None:
    walls, junctions = _vamshi_synth()
    a = segment_walls(walls, junctions)
    b = segment_walls(walls, junctions)
    assert len(a) == len(b)
    for da, db in zip(a, b):
        assert da == db


# ──────────────────────────────────────────────────────────────────────────────
# WallSegmentDraft data-class basics
# ──────────────────────────────────────────────────────────────────────────────


def test_draft_is_frozen() -> None:
    import dataclasses
    import pytest

    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    with pytest.raises(dataclasses.FrozenInstanceError):
        drafts[0].id = "MUTATED"  # type: ignore[misc]


def test_draft_source_wall_ids_are_tuples() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    for d in drafts:
        assert isinstance(d.source_wall_ids, tuple)
        assert isinstance(d.plan_polyline, tuple)


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_internal_only_no_perimeter() -> None:
    """All walls internal (no closed perimeter) — IDs start at P_INT_1."""
    w0 = _w("w0", (0, 0), (1000, 0))
    j1 = _j((0, 0), "END", ("w0",))
    j2 = _j((1000, 0), "END", ("w0",))
    drafts = segment_walls((w0,), (j1, j2))
    assert drafts[0].id == "P_INT_1"   # no externals → starts at 1, not 5


def test_perimeter_only_no_internals() -> None:
    """Perimeter rectangle with no internals — produces only P_EXT_*."""
    w0 = _w("w0", (0, 0), (1000, 0))
    w1 = _w("w1", (1000, 0), (1000, 500))
    w2 = _w("w2", (1000, 500), (0, 500))
    w3 = _w("w3", (0, 500), (0, 0))
    js = (
        _j((0, 0), "CORNER", ("w0", "w3")),
        _j((1000, 0), "CORNER", ("w0", "w1")),
        _j((1000, 500), "CORNER", ("w1", "w2")),
        _j((0, 500), "CORNER", ("w2", "w3")),
    )
    drafts = segment_walls((w0, w1, w2, w3), js)
    assert all(d.id.startswith("P_EXT_") for d in drafts)
    assert len(drafts) == 4


def test_return_type_is_list_of_wall_segment_drafts() -> None:
    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    for d in drafts:
        assert isinstance(d, WallSegmentDraft)
