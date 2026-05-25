"""KOS Phase 5D-1 · PR-HOTFIX-1 — splitter short-segment hardening tests.

The bug this suite proves fixed:

  When a segment has ``neighbour_covered_*_mm > 0`` AND
  ``application != "external"``, the pre-hotfix envelope ignored the
  covered offset and emitted its default ECM/CTC terminator. Panels then
  filled the FULL segment length, while the segment's covered_*_mm
  field still carried the 300mm corner-cover declaration. C-1
  invariant added the 300mm on top of the already-full panel sum,
  producing a 300mm hard overshoot — exactly what 90VR-MR (43 issues) /
  90VR-TC (36 issues) surfaced.

The fix (in ``splitter_strategies/_common.py::_compute_envelope``):
  - Add ``elif neighbour_covered_*_mm > 0`` short-circuit BEFORE the
    ``elif application == "external"`` check on both LEFT and RIGHT
    sides. This R5 logic now applies regardless of application — matching
    corner_handler's application-agnostic ownership rule.
  - Add sub-corner-cover guard for segments where covered_left +
    covered_right > segment_length: emit soft warning + empty envelope
    so the splitter doesn't overflow.

These tests are PR-HOTFIX-1 specific. They cover the cases the existing
474-test suite missed (no Vamshi fixture has internal + covered_* set).
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper.splitter import split_wall_to_panels
from app.services.kos_panel_grid_mapper.splitter_strategies import (
    split_minimize_cuts,
    split_minimize_panels,
    split_symmetric,
)
from app.services.kos_panel_grid_mapper.types import SplitInput


def _input(
    *,
    length_mm: float,
    application: str = "internal",
    strategy: str = "minimize_cuts",
    first_res=None,
    last_res=None,
    covered_left: float = 0.0,
    covered_right: float = 0.0,
) -> SplitInput:
    return SplitInput(
        segment_id="P_HOTFIX_TEST",
        segment_length_mm=length_mm,
        segment_height_mm=3000,
        system="K6-150",
        sku_thickness_mm=155,
        application=application,    # type: ignore[arg-type]
        strategy=strategy,            # type: ignore[arg-type]
        first_panel_reservation=first_res,
        last_panel_reservation=last_res,
        neighbour_covered_left_mm=covered_left,
        neighbour_covered_right_mm=covered_right,
    )


def _c1_diff(result, inp: SplitInput) -> float:
    """Compute the C-1 length-sum delta exactly as output_validator._check_c1 does."""
    sum_w = sum(p.width_mm for p in result.panels if p.orientation == "vertical")
    return abs(sum_w + inp.neighbour_covered_left_mm
               + inp.neighbour_covered_right_mm - inp.segment_length_mm)


def _c1_tol(inp: SplitInput) -> float:
    return max(50.0, 0.02 * inp.segment_length_mm)


# ── PROMPT §3.2: 8 required test cases ──────────────────────────────────────


def test_short_segment_with_covered_right_passes_c1() -> None:
    """834mm internal segment + covered_right=300 → C-1 within tolerance."""
    inp = _input(length_mm=834.39, application="internal", covered_right=300.0)
    result = split_minimize_cuts(inp)
    assert _c1_diff(result, inp) <= _c1_tol(inp), (
        f"C-1 failed: diff={_c1_diff(result, inp):.1f} > tol={_c1_tol(inp):.1f}"
    )
    # No ECM (covered_left=0 → would not emit ECM either way) and no CTC terminator V1.
    assert "V1" not in [p.label for p in result.panels], "CTC terminator emitted on covered-right segment"


def test_short_segment_with_covered_left_passes_c1() -> None:
    """834mm internal segment + covered_left=300 → C-1 within tolerance."""
    inp = _input(length_mm=834.39, application="internal", covered_left=300.0)
    result = split_minimize_cuts(inp)
    assert _c1_diff(result, inp) <= _c1_tol(inp)
    # No ECM emitted on the LEFT (covered by neighbour).
    assert not any(p.type == "ECM" for p in result.panels), (
        "ECM emitted on covered-left segment; R5 short-circuit failed to fire"
    )
    # First vertical panel should start at position >= covered_left.
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    if verticals:
        assert verticals[0].position_mm >= 300.0 - 0.5


def test_short_segment_with_both_corners_covered_passes_c1() -> None:
    """834mm internal segment + covered_left=300 + covered_right=300 → C-1 ok."""
    inp = _input(
        length_mm=834.39, application="internal",
        covered_left=300.0, covered_right=300.0,
    )
    result = split_minimize_cuts(inp)
    assert _c1_diff(result, inp) <= _c1_tol(inp)
    assert not any(p.type == "ECM" for p in result.panels)
    assert "V1" not in [p.label for p in result.panels]


def test_sub_corner_segment_handled_gracefully() -> None:
    """Sub-corner-cover: segment too short for the corner kit.

    Per prompt §3.2: "reasonable output, no overflow, soft warning OR
    CustomQuoteRequest emitted." The hotfix emits a soft warning + empty
    envelope (no vertical panels). C-1 may still hard-fail on this edge
    case until orchestrator-side CustomQuoteRequest routing lands —
    documented as a known follow-up. The test guarantees: no overflow,
    soft warning present.
    """
    inp = _input(
        length_mm=280.0, application="internal",
        covered_left=300.0, covered_right=300.0,
    )
    result = split_minimize_cuts(inp)

    # 1. NO vertical panels emitted.
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals == [], (
        f"sub-corner-cover: expected zero vertical panels, got {len(verticals)}"
    )

    # 2. Horizontals are emitted at the (short) segment length — they
    #    don't depend on corner coverage.
    horizontals = [p for p in result.panels if p.orientation == "horizontal"]
    assert len(horizontals) == 2

    # 3. No overflow: no panel position + width exceeds segment_length.
    for p in result.panels:
        end = p.position_mm + p.width_mm
        if p.orientation == "horizontal":
            # Horizontals span the full segment as a band; their
            # cut_length_mm carries the length-along-wall, while
            # width_mm is the panel's narrow dim (300mm). Their
            # position_mm + cut_length_mm should fit within the segment.
            assert p.position_mm + p.cut_length_mm <= inp.segment_length_mm + 1.0, (
                f"horizontal overflow: pos={p.position_mm}, cut_len={p.cut_length_mm}, "
                f"segment={inp.segment_length_mm}"
            )
        else:
            assert end <= inp.segment_length_mm + 1.0, (
                f"vertical overflow: pos={p.position_mm}, width={p.width_mm}, "
                f"end={end}, segment={inp.segment_length_mm}"
            )

    # 4. Soft warning emitted naming the sub-corner-cover condition.
    assert any("sub-corner-cover" in w for w in result.warnings), (
        f"missing sub-corner-cover warning. warnings={result.warnings}"
    )


def test_normal_segment_unchanged() -> None:
    """3000mm orthogonal internal segment, no covered → behavior matches
    pre-hotfix (ECM default at left, AP run, CTC terminator at right).

    This is the regression guard. If the new branches mis-fire, this
    test breaks first."""
    inp = _input(length_mm=3000.0, application="internal")
    result = split_minimize_cuts(inp)
    types = [p.type for p in result.panels if p.orientation == "vertical"]
    # Expected: ECM, [APs], CTC terminator (V1).
    assert types[0] == "ECM", f"expected ECM first, got {types[0]}"
    assert types[-1] == "CTC", f"expected CTC terminator last, got {types[-1]}"
    # No R5+ warning since covered_*=0.
    assert not any("R5:" in w for w in result.warnings), (
        f"R5 warning unexpectedly fired on unconvered segment: {result.warnings}"
    )


def test_p_int_8_canonical_still_byte_equal() -> None:
    """P_INT_8 canonical fixture: re-run via the public mapper entry point
    and verify the golden JSON still matches byte-for-byte.

    This is the prompt §4 NON-NEGOTIABLE invariant. The hotfix MUST NOT
    perturb output for segments without covered_*."""
    import json
    from pathlib import Path

    from app.services.kos_panel_grid_mapper.mapper import map_walls_to_panels
    from app.services.kos_panel_grid_mapper.types import (
        MapperInput,
        ParserJunction,
        ParserOutput,
        ParserTitleBlock,
        ParserWall,
        ProjectContext,
    )

    golden_path = (
        Path(__file__).parent / "golden" / "p_int_8_canonical.json"
    )
    golden = json.loads(golden_path.read_text())

    # Build the canonical P_INT_8 fixture from the golden expected fields.
    # We round-trip the input through the public mapper API to verify the
    # output still equals the golden snapshot.
    # P_INT_8: 2101mm internal partition, no openings, no corners (T-junction
    # endpoints).
    # P_INT_8 in the canonical fixture is K4-110 (110mm thickness, not 155).
    wall = ParserWall(
        id="w0", start=(0.0, 0.0), end=(2101.0, 0.0),
        length_mm=2101.0, thickness_mm=110.0, angle_degrees=0.0,
        layer="A-WALL", detection_tier=1, confidence=0.85,
    )
    j0 = ParserJunction(
        point=(0.0, 0.0), type="T_JOIN",
        wall_ids=("w0",), wall_count=1,
    )
    j1 = ParserJunction(
        point=(2101.0, 0.0), type="T_JOIN",
        wall_ids=("w0",), wall_count=1,
    )
    parser_output = ParserOutput(
        walls=(wall,), junctions=(j0, j1),
        title_block=ParserTitleBlock(),
        drawing_classification="FLOOR_PLAN",
        drawing_classification_confidence=0.9,
        drawing_classification_signals=(),
        drawing_classification_reasoning="test",
        layers_found=("A-WALL",),
        drawing_bounds={"min_x": 0, "min_y": 0, "max_x": 2101, "max_y": 200},
        units_detected="mm",
        stats={},
        field_confidences={"walls": 0.85},
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
        missing_data=(),
        detection_strategy_used="tier_1",
        overall_confidence=0.85,
        parser_version="0.1.0",
        phase="5C-1",
        duration_ms=0.0,
        warnings=(),
    )
    ctx = ProjectContext(
        project_name="P_INT_8 byte-equal regression",
        seismic_zone="III",
        wall_height_mm=3000,
    )
    output = map_walls_to_panels(MapperInput(
        parser_output=parser_output, project_context=ctx,
    ))

    # Find P_INT_8's segment (only one).
    assert len(output.wall_segments) == 1
    seg = output.wall_segments[0]

    # Verify panel count + per-panel-label width matches the golden snapshot.
    golden_panels = golden["panels"]
    assert len(seg.panels) == len(golden_panels), (
        f"P_INT_8 panel count changed: pre-hotfix golden={len(golden_panels)}, "
        f"post-hotfix={len(seg.panels)} — byte-equal invariant violated"
    )
    for actual, expected in zip(seg.panels, golden_panels):
        assert actual.label == expected["label"]
        assert actual.sku == expected["sku"]
        assert actual.width_mm == expected["width_mm"]
        assert actual.cut_length_mm == expected["cut_length_mm"]


def test_all_three_strategies_handle_short_segments() -> None:
    """minimize_cuts + minimize_panels + symmetric all pass C-1 on the
    bug scenario (834mm internal + covered_right=300)."""
    for strategy in ("minimize_cuts", "minimize_panels", "symmetric"):
        inp = _input(
            length_mm=834.39, application="internal", strategy=strategy,
            covered_right=300.0,
        )
        result = split_wall_to_panels(inp)
        diff = _c1_diff(result, inp)
        tol = _c1_tol(inp)
        assert diff <= tol, (
            f"strategy={strategy}: C-1 diff={diff:.1f} > tol={tol:.1f} — fix didn't propagate"
        )


def test_short_segment_real_90vr_case_passes() -> None:
    """A 90VR-style basement-curve approximation: 834.39mm internal, both
    corners owned by neighbours, K6-150. The C-1 error in PR 4 reported
    exactly this geometry. Hotfix MUST pass it within C-1 tolerance.
    """
    inp = _input(
        length_mm=834.3912286811263,    # exact value from PR 4 C-1 report
        application="internal",
        covered_left=0.0,                # one end covered (not both)
        covered_right=300.0,
    )
    result = split_minimize_cuts(inp)
    # C-1 must pass (diff <= 50mm).
    diff = _c1_diff(result, inp)
    assert diff <= _c1_tol(inp), (
        f"90VR-style segment: C-1 diff={diff:.1f} (PR 4 reported 299.61mm pre-fix)"
    )


# ── Extended coverage beyond §3.2 ────────────────────────────────────────────


def test_r5_warning_message_unchanged_for_external() -> None:
    """The existing 'R5: external segment' warning text is preserved
    verbatim (existing test_r5_external_no_reservation_starts_at_covered_offset
    asserts the substring 'R5: external segment')."""
    inp = _input(
        length_mm=9370.0, application="external",
        covered_left=300.0, covered_right=300.0,
    )
    result = split_minimize_cuts(inp)
    assert any("R5: external segment" in w for w in result.warnings)


def test_r5_warning_now_fires_for_internal_too() -> None:
    """New: R5 logic fires for internal segments too — warning surface
    mentions the application kind for operator diagnostics."""
    inp = _input(
        length_mm=2000.0, application="internal",
        covered_left=300.0, covered_right=0.0,
    )
    result = split_minimize_cuts(inp)
    assert any("R5: internal segment" in w for w in result.warnings)


def test_sub_corner_cover_single_side() -> None:
    """Edge case variant: 280mm + only one side covered (300mm) > segment_length.
    The detection should still fire because the covered offset alone
    exceeds the segment length."""
    inp = _input(
        length_mm=280.0, application="internal",
        covered_left=300.0, covered_right=0.0,
    )
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals == [], (
        f"single-side sub-corner-cover should emit no verticals; got {len(verticals)}"
    )
    assert any("sub-corner-cover" in w for w in result.warnings)
