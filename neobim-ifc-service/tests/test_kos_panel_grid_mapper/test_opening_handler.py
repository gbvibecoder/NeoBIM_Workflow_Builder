"""Tests for opening_handler.detect_openings — DESIGN.md §6.8.

Coverage:
  - PARSER_OPENINGS_AVAILABLE = False (today): always returns empty openings
  - No interior END junctions → openings_inferable=False
  - 1 interior END → inferable=False (need ≥ 2)
  - 2+ interior ENDs → inferable=True + warning
  - END junctions AT the segment endpoints don't count as interior
  - layout_opening_frame scaffold for future activation (door + window)
  - Determinism
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.services.kos_panel_grid_mapper import (
    Opening,
    OpeningHandlerResult,
    ParserJunction,
    WallSegmentDraft,
    detect_openings,
)
from app.services.kos_panel_grid_mapper.opening_handler import layout_opening_frame


# 5C-3 PR 4 (2026-05-25) flipped PARSER_OPENINGS_AVAILABLE to True so the
# mapper's opening_handler consumes parser-provided ParserOpening data. The
# tests in the "Interior END junction counting" + "Closed-loop" sections
# below validate the LEGACY heuristic path (PARSER_OPENINGS_AVAILABLE = False)
# that still ships as a safety fallback. We use a context manager fixture to
# temporarily restore the False branch for those tests; the heuristic code
# itself is unchanged and remains exercised under this monkey-patch.
@pytest.fixture
def _force_legacy_heuristic():
    with patch(
        "app.services.kos_panel_grid_mapper.opening_handler.PARSER_OPENINGS_AVAILABLE",
        False,
    ):
        yield


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _draft(
    seg_id: str,
    polyline: tuple[tuple[float, float], ...],
    is_closed_loop: bool = False,
    endpoint_junction_types: tuple[str, ...] = ("END", "END"),
) -> WallSegmentDraft:
    """Build a minimal WallSegmentDraft for testing."""
    length = max(p[0] for p in polyline) - min(p[0] for p in polyline)
    if length == 0:
        length = max(p[1] for p in polyline) - min(p[1] for p in polyline)
    return WallSegmentDraft(
        id=seg_id,
        source_wall_ids=(f"{seg_id}_w0",),
        plan_polyline=polyline,
        length_mm=length,
        is_closed_loop=is_closed_loop,
        endpoint_junction_types=endpoint_junction_types,
    )


def _j(point: tuple[float, float], jtype: str = "END") -> ParserJunction:
    return ParserJunction(
        point=point, type=jtype, wall_ids=("w0",), wall_count=1,
    )


# ──────────────────────────────────────────────────────────────────────────────
# PARSER_OPENINGS_AVAILABLE = False — today's baseline
# ──────────────────────────────────────────────────────────────────────────────


def test_today_always_returns_empty_openings_list() -> None:
    """Today the parser doesn't emit Opening objects (PARSER_OPENINGS_AVAILABLE = False),
    so the handler always returns openings=() regardless of input."""
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    result = detect_openings(segment=seg, junctions_in_segment=())
    assert result.openings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Interior END junction counting
# ──────────────────────────────────────────────────────────────────────────────


def test_no_interior_ends_not_inferable(_force_legacy_heuristic) -> None:
    """Solid wall with no interior ENDs → openings_inferable=False."""
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    end_at_start = _j((0, 0), "END")
    end_at_end = _j((2101, 0), "END")
    result = detect_openings(
        segment=seg,
        junctions_in_segment=(end_at_start, end_at_end),
    )
    assert result.openings_inferable is False
    assert result.interior_end_count == 0
    assert result.warnings == ()


def test_one_interior_end_not_inferable(_force_legacy_heuristic) -> None:
    """1 interior END is ambiguous (could be a dead-end internal partition tip
    or one side of a small opening — need a pair to confirm)."""
    seg = _draft("P_EXT_1", polyline=((0, 0), (9370, 0)))
    end_start = _j((0, 0), "END")
    end_mid = _j((4000, 0), "END")       # interior
    end_end = _j((9370, 0), "END")
    result = detect_openings(
        segment=seg,
        junctions_in_segment=(end_start, end_mid, end_end),
    )
    assert result.openings_inferable is False
    assert result.interior_end_count == 1


def test_two_interior_ends_inferable_with_warning(_force_legacy_heuristic) -> None:
    """2 interior ENDs = one opening (left jamb + right jamb) → inferable=True."""
    seg = _draft("P_EXT_1", polyline=((0, 0), (9370, 0)))
    end_start = _j((0, 0), "END")
    end_left_jamb = _j((4000, 0), "END")     # interior
    end_right_jamb = _j((5000, 0), "END")    # interior
    end_end = _j((9370, 0), "END")
    result = detect_openings(
        segment=seg,
        junctions_in_segment=(end_start, end_left_jamb, end_right_jamb, end_end),
    )
    assert result.openings_inferable is True
    assert result.interior_end_count == 2
    assert len(result.warnings) == 1
    assert "interior END junction" in result.warnings[0]
    assert "P_EXT_1" in result.warnings[0]


def test_four_interior_ends_two_openings_inferable(_force_legacy_heuristic) -> None:
    """4 interior ENDs = 2 openings."""
    seg = _draft("P_EXT_3", polyline=((0, 0), (9370, 0)))
    junctions = (
        _j((0, 0)), _j((9370, 0)),     # endpoints (don't count)
        _j((2271, 0)), _j((3171, 0)),  # opening 1 jambs
        _j((6954, 0)), _j((7854, 0)),  # opening 2 jambs
    )
    result = detect_openings(segment=seg, junctions_in_segment=junctions)
    assert result.openings_inferable is True
    assert result.interior_end_count == 4


def test_non_end_junctions_dont_count() -> None:
    """Only END junctions count toward the interior-END heuristic;
    T_JOIN / CORNER / X_JOIN don't (they're structural, not openings)."""
    seg = _draft("P_INT_5", polyline=((0, 0), (6537, 0)))
    junctions = (
        ParserJunction(point=(0, 0), type="T_JOIN",
                       wall_ids=("a", "b", "c"), wall_count=3),
        ParserJunction(point=(3000, 0), type="T_JOIN",   # T_JOIN in middle — not an opening
                       wall_ids=("a", "b", "c"), wall_count=3),
        ParserJunction(point=(6537, 0), type="END",
                       wall_ids=("a",), wall_count=1),
    )
    result = detect_openings(segment=seg, junctions_in_segment=junctions)
    assert result.interior_end_count == 0   # the middle T_JOIN doesn't count
    assert result.openings_inferable is False


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint quantization (junctions within JUNCTION_TOLERANCE_MM of polyline ends)
# ──────────────────────────────────────────────────────────────────────────────


def test_end_at_polyline_endpoint_not_counted_as_interior() -> None:
    """The natural endpoints of the segment shouldn't count as interior ENDs."""
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    # END junctions exactly at the polyline endpoints
    result = detect_openings(
        segment=seg,
        junctions_in_segment=(_j((0, 0)), _j((2101, 0))),
    )
    assert result.interior_end_count == 0


def test_end_near_polyline_endpoint_within_tolerance_not_counted() -> None:
    """JUNCTION_TOLERANCE_MM (20mm) wraps endpoint detection."""
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    # Slightly offset (within 20mm tolerance)
    result = detect_openings(
        segment=seg,
        junctions_in_segment=(_j((10, 0)), _j((2095, 0))),
    )
    assert result.interior_end_count == 0


# ──────────────────────────────────────────────────────────────────────────────
# Closed-loop segments — all ENDs are "interior" (no natural endpoints)
# ──────────────────────────────────────────────────────────────────────────────


def test_closed_loop_segment_all_ends_are_interior(_force_legacy_heuristic) -> None:
    """For closed-loop segments (perimeter), the polyline endpoints are part
    of the loop, not natural "ends". Treat all ENDs in the segment as interior."""
    # Vamshi P_EXT_3 with 2 openings — even though it's "closed_loop",
    # the END junctions in the middle are opening edges.
    seg = WallSegmentDraft(
        id="P_EXT_3",
        source_wall_ids=("w20", "w21", "w22"),
        plan_polyline=((0, 0), (9370, 0)),
        length_mm=9370.0,
        is_closed_loop=True,
        endpoint_junction_types=(),
    )
    interior_ends = (_j((2271, 0)), _j((3171, 0)), _j((6954, 0)), _j((7854, 0)))
    result = detect_openings(segment=seg, junctions_in_segment=interior_ends)
    # The polyline endpoints (0,0) and (9370,0) are also CORNER junctions in
    # real Vamshi but we only pass ENDs here. Interior count = 4.
    assert result.interior_end_count == 4
    assert result.openings_inferable is True


# ──────────────────────────────────────────────────────────────────────────────
# Future scaffold — layout_opening_frame (door + window)
# ──────────────────────────────────────────────────────────────────────────────


def test_layout_opening_frame_door_produces_3_components() -> None:
    """Door (sill_height=0) → 2 jambs + 1 header = 3 components."""
    door = Opening(
        position_mm=2271.0, width_mm=900.0,
        height_mm=2100.0, sill_height_mm=0.0,
    )
    frame = layout_opening_frame(
        opening=door, thickness_mm=155,
        base_v_label_index=1, base_hb_label_index=3,
    )
    assert len(frame) == 3   # 2 jambs + 1 header (no sill)
    # All components are CTC type
    assert all(c["type"] == "CTC" for c in frame)
    # All thickness 155
    assert all(c["thickness_mm"] == 155 for c in frame)
    # 2 vertical jambs + 1 horizontal header
    verticals = [c for c in frame if c["orientation"] == "vertical"]
    horizontals = [c for c in frame if c["orientation"] == "horizontal"]
    assert len(verticals) == 2
    assert len(horizontals) == 1


def test_layout_opening_frame_window_produces_4_components() -> None:
    """Window (sill_height > 0) → 2 jambs + 1 header + 1 sill = 4 components."""
    window = Opening(
        position_mm=4500.0, width_mm=1200.0,
        height_mm=1500.0, sill_height_mm=900.0,
    )
    frame = layout_opening_frame(
        opening=window, thickness_mm=110,
        base_v_label_index=3, base_hb_label_index=5,
    )
    assert len(frame) == 4   # 2 jambs + header + sill
    horizontals = [c for c in frame if c["orientation"] == "horizontal"]
    assert len(horizontals) == 2   # header + sill


def test_layout_opening_frame_label_indices_sequential() -> None:
    """V labels and HB labels use the base indices supplied by the caller."""
    door = Opening(position_mm=0.0, width_mm=900.0, height_mm=2100.0, sill_height_mm=0.0)
    frame = layout_opening_frame(
        opening=door, thickness_mm=155,
        base_v_label_index=1, base_hb_label_index=4,
    )
    v_indices = [c["label_index"] for c in frame if c["label_kind"] == "V"]
    hb_indices = [c["label_index"] for c in frame if c["label_kind"] == "HB"]
    assert sorted(v_indices) == [1, 2]
    assert sorted(hb_indices) == [4]


# ──────────────────────────────────────────────────────────────────────────────
# Return type + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_opening_handler_result() -> None:
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    result = detect_openings(segment=seg, junctions_in_segment=())
    assert isinstance(result, OpeningHandlerResult)


def test_warnings_is_always_tuple() -> None:
    seg = _draft("P_INT_8", polyline=((0, 0), (2101, 0)))
    for junctions in [
        (),
        (_j((0, 0)),),
        (_j((1000, 0)), _j((1500, 0)), _j((2000, 0))),
    ]:
        result = detect_openings(segment=seg, junctions_in_segment=junctions)
        assert isinstance(result.warnings, tuple)


def test_determinism_repeated_calls() -> None:
    seg = _draft("P_EXT_3", polyline=((0, 0), (9370, 0)))
    junctions = (_j((2271, 0)), _j((3171, 0)), _j((6954, 0)), _j((7854, 0)))
    a = detect_openings(segment=seg, junctions_in_segment=junctions)
    b = detect_openings(segment=seg, junctions_in_segment=junctions)
    assert a == b
