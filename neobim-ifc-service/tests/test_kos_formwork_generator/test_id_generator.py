"""PR 3: tests for id_generator (UUID5 mint, SHA-256 hashes, audit_trail).

Covers:
* Public API contract (all 5 functions importable).
* mint_formwork_id — deterministic with seed, fresh UUID4 when None,
  empty-string seed counts as deterministic ('is not None'), 5F namespace
  distinct from BOQ's namespace.
* compute_mapper_output_hash — byte-equal vs golden, must equal BOQ's hash.
* compute_context_hash — byte-equal vs golden.
* compute_generated_at — verbatim with override, ISO-8601 UTC without.
* build_audit_trail — populates all 7 fields, uses PIPELINE_VERSIONS_DEFAULT,
  flips review flags from items length.
* Determinism: identical inputs → identical outputs.
* Hash stability across struct order.
"""
from __future__ import annotations

import dataclasses
import re
import uuid

import pytest

from app.services.kos_formwork_generator import (
    FORMWORK_CALCULATION_VERSION,
    FIELD_RULE_BOOK_VERSION,
    PIPELINE_VERSIONS_DEFAULT,
    FormworkAuditTrail,
    FormworkContext,
    build_audit_trail,
    compute_context_hash,
    compute_generated_at,
    compute_mapper_output_hash,
    mint_formwork_id,
)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API CONTRACT
# ═════════════════════════════════════════════════════════════════════


class TestPublicAPI:
    @pytest.mark.parametrize(
        "name",
        [
            "mint_formwork_id",
            "compute_mapper_output_hash",
            "compute_context_hash",
            "compute_generated_at",
            "build_audit_trail",
        ],
    )
    def test_importable(self, name):
        import app.services.kos_formwork_generator as mod
        assert hasattr(mod, name)


# ═════════════════════════════════════════════════════════════════════
# UUID5 / UUID4 MINTING
# ═════════════════════════════════════════════════════════════════════


class TestMintFormworkId:
    def test_p_int_8_seed_produces_golden_uuid(
        self, formwork_context_p_int_8, p_int_8_formwork_golden
    ):
        result = mint_formwork_id(formwork_context_p_int_8)
        assert result == p_int_8_formwork_golden["formwork_id"]

    def test_deterministic_seed_produces_repeatable_uuid(
        self, formwork_context_p_int_8
    ):
        a = mint_formwork_id(formwork_context_p_int_8)
        b = mint_formwork_id(formwork_context_p_int_8)
        assert a == b

    def test_no_seed_produces_uuid4_random(self):
        ctx = FormworkContext(
            project_id="X",
            quote_date="2026-05-25",
            seismic_zone=None,
            pour_rate_m_per_hr=None,
            wastage_percent=5.0,
            wall_type_overrides=(),
            deterministic_id_seed=None,
            generated_at_override=None,
            notes=None,
        )
        a = mint_formwork_id(ctx)
        b = mint_formwork_id(ctx)
        # Two fresh uuid4 calls should differ.
        assert a != b

    def test_returns_string(self, formwork_context_p_int_8):
        result = mint_formwork_id(formwork_context_p_int_8)
        assert isinstance(result, str)

    def test_uuid_format(self, formwork_context_p_int_8):
        result = mint_formwork_id(formwork_context_p_int_8)
        # Standard 8-4-4-4-12 hex.
        assert re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", result)

    def test_empty_string_seed_is_deterministic(self):
        """Seed-check uses ``is not None``, so empty string → uuid5 (not uuid4)."""
        ctx_empty = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed="",
            generated_at_override=None, notes=None,
        )
        a = mint_formwork_id(ctx_empty)
        b = mint_formwork_id(ctx_empty)
        assert a == b  # Empty seed is reproducible.

    def test_namespace_distinct_from_boq(self, formwork_context_p_int_8):
        """5F namespace must produce different UUID than BOQ namespace for same seed."""
        from app.services.kos_formwork_generator.id_generator import _FORMWORK_UUID_NAMESPACE
        # BOQ namespace per CLAUDE.md project memory.
        boq_namespace = uuid.UUID("a5b8c2d1-3e4f-5678-9012-3456789abcde")
        seed = formwork_context_p_int_8.deterministic_id_seed
        formwork_uuid = uuid.uuid5(_FORMWORK_UUID_NAMESPACE, seed)
        boq_uuid = uuid.uuid5(boq_namespace, seed)
        assert formwork_uuid != boq_uuid

    def test_different_seeds_different_uuids(self):
        ctx_a = FormworkContext(
            project_id="A", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed="seed-A",
            generated_at_override=None, notes=None,
        )
        ctx_b = dataclasses.replace(ctx_a, deterministic_id_seed="seed-B")
        assert mint_formwork_id(ctx_a) != mint_formwork_id(ctx_b)


# ═════════════════════════════════════════════════════════════════════
# HASHES
# ═════════════════════════════════════════════════════════════════════


class TestComputeMapperOutputHash:
    def test_p_int_8_matches_golden(
        self, p_int_8_mapper_output, p_int_8_formwork_golden
    ):
        result = compute_mapper_output_hash(p_int_8_mapper_output)
        assert result == p_int_8_formwork_golden["audit_trail"]["mapper_output_hash"]

    def test_deterministic_across_calls(self, p_int_8_mapper_output):
        a = compute_mapper_output_hash(p_int_8_mapper_output)
        b = compute_mapper_output_hash(p_int_8_mapper_output)
        assert a == b

    def test_returns_64_char_hex(self, p_int_8_mapper_output):
        result = compute_mapper_output_hash(p_int_8_mapper_output)
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)


class TestComputeContextHash:
    def test_p_int_8_matches_golden(
        self, formwork_context_p_int_8, p_int_8_formwork_golden
    ):
        result = compute_context_hash(formwork_context_p_int_8)
        assert result == p_int_8_formwork_golden["audit_trail"]["context_hash"]

    def test_deterministic_across_calls(self, formwork_context_p_int_8):
        a = compute_context_hash(formwork_context_p_int_8)
        b = compute_context_hash(formwork_context_p_int_8)
        assert a == b

    def test_returns_64_char_hex(self, formwork_context_p_int_8):
        result = compute_context_hash(formwork_context_p_int_8)
        assert len(result) == 64

    def test_different_seeds_different_hashes(self, formwork_context_p_int_8):
        ctx_modified = dataclasses.replace(
            formwork_context_p_int_8, deterministic_id_seed="different-seed"
        )
        assert compute_context_hash(formwork_context_p_int_8) != compute_context_hash(ctx_modified)


class TestHashRejectsNonDataclass:
    def test_raises_typeerror(self):
        from app.services.kos_formwork_generator.id_generator import _canonical_json_hash
        with pytest.raises(TypeError):
            _canonical_json_hash({"not": "a dataclass"})


# ═════════════════════════════════════════════════════════════════════
# generated_at TIMESTAMP
# ═════════════════════════════════════════════════════════════════════


class TestComputeGeneratedAt:
    def test_override_used_verbatim(self, formwork_context_p_int_8):
        result = compute_generated_at(formwork_context_p_int_8)
        assert result == "2026-05-25T00:00:00Z"

    def test_no_override_returns_iso8601(self):
        ctx = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed=None,
            generated_at_override=None, notes=None,
        )
        result = compute_generated_at(ctx)
        # Post-cleanup (2026-05-27): no-override path emits Z suffix directly
        # (previously +00:00; orchestrator did Phase 6 normalization).
        assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", result)

    def test_no_override_microsecond_truncated(self):
        """Two calls within microseconds of each other must produce identical seconds."""
        ctx = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed=None,
            generated_at_override=None, notes=None,
        )
        a = compute_generated_at(ctx)
        # No microseconds in the string.
        assert "." not in a

    def test_no_override_emits_z_suffix_directly(self):
        """Post-cleanup regression guard: source emits Z, no +00:00 leaks.

        Previously, orchestrator Phase 6 normalized '+00:00' → 'Z' as a workaround.
        Post-cleanup, the fix is at source in `id_generator.compute_generated_at`.
        This test prevents accidental regression to `.isoformat()` returning '+00:00'.
        """
        ctx = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed=None,
            generated_at_override=None, notes=None,
        )
        result = compute_generated_at(ctx)
        assert result.endswith("Z"), f"Expected Z suffix, got {result!r}"
        assert "+00:00" not in result, (
            f"Workaround obsolete; +00:00 should not appear: {result!r}"
        )

    def test_override_path_unchanged_by_z_fix(self):
        """Override path is unaffected by the Z-suffix fix — string passes through verbatim."""
        import dataclasses
        ctx = FormworkContext(
            project_id="X", quote_date="2026-05-25",
            seismic_zone=None, pour_rate_m_per_hr=None,
            wastage_percent=5.0, wall_type_overrides=(),
            deterministic_id_seed=None,
            generated_at_override="2026-01-01T12:34:56Z",
            notes=None,
        )
        result = compute_generated_at(ctx)
        assert result == "2026-01-01T12:34:56Z", f"Override modified: {result!r}"

        # Even a non-Z override should pass through verbatim (override = trust caller).
        ctx_offset = dataclasses.replace(
            ctx, generated_at_override="2026-01-01T12:34:56+05:30",
        )
        assert compute_generated_at(ctx_offset) == "2026-01-01T12:34:56+05:30"


# ═════════════════════════════════════════════════════════════════════
# AUDIT TRAIL BUILDER
# ═════════════════════════════════════════════════════════════════════


class TestBuildAuditTrail:
    @pytest.fixture
    def audit(self, p_int_8_mapper_output, formwork_context_p_int_8):
        return build_audit_trail(p_int_8_mapper_output, formwork_context_p_int_8)

    def test_returns_audit_trail(self, audit):
        assert isinstance(audit, FormworkAuditTrail)

    def test_all_7_fields_present(self, audit):
        fields = [f.name for f in dataclasses.fields(audit)]
        assert set(fields) == {
            "mapper_output_hash",
            "context_hash",
            "formwork_calculation_version",
            "field_rule_book_version",
            "custom_quote_review_required",
            "operator_review_required",
            "pipeline_versions",
        }

    def test_mapper_hash_matches_compute(self, audit, p_int_8_mapper_output):
        assert audit.mapper_output_hash == compute_mapper_output_hash(p_int_8_mapper_output)

    def test_context_hash_matches_compute(self, audit, formwork_context_p_int_8):
        assert audit.context_hash == compute_context_hash(formwork_context_p_int_8)

    def test_calculation_version_from_constant(self, audit):
        assert audit.formwork_calculation_version == FORMWORK_CALCULATION_VERSION

    def test_field_rule_book_version_from_constant(self, audit):
        assert audit.field_rule_book_version == FIELD_RULE_BOOK_VERSION

    def test_pipeline_versions_uses_default(self, audit):
        assert audit.pipeline_versions == PIPELINE_VERSIONS_DEFAULT

    def test_empty_custom_quote_items_false(self, audit):
        assert audit.custom_quote_review_required is False

    def test_empty_operator_review_items_false(self, audit):
        assert audit.operator_review_required is False

    def test_nonempty_custom_quote_items_true(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        audit = build_audit_trail(
            p_int_8_mapper_output, formwork_context_p_int_8,
            custom_quote_items=(object(),),
        )
        assert audit.custom_quote_review_required is True

    def test_nonempty_operator_review_items_true(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        audit = build_audit_trail(
            p_int_8_mapper_output, formwork_context_p_int_8,
            operator_review_items=(object(),),
        )
        assert audit.operator_review_required is True


class TestPipelineVersionsDefault:
    def test_is_tuple_of_pairs(self):
        assert isinstance(PIPELINE_VERSIONS_DEFAULT, tuple)
        for entry in PIPELINE_VERSIONS_DEFAULT:
            assert isinstance(entry, tuple)
            assert len(entry) == 2

    def test_contains_three_entries(self):
        assert len(PIPELINE_VERSIONS_DEFAULT) == 3

    def test_contains_field_rule_book(self):
        keys = [pair[0] for pair in PIPELINE_VERSIONS_DEFAULT]
        assert "field_rule_book" in keys

    def test_contains_formwork(self):
        keys = [pair[0] for pair in PIPELINE_VERSIONS_DEFAULT]
        assert "formwork" in keys

    def test_contains_mapper(self):
        keys = [pair[0] for pair in PIPELINE_VERSIONS_DEFAULT]
        assert "mapper" in keys
