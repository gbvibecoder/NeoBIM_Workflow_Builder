"""Cross-tier reconciliation invariant previews (anti-pattern #18).

7 reconciliation checks × 2 fixtures (P_INT_8 + 90VR-MR) = 14 test runs.

These checks preview the reconciliation invariants that PR 4's output_validator
will formalize as B-1..B-23. Running them at fixture level catches algorithm
drift early — before PR 4's validator exists.

90VR-MR tests skip cleanly if the PDF is missing (environmental, not a bug).
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    AREA_TOLERANCE_SQFT,
    INR_TOLERANCE_RUPEES,
    KG_TOLERANCE,
    build_tier4_sku_details,
    build_tier5_segments,
    build_tier6_panel_pieces,
)


# Both fixtures use the same parametrize ID, making it easy to spot which
# fixture failed in test output.
_FIXTURES = ["p_int_8_mapper_output", "ninety_vr_mr_mapper_output"]


# ──────────────────────────────────────────────────────────────────────────────
# Tier 6 / Tier 4 reconciliation (preview of B-21, B-22)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier6_count_per_sku_equals_tier4_quantity(fixture_name, request) -> None:
    """For each SKU: count of Tier 6 panels == Tier 4 quantity."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    for row in tier4:
        count = sum(1 for p in tier6 if p.sku_code == row.sku_code)
        assert count == row.quantity, (
            f"SKU {row.sku_code}: Tier6 count={count}, Tier4 quantity={row.quantity}"
        )


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier6_sum_price_equals_tier4_line_total_price(fixture_name, request) -> None:
    """For each SKU: Σ Tier 6 prices ≈ Tier 4 line_total_price (B-22 preview)."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    for row in tier4:
        sum_price = sum(p.price_inr for p in tier6 if p.sku_code == row.sku_code)
        assert abs(sum_price - row.line_total_price_inr) < INR_TOLERANCE_RUPEES, (
            f"SKU {row.sku_code}: Σ Tier6 price={sum_price}, "
            f"Tier4 line_total={row.line_total_price_inr}"
        )


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier6_sum_weight_equals_tier4_line_total_weight(fixture_name, request) -> None:
    """For each SKU: Σ Tier 6 weights ≈ Tier 4 line_total_weight."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    for row in tier4:
        sum_weight = sum(p.weight_kg for p in tier6 if p.sku_code == row.sku_code)
        assert abs(sum_weight - row.line_total_weight_kg) < KG_TOLERANCE, (
            f"SKU {row.sku_code}: Σ Tier6 weight={sum_weight}, "
            f"Tier4 line_total={row.line_total_weight_kg}"
        )


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier6_sum_area_equals_tier4_line_total_area(fixture_name, request) -> None:
    """For each SKU: Σ Tier 6 areas ≈ Tier 4 line_total_area."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    for row in tier4:
        sum_area = sum(p.area_sqft for p in tier6 if p.sku_code == row.sku_code)
        assert abs(sum_area - row.line_total_area_sqft) < AREA_TOLERANCE_SQFT, (
            f"SKU {row.sku_code}: Σ Tier6 area={sum_area}, "
            f"Tier4 line_total={row.line_total_area_sqft}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Tier 5 / Tier 6 / Tier 4 reconciliation
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier5_panel_count_sum_equals_tier6_count(fixture_name, request) -> None:
    """Σ Tier 5 panel_count (non-custom) == len(Tier 6) (B-21 preview)."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier5 = build_tier5_segments(mapper_output)
    sum_panels = sum(r.panel_count for r in tier5 if not r.is_custom_order)
    assert sum_panels == len(tier6), (
        f"Σ Tier5 panel_count={sum_panels}, len(Tier6)={len(tier6)}"
    )


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier5_segment_price_sum_equals_tier4_total_price(fixture_name, request) -> None:
    """Σ Tier 5 segment_price_inr (non-custom) ≈ Σ Tier 4 line_total_price (B-22 preview)."""
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier5 = build_tier5_segments(mapper_output)

    sum_tier5_price = sum(r.segment_price_inr for r in tier5 if not r.is_custom_order)
    sum_tier4_price = sum(r.line_total_price_inr for r in tier4)

    # Tolerance: this is a multi-step IEEE-754 sum — 90VR has ~573 additions
    # in different orders between the two summations. Use a generous bound
    # scaled by the total magnitude.
    tolerance = max(INR_TOLERANCE_RUPEES, abs(sum_tier5_price) * 1e-12)
    assert abs(sum_tier5_price - sum_tier4_price) < tolerance, (
        f"Σ Tier5 segment_price={sum_tier5_price}, Σ Tier4 line_total={sum_tier4_price}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Tier 4 line_total = quantity × unit (B-7 preview)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture_name", _FIXTURES)
def test_tier4_line_totals_equal_sum_of_tier6_per_sku(fixture_name, request) -> None:
    """B-7 preview (revised): line_total ≈ Σ per-panel value.

    Anti-pattern #9 in the prompt assumed all panels with the same sku_code
    share dimensions. 90VR-MR live discovery: CTC variants share SKU but
    have variable widths. The correct invariant is per-panel sum, not
    quantity × unit. For consistent-dimension SKUs the two are bit-identical
    in IEEE-754; for variable-width SKUs only sum is correct.

    PR 4's validator B-7 will use this sum-based formulation.
    """
    mapper_output = request.getfixturevalue(fixture_name)
    tier6 = build_tier6_panel_pieces(mapper_output)
    tier4 = build_tier4_sku_details(tier6)

    for row in tier4:
        per_sku = [p for p in tier6 if p.sku_code == row.sku_code]
        sum_area = sum(p.area_sqft for p in per_sku)
        sum_weight = sum(p.weight_kg for p in per_sku)
        sum_price = sum(p.price_inr for p in per_sku)
        assert abs(row.line_total_area_sqft - sum_area) < AREA_TOLERANCE_SQFT, (
            f"{row.sku_code} area: line_total={row.line_total_area_sqft} ≠ Σ={sum_area}"
        )
        assert abs(row.line_total_weight_kg - sum_weight) < KG_TOLERANCE, (
            f"{row.sku_code} weight: line_total={row.line_total_weight_kg} ≠ Σ={sum_weight}"
        )
        assert abs(row.line_total_price_inr - sum_price) < INR_TOLERANCE_RUPEES, (
            f"{row.sku_code} price: line_total={row.line_total_price_inr} ≠ Σ={sum_price}"
        )
