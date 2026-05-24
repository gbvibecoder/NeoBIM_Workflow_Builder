"""Tests for multi_row_handler.plan_lifts — DESIGN.md §6.10.

Coverage:
  - The acid pair: P_INT_8 (K4-110, internal, 3000mm) → 1 lift, no bond offset
                   P_EXT_3 (K6-150, external, 3000mm) → 1 lift, no bond offset
  - Multi-lift basement: K8-250 + basement + 5400mm → 3 lifts + 150mm bond
  - Multi-lift K8-200 basement: 7000mm → 4 lifts
  - Fallback when (system, application) absent from MAX_LIFT_HEIGHT_MM table
  - Height > 6000mm warning
  - Edge cases: height=0, height=1
  - Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    DEFAULT_RUNNING_BOND_OFFSET_MM,
    MAX_LIFT_HEIGHT_MM,
    MultiLiftResult,
    plan_lifts,
)


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID PAIR — Vamshi single-lift cases
# ──────────────────────────────────────────────────────────────────────────────


def test_acid_p_int_8_k4_110_internal_3000mm_one_lift() -> None:
    """P_INT_8: K4-110 internal, height 3000mm. Max lift = 3600 → 1 lift."""
    res = plan_lifts(height_mm=3000, system="K4-110", application="internal")
    assert res.lifts_required == 1
    assert res.max_lift_height_mm == 3600
    assert res.running_bond_offset_mm == 0
    assert res.warnings == ()


def test_acid_p_ext_3_k6_150_external_3000mm_one_lift() -> None:
    """P_EXT_3: K6-150 external, height 3000mm. Max lift = 3000 → 1 lift (exact)."""
    res = plan_lifts(height_mm=3000, system="K6-150", application="external")
    assert res.lifts_required == 1
    assert res.max_lift_height_mm == 3000
    assert res.running_bond_offset_mm == 0
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Single-lift baseline (all explicit (sys, app) combos in the table)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "system, application, height, expected_lifts, expected_max",
    [
        ("K4-110", "internal", 2400, 1, 3600),
        ("K4-110", "internal", 3600, 1, 3600),    # exact fit
        ("K4-110", "external", 3000, 1, 3600),
        ("K6-150", "external", 3000, 1, 3000),    # exact fit
        ("K6-150", "internal", 2800, 1, 3000),
        ("K6-180", "external", 3500, 1, 3600),
        ("K8-200", "external", 2800, 1, 3000),
        ("K8-200", "basement", 1800, 1, 1800),    # exact fit
        ("K8-250", "basement", 1800, 1, 1800),
        ("K8-250", "retaining", 2400, 1, 2400),   # exact fit
    ],
)
def test_single_lift_explicit_combos(
    system: str, application: str, height: int,
    expected_lifts: int, expected_max: int,
) -> None:
    res = plan_lifts(
        height_mm=height, system=system,  # type: ignore[arg-type]
        application=application,  # type: ignore[arg-type]
    )
    assert res.lifts_required == expected_lifts
    assert res.max_lift_height_mm == expected_max
    assert res.running_bond_offset_mm == 0   # single-lift → no bond offset


# ──────────────────────────────────────────────────────────────────────────────
# Multi-lift scenarios
# ──────────────────────────────────────────────────────────────────────────────


def test_basement_5400mm_with_k8_250_yields_3_lifts() -> None:
    """K8-250 basement: max lift = 1800. 5400/1800 = 3 lifts exactly."""
    res = plan_lifts(height_mm=5400, system="K8-250", application="basement")
    assert res.lifts_required == 3
    assert res.max_lift_height_mm == 1800
    assert res.running_bond_offset_mm == DEFAULT_RUNNING_BOND_OFFSET_MM == 150


def test_basement_7000mm_with_k8_200_yields_4_lifts() -> None:
    """ceil(7000/1800) = ceil(3.888) = 4."""
    res = plan_lifts(height_mm=7000, system="K8-200", application="basement")
    assert res.lifts_required == 4
    assert res.running_bond_offset_mm == 150
    # 7000 > 6000 → warning
    assert any("> 6000mm" in w for w in res.warnings)


def test_3500mm_k6_150_external_yields_2_lifts() -> None:
    """3500/3000 = 1.16, ceil = 2."""
    res = plan_lifts(height_mm=3500, system="K6-150", application="external")
    assert res.lifts_required == 2
    assert res.running_bond_offset_mm == 150


def test_just_over_max_lift_triggers_two_lifts() -> None:
    """3601mm with max=3600 → 2 lifts (just one millimetre over)."""
    res = plan_lifts(height_mm=3601, system="K4-110", application="internal")
    assert res.lifts_required == 2
    assert res.running_bond_offset_mm == 150


# ──────────────────────────────────────────────────────────────────────────────
# Fallback for absent (system, application) combos
# ──────────────────────────────────────────────────────────────────────────────


def test_fallback_used_when_combo_absent_from_table() -> None:
    """(K4-110, basement) isn't in MAX_LIFT_HEIGHT_MM — fall back to per-system
    default (3600 for K4) + warning."""
    assert ("K4-110", "basement") not in MAX_LIFT_HEIGHT_MM   # sanity precondition
    res = plan_lifts(height_mm=3000, system="K4-110", application="basement")
    assert res.lifts_required == 1
    assert res.max_lift_height_mm == 3600   # K4 fallback
    assert any("not in MAX_LIFT_HEIGHT_MM table" in w for w in res.warnings)


def test_fallback_for_k8_200_internal() -> None:
    """(K8-200, internal) isn't tabulated; per-system K8-200 fallback is 2400."""
    assert ("K8-200", "internal") not in MAX_LIFT_HEIGHT_MM
    res = plan_lifts(height_mm=3000, system="K8-200", application="internal")
    assert res.lifts_required == 2     # ceil(3000/2400) = 2
    assert res.max_lift_height_mm == 2400
    assert any("not in MAX_LIFT_HEIGHT_MM table" in w for w in res.warnings)


def test_custom_system_uses_3000mm_fallback() -> None:
    """CUSTOM walls fall back to 3000mm per-system default."""
    res = plan_lifts(height_mm=3000, system="CUSTOM", application="external")
    assert res.max_lift_height_mm == 3000
    assert res.lifts_required == 1


# ──────────────────────────────────────────────────────────────────────────────
# Above-Card-1 warning
# ──────────────────────────────────────────────────────────────────────────────


def test_height_above_6000mm_emits_warning() -> None:
    """6001mm just above Card 1 limit → warning emitted."""
    res = plan_lifts(height_mm=6001, system="K8-250", application="basement")
    assert any("> 6000mm" in w and "Structural Engineer" in w for w in res.warnings)


def test_height_at_6000mm_no_above_card_1_warning() -> None:
    """Exactly 6000mm is the inclusive upper bound — no warning."""
    res = plan_lifts(height_mm=6000, system="K8-250", application="basement")
    assert not any("> 6000mm" in w for w in res.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_zero_height_yields_one_lift_with_warning() -> None:
    res = plan_lifts(height_mm=0, system="K4-110", application="internal")
    assert res.lifts_required == 1   # safe default
    assert any("height_mm=0" in w for w in res.warnings)


def test_negative_height_yields_one_lift_with_warning() -> None:
    res = plan_lifts(height_mm=-100, system="K4-110", application="internal")
    assert res.lifts_required == 1
    assert any("≤ 0" in w for w in res.warnings)


def test_one_millimetre_wall_one_lift() -> None:
    """Tiny but positive heights still produce 1 lift cleanly."""
    res = plan_lifts(height_mm=1, system="K4-110", application="internal")
    assert res.lifts_required == 1
    assert res.running_bond_offset_mm == 0


# ──────────────────────────────────────────────────────────────────────────────
# Return type sanity + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_multi_lift_result() -> None:
    res = plan_lifts(height_mm=3000, system="K4-110", application="internal")
    assert isinstance(res, MultiLiftResult)


def test_warnings_is_always_tuple() -> None:
    for height in (1000, 3000, 5400, 7000):
        res = plan_lifts(height_mm=height, system="K8-200", application="basement")
        assert isinstance(res.warnings, tuple)


def test_determinism_repeated_calls_produce_identical_results() -> None:
    a = plan_lifts(height_mm=5400, system="K8-250", application="basement")
    b = plan_lifts(height_mm=5400, system="K8-250", application="basement")
    assert a == b
