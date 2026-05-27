"""Tests for types.py — dataclass + Literal structure (PR 1 foundation)."""
from __future__ import annotations

import dataclasses
import typing

import pytest

from app.services.kos_formwork_generator.types import (
    BracingScheme,
    FormworkAuditTrail,
    FormworkCategory,
    FormworkContext,
    FormworkCustomQuoteReason,
    FormworkCustomQuoteRequest,
    FormworkGeneratorOutput,
    FormworkInput,
    FormworkOperatorReviewItem,
    FormworkOperatorReviewType,
    Tier1FormworkSummary,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2FormworkCategories,
    Tier3SKUType,
    Tier4SKUDetail,
    Tier5FormworkWallSegment,
    Tier6FormworkComponent,
)


# ═════════════════════════════════════════════════════════════════════
# Literal alias membership tests (per Pre-flight A extraction)
# ═════════════════════════════════════════════════════════════════════


class TestFormworkCategoryLiteral:
    """13 arms per DESIGN v2 doc 01 §6 (revised 2026-05-26)."""

    EXPECTED_ARMS = (
        "props", "walers", "kickers", "diagonal_braces", "raker_props",
        "corner_clamps", "base_plates", "prop_heads", "joint_gaskets",
        "starter_tracks", "alignment_braces", "misc", "custom_quotes",
    )

    def test_arm_count_is_13(self):
        arms = typing.get_args(FormworkCategory)
        assert len(arms) == 13, f"FormworkCategory has {len(arms)} arms, expected 13"

    def test_arm_values_match_design_v2(self):
        arms = typing.get_args(FormworkCategory)
        assert arms == self.EXPECTED_ARMS

    def test_no_wedge_ties(self):
        assert "wedge_ties" not in typing.get_args(FormworkCategory)

    def test_no_tie_rods(self):
        assert "tie_rods" not in typing.get_args(FormworkCategory)

    def test_has_core_categories(self):
        arms = typing.get_args(FormworkCategory)
        for core in ("props", "walers", "kickers"):
            assert core in arms


class TestFormworkCustomQuoteReasonLiteral:
    """10 arms per DESIGN v2 doc 01 §8."""

    EXPECTED_ARMS = (
        "inherited_curved_wall", "inherited_custom_thickness", "inherited_other_custom",
        "height_exceeds_field_rule_book_max", "pour_rate_exceeds_field_rule_book_max",
        "seismic_zone_v_verification", "non_standard_corner_angle",
        "unsupported_corner_thickness", "unsupported_t_junction_thickness",
        "wall_type_override_high_risk",
    )

    def test_arm_count_is_10(self):
        arms = typing.get_args(FormworkCustomQuoteReason)
        assert len(arms) == 10, f"FormworkCustomQuoteReason has {len(arms)} arms, expected 10"

    def test_arm_values_match_design_v2(self):
        arms = typing.get_args(FormworkCustomQuoteReason)
        assert arms == self.EXPECTED_ARMS


class TestFormworkOperatorReviewTypeLiteral:
    """9 arms per DESIGN v2 doc 01 §9 (reuse_cycles_non_default dropped per Decision 14)."""

    EXPECTED_ARMS = (
        "inherited_orphan_opening", "inherited_low_confidence_opening",
        "inherited_ambiguous_thickness", "inherited_curve_radius_uncertain",
        "seismic_zone_high", "pour_rate_override", "wall_type_override",
        "low_application_confidence", "context_incomplete",
    )

    def test_arm_count_is_9(self):
        arms = typing.get_args(FormworkOperatorReviewType)
        assert len(arms) == 9, f"FormworkOperatorReviewType has {len(arms)} arms, expected 9"

    def test_arm_values_match_design_v2(self):
        arms = typing.get_args(FormworkOperatorReviewType)
        assert arms == self.EXPECTED_ARMS

    def test_no_reuse_cycles_non_default(self):
        """Decision 14 REMOVED — no reuse_cycles_non_default review type."""
        assert "reuse_cycles_non_default" not in typing.get_args(FormworkOperatorReviewType)


# ═════════════════════════════════════════════════════════════════════
# Dataclass immutability (frozen=True enforcement)
# ═════════════════════════════════════════════════════════════════════


class TestDataclassImmutability:
    """All ~14 PR 1 dataclasses must be frozen."""

    ALL_DATACLASSES = [
        FormworkInput, FormworkContext, FormworkGeneratorOutput,
        Tier1FormworkSummary, Tier2FormworkCategories,
        Tier2Bucket, Tier2BucketCustom,
        Tier3SKUType, Tier4SKUDetail, Tier5FormworkWallSegment,
        Tier6FormworkComponent,
        FormworkCustomQuoteRequest, FormworkOperatorReviewItem,
        FormworkAuditTrail, BracingScheme,
    ]

    @pytest.mark.parametrize("dc_type", ALL_DATACLASSES)
    def test_is_dataclass(self, dc_type):
        assert dataclasses.is_dataclass(dc_type), (
            f"{dc_type.__name__} is not a dataclass"
        )

    @pytest.mark.parametrize("dc_type", ALL_DATACLASSES)
    def test_is_frozen(self, dc_type):
        params = dc_type.__dataclass_params__
        assert params.frozen, f"{dc_type.__name__} is not frozen"


class TestFrozenBehaviorEnforced:
    """Frozen dataclasses must raise on attribute assignment (runtime behavior)."""

    def test_formwork_context_immutable(self):
        ctx = FormworkContext(project_id="X", quote_date="2026-05-25")
        with pytest.raises(dataclasses.FrozenInstanceError):
            ctx.project_id = "Y"  # type: ignore[misc]

    def test_bracing_scheme_immutable(self):
        bs = BracingScheme(
            system="K4-110",
            height_range_min_m=0.0,
            height_range_max_m=2.4,
            bracing_height_class="le_2.4m",
            lifts=1,
            prop_type="L",
            prop_sku="KZ-PROP-L",
            prop_spacing_m=2.4,
            waler_count=0,
            waler_position="N/A",
            kicker_spacing_mm=600,
            has_diagonal=False,
            frb_source="FRB row 1",
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            bs.prop_type = "M"  # type: ignore[misc]

    def test_tier6_component_immutable(self):
        t6 = Tier6FormworkComponent(
            component_id="C-0001",
            wall_segment_id="WALL-1",
            component_type="prop",
            sku_code="KZ-PROP-L",
            quantity=5.0,
            unit="nos",
            source_rule="FRB §9.1 RULE BI-1",
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            t6.quantity = 6.0  # type: ignore[misc]

    def test_tier2_bucket_immutable(self):
        b = Tier2Bucket(count=5, linear_meters=0.0)
        with pytest.raises(dataclasses.FrozenInstanceError):
            b.count = 6  # type: ignore[misc]


# ═════════════════════════════════════════════════════════════════════
# Field counts (per DESIGN v2 — verify ACTUAL counts from code, not headers)
# ═════════════════════════════════════════════════════════════════════


class TestFieldCounts:
    def test_formwork_context_has_9_fields(self):
        """DESIGN v2 §3: 9 engineering-only fields (commercial dropped 2026-05-26)."""
        fields = dataclasses.fields(FormworkContext)
        assert len(fields) == 9, (
            f"Expected 9 FormworkContext fields, got {len(fields)}: "
            f"{[f.name for f in fields]}"
        )

    def test_formwork_context_field_names(self):
        expected = {
            "project_id", "quote_date", "seismic_zone",
            "pour_rate_m_per_hr", "wastage_percent", "wall_type_overrides",
            "deterministic_id_seed", "generated_at_override", "notes",
        }
        actual = {f.name for f in dataclasses.fields(FormworkContext)}
        assert actual == expected

    def test_formwork_output_has_15_fields(self):
        """DESIGN v2 §4: 15 top-level fields (commercial_terms dropped 2026-05-26)."""
        fields = dataclasses.fields(FormworkGeneratorOutput)
        assert len(fields) == 15, (
            f"Expected 15 FormworkGeneratorOutput fields, got {len(fields)}: "
            f"{[f.name for f in fields]}"
        )

    def test_formwork_output_no_commercial_terms(self):
        field_names = {f.name for f in dataclasses.fields(FormworkGeneratorOutput)}
        assert "commercial_terms" not in field_names

    def test_formwork_output_no_top_level_hashes(self):
        """Decision 8 v2: hashes live INSIDE audit_trail."""
        field_names = {f.name for f in dataclasses.fields(FormworkGeneratorOutput)}
        assert "mapper_output_hash" not in field_names
        assert "context_hash" not in field_names

    def test_audit_trail_has_7_fields_with_hashes_inside(self):
        fields = dataclasses.fields(FormworkAuditTrail)
        assert len(fields) == 7
        field_names = {f.name for f in fields}
        assert "mapper_output_hash" in field_names
        assert "context_hash" in field_names

    def test_audit_trail_has_no_karthik_pricing(self):
        """Removed 2026-05-26: karthik_bracing_pricing_version (no pricing in 5F)."""
        field_names = {f.name for f in dataclasses.fields(FormworkAuditTrail)}
        assert "karthik_bracing_pricing_version" not in field_names
        assert "karthik_pricing_version" not in field_names


class TestNoCommercialFields:
    """No tier nor output may contain weight_kg / unit_price_inr / line_total_inr / etc."""

    FORBIDDEN = (
        "weight_kg", "unit_price_inr", "line_total_inr",
        "grand_total_inr", "subtotal_inr", "tax_inr", "discount_inr",
        "total_weight_kg", "segment_weight_kg", "segment_price_inr",
        "price_inr", "tax_rate_percent", "discount_percent", "currency",
        "reuse_cycles",
    )

    @pytest.mark.parametrize("dc_type", [
        FormworkContext, FormworkGeneratorOutput, FormworkAuditTrail,
        Tier1FormworkSummary, Tier2Bucket, Tier2BucketCustom,
        Tier2FormworkCategories, Tier3SKUType, Tier4SKUDetail,
        Tier5FormworkWallSegment, Tier6FormworkComponent,
        FormworkCustomQuoteRequest,
    ])
    def test_no_commercial_fields(self, dc_type):
        field_names = {f.name for f in dataclasses.fields(dc_type)}
        for forbidden in self.FORBIDDEN:
            assert forbidden not in field_names, (
                f"{dc_type.__name__} contains forbidden commercial field: {forbidden}"
            )


# ═════════════════════════════════════════════════════════════════════
# Default values — must be immutable (tuples, None, scalars)
# ═════════════════════════════════════════════════════════════════════


class TestImmutableDefaults:
    def test_context_wall_type_overrides_default_empty_tuple(self):
        ctx = FormworkContext(project_id="X", quote_date="2026-05-25")
        assert ctx.wall_type_overrides == ()
        assert isinstance(ctx.wall_type_overrides, tuple)

    def test_context_seismic_zone_default_none(self):
        ctx = FormworkContext(project_id="X", quote_date="2026-05-25")
        assert ctx.seismic_zone is None

    def test_context_wastage_default_5(self):
        ctx = FormworkContext(project_id="X", quote_date="2026-05-25")
        assert ctx.wastage_percent == 5.0

    def test_no_mutable_default_in_any_dataclass(self):
        """No field may default to list, dict, or set (mutable types break frozen)."""
        all_dcs = TestDataclassImmutability.ALL_DATACLASSES
        for dc_type in all_dcs:
            for f in dataclasses.fields(dc_type):
                if f.default is not dataclasses.MISSING:
                    assert not isinstance(f.default, (list, dict, set)), (
                        f"{dc_type.__name__}.{f.name} has mutable default: {f.default!r}"
                    )


# ═════════════════════════════════════════════════════════════════════
# Sanity: full dataclass instantiation works
# ═════════════════════════════════════════════════════════════════════


class TestInstantiation:
    def test_can_instantiate_full_output(self):
        """Smoke: build a complete FormworkGeneratorOutput end-to-end."""
        bp = Tier2Bucket(count=0, linear_meters=0.0)
        bs = Tier2Bucket(count=0, linear_meters=0.0)
        cq = Tier2BucketCustom(count=0, pending_count=0, note="")
        t2 = Tier2FormworkCategories(bracing_primary=bp, bracing_secondary=bs, custom_quotes=cq)
        t1 = Tier1FormworkSummary(
            project_name="test", quote_date="2026-05-27",
            total_wall_segments_with_bracing=0, total_corners_detected=0,
            total_props=0, total_walers=0, total_kickers=0,
            total_diagonal_braces=0, total_raker_props=0,
            total_corner_clamps=0, total_base_plates=0, total_prop_heads=0,
            total_joint_gasket_meters=0.0, total_starter_track_meters=0.0,
            total_custom_quote_items=0, operator_review_items_count=0,
        )
        at = FormworkAuditTrail(
            mapper_output_hash="x" * 64,
            context_hash="y" * 64,
            formwork_calculation_version="v0.1.0",
            field_rule_book_version="KZ-FIELD-RB-001 v1.0",
            custom_quote_review_required=False,
            operator_review_required=False,
            pipeline_versions=(("formwork", "v0.1.0"),),
        )
        out = FormworkGeneratorOutput(
            formwork_id="abcd1234",
            generated_at="2026-05-27T00:00:00Z",
            schema_version="0.1.0",
            tier_1_summary=t1, tier_2_categories=t2,
            tier_3_sku_types=(), tier_4_sku_details=(),
            tier_5_wall_segments=(), tier_6_components=(),
            custom_quote_items=(), operator_review_items=(),
            audit_trail=at,
            warnings=(), assumptions_made=(), pending_karthik=(),
        )
        assert out.formwork_id == "abcd1234"
        assert out.audit_trail.mapper_output_hash == "x" * 64
        assert out.tier_2_categories.bracing_primary.count == 0
