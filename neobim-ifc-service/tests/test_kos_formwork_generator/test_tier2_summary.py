"""PR 3: tests for build_tier2_summary.

Covers:
* Public-API contract (import, signature, return type).
* P_INT_8 golden byte-equality.
* Bucket-assignment derivation (PR 1 golden math: primary=14=5+9, secondary=10=5+5).
* Count = SUM OF QUANTITIES (not entry count).
* linear_meters: rounded to 5 decimals.
* custom_quotes bucket — empty case, populated case, literal note string.
* Unknown component_type invariant (F-T2-UNKNOWN-COMPONENT-TYPE).
* Unknown unit invariant (F-T2-UNKNOWN-UNIT).
* Determinism.
* BRACING_PRIMARY / BRACING_SECONDARY sets are disjoint and complete vs FRB.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_tier2_summary,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2FormworkCategories,
    BRACING_PRIMARY_COMPONENT_TYPES,
    BRACING_SECONDARY_COMPONENT_TYPES,
    Tier6FormworkComponent,
    FormworkCustomQuoteRequest,
)
from app.services.kos_formwork_generator.exceptions import FormworkInvariantError


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API CONTRACT
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    def test_importable(self):
        from app.services.kos_formwork_generator import build_tier2_summary  # noqa: F401

    def test_returns_categories(self, p_int_8_tier_6):
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6)
        assert isinstance(result, Tier2FormworkCategories)

    def test_three_buckets(self, p_int_8_tier_6):
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6)
        assert isinstance(result.bracing_primary, Tier2Bucket)
        assert isinstance(result.bracing_secondary, Tier2Bucket)
        assert isinstance(result.custom_quotes, Tier2BucketCustom)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 GOLDEN BYTE-EQUAL
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8GoldenByteEqual:
    def test_tier_2_matches_golden_exactly(
        self, p_int_8_tier_6, p_int_8_formwork_golden
    ):
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        assert dataclasses.asdict(result) == p_int_8_formwork_golden["tier_2_categories"]

    def test_primary_count_14(self, p_int_8_tier_6):
        """Golden P_INT_8 bracing_primary.count = 14 (5 props + 9 kickers)."""
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        assert result.bracing_primary.count == 14

    def test_secondary_count_10(self, p_int_8_tier_6):
        """Golden P_INT_8 bracing_secondary.count = 10 (5 base_plates + 5 prop_heads)."""
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        assert result.bracing_secondary.count == 10

    def test_secondary_linear_meters_track(self, p_int_8_tier_6):
        """Golden P_INT_8 bracing_secondary.linear_meters = starter_track length."""
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        # Golden value asserted via byte-equal test; here we sanity-check positivity.
        assert result.bracing_secondary.linear_meters > 0.0


# ═════════════════════════════════════════════════════════════════════
# BUCKET-ASSIGNMENT SETS
# ═════════════════════════════════════════════════════════════════════


class TestBucketAssignment:
    def test_primary_set_is_frozenset(self):
        assert isinstance(BRACING_PRIMARY_COMPONENT_TYPES, frozenset)

    def test_secondary_set_is_frozenset(self):
        assert isinstance(BRACING_SECONDARY_COMPONENT_TYPES, frozenset)

    def test_sets_disjoint(self):
        assert BRACING_PRIMARY_COMPONENT_TYPES.isdisjoint(BRACING_SECONDARY_COMPONENT_TYPES)

    def test_primary_contains_prop(self):
        assert "prop" in BRACING_PRIMARY_COMPONENT_TYPES

    def test_primary_contains_kicker(self):
        assert "kicker" in BRACING_PRIMARY_COMPONENT_TYPES

    def test_primary_contains_waler(self):
        assert "waler" in BRACING_PRIMARY_COMPONENT_TYPES

    def test_primary_contains_diagonal_brace(self):
        assert "diagonal_brace" in BRACING_PRIMARY_COMPONENT_TYPES

    def test_primary_contains_raker_prop(self):
        assert "raker_prop" in BRACING_PRIMARY_COMPONENT_TYPES

    def test_secondary_contains_base_plate(self):
        assert "base_plate" in BRACING_SECONDARY_COMPONENT_TYPES

    def test_secondary_contains_prop_head(self):
        assert "prop_head" in BRACING_SECONDARY_COMPONENT_TYPES

    def test_secondary_contains_corner_clamp(self):
        assert "corner_clamp" in BRACING_SECONDARY_COMPONENT_TYPES

    def test_secondary_contains_joint_gasket(self):
        assert "joint_gasket" in BRACING_SECONDARY_COMPONENT_TYPES

    def test_secondary_contains_starter_track(self):
        assert "starter_track" in BRACING_SECONDARY_COMPONENT_TYPES


# ═════════════════════════════════════════════════════════════════════
# COUNT-IS-SUM-OF-QUANTITIES
# ═════════════════════════════════════════════════════════════════════


class TestCountSemantics:
    def test_count_sums_integer_quantities_not_entries(self, p_int_8_tier_6):
        """Two entries each with quantity=3 → count=6, not count=2."""
        tier_6 = (
            _mk_comp("PROP-A", "prop", 3, "nos"),
            _mk_comp("PROP-B", "prop", 3, "nos"),
        )
        result = build_tier2_summary(tier_6, custom_quote_items=())
        assert result.bracing_primary.count == 6

    def test_linear_m_summed_then_rounded(self):
        tier_6 = (
            _mk_comp("ST-A", "starter_track", 1.111111, "linear_m"),
            _mk_comp("ST-B", "starter_track", 2.222222, "linear_m"),
        )
        result = build_tier2_summary(tier_6)
        assert result.bracing_secondary.linear_meters == round(1.111111 + 2.222222, 5)
        # No 'nos' entries → count is 0.
        assert result.bracing_secondary.count == 0

    def test_primary_quantity_cast_to_int(self):
        tier_6 = (_mk_comp("PROP-A", "prop", 5.999, "nos"),)
        result = build_tier2_summary(tier_6)
        assert result.bracing_primary.count == 5
        assert isinstance(result.bracing_primary.count, int)


# ═════════════════════════════════════════════════════════════════════
# CUSTOM QUOTES BUCKET
# ═════════════════════════════════════════════════════════════════════


class TestCustomQuotesBucket:
    def test_empty_custom_quote_items(self, p_int_8_tier_6):
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        assert result.custom_quotes.count == 0
        assert result.custom_quotes.pending_count == 0

    def test_note_string_literal_matches_golden(
        self, p_int_8_tier_6, p_int_8_formwork_golden
    ):
        tier_6, _ = p_int_8_tier_6
        result = build_tier2_summary(tier_6, custom_quote_items=())
        golden_note = p_int_8_formwork_golden["tier_2_categories"]["custom_quotes"]["note"]
        assert result.custom_quotes.note == golden_note

    def test_count_equals_len(self, p_int_8_tier_6):
        tier_6, _ = p_int_8_tier_6
        items = (_mk_custom_quote("W1"), _mk_custom_quote("W2"))
        result = build_tier2_summary(tier_6, custom_quote_items=items)
        assert result.custom_quotes.count == 2
        assert result.custom_quotes.pending_count == 2


# ═════════════════════════════════════════════════════════════════════
# INVARIANTS
# ═════════════════════════════════════════════════════════════════════


class TestInvariants:
    def test_unknown_component_type_raises(
        self, synthetic_invalid_component_type_tier_6
    ):
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier2_summary(synthetic_invalid_component_type_tier_6)
        assert exc_info.value.invariant_id == "F-T2-UNKNOWN-COMPONENT-TYPE"

    def test_invariant_error_mentions_offending_type(
        self, synthetic_invalid_component_type_tier_6
    ):
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier2_summary(synthetic_invalid_component_type_tier_6)
        assert "alien_widget" in str(exc_info.value)

    def test_unknown_unit_raises(self):
        tier_6 = (_mk_comp("X-A", "prop", 1, "kg"),)
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier2_summary(tier_6)
        assert exc_info.value.invariant_id == "F-T2-UNKNOWN-UNIT"


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestDeterminism:
    def test_repeat_calls_produce_identical_output(self, p_int_8_tier_6):
        tier_6, _ = p_int_8_tier_6
        a = build_tier2_summary(tier_6, custom_quote_items=())
        b = build_tier2_summary(tier_6, custom_quote_items=())
        assert a == b

    def test_empty_tier_6_zero_buckets(self):
        result = build_tier2_summary((), custom_quote_items=())
        assert result.bracing_primary.count == 0
        assert result.bracing_primary.linear_meters == 0.0
        assert result.bracing_secondary.count == 0
        assert result.bracing_secondary.linear_meters == 0.0
        assert result.custom_quotes.count == 0


# ═════════════════════════════════════════════════════════════════════
# HELPER
# ═════════════════════════════════════════════════════════════════════


def _mk_comp(
    component_id: str, component_type: str, qty, unit: str
) -> Tier6FormworkComponent:
    """Minimal Tier 6 component for unit-test scaffolding."""
    return Tier6FormworkComponent(
        component_id=component_id,
        wall_segment_id="TEST_WALL",
        component_type=component_type,
        sku_code=component_id,
        quantity=qty,
        unit=unit,
        source_rule="TEST",
    )


def _mk_custom_quote(wall_id: str) -> FormworkCustomQuoteRequest:
    """Minimal FormworkCustomQuoteRequest for unit-test scaffolding."""
    return FormworkCustomQuoteRequest(
        wall_id=wall_id,
        reason="inherited_custom_thickness",
        reason_detail="180mm thick custom",
        system="custom",
        thickness_mm=180,
        length_mm=1000.0,
        height_mm=3000.0,
        application="interior",
        seismic_zone="III",
        estimated_bracing_complexity="medium",
        estimated_prop_count=4,
    )
