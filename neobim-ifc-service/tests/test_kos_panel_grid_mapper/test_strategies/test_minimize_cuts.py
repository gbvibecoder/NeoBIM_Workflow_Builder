"""Tests for Strategy B (minimize_cuts) — the DEFAULT splitter strategy.

The flagship test: P_INT_8 → 9 canonical panels byte-equal to the PR 1
golden JSON (1 ECM + 5 AP + 1 CTC terminator + 2 horizontal BT/TC).

Coverage:
  - P_INT_8 canonical 9-panel layout (label / position / SKU / numeric byte-equality)
  - Residual handling: ≤ 50mm absorbed; 50-250mm → CTC infill; > 250mm → extra AP
  - First-reservation: CP at S1 for external corner-owner
  - R5: external + None reservation → cursor starts at neighbour_covered_left_mm
  - Internal default first = ECM; default last = CTC V1
  - segment-too-short edge case
  - HB1/HB2 emission at full segment length, position 0, orientation horizontal
  - Determinism
"""

from __future__ import annotations

import math

import pytest

from app.services.kos_panel_grid_mapper import (
    PanelReservation,
    SplitInput,
    split_minimize_cuts,
)


def _p_int_8_input() -> SplitInput:
    """Canonical P_INT_8: 2101mm internal wall, K4-110, no reservations."""
    return SplitInput(
        segment_id="P_INT_8",
        segment_length_mm=2101.0,
        segment_height_mm=3000,
        system="K4-110",
        sku_thickness_mm=110,
        application="internal",
        strategy="minimize_cuts",
    )


# ──────────────────────────────────────────────────────────────────────────────
# THE FLAGSHIP — P_INT_8 byte-equal vs PR 1 canonical golden JSON
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_produces_9_panels() -> None:
    result = split_minimize_cuts(_p_int_8_input())
    assert len(result.panels) == 9


def test_p_int_8_panel_labels_match_canonical_order() -> None:
    """Order: HB1, HB2, S1(ECM), S2..S6(AP), V1(CTC)."""
    result = split_minimize_cuts(_p_int_8_input())
    labels = [p.label for p in result.panels]
    assert labels == ["HB1", "HB2", "S1", "S2", "S3", "S4", "S5", "S6", "V1"]


def test_p_int_8_panel_skus_match_canonical() -> None:
    result = split_minimize_cuts(_p_int_8_input())
    expected_skus = [
        "BT110-2101", "TC110-2101",     # horizontals
        "ECM110-2998",                   # S1 (internal default left)
        "AP110-2998", "AP110-2998", "AP110-2998", "AP110-2998", "AP110-2998",
        "CTC110-2998",                   # V1 (internal default terminator)
    ]
    actual = [p.sku for p in result.panels]
    assert actual == expected_skus


def test_p_int_8_panel_positions_correct() -> None:
    result = split_minimize_cuts(_p_int_8_input())
    # Horizontals at position 0
    assert result.panels[0].position_mm == 0.0    # HB1
    assert result.panels[1].position_mm == 0.0    # HB2
    # Verticals: S1 ECM at 0, S2 AP at 300, ..., V1 CTC at 1800
    expected_vert_positions = [0.0, 300.0, 600.0, 900.0, 1200.0, 1500.0, 1800.0]
    actual_vert = [p.position_mm for p in result.panels[2:]]
    assert actual_vert == expected_vert_positions


def test_p_int_8_byte_equal_to_canonical_golden_json(p_int_8_canonical_json) -> None:
    """The flagship: every Panel field byte-equal to the PR 1 golden JSON
    (loaded with full IEEE-754 precision)."""
    result = split_minimize_cuts(_p_int_8_input())
    golden_panels = p_int_8_canonical_json["panels"]

    assert len(result.panels) == len(golden_panels), (
        f"Panel count mismatch: actual={len(result.panels)} vs golden={len(golden_panels)}"
    )

    for actual, expected in zip(result.panels, golden_panels):
        # Identity fields — exact equality
        assert actual.label == expected["label"], (
            f"Label mismatch on {expected['label']}: actual={actual.label!r}"
        )
        assert actual.sku == expected["sku"]
        assert actual.type == expected["type"]
        assert actual.thickness_mm == expected["thickness_mm"]
        assert actual.width_mm == expected["width_mm"]
        assert actual.cut_length_mm == expected["cut_length_mm"]
        assert actual.raw_length_mm == expected["raw_length_mm"]
        assert actual.orientation == expected["orientation"]
        assert actual.is_cut_member == expected["is_cut_member"]
        # Float fields — should match exactly via canonical 92903.04 denominator
        assert math.isclose(actual.position_mm, expected["position_mm"], abs_tol=1e-9)
        assert math.isclose(actual.area_sqft, expected["area_sqft"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg, expected["weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg_skin, expected["weight_kg_skin"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg_rib, expected["weight_kg_rib"], rel_tol=1e-12)
        assert math.isclose(actual.raw_weight_kg, expected["raw_weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.waste_weight_kg, expected["waste_weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.price_inr, expected["price_inr"], rel_tol=1e-12)


def test_p_int_8_strategy_tag_is_minimize_cuts() -> None:
    result = split_minimize_cuts(_p_int_8_input())
    assert result.strategy_used == "minimize_cuts"


def test_p_int_8_no_warnings_for_clean_case() -> None:
    """P_INT_8 has no R5 application (it's internal), no edge cases, no
    custom-thickness — should produce zero warnings."""
    result = split_minimize_cuts(_p_int_8_input())
    assert result.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Residual handling — DESIGN §6.5 thresholds
# ──────────────────────────────────────────────────────────────────────────────


def test_residual_le_50mm_absorbed_no_infill() -> None:
    """P_INT_8 fillable=1501 → 5 AP + residual=1 → absorbed (no extra panel)."""
    result = split_minimize_cuts(_p_int_8_input())
    # 9 panels total = 2 HB + 1 ECM + 5 AP + 1 CTC (terminator, not infill)
    # No CTC infill means we have S1=ECM, S2-S6=AP, V1=CTC. That's 7 verticals.
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert len(verticals) == 7


def test_residual_50_to_250_emits_ctc_infill() -> None:
    """Choose length so fillable produces residual ~100mm → 1 CTC narrow infill."""
    # Internal wall, no reservations: cursor=300 (ECM), last_reserve=300 (terminator)
    # fillable = L - 600. We want fillable = 5*300 + 100 = 1600 → L = 2200.
    inp = SplitInput(
        segment_id="P_TEST", segment_length_mm=2200.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="minimize_cuts",
    )
    result = split_minimize_cuts(inp)
    # Expected verticals: S1 ECM + S2..S6 AP (5) + S7 CTC infill (100mm) + V1 CTC = 8
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert len(verticals) == 8
    # The infill is at position 1800 (after 5×300 APs starting at 300), width=100
    infill = next(p for p in verticals if p.type == "CTC" and p.width_mm == 100)
    assert infill.position_mm == 1800.0
    assert infill.label.startswith("S")  # sequential S label, not V


def test_residual_above_250_rounds_up_to_extra_ap() -> None:
    """Choose length so residual > 250mm → 1 extra standard AP, smaller residual absorbed."""
    # fillable = 5*300 + 280 = 1780 → L = 2380
    inp = SplitInput(
        segment_id="P_TEST", segment_length_mm=2380.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="minimize_cuts",
    )
    result = split_minimize_cuts(inp)
    # Expected verticals: S1 ECM + 6 AP (one extra round-up) + V1 CTC = 8
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert len(verticals) == 8
    # All AP panels are standard 300mm width (no narrow infill in this case)
    ap_widths = [p.width_mm for p in verticals if p.type == "AP"]
    assert all(w == 300 for w in ap_widths)


# ──────────────────────────────────────────────────────────────────────────────
# Reservations — first / last (CP from corner_handler, PC from t_junction)
# ──────────────────────────────────────────────────────────────────────────────


def test_first_reservation_emits_at_position_zero() -> None:
    """External wall owning the LEFT corner → first_panel_reservation = CP155-2998."""
    res = PanelReservation(sku_type="CP", sku_thickness_mm=155)
    inp = SplitInput(
        segment_id="P_EXT_3", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_cuts",
        first_panel_reservation=res,
        last_panel_reservation=None,
        neighbour_covered_right_mm=300.0,   # R5: right corner owned by neighbour
    )
    result = split_minimize_cuts(inp)
    # First vertical panel should be the reserved CP at position 0
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    first_vert = verticals[0]
    assert first_vert.type == "CP"
    assert first_vert.sku == "CP155-2998"
    assert first_vert.position_mm == 0.0
    assert first_vert.label == "S1"


def test_last_reservation_emits_after_ap_run() -> None:
    res_first = PanelReservation(sku_type="CP", sku_thickness_mm=155)
    res_last = PanelReservation(sku_type="CP", sku_thickness_mm=155)
    inp = SplitInput(
        segment_id="P_EXT_3", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_cuts",
        first_panel_reservation=res_first,
        last_panel_reservation=res_last,
    )
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals[0].type == "CP"     # first CP
    assert verticals[-1].type == "CP"    # last CP


# ──────────────────────────────────────────────────────────────────────────────
# R5 ACID — external + None reservation → cursor starts at covered offset
# ──────────────────────────────────────────────────────────────────────────────


def test_r5_external_no_reservation_starts_at_covered_offset() -> None:
    """External wall with NO first_panel_reservation and neighbour_covered_left_mm=300
    → splitter starts the AP run at cursor=300 (skipping the covered region).
    Does NOT emit an ECM default. Emits a warning explaining R5 was applied."""
    inp = SplitInput(
        segment_id="P_EXT_3", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_cuts",
        first_panel_reservation=None,         # no reservation
        last_panel_reservation=None,
        neighbour_covered_left_mm=300.0,      # neighbour owns left corner
        neighbour_covered_right_mm=300.0,     # neighbour owns right corner
    )
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]

    # First vertical panel should be an AP (NOT ECM), at position 300 (not 0).
    first_vert = verticals[0]
    assert first_vert.type == "AP", (
        f"R5 violation: expected AP first (cursor=covered_left), got {first_vert.type}"
    )
    assert first_vert.position_mm == 300.0, (
        f"R5 violation: expected first AP at position 300mm, got {first_vert.position_mm}"
    )
    # And the R5 warning should be present.
    assert any("R5: external segment" in w for w in result.warnings)


def test_r5_external_no_reservation_no_ecm_emitted() -> None:
    """Verify that ECM is NEVER emitted for external segments (only internal)."""
    inp = SplitInput(
        segment_id="P_EXT_3", segment_length_mm=9370.0, segment_height_mm=3000,
        system="K6-150", sku_thickness_mm=155, application="external",
        strategy="minimize_cuts",
        first_panel_reservation=None,
        last_panel_reservation=None,
        neighbour_covered_left_mm=300.0,
        neighbour_covered_right_mm=300.0,
    )
    result = split_minimize_cuts(inp)
    panel_types = [p.type for p in result.panels]
    assert "ECM" not in panel_types
    assert "ECF" not in panel_types


# ──────────────────────────────────────────────────────────────────────────────
# Internal defaults — ECM at S1, CTC at V1
# ──────────────────────────────────────────────────────────────────────────────


def test_internal_default_first_is_ecm() -> None:
    inp = _p_int_8_input()
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals[0].type == "ECM"
    assert verticals[0].label == "S1"
    assert verticals[0].position_mm == 0.0


def test_internal_default_last_is_ctc_terminator() -> None:
    inp = _p_int_8_input()
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    assert verticals[-1].type == "CTC"
    assert verticals[-1].label == "V1"      # Vamshi convention


# ──────────────────────────────────────────────────────────────────────────────
# HB1/HB2 horizontal bands
# ──────────────────────────────────────────────────────────────────────────────


def test_horizontals_emitted_first_two_with_full_wall_length() -> None:
    inp = _p_int_8_input()
    result = split_minimize_cuts(inp)
    hb1, hb2 = result.panels[0], result.panels[1]
    assert hb1.type == "BT"
    assert hb1.label == "HB1"
    assert hb1.orientation == "horizontal"
    assert hb1.cut_length_mm == 2101
    assert hb1.position_mm == 0.0
    assert hb2.type == "TC"
    assert hb2.label == "HB2"


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_segment_too_short_emits_warning() -> None:
    """L < first+last reservation widths → fillable < 0 → warning, no AP panels."""
    inp = SplitInput(
        segment_id="P_TINY", segment_length_mm=400.0, segment_height_mm=3000,
        system="K4-110", sku_thickness_mm=110, application="internal",
        strategy="minimize_cuts",
        # internal defaults: ECM 300 + terminator 300 = 600mm reserved
        # fillable = 400 - 600 = -200 → warning
    )
    result = split_minimize_cuts(inp)
    assert any("segment too short" in w for w in result.warnings)


def test_determinism_repeated_calls() -> None:
    inp = _p_int_8_input()
    a = split_minimize_cuts(inp)
    b = split_minimize_cuts(inp)
    assert a == b


# ──────────────────────────────────────────────────────────────────────────────
# C-1 validation: sum of panel widths + covered = segment length
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_length_sum_satisfies_c1() -> None:
    """Sum of vertical-panel widths + neighbour_covered_*_mm should ≈ length_mm
    (DESIGN §5 C-1 validation invariant)."""
    inp = _p_int_8_input()
    result = split_minimize_cuts(inp)
    verticals = [p for p in result.panels if p.orientation == "vertical"]
    sum_widths = sum(p.width_mm for p in verticals)
    # P_INT_8 = 2101mm, all panels at 300mm width = 7 × 300 = 2100. Residual 1mm absorbed.
    assert sum_widths == 2100
    assert abs(sum_widths - inp.segment_length_mm) <= 50.0   # within C-1 ±50mm tolerance
