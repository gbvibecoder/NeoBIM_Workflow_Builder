"""Tests for tier5_walls builder (PR 2)."""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    FormworkContext,
    Tier5FormworkWallSegment,
    build_tier5_walls,
    count_components,
    count_corners,
    find_bracing_scheme,
)
from app.services.kos_formwork_generator.exceptions import FormworkInputError


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 baseline
# ═════════════════════════════════════════════════════════════════════


class TestPInt8:
    def test_emits_one_wall(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert len(result) == 1

    def test_all_22_fields_populated(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert len(dataclasses.fields(result[0])) == 22

    def test_wall_id(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].wall_id == "P_INT_8"

    def test_system(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].system == "K4-110"

    def test_application(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].application == "internal"

    def test_length_mm(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].length_mm == 2101.0

    def test_height_mm(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].height_mm == 3000

    def test_total_props_5(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_props == 5

    def test_total_walers_0(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_walers == 0

    def test_total_kickers_9(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_kickers == 9

    def test_total_base_plates_5(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_base_plates == 5

    def test_total_prop_heads_5(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_prop_heads == 5

    def test_starter_track_meters(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].starter_track_meters == 2.20605

    def test_joint_gasket_meters_0(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].joint_gasket_meters == 0.0

    def test_total_corner_clamps_0(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].total_corner_clamps == 0

    def test_pour_rate_3_0_for_k4(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].pour_rate_applied_m_per_hr == 3.0

    def test_bracing_scheme_applied_label(self, p_int_8_components_map, formwork_context_p_int_8):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].bracing_scheme_applied == "K4-110_2.4_to_3.0m_1lift"

    def test_notes_empty_string(self, p_int_8_components_map, formwork_context_p_int_8):
        """notes is `str` (not Optional); default should be empty string."""
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].notes == ""


# ═════════════════════════════════════════════════════════════════════
# Pour rate resolution
# ═════════════════════════════════════════════════════════════════════


class TestPourRate:
    def test_context_override_wins(self, p_int_8_components_map):
        ctx = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            pour_rate_m_per_hr=1.5,
        )
        result = build_tier5_walls(p_int_8_components_map, (), ctx, 5.0)
        assert result[0].pour_rate_applied_m_per_hr == 1.5

    def test_default_used_when_no_override(self, p_int_8_components_map, formwork_context_p_int_8):
        """formwork_context_p_int_8 has pour_rate_m_per_hr=None → use POUR_RATE_DEFAULTS."""
        assert formwork_context_p_int_8.pour_rate_m_per_hr is None
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        assert result[0].pour_rate_applied_m_per_hr == 3.0  # K4-110 default


# ═════════════════════════════════════════════════════════════════════
# Multi-wall ordering
# ═════════════════════════════════════════════════════════════════════


class TestMultiWall:
    def test_walls_sorted_alphabetically(self, p_int_8_wall, k4_110_scheme, formwork_context_p_int_8):
        wall_z = dataclasses.replace(p_int_8_wall, id="Z_WALL")
        wall_a = dataclasses.replace(p_int_8_wall, id="A_WALL")
        counts_z = count_components(wall_z, k4_110_scheme)
        counts_a = count_components(wall_a, k4_110_scheme)
        wcm = {
            wall_z.id: (wall_z, k4_110_scheme, counts_z),
            wall_a.id: (wall_a, k4_110_scheme, counts_a),
        }
        result = build_tier5_walls(wcm, (), formwork_context_p_int_8, 5.0)
        assert [w.wall_id for w in result] == ["A_WALL", "Z_WALL"]


# ═════════════════════════════════════════════════════════════════════
# Corner clamp attribution
# ═════════════════════════════════════════════════════════════════════


class TestCornerAttribution:
    def test_corner_assigns_clamp_to_first_wall(
        self, p_int_8_wall, k4_110_scheme, formwork_context_p_int_8,
    ):
        wall_a = dataclasses.replace(p_int_8_wall, id="W_A", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (3000.0, 0.0)))
        wall_b = dataclasses.replace(p_int_8_wall, id="W_B", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (0.0, 3000.0)))
        corners = count_corners((wall_a, wall_b))
        counts_a = count_components(wall_a, k4_110_scheme)
        counts_b = count_components(wall_b, k4_110_scheme)
        wcm = {
            wall_a.id: (wall_a, k4_110_scheme, counts_a),
            wall_b.id: (wall_b, k4_110_scheme, counts_b),
        }
        result = build_tier5_walls(wcm, corners, formwork_context_p_int_8, 5.0)
        wall_a_t5 = [w for w in result if w.wall_id == "W_A"][0]
        wall_b_t5 = [w for w in result if w.wall_id == "W_B"][0]
        # Corner attributed to first wall_id alphabetically (W_A)
        assert wall_a_t5.total_corner_clamps == 1
        assert wall_b_t5.total_corner_clamps == 0


# ═════════════════════════════════════════════════════════════════════
# Byte-equal vs PR 1 golden
# ═════════════════════════════════════════════════════════════════════


class TestGoldenMatch:
    def test_p_int_8_matches_golden_tier5(
        self, p_int_8_components_map, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        result = build_tier5_walls(p_int_8_components_map, (), formwork_context_p_int_8, 5.0)
        golden_t5 = p_int_8_formwork_golden["tier_5_wall_segments"]
        assert len(result) == len(golden_t5)
        for r, g in zip(result, golden_t5):
            assert dataclasses.asdict(r) == g
