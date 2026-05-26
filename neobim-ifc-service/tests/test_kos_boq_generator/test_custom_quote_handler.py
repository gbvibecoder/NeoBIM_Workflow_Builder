"""Tests for ``custom_quote_handler``.

Coverage:
* Classifier on all 10 CustomQuoteReason enum values + edge cases
* Weight estimator at catalog boundaries + ±10% tolerance
* Builder integration tests (P_INT_8 empty, 90VR-MR distribution)
* 90VR-MR by-reason distribution exactly matches CONTEXT_CONFIRMED {11,11,4,6,3,2}
"""

from __future__ import annotations

from collections import Counter

import pytest

from app.services.kos_boq_generator import (
    CustomQuoteLineItem,
    build_custom_quote_items,
)
from app.services.kos_boq_generator.custom_quote_handler import (
    _compute_area_or_none,
    _estimate_weight_kg,
    _nearest_catalog_kg_per_sft,
    classify_reason,
)


# ──────────────────────────────────────────────────────────────────────────────
# Classifier tests — 10 enum values
# ──────────────────────────────────────────────────────────────────────────────


def test_classify_reason_k6_180_returns_system_180_not_stocked() -> None:
    assert classify_reason("K6-180 is in Rulebook §4.1 but NOT in Karthik's standard ...") == "system_180_not_stocked"


def test_classify_reason_k8_250_returns_system_250_custom_on_request() -> None:
    assert classify_reason("K8-250 is custom-on-request per Karthik 2026-05-22 ...") == "system_250_custom_on_request"


def test_classify_reason_thickness_zero_returns_thickness_unknown() -> None:
    """thickness=0.0mm → thickness_unknown (11 of 37 on 90VR-MR)."""
    assert classify_reason("system=CUSTOM, thickness=0.0mm not in Karthik's standard catalog") == "thickness_unknown"


def test_classify_reason_thickness_below_100_returns_thickness_below_minimum() -> None:
    """thickness < 100mm → thickness_below_minimum (11 of 37 on 90VR-MR)."""
    assert classify_reason("system=CUSTOM, thickness=74.09mm not in Karthik's standard ...") == "thickness_below_minimum"
    assert classify_reason("system=CUSTOM, thickness=50.81mm not in Karthik's standard ...") == "thickness_below_minimum"
    assert classify_reason("system=CUSTOM, thickness=99.9mm not in Karthik's standard ...") == "thickness_below_minimum"


def test_classify_reason_thickness_between_bands_120_to_144() -> None:
    """thickness in [120, 144] → thickness_between_bands."""
    assert classify_reason("system=CUSTOM, thickness=137.53mm not in Karthik's standard ...") == "thickness_between_bands"
    assert classify_reason("system=CUSTOM, thickness=143.93mm not in Karthik's standard ...") == "thickness_between_bands"


def test_classify_reason_thickness_between_bands_160_to_169() -> None:
    """thickness in [160, 169] → thickness_between_bands."""
    assert classify_reason("system=CUSTOM, thickness=165.0mm not in Karthik's standard ...") == "thickness_between_bands"


def test_classify_reason_thickness_220_plus_returns_thickness_exceeds_catalog() -> None:
    """thickness ≥ 220mm → thickness_exceeds_catalog (6 of 37 on 90VR-MR)."""
    assert classify_reason("system=CUSTOM, thickness=300.57mm not in Karthik's standard ...") == "thickness_exceeds_catalog"
    assert classify_reason("system=CUSTOM, thickness=448.73mm not in Karthik's standard ...") == "thickness_exceeds_catalog"
    assert classify_reason("system=CUSTOM, thickness=452.97mm not in Karthik's standard ...") == "thickness_exceeds_catalog"


def test_classify_reason_curve_keyword_returns_curved_wall_custom_panels() -> None:
    """RESERVED enum: 'curved' keyword triggers curve detection."""
    assert classify_reason("CUSTOM: curved wall needs custom panels") == "curved_wall_custom_panels"


def test_classify_reason_tight_curve_returns_tight_curve_below_min_radius() -> None:
    """RESERVED enum: 'tight curve' / 'min radius' triggers tight detection."""
    assert classify_reason("CUSTOM: tight curve detected, radius below 600mm") == "tight_curve_below_min_radius"


def test_classify_reason_orphan_returns_orphan_opening_reference() -> None:
    """RESERVED enum."""
    assert classify_reason("CUSTOM: orphan opening — no parent wall in segments") == "orphan_opening_reference"


def test_classify_reason_empty_string_returns_other_custom() -> None:
    """Empty input → other_custom fallback."""
    assert classify_reason("") == "other_custom"


def test_classify_reason_unknown_string_returns_other_custom() -> None:
    """No pattern match → other_custom fallback."""
    assert classify_reason("Some completely unrelated message that doesn't match any rule") == "other_custom"


def test_classify_reason_case_insensitive() -> None:
    """Anti-pattern #40: case-insensitive matching."""
    assert classify_reason("k6-180") == "system_180_not_stocked"
    assert classify_reason("K6-180") == "system_180_not_stocked"
    assert classify_reason("k6-180 lowercase test") == "system_180_not_stocked"


def test_classify_reason_whitespace_tolerant() -> None:
    """Leading/trailing whitespace stripped."""
    assert classify_reason("   K6-180 with spaces   ") == "system_180_not_stocked"


def test_classify_reason_priority_k8_250_before_thickness_check() -> None:
    """System rule fires before thickness rule (K8-250 contains 'thickness' too)."""
    s = "K8-250 selected; thickness=250.0mm not in catalog"
    assert classify_reason(s) == "system_250_custom_on_request"


# ──────────────────────────────────────────────────────────────────────────────
# Weight estimator tests
# ──────────────────────────────────────────────────────────────────────────────


def test_nearest_catalog_exactly_at_110() -> None:
    """Exact catalog thickness → that catalog's kg/sft."""
    assert _nearest_catalog_kg_per_sft(110.0) == 1.29


def test_nearest_catalog_exactly_at_155() -> None:
    assert _nearest_catalog_kg_per_sft(155.0) == 1.46


def test_nearest_catalog_exactly_at_200() -> None:
    assert _nearest_catalog_kg_per_sft(200.0) == 1.63


def test_nearest_catalog_within_10_percent_of_155_picks_155() -> None:
    """149mm is within 10% of 155 (149/155 = 96.13%; deviation 3.87%)."""
    assert _nearest_catalog_kg_per_sft(149.0) == 1.46


def test_nearest_catalog_within_10_percent_of_110_picks_110() -> None:
    """105mm within 10% of 110 (deviation 4.5%)."""
    assert _nearest_catalog_kg_per_sft(105.0) == 1.29


def test_nearest_catalog_outside_10_percent_returns_none() -> None:
    """50mm is far outside ±10% of any catalog (110, 155, 200)."""
    assert _nearest_catalog_kg_per_sft(50.0) is None


def test_nearest_catalog_outside_above_returns_none() -> None:
    """225mm is 12.5% above 200, just outside ±10%."""
    assert _nearest_catalog_kg_per_sft(225.0) is None


def test_nearest_catalog_zero_thickness_returns_none() -> None:
    assert _nearest_catalog_kg_per_sft(0.0) is None


def test_nearest_catalog_none_thickness_returns_none() -> None:
    assert _nearest_catalog_kg_per_sft(None) is None


def test_nearest_catalog_negative_thickness_returns_none() -> None:
    assert _nearest_catalog_kg_per_sft(-50.0) is None


def test_estimate_weight_known_thickness_area_returns_product() -> None:
    """estimated_weight = area × kg_per_sft."""
    # 110mm, area=10 sqft → 10 * 1.29 = 12.9 kg
    assert _estimate_weight_kg(110.0, 10.0) == pytest.approx(12.9)


def test_estimate_weight_unknown_thickness_returns_none() -> None:
    assert _estimate_weight_kg(50.0, 10.0) is None


def test_estimate_weight_none_area_returns_none() -> None:
    assert _estimate_weight_kg(110.0, None) is None


# ──────────────────────────────────────────────────────────────────────────────
# Area computation
# ──────────────────────────────────────────────────────────────────────────────


def test_compute_area_correct_for_known_values() -> None:
    """area = L × H / MM2_PER_SFT. Mapper test: 2998 × 300 / 92903.04 = 9.681..."""
    assert _compute_area_or_none(2998.0, 300) == pytest.approx(9.68106102879)


def test_compute_area_zero_or_none_returns_none() -> None:
    assert _compute_area_or_none(0.0, 100) is None
    assert _compute_area_or_none(100.0, 0) is None
    assert _compute_area_or_none(None, 100) is None
    assert _compute_area_or_none(100.0, None) is None
    assert _compute_area_or_none(-50.0, 100) is None


# ──────────────────────────────────────────────────────────────────────────────
# build_custom_quote_items — integration
# ──────────────────────────────────────────────────────────────────────────────


def test_build_p_int_8_returns_empty(p_int_8_mapper_output) -> None:
    """P_INT_8 has zero custom_quote_requests."""
    assert build_custom_quote_items(p_int_8_mapper_output) == ()


def test_build_90vr_returns_37_items(ninety_vr_mr_mapper_output) -> None:
    """90VR-MR has exactly 37 custom_quote_requests."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    assert len(items) == 37


def test_build_90vr_distribution_matches_canonical(
    ninety_vr_mr_mapper_output,
) -> None:
    """🚨 CRITICAL: 90VR-MR distribution must match CONTEXT_CONFIRMED Q2:
       {11, 11, 4, 6, 3, 2} = 37 across 6 reason buckets."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    counts = Counter(item.reason for item in items)
    expected = {
        "thickness_unknown": 11,
        "thickness_below_minimum": 11,
        "thickness_between_bands": 4,
        "thickness_exceeds_catalog": 6,
        "system_180_not_stocked": 3,
        "system_250_custom_on_request": 2,
    }
    assert dict(counts) == expected


def test_build_90vr_all_items_have_valid_enum_reason(ninety_vr_mr_mapper_output) -> None:
    """No 'other_custom' fallthroughs on 90VR-MR."""
    import typing
    from app.services.kos_boq_generator import CustomQuoteReason
    valid = set(typing.get_args(CustomQuoteReason))

    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert item.reason in valid


def test_build_preserves_reason_detail(ninety_vr_mr_mapper_output) -> None:
    """reason_detail is verbatim mapper string (anti-pattern #43)."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    mapper_reasons = {req.reason for req in ninety_vr_mr_mapper_output.custom_quote_requests}
    item_details = {item.reason_detail for item in items}
    assert mapper_reasons == item_details


def test_build_wall_id_from_wall_segment_id(ninety_vr_mr_mapper_output) -> None:
    """mapper.wall_segment_id → BOQ.wall_id (rename)."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    item_wall_ids = {item.wall_id for item in items}
    mapper_wall_segment_ids = {req.wall_segment_id for req in ninety_vr_mr_mapper_output.custom_quote_requests}
    assert item_wall_ids == mapper_wall_segment_ids


def test_build_subtotal_inr_always_tbd(ninety_vr_mr_mapper_output) -> None:
    """anti-pattern #21 carry: subtotal_inr is always literal 'TBD'."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert item.subtotal_inr == "TBD"


def test_build_quote_status_pending_sales_review(ninety_vr_mr_mapper_output) -> None:
    """v1 always emits 'pending_sales_review'."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert item.quote_status == "pending_sales_review"


def test_build_is_deterministic(ninety_vr_mr_mapper_output) -> None:
    """Two calls produce identical tuples."""
    a = build_custom_quote_items(ninety_vr_mr_mapper_output)
    b = build_custom_quote_items(ninety_vr_mr_mapper_output)
    assert a == b


def test_build_sorted_by_wall_id(ninety_vr_mr_mapper_output) -> None:
    """Items sorted by wall_id (lexicographic — deterministic)."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    wall_ids = [item.wall_id for item in items]
    assert wall_ids == sorted(wall_ids)


def test_build_thickness_zero_maps_to_none(ninety_vr_mr_mapper_output) -> None:
    """thickness=0.0mm → item.thickness_mm = None."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    # Items with reason="thickness_unknown" come from thickness=0.0 mapper requests
    unknown_items = [i for i in items if i.reason == "thickness_unknown"]
    for item in unknown_items:
        assert item.thickness_mm is None


def test_build_area_sqft_computed_for_all_90vr_items(ninety_vr_mr_mapper_output) -> None:
    """All 37 items have non-None area_sqft (since L+H always present in mapper)."""
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    for item in items:
        assert item.area_sqft is not None
        assert item.area_sqft > 0


def test_build_returns_tuple_of_custom_quote_line_item(ninety_vr_mr_mapper_output) -> None:
    items = build_custom_quote_items(ninety_vr_mr_mapper_output)
    assert isinstance(items, tuple)
    for item in items:
        assert isinstance(item, CustomQuoteLineItem)
