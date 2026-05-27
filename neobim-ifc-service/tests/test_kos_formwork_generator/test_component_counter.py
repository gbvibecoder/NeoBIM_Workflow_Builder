"""Tests for component_counter (PR 2)."""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    BRACING_LOOKUP_TABLE,
    ComponentCounts,
    count_components,
    find_bracing_scheme,
)
from app.services.kos_formwork_generator.exceptions import FormworkInputError


# ═════════════════════════════════════════════════════════════════════
# find_bracing_scheme
# ═════════════════════════════════════════════════════════════════════


class TestFindBracingScheme:
    def test_p_int_8_match(self):
        """K4-110 at 3000mm → 2.4-3.0m row: prop L, spacing 2.0m, 0 walers."""
        s = find_bracing_scheme("K4-110", 3000)
        assert s.prop_sku == "KZ-PROP-L"
        assert s.prop_spacing_m == 2.0
        assert s.waler_count == 0
        assert s.kicker_spacing_mm == 600
        assert s.lifts == 1
        assert s.has_diagonal is False

    def test_k4_low_height(self):
        """K4-110 at 2000mm → ≤2.4m row: prop L, spacing 2.4m."""
        s = find_bracing_scheme("K4-110", 2000)
        assert s.prop_spacing_m == 2.4

    def test_k4_at_threshold_3000_picks_lower_row(self):
        """At exactly 3000mm, scheme is 2.4-3.0m (upper-bound inclusive)."""
        s = find_bracing_scheme("K4-110", 3000)
        assert s.prop_spacing_m == 2.0  # 2.4-3.0 row

    def test_k6_180_high(self):
        """K6-180 at 4500mm → 3.6-5.0m row: 2 lifts, M prop, spacing 1.5m."""
        s = find_bracing_scheme("K6-180", 4500)
        assert s.lifts == 2
        assert s.prop_sku == "KZ-PROP-M"
        assert s.prop_spacing_m == 1.5

    def test_k8_250_max_height_has_diagonal(self):
        """K8-250 at 5500mm (within 4.5-6.0m) → XH prop + diagonal."""
        s = find_bracing_scheme("K8-250", 5500)
        assert s.prop_type == "XH"
        assert s.has_diagonal is True

    def test_height_too_large_raises(self):
        """K4-110 max is 3.6m; 5000mm has no match."""
        with pytest.raises(FormworkInputError, match="No bracing scheme"):
            find_bracing_scheme("K4-110", 5000)

    def test_unknown_system_raises(self):
        with pytest.raises(FormworkInputError, match="No bracing scheme"):
            find_bracing_scheme("K9-999", 3000)

    def test_zero_height_raises(self):
        with pytest.raises(FormworkInputError, match="positive"):
            find_bracing_scheme("K4-110", 0)

    def test_negative_height_raises(self):
        with pytest.raises(FormworkInputError, match="positive"):
            find_bracing_scheme("K4-110", -500)


# ═════════════════════════════════════════════════════════════════════
# count_components: P_INT_8 (verifies golden quantities)
# ═════════════════════════════════════════════════════════════════════


class TestPInt8Components:
    def test_p_int_8_props_base_4(self, p_int_8_wall, k4_110_scheme):
        """L=2.101m, spacing=2.0m → props_per_side = max(2, floor(2.101/2.0)+1) = max(2, 2) = 2; total=4."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.props_per_side == 2
        assert counts.total_props == 4

    def test_p_int_8_kickers_base_8(self, p_int_8_wall, k4_110_scheme):
        """L=2.101m, kicker_spacing=600mm → ceil(2.101/0.6)=4 per side; total=8."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.kickers_per_side == 4
        assert counts.total_kickers == 8

    def test_p_int_8_walers_0(self, p_int_8_wall, k4_110_scheme):
        """Scheme waler_count=0 → 0 walers."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_walers == 0

    def test_p_int_8_diagonals_0(self, p_int_8_wall, k4_110_scheme):
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_diagonals == 0

    def test_p_int_8_raker_props_0(self, p_int_8_wall, k4_110_scheme):
        """K4 internal — no raker."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_raker_props == 0

    def test_p_int_8_base_plates_1_to_1_with_props(self, p_int_8_wall, k4_110_scheme):
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_base_plates == counts.total_props

    def test_p_int_8_prop_heads_1_to_1_with_props(self, p_int_8_wall, k4_110_scheme):
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_prop_heads == counts.total_props

    def test_p_int_8_joint_gaskets_0(self, p_int_8_wall, k4_110_scheme):
        """K4 internal — no joint gaskets per FRB §6 JE-6."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.joint_gasket_meters == 0.0

    def test_p_int_8_starter_track_2_101(self, p_int_8_wall, k4_110_scheme):
        """L=2.101m → 2.101 (single run, no × 2)."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.starter_track_meters == pytest.approx(2.101, rel=1e-9)


# ═════════════════════════════════════════════════════════════════════
# count_components: edge cases
# ═════════════════════════════════════════════════════════════════════


class TestVeryShortWall:
    def test_props_minimum_2_per_side(self, very_short_wall, k4_110_scheme):
        """Wall shorter than prop spacing still gets 2 props per side."""
        counts = count_components(very_short_wall, k4_110_scheme)
        assert counts.props_per_side == 2

    def test_kickers_minimum_1_per_side(self, very_short_wall, k4_110_scheme):
        """0.5m at 600mm spacing → ceil(0.5/0.6)=1 per side."""
        counts = count_components(very_short_wall, k4_110_scheme)
        assert counts.kickers_per_side == 1


class TestLongWall:
    def test_props_long_wall(self, p_int_8_wall, k4_110_scheme):
        """L=10m, spacing=2.0m → props_per_side = max(2, floor(10/2)+1) = 6."""
        long_wall = dataclasses.replace(
            p_int_8_wall, id="LONG", length_mm=10000.0,
        )
        counts = count_components(long_wall, k4_110_scheme)
        assert counts.props_per_side == 6
        assert counts.total_props == 12


class TestK4At3_5m:
    def test_k4_3_5m_has_1_waler(self, k4_at_3_5m_wall):
        """K4 at 3.0-3.6m → waler_count=1, props_per_side × 1 × 2_sides clamps."""
        scheme = find_bracing_scheme("K4-110", 3500)
        counts = count_components(k4_at_3_5m_wall, scheme)
        # L=5.0m, spacing=1.8m → props_per_side = max(2, floor(5.0/1.8)+1) = max(2, 3) = 3
        assert counts.props_per_side == 3
        # walers = waler_count(1) × props_per_side(3) × 2_sides = 6 clamps
        assert counts.total_walers == 6


# ═════════════════════════════════════════════════════════════════════
# K8 + basement: rakers + gaskets fire
# ═════════════════════════════════════════════════════════════════════


class TestK8BasementWall:
    def test_k8_basement_has_rakers(self, p_int_8_wall):
        """K8-200 basement wall → raker_props > 0."""
        k8b = dataclasses.replace(
            p_int_8_wall, id="K8B",
            system="K8-200",
            length_mm=4800.0,
            height_mm=2500,
            bracing_height_class="2.4_to_3.0m",
            inferred_application="basement",
        )
        scheme = find_bracing_scheme("K8-200", 2500)
        counts = count_components(k8b, scheme)
        # ceil(4.8 / 1.2) × 2 = 4 × 2 = 8 raker props
        assert counts.total_raker_props == 8

    def test_k8_basement_has_joint_gaskets(self, p_int_8_wall):
        """K8 basement + multi-panel wall → joint_gasket_meters > 0."""
        k8b = dataclasses.replace(
            p_int_8_wall, id="K8B_G",
            system="K8-200",
            length_mm=4800.0,
            height_mm=2500,
            bracing_height_class="2.4_to_3.0m",
            inferred_application="basement",
        )
        scheme = find_bracing_scheme("K8-200", 2500)
        counts = count_components(k8b, scheme)
        # (panel_count(9) - 1) × height_m(2.5) × 2 sides = 40.0m
        assert counts.joint_gasket_meters == pytest.approx(40.0, rel=1e-9)

    def test_k8_external_no_rakers(self, p_int_8_wall):
        """K8 external (not basement/retaining) → no rakers."""
        k8ext = dataclasses.replace(
            p_int_8_wall, id="K8EXT",
            system="K8-200",
            length_mm=4800.0,
            height_mm=2500,
            bracing_height_class="2.4_to_3.0m",
            inferred_application="external",
        )
        scheme = find_bracing_scheme("K8-200", 2500)
        counts = count_components(k8ext, scheme)
        assert counts.total_raker_props == 0


# ═════════════════════════════════════════════════════════════════════
# Diagonal braces
# ═════════════════════════════════════════════════════════════════════


class TestDiagonalBraces:
    def test_diagonal_when_scheme_says_so(self, p_int_8_wall):
        """K8-250 at 5.0m has has_diagonal=True."""
        tall = dataclasses.replace(
            p_int_8_wall, id="TALL",
            system="K8-250",
            length_mm=4000.0,
            height_mm=5000,
            bracing_height_class="4.5_to_6.0m",
            inferred_application="external",
        )
        scheme = find_bracing_scheme("K8-250", 5000)
        assert scheme.has_diagonal is True
        counts = count_components(tall, scheme)
        # L=4m, spacing=1.2m → props_per_side = max(2, floor(4/1.2)+1) = max(2, 4) = 4
        # diagonals = floor((4-1)/2) × 2 = 1 × 2 = 2
        assert counts.props_per_side == 4
        assert counts.total_diagonals == 2

    def test_no_diagonal_for_short_walls(self, p_int_8_wall, k4_110_scheme):
        """K4 ≤3.0m → no diagonal."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_diagonals == 0


# ═════════════════════════════════════════════════════════════════════
# Error handling
# ═════════════════════════════════════════════════════════════════════


class TestErrorHandling:
    def test_custom_order_wall_raises(self, p_int_8_wall, k4_110_scheme):
        custom = dataclasses.replace(p_int_8_wall, is_custom_order=True)
        with pytest.raises(FormworkInputError, match="is_custom_order"):
            count_components(custom, k4_110_scheme)

    def test_system_mismatch_raises(self, p_int_8_wall):
        """Pass K6 scheme with K4 wall → raises."""
        k6_scheme = find_bracing_scheme("K6-150", 3000)
        with pytest.raises(FormworkInputError, match="system"):
            count_components(p_int_8_wall, k6_scheme)

    def test_height_out_of_scheme_range_raises(self, p_int_8_wall, k4_110_scheme):
        """K4 wall with height 5000mm + 2.4-3.0m scheme → raises."""
        out_of_range = dataclasses.replace(
            p_int_8_wall, height_mm=5000, bracing_height_class="3.0_to_4.5m",
        )
        with pytest.raises(FormworkInputError, match="outside scheme range"):
            count_components(out_of_range, k4_110_scheme)


# ═════════════════════════════════════════════════════════════════════
# ComponentCounts is frozen + pre-wastage
# ═════════════════════════════════════════════════════════════════════


class TestComponentCountsType:
    def test_is_frozen(self, p_int_8_wall, k4_110_scheme):
        counts = count_components(p_int_8_wall, k4_110_scheme)
        with pytest.raises(dataclasses.FrozenInstanceError):
            counts.total_props = 99  # type: ignore[misc]

    def test_no_wastage_applied_yet(self, p_int_8_wall, k4_110_scheme):
        """ComponentCounts holds BASE counts (no wastage). P_INT_8 base props=4 not 5."""
        counts = count_components(p_int_8_wall, k4_110_scheme)
        assert counts.total_props == 4  # NOT 5 (post-wastage value)
