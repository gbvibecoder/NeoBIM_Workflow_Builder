"""Tests for corner_counter (PR 2)."""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    CornerDetection,
    count_corners,
)
from app.services.kos_formwork_generator.exceptions import FormworkInputError


# ═════════════════════════════════════════════════════════════════════
# EMPTY / SINGLE-WALL INPUT
# ═════════════════════════════════════════════════════════════════════


class TestEmptyInput:
    def test_empty_walls_returns_empty(self):
        assert count_corners(()) == ()

    def test_single_wall_no_corners(self, p_int_8_mapper_output):
        """P_INT_8 is a single wall — 0 corners possible."""
        corners = count_corners(p_int_8_mapper_output.wall_segments)
        assert corners == ()


# ═════════════════════════════════════════════════════════════════════
# 90° L-SHAPE CORNER
# ═════════════════════════════════════════════════════════════════════


class TestLShape90:
    def test_two_walls_90_degree_one_corner(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        assert len(corners) == 1

    def test_l_shape_corner_type(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        assert corners[0].corner_type == "90"

    def test_l_shape_wall_ids_sorted(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        assert corners[0].wall_ids == ("LSHAPE_WALL_A", "LSHAPE_WALL_B")

    def test_l_shape_cluster_centroid_at_origin(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        assert corners[0].cluster_x_mm == 0.0
        assert corners[0].cluster_y_mm == 0.0

    def test_l_shape_system_used(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        # Both walls K4-110; thickest is K4-110.
        assert corners[0].system_used == "K4-110"

    def test_l_shape_frb_source(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        assert "FRB §7.2" in corners[0].frb_source

    def test_l_shape_dataclass_is_frozen(self, synthetic_l_shape_walls):
        corners = count_corners(synthetic_l_shape_walls)
        with pytest.raises(dataclasses.FrozenInstanceError):
            corners[0].corner_type = "T"  # type: ignore[misc]


# ═════════════════════════════════════════════════════════════════════
# 135° CORNER
# ═════════════════════════════════════════════════════════════════════


class TestCorner135:
    def test_135_degree_classified(self, synthetic_135_corner_walls):
        corners = count_corners(synthetic_135_corner_walls)
        assert len(corners) == 1
        assert corners[0].corner_type == "135"


# ═════════════════════════════════════════════════════════════════════
# T-JUNCTION (3+ walls)
# ═════════════════════════════════════════════════════════════════════


class TestTJunction:
    def test_t_junction_classified(self, synthetic_t_junction_walls):
        corners = count_corners(synthetic_t_junction_walls)
        assert len(corners) == 1
        assert corners[0].corner_type == "T"

    def test_t_junction_3_walls_in_ids(self, synthetic_t_junction_walls):
        corners = count_corners(synthetic_t_junction_walls)
        assert len(corners[0].wall_ids) == 3
        assert corners[0].wall_ids == ("T_WALL_A", "T_WALL_B", "T_WALL_C")


# ═════════════════════════════════════════════════════════════════════
# UNSUPPORTED ANGLES
# ═════════════════════════════════════════════════════════════════════


class TestUnsupportedAngle:
    def test_45_degree_raises(self, p_int_8_wall):
        """45° corner is not in {90°, 135°} — raises FormworkInputError."""
        import math as _math
        cos45 = _math.cos(_math.radians(45.0))
        sin45 = _math.sin(_math.radians(45.0))
        # Wall A horizontal; Wall B at 45° from wall_a (angle between inward vecs = 45° not 90°/135°)
        wall_a = dataclasses.replace(
            p_int_8_wall, id="ANG_A", length_mm=3000.0,
            plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
        )
        # For 45° interior angle: Wall B inward vector at 45° from Wall A inward.
        # Wall A endpoint inward = (1, 0). Want dot product = cos(45°) = 0.707.
        # Wall B inward vec = (cos(45°), -sin(45°)) (pointing down-right).
        wall_b = dataclasses.replace(
            p_int_8_wall, id="ANG_B", length_mm=3000.0,
            plan_polyline=((0.0, 0.0), (3000.0 * cos45, -3000.0 * sin45)),
        )
        with pytest.raises(FormworkInputError, match="Unsupported corner angle"):
            count_corners((wall_a, wall_b))


# ═════════════════════════════════════════════════════════════════════
# CLUSTERING TOLERANCE
# ═════════════════════════════════════════════════════════════════════


class TestClusteringTolerance:
    def test_endpoints_within_tolerance_clustered(self, p_int_8_wall):
        """Endpoints 30mm apart cluster (default 50mm tolerance)."""
        wall_a = dataclasses.replace(
            p_int_8_wall, id="TOL_A", length_mm=3000.0,
            plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
        )
        wall_b = dataclasses.replace(
            p_int_8_wall, id="TOL_B", length_mm=3000.0,
            plan_polyline=((30.0, 0.0), (30.0, 3000.0)),  # 30mm away
        )
        corners = count_corners((wall_a, wall_b))
        assert len(corners) == 1

    def test_endpoints_outside_tolerance_not_clustered(self, p_int_8_wall):
        """Endpoints 200mm apart do NOT cluster (default 50mm tolerance)."""
        wall_a = dataclasses.replace(
            p_int_8_wall, id="GAP_A", length_mm=3000.0,
            plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
        )
        wall_b = dataclasses.replace(
            p_int_8_wall, id="GAP_B", length_mm=3000.0,
            plan_polyline=((200.0, 0.0), (200.0, 3000.0)),
        )
        corners = count_corners((wall_a, wall_b))
        assert corners == ()

    def test_custom_tolerance_override(self, p_int_8_wall):
        """Larger tolerance can cluster otherwise-distant endpoints."""
        wall_a = dataclasses.replace(
            p_int_8_wall, id="CUSTOM_A", length_mm=3000.0,
            plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
        )
        wall_b = dataclasses.replace(
            p_int_8_wall, id="CUSTOM_B", length_mm=3000.0,
            plan_polyline=((200.0, 0.0), (200.0, 3000.0)),
        )
        corners = count_corners((wall_a, wall_b), tolerance_mm=300.0)
        assert len(corners) == 1


# ═════════════════════════════════════════════════════════════════════
# DETERMINISTIC SORTING
# ═════════════════════════════════════════════════════════════════════


class TestSorting:
    def test_multiple_corners_sorted_by_centroid(self, p_int_8_wall):
        """Two L-shapes at different positions; output sorted by (x, y)."""
        # Corner 1 at (0,0)
        a1 = dataclasses.replace(p_int_8_wall, id="A1", length_mm=2000.0,
                                  plan_polyline=((0.0, 0.0), (2000.0, 0.0)))
        b1 = dataclasses.replace(p_int_8_wall, id="B1", length_mm=2000.0,
                                  plan_polyline=((0.0, 0.0), (0.0, 2000.0)))
        # Corner 2 at (5000, 5000) — disconnected from corner 1
        a2 = dataclasses.replace(p_int_8_wall, id="A2", length_mm=2000.0,
                                  plan_polyline=((5000.0, 5000.0), (7000.0, 5000.0)))
        b2 = dataclasses.replace(p_int_8_wall, id="B2", length_mm=2000.0,
                                  plan_polyline=((5000.0, 5000.0), (5000.0, 7000.0)))

        corners = count_corners((a2, b2, a1, b1))
        assert len(corners) == 2
        # Sorted by (x, y) ascending: (0,0) comes before (5000,5000)
        assert corners[0].cluster_x_mm == 0.0
        assert corners[0].cluster_y_mm == 0.0
        assert corners[1].cluster_x_mm == 5000.0
        assert corners[1].cluster_y_mm == 5000.0


# ═════════════════════════════════════════════════════════════════════
# MALFORMED INPUT
# ═════════════════════════════════════════════════════════════════════


class TestMalformedInput:
    def test_missing_plan_polyline_raises(self, p_int_8_wall):
        wall = dataclasses.replace(p_int_8_wall, id="NO_PL", plan_polyline=())
        with pytest.raises(FormworkInputError, match="plan_polyline"):
            count_corners((wall, p_int_8_wall))

    def test_polyline_too_short_raises(self, p_int_8_wall):
        wall = dataclasses.replace(p_int_8_wall, id="SHORT_PL",
                                    plan_polyline=((0.0, 0.0),))
        with pytest.raises(FormworkInputError, match="plan_polyline"):
            count_corners((wall, p_int_8_wall))

    def test_degenerate_polyline_zero_length_segment_raises(self, p_int_8_wall):
        """Polyline with two identical points → zero-length segment → raises."""
        wall = dataclasses.replace(
            p_int_8_wall, id="DEGEN",
            plan_polyline=((0.0, 0.0), (0.0, 0.0)),
        )
        with pytest.raises(FormworkInputError, match="degenerate"):
            count_corners((wall, p_int_8_wall))


# ═════════════════════════════════════════════════════════════════════
# THICKNESS-BASED SYSTEM SELECTION
# ═════════════════════════════════════════════════════════════════════


class TestSystemThicknessRule:
    def test_thicker_wall_wins(self, p_int_8_wall):
        """K6-150 meets K8-200 at corner → corner uses K8-200 (thicker)."""
        a = dataclasses.replace(p_int_8_wall, id="THIN_A", system="K6-150",
                                 length_mm=3000.0,
                                 plan_polyline=((0.0, 0.0), (3000.0, 0.0)))
        b = dataclasses.replace(p_int_8_wall, id="THICK_B", system="K8-200",
                                 length_mm=3000.0,
                                 plan_polyline=((0.0, 0.0), (0.0, 3000.0)))
        corners = count_corners((a, b))
        assert len(corners) == 1
        assert corners[0].system_used == "K8-200"


# ═════════════════════════════════════════════════════════════════════
# CUSTOM-ORDER WALLS EXCLUDED
# ═════════════════════════════════════════════════════════════════════


class TestCustomOrderExcluded:
    def test_custom_walls_skipped(self, p_int_8_wall):
        """Custom-order walls are excluded from corner clustering."""
        normal = dataclasses.replace(p_int_8_wall, id="NORMAL", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
                                      is_custom_order=False)
        custom = dataclasses.replace(p_int_8_wall, id="CUSTOM", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (0.0, 3000.0)),
                                      is_custom_order=True)
        corners = count_corners((normal, custom))
        assert corners == ()
