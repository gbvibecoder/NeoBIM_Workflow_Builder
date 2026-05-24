"""Tests for orientation_inferrer.infer_application — DESIGN.md §6.4 ladder.

Coverage:
  - Priority 1: user hint wins (each of the 10 hint values maps correctly)
  - Priority 2: title-block BASEMENT / FOUNDATION / RETAINING
  - Priority 3: is_closed_loop → external
  - Priority 4: T_JOIN/T_JOIN → internal (0.90)
  - Priority 5: T_JOIN/END → internal (0.85)
  - Priority 6: END/END → internal (0.50, warning)
  - Priority 7: fallback (unusual / missing endpoints) → internal (0.30)
  - Vamshi acid test: P_INT_8 → internal, P_EXT_3 → external
  - Source / confidence / warning fields populated correctly
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    OrientationResult,
    infer_application,
)


# ──────────────────────────────────────────────────────────────────────────────
# Priority 1: user hint wins everything
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "hint, expected_simple",
    [
        ("internal_partition",     "internal"),
        ("villa_external",         "external"),
        ("apartment_external_g3",  "external"),
        ("apartment_external_g5",  "external"),
        ("school_commercial_g3",   "external"),
        ("lift_shaft_g5",          "external"),
        ("shear_wall_g10",         "external"),
        ("basement_lt3m",          "basement"),
        ("basement_gt3m",          "basement"),
        ("retaining",              "retaining"),
    ],
)
def test_user_hint_maps_to_simple_application(
    hint: str, expected_simple: str
) -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
        application_hint=hint,
    )
    assert res.application == expected_simple
    assert res.source == "user_hint"
    assert res.confidence == 1.0
    assert res.warnings == ()


def test_user_hint_overrides_closed_loop() -> None:
    """User hint = internal_partition wins over closed-loop = external."""
    res = infer_application(
        is_closed_loop=True, endpoint_junction_types=(),
        application_hint="internal_partition",
    )
    assert res.application == "internal"
    assert res.source == "user_hint"


def test_user_hint_overrides_title_block_basement() -> None:
    """User hint = villa_external wins over title-block BASEMENT."""
    res = infer_application(
        is_closed_loop=True, endpoint_junction_types=(),
        title_block_level="BASEMENT", application_hint="villa_external",
    )
    assert res.application == "external"


# ──────────────────────────────────────────────────────────────────────────────
# Priority 2: title-block level scan
# ──────────────────────────────────────────────────────────────────────────────


def test_title_block_basement_returns_basement() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
        title_block_level="BASEMENT",
    )
    assert res.application == "basement"
    assert res.confidence == 0.85
    assert res.source == "geometry_heuristic"
    assert len(res.warnings) == 1
    assert "basement" in res.warnings[0].lower()


def test_title_block_basement_case_insensitive() -> None:
    """'basement' (lowercase) should match too."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
        title_block_level="basement",
    )
    assert res.application == "basement"


def test_title_block_foundation_returns_basement() -> None:
    """'FOUNDATION' is treated as basement (same concrete spec)."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
        title_block_level="FOUNDATION LEVEL",
    )
    assert res.application == "basement"


def test_title_block_retaining_returns_retaining() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
        title_block_level="RETAINING WALL",
    )
    assert res.application == "retaining"
    assert res.confidence == 0.85


def test_title_block_overrides_closed_loop() -> None:
    """A perimeter wall on a basement drawing is BASEMENT, not external."""
    res = infer_application(
        is_closed_loop=True, endpoint_junction_types=(),
        title_block_level="BASEMENT",
    )
    assert res.application == "basement"   # title-block beats closed-loop


def test_title_block_ground_floor_does_not_match() -> None:
    """Only BASEMENT/FOUNDATION/RETAINING trigger title-block override."""
    res = infer_application(
        is_closed_loop=True, endpoint_junction_types=(),
        title_block_level="GROUND FLOOR",
    )
    # Fall through to priority 3 → external
    assert res.application == "external"


def test_title_block_none_does_not_match() -> None:
    res = infer_application(
        is_closed_loop=True, endpoint_junction_types=(),
        title_block_level=None,
    )
    assert res.application == "external"


# ──────────────────────────────────────────────────────────────────────────────
# Priority 3: closed_loop → external
# ──────────────────────────────────────────────────────────────────────────────


def test_closed_loop_returns_external() -> None:
    res = infer_application(is_closed_loop=True, endpoint_junction_types=())
    assert res.application == "external"
    assert res.confidence == 0.95
    assert res.source == "geometry_heuristic"
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Priority 4: T_JOIN / T_JOIN → internal 0.90
# ──────────────────────────────────────────────────────────────────────────────


def test_both_endpoints_tjoin_returns_internal_090() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("T_JOIN", "T_JOIN"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.90
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Priority 5: T_JOIN / END (or END / T_JOIN) → internal 0.85
# ──────────────────────────────────────────────────────────────────────────────


def test_tjoin_end_returns_internal_085() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("T_JOIN", "END"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.85
    assert "one-end-free" in res.warnings[0]


def test_end_tjoin_also_returns_internal_085() -> None:
    """Order doesn't matter — set-based comparison."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "T_JOIN"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.85


# ──────────────────────────────────────────────────────────────────────────────
# Priority 6: END / END → internal 0.50 + warning
# ──────────────────────────────────────────────────────────────────────────────


def test_both_ends_isolated_returns_internal_050() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("END", "END"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.50
    assert "isolated wall" in res.warnings[0]


# ──────────────────────────────────────────────────────────────────────────────
# Priority 7: fallback (unusual patterns)
# ──────────────────────────────────────────────────────────────────────────────


def test_unusual_endpoint_pattern_returns_internal_030() -> None:
    """CORNER on an open-chain endpoint is unusual — fallback."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("CORNER", "END"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.30
    assert "unusual endpoint pattern" in res.warnings[0]


def test_x_join_endpoints_falls_through_to_unusual() -> None:
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("X_JOIN", "X_JOIN"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.30


def test_missing_endpoint_info_returns_internal_030() -> None:
    """Empty endpoint_junction_types on a non-closed-loop segment."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=(),
    )
    assert res.application == "internal"
    assert res.confidence == 0.30
    assert "endpoint junctions missing" in res.warnings[0]


# ──────────────────────────────────────────────────────────────────────────────
# Return type sanity
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_orientation_result() -> None:
    res = infer_application(is_closed_loop=True, endpoint_junction_types=())
    assert isinstance(res, OrientationResult)


def test_warnings_is_always_tuple() -> None:
    for res in [
        infer_application(is_closed_loop=True, endpoint_junction_types=()),
        infer_application(is_closed_loop=False, endpoint_junction_types=("END", "END")),
        infer_application(is_closed_loop=False, endpoint_junction_types=("T_JOIN", "T_JOIN")),
    ]:
        assert isinstance(res.warnings, tuple)


def test_source_field_is_user_hint_or_geometry_heuristic() -> None:
    """Source must be one of the two documented values."""
    sources = set()
    for res in [
        infer_application(is_closed_loop=True, endpoint_junction_types=()),
        infer_application(
            is_closed_loop=False, endpoint_junction_types=(),
            application_hint="villa_external",
        ),
    ]:
        sources.add(res.source)
    assert sources == {"geometry_heuristic", "user_hint"}


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID TEST — Vamshi P_INT_8 / P_EXT_3 (prompt's load-bearing requirement)
# ──────────────────────────────────────────────────────────────────────────────


def test_acid_p_int_8_classifies_as_internal() -> None:
    """P_INT_8 is an open-chain internal partition (T_JOIN at base, END at top)
    — should classify as 'internal' with priority-5 confidence 0.85."""
    res = infer_application(
        is_closed_loop=False, endpoint_junction_types=("T_JOIN", "END"),
    )
    assert res.application == "internal"
    assert res.confidence == 0.85


def test_acid_p_ext_3_classifies_as_external() -> None:
    """P_EXT_3 is part of the closed perimeter (is_closed_loop=True) — should
    classify as 'external' with priority-3 confidence 0.95."""
    res = infer_application(is_closed_loop=True, endpoint_junction_types=())
    assert res.application == "external"
    assert res.confidence == 0.95


def test_acid_segmenter_results_classified_correctly() -> None:
    """End-to-end: run wall_segmenter on synthesized Vamshi input, then
    classify each segment with infer_application — verify P_INT_8 is internal
    and P_EXT_3 is external."""
    # Import wall_segmenter fixture builder (we re-use the synth from PR 4's
    # wall_segmenter tests via local helpers; keep it self-contained).
    from app.services.kos_panel_grid_mapper import segment_walls
    from tests.test_kos_panel_grid_mapper.test_wall_segmenter import _vamshi_synth

    walls, junctions = _vamshi_synth()
    drafts = segment_walls(walls, junctions)
    by_id = {d.id: d for d in drafts}

    res_p_int_8 = infer_application(
        is_closed_loop=by_id["P_INT_8"].is_closed_loop,
        endpoint_junction_types=by_id["P_INT_8"].endpoint_junction_types,
    )
    assert res_p_int_8.application == "internal"

    res_p_ext_3 = infer_application(
        is_closed_loop=by_id["P_EXT_3"].is_closed_loop,
        endpoint_junction_types=by_id["P_EXT_3"].endpoint_junction_types,
    )
    assert res_p_ext_3.application == "external"


# ──────────────────────────────────────────────────────────────────────────────
# Determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_infer_application_is_deterministic() -> None:
    """Same inputs → identical OrientationResult (dataclass equality)."""
    args = dict(is_closed_loop=False, endpoint_junction_types=("T_JOIN", "T_JOIN"))
    a = infer_application(**args)
    b = infer_application(**args)
    assert a == b
