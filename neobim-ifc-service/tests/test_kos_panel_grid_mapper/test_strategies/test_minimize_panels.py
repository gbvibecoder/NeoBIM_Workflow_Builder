"""Tests for Strategy A (minimize_panels) — custom-width AP run.

Coverage:
  - P_INT_8: 5 AP panels at custom widths (300, 300, 300, 300, 301) — same
             count as Strategy B but with 1mm extra on leftmost panel
  - n_ap = max(1, round(fillable / 300))
  - widths sum to fillable exactly (no residual)
  - First/last reservations honoured (same envelope as B)
  - Determinism
"""

from __future__ import annotations

import math

import pytest

from app.services.kos_panel_grid_mapper import (
    PanelReservation,
    SplitInput,
    split_minimize_panels,
)


def _p_int_8_input() -> SplitInput:
    return SplitInput(
        segment_id="P_INT_8",
        segment_length_mm=2101.0,
        segment_height_mm=3000,
        system="K4-110",
        sku_thickness_mm=110,
        application="internal",
        strategy="minimize_panels",
    )


def test_p_int_8_strategy_tag_is_minimize_panels() -> None:
    result = split_minimize_panels(_p_int_8_input())
    assert result.strategy_used == "minimize_panels"


def test_p_int_8_panel_count_matches_minimize_cuts() -> None:
    """For P_INT_8, n = round(1501/300) = 5 → same vertical-AP count as B."""
    result = split_minimize_panels(_p_int_8_input())
    # Verticals: S1 ECM + 5 AP + V1 CTC = 7. Total = 7 + 2 HB = 9.
    assert len(result.panels) == 9


def test_p_int_8_ap_widths_sum_to_fillable() -> None:
    """fillable = 2101 - 300 - 300 = 1501. n_ap = 5 → base=300, extras=1
    → widths = [301, 300, 300, 300, 300]. Sum = 1501."""
    result = split_minimize_panels(_p_int_8_input())
    ap_widths = [p.width_mm for p in result.panels if p.type == "AP"]
    assert sum(ap_widths) == 1501


def test_p_int_8_leftmost_ap_gets_the_extra_mm() -> None:
    """Leftmost-bias distribution: extras land on the first AP panels."""
    result = split_minimize_panels(_p_int_8_input())
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert ap_panels[0].width_mm == 301    # leftmost has +1mm
    for p in ap_panels[1:]:
        assert p.width_mm == 300


def test_p_int_8_envelope_same_as_strategy_b() -> None:
    """First panel = ECM at S1; last panel = CTC at V1 (internal defaults)."""
    result = split_minimize_panels(_p_int_8_input())
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals[0].type == "ECM"
    assert verticals[0].label == "S1"
    assert verticals[-1].type == "CTC"
    assert verticals[-1].label == "V1"


def test_no_residual_after_strategy_a_distribution() -> None:
    """Strategy A consumes the entire fillable region by integer distribution
    — no residual left over."""
    result = split_minimize_panels(_p_int_8_input())
    # Cursor after last AP = 300 (ECM) + 301 + 300 + 300 + 300 + 300 = 1801
    # Then terminator CTC at 1801 width 300 ends at 2101. Plus 1mm absorbed?
    # Actually the integer rounding shifts; the leftmost +1 absorbs the residual.
    # Sum: 1 ECM(300) + 5 AP(1501) + 1 CTC(300) = 2101 = segment_length ✓
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    sum_widths = sum(p.width_mm for p in verticals)
    assert sum_widths == 2101    # exactly fills the wall


def test_first_reservation_honoured() -> None:
    res = PanelReservation(sku_type="CP", sku_thickness_mm=155)
    inp = SplitInput(
        segment_id="P_EXT_3", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_panels",
        first_panel_reservation=res, neighbour_covered_right_mm=300.0,
    )
    result = split_minimize_panels(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals[0].type == "CP"
    assert verticals[0].position_mm == 0.0


def test_r5_external_no_reservation_no_ecm() -> None:
    """R5 applies the same to Strategy A."""
    inp = SplitInput(
        segment_id="P_EXT", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_panels",
        neighbour_covered_left_mm=300.0, neighbour_covered_right_mm=300.0,
    )
    result = split_minimize_panels(inp)
    panel_types = [p.type for p in result.panels]
    assert "ECM" not in panel_types


def test_small_fillable_still_yields_one_ap() -> None:
    """For fillable < w_std/2, max(1, round(...)) = 1 → one AP at fillable width."""
    # internal: ECM(300) + terminator(300) = 600 reserved; pick L=700 → fillable=100
    inp = SplitInput(
        segment_id="P_TINY", segment_length_mm=700.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="minimize_panels",
    )
    result = split_minimize_panels(inp)
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert len(ap_panels) == 1
    assert ap_panels[0].width_mm == 100


def test_determinism_repeated_calls() -> None:
    inp = _p_int_8_input()
    a = split_minimize_panels(inp)
    b = split_minimize_panels(inp)
    assert a == b
