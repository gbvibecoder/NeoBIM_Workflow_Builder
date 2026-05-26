"""Cross-tier reconciliation invariant previews (PR 3 — extends PR 2's 14 runs).

7 NEW reconciliation checks × 2 fixtures (P_INT_8 + 90VR-MR) = 14 test runs.

These checks preview the Tier 3 → Tier 2 → Tier 1 reconciliations PR 4's
output_validator will formalize. Running them at fixture level catches
algorithm drift early.

90VR-MR tests skip cleanly if PDF missing (environmental).
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    BOQContext,
    INR_TOLERANCE_RUPEES,
    KG_TOLERANCE,
    TIER2_ACCESSORY_PREFIXES,
    TIER2_STANDARD_PANEL_PREFIXES,
    build_tier1_project_summary,
    build_tier2_categories,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier5_segments,
    build_tier6_panel_pieces,
)


_FIXTURES_NO_CUSTOMS = ["p_int_8_mapper_output"]
_FIXTURES_WITH_CUSTOMS = ["ninety_vr_mr_mapper_output"]


def _get_customs(fixture_name: str, request) -> tuple:
    """Return appropriate custom items for the fixture."""
    if fixture_name == "p_int_8_mapper_output":
        return ()
    elif fixture_name == "ninety_vr_mr_mapper_output":
        return request.getfixturevalue("synth_90vr_mr_custom_quote_items")
    return ()


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #1: Tier 3 standard prices → Tier 2 standard subtotal
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier3_standard_prices_sum_equals_tier2_standard_subtotal(
    fixture_name, request,
) -> None:
    """Σ Tier 3 (where prefix ∈ STANDARD_PANEL_PREFIXES) price == Tier 2 std subtotal."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)

    tier3_std_sum = sum(
        (r.total_price_inr for r in tier3 if r.sku_prefix in TIER2_STANDARD_PANEL_PREFIXES),
        start=0.0,
    )
    assert abs(tier3_std_sum - tier2.standard_panels.subtotal_inr) < INR_TOLERANCE_RUPEES


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #2: Tier 3 accessory prices → Tier 2 accessories subtotal
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier3_accessory_prices_sum_equals_tier2_accessories_subtotal(
    fixture_name, request,
) -> None:
    """Σ Tier 3 (where prefix ∈ ACCESSORY_PREFIXES) price == Tier 2 acc subtotal."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)

    tier3_acc_sum = sum(
        (r.total_price_inr for r in tier3 if r.sku_prefix in TIER2_ACCESSORY_PREFIXES),
        start=0.0,
    )
    assert abs(tier3_acc_sum - tier2.accessories.subtotal_inr) < INR_TOLERANCE_RUPEES


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #3: Tier 2 std + acc → Tier 1 priced_subtotal
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier2_standard_plus_accessories_equals_priced_subtotal(
    fixture_name, request,
) -> None:
    """Tier 2 std.subtotal + acc.subtotal == Tier 1 (std + acc subtotals) (pre-discount)."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, customs, (), ctx, mapper_output,
    )

    t2_sum = tier2.standard_panels.subtotal_inr + tier2.accessories.subtotal_inr
    t1_sum = tier1.standard_panels_subtotal_inr + tier1.accessories_subtotal_inr
    assert abs(t2_sum - t1_sum) < INR_TOLERANCE_RUPEES


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #4: Tier 3 CUSTOM weight → Tier 2 custom weight
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier3_custom_row_weight_equals_tier2_custom_bucket_weight(
    fixture_name, request,
) -> None:
    """Tier 3 CUSTOM row weight == Tier 2 custom_quotes weight_kg_estimated.

    When no customs, both are 0.0 (no CUSTOM row vs 0-weight bucket).
    """
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)

    # Tier 3 CUSTOM row weight (or 0 if no CUSTOM row exists)
    custom_rows = [r for r in tier3 if r.sku_prefix == "CUSTOM"]
    tier3_custom_weight = custom_rows[0].total_weight_kg if custom_rows else 0.0

    assert abs(tier3_custom_weight - tier2.custom_quotes.weight_kg_estimated) < KG_TOLERANCE


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #5: Tier 1 grand_total = sad + tax
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier1_grand_total_equals_subtotal_plus_tax_minus_discount(
    fixture_name, request,
) -> None:
    """Tier 1 grand_total == subtotal_after_discount + tax_inr (math sanity)."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, customs, (), ctx, mapper_output,
    )

    computed_grand = tier1.subtotal_after_discount_inr + tier1.tax_inr
    assert abs(computed_grand - tier1.grand_total_inr) < INR_TOLERANCE_RUPEES


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #6: Skin + rib = total weight
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier1_weight_split_60_40(fixture_name, request) -> None:
    """Tier 1 skin + rib == total weight (60/40 sum to 100%)."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, customs, (), ctx, mapper_output,
    )

    combined = tier1.total_weight_kg_skin + tier1.total_weight_kg_rib
    assert abs(combined - tier1.total_weight_kg) < KG_TOLERANCE


# ──────────────────────────────────────────────────────────────────────────────
# Reconciliation #7: Tier 1 counts match Tier 2 buckets
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES_NO_CUSTOMS + _FIXTURES_WITH_CUSTOMS)
def test_tier1_counts_match_tier2_buckets(fixture_name, request) -> None:
    """Tier 1 counts derived from Tier 2 buckets (anti-pattern #7)."""
    mapper_output = request.getfixturevalue(fixture_name)
    customs = _get_customs(fixture_name, request)

    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, customs)
    tier2 = build_tier2_categories(tier3, customs)
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, customs, (), ctx, mapper_output,
    )

    assert tier1.total_standard_panels == tier2.standard_panels.count
    assert tier1.total_accessory_pieces == tier2.accessories.count
    assert tier1.total_custom_quote_items == tier2.custom_quotes.count
