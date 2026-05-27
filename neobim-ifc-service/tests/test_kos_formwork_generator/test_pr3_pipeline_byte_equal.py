"""PR 3: end-to-end byte-equal contract verification.

Runs the full PR 1 + PR 2 + PR 3 pipeline on P_INT_8 and asserts that every
piece of output that maps to a field in the PR 1 golden file matches that
golden field BYTE-EQUAL.

Pipeline order (matches the PR 5 orchestrator design):
    corners         = count_corners(mapper.wall_segments)
    counts          = count_components(wall, scheme)
    tier_6, base_by_sku
                    = build_tier6_components(wall_components_map, corners, 5.0)
    tier_5          = build_tier5_walls(wall_components_map, corners, context, 5.0)
    tier_4          = build_tier4_skus(tier_6, base_by_sku)
    tier_3          = build_tier3_categories(tier_4)
    tier_2          = build_tier2_summary(tier_6, custom_quote_items=())
    tier_1          = build_tier1_project(mapper, context, tier_5, corners, (), ())
    audit_trail     = build_audit_trail(mapper, context, (), ())
    formwork_id     = mint_formwork_id(context)
    generated_at    = compute_generated_at(context)

This is the byte-equal smoke test that gates PR 4-6 progress.
"""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_audit_trail,
    build_tier1_project,
    build_tier2_summary,
    build_tier3_categories,
    build_tier4_skus,
    build_tier5_walls,
    build_tier6_components,
    compute_generated_at,
    count_components,
    count_corners,
    find_bracing_scheme,
    mint_formwork_id,
)


# ═════════════════════════════════════════════════════════════════════
# PIPELINE FIXTURE (session-scoped — runs once)
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def pipeline_output(p_int_8_mapper_output, formwork_context_p_int_8):
    """Run the full PR 1+2+3 pipeline; returns every intermediate + final output."""
    corners = count_corners(p_int_8_mapper_output.wall_segments)

    wall = p_int_8_mapper_output.wall_segments[0]
    scheme = find_bracing_scheme(wall.system, wall.height_mm)
    counts = count_components(wall, scheme)
    wall_components_map = {wall.id: (wall, scheme, counts)}

    tier_6, base_counts_by_sku = build_tier6_components(
        wall_components_map=wall_components_map,
        corners=corners,
        wastage_percent=5.0,
    )
    tier_5 = build_tier5_walls(
        wall_components_map=wall_components_map,
        corners=corners,
        context=formwork_context_p_int_8,
        wastage_percent=5.0,
    )
    tier_4 = build_tier4_skus(tier_6, base_counts_by_sku)
    tier_3 = build_tier3_categories(tier_4)
    tier_2 = build_tier2_summary(tier_6, custom_quote_items=())
    tier_1 = build_tier1_project(
        mapper_output=p_int_8_mapper_output,
        context=formwork_context_p_int_8,
        tier_5_wall_segments=tier_5,
        corners=corners,
        custom_quote_items=(),
        operator_review_items=(),
    )
    audit_trail = build_audit_trail(
        p_int_8_mapper_output, formwork_context_p_int_8,
        custom_quote_items=(),
        operator_review_items=(),
    )
    formwork_id = mint_formwork_id(formwork_context_p_int_8)
    generated_at = compute_generated_at(formwork_context_p_int_8)

    return {
        "corners": corners,
        "tier_6": tier_6,
        "tier_5": tier_5,
        "tier_4": tier_4,
        "tier_3": tier_3,
        "tier_2": tier_2,
        "tier_1": tier_1,
        "audit_trail": audit_trail,
        "formwork_id": formwork_id,
        "generated_at": generated_at,
    }


# ═════════════════════════════════════════════════════════════════════
# BYTE-EQUAL ASSERTIONS — one per golden field
# ═════════════════════════════════════════════════════════════════════


class TestByteEqualVsGolden:
    def test_formwork_id_byte_equal(self, pipeline_output, p_int_8_formwork_golden):
        assert pipeline_output["formwork_id"] == p_int_8_formwork_golden["formwork_id"]

    def test_generated_at_byte_equal(self, pipeline_output, p_int_8_formwork_golden):
        assert pipeline_output["generated_at"] == p_int_8_formwork_golden["generated_at"]

    def test_tier_1_byte_equal(self, pipeline_output, p_int_8_formwork_golden):
        assert dataclasses.asdict(pipeline_output["tier_1"]) == p_int_8_formwork_golden["tier_1_summary"]

    def test_tier_2_byte_equal(self, pipeline_output, p_int_8_formwork_golden):
        assert dataclasses.asdict(pipeline_output["tier_2"]) == p_int_8_formwork_golden["tier_2_categories"]

    def test_tier_3_byte_equal(self, pipeline_output, p_int_8_formwork_golden):
        computed = [dataclasses.asdict(t) for t in pipeline_output["tier_3"]]
        assert computed == p_int_8_formwork_golden["tier_3_sku_types"]

    def test_audit_trail_mapper_hash_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        assert pipeline_output["audit_trail"].mapper_output_hash == \
            p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"]

    def test_audit_trail_context_hash_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        assert pipeline_output["audit_trail"].context_hash == \
            p_int_8_formwork_golden["audit_trail"]["context_hash"]

    def test_audit_trail_calculation_version_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        assert pipeline_output["audit_trail"].formwork_calculation_version == \
            p_int_8_formwork_golden["audit_trail"]["formwork_calculation_version"]

    def test_audit_trail_frb_version_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        assert pipeline_output["audit_trail"].field_rule_book_version == \
            p_int_8_formwork_golden["audit_trail"]["field_rule_book_version"]

    def test_audit_trail_review_flags_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        assert pipeline_output["audit_trail"].custom_quote_review_required == \
            p_int_8_formwork_golden["audit_trail"]["custom_quote_review_required"]
        assert pipeline_output["audit_trail"].operator_review_required == \
            p_int_8_formwork_golden["audit_trail"]["operator_review_required"]

    def test_audit_trail_pipeline_versions_byte_equal(
        self, pipeline_output, p_int_8_formwork_golden
    ):
        """pipeline_versions is tuple-of-tuples; golden stores list-of-lists.

        Compare after normalizing both to list-of-lists.
        """
        computed = [list(p) for p in pipeline_output["audit_trail"].pipeline_versions]
        golden = [list(p) for p in p_int_8_formwork_golden["audit_trail"]["pipeline_versions"]]
        assert computed == golden


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM — repeated full-pipeline runs produce identical outputs
# ═════════════════════════════════════════════════════════════════════


class TestPipelineDeterminism:
    def test_two_full_pipeline_runs_identical(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        """Run the entire pipeline twice; every output must match exactly."""
        def _run():
            corners = count_corners(p_int_8_mapper_output.wall_segments)
            wall = p_int_8_mapper_output.wall_segments[0]
            scheme = find_bracing_scheme(wall.system, wall.height_mm)
            counts = count_components(wall, scheme)
            wcm = {wall.id: (wall, scheme, counts)}
            t6, base = build_tier6_components(wcm, corners, 5.0)
            t5 = build_tier5_walls(wcm, corners, formwork_context_p_int_8, 5.0)
            t4 = build_tier4_skus(t6, base)
            t3 = build_tier3_categories(t4)
            t2 = build_tier2_summary(t6, ())
            t1 = build_tier1_project(p_int_8_mapper_output, formwork_context_p_int_8, t5, corners, (), ())
            at = build_audit_trail(p_int_8_mapper_output, formwork_context_p_int_8, (), ())
            fid = mint_formwork_id(formwork_context_p_int_8)
            return (t6, t5, t4, t3, t2, t1, at, fid)

        a = _run()
        b = _run()
        assert a == b
