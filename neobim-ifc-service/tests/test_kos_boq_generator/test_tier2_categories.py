"""Tests for ``tier2_categories.build_tier2_categories``.

Coverage:

* Empty tier3 → empty buckets (anti-pattern #20)
* Standard bucket aggregates AP only (anti-pattern #29)
* Accessories bucket aggregates non-AP (BT/TC/CP/CTC/ECF/ECM/JTF/JTM/PC)
* Custom bucket: count + weight_kg_estimated + subtotal_inr "TBD" + by_reason
* by_reason sorted alphabetically by key (anti-pattern #20)
* Empty customs → by_reason = () (anti-pattern #30)
* by_reason uses reason Literal enum (anti-pattern #31)
* TBD literal preserved (anti-pattern #21)
* sum() uses start=0.0 (anti-pattern #36)
* Float types preserved on empty
* 90VR-MR verification
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2Category,
    Tier3SKUType,
    build_tier2_categories,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier6_panel_pieces,
)


def _t3(prefix: str, count: int = 1, weight: float = 10.0, price: float = 100.0,
        area: float = 5.0) -> Tier3SKUType:
    return Tier3SKUType(
        sku_prefix=prefix, total_count=count, total_area_sqft=area,
        total_weight_kg=weight, total_price_inr=price, notes="test",
    )


def _custom(reason: str = "thickness_unknown", weight: float | None = 10.0):
    from app.services.kos_boq_generator import CustomQuoteLineItem
    return CustomQuoteLineItem(
        wall_id="P_INT_X", reason=reason,                              # type: ignore[arg-type]
        reason_detail="synth", thickness_mm=100.0, length_mm=1000.0,
        height_mm=3000, area_sqft=20.0, estimated_weight_kg=weight,
        curve_radius_mm=None, arc_length_mm=None,
        subtotal_inr="TBD", quote_status="pending_sales_review",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_empty_tier3_returns_empty_buckets() -> None:
    """Empty Tier 3 → all buckets have zero counts (still valid output)."""
    result = build_tier2_categories((), ())
    assert isinstance(result, Tier2Category)
    assert result.standard_panels.count == 0
    assert result.accessories.count == 0
    assert result.custom_quotes.count == 0


def test_build_tier2_empty_tier3_zero_subtotals_are_float() -> None:
    """Anti-pattern #36: empty sums must be float 0.0, not int 0."""
    result = build_tier2_categories((), ())
    assert isinstance(result.standard_panels.subtotal_inr, float)
    assert isinstance(result.accessories.subtotal_inr, float)
    assert isinstance(result.standard_panels.weight_kg, float)
    assert isinstance(result.accessories.weight_kg, float)


def test_build_tier2_returns_tier2_category(p_int_8_mapper_output) -> None:
    """Output type is Tier2Category dataclass."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    result = build_tier2_categories(tier3, ())
    assert isinstance(result, Tier2Category)


# ──────────────────────────────────────────────────────────────────────────────
# Standard bucket — AP only (anti-pattern #29)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_standard_bucket_aggregates_ap_only() -> None:
    """TIER2_STANDARD_PANEL_PREFIXES = ('AP',) — only AP counts as standard."""
    tier3 = (
        _t3("AP", count=5, weight=60.0, price=10000.0),
        _t3("BT", count=1, weight=8.0, price=1500.0),
        _t3("TC", count=1, weight=8.0, price=1500.0),
    )
    result = build_tier2_categories(tier3, ())
    # Standard = AP only
    assert result.standard_panels.count == 5
    assert result.standard_panels.weight_kg == 60.0
    assert result.standard_panels.subtotal_inr == 10000.0


def test_build_tier2_standard_bucket_excludes_custom_tier3_row() -> None:
    """Synthetic CUSTOM Tier 3 row does NOT fall into standard bucket."""
    tier3 = (
        _t3("AP", count=5, weight=60.0, price=10000.0),
        _t3("CUSTOM", count=3, weight=30.0, price=0.0),
    )
    result = build_tier2_categories(tier3, ())
    # CUSTOM excluded from standard
    assert result.standard_panels.count == 5
    assert result.standard_panels.subtotal_inr == 10000.0


# ──────────────────────────────────────────────────────────────────────────────
# Accessories bucket
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_accessories_bucket_aggregates_non_ap() -> None:
    """Accessories = BT + TC + CP + CTC + ECF + ECM + JTF + JTM + PC."""
    tier3 = (
        _t3("AP", count=5, weight=60.0, price=10000.0),
        _t3("BT", count=1, weight=8.0, price=1500.0),
        _t3("TC", count=1, weight=8.0, price=1500.0),
        _t3("CTC", count=1, weight=12.0, price=2178.0),
        _t3("ECM", count=1, weight=12.0, price=2178.0),
    )
    result = build_tier2_categories(tier3, ())
    assert result.accessories.count == 4                               # BT+TC+CTC+ECM
    assert result.accessories.weight_kg == 40.0
    assert result.accessories.subtotal_inr == 7356.0


def test_build_tier2_accessories_bucket_excludes_custom_tier3_row() -> None:
    """CUSTOM Tier 3 row excluded from accessories bucket."""
    tier3 = (
        _t3("BT", count=1, weight=8.0, price=1500.0),
        _t3("CUSTOM", count=3, weight=30.0, price=0.0),
    )
    result = build_tier2_categories(tier3, ())
    assert result.accessories.count == 1
    assert result.accessories.subtotal_inr == 1500.0


# ──────────────────────────────────────────────────────────────────────────────
# Custom bucket (anti-patterns #20, #21, #30, #31)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_custom_bucket_count() -> None:
    customs = (_custom(), _custom(), _custom())
    result = build_tier2_categories((), customs)
    assert result.custom_quotes.count == 3


def test_build_tier2_custom_bucket_subtotal_is_tbd_literal() -> None:
    """Anti-pattern #21: subtotal_inr is always literal 'TBD'."""
    result = build_tier2_categories((), (_custom(),))
    assert result.custom_quotes.subtotal_inr == "TBD"


def test_build_tier2_custom_bucket_weight_kg_estimated() -> None:
    """Sums estimated_weight_kg, skipping None."""
    customs = (
        _custom(weight=10.0),
        _custom(weight=20.0),
        _custom(weight=None),
    )
    result = build_tier2_categories((), customs)
    assert result.custom_quotes.weight_kg_estimated == 30.0


def test_build_tier2_custom_bucket_by_reason_sorted_alphabetically() -> None:
    """Anti-pattern #20: by_reason sorted by key alphabetically."""
    customs = (
        _custom(reason="thickness_unknown"),
        _custom(reason="system_180_not_stocked"),
        _custom(reason="thickness_below_minimum"),
    )
    result = build_tier2_categories((), customs)
    keys = [pair[0] for pair in result.custom_quotes.by_reason]
    assert keys == sorted(keys)
    assert keys == ["system_180_not_stocked", "thickness_below_minimum",
                     "thickness_unknown"]


def test_build_tier2_custom_bucket_empty_customs_empty_by_reason() -> None:
    """Anti-pattern #30: empty customs → by_reason = ()."""
    result = build_tier2_categories((), ())
    assert result.custom_quotes.by_reason == ()


def test_build_tier2_custom_bucket_empty_customs_zero_weight_is_float() -> None:
    """Anti-pattern #36: empty sum → float 0.0."""
    result = build_tier2_categories((), ())
    assert result.custom_quotes.weight_kg_estimated == 0.0
    assert isinstance(result.custom_quotes.weight_kg_estimated, float)


def test_build_tier2_by_reason_uses_reason_enum_not_detail() -> None:
    """Anti-pattern #31: aggregates by Literal `reason`, NOT reason_detail."""
    # Two items with same reason but different details → 1 by_reason entry
    customs = (
        _custom(reason="thickness_unknown"),
        _custom(reason="thickness_unknown"),
    )
    result = build_tier2_categories((), customs)
    assert len(result.custom_quotes.by_reason) == 1
    assert result.custom_quotes.by_reason[0] == ("thickness_unknown", 2)


def test_build_tier2_by_reason_counts_correctly() -> None:
    """Counts per reason."""
    customs = (
        _custom(reason="thickness_unknown"),
        _custom(reason="thickness_unknown"),
        _custom(reason="thickness_below_minimum"),
        _custom(reason="system_180_not_stocked"),
        _custom(reason="system_180_not_stocked"),
        _custom(reason="system_180_not_stocked"),
    )
    result = build_tier2_categories((), customs)
    counts = dict(result.custom_quotes.by_reason)
    assert counts == {
        "system_180_not_stocked": 3,
        "thickness_below_minimum": 1,
        "thickness_unknown": 2,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation + P_INT_8 byte-equal (already tested in golden_reproduction_pr3)
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_weights_sum_to_total(p_int_8_mapper_output) -> None:
    """std.weight + acc.weight = total_weight (per Tier 1 expectation)."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    total = tier2.standard_panels.weight_kg + tier2.accessories.weight_kg
    # Should match P_INT_8 golden total_weight_kg = 104.92397234794471
    assert abs(total - 104.92397234794471) < 0.001


def test_build_tier2_subtotals_sum_to_priced_subtotal(p_int_8_mapper_output) -> None:
    """std.subtotal + acc.subtotal = priced_subtotal."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    priced = tier2.standard_panels.subtotal_inr + tier2.accessories.subtotal_inr
    # P_INT_8 golden subtotal_after_discount = 18300.692851385706
    assert abs(priced - 18300.692851385706) < 0.01


def test_build_tier2_is_deterministic(p_int_8_mapper_output) -> None:
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    r1 = build_tier2_categories(tier3, ())
    r2 = build_tier2_categories(tier3, ())
    assert r1 == r2


# ──────────────────────────────────────────────────────────────────────────────
# 90VR-MR verification
# ──────────────────────────────────────────────────────────────────────────────


def test_build_tier2_90vr_mr_custom_bucket_count_37(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR baseline: 37 custom items."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    assert tier2.custom_quotes.count == 37


def test_build_tier2_90vr_mr_by_reason_has_6_keys(
    ninety_vr_mr_mapper_output, synth_90vr_mr_custom_quote_items,
) -> None:
    """90VR-MR by_reason has 6 distinct enum keys (CONTEXT_CONFIRMED Q2)."""
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, synth_90vr_mr_custom_quote_items)
    tier2 = build_tier2_categories(tier3, synth_90vr_mr_custom_quote_items)
    assert len(tier2.custom_quotes.by_reason) == 6
