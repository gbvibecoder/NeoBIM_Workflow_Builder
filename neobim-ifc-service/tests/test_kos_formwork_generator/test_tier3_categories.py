"""PR 3: tests for build_tier3_categories.

Covers:
* Public-API contract (import, signature, return type).
* P_INT_8 golden byte-equality (Tier 3 = exactly golden["tier_3_sku_types"]).
* First-occurrence ordering (matches Tier 4 input order, not alphabetical).
* Empty-input handling.
* Sum-of-quantities semantics for 'nos' SKUs.
* Sum-of-quantities (rounded to 5 decimals) for 'linear_m' SKUs.
* Per-prefix unit consistency invariant (F-T3-UNIT-CONSISTENT).
* Unknown-unit invariant (F-T3-UNKNOWN-UNIT).
* Determinism — repeat calls produce identical output.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_tier3_categories,
    Tier3SKUType,
    Tier4SKUDetail,
)
from app.services.kos_formwork_generator.exceptions import FormworkInvariantError


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API CONTRACT
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    def test_importable(self):
        from app.services.kos_formwork_generator import build_tier3_categories  # noqa: F401

    def test_returns_tuple(self, p_int_8_tier_4):
        result = build_tier3_categories(p_int_8_tier_4)
        assert isinstance(result, tuple)

    def test_returns_tier3_items(self, p_int_8_tier_4):
        result = build_tier3_categories(p_int_8_tier_4)
        for item in result:
            assert isinstance(item, Tier3SKUType)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 GOLDEN BYTE-EQUALITY
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8GoldenByteEqual:
    def test_tier_3_matches_golden_exactly(
        self, p_int_8_tier_4, p_int_8_formwork_golden
    ):
        """Byte-equal vs golden — same dicts, same order."""
        result = build_tier3_categories(p_int_8_tier_4)
        computed_dicts = [dataclasses.asdict(t) for t in result]
        assert computed_dicts == p_int_8_formwork_golden["tier_3_sku_types"]

    def test_tier_3_length_matches_golden(
        self, p_int_8_tier_4, p_int_8_formwork_golden
    ):
        result = build_tier3_categories(p_int_8_tier_4)
        assert len(result) == len(p_int_8_formwork_golden["tier_3_sku_types"])

    def test_tier_3_prefixes_match_golden(
        self, p_int_8_tier_4, p_int_8_formwork_golden
    ):
        result = build_tier3_categories(p_int_8_tier_4)
        computed_prefixes = [t.sku_prefix for t in result]
        golden_prefixes = [t["sku_prefix"] for t in p_int_8_formwork_golden["tier_3_sku_types"]]
        assert computed_prefixes == golden_prefixes


# ═════════════════════════════════════════════════════════════════════
# ORDERING (first-occurrence per Tier 4 input)
# ═════════════════════════════════════════════════════════════════════


class TestOrdering:
    def test_first_occurrence_preserved(self):
        """If Tier 4 has PROP then KICKER, Tier 3 must emit PROP then KICKER."""
        t4 = (
            _mk_t4("PROP-2M", "PROP", "nos", 5),
            _mk_t4("KICKER-A", "KICKER", "nos", 3),
        )
        result = build_tier3_categories(t4)
        assert [t.sku_prefix for t in result] == ["PROP", "KICKER"]

    def test_reverse_input_reverse_output(self):
        """Reversing Tier 4 input reverses Tier 3 output (not alphabetical)."""
        t4 = (
            _mk_t4("KICKER-A", "KICKER", "nos", 3),
            _mk_t4("PROP-2M", "PROP", "nos", 5),
        )
        result = build_tier3_categories(t4)
        assert [t.sku_prefix for t in result] == ["KICKER", "PROP"]

    def test_same_prefix_first_occurrence_position(self):
        """When same prefix appears at positions 0 and 2, it sits at position 0."""
        t4 = (
            _mk_t4("PROP-2M", "PROP", "nos", 5),
            _mk_t4("WALER-A", "WALER", "nos", 2),
            _mk_t4("PROP-3M", "PROP", "nos", 7),
        )
        result = build_tier3_categories(t4)
        # PROP first (it appeared first), then WALER.
        assert [t.sku_prefix for t in result] == ["PROP", "WALER"]


# ═════════════════════════════════════════════════════════════════════
# SUM SEMANTICS — 'nos' vs 'linear_m'
# ═════════════════════════════════════════════════════════════════════


class TestSumSemantics:
    def test_sum_of_nos_quantities(self):
        """total_count = sum of total_quantity across same-prefix entries."""
        t4 = (
            _mk_t4("PROP-2M", "PROP", "nos", 5),
            _mk_t4("PROP-3M", "PROP", "nos", 7),
        )
        result = build_tier3_categories(t4)
        assert len(result) == 1
        assert result[0].total_count == 12
        assert result[0].total_linear_meters == 0.0

    def test_sum_of_linear_m_quantities(self):
        """total_linear_meters = sum of total_quantity, rounded to 5 decimals."""
        t4 = (
            _mk_t4("ST-A", "ST", "linear_m", 1.10303),
            _mk_t4("ST-B", "ST", "linear_m", 1.10302),
        )
        result = build_tier3_categories(t4)
        assert len(result) == 1
        assert result[0].total_count == 0
        assert result[0].total_linear_meters == 2.20605

    def test_linear_m_rounded_to_5_decimals(self):
        """Result must round to 5 decimals (golden precision)."""
        t4 = (
            _mk_t4("ST-A", "ST", "linear_m", 1.111111111),
            _mk_t4("ST-B", "ST", "linear_m", 2.222222222),
        )
        result = build_tier3_categories(t4)
        assert result[0].total_linear_meters == round(1.111111111 + 2.222222222, 5)

    def test_nos_quantity_cast_to_int(self):
        """nos quantities are cast to int (defensive — ceil already applied in Tier 4)."""
        t4 = (
            _mk_t4("PROP-A", "PROP", "nos", 5.999),  # defensive cast → 5
        )
        result = build_tier3_categories(t4)
        assert result[0].total_count == 5
        assert isinstance(result[0].total_count, int)


# ═════════════════════════════════════════════════════════════════════
# EMPTY + EDGE CASES
# ═════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    def test_empty_input_returns_empty_tuple(self):
        result = build_tier3_categories(())
        assert result == ()

    def test_single_entry_single_output(self):
        t4 = (_mk_t4("PROP-2M", "PROP", "nos", 5),)
        result = build_tier3_categories(t4)
        assert len(result) == 1
        assert result[0].sku_prefix == "PROP"
        assert result[0].total_count == 5


# ═════════════════════════════════════════════════════════════════════
# INVARIANTS
# ═════════════════════════════════════════════════════════════════════


class TestInvariants:
    def test_mixed_units_per_prefix_raises(
        self, synthetic_mixed_unit_tier_4
    ):
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier3_categories(synthetic_mixed_unit_tier_4)
        assert exc_info.value.invariant_id == "F-T3-UNIT-CONSISTENT"

    def test_invariant_error_lists_units_seen(
        self, synthetic_mixed_unit_tier_4
    ):
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier3_categories(synthetic_mixed_unit_tier_4)
        msg = str(exc_info.value)
        assert "MIX" in msg
        # both units mentioned in some order
        assert "nos" in msg
        assert "linear_m" in msg

    def test_unknown_unit_raises(self):
        """A Tier 4 entry with unit='kg' is invalid (only nos|linear_m)."""
        t4 = (_mk_t4("X-A", "X", "kg", 1),)
        with pytest.raises(FormworkInvariantError) as exc_info:
            build_tier3_categories(t4)
        assert exc_info.value.invariant_id == "F-T3-UNKNOWN-UNIT"


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestDeterminism:
    def test_repeat_calls_produce_identical_output(self, p_int_8_tier_4):
        a = build_tier3_categories(p_int_8_tier_4)
        b = build_tier3_categories(p_int_8_tier_4)
        assert a == b

    def test_immutable_input_unchanged(self, p_int_8_tier_4):
        before = tuple(p_int_8_tier_4)
        build_tier3_categories(p_int_8_tier_4)
        assert p_int_8_tier_4 == before


# ═════════════════════════════════════════════════════════════════════
# HELPER
# ═════════════════════════════════════════════════════════════════════


def _mk_t4(sku_code: str, sku_prefix: str, unit: str, qty) -> Tier4SKUDetail:
    """Build a minimal Tier4SKUDetail for unit-test scaffolding."""
    return Tier4SKUDetail(
        sku_code=sku_code,
        sku_prefix=sku_prefix,
        thickness_mm=None,
        description=f"Test SKU {sku_code}",
        base_quantity=qty,
        wastage_quantity=0 if unit == "nos" else 0.0,
        total_quantity=qty,
        unit=unit,
    )
