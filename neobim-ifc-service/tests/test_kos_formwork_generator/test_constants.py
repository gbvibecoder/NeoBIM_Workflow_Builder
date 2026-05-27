"""Tests for constants.py — versions, SKU catalog, defaults."""
from __future__ import annotations

from types import MappingProxyType

import pytest

from app.services.kos_formwork_generator.constants import (
    ASSUMPTIONS_MADE_DEFAULT,
    FIELD_RULE_BOOK_VERSION,
    FORMWORK_CALCULATION_VERSION,
    FORMWORK_SCHEMA_VERSION,
    FORMWORK_SKU_CATALOG,
    FORMWORK_SKU_CODES,
    PENDING_KARTHIK_DEFAULT,
    PIPELINE_VERSIONS_DEFAULT,
    POUR_RATE_DEFAULTS_M_PER_HR,
    POUR_RATE_MAX_M_PER_HR,
    SEISMIC_ZONE_DEFAULT,
    SKU_CATEGORY,
    SKU_DESCRIPTION,
    SKU_FRB_SOURCE,
    SKU_UNIT,
    WASTAGE_PERCENT_DEFAULT,
)


# ═════════════════════════════════════════════════════════════════════
# Version constants
# ═════════════════════════════════════════════════════════════════════


class TestVersionConstants:
    def test_schema_version_is_0_1_0(self):
        assert FORMWORK_SCHEMA_VERSION == "0.1.0"

    def test_schema_version_is_semver(self):
        parts = FORMWORK_SCHEMA_VERSION.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_calculation_version(self):
        assert FORMWORK_CALCULATION_VERSION == "v0.1.0"

    def test_frb_version_contains_v1_0(self):
        assert "v1.0" in FIELD_RULE_BOOK_VERSION
        assert FIELD_RULE_BOOK_VERSION.startswith("KZ-FIELD-RB-001")


# ═════════════════════════════════════════════════════════════════════
# SKU catalog
# ═════════════════════════════════════════════════════════════════════


class TestSKUCatalog:
    EXPECTED_SKU_COUNT = 33  # per DESIGN v2 SKU_CATALOG_ORDER (30 confirmed + 3 placeholder)

    def test_sku_count_matches_design(self):
        actual = len(FORMWORK_SKU_CATALOG)
        assert actual == self.EXPECTED_SKU_COUNT, (
            f"Got {actual} SKUs, expected {self.EXPECTED_SKU_COUNT} "
            f"per DESIGN v2 SKU_CATALOG_ORDER structural declaration"
        )

    def test_no_wedge_ties(self):
        sku_codes = [e[0] for e in FORMWORK_SKU_CATALOG]
        assert not any("WEDGE" in c.upper() for c in sku_codes)

    def test_no_tie_rods(self):
        sku_codes = [e[0] for e in FORMWORK_SKU_CATALOG]
        assert "KZ-TIE-01" not in sku_codes

    def test_no_sealant(self):
        """KZ-SEAL-01 dropped per DESIGN v2 §7.6 — out of formwork-quantity scope."""
        sku_codes = [e[0] for e in FORMWORK_SKU_CATALOG]
        assert "KZ-SEAL-01" not in sku_codes

    def test_no_base_plate_timber(self):
        """DESIGN v2 doc 00 §8: 'Always KZ-BP-01' — timber sole plate not Kalzen-stocked."""
        sku_codes = [e[0] for e in FORMWORK_SKU_CATALOG]
        assert "KZ-BP-TIMBER" not in sku_codes

    def test_sku_codes_unique(self):
        sku_codes = [e[0] for e in FORMWORK_SKU_CATALOG]
        assert len(sku_codes) == len(set(sku_codes))

    def test_all_4_props_present(self):
        prop_skus = sorted(
            e[0] for e in FORMWORK_SKU_CATALOG if e[0].startswith("KZ-PROP-")
        )
        assert prop_skus == ["KZ-PROP-H", "KZ-PROP-L", "KZ-PROP-M", "KZ-PROP-XH"]

    def test_all_5_track_thicknesses(self):
        track_skus = sorted(
            e[0] for e in FORMWORK_SKU_CATALOG if e[0].startswith("KZ-TRACK-")
        )
        assert track_skus == [
            "KZ-TRACK-110", "KZ-TRACK-150", "KZ-TRACK-180",
            "KZ-TRACK-200", "KZ-TRACK-250",
        ]

    def test_all_5_waler_clamps(self):
        wc_skus = sorted(
            e[0] for e in FORMWORK_SKU_CATALOG if e[0].startswith("KZ-WC-")
        )
        assert wc_skus == [
            "KZ-WC-110", "KZ-WC-150", "KZ-WC-180", "KZ-WC-200", "KZ-WC-250",
        ]

    def test_all_10_corner_clamps(self):
        cc_skus = sorted(
            e[0] for e in FORMWORK_SKU_CATALOG if e[0].startswith("KZ-CC-")
        )
        assert len(cc_skus) == 10

    def test_includes_3_placeholder_skus(self):
        sku_codes = {e[0] for e in FORMWORK_SKU_CATALOG}
        assert "KZ-RAKER-01" in sku_codes
        assert "KZ-TURN-01" in sku_codes
        assert "KZ-ALIGN-01" in sku_codes

    def test_includes_joint_gasket(self):
        sku_codes = {e[0] for e in FORMWORK_SKU_CATALOG}
        assert "KZ-JG-01" in sku_codes

    def test_includes_diagonal_brace(self):
        sku_codes = {e[0] for e in FORMWORK_SKU_CATALOG}
        assert "KZ-DB-01" in sku_codes


class TestSKUCatalogStructure:
    """Validate the 5-field structure of every SKU entry."""

    def test_every_entry_has_5_fields(self):
        for i, entry in enumerate(FORMWORK_SKU_CATALOG):
            assert len(entry) == 5, f"Entry {i} malformed: {entry}"

    def test_every_unit_valid(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert entry[2] in ("nos", "linear_m"), (
                f"SKU {entry[0]} has invalid unit: {entry[2]!r}"
            )

    def test_every_description_non_empty(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert isinstance(entry[3], str) and entry[3].strip(), (
                f"SKU {entry[0]} has empty description"
            )

    def test_every_entry_cites_frb(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert entry[4].startswith("FRB"), (
                f"SKU {entry[0]} missing FRB citation: {entry[4]!r}"
            )

    def test_sku_codes_frozenset_consistency(self):
        assert len(FORMWORK_SKU_CODES) == len(FORMWORK_SKU_CATALOG)
        for entry in FORMWORK_SKU_CATALOG:
            assert entry[0] in FORMWORK_SKU_CODES


# ═════════════════════════════════════════════════════════════════════
# SKU lookup helpers (immutable mappings)
# ═════════════════════════════════════════════════════════════════════


class TestSKULookupHelpers:
    def test_sku_description_consistent(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert SKU_DESCRIPTION[entry[0]] == entry[3]

    def test_sku_unit_consistent(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert SKU_UNIT[entry[0]] == entry[2]

    def test_sku_category_consistent(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert SKU_CATEGORY[entry[0]] == entry[1]

    def test_sku_frb_source_consistent(self):
        for entry in FORMWORK_SKU_CATALOG:
            assert SKU_FRB_SOURCE[entry[0]] == entry[4]

    def test_sku_description_immutable(self):
        with pytest.raises(TypeError):
            SKU_DESCRIPTION["KZ-PROP-L"] = "tampered"  # type: ignore[index]


# ═════════════════════════════════════════════════════════════════════
# pending_karthik (4 items)
# ═════════════════════════════════════════════════════════════════════


class TestPendingKarthik:
    def test_has_exactly_4_items(self):
        assert len(PENDING_KARTHIK_DEFAULT) == 4

    def test_is_tuple(self):
        assert isinstance(PENDING_KARTHIK_DEFAULT, tuple)

    def test_mentions_joint_gasket(self):
        joined = " ".join(PENDING_KARTHIK_DEFAULT).lower()
        assert "joint gasket" in joined

    def test_mentions_raker(self):
        joined = " ".join(PENDING_KARTHIK_DEFAULT).lower()
        assert "raker" in joined

    def test_mentions_vamshi(self):
        joined = " ".join(PENDING_KARTHIK_DEFAULT).lower()
        assert "vamshi" in joined

    def test_no_pricing_mentions(self):
        """Lease model — pending_karthik should not mention prices."""
        joined = " ".join(PENDING_KARTHIK_DEFAULT).lower()
        assert "price" not in joined, "pending_karthik mentions 'price' (forbidden — lease model)"

    def test_no_weight_mentions(self):
        joined = " ".join(PENDING_KARTHIK_DEFAULT).lower()
        assert "weight" not in joined, "pending_karthik mentions 'weight' (forbidden — lease model)"


# ═════════════════════════════════════════════════════════════════════
# Defaults
# ═════════════════════════════════════════════════════════════════════


class TestDefaults:
    def test_wastage_5_percent(self):
        assert WASTAGE_PERCENT_DEFAULT == 5.0

    def test_seismic_zone_III(self):
        assert SEISMIC_ZONE_DEFAULT == "III"

    def test_pour_rate_defaults_5_systems(self):
        assert set(POUR_RATE_DEFAULTS_M_PER_HR.keys()) == {
            "K4-110", "K6-150", "K6-180", "K8-200", "K8-250",
        }

    def test_pour_rate_max_5_systems(self):
        assert set(POUR_RATE_MAX_M_PER_HR.keys()) == {
            "K4-110", "K6-150", "K6-180", "K8-200", "K8-250",
        }

    def test_pour_rate_immutable(self):
        with pytest.raises(TypeError):
            POUR_RATE_DEFAULTS_M_PER_HR["K4-110"] = 99.0  # type: ignore[index]

    def test_assumptions_has_quantity_only_policy(self):
        joined = " ".join(ASSUMPTIONS_MADE_DEFAULT).lower()
        assert "quantity-only" in joined

    def test_assumptions_is_tuple(self):
        assert isinstance(ASSUMPTIONS_MADE_DEFAULT, tuple)

    def test_pipeline_versions_is_tuple_of_tuples(self):
        assert isinstance(PIPELINE_VERSIONS_DEFAULT, tuple)
        for entry in PIPELINE_VERSIONS_DEFAULT:
            assert isinstance(entry, tuple)
            assert len(entry) == 2
            assert isinstance(entry[0], str)
            assert isinstance(entry[1], str)

    def test_pipeline_versions_alphabetical(self):
        names = [entry[0] for entry in PIPELINE_VERSIONS_DEFAULT]
        assert names == sorted(names), "pipeline_versions must be alphabetical"
