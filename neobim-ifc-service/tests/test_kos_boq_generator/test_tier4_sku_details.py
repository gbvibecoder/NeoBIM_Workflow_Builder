"""Tests for ``tier4_sku_details.build_tier4_sku_details``.

Coverage:

* Empty input → empty tuple
* Single panel → 1-row output
* Grouping by sku_code (NOT prefix — anti-pattern #8)
* Lexicographic sort (ASSUMPTION-BOQ-13)
* Multi-thickness creates separate rows
* Line totals via exact multiplication (anti-pattern #9)
* Inconsistent unit values raise BOQInvariantError
* SKU parsing: 2-letter, 3-letter prefixes (anti-pattern #10)
* Description synthesis matches PR 1 golden format
* Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    AREA_TOLERANCE_SQFT,
    INR_TOLERANCE_RUPEES,
    KG_TOLERANCE,
    BOQInvariantError,
    Tier4SKUDetail,
    Tier6PanelPiece,
    build_tier4_sku_details,
    build_tier6_panel_pieces,
)
from app.services.kos_boq_generator.tier4_sku_details import (
    _extract_sku_prefix,
    _extract_thickness_from_sku,
    _parse_sku_components,
    _synthesize_description,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _make_tier6_piece(
    sku_code: str = "AP110-2998",
    *,
    area: float = 9.681,
    weight: float = 12.488,
    price: float = 2178.24,
    position_mm: float = 0.0,
    wall_id: str = "P_TEST",
) -> Tier6PanelPiece:
    return Tier6PanelPiece(
        wall_id=wall_id,
        panel_label="S1",
        sku_code=sku_code,
        position_mm=position_mm,
        cut_length_mm=2998,
        width_mm=300,
        is_cut_member=False,
        area_sqft=area,
        weight_kg=weight,
        price_inr=price,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_empty_panels_returns_empty_tuple() -> None:
    """Empty input does not crash."""
    assert build_tier4_sku_details(()) == ()


def test_build_tier4_single_panel_works() -> None:
    """Single-panel input produces a 1-row Tier 4 with quantity=1."""
    panels = (_make_tier6_piece(),)
    result = build_tier4_sku_details(panels)
    assert len(result) == 1
    assert result[0].quantity == 1


# ──────────────────────────────────────────────────────────────────────────────
# Grouping (anti-pattern #8: by sku_code, NOT by prefix)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_groups_by_sku_code_not_prefix() -> None:
    """AP155-2998 and AP200-2998 are SEPARATE rows (same prefix, different SKUs)."""
    panels = (
        _make_tier6_piece("AP155-2998", area=9.681, weight=14.13, price=2178.24),
        _make_tier6_piece("AP200-2998", area=9.681, weight=15.78, price=2178.24),
    )
    result = build_tier4_sku_details(panels)
    assert len(result) == 2
    assert {r.sku_code for r in result} == {"AP155-2998", "AP200-2998"}


def test_build_tier4_multi_thickness_creates_separate_rows() -> None:
    """3 different thicknesses → 3 Tier 4 rows."""
    panels = (
        _make_tier6_piece("AP110-2998", weight=12.49),
        _make_tier6_piece("AP155-2998", weight=14.13),
        _make_tier6_piece("AP200-2998", weight=15.78),
    )
    result = build_tier4_sku_details(panels)
    assert len(result) == 3


def test_build_tier4_groups_repeated_same_sku() -> None:
    """5 panels of same SKU → 1 row with quantity=5."""
    panels = tuple(_make_tier6_piece("AP155-2998") for _ in range(5))
    result = build_tier4_sku_details(panels)
    assert len(result) == 1
    assert result[0].quantity == 5


# ──────────────────────────────────────────────────────────────────────────────
# Lexicographic sort (ASSUMPTION-BOQ-13)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_sorts_lexicographically() -> None:
    """Tier 4 output sorted by sku_code lexicographically."""
    panels = (
        _make_tier6_piece("TC110-2101"),
        _make_tier6_piece("AP155-2998"),
        _make_tier6_piece("BT110-2101"),
        _make_tier6_piece("CTC200-2998"),
    )
    result = build_tier4_sku_details(panels)
    skus = [r.sku_code for r in result]
    assert skus == sorted(skus)
    assert skus == ["AP155-2998", "BT110-2101", "CTC200-2998", "TC110-2101"]


# ──────────────────────────────────────────────────────────────────────────────
# B-7 invariant preview: line_total = quantity * unit (exact multiplication)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_line_total_area_is_per_panel_sum() -> None:
    """B-7 (revised): line_total_area_sqft = Σ panel.area_sqft (per-panel sum).

    For consistent-dimension SKUs (all panels share area), sum == qty × unit
    bit-identically. Test verifies the sum-based contract.
    """
    panels = tuple(_make_tier6_piece("AP155-2998", area=9.681) for _ in range(7))
    result = build_tier4_sku_details(panels)
    row = result[0]
    expected_sum = sum(p.area_sqft for p in panels)
    assert row.line_total_area_sqft == expected_sum


def test_build_tier4_line_total_weight_is_per_panel_sum() -> None:
    panels = tuple(_make_tier6_piece("AP200-2998", weight=15.78) for _ in range(3))
    result = build_tier4_sku_details(panels)
    row = result[0]
    assert row.line_total_weight_kg == sum(p.weight_kg for p in panels)


def test_build_tier4_line_total_price_is_per_panel_sum() -> None:
    panels = tuple(_make_tier6_piece("BT110-2101", price=1526.51) for _ in range(4))
    result = build_tier4_sku_details(panels)
    row = result[0]
    assert row.line_total_price_inr == sum(p.price_inr for p in panels)


# ──────────────────────────────────────────────────────────────────────────────
# Variable-width CTC reality (90VR live discovery)
#
# Panels with the same sku_code can have DIFFERENT widths in mapper output
# (CTC variants are residual fillers; SKU code only encodes thickness +
# cut_length, not width). Tier 4 algorithm uses per-panel SUM for line totals,
# so variable widths produce correct totals.
#
# The original "raises on inconsistent" tests assumed a uniform-dimension
# invariant that 90VR-MR proved wrong. These tests now verify the variable-
# width tolerance.
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_accepts_variable_unit_area_for_same_sku() -> None:
    """CTC convention: same SKU code, different widths → different areas. Acceptable."""
    panels = (
        _make_tier6_piece("CTC155-2998", area=9.681, price=2178.24),
        _make_tier6_piece("CTC155-2998", area=7.228, price=1626.42),     # narrower CTC
    )
    result = build_tier4_sku_details(panels)
    assert len(result) == 1
    assert result[0].quantity == 2


def test_build_tier4_variable_widths_sum_for_line_total() -> None:
    """Line total = sum of per-panel values (correct for variable widths)."""
    panels = (
        _make_tier6_piece("CTC155-2998", area=9.681,  price=2178.24),
        _make_tier6_piece("CTC155-2998", area=7.228,  price=1626.42),
        _make_tier6_piece("CTC155-2998", area=4.679,  price=1052.78),
    )
    result = build_tier4_sku_details(panels)
    assert result[0].quantity == 3
    assert result[0].line_total_area_sqft == pytest.approx(9.681 + 7.228 + 4.679)
    assert result[0].line_total_price_inr == pytest.approx(2178.24 + 1626.42 + 1052.78)


def test_build_tier4_consistent_dimensions_sum_equals_qty_times_unit() -> None:
    """For consistent SKUs (e.g. AP at fixed 300mm width), sum == qty × unit
    bit-identically in IEEE-754 — line_total preserves byte-equal P_INT_8 golden."""
    panels = tuple(
        _make_tier6_piece("AP110-2998", area=9.681061028788726,
                          weight=12.488568727137457, price=2178.2387314774633)
        for _ in range(5)
    )
    result = build_tier4_sku_details(panels)
    row = result[0]
    assert row.line_total_area_sqft == 5 * row.unit_area_sqft
    assert row.line_total_weight_kg == 5 * row.unit_weight_kg
    assert row.line_total_price_inr == 5 * row.unit_price_inr


def test_build_tier4_unit_values_are_first_panel_representative() -> None:
    """``unit_*`` fields = first panel's values (representative; per docstring)."""
    panels = (
        _make_tier6_piece("CTC155-2998", area=9.681, weight=14.13, price=2178.24),
        _make_tier6_piece("CTC155-2998", area=7.228, weight=10.55, price=1626.42),
    )
    result = build_tier4_sku_details(panels)
    assert result[0].unit_area_sqft == 9.681
    assert result[0].unit_weight_kg == 14.13
    assert result[0].unit_price_inr == 2178.24


# ──────────────────────────────────────────────────────────────────────────────
# SKU parsing (anti-pattern #10: regex for 2/3-letter prefixes)
# ──────────────────────────────────────────────────────────────────────────────


def test_parse_sku_components_handles_two_letter_prefix() -> None:
    """AP, BT, TC, CP, PC — 2-letter prefixes."""
    assert _parse_sku_components("AP155-2998") == ("AP", 155)
    assert _parse_sku_components("BT110-2101") == ("BT", 110)
    assert _parse_sku_components("TC110-2101") == ("TC", 110)
    assert _parse_sku_components("CP200-2998") == ("CP", 200)


def test_parse_sku_components_handles_three_letter_prefix() -> None:
    """CTC, ECF, ECM, JTF, JTM — 3-letter prefixes (anti-pattern #10)."""
    assert _parse_sku_components("CTC110-2998") == ("CTC", 110)
    assert _parse_sku_components("ECF155-2998") == ("ECF", 155)
    assert _parse_sku_components("ECM200-2998") == ("ECM", 200)
    assert _parse_sku_components("JTF110-1000") == ("JTF", 110)


def test_parse_sku_components_accepts_cut_suffix() -> None:
    """Cut-member SKU codes have a third dash-segment: 'AP155-1500-CUT'."""
    assert _parse_sku_components("AP155-1500-CUT") == ("AP", 155)


def test_parse_sku_components_raises_on_malformed() -> None:
    """Empty or garbage strings raise BOQInvariantError."""
    with pytest.raises(BOQInvariantError) as exc:
        _parse_sku_components("nonsense")
    assert exc.value.invariant_id == "SKU_FORMAT"


def test_parse_sku_components_raises_on_missing_thickness() -> None:
    """Prefix-only with no thickness digits raises."""
    with pytest.raises(BOQInvariantError) as exc:
        _parse_sku_components("AP-2998")
    assert exc.value.invariant_id == "SKU_FORMAT"


def test_extract_sku_prefix_wrapper() -> None:
    assert _extract_sku_prefix("CTC110-2998") == "CTC"


def test_extract_thickness_from_sku_wrapper() -> None:
    assert _extract_thickness_from_sku("AP155-2998") == 155


# ──────────────────────────────────────────────────────────────────────────────
# Description synthesis (anti-pattern #12: format matches PR 1 golden)
# ──────────────────────────────────────────────────────────────────────────────


def test_synthesize_description_known_prefix_correct_format() -> None:
    """Description matches PR 1 golden format exactly."""
    assert _synthesize_description("AP110-2998") == (
        "AP110 vertical panel (standard stretcher), 2998mm cut"
    )
    assert _synthesize_description("BT110-2101") == (
        "BT110 bottom track (horizontal), 2101mm cut"
    )
    assert _synthesize_description("CTC110-2998") == (
        "CTC110 connector / corner / terminator, 2998mm cut"
    )
    assert _synthesize_description("ECM110-2998") == "ECM110 end cap male, 2998mm cut"
    assert _synthesize_description("TC110-2101") == (
        "TC110 top cap (horizontal), 2101mm cut"
    )


def test_synthesize_description_unknown_prefix_uses_prefix_as_fallback() -> None:
    """When prefix isn't in the lookup table, falls back to the prefix string."""
    # XX is not in SKU_PREFIX_DESCRIPTIONS → use prefix as the role description
    result = _synthesize_description("XX155-2998")
    assert result == "XX155 XX, 2998mm cut"


# ──────────────────────────────────────────────────────────────────────────────
# Output type + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier4_returns_tuple_of_tier4_sku_detail(p_int_8_mapper_output) -> None:
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    assert isinstance(tier4, tuple)
    for row in tier4:
        assert isinstance(row, Tier4SKUDetail)


def test_build_tier4_is_deterministic(p_int_8_mapper_output) -> None:
    """Same input twice → identical output."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    r1 = build_tier4_sku_details(tier6)
    r2 = build_tier4_sku_details(tier6)
    assert r1 == r2
