"""Tests for tier6_components builder (PR 2)."""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    CANONICAL_CATEGORY_ORDER,
    build_tier6_components,
    count_components,
    find_bracing_scheme,
)


# ═════════════════════════════════════════════════════════════════════
# CANONICAL ORDER CONSTANT
# ═════════════════════════════════════════════════════════════════════


class TestCanonicalOrder:
    def test_order_constant_value(self):
        assert CANONICAL_CATEGORY_ORDER == (
            "props", "kickers", "base_plates", "prop_heads", "starter_tracks",
            "walers", "diagonal_braces", "corner_clamps", "joint_gaskets",
            "raker_props", "alignment_braces", "misc",
        )

    def test_props_first(self):
        assert CANONICAL_CATEGORY_ORDER[0] == "props"

    def test_misc_last(self):
        assert CANONICAL_CATEGORY_ORDER[-1] == "misc"


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 emission
# ═════════════════════════════════════════════════════════════════════


class TestPInt8Emission:
    def test_p_int_8_emits_5_components(self, p_int_8_components_map):
        """P_INT_8: only props, kickers, base_plates, prop_heads, starter_tracks emitted."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        assert len(result) == 5

    def test_p_int_8_order(self, p_int_8_components_map):
        """Canonical order: PROP → KICK → BP → PH → TRACK."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert skus == ["KZ-PROP-L", "KZ-KICK-01", "KZ-BP-01", "KZ-PH-01", "KZ-TRACK-110"]

    def test_p_int_8_sequential_ids(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        ids = [c.component_id for c in result]
        assert ids == ["C-0001", "C-0002", "C-0003", "C-0004", "C-0005"]

    def test_p_int_8_component_types(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        types = [c.component_type for c in result]
        assert types == ["prop", "kicker", "base_plate", "prop_head", "starter_track"]

    def test_p_int_8_all_wall_segment_id(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        for c in result:
            assert c.wall_segment_id == "P_INT_8"


# ═════════════════════════════════════════════════════════════════════
# Zero-quantity skipping
# ═════════════════════════════════════════════════════════════════════


class TestZeroQuantitySkipping:
    def test_no_walers_emitted(self, p_int_8_components_map):
        """P_INT_8 has total_walers=0 — no waler clamp component."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert not any(s.startswith("KZ-WC-") for s in skus)

    def test_no_diagonal_emitted(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert "KZ-DB-01" not in skus

    def test_no_raker_emitted(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert "KZ-RAKER-01" not in skus

    def test_no_joint_gasket_emitted(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert "KZ-JG-01" not in skus

    def test_no_corner_clamp_emitted(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert not any(s.startswith("KZ-CC-") for s in skus)


# ═════════════════════════════════════════════════════════════════════
# Wastage application
# ═════════════════════════════════════════════════════════════════════


class TestWastage:
    def test_props_5_after_5pct(self, p_int_8_components_map):
        """4 base props × 1.05 = 4.2 → ceil = 5."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        props = [c for c in result if c.sku_code == "KZ-PROP-L"][0]
        assert props.quantity == 5.0

    def test_kickers_9_after_5pct(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        kickers = [c for c in result if c.sku_code == "KZ-KICK-01"][0]
        assert kickers.quantity == 9.0

    def test_track_2_20605_after_5pct(self, p_int_8_components_map):
        """2.101 × 1.05 = 2.20605, rounded to 5 decimals."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        track = [c for c in result if c.sku_code == "KZ-TRACK-110"][0]
        assert track.quantity == 2.20605

    def test_zero_wastage_passes_through(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 0.0)
        props = [c for c in result if c.sku_code == "KZ-PROP-L"][0]
        assert props.quantity == 4.0


# ═════════════════════════════════════════════════════════════════════
# base_quantities_by_sku tracking
# ═════════════════════════════════════════════════════════════════════


class TestBaseTracking:
    def test_base_props_4(self, p_int_8_components_map):
        _, base_by_sku = build_tier6_components(p_int_8_components_map, (), 5.0)
        assert base_by_sku["KZ-PROP-L"] == 4.0

    def test_base_kickers_8(self, p_int_8_components_map):
        _, base_by_sku = build_tier6_components(p_int_8_components_map, (), 5.0)
        assert base_by_sku["KZ-KICK-01"] == 8.0

    def test_base_track_2_101(self, p_int_8_components_map):
        _, base_by_sku = build_tier6_components(p_int_8_components_map, (), 5.0)
        assert base_by_sku["KZ-TRACK-110"] == pytest.approx(2.101, rel=1e-9)


# ═════════════════════════════════════════════════════════════════════
# Source rule citations
# ═════════════════════════════════════════════════════════════════════


class TestSourceRules:
    def test_p_int_8_prop_source_rule(self, p_int_8_components_map):
        """Match PR 1 golden source_rule format."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        props = [c for c in result if c.sku_code == "KZ-PROP-L"][0]
        assert props.source_rule == (
            "FRB Appendix A Card 1 row 2 (K4-110 2.4-3.0m) + FRB §2.1 5% wastage"
        )

    def test_p_int_8_kicker_source_rule(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        kickers = [c for c in result if c.sku_code == "KZ-KICK-01"][0]
        assert kickers.source_rule == (
            "FRB §9.4 RULE BI-14 (K4 600mm) + FRB §2.1 5% wastage"
        )

    def test_p_int_8_starter_track_source_rule_no_double_frb(self, p_int_8_components_map):
        """Tracks have NO 'FRB §2.1' prefix before 'wastage' — golden convention."""
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        track = [c for c in result if c.sku_code == "KZ-TRACK-110"][0]
        assert track.source_rule == (
            "FRB §2.1 item 4 (starter track per wall thickness) + 5% wastage"
        )

    def test_every_component_cites_frb(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        for c in result:
            assert "FRB" in c.source_rule


# ═════════════════════════════════════════════════════════════════════
# Multi-wall + alphabetic ordering
# ═════════════════════════════════════════════════════════════════════


class TestMultiWall:
    def test_two_walls_walls_alphabetic_order(self, p_int_8_wall, k4_110_scheme):
        """WALL_A processed before WALL_B; IDs continue sequentially."""
        from app.services.kos_formwork_generator import count_components

        wall_a = dataclasses.replace(p_int_8_wall, id="A_WALL")
        wall_b = dataclasses.replace(p_int_8_wall, id="B_WALL")
        counts_a = count_components(wall_a, k4_110_scheme)
        counts_b = count_components(wall_b, k4_110_scheme)
        wcm = {
            wall_a.id: (wall_a, k4_110_scheme, counts_a),
            wall_b.id: (wall_b, k4_110_scheme, counts_b),
        }
        result, _ = build_tier6_components(wcm, (), 5.0)
        # First 5 components are A_WALL; next 5 are B_WALL
        for c in result[:5]:
            assert c.wall_segment_id == "A_WALL"
        for c in result[5:10]:
            assert c.wall_segment_id == "B_WALL"
        ids = [c.component_id for c in result]
        assert ids == [f"C-{i:04d}" for i in range(1, 11)]

    def test_multi_wall_base_quantities_summed(self, p_int_8_wall, k4_110_scheme):
        from app.services.kos_formwork_generator import count_components

        wall_a = dataclasses.replace(p_int_8_wall, id="A_WALL")
        wall_b = dataclasses.replace(p_int_8_wall, id="B_WALL")
        counts_a = count_components(wall_a, k4_110_scheme)
        counts_b = count_components(wall_b, k4_110_scheme)
        wcm = {
            wall_a.id: (wall_a, k4_110_scheme, counts_a),
            wall_b.id: (wall_b, k4_110_scheme, counts_b),
        }
        _, base_by_sku = build_tier6_components(wcm, (), 5.0)
        # 4 base props per wall × 2 walls = 8
        assert base_by_sku["KZ-PROP-L"] == 8.0


# ═════════════════════════════════════════════════════════════════════
# Corner clamp emission
# ═════════════════════════════════════════════════════════════════════


class TestCornerClampEmission:
    def test_no_corners_no_clamps(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        skus = [c.sku_code for c in result]
        assert not any(s.startswith("KZ-CC-") for s in skus)

    def test_one_corner_emits_one_clamp(self, p_int_8_wall, k4_110_scheme):
        """1 corner → 1 corner clamp emitted, attributed to first wall."""
        from app.services.kos_formwork_generator import count_corners, count_components

        wall_a = dataclasses.replace(p_int_8_wall, id="WALL_X", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (3000.0, 0.0)))
        wall_b = dataclasses.replace(p_int_8_wall, id="WALL_Y", length_mm=3000.0,
                                      plan_polyline=((0.0, 0.0), (0.0, 3000.0)))
        corners = count_corners((wall_a, wall_b))
        counts_a = count_components(wall_a, k4_110_scheme)
        counts_b = count_components(wall_b, k4_110_scheme)
        wcm = {
            wall_a.id: (wall_a, k4_110_scheme, counts_a),
            wall_b.id: (wall_b, k4_110_scheme, counts_b),
        }
        result, base_by_sku = build_tier6_components(wcm, corners, 5.0)
        cc_comps = [c for c in result if c.component_type == "corner_clamp"]
        assert len(cc_comps) == 1
        assert cc_comps[0].sku_code == "KZ-CC-90-110"
        assert cc_comps[0].wall_segment_id == "WALL_X"  # alphabetically first
        assert "KZ-CC-90-110" in base_by_sku


# ═════════════════════════════════════════════════════════════════════
# SKU derivation
# ═════════════════════════════════════════════════════════════════════


class TestSKUDerivation:
    def test_starter_track_sku_K4(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        track = [c for c in result if c.component_type == "starter_track"][0]
        assert track.sku_code == "KZ-TRACK-110"

    def test_starter_track_sku_K8(self, p_int_8_wall, k4_110_scheme):
        from app.services.kos_formwork_generator import count_components
        k8_wall = dataclasses.replace(
            p_int_8_wall, id="K8W", system="K8-200",
            length_mm=4000.0, height_mm=2500,
            bracing_height_class="2.4_to_3.0m",
            inferred_application="external",
        )
        scheme = find_bracing_scheme("K8-200", 2500)
        counts = count_components(k8_wall, scheme)
        wcm = {k8_wall.id: (k8_wall, scheme, counts)}
        result, _ = build_tier6_components(wcm, (), 5.0)
        track = [c for c in result if c.component_type == "starter_track"][0]
        assert track.sku_code == "KZ-TRACK-200"

    def test_kicker_K4_uses_timber(self, p_int_8_components_map):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        kicker = [c for c in result if c.component_type == "kicker"][0]
        assert kicker.sku_code == "KZ-KICK-01"  # timber

    def test_kicker_K8_uses_steel(self, p_int_8_wall):
        from app.services.kos_formwork_generator import count_components
        k8_wall = dataclasses.replace(
            p_int_8_wall, id="K8K", system="K8-200",
            length_mm=4000.0, height_mm=2500,
            bracing_height_class="2.4_to_3.0m",
            inferred_application="external",
        )
        scheme = find_bracing_scheme("K8-200", 2500)
        counts = count_components(k8_wall, scheme)
        wcm = {k8_wall.id: (k8_wall, scheme, counts)}
        result, _ = build_tier6_components(wcm, (), 5.0)
        kicker = [c for c in result if c.component_type == "kicker"][0]
        assert kicker.sku_code == "KZ-KICK-02"  # steel angle


# ═════════════════════════════════════════════════════════════════════
# Byte-equal vs PR 1 golden
# ═════════════════════════════════════════════════════════════════════


class TestGoldenMatch:
    def test_p_int_8_matches_golden_tier6(
        self, p_int_8_components_map, p_int_8_formwork_golden,
    ):
        result, _ = build_tier6_components(p_int_8_components_map, (), 5.0)
        golden_t6 = p_int_8_formwork_golden["tier_6_components"]
        assert len(result) == len(golden_t6)
        for r, g in zip(result, golden_t6):
            assert dataclasses.asdict(r) == g, (
                f"Component {r.component_id} diverges from golden"
            )
