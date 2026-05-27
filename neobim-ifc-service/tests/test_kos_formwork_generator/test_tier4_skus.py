"""Tests for tier4_skus builder (PR 2)."""
from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_formwork_generator import (
    build_tier4_skus,
    build_tier6_components,
    count_components,
)
from app.services.kos_formwork_generator.tier4_skus import (
    _derive_sku_prefix,
    _derive_thickness_mm,
)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 baseline
# ═════════════════════════════════════════════════════════════════════


class TestPInt8:
    def test_5_unique_skus(self, p_int_8_components_map):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        assert len(tier_4) == 5

    def test_props_breakdown(self, p_int_8_components_map):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        props = [t for t in tier_4 if t.sku_code == "KZ-PROP-L"][0]
        assert props.base_quantity == 4.0
        assert props.total_quantity == 5.0
        assert props.wastage_quantity == 1.0
        assert props.unit == "nos"

    def test_kickers_breakdown(self, p_int_8_components_map):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        kickers = [t for t in tier_4 if t.sku_code == "KZ-KICK-01"][0]
        assert kickers.base_quantity == 8.0
        assert kickers.total_quantity == 9.0
        assert kickers.wastage_quantity == 1.0

    def test_track_breakdown_linear(self, p_int_8_components_map):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        track = [t for t in tier_4 if t.sku_code == "KZ-TRACK-110"][0]
        assert track.base_quantity == 2.101
        assert track.total_quantity == 2.20605
        assert track.wastage_quantity == 0.10505
        assert track.unit == "linear_m"

    def test_tier6_first_occurrence_order_preserved(self, p_int_8_components_map):
        """Tier 4 order matches Tier 6 first-occurrence: PROP, KICK, BP, PH, TRACK."""
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        skus = [t.sku_code for t in tier_4]
        assert skus == ["KZ-PROP-L", "KZ-KICK-01", "KZ-BP-01", "KZ-PH-01", "KZ-TRACK-110"]


# ═════════════════════════════════════════════════════════════════════
# Description lookup
# ═════════════════════════════════════════════════════════════════════


class TestDescriptionLookup:
    def test_p_int_8_descriptions(self, p_int_8_components_map):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        desc_by_sku = {t.sku_code: t.description for t in tier_4}
        assert desc_by_sku["KZ-PROP-L"] == "Light-duty prop (yellow label, K4/K6 ≤3.0m)"
        assert desc_by_sku["KZ-KICK-01"] == "Kicker (timber, K4 600mm / K6 600/400mm)"
        assert desc_by_sku["KZ-BP-01"] == "Base plate (steel, 1 per prop on hard surface)"


# ═════════════════════════════════════════════════════════════════════
# sku_prefix derivation
# ═════════════════════════════════════════════════════════════════════


class TestSKUPrefixDerivation:
    @pytest.mark.parametrize("sku,expected_prefix", [
        ("KZ-PROP-L", "PROP"),
        ("KZ-PROP-XH", "PROP"),
        ("KZ-KICK-01", "KICK"),
        ("KZ-KICK-02", "KICK"),
        ("KZ-CC-90-150", "CC"),
        ("KZ-CC-T-200", "CC"),
        ("KZ-CC-135-150", "CC"),
        ("KZ-TRACK-110", "TRACK"),
        ("KZ-PH-01", "PH"),
        ("KZ-BP-01", "BP"),
        ("KZ-WC-200", "WC"),
        ("KZ-DB-01", "DB"),
        ("KZ-JG-01", "JG"),
        ("KZ-RAKER-01", "RAKER"),
        ("KZ-TURN-01", "TURN"),
        ("KZ-ALIGN-01", "ALIGN"),
    ])
    def test_derive_prefix(self, sku, expected_prefix):
        assert _derive_sku_prefix(sku) == expected_prefix


# ═════════════════════════════════════════════════════════════════════
# thickness_mm derivation
# ═════════════════════════════════════════════════════════════════════


class TestThicknessDerivation:
    @pytest.mark.parametrize("sku,expected_thickness", [
        ("KZ-TRACK-110", 110),
        ("KZ-TRACK-150", 150),
        ("KZ-TRACK-180", 180),
        ("KZ-TRACK-200", 200),
        ("KZ-TRACK-250", 250),
        ("KZ-WC-110", 110),
        ("KZ-WC-150", 150),
        ("KZ-WC-200", 200),
        ("KZ-CC-90-110", 110),
        ("KZ-CC-90-200", 200),
        ("KZ-CC-T-250", 250),
        ("KZ-CC-135-150", 150),
        ("KZ-PROP-L", 0),
        ("KZ-PROP-XH", 0),
        ("KZ-KICK-01", 0),
        ("KZ-KICK-02", 0),
        ("KZ-PH-01", 0),
        ("KZ-BP-01", 0),
        ("KZ-DB-01", 0),
        ("KZ-JG-01", 0),
        ("KZ-RAKER-01", 0),
        ("KZ-TURN-01", 0),
        ("KZ-ALIGN-01", 0),
    ])
    def test_derive_thickness(self, sku, expected_thickness):
        assert _derive_thickness_mm(sku) == expected_thickness


# ═════════════════════════════════════════════════════════════════════
# Multi-wall aggregation
# ═════════════════════════════════════════════════════════════════════


class TestMultiWallAggregation:
    def test_two_walls_aggregated_per_sku(self, p_int_8_wall, k4_110_scheme):
        wall_a = dataclasses.replace(p_int_8_wall, id="A_W")
        wall_b = dataclasses.replace(p_int_8_wall, id="B_W")
        counts_a = count_components(wall_a, k4_110_scheme)
        counts_b = count_components(wall_b, k4_110_scheme)
        wcm = {wall_a.id: (wall_a, k4_110_scheme, counts_a),
               wall_b.id: (wall_b, k4_110_scheme, counts_b)}
        tier_6, base = build_tier6_components(wcm, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        # 2 walls × 4 props each = 8 base, ceil(4 * 1.05) × 2 walls = 10 total
        props = [t for t in tier_4 if t.sku_code == "KZ-PROP-L"][0]
        assert props.base_quantity == 8.0
        assert props.total_quantity == 10.0


# ═════════════════════════════════════════════════════════════════════
# Byte-equal vs PR 1 golden
# ═════════════════════════════════════════════════════════════════════


class TestGoldenMatch:
    def test_p_int_8_matches_golden_tier4(self, p_int_8_components_map, p_int_8_formwork_golden):
        tier_6, base = build_tier6_components(p_int_8_components_map, (), 5.0)
        tier_4 = build_tier4_skus(tier_6, base)
        golden_t4 = p_int_8_formwork_golden["tier_4_sku_details"]
        assert len(tier_4) == len(golden_t4)
        for r, g in zip(tier_4, golden_t4):
            assert dataclasses.asdict(r) == g
