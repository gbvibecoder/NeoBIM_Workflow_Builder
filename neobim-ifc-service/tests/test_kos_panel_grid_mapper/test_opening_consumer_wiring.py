"""KOS Phase 5D-1 PR-HOTFIX-2 — opening-consumer wiring tests.

Verifies the new wiring that routes parser-emitted ``ParserOpening`` records
into the mapper's ``WallSegment.openings`` tuple via
``opening_handler.detect_openings``'s extended signature.

The wiring chain:
  - parser emits ParserOpening (parent_wall_id + wall-relative position_mm)
  - mapper.py orchestrator pre-buckets openings by parent_wall_id
  - per-segment: filter to openings whose parent ∈ segment.source_wall_ids
  - opening_handler projects each onto the segment polyline → Opening
  - WallSegment.openings populated

Test coverage mirrors prompt §4. Edge cases under prompt §3.

All tests run with the default ``PARSER_OPENINGS_AVAILABLE=True`` from
5C-3 PR 4. The flag-False branch is covered by the legacy opening_handler
heuristic tests (test_opening_handler.py with the `_force_legacy_heuristic`
fixture).
"""

from __future__ import annotations

import math
from typing import Optional

import pytest

from app.services.kos_drawing_geometry import ParserOpening
from app.services.kos_panel_grid_mapper.constants import PARSER_OPENINGS_AVAILABLE
from app.services.kos_panel_grid_mapper.mapper import map_walls_to_panels
from app.services.kos_panel_grid_mapper.opening_handler import (
    _project_parser_openings_to_segment,
    detect_openings,
)
from app.services.kos_panel_grid_mapper.types import (
    MapperInput,
    Opening,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
    WallSegmentDraft,
)

# ── helpers ──────────────────────────────────────────────────────────────────


def _wall(wid: str, x0: float, y0: float, x1: float, y1: float, thickness: float = 110.0) -> ParserWall:
    return ParserWall(
        id=wid, start=(x0, y0), end=(x1, y1),
        length_mm=math.hypot(x1 - x0, y1 - y0),
        thickness_mm=thickness, angle_degrees=0.0,
        layer="A-WALL", detection_tier=1, confidence=0.85,
    )


def _junction(point: tuple[float, float], jtype: str, wall_ids: tuple[str, ...]) -> ParserJunction:
    return ParserJunction(
        point=point, type=jtype, wall_ids=wall_ids, wall_count=len(wall_ids),
    )


def _po(
    *, id: str = "o0", parent: str = "w0", position: float = 1000.0,
    width: float = 900.0, height: float = 2100.0, sill: float = 0.0,
    opening_type: str = "door",
) -> ParserOpening:
    return ParserOpening(
        id=id, opening_type=opening_type,  # type: ignore[arg-type]
        parent_wall_id=parent, position_mm=position,
        width_mm=width, height_mm=height, sill_height_mm=sill,
        detection_tier=1, detection_method="test", confidence=0.95,
        source_entities=(),
    )


def _draft(seg_id: str, walls: tuple[ParserWall, ...]) -> WallSegmentDraft:
    """Build a WallSegmentDraft tracing a polyline from walls[0].start to walls[-1].end."""
    return WallSegmentDraft(
        id=seg_id,
        source_wall_ids=tuple(w.id for w in walls),
        plan_polyline=(walls[0].start, walls[-1].end),
        length_mm=math.hypot(
            walls[-1].end[0] - walls[0].start[0],
            walls[-1].end[1] - walls[0].start[1],
        ),
        is_closed_loop=False,
        endpoint_junction_types=("END", "END"),
    )


def _build_mapper_input(
    walls: tuple[ParserWall, ...],
    junctions: tuple[ParserJunction, ...] = (),
    openings: tuple[ParserOpening, ...] = (),
    classification: str = "FLOOR_PLAN",
) -> MapperInput:
    """Build a minimal MapperInput driving the full pipeline."""
    parser_output = ParserOutput(
        walls=walls, junctions=junctions,
        title_block=ParserTitleBlock(),
        drawing_classification=classification,
        drawing_classification_confidence=0.9,
        drawing_classification_signals=(),
        drawing_classification_reasoning="test",
        layers_found=("A-WALL",),
        drawing_bounds={"min_x": 0, "min_y": 0, "max_x": 10000, "max_y": 200},
        units_detected="mm", stats={}, field_confidences={"walls": 0.85},
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
        missing_data=(),
        detection_strategy_used="tier_1", overall_confidence=0.85,
        parser_version="0.1.0", phase="test", duration_ms=0.0,
        warnings=(),
        openings=openings,
    )
    ctx = ProjectContext(
        project_name="opening-consumer-wiring",
        seismic_zone="III",
        wall_height_mm=3000,
    )
    return MapperInput(parser_output=parser_output, project_context=ctx)


# ── §4 required tests ────────────────────────────────────────────────────────


def test_p_int_8_zero_openings_byte_equal_preserved() -> None:
    """P_INT_8 fixture with no parser openings → byte-equal to PR 1 golden."""
    import json
    from pathlib import Path

    golden_path = Path(__file__).parent / "golden" / "p_int_8_canonical.json"
    golden = json.loads(golden_path.read_text())

    wall = _wall("w0", 0.0, 0.0, 2101.0, 0.0, thickness=110.0)
    junctions = (
        _junction((0.0, 0.0), "T_JOIN", ("w0",)),
        _junction((2101.0, 0.0), "T_JOIN", ("w0",)),
    )
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), junctions=junctions, openings=())
    )

    assert len(output.wall_segments) == 1
    seg = output.wall_segments[0]
    golden_panels = golden["panels"]
    assert len(seg.panels) == len(golden_panels), (
        f"P_INT_8 panel count changed: golden={len(golden_panels)} "
        f"actual={len(seg.panels)} — byte-equal invariant violated"
    )
    for actual, expected in zip(seg.panels, golden_panels):
        assert actual.label == expected["label"]
        assert actual.sku == expected["sku"]
        assert actual.width_mm == expected["width_mm"]
        assert actual.cut_length_mm == expected["cut_length_mm"]
    # Opening contract: openings tuple is empty, openings_inferable is False.
    assert seg.openings == ()
    assert seg.openings_inferable is False


def test_single_opening_routes_to_correct_segment() -> None:
    """One parser opening on a single-wall segment → 1 Opening in output."""
    wall = _wall("w0", 0.0, 0.0, 5000.0, 0.0)
    opening = _po(parent="w0", position=1500.0, width=900.0)
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), openings=(opening,))
    )
    assert len(output.wall_segments) == 1
    seg = output.wall_segments[0]
    assert len(seg.openings) == 1
    o = seg.openings[0]
    assert isinstance(o, Opening)
    assert o.position_mm == pytest.approx(1500.0)
    assert o.width_mm == 900.0
    assert o.height_mm == 2100.0
    assert o.sill_height_mm == 0.0


def test_multiple_openings_routed_correctly() -> None:
    """3 parser openings each on different walls → 3 Openings on the segment."""
    # Build a single segment from 3 colinear walls (w0, w1, w2).
    w0 = _wall("w0", 0.0, 0.0, 2000.0, 0.0)
    w1 = _wall("w1", 2000.0, 0.0, 5000.0, 0.0)
    w2 = _wall("w2", 5000.0, 0.0, 8000.0, 0.0)
    j_corner = _junction((2000.0, 0.0), "T_JOIN", ("w0", "w1"))
    j_corner2 = _junction((5000.0, 0.0), "T_JOIN", ("w1", "w2"))
    openings = (
        _po(id="o0", parent="w0", position=500.0, width=900.0),
        _po(id="o1", parent="w1", position=1000.0, width=900.0),   # absolute 3000mm
        _po(id="o2", parent="w2", position=500.0, width=900.0),    # absolute 5500mm
    )
    output = map_walls_to_panels(
        _build_mapper_input(
            walls=(w0, w1, w2),
            junctions=(j_corner, j_corner2),
            openings=openings,
        )
    )
    # All 3 openings should route into segments. Some segmenter behaviour
    # may split into multiple segments; sum across all is the invariant.
    total_openings = sum(len(s.openings) for s in output.wall_segments)
    assert total_openings == 3, (
        f"expected 3 openings consumed, got {total_openings} across "
        f"{len(output.wall_segments)} segments"
    )


def test_opening_with_unknown_parent_wall_id_emits_warning() -> None:
    """Parser opening references a wall not in any segment → soft warning."""
    wall = _wall("w0", 0.0, 0.0, 5000.0, 0.0)
    orphan_opening = _po(parent="w999", position=1000.0, width=900.0)
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), openings=(orphan_opening,))
    )
    # No segments receive the orphan opening.
    assert all(s.openings == () for s in output.wall_segments)
    # But the warning surfaces on output.warnings.
    assert any(
        "w999" in w and "not in any segment" in w
        for w in output.warnings
    ), f"expected orphan warning for w999; got: {output.warnings}"


def test_parser_openings_available_false_skips_wiring() -> None:
    """When the flag is False, detect_openings falls back to the heuristic
    path and ignores parser_openings entirely."""
    from unittest.mock import patch

    wall = _wall("w0", 0.0, 0.0, 5000.0, 0.0)
    seg_draft = _draft("S0", (wall,))
    walls_by_id = {wall.id: wall}
    opening = _po(parent="w0", position=1000.0, width=900.0)
    with patch(
        "app.services.kos_panel_grid_mapper.opening_handler.PARSER_OPENINGS_AVAILABLE",
        False,
    ):
        res = detect_openings(
            segment=seg_draft,
            junctions_in_segment=(),
            parser_openings=(opening,),
            walls_by_id=walls_by_id,
        )
    # Heuristic path ignores parser_openings; returns empty + inferable=False (no interior ENDs).
    assert res.openings == ()
    assert res.openings_inferable is False


def test_openings_sorted_by_position_within_segment() -> None:
    """Multiple openings on a single segment → output sorted by position_mm."""
    wall = _wall("w0", 0.0, 0.0, 10000.0, 0.0)
    openings = (
        _po(id="o0", parent="w0", position=5000.0, width=900.0),
        _po(id="o1", parent="w0", position=2000.0, width=900.0),
        _po(id="o2", parent="w0", position=7500.0, width=900.0),
    )
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), openings=openings)
    )
    seg = output.wall_segments[0]
    positions = [o.position_mm for o in seg.openings]
    assert positions == sorted(positions), (
        f"openings not sorted by position_mm: {positions}"
    )
    assert positions == [pytest.approx(2000.0), pytest.approx(5000.0), pytest.approx(7500.0)]


def test_opening_position_mm_correctly_projected() -> None:
    """Verify projection math: parser opening at known absolute coords on a
    wall starting at non-zero offset → correct segment-relative position."""
    # Build segment from a single wall starting at (1000, 0) of length 5000.
    # Polyline = ((1000, 0), (6000, 0)), so segment-coord 0 is at world (1000, 0).
    wall = _wall("w0", 1000.0, 0.0, 6000.0, 0.0)
    seg_draft = _draft("S0", (wall,))
    walls_by_id = {wall.id: wall}
    # Parser opening at position 2000 along wall = world x = 3000.
    # Expected segment-coord = world(3000) - segment_start(1000) = 2000.
    opening = _po(parent="w0", position=2000.0, width=900.0)
    converted, warnings = _project_parser_openings_to_segment(
        (opening,), seg_draft, walls_by_id,
    )
    assert len(converted) == 1
    assert converted[0].position_mm == pytest.approx(2000.0)
    assert warnings == []


def test_opening_type_passes_through() -> None:
    """door, window, sliding_door — type info preserved in conversion.

    Mapper-side Opening doesn't carry opening_type explicitly (only
    sill_height_mm signals door-vs-window), so we verify sill_height
    preservation as the type proxy.
    """
    wall = _wall("w0", 0.0, 0.0, 10000.0, 0.0)
    openings = (
        _po(id="o0", parent="w0", position=1000.0, opening_type="door", sill=0.0),
        _po(id="o1", parent="w0", position=3000.0, opening_type="window", sill=900.0, height=1500.0),
        _po(id="o2", parent="w0", position=5500.0, opening_type="sliding_door", sill=0.0),
    )
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), openings=openings)
    )
    seg = output.wall_segments[0]
    assert len(seg.openings) == 3
    sills = [o.sill_height_mm for o in seg.openings]
    assert sills == [0.0, 900.0, 0.0]
    heights = [o.height_mm for o in seg.openings]
    assert heights == [2100.0, 1500.0, 2100.0]


def test_openings_inferable_set_to_false_when_consumed() -> None:
    """When parser openings supply data, openings_inferable=False.
    (The heuristic-only path can set it True; the consumed path never does.)"""
    wall = _wall("w0", 0.0, 0.0, 5000.0, 0.0)
    opening = _po(parent="w0", position=1500.0)
    output = map_walls_to_panels(
        _build_mapper_input(walls=(wall,), openings=(opening,))
    )
    seg = output.wall_segments[0]
    assert seg.openings_inferable is False
    assert len(seg.openings) == 1


def test_determinism_same_input_same_output() -> None:
    """Re-run pipeline twice → byte-identical output."""
    wall = _wall("w0", 0.0, 0.0, 8000.0, 0.0)
    openings = (
        _po(id="o0", parent="w0", position=1500.0, width=900.0),
        _po(id="o1", parent="w0", position=4000.0, width=1200.0),
    )
    inp = _build_mapper_input(walls=(wall,), openings=openings)
    out_a = map_walls_to_panels(inp)
    out_b = map_walls_to_panels(inp)
    # Compare segment-by-segment opening tuples.
    for sa, sb in zip(out_a.wall_segments, out_b.wall_segments):
        assert sa.openings == sb.openings, (
            f"determinism violated: segment {sa.id} openings differ across runs"
        )
        assert sa.panels == sb.panels


# ── PR-HOTFIX-2 contract checks (additional defensive coverage) ─────────────


def test_flag_is_true_in_constants() -> None:
    """Sanity: confirms 5C-3 PR 4 flag flip is still active. If this fails,
    the consumer-pipe wiring is gated and tests above may falsely pass."""
    assert PARSER_OPENINGS_AVAILABLE is True


def test_project_parser_openings_handles_reversed_wall_direction() -> None:
    """Wall traced in reverse (wall.end is "earlier" than wall.start in segment
    direction) — opening should still land at the correct segment position.

    Example: segment along +x from (0,0) to (5000,0); wall traced backward
    from (4500,0) to (500,0). Opening at wall position 1000 means it sits
    1000mm from wall.start along wall direction = 1000mm in the -x direction
    from world (4500,0) = world x=3500. In segment coords = 3500.
    """
    seg_draft = WallSegmentDraft(
        id="S0", source_wall_ids=("w0",),
        plan_polyline=((0.0, 0.0), (5000.0, 0.0)),
        length_mm=5000.0, is_closed_loop=False,
        endpoint_junction_types=("END", "END"),
    )
    # Wall traced in reverse along the segment direction.
    wall = ParserWall(
        id="w0", start=(4500.0, 0.0), end=(500.0, 0.0),
        length_mm=4000.0, thickness_mm=110.0, angle_degrees=180.0,
        layer="A-WALL", detection_tier=1, confidence=0.85,
    )
    opening = _po(parent="w0", position=1000.0, width=900.0)
    converted, warnings = _project_parser_openings_to_segment(
        (opening,), seg_draft, {wall.id: wall},
    )
    assert len(converted) == 1
    # Wall start at world 4500; opening at wall-position 1000 in wall
    # direction (-x); world x of opening start = 4500 - 1000 - 900 = 2600.
    assert converted[0].position_mm == pytest.approx(2600.0)
    assert warnings == []


def test_project_parser_openings_degenerate_polyline_returns_empty() -> None:
    """Defensive: polyline with < 2 points or zero length → empty + warning."""
    seg_draft = WallSegmentDraft(
        id="S_DEGEN", source_wall_ids=("w0",),
        plan_polyline=((100.0, 100.0),),    # only one point
        length_mm=0.0, is_closed_loop=False,
        endpoint_junction_types=("END", "END"),
    )
    wall = _wall("w0", 100.0, 100.0, 100.0, 100.0)
    opening = _po(parent="w0", position=0.0)
    converted, warnings = _project_parser_openings_to_segment(
        (opening,), seg_draft, {wall.id: wall},
    )
    assert converted == ()
    assert any("< 2 points" in w for w in warnings)


def test_project_handles_missing_walls_by_id_gracefully() -> None:
    """Opening references a wall id not in walls_by_id → warning, opening skipped."""
    seg_draft = WallSegmentDraft(
        id="S0", source_wall_ids=("w0",),
        plan_polyline=((0.0, 0.0), (5000.0, 0.0)),
        length_mm=5000.0, is_closed_loop=False,
        endpoint_junction_types=("END", "END"),
    )
    # walls_by_id is empty — no walls.
    opening = _po(parent="w_missing", position=1000.0)
    converted, warnings = _project_parser_openings_to_segment(
        (opening,), seg_draft, {},
    )
    assert converted == ()
    assert any("w_missing" in w for w in warnings)


def test_detect_openings_empty_parser_openings_emits_no_warning() -> None:
    """When flag=True and parser_openings=(), detect_openings should return
    empty WITHOUT emitting the legacy 'PARSER_OPENINGS_AVAILABLE=True but no
    data' noise warning (PR-HOTFIX-2 removed that).
    """
    seg_draft = _draft("S0", (_wall("w0", 0.0, 0.0, 5000.0, 0.0),))
    res = detect_openings(
        segment=seg_draft,
        junctions_in_segment=(),
        parser_openings=(),
        walls_by_id={"w0": _wall("w0", 0.0, 0.0, 5000.0, 0.0)},
    )
    assert res.openings == ()
    assert res.openings_inferable is False
    assert res.warnings == ()
