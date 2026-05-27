"""Tests for P_INT_8 formwork golden file — schema + content + byte-equal contract."""
from __future__ import annotations

import json
import uuid
from pathlib import Path


# ═════════════════════════════════════════════════════════════════════
# File existence + encoding
# ═════════════════════════════════════════════════════════════════════


class TestGoldenFileExists:
    def test_file_exists(self, p_int_8_formwork_golden_path: Path):
        assert p_int_8_formwork_golden_path.exists(), (
            f"Golden file missing at {p_int_8_formwork_golden_path}"
        )

    def test_file_is_utf8(self, p_int_8_formwork_golden_path: Path):
        content = p_int_8_formwork_golden_path.read_bytes()
        content.decode("utf-8")  # raises if not UTF-8

    def test_file_has_trailing_newline(self, p_int_8_formwork_golden_path: Path):
        content = p_int_8_formwork_golden_path.read_bytes()
        assert content.endswith(b"\n"), "Golden file missing trailing newline"

    def test_no_substitution_placeholders(self, p_int_8_formwork_golden_path: Path):
        """Ensure all <<<SUBSTITUTE...>>> markers were replaced."""
        content = p_int_8_formwork_golden_path.read_text(encoding="utf-8")
        assert "<<<SUBSTITUTE" not in content


# ═════════════════════════════════════════════════════════════════════
# Top-level structure (15 keys per DESIGN v2 §4)
# ═════════════════════════════════════════════════════════════════════


class TestGoldenTopLevel:
    EXPECTED_KEYS = {
        "formwork_id", "generated_at", "schema_version",
        "tier_1_summary", "tier_2_categories",
        "tier_3_sku_types", "tier_4_sku_details",
        "tier_5_wall_segments", "tier_6_components",
        "custom_quote_items", "operator_review_items",
        "audit_trail",
        "warnings", "assumptions_made", "pending_karthik",
    }

    def test_has_15_top_level_keys(self, p_int_8_formwork_golden: dict):
        actual = set(p_int_8_formwork_golden.keys())
        assert actual == self.EXPECTED_KEYS, (
            f"Keys mismatch.\n"
            f"  Missing: {self.EXPECTED_KEYS - actual}\n"
            f"  Extra:   {actual - self.EXPECTED_KEYS}"
        )

    def test_key_count_is_15(self, p_int_8_formwork_golden: dict):
        assert len(p_int_8_formwork_golden) == 15

    def test_no_commercial_terms(self, p_int_8_formwork_golden: dict):
        assert "commercial_terms" not in p_int_8_formwork_golden

    def test_no_top_level_hashes(self, p_int_8_formwork_golden: dict):
        """Decision 8 v2: hashes inside audit_trail."""
        assert "mapper_output_hash" not in p_int_8_formwork_golden
        assert "context_hash" not in p_int_8_formwork_golden

    def test_schema_version(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["schema_version"] == "0.1.0"

    def test_generated_at(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["generated_at"] == "2026-05-25T00:00:00Z"


# ═════════════════════════════════════════════════════════════════════
# Hash + ID validity
# ═════════════════════════════════════════════════════════════════════


class TestGoldenHashes:
    def test_formwork_id_is_valid_uuid(self, p_int_8_formwork_golden: dict):
        uuid.UUID(p_int_8_formwork_golden["formwork_id"])

    def test_formwork_id_matches_preflight_e(self, p_int_8_formwork_golden: dict):
        """Pre-flight E computed: 8fad4da7-12da-5686-9373-a1c252f2b1ba."""
        assert p_int_8_formwork_golden["formwork_id"] == "8fad4da7-12da-5686-9373-a1c252f2b1ba"

    def test_audit_trail_has_hashes(self, p_int_8_formwork_golden: dict):
        at = p_int_8_formwork_golden["audit_trail"]
        assert "mapper_output_hash" in at
        assert "context_hash" in at

    def test_mapper_output_hash_is_64_hex(self, p_int_8_formwork_golden: dict):
        h = p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"]
        assert len(h) == 64
        int(h, 16)  # validates hex

    def test_context_hash_is_64_hex(self, p_int_8_formwork_golden: dict):
        h = p_int_8_formwork_golden["audit_trail"]["context_hash"]
        assert len(h) == 64
        int(h, 16)

    def test_mapper_output_hash_matches_boq(self, p_int_8_formwork_golden: dict):
        """5F mapper_output_hash MUST equal BOQ's (same P_INT_8 input)."""
        boq_path = Path(__file__).parent.parent / "test_kos_boq_generator" / "golden" / "p_int_8_boq_canonical.json"
        assert boq_path.exists(), "BOQ golden missing — needed for byte-equal contract"
        boq_golden = json.loads(boq_path.read_text(encoding="utf-8"))
        assert (
            p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"]
            == boq_golden["audit_trail"]["mapper_output_hash"]
        ), (
            "5F mapper_output_hash diverges from BOQ. Both consume identical P_INT_8 "
            "mapper output — hashes MUST match (Decision 8 v2 byte-equal contract)."
        )

    def test_mapper_output_hash_value(self, p_int_8_formwork_golden: dict):
        """Confirmed by Pre-flight C + E (re-computed against mapper canonical)."""
        expected = "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"
        assert p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"] == expected

    def test_context_hash_value(self, p_int_8_formwork_golden: dict):
        """Computed in Pre-flight E from canonical FormworkContext serialization."""
        expected = "1ca9e2049ae72129f2958354b205f052295cfa6d3843264a7b2650228dccd727"
        assert p_int_8_formwork_golden["audit_trail"]["context_hash"] == expected


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 quantities (per DESIGN v2 doc 04 walkthrough)
# ═════════════════════════════════════════════════════════════════════


class TestPInt8Quantities:
    """P_INT_8 = single K4-110 wall, 2101mm × 3.0m, 9 panels.

    Expected quantities (DESIGN v2 doc 04 §6):
      props=5, kickers=9, base_plates=5, prop_heads=5, starter_track=2.20605m.
    """

    def test_total_props(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["tier_1_summary"]["total_props"] == 5

    def test_total_kickers(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["tier_1_summary"]["total_kickers"] == 9

    def test_total_base_plates(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["tier_1_summary"]["total_base_plates"] == 5

    def test_total_prop_heads(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["tier_1_summary"]["total_prop_heads"] == 5

    def test_starter_track_meters(self, p_int_8_formwork_golden: dict):
        """2.101m × 1.05 wastage = 2.20605m."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_starter_track_meters"] == 2.20605

    def test_no_walers(self, p_int_8_formwork_golden: dict):
        """K4 RULE BI-9: walers only for height > 3.0m strict; P_INT_8 is exactly 3.0m."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_walers"] == 0

    def test_no_diagonal_braces(self, p_int_8_formwork_golden: dict):
        """K4 + height ≤ 4.5m + seismic III → no diagonal."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_diagonal_braces"] == 0

    def test_no_raker_props(self, p_int_8_formwork_golden: dict):
        """Not K8 + basement → no raker."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_raker_props"] == 0

    def test_no_joint_gaskets(self, p_int_8_formwork_golden: dict):
        """K4 internal → no gasket per FRB §6 JE-6."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_joint_gasket_meters"] == 0

    def test_no_corner_clamps(self, p_int_8_formwork_golden: dict):
        """Free-standing wall (polyline endpoints) → 0 corners."""
        assert p_int_8_formwork_golden["tier_1_summary"]["total_corner_clamps"] == 0
        assert p_int_8_formwork_golden["tier_1_summary"]["total_corners_detected"] == 0

    def test_single_wall_segment(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["tier_1_summary"]["total_wall_segments_with_bracing"] == 1


# ═════════════════════════════════════════════════════════════════════
# Tier-6 ordering convention (PR 2-5 must follow)
# ═════════════════════════════════════════════════════════════════════


class TestTier6Components:
    def test_count_is_5(self, p_int_8_formwork_golden: dict):
        assert len(p_int_8_formwork_golden["tier_6_components"]) == 5

    def test_canonical_order(self, p_int_8_formwork_golden: dict):
        """Per types.py docstring: prop → kicker → base_plate → prop_head → starter_track."""
        components = p_int_8_formwork_golden["tier_6_components"]
        expected_skus = [
            "KZ-PROP-L", "KZ-KICK-01", "KZ-BP-01", "KZ-PH-01", "KZ-TRACK-110",
        ]
        actual_skus = [c["sku_code"] for c in components]
        assert actual_skus == expected_skus

    def test_sequential_component_ids(self, p_int_8_formwork_golden: dict):
        components = p_int_8_formwork_golden["tier_6_components"]
        ids = [c["component_id"] for c in components]
        assert ids == ["C-0001", "C-0002", "C-0003", "C-0004", "C-0005"]

    def test_every_component_cites_frb(self, p_int_8_formwork_golden: dict):
        for c in p_int_8_formwork_golden["tier_6_components"]:
            assert "FRB" in c["source_rule"]


# ═════════════════════════════════════════════════════════════════════
# Other top-level fields
# ═════════════════════════════════════════════════════════════════════


class TestGoldenOtherFields:
    def test_custom_quote_items_empty(self, p_int_8_formwork_golden: dict):
        """P_INT_8 has no custom routing triggered."""
        assert p_int_8_formwork_golden["custom_quote_items"] == []

    def test_operator_review_items_empty(self, p_int_8_formwork_golden: dict):
        """For PR 1 golden, operator_review_items is empty (PR 4 will populate)."""
        assert p_int_8_formwork_golden["operator_review_items"] == []

    def test_pending_karthik_has_4_items(self, p_int_8_formwork_golden: dict):
        assert len(p_int_8_formwork_golden["pending_karthik"]) == 4

    def test_assumptions_made_present(self, p_int_8_formwork_golden: dict):
        assumptions = p_int_8_formwork_golden["assumptions_made"]
        assert len(assumptions) >= 4
        joined = " ".join(assumptions).lower()
        assert "audit-trail" in joined or "audit_trail" in joined

    def test_warnings_empty(self, p_int_8_formwork_golden: dict):
        assert p_int_8_formwork_golden["warnings"] == []


# ═════════════════════════════════════════════════════════════════════
# Byte-equal reproducibility (PR 5 contract foundation)
# ═════════════════════════════════════════════════════════════════════


class TestGoldenByteEquality:
    def test_keys_sorted_at_all_levels(self, p_int_8_formwork_golden_path: Path):
        """Re-serializing with sort_keys=True must reproduce identical content."""
        on_disk = p_int_8_formwork_golden_path.read_text(encoding="utf-8")
        parsed = json.loads(on_disk)
        re_serialized = (
            json.dumps(parsed, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
        )
        assert re_serialized == on_disk, (
            "Golden file is not byte-equal with sort_keys=True re-serialization. "
            "Ensure golden was written via "
            "json.dumps(d, sort_keys=True, indent=2, ensure_ascii=False) + '\\n'."
        )


# ═════════════════════════════════════════════════════════════════════
# Mapper-output-hash recomputation (cross-validates conftest fixture)
# ═════════════════════════════════════════════════════════════════════


class TestConfftestFixtureMatchesGolden:
    """The fixture must reconstruct an output whose hash matches the golden."""

    def test_fixture_hash_matches_golden(
        self,
        p_int_8_mapper_output_hash: str,
        p_int_8_formwork_golden: dict,
    ):
        """Live reconstruction (conftest) must reproduce the golden hash."""
        assert (
            p_int_8_mapper_output_hash
            == p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"]
        )
