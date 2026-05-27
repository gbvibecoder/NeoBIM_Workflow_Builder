"""PR 4: tests for operator_review_handler.

Covers:
* P_INT_8 empty contract.
* All 9 trigger paths × positive + negative.
* Mapper warning re-classification.
* Determinism.
* Module constant coverage.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    APPLICATION_CONFIDENCE_THRESHOLD,
    build_operator_review_items,
    FormworkContext,
    FormworkOperatorReviewType,
    OPERATOR_REVIEW_TRIGGER_RULES,
)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 EMPTY CONTRACT
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8EmptyContract:
    def test_p_int_8_no_reviews(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert result == ()


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    def test_importable(self):
        from app.services.kos_formwork_generator import build_operator_review_items  # noqa: F401

    def test_returns_tuple(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert isinstance(result, tuple)


# ═════════════════════════════════════════════════════════════════════
# INHERITED WARNINGS
# ═════════════════════════════════════════════════════════════════════


class TestInheritedOrphanOpening:
    def test_orphan_warning_triggers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("opening o5 references orphan parent_wall_id='w12'",),
        )
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "inherited_orphan_opening" for r in result)

    def test_no_orphan_warning_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert not any(r.review_type == "inherited_orphan_opening" for r in result)


class TestInheritedLowConfidenceOpening:
    def test_low_confidence_triggers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("opening o2 low_confidence placement",),
        )
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "inherited_low_confidence_opening" for r in result)


class TestInheritedAmbiguousThickness:
    def test_ambiguous_thickness_triggers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("wall w3 ambiguous_thickness 150 vs 180",),
        )
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "inherited_ambiguous_thickness" for r in result)


class TestInheritedCurveRadiusUncertain:
    def test_curve_radius_triggers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("wall w4 curve radius uncertain",),
        )
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "inherited_curve_radius_uncertain" for r in result)


class TestWarningOnlyOneCategoryEach:
    """A warning that contains both 'orphan' and 'low_confidence' takes orphan first."""
    def test_first_match_wins(self, p_int_8_mapper_output, formwork_context_p_int_8):
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("orphan opening with low_confidence",),
        )
        result = build_operator_review_items(m, formwork_context_p_int_8)
        types = {r.review_type for r in result}
        assert "inherited_orphan_opening" in types
        assert "inherited_low_confidence_opening" not in types


# ═════════════════════════════════════════════════════════════════════
# 5F-SPECIFIC TRIGGERS
# ═════════════════════════════════════════════════════════════════════


class TestSeismicZoneHigh:
    def test_zone_iv_triggers(self, p_int_8_mapper_output, seismic_iv_context):
        result = build_operator_review_items(p_int_8_mapper_output, seismic_iv_context)
        assert any(r.review_type == "seismic_zone_high" for r in result)

    def test_zone_v_also_triggers_review(self, p_int_8_mapper_output, seismic_v_context):
        """Per DESIGN v2 §18 line 989 — Zone V triggers BOTH custom_quote AND review."""
        result = build_operator_review_items(p_int_8_mapper_output, seismic_v_context)
        assert any(r.review_type == "seismic_zone_high" for r in result)

    @pytest.mark.parametrize("zone", ["II", "III"])
    def test_low_zones_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8, zone):
        ctx = dataclasses.replace(formwork_context_p_int_8, seismic_zone=zone)
        result = build_operator_review_items(p_int_8_mapper_output, ctx)
        assert not any(r.review_type == "seismic_zone_high" for r in result)


class TestPourRateOverride:
    def test_explicit_pour_rate_triggers(self, p_int_8_mapper_output, pour_override_context):
        result = build_operator_review_items(p_int_8_mapper_output, pour_override_context)
        assert any(r.review_type == "pour_rate_override" for r in result)

    def test_no_override_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8):
        result = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert not any(r.review_type == "pour_rate_override" for r in result)


class TestWallTypeOverride:
    def test_override_differs_from_mapper_triggers(
        self, p_int_8_mapper_output, k4_basement_override_context,
    ):
        result = build_operator_review_items(p_int_8_mapper_output, k4_basement_override_context)
        assert any(r.review_type == "wall_type_override" for r in result)

    def test_override_matches_mapper_no_trigger(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        # P_INT_8 inferred_application='internal' — override matches → no review
        ctx = dataclasses.replace(
            formwork_context_p_int_8,
            wall_type_overrides=(("P_INT_8", "internal"),),
        )
        result = build_operator_review_items(p_int_8_mapper_output, ctx)
        assert not any(r.review_type == "wall_type_override" for r in result)

    def test_missing_wall_id_skipped(self, p_int_8_mapper_output, formwork_context_p_int_8):
        ctx = dataclasses.replace(
            formwork_context_p_int_8,
            wall_type_overrides=(("UNKNOWN_WALL", "basement"),),
        )
        # No crash, no spurious review (IV-F-6 catches at orchestrator level)
        result = build_operator_review_items(p_int_8_mapper_output, ctx)
        assert not any(r.review_type == "wall_type_override" for r in result)


class TestLowApplicationConfidence:
    def test_low_conf_k8_triggers(self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        w = dataclasses.replace(
            p_int_8_wall, id="W_K8_LOW",
            system="K8-200", application_confidence=0.5,
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "low_application_confidence" for r in result)

    def test_low_conf_basement_triggers(self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        w = dataclasses.replace(
            p_int_8_wall, id="W_BASE_LOW",
            inferred_application="basement", application_confidence=0.5,
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert any(r.review_type == "low_application_confidence" for r in result)

    def test_low_conf_internal_K4_no_trigger(self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        """K4 internal at low confidence does NOT trigger (only K8 OR basement)."""
        w = dataclasses.replace(
            p_int_8_wall, id="W_K4_LOW", application_confidence=0.3,
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert not any(r.review_type == "low_application_confidence" for r in result)

    def test_threshold_value_is_0_7(self):
        assert APPLICATION_CONFIDENCE_THRESHOLD == 0.7

    def test_at_threshold_no_trigger(self, p_int_8_wall, p_int_8_mapper_output, formwork_context_p_int_8):
        w = dataclasses.replace(
            p_int_8_wall, id="W_AT", system="K8-200", application_confidence=0.7,
        )
        m = dataclasses.replace(p_int_8_mapper_output, wall_segments=(w,))
        result = build_operator_review_items(m, formwork_context_p_int_8)
        assert not any(r.review_type == "low_application_confidence" for r in result)


class TestContextIncomplete:
    def test_both_none_triggers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        ctx = dataclasses.replace(formwork_context_p_int_8, seismic_zone=None)
        m = dataclasses.replace(p_int_8_mapper_output, seismic_zone=None)
        result = build_operator_review_items(m, ctx)
        assert any(r.review_type == "context_incomplete" for r in result)

    def test_mapper_supplies_seismic_no_trigger(self, p_int_8_mapper_output, formwork_context_p_int_8):
        """P_INT_8: context.seismic_zone=None but mapper.seismic_zone='III' → NO trigger."""
        result = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert not any(r.review_type == "context_incomplete" for r in result)


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestDeterminism:
    def test_repeat_calls_identical(self, p_int_8_mapper_output, formwork_context_p_int_8):
        a = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        b = build_operator_review_items(p_int_8_mapper_output, formwork_context_p_int_8)
        assert a == b

    def test_sorted_by_review_type(self, p_int_8_mapper_output, seismic_iv_context):
        """Multi-trigger: Zone IV + pour override + warning → sorted by (review_type, description)."""
        ctx = dataclasses.replace(seismic_iv_context, pour_rate_m_per_hr=2.5)
        m = dataclasses.replace(
            p_int_8_mapper_output,
            warnings=("orphan opening detected",),
        )
        result = build_operator_review_items(m, ctx)
        review_types = [r.review_type for r in result]
        assert review_types == sorted(review_types)


# ═════════════════════════════════════════════════════════════════════
# MODULE CONSTANTS
# ═════════════════════════════════════════════════════════════════════


class TestModuleConstants:
    def test_trigger_rules_cover_all_9_review_types(self):
        import typing
        types_set = set(typing.get_args(FormworkOperatorReviewType))
        assert set(OPERATOR_REVIEW_TRIGGER_RULES.keys()) == types_set

    def test_application_confidence_threshold_value(self):
        assert APPLICATION_CONFIDENCE_THRESHOLD == 0.7

    def test_returned_items_have_4_required_fields(
        self, p_int_8_mapper_output, seismic_iv_context,
    ):
        result = build_operator_review_items(p_int_8_mapper_output, seismic_iv_context)
        for item in result:
            assert item.review_type
            assert item.description
            assert item.source_warning
            assert item.suggested_action
