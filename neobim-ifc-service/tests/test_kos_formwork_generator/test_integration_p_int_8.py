"""Integration tests: full PR 2 algorithm pipeline vs PR 1 golden (byte-equal)."""
from __future__ import annotations

import dataclasses

from app.services.kos_formwork_generator import (
    build_tier4_skus,
    build_tier5_walls,
    build_tier6_components,
    count_components,
    count_corners,
    find_bracing_scheme,
)


class TestFullPipelineP_INT_8:
    """End-to-end: mapper output + context → Tier 4/5/6 byte-equal vs PR 1 golden."""

    def test_corners_empty(self, p_int_8_mapper_output):
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        assert corners == ()

    def test_scheme_matches(self, p_int_8_mapper_output):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        assert scheme.system == "K4-110"
        assert scheme.bracing_height_class == "2.4_to_3.0m"
        assert scheme.prop_spacing_m == 2.0

    def test_base_component_counts(self, p_int_8_mapper_output):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        assert counts.total_props == 4
        assert counts.total_kickers == 8
        assert counts.total_base_plates == 4
        assert counts.total_prop_heads == 4
        assert counts.starter_track_meters == 2.101

    def test_tier_6_byte_equal_with_golden(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        tier_6, _ = build_tier6_components(wcm, corners, 5.0)
        golden_t6 = p_int_8_formwork_golden["tier_6_components"]
        actual = [dataclasses.asdict(c) for c in tier_6]
        assert actual == golden_t6

    def test_tier_5_byte_equal_with_golden(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        tier_5 = build_tier5_walls(wcm, corners, formwork_context_p_int_8, 5.0)
        golden_t5 = p_int_8_formwork_golden["tier_5_wall_segments"]
        actual = [dataclasses.asdict(w) for w in tier_5]
        assert actual == golden_t5

    def test_tier_4_byte_equal_with_golden(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        tier_6, base = build_tier6_components(wcm, corners, 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        golden_t4 = p_int_8_formwork_golden["tier_4_sku_details"]
        actual = [dataclasses.asdict(t) for t in tier_4]
        assert actual == golden_t4

    def test_full_pipeline_one_shot(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        """Single end-to-end execution with all three tiers compared."""
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        assert corners == ()

        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}

        tier_6, base_by_sku = build_tier6_components(wcm, corners, 5.0)
        tier_5 = build_tier5_walls(wcm, corners, formwork_context_p_int_8, 5.0)
        tier_4 = build_tier4_skus(tier_6, base_by_sku)

        # Three tiers byte-equal with golden
        assert [dataclasses.asdict(c) for c in tier_6] == p_int_8_formwork_golden["tier_6_components"]
        assert [dataclasses.asdict(w) for w in tier_5] == p_int_8_formwork_golden["tier_5_wall_segments"]
        assert [dataclasses.asdict(t) for t in tier_4] == p_int_8_formwork_golden["tier_4_sku_details"]


class TestPipelineIdempotent:
    """Running the pipeline twice produces identical output."""

    def test_idempotent_tier_6(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        wall = p_int_8_mapper_output.wall_segments[0]
        scheme = find_bracing_scheme(wall.system, wall.height_mm)
        counts = count_components(wall, scheme)
        wcm = {wall.id: (wall, scheme, counts)}
        corners = count_corners(p_int_8_mapper_output.wall_segments)

        t6_a, _ = build_tier6_components(wcm, corners, 5.0)
        t6_b, _ = build_tier6_components(wcm, corners, 5.0)

        # Same input → same output (no hidden state)
        assert [dataclasses.asdict(c) for c in t6_a] == [dataclasses.asdict(c) for c in t6_b]
