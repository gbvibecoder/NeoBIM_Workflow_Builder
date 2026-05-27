"""Tests for lookup_tables.py — BRACING_LOOKUP_TABLE (16 entries per FRB Card 1)."""
from __future__ import annotations

import pytest

from app.services.kos_formwork_generator.lookup_tables import BRACING_LOOKUP_TABLE
from app.services.kos_formwork_generator.types import BracingScheme


# ═════════════════════════════════════════════════════════════════════
# Structural tests
# ═════════════════════════════════════════════════════════════════════


class TestLookupTableStructure:
    def test_has_16_entries(self):
        assert len(BRACING_LOOKUP_TABLE) == 16, (
            f"Got {len(BRACING_LOOKUP_TABLE)} entries; FRB Appendix A Card 1 has 16."
        )

    def test_all_entries_are_bracing_scheme(self):
        for i, scheme in enumerate(BRACING_LOOKUP_TABLE):
            assert isinstance(scheme, BracingScheme), (
                f"Entry {i} is not a BracingScheme: {type(scheme).__name__}"
            )

    def test_systems_covered(self):
        systems = {s.system for s in BRACING_LOOKUP_TABLE}
        assert systems == {"K4-110", "K6-150", "K6-180", "K8-200", "K8-250"}


class TestLookupTablePerSystemCounts:
    """FRB Appendix A Card 1 breakdown: K4(3) + K6-150(4) + K6-180(3) + K8-200(3) + K8-250(3) = 16."""

    def test_k4_count_3(self):
        k4 = [s for s in BRACING_LOOKUP_TABLE if s.system == "K4-110"]
        assert len(k4) == 3

    def test_k6_150_count_4(self):
        k6 = [s for s in BRACING_LOOKUP_TABLE if s.system == "K6-150"]
        assert len(k6) == 4

    def test_k6_180_count_3(self):
        k6 = [s for s in BRACING_LOOKUP_TABLE if s.system == "K6-180"]
        assert len(k6) == 3

    def test_k8_200_count_3(self):
        k8 = [s for s in BRACING_LOOKUP_TABLE if s.system == "K8-200"]
        assert len(k8) == 3

    def test_k8_250_count_3(self):
        k8 = [s for s in BRACING_LOOKUP_TABLE if s.system == "K8-250"]
        assert len(k8) == 3


# ═════════════════════════════════════════════════════════════════════
# Per-row content tests (FRB ground truth)
# ═════════════════════════════════════════════════════════════════════


class TestSpecificSchemes:
    def test_p_int_8_scheme(self):
        """P_INT_8: K4-110 at exactly 3.0m height → row 2 (2.4-3.0m).

        Expected: L prop @ 2.0m, 0 walers, 600mm kickers, 1 lift, no diagonal.
        """
        candidates = [
            s for s in BRACING_LOOKUP_TABLE
            if s.system == "K4-110"
            and s.height_range_min_m == 2.4
            and s.height_range_max_m == 3.0
        ]
        assert len(candidates) == 1, f"Expected 1 K4-110 scheme for 2.4-3.0m, got {len(candidates)}"
        s = candidates[0]
        assert s.prop_sku == "KZ-PROP-L"
        assert s.prop_type == "L"
        assert s.prop_spacing_m == 2.0
        assert s.waler_count == 0
        assert s.waler_position == "N/A"
        assert s.kicker_spacing_mm == 600
        assert s.lifts == 1
        assert s.has_diagonal is False

    def test_k4_110_le_2_4m(self):
        cs = [s for s in BRACING_LOOKUP_TABLE if s.system == "K4-110" and s.height_range_max_m == 2.4]
        assert len(cs) == 1
        s = cs[0]
        assert s.prop_type == "L"
        assert s.prop_spacing_m == 2.4
        assert s.waler_count == 0

    def test_k8_250_high_uses_xh_prop(self):
        """K8-250 at 4.5-6.0m uses XH prop + diagonal."""
        cs = [
            s for s in BRACING_LOOKUP_TABLE
            if s.system == "K8-250" and s.height_range_min_m == 4.5
        ]
        assert len(cs) == 1
        s = cs[0]
        assert s.prop_type == "XH"
        assert s.prop_sku == "KZ-PROP-XH"
        assert s.lifts == 2
        assert s.has_diagonal is True

    def test_k8_200_high_uses_h_prop_with_diagonal(self):
        cs = [
            s for s in BRACING_LOOKUP_TABLE
            if s.system == "K8-200" and s.height_range_min_m == 4.5
        ]
        assert len(cs) == 1
        s = cs[0]
        assert s.prop_type == "H"
        assert s.has_diagonal is True
        assert s.lifts == 2


class TestKickerSpacing:
    def test_k4_kicker_600mm(self):
        for s in BRACING_LOOKUP_TABLE:
            if s.system == "K4-110":
                assert s.kicker_spacing_mm == 600, f"K4-110 should be 600mm, got {s.kicker_spacing_mm}"

    def test_k6_kicker_600mm(self):
        for s in BRACING_LOOKUP_TABLE:
            if s.system.startswith("K6"):
                assert s.kicker_spacing_mm == 600, (
                    f"{s.system} should be 600mm (above-ground), got {s.kicker_spacing_mm}"
                )

    def test_k8_kicker_400mm(self):
        for s in BRACING_LOOKUP_TABLE:
            if s.system.startswith("K8"):
                assert s.kicker_spacing_mm == 400, f"{s.system} should be 400mm"


# ═════════════════════════════════════════════════════════════════════
# Integrity invariants
# ═════════════════════════════════════════════════════════════════════


class TestLookupTableIntegrity:
    def test_every_scheme_cites_frb(self):
        for s in BRACING_LOOKUP_TABLE:
            assert "FRB" in s.frb_source

    def test_no_duplicate_scheme_keys(self):
        keys = [(s.system, s.height_range_min_m, s.height_range_max_m) for s in BRACING_LOOKUP_TABLE]
        assert len(keys) == len(set(keys))

    def test_all_height_ranges_valid(self):
        """min < max for every scheme."""
        for s in BRACING_LOOKUP_TABLE:
            assert s.height_range_min_m < s.height_range_max_m, (
                f"Invalid range in {s.system}: {s.height_range_min_m}-{s.height_range_max_m}"
            )

    def test_height_ranges_within_system_contiguous_or_gapped(self):
        """Within a system, schemes should not overlap (gaps OK)."""
        for system in {s.system for s in BRACING_LOOKUP_TABLE}:
            ranges = sorted(
                (s.height_range_min_m, s.height_range_max_m)
                for s in BRACING_LOOKUP_TABLE
                if s.system == system
            )
            for i in range(len(ranges) - 1):
                assert ranges[i + 1][0] >= ranges[i][1], (
                    f"Overlap in {system}: {ranges[i]} and {ranges[i+1]}"
                )

    def test_diagonals_only_at_high_heights(self):
        """has_diagonal=True only when min height >= 4.5m."""
        for s in BRACING_LOOKUP_TABLE:
            if s.has_diagonal:
                assert s.height_range_min_m >= 4.5, (
                    f"Diagonal at {s.height_range_min_m}m for {s.system} — unexpected"
                )

    def test_lifts_2_only_for_tall_walls(self):
        """2-lift schemes only at min height >= 3.6m."""
        for s in BRACING_LOOKUP_TABLE:
            if s.lifts == 2:
                assert s.height_range_min_m >= 3.6, (
                    f"2-lift at {s.height_range_min_m}m for {s.system}"
                )

    def test_lifts_value_valid(self):
        for s in BRACING_LOOKUP_TABLE:
            assert s.lifts in (1, 2)

    def test_prop_type_valid(self):
        for s in BRACING_LOOKUP_TABLE:
            assert s.prop_type in ("L", "M", "H", "XH")

    def test_prop_sku_matches_type(self):
        """prop_sku format: KZ-PROP-{type}."""
        for s in BRACING_LOOKUP_TABLE:
            assert s.prop_sku == f"KZ-PROP-{s.prop_type}"
