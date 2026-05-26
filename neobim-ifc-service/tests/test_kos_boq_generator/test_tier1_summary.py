"""Tests for ``tier1_summary.build_tier1_project_summary``.

Coverage:

* Money math: discount + tax + grand total (POLICY-DISCOUNT-PRE-TAX)
* Multiplication form matches PR 1 golden (Form D — anti-pattern #37)
* Grand total EXCLUDES custom subtotal (anti-pattern #16)
* Counts from Tier 2 hierarchy (anti-pattern #7)
* 60/40 skin/rib on Tier 2 total (anti-pattern #6)
* Quote number synth + override (anti-pattern #14)
* Quote validity date arithmetic (anti-pattern #12)
* has_unpriced_items derivation (anti-pattern #15)
* project_name from mapper (anti-pattern #19)
* Empty pipeline edge case (anti-pattern #28)
* All-custom edge case
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    BOQContext,
    INR_TOLERANCE_RUPEES,
    build_tier1_project_summary,
    build_tier2_categories,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier5_segments,
    build_tier6_panel_pieces,
)


def _run_pipeline(mapper_output, ctx, customs=(), reviews=()):
    """Helper to run the full T6→T5→T4→T3→T2→T1 pipeline."""
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)
    return build_tier1_project_summary(
        tier6, tier5, tier2, customs, reviews, ctx, mapper_output,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Money math (POLICY-DISCOUNT-PRE-TAX — anti-patterns #1, #6, #16, #17, #18, #37)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_discount_zero_no_change_to_subtotal(p_int_8_mapper_output) -> None:
    """0% discount → subtotal_after_discount == priced_subtotal."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", discount_percent=0.0)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    expected_priced = (
        tier1.standard_panels_subtotal_inr + tier1.accessories_subtotal_inr
    )
    assert tier1.subtotal_after_discount_inr == expected_priced
    assert tier1.discount_inr == 0.0


def test_tier1_discount_ten_percent_correct(p_int_8_mapper_output) -> None:
    """10% discount → discount_inr = priced * 0.10."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", discount_percent=10.0)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    priced = tier1.standard_panels_subtotal_inr + tier1.accessories_subtotal_inr
    expected_discount = priced * (10.0 / 100)
    assert abs(tier1.discount_inr - expected_discount) < INR_TOLERANCE_RUPEES
    assert tier1.subtotal_after_discount_inr == priced - tier1.discount_inr


def test_tier1_discount_one_hundred_percent_zero_subtotal(p_int_8_mapper_output) -> None:
    """100% discount → subtotal_after_discount = 0 → tax = 0 → grand = 0."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", discount_percent=100.0)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.subtotal_after_discount_inr == 0.0
    assert tier1.tax_inr == 0.0
    assert tier1.grand_total_inr == 0.0


def test_tier1_tax_zero_no_increase(p_int_8_mapper_output) -> None:
    """0% tax → grand_total == subtotal_after_discount."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", tax_rate_percent=0.0)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.tax_inr == 0.0
    assert tier1.grand_total_inr == tier1.subtotal_after_discount_inr


def test_tier1_tax_eighteen_percent_correct(p_int_8_mapper_output) -> None:
    """18% tax (default) → tax = sad * 0.18."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", tax_rate_percent=18.0)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    expected_tax = tier1.subtotal_after_discount_inr * (18.0 / 100)
    assert tier1.tax_inr == expected_tax


def test_tier1_discount_before_tax_order_verified(p_int_8_mapper_output) -> None:
    """POLICY-DISCOUNT-PRE-TAX: 10% discount + 18% tax on $100 input.

    Expected: discount=10 → sad=90 → tax=16.2 → grand=106.2 (NOT 108-10=98).
    """
    # Use a context with discount + tax both non-zero to verify order
    ctx = BOQContext(
        project_id="X", quote_date="2026-05-25",
        discount_percent=10.0, tax_rate_percent=18.0,
    )
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    priced = tier1.standard_panels_subtotal_inr + tier1.accessories_subtotal_inr
    # If tax was on PRE-discount: tax = priced * 0.18 = 3294.12 (golden value)
    # If tax is on POST-discount (correct): tax = priced * 0.9 * 0.18
    expected_sad = priced * 0.9
    expected_tax = expected_sad * 0.18
    assert abs(tier1.tax_inr - expected_tax) < INR_TOLERANCE_RUPEES


def test_tier1_grand_total_excludes_custom_subtotal(
    p_int_8_mapper_output, make_synth_custom_quote_item,
) -> None:
    """Anti-pattern #16: grand_total includes ONLY std+acc, NOT custom items."""
    # Inject 5 custom items — grand_total should NOT change
    customs = tuple(
        make_synth_custom_quote_item(
            wall_id=f"P_C_{i}", reason="thickness_unknown",
            estimated_weight_kg=100.0,
        )
        for i in range(5)
    )
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1_no_customs = _run_pipeline(p_int_8_mapper_output, ctx, customs=())
    tier1_with_customs = _run_pipeline(p_int_8_mapper_output, ctx, customs=customs)

    # grand_total identical: custom items don't price into grand
    assert tier1_with_customs.grand_total_inr == tier1_no_customs.grand_total_inr


def test_tier1_multiplication_form_matches_pr1_golden(p_int_8_mapper_output) -> None:
    """Anti-pattern #37: Form D (parenthesized) matches PR 1 golden.

    Pre-flight A proved Form A (left-to-right) FAILS by 1 ULP. PR 3 must
    use Form D: ``sad * (tax_rate / 100)``.
    """
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    # Golden value for P_INT_8 tax_inr is 3294.124713249427
    assert tier1.tax_inr == 3294.124713249427


# ──────────────────────────────────────────────────────────────────────────────
# Counts from Tier 2 hierarchy (anti-pattern #7)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_total_standard_panels_from_tier2(p_int_8_mapper_output) -> None:
    """P_INT_8: 5 AP panels."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_standard_panels == 5


def test_tier1_total_accessory_pieces_from_tier2(p_int_8_mapper_output) -> None:
    """P_INT_8: 4 accessories (BT+TC+CTC+ECM)."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_accessory_pieces == 4


def test_tier1_total_custom_quote_items_from_input(
    p_int_8_mapper_output, make_synth_custom_quote_item,
) -> None:
    """total_custom_quote_items = len(custom_quote_items)."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    customs = tuple(
        make_synth_custom_quote_item(wall_id=f"P_{i}", reason="thickness_unknown")
        for i in range(7)
    )
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx, customs=customs)
    assert tier1.total_custom_quote_items == 7


def test_tier1_total_openings_from_tier5_sum(p_int_8_mapper_output) -> None:
    """P_INT_8 has 0 openings → tier1.total_openings_in_walls = 0."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_openings_in_walls == 0


def test_tier1_total_orphans_only_orphan_review_type(
    p_int_8_mapper_output, make_synth_operator_review_item,
) -> None:
    """Only review_type='orphan_opening' counts toward total_orphan_openings."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    reviews = (
        make_synth_operator_review_item("orphan_opening"),
        make_synth_operator_review_item("orphan_opening"),
        make_synth_operator_review_item("low_confidence_opening"),  # NOT orphan
        make_synth_operator_review_item("ambiguous_thickness"),     # NOT orphan
    )
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx, reviews=reviews)
    assert tier1.total_orphan_openings == 2


def test_tier1_total_curve_segments_when_zero_curves(p_int_8_mapper_output) -> None:
    """P_INT_8 has 0 is_curved segments → total_curve_segments = 0."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_curve_segments == 0


# ──────────────────────────────────────────────────────────────────────────────
# Weights — 60/40 skin/rib (anti-pattern #6)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_total_weight_kg_from_tier2_sum(p_int_8_mapper_output) -> None:
    """Total weight = std.weight + acc.weight."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    # P_INT_8 golden: 104.92397234794471
    assert abs(tier1.total_weight_kg - 104.92397234794471) < 0.001


def test_tier1_skin_60_percent(p_int_8_mapper_output) -> None:
    """Skin = total * 0.60."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_weight_kg_skin == tier1.total_weight_kg * 0.60


def test_tier1_rib_40_percent(p_int_8_mapper_output) -> None:
    """Rib = total * 0.40."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.total_weight_kg_rib == tier1.total_weight_kg * 0.40


# ──────────────────────────────────────────────────────────────────────────────
# Quote metadata (anti-patterns #12, #13, #14)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_quote_number_synth_when_context_quote_number_none(
    p_int_8_mapper_output,
) -> None:
    """When ctx.quote_number is None, synthesize from project_id + date."""
    ctx = BOQContext(
        project_id="P_INT_8_TEST", quote_date="2026-05-25", quote_number=None,
    )
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_number == "Q-P_INT_8_TEST-001-20260525"


def test_tier1_quote_number_uses_context_quote_number_when_set(
    p_int_8_mapper_output,
) -> None:
    """When ctx.quote_number is set, use it verbatim (no synth)."""
    ctx = BOQContext(
        project_id="X", quote_date="2026-05-25",
        quote_number="MY-CUSTOM-QUOTE-001",
    )
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_number == "MY-CUSTOM-QUOTE-001"


def test_tier1_quote_validity_until_30_days_after_quote_date(
    p_int_8_mapper_output,
) -> None:
    """Default 30 days: May 25 + 30 = June 24."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", quote_validity_days=30)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_validity_until == "2026-06-24"


def test_tier1_quote_validity_handles_leap_year_feb_28(p_int_8_mapper_output) -> None:
    """2024 leap year: Feb 28 + 1 = Feb 29."""
    ctx = BOQContext(project_id="X", quote_date="2024-02-28", quote_validity_days=1)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_validity_until == "2024-02-29"


def test_tier1_quote_validity_handles_non_leap_year_feb_28(p_int_8_mapper_output) -> None:
    """2025 non-leap: Feb 28 + 1 = Mar 1."""
    ctx = BOQContext(project_id="X", quote_date="2025-02-28", quote_validity_days=1)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_validity_until == "2025-03-01"


def test_tier1_quote_validity_handles_month_rollover(p_int_8_mapper_output) -> None:
    """Jan 31 + 30 (non-leap) = Mar 2."""
    ctx = BOQContext(project_id="X", quote_date="2025-01-31", quote_validity_days=30)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_validity_until == "2025-03-02"


def test_tier1_quote_validity_handles_year_rollover(p_int_8_mapper_output) -> None:
    """Dec 15 + 30 → Jan 14 of next year."""
    ctx = BOQContext(project_id="X", quote_date="2026-12-15", quote_validity_days=30)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.quote_validity_until == "2027-01-14"


# ──────────────────────────────────────────────────────────────────────────────
# Flags (anti-pattern #15)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_has_unpriced_items_true_when_customs_present(
    p_int_8_mapper_output, make_synth_custom_quote_item,
) -> None:
    """has_unpriced_items = (len(custom_quote_items) > 0)."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    customs = (make_synth_custom_quote_item(
        wall_id="P_C", reason="thickness_unknown"),)
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx, customs=customs)
    assert tier1.has_unpriced_items is True


def test_tier1_has_unpriced_items_false_when_zero_customs(
    p_int_8_mapper_output,
) -> None:
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.has_unpriced_items is False


# ──────────────────────────────────────────────────────────────────────────────
# Format
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_grand_total_inr_formatted_indian_comma(p_int_8_mapper_output) -> None:
    """P_INT_8 grand_total formatted = '₹21,594.82'."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    assert tier1.grand_total_inr_formatted == "₹21,594.82"


# ──────────────────────────────────────────────────────────────────────────────
# Project name (anti-pattern #19)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_project_name_from_mapper_output(p_int_8_mapper_output) -> None:
    """project_name from mapper_output, NOT context.project_id (anti-pattern #19)."""
    ctx = BOQContext(project_id="DIFFERENT_ID_TO_PROVE_SOURCE", quote_date="2026-05-25")
    tier1 = _run_pipeline(p_int_8_mapper_output, ctx)
    # Mapper P_INT_8 fixture has project_name = "VAMSHI RESIDENCE"
    assert tier1.project_name == "VAMSHI RESIDENCE"
    assert tier1.project_name != ctx.project_id


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases (anti-pattern #28)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier1_empty_pipeline_returns_zero_totals_typed_float(
    empty_mapper_output,
) -> None:
    """Empty mapper → all zeros (typed float for INR/weight fields)."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = _run_pipeline(empty_mapper_output, ctx)
    assert tier1.total_standard_panels == 0
    assert tier1.total_accessory_pieces == 0
    assert tier1.total_custom_quote_items == 0
    assert tier1.grand_total_inr == 0.0
    assert tier1.tax_inr == 0.0
    assert tier1.discount_inr == 0.0
    assert tier1.total_weight_kg == 0.0
    # Type sanity
    assert isinstance(tier1.standard_panels_subtotal_inr, float)
    assert isinstance(tier1.accessories_subtotal_inr, float)


def test_tier1_all_custom_project_zero_priced_subtotal_has_unpriced_items(
    empty_mapper_output, make_synth_custom_quote_item,
) -> None:
    """All-custom project: 0 priced + customs → grand=0, has_unpriced_items=True."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    customs = (make_synth_custom_quote_item(
        wall_id="P_C", reason="thickness_unknown"),)
    tier1 = _run_pipeline(empty_mapper_output, ctx, customs=customs)
    assert tier1.grand_total_inr == 0.0
    assert tier1.has_unpriced_items is True
    assert tier1.total_custom_quote_items == 1
