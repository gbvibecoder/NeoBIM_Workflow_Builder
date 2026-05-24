"""Tests for Strategy C (symmetric) — half-residual at AP-run ends.

Coverage:
  - P_INT_8: residual=1mm → leftmost AP gets +1, others standard
  - Larger residual: split half/half on both ends
  - Edge case: n_full == 0 → single CTC narrow infill
  - Edge case: n_full == 1 → one AP at fillable width
  - First/last reservations honoured (same envelope as B)
  - Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    SplitInput,
    split_symmetric,
)


def _p_int_8_input() -> SplitInput:
    return SplitInput(
        segment_id="P_INT_8",
        segment_length_mm=2101.0,
        segment_height_mm=3000,
        system="K4-110",
        sku_thickness_mm=110,
        application="internal",
        strategy="symmetric",
    )


def test_p_int_8_strategy_tag_is_symmetric() -> None:
    result = split_symmetric(_p_int_8_input())
    assert result.strategy_used == "symmetric"


def test_p_int_8_residual_1mm_goes_to_leftmost_ap() -> None:
    """fillable=1501, n_full=5, residual=1. Split (0,1) → leftmost gets +1.
    widths = [301, 300, 300, 300, 300]."""
    result = split_symmetric(_p_int_8_input())
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert len(ap_panels) == 5
    assert ap_panels[0].width_mm == 301
    for p in ap_panels[1:]:
        assert p.width_mm == 300


def test_residual_2mm_splits_half_half() -> None:
    """fillable=1502 → n_full=5, residual=2. (1,1) — leftmost +1, rightmost +1.
    Choose L=2102: ECM(300) + AP_run(1502) + CTC(300) = 2102."""
    inp = SplitInput(
        segment_id="P_TEST", segment_length_mm=2102.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="symmetric",
    )
    result = split_symmetric(inp)
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert ap_panels[0].width_mm == 301
    assert ap_panels[-1].width_mm == 301
    for p in ap_panels[1:-1]:
        assert p.width_mm == 300


def test_residual_odd_leftmost_bias() -> None:
    """fillable=1503 → residual=3. (extra_left=2, extra_right=1).
    widths = [302, 300, 300, 300, 301]."""
    inp = SplitInput(
        segment_id="P_TEST", segment_length_mm=2103.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="symmetric",
    )
    result = split_symmetric(inp)
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert ap_panels[0].width_mm == 302    # leftmost gets ceil(3/2) = 2 extra
    assert ap_panels[-1].width_mm == 301   # rightmost gets floor(3/2) = 1 extra


def test_n_full_one_emits_single_ap_at_fillable_width() -> None:
    """If only 1 AP fits, its width = fillable."""
    # internal: ECM 300 + terminator 300 = 600; want fillable=400 → L=1000
    inp = SplitInput(
        segment_id="P_TINY", segment_length_mm=1000.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="symmetric",
    )
    result = split_symmetric(inp)
    ap_panels = [p for p in result.panels if p.type == "AP"]
    assert len(ap_panels) == 1
    assert ap_panels[0].width_mm == 400


def test_n_full_zero_emits_narrow_ctc_if_residual_above_threshold() -> None:
    """fillable=100 → n_full=0, residual=100 > 50mm absorb threshold → CTC narrow."""
    # ECM(300) + 100 + CTC(300) = 700
    inp = SplitInput(
        segment_id="P_TINY", segment_length_mm=700.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="symmetric",
    )
    result = split_symmetric(inp)
    ctc_panels = [p for p in result.panels if p.type == "CTC"]
    # Two CTC panels: the narrow infill (100mm) + the V1 terminator (300mm)
    assert len(ctc_panels) == 2
    widths = sorted(p.width_mm for p in ctc_panels)
    assert widths == [100, 300]


def test_r5_external_no_reservation_no_ecm() -> None:
    """R5 applies the same way for Strategy C."""
    inp = SplitInput(
        segment_id="P_EXT", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="symmetric",
        neighbour_covered_left_mm=300.0, neighbour_covered_right_mm=300.0,
    )
    result = split_symmetric(inp)
    panel_types = [p.type for p in result.panels]
    assert "ECM" not in panel_types


def test_determinism_repeated_calls() -> None:
    inp = _p_int_8_input()
    a = split_symmetric(inp)
    b = split_symmetric(inp)
    assert a == b
