"""PR 3: tests for build_tier1_project.

Covers:
* Public API contract.
* P_INT_8 golden byte-equality (all 16 fields match golden exactly).
* Each of the 16 fields populated from the right source (mapper / context / Tier 5 / corners / custom / review).
* walls_with_bracing excludes is_custom_order=True walls.
* Per-component totals = sum across Tier 5 (no double-wastage application).
* total_diagonal_braces vs Tier 5's total_diagonals (field name mismatch).
* linear_m totals rounded to 5 decimals.
* No total_components field (anti-double-count guard per DESIGN v2).
* No commercial fields (lease model).
* Empty Tier 5 input.
* Determinism.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_tier1_project,
    Tier1FormworkSummary,
)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API CONTRACT
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    def test_importable(self):
        from app.services.kos_formwork_generator import build_tier1_project  # noqa: F401

    def test_returns_summary(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
        p_int_8_tier_5,
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        assert isinstance(result, Tier1FormworkSummary)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 GOLDEN BYTE-EQUAL
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8GoldenByteEqual:
    @pytest.fixture
    def t1(self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5):
        return build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
            custom_quote_items=(),
            operator_review_items=(),
        )

    def test_all_fields_match_golden(self, t1, p_int_8_formwork_golden):
        assert dataclasses.asdict(t1) == p_int_8_formwork_golden["tier_1_summary"]

    def test_project_name_from_mapper(self, t1):
        assert t1.project_name == "VAMSHI RESIDENCE"

    def test_quote_date_from_context(self, t1):
        assert t1.quote_date == "2026-05-25"

    def test_walls_with_bracing_count_1(self, t1):
        """P_INT_8 has 1 wall, not custom_order → walls_with_bracing = 1."""
        assert t1.total_wall_segments_with_bracing == 1

    def test_corners_zero_for_single_straight_wall(self, t1):
        assert t1.total_corners_detected == 0


# ═════════════════════════════════════════════════════════════════════
# FIELD-BY-FIELD SOURCING
# ═════════════════════════════════════════════════════════════════════


class TestFieldSourcing:
    def test_props_sum_from_tier_5(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        expected = sum(w.total_props for w in p_int_8_tier_5)
        assert result.total_props == expected

    def test_kickers_sum_from_tier_5(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        assert result.total_kickers == sum(w.total_kickers for w in p_int_8_tier_5)

    def test_diagonal_braces_from_tier_5_total_diagonals(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        """Tier 1 field is total_diagonal_braces; Tier 5 field is total_diagonals."""
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        assert result.total_diagonal_braces == sum(
            w.total_diagonals for w in p_int_8_tier_5
        )

    def test_starter_track_meters_rounded_to_5(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        raw = sum(w.starter_track_meters for w in p_int_8_tier_5)
        assert result.total_starter_track_meters == round(raw, 5)

    def test_joint_gasket_meters_rounded_to_5(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        raw = sum(w.joint_gasket_meters for w in p_int_8_tier_5)
        assert result.total_joint_gasket_meters == round(raw, 5)

    def test_custom_quote_count_from_arg(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
            custom_quote_items=(object(), object(), object()),  # 3 sentinels
        )
        assert result.total_custom_quote_items == 3

    def test_operator_review_count_from_arg(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
            operator_review_items=(object(), object()),
        )
        assert result.operator_review_items_count == 2

    def test_corners_count_from_arg(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(object(), object(), object(), object()),
        )
        assert result.total_corners_detected == 4


# ═════════════════════════════════════════════════════════════════════
# WALLS_WITH_BRACING — CUSTOM ORDER EXCLUSION
# ═════════════════════════════════════════════════════════════════════


class TestWallsWithBracing:
    def test_custom_order_walls_excluded(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        """If a Tier 5 wall has is_custom_order=True, it is NOT counted."""
        modified = tuple(
            dataclasses.replace(w, is_custom_order=True) for w in p_int_8_tier_5
        )
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=modified,
            corners=(),
        )
        assert result.total_wall_segments_with_bracing == 0

    def test_mixed_custom_and_normal_walls(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        """Exactly one custom-order wall in a 3-wall set → walls_with_bracing=2."""
        w0 = p_int_8_tier_5[0]
        modified = (
            dataclasses.replace(w0, wall_id="A", is_custom_order=False),
            dataclasses.replace(w0, wall_id="B", is_custom_order=True),
            dataclasses.replace(w0, wall_id="C", is_custom_order=False),
        )
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=modified,
            corners=(),
        )
        assert result.total_wall_segments_with_bracing == 2


# ═════════════════════════════════════════════════════════════════════
# SCHEMA INVARIANTS
# ═════════════════════════════════════════════════════════════════════


class TestSchemaInvariants:
    def test_no_total_components_field(self):
        names = [f.name for f in dataclasses.fields(Tier1FormworkSummary)]
        assert "total_components" not in names

    def test_exactly_16_fields(self):
        assert len(dataclasses.fields(Tier1FormworkSummary)) == 16

    def test_no_commercial_fields(self):
        names = {f.name for f in dataclasses.fields(Tier1FormworkSummary)}
        for forbidden in (
            "total_cost", "total_cost_inr", "total_weight_kg", "total_price",
            "rental_days", "rental_cost",
        ):
            assert forbidden not in names


# ═════════════════════════════════════════════════════════════════════
# EMPTY + DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    def test_empty_tier_5_zero_totals(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        result = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=(),
            corners=(),
        )
        assert result.total_wall_segments_with_bracing == 0
        assert result.total_props == 0
        assert result.total_kickers == 0
        assert result.total_diagonal_braces == 0
        assert result.total_starter_track_meters == 0.0


class TestDeterminism:
    def test_repeat_calls_identical(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_tier_5
    ):
        a = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        b = build_tier1_project(
            mapper_output=p_int_8_mapper_output,
            context=formwork_context_p_int_8,
            tier_5_wall_segments=p_int_8_tier_5,
            corners=(),
        )
        assert a == b
