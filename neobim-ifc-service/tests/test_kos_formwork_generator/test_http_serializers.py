"""PR 6: tests for http_serializers.

Covers:
* format_formwork_output_json — happy path, tuple/list normalization, JSON round-trip
* dict_to_panel_grid_mapper_output — recursive deserialization
* dict_to_formwork_context — context deserialization
* Strings atomic (not recursed into chars)
* Purity (no mutation of input)
* Error paths (wrong type, malformed dict)
"""
from __future__ import annotations

import dataclasses
import json

import pytest

from app.services.kos_formwork_generator import (
    dict_to_formwork_context,
    dict_to_panel_grid_mapper_output,
    format_formwork_output_json,
    FormworkContext,
)
from app.services.kos_formwork_generator.types import FormworkGeneratorOutput
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput


# ═════════════════════════════════════════════════════════════════════
# format_formwork_output_json — HAPPY PATH
# ═════════════════════════════════════════════════════════════════════


class TestSerializerHappyPath:
    def test_p_int_8_serializes_to_dict(self, p_int_8_full_output):
        result = format_formwork_output_json(p_int_8_full_output)
        assert isinstance(result, dict)

    def test_p_int_8_tiers_byte_equal_vs_golden(
        self, p_int_8_full_output, p_int_8_formwork_golden,
    ):
        """PR 4 fixture omits assumptions/pending. Tier fields + audit + ids must match."""
        result = format_formwork_output_json(p_int_8_full_output)
        for tier_key in (
            "formwork_id", "generated_at", "schema_version",
            "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
            "tier_4_sku_details", "tier_5_wall_segments", "tier_6_components",
            "custom_quote_items", "operator_review_items", "audit_trail",
        ):
            assert result[tier_key] == p_int_8_formwork_golden[tier_key], (
                f"{tier_key} mismatch"
            )

    def test_round_trip_via_json(self, p_int_8_full_output):
        result = format_formwork_output_json(p_int_8_full_output)
        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        assert parsed == result

    def test_serialized_has_all_16_fields(self, p_int_8_full_output):
        result = format_formwork_output_json(p_int_8_full_output)
        expected_fields = {
            "formwork_id", "generated_at", "schema_version",
            "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
            "tier_4_sku_details", "tier_5_wall_segments", "tier_6_components",
            "custom_quote_items", "operator_review_items", "audit_trail",
            "warnings", "assumptions_made", "pending_karthik",
        }
        assert expected_fields.issubset(set(result.keys()))


# ═════════════════════════════════════════════════════════════════════
# TUPLE→LIST NORMALIZATION
# ═════════════════════════════════════════════════════════════════════


class TestTupleListNormalization:
    def test_top_level_tuples_become_lists(self, p_int_8_full_output):
        result = format_formwork_output_json(p_int_8_full_output)
        for field in (
            "tier_6_components", "custom_quote_items", "operator_review_items",
            "assumptions_made", "pending_karthik", "warnings",
            "tier_5_wall_segments", "tier_4_sku_details", "tier_3_sku_types",
        ):
            assert isinstance(result[field], list), (
                f"{field} should be list, got {type(result[field]).__name__}"
            )

    def test_strings_not_split_into_chars(self, p_int_8_full_output):
        """Strings are iterable but ATOMIC — must NOT recurse into characters."""
        result = format_formwork_output_json(p_int_8_full_output)
        assert isinstance(result["formwork_id"], str)
        assert isinstance(result["generated_at"], str)
        assert isinstance(result["schema_version"], str)
        assert len(result["formwork_id"]) == 36  # full UUID

    def test_nested_pipeline_versions_become_list_of_lists(self, p_int_8_full_output):
        """audit_trail.pipeline_versions is tuple-of-tuples in dataclass."""
        result = format_formwork_output_json(p_int_8_full_output)
        pv = result["audit_trail"]["pipeline_versions"]
        assert isinstance(pv, list)
        for entry in pv:
            assert isinstance(entry, list)


# ═════════════════════════════════════════════════════════════════════
# SPECIAL FIELD TYPES
# ═════════════════════════════════════════════════════════════════════


class TestSpecialFieldTypes:
    def test_formwork_id_is_uuid_string(self, p_int_8_full_output):
        import uuid
        result = format_formwork_output_json(p_int_8_full_output)
        uuid.UUID(result["formwork_id"])

    def test_hashes_are_64_hex(self, p_int_8_full_output):
        result = format_formwork_output_json(p_int_8_full_output)
        audit = result["audit_trail"]
        for hash_field in ("mapper_output_hash", "context_hash"):
            h = audit[hash_field]
            assert isinstance(h, str)
            assert len(h) == 64
            assert all(c in "0123456789abcdef" for c in h)


# ═════════════════════════════════════════════════════════════════════
# ERROR PATHS
# ═════════════════════════════════════════════════════════════════════


class TestErrorPaths:
    def test_non_output_raises_typeerror(self):
        with pytest.raises(TypeError):
            format_formwork_output_json({"not": "an output"})

    def test_none_raises_typeerror(self):
        with pytest.raises(TypeError):
            format_formwork_output_json(None)

    def test_string_raises_typeerror(self):
        with pytest.raises(TypeError):
            format_formwork_output_json("not an output")


# ═════════════════════════════════════════════════════════════════════
# PURITY
# ═════════════════════════════════════════════════════════════════════


class TestPurity:
    def test_serializer_does_not_mutate_input(self, p_int_8_full_output):
        original_id = p_int_8_full_output.formwork_id
        format_formwork_output_json(p_int_8_full_output)
        assert p_int_8_full_output.formwork_id == original_id


# ═════════════════════════════════════════════════════════════════════
# DESERIALIZATION: dict_to_panel_grid_mapper_output
# ═════════════════════════════════════════════════════════════════════


class TestMapperDeserialization:
    def test_round_trip_p_int_8(self, p_int_8_mapper_output):
        """asdict → dict_to → equal."""
        d = dataclasses.asdict(p_int_8_mapper_output)
        result = dict_to_panel_grid_mapper_output(d)
        assert isinstance(result, PanelGridMapperOutput)
        assert result.project_name == p_int_8_mapper_output.project_name
        assert len(result.wall_segments) == len(p_int_8_mapper_output.wall_segments)

    def test_round_trip_byte_equal(self, p_int_8_mapper_output):
        d = dataclasses.asdict(p_int_8_mapper_output)
        result = dict_to_panel_grid_mapper_output(d)
        # Compare via asdict (handles tuple/list)
        assert dataclasses.asdict(result) == d

    def test_wall_segments_round_trip_to_tuples(self, p_int_8_mapper_output):
        d = dataclasses.asdict(p_int_8_mapper_output)
        result = dict_to_panel_grid_mapper_output(d)
        # wall_segments declared as tuple → must be tuple
        assert isinstance(result.wall_segments, tuple)


# ═════════════════════════════════════════════════════════════════════
# DESERIALIZATION: dict_to_formwork_context
# ═════════════════════════════════════════════════════════════════════


class TestContextDeserialization:
    def test_round_trip_p_int_8(self, formwork_context_p_int_8):
        d = dataclasses.asdict(formwork_context_p_int_8)
        result = dict_to_formwork_context(d)
        assert isinstance(result, FormworkContext)
        assert result.project_id == formwork_context_p_int_8.project_id
        assert result.deterministic_id_seed == formwork_context_p_int_8.deterministic_id_seed

    def test_optional_fields_pass_through_none(self, formwork_context_p_int_8):
        d = dataclasses.asdict(formwork_context_p_int_8)
        # P_INT_8 context has seismic_zone=None and pour_rate=None
        result = dict_to_formwork_context(d)
        assert result.seismic_zone is None
        assert result.pour_rate_m_per_hr is None

    def test_wall_type_overrides_tuple_round_trip(self):
        d = {
            "project_id": "TEST",
            "quote_date": "2026-05-27",
            "seismic_zone": None,
            "pour_rate_m_per_hr": None,
            "wastage_percent": 5.0,
            "wall_type_overrides": [["W1", "basement"]],  # JSON shape: list of lists
            "deterministic_id_seed": "seed",
            "generated_at_override": None,
            "notes": None,
        }
        result = dict_to_formwork_context(d)
        # tuple-of-tuples in the dataclass
        assert isinstance(result.wall_type_overrides, tuple)
        assert result.wall_type_overrides == (("W1", "basement"),)
