"""PR 4: integration tests — full PR 1-4 pipeline byte-equal vs golden + validator."""
from __future__ import annotations

import dataclasses
import json

import pytest

from app.services.kos_formwork_generator import (
    FormworkInvariantError,
    validate_formwork_output,
)


def _norm(obj):
    """Recursively convert tuples to lists for JSON-shaped comparison."""
    if isinstance(obj, dict):
        return {k: _norm(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_norm(v) for v in obj]
    return obj


# ═════════════════════════════════════════════════════════════════════
# FULL PR 1-4 PIPELINE BYTE-EQUAL
# ═════════════════════════════════════════════════════════════════════


class TestFullPipelineByteEqual:
    def test_handlers_empty_for_p_int_8(self, p_int_8_full_output):
        assert p_int_8_full_output.custom_quote_items == ()
        assert p_int_8_full_output.operator_review_items == ()

    def test_audit_booleans_both_false(self, p_int_8_full_output):
        assert p_int_8_full_output.audit_trail.custom_quote_review_required is False
        assert p_int_8_full_output.audit_trail.operator_review_required is False

    def test_validator_passes(self, p_int_8_full_output):
        warnings = validate_formwork_output(p_int_8_full_output)
        assert warnings == ()

    def test_formwork_id_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        assert p_int_8_full_output.formwork_id == p_int_8_formwork_golden["formwork_id"]

    def test_tier_1_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm(dataclasses.asdict(p_int_8_full_output.tier_1_summary))
        assert actual == p_int_8_formwork_golden["tier_1_summary"]

    def test_tier_2_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm(dataclasses.asdict(p_int_8_full_output.tier_2_categories))
        assert actual == p_int_8_formwork_golden["tier_2_categories"]

    def test_tier_3_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm([dataclasses.asdict(t) for t in p_int_8_full_output.tier_3_sku_types])
        assert actual == p_int_8_formwork_golden["tier_3_sku_types"]

    def test_tier_4_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm([dataclasses.asdict(t) for t in p_int_8_full_output.tier_4_sku_details])
        assert actual == p_int_8_formwork_golden["tier_4_sku_details"]

    def test_tier_5_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm([dataclasses.asdict(t) for t in p_int_8_full_output.tier_5_wall_segments])
        assert actual == p_int_8_formwork_golden["tier_5_wall_segments"]

    def test_tier_6_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm([dataclasses.asdict(t) for t in p_int_8_full_output.tier_6_components])
        assert actual == p_int_8_formwork_golden["tier_6_components"]

    def test_audit_trail_matches_golden(self, p_int_8_full_output, p_int_8_formwork_golden):
        actual = _norm(dataclasses.asdict(p_int_8_full_output.audit_trail))
        assert actual == p_int_8_formwork_golden["audit_trail"]


# ═════════════════════════════════════════════════════════════════════
# VALIDATOR CATCHES MUTATIONS
# ═════════════════════════════════════════════════════════════════════


class TestValidatorCatchesMutations:
    def test_validator_catches_inflated_props_tier_5(self, p_int_8_full_output):
        bad_w = dataclasses.replace(p_int_8_full_output.tier_5_wall_segments[0], total_props=999)
        bad = dataclasses.replace(p_int_8_full_output, tier_5_wall_segments=(bad_w,))
        with pytest.raises(FormworkInvariantError):
            validate_formwork_output(bad)

    def test_validator_catches_unknown_sku(self, p_int_8_full_output):
        t4 = p_int_8_full_output.tier_4_sku_details[0]
        bad_t4 = dataclasses.replace(t4, sku_code="KZ-FAKE-99")
        bad = dataclasses.replace(
            p_int_8_full_output,
            tier_4_sku_details=(bad_t4,) + p_int_8_full_output.tier_4_sku_details[1:],
        )
        with pytest.raises(FormworkInvariantError):
            validate_formwork_output(bad)


# ═════════════════════════════════════════════════════════════════════
# SYNTHETIC TRIGGERS — full pipeline still validates
# ═════════════════════════════════════════════════════════════════════


class TestSyntheticTriggers:
    def test_zone_iv_pipeline_validates(
        self, p_int_8_mapper_output, seismic_iv_context,
    ):
        """Synthesize full pipeline with Zone IV context → operator_review fires.

        Validator must still pass (operator_review presence is informational, not invariant break).
        """
        from app.services.kos_formwork_generator import (
            count_corners, count_components, find_bracing_scheme,
            build_tier6_components, build_tier5_walls, build_tier4_skus,
            build_tier3_categories, build_tier2_summary, build_tier1_project,
            mint_formwork_id, compute_generated_at, build_audit_trail,
            build_custom_quote_items, build_operator_review_items,
            FORMWORK_SCHEMA_VERSION, WASTAGE_PERCENT_DEFAULT,
        )
        from app.services.kos_formwork_generator.types import FormworkGeneratorOutput

        ctx = dataclasses.replace(
            seismic_iv_context, generated_at_override="2026-05-27T00:00:00Z",
            deterministic_id_seed="iv_test_seed",
        )
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}
        tier_6, base = build_tier6_components(wcm, corners, WASTAGE_PERCENT_DEFAULT)
        tier_5 = build_tier5_walls(wcm, corners, ctx, WASTAGE_PERCENT_DEFAULT)
        tier_4 = build_tier4_skus(tier_6, base)
        cq = build_custom_quote_items(p_int_8_mapper_output, ctx, corners)
        rev = build_operator_review_items(p_int_8_mapper_output, ctx)
        tier_3 = build_tier3_categories(tier_4)
        tier_2 = build_tier2_summary(tier_6, cq)
        tier_1 = build_tier1_project(p_int_8_mapper_output, ctx, tier_5, corners, cq, rev)
        at = build_audit_trail(p_int_8_mapper_output, ctx, cq, rev)
        output = FormworkGeneratorOutput(
            formwork_id=mint_formwork_id(ctx),
            generated_at=compute_generated_at(ctx),
            schema_version=FORMWORK_SCHEMA_VERSION,
            tier_1_summary=tier_1, tier_2_categories=tier_2,
            tier_3_sku_types=tier_3, tier_4_sku_details=tier_4,
            tier_5_wall_segments=tier_5, tier_6_components=tier_6,
            custom_quote_items=cq, operator_review_items=rev, audit_trail=at,
            warnings=(), assumptions_made=(), pending_karthik=(),
        )
        assert len(rev) >= 1, "Zone IV should fire seismic_zone_high review"
        assert at.operator_review_required is True
        # Validator must still pass
        validate_formwork_output(output)
