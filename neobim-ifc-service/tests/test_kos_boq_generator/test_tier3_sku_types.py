"""Tests for ``tier3_sku_types.build_tier3_sku_types``.

Coverage:

* Empty input → empty tuple (anti-pattern #20)
* Single + multi prefix aggregation
* Skips prefixes with 0 panels (anti-pattern #4)
* Canonical prefix order (anti-pattern #5)
* CUSTOM row only when customs present (anti-pattern #3)
* CUSTOM row total_price_inr = 0.0 (anti-pattern #22)
* CUSTOM row aggregates skip None (area/weight)
* Notes from SKU_PREFIX_DESCRIPTIONS (Discrepancy #2 — overrides anti-pattern #24)
* Aggregations sum correctly (anti-pattern #36 — start=0.0)
* P_INT_8 + 90VR-MR reproduction
* Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    Tier3SKUType,
    Tier4SKUDetail,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier6_panel_pieces,
)


def _t4(sku_code: str, sku_prefix: str, thickness: int = 110,
        qty: int = 1, area: float = 9.681, weight: float = 12.488,
        price: float = 2178.24) -> Tier4SKUDetail:
    """Build a minimal Tier4SKUDetail for tests."""
    return Tier4SKUDetail(
        sku_code=sku_code, sku_prefix=sku_prefix, thickness_mm=thickness,
        description=f"{sku_prefix}{thickness} test", quantity=qty,
        unit_area_sqft=area, unit_weight_kg=weight, unit_price_inr=price,
        line_total_area_sqft=qty * area,
        line_total_weight_kg=qty * weight,
        line_total_price_inr=qty * price,
    )


def _custom(reason: str = "thickness_unknown", weight: float | None = 10.0,
            area: float | None = 20.0):
    from app.services.kos_boq_generator import CustomQuoteLineItem
    return CustomQuoteLineItem(
        wall_id="P_INT_X", reason=reason,                              # type: ignore[arg-type]
        reason_detail="synth", thickness_mm=100.0, length_mm=1000.0,
        height_mm=3000, area_sqft=area, estimated_weight_kg=weight,
        curve_radius_mm=None, arc_length_mm=None,
        subtotal_inr="TBD", quote_status="pending_sales_review",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier3_empty_tier4_returns_empty() -> None:
    """Empty Tier 4 + no customs → empty tuple."""
    assert build_tier3_sku_types((), ()) == ()


def test_build_tier3_empty_tier4_with_customs_returns_only_custom_row() -> None:
    """Empty Tier 4 + customs → only the synthetic CUSTOM row."""
    customs = (_custom(),)
    result = build_tier3_sku_types((), customs)
    assert len(result) == 1
    assert result[0].sku_prefix == "CUSTOM"


# ──────────────────────────────────────────────────────────────────────────────
# Standard prefix aggregation
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier3_single_prefix_single_thickness() -> None:
    """1 AP row → 1 Tier 3 row with notes from SKU_PREFIX_DESCRIPTIONS."""
    t4 = (_t4("AP110-2998", "AP", thickness=110, qty=5),)
    result = build_tier3_sku_types(t4, ())
    assert len(result) == 1
    assert result[0].sku_prefix == "AP"
    assert result[0].total_count == 5
    assert result[0].notes == "vertical panel (standard stretcher)"


def test_build_tier3_single_prefix_multiple_thicknesses_notes() -> None:
    """AP at 110 + 155 + 200 → 1 row.

    Discrepancy #2: golden uses SKU_PREFIX_DESCRIPTIONS (NOT "Multiple
    thickness variants" from anti-pattern #24).
    """
    t4 = (
        _t4("AP110-2998", "AP", thickness=110, qty=5),
        _t4("AP155-2998", "AP", thickness=155, qty=3),
        _t4("AP200-2998", "AP", thickness=200, qty=2),
    )
    result = build_tier3_sku_types(t4, ())
    assert len(result) == 1
    assert result[0].total_count == 10
    # Per Discrepancy #2: notes = SKU_PREFIX_DESCRIPTIONS lookup, not
    # "Multiple thickness variants"
    assert result[0].notes == "vertical panel (standard stretcher)"


def test_build_tier3_multiple_prefixes_canonical_order() -> None:
    """Mixed prefixes emerge in canonical order: AP, BT, TC, CP, CTC, ECF, ECM, JTF, JTM, PC."""
    # Provide in REVERSE order to verify algorithm ignores input order
    t4 = (
        _t4("TC110-2101", "TC"),
        _t4("AP155-2998", "AP", qty=5),
        _t4("CTC110-2998", "CTC"),
        _t4("BT110-2101", "BT"),
    )
    result = build_tier3_sku_types(t4, ())
    prefixes = [r.sku_prefix for r in result]
    # Canonical order: AP, BT, TC, CP, CTC ...
    assert prefixes == ["AP", "BT", "TC", "CTC"]


def test_build_tier3_skips_prefixes_with_zero_panels() -> None:
    """Anti-pattern #4: only present-in-Tier-4 prefixes appear in Tier 3."""
    t4 = (_t4("AP110-2998", "AP"),)
    result = build_tier3_sku_types(t4, ())
    prefixes = [r.sku_prefix for r in result]
    # Only AP present; BT/TC/CP/etc. not in result
    assert prefixes == ["AP"]


# ──────────────────────────────────────────────────────────────────────────────
# CUSTOM row behavior (anti-patterns #3, #22)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier3_with_zero_customs_no_custom_row() -> None:
    """Anti-pattern #3: empty customs → no CUSTOM row."""
    t4 = (_t4("AP110-2998", "AP"),)
    result = build_tier3_sku_types(t4, ())
    prefixes = [r.sku_prefix for r in result]
    assert "CUSTOM" not in prefixes


def test_build_tier3_with_customs_appends_custom_row_last() -> None:
    """CUSTOM row appears LAST in canonical order."""
    t4 = (_t4("AP110-2998", "AP"),)
    customs = (_custom(), _custom())
    result = build_tier3_sku_types(t4, customs)
    assert result[-1].sku_prefix == "CUSTOM"


def test_build_tier3_custom_row_total_count_equals_customs_length() -> None:
    """CUSTOM row count = len(custom_quote_items)."""
    customs = tuple(_custom() for _ in range(7))
    result = build_tier3_sku_types((), customs)
    assert result[0].total_count == 7


def test_build_tier3_custom_row_total_price_is_zero() -> None:
    """Anti-pattern #22: CUSTOM row price is ALWAYS 0.0 (TBD elsewhere)."""
    customs = (_custom(),)
    result = build_tier3_sku_types((), customs)
    assert result[0].total_price_inr == 0.0


def test_build_tier3_custom_row_notes_uses_sku_prefix_descriptions() -> None:
    """CUSTOM uses SKU_PREFIX_DESCRIPTIONS lookup (consistency with other rows)."""
    customs = (_custom(),)
    result = build_tier3_sku_types((), customs)
    # PR 1 SKU_PREFIX_DESCRIPTIONS["CUSTOM"] = "custom-quote items (priced separately)"
    assert result[0].notes == "custom-quote items (priced separately)"


def test_build_tier3_custom_row_weight_sum_skips_none() -> None:
    """Custom items with None estimated_weight_kg are skipped."""
    customs = (
        _custom(weight=10.0),
        _custom(weight=None),
        _custom(weight=20.0),
    )
    result = build_tier3_sku_types((), customs)
    assert result[0].total_weight_kg == 30.0


def test_build_tier3_custom_row_area_sum_skips_none() -> None:
    """Custom items with None area_sqft are skipped."""
    customs = (
        _custom(area=10.0),
        _custom(area=None),
        _custom(area=20.0),
    )
    result = build_tier3_sku_types((), customs)
    assert result[0].total_area_sqft == 30.0


def test_build_tier3_custom_row_all_none_weights_zero_float() -> None:
    """All None weights → 0.0 (float, NOT int 0 — anti-pattern #36)."""
    customs = (_custom(weight=None), _custom(weight=None))
    result = build_tier3_sku_types((), customs)
    assert result[0].total_weight_kg == 0.0
    assert isinstance(result[0].total_weight_kg, float)


def test_build_tier3_custom_row_empty_customs_zero_totals_are_float() -> None:
    """Sanity: when customs are empty, NO CUSTOM row is created (anti-pattern #3)."""
    result = build_tier3_sku_types((), ())
    assert result == ()


# ──────────────────────────────────────────────────────────────────────────────
# Aggregation correctness
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier3_aggregates_total_count_correctly() -> None:
    """qty sums across rows of same prefix."""
    t4 = (
        _t4("AP110-2998", "AP", qty=5),
        _t4("AP155-2998", "AP", qty=3),
    )
    result = build_tier3_sku_types(t4, ())
    assert result[0].total_count == 8


def test_build_tier3_aggregates_total_price_correctly() -> None:
    """line_total_price sums correctly."""
    t4 = (
        _t4("AP110-2998", "AP", qty=2, price=100.0),
        _t4("AP155-2998", "AP", qty=3, price=200.0),
    )
    result = build_tier3_sku_types(t4, ())
    # 2*100 + 3*200 = 800
    assert result[0].total_price_inr == 800.0


def test_build_tier3_aggregates_total_weight_correctly() -> None:
    t4 = (
        _t4("AP110-2998", "AP", qty=2, weight=10.0),
        _t4("AP155-2998", "AP", qty=3, weight=20.0),
    )
    result = build_tier3_sku_types(t4, ())
    assert result[0].total_weight_kg == 80.0  # 2*10 + 3*20


def test_build_tier3_aggregates_total_area_correctly() -> None:
    t4 = (
        _t4("AP110-2998", "AP", qty=2, area=5.0),
        _t4("AP155-2998", "AP", qty=3, area=10.0),
    )
    result = build_tier3_sku_types(t4, ())
    assert result[0].total_area_sqft == 40.0  # 2*5 + 3*10


# ──────────────────────────────────────────────────────────────────────────────
# Output type + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier3_returns_tuple_of_tier3_sku_type(p_int_8_mapper_output) -> None:
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    assert isinstance(tier3, tuple)
    for row in tier3:
        assert isinstance(row, Tier3SKUType)


def test_build_tier3_is_deterministic(p_int_8_mapper_output) -> None:
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    r1 = build_tier3_sku_types(tier4, ())
    r2 = build_tier3_sku_types(tier4, ())
    assert r1 == r2


def test_build_tier3_p_int_8_reproduces_golden_5_rows(p_int_8_mapper_output) -> None:
    """P_INT_8: exactly 5 rows AP/BT/TC/CTC/ECM in canonical order."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    assert len(tier3) == 5
    assert [r.sku_prefix for r in tier3] == ["AP", "BT", "TC", "CTC", "ECM"]


def test_build_tier3_90vr_mr_has_custom_row_last(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR has CUSTOM row appended at end."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    assert tier3[-1].sku_prefix == "CUSTOM"
    assert tier3[-1].total_count == 37
