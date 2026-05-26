"""THE CRITICAL CONTRACT TESTS — id_generator byte-equal reproduction.

If any test here fails, **STOP** immediately:
* SHA-256 mapper_output_hash MUST match PR 1 golden bit-for-bit
* UUID5 boq_id MUST match PR 1 golden bit-for-bit

Pre-flight B + C verified the implementation strategies. These tests
guarantee future regression detection.
"""

from __future__ import annotations

import re
import uuid

import pytest

from app.services.kos_boq_generator import (
    BOQContext,
    build_audit_trail,
    compute_generated_at,
    compute_mapper_output_hash,
    mint_boq_id,
)


# Frozen contract values — PR 1 golden
EXPECTED_BOQ_ID = "fd9d8a26-97e4-50e2-a623-47327379d185"
EXPECTED_MAPPER_HASH = "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"


# ──────────────────────────────────────────────────────────────────────────────
# CRITICAL CONTRACT TESTS — SHA-256
# ──────────────────────────────────────────────────────────────────────────────


def test_compute_mapper_output_hash_p_int_8_reproduces_golden(p_int_8_mapper_output) -> None:
    """🚨 CRITICAL: SHA-256 byte-equal to golden mapper_output_hash."""
    computed = compute_mapper_output_hash(p_int_8_mapper_output)
    assert computed == EXPECTED_MAPPER_HASH, (
        f"SHA-256 reproduction FAILED.\n"
        f"  Expected: {EXPECTED_MAPPER_HASH}\n"
        f"  Computed: {computed}\n"
        f"  → Check canonicalization strategy (pre-flight B)."
    )


def test_compute_mapper_output_hash_deterministic_across_runs(p_int_8_mapper_output) -> None:
    """Two runs on identical input produce identical hash."""
    h1 = compute_mapper_output_hash(p_int_8_mapper_output)
    h2 = compute_mapper_output_hash(p_int_8_mapper_output)
    assert h1 == h2


def test_compute_mapper_output_hash_returns_64_char_hex(p_int_8_mapper_output) -> None:
    """SHA-256 hex digest is always 64 lowercase hex chars."""
    h = compute_mapper_output_hash(p_int_8_mapper_output)
    assert len(h) == 64
    assert re.fullmatch(r"[0-9a-f]{64}", h)


def test_compute_mapper_output_hash_returns_string_type(p_int_8_mapper_output) -> None:
    """Output is str (not bytes)."""
    assert isinstance(compute_mapper_output_hash(p_int_8_mapper_output), str)


def test_compute_mapper_output_hash_90vr_is_deterministic(ninety_vr_mr_mapper_output) -> None:
    """90VR-MR: hash deterministic across two calls."""
    h1 = compute_mapper_output_hash(ninety_vr_mr_mapper_output)
    h2 = compute_mapper_output_hash(ninety_vr_mr_mapper_output)
    assert h1 == h2
    # And 64-hex
    assert re.fullmatch(r"[0-9a-f]{64}", h1)


def test_compute_mapper_output_hash_p_int_8_vs_90vr_differ(
    p_int_8_mapper_output, ninety_vr_mr_mapper_output,
) -> None:
    """Different inputs MUST produce different hashes."""
    h_p = compute_mapper_output_hash(p_int_8_mapper_output)
    h_v = compute_mapper_output_hash(ninety_vr_mr_mapper_output)
    assert h_p != h_v


# ──────────────────────────────────────────────────────────────────────────────
# CRITICAL CONTRACT TESTS — UUID5
# ──────────────────────────────────────────────────────────────────────────────


def test_mint_boq_id_p_int_8_reproduces_golden(boq_context_p_int_8) -> None:
    """🚨 CRITICAL: UUID5 byte-equal to golden boq_id.

    boq_context_p_int_8 fixture has ``deterministic_id_seed="p_int_8_test_seed"``.
    Pre-flight C verified the seed format is the deterministic_id_seed
    directly (NOT pdh-concat). Namespace = _BOQ_UUID_NAMESPACE.
    """
    boq_id = mint_boq_id(boq_context_p_int_8)
    assert boq_id == EXPECTED_BOQ_ID, (
        f"UUID5 reproduction FAILED.\n"
        f"  Expected: {EXPECTED_BOQ_ID}\n"
        f"  Computed: {boq_id}\n"
        f"  → Check seed format + namespace (pre-flight C)."
    )


def test_mint_boq_id_deterministic_with_seed() -> None:
    """Same seed → same UUID across calls."""
    ctx = BOQContext(
        project_id="X", quote_date="2026-05-25",
        deterministic_id_seed="some_seed",
    )
    id1 = mint_boq_id(ctx)
    id2 = mint_boq_id(ctx)
    assert id1 == id2


def test_mint_boq_id_uuid4_when_seed_none() -> None:
    """When deterministic_id_seed is None, returns random UUID4."""
    ctx = BOQContext(
        project_id="X", quote_date="2026-05-25",
        deterministic_id_seed=None,
    )
    id1 = mint_boq_id(ctx)
    id2 = mint_boq_id(ctx)
    # UUID4 is random — two calls produce different UUIDs
    assert id1 != id2
    # Both valid UUIDs (parsed via uuid.UUID)
    uuid.UUID(id1)
    uuid.UUID(id2)


def test_mint_boq_id_different_seeds_different_uuids() -> None:
    """Different seeds → different UUIDs."""
    ctx_a = BOQContext(project_id="X", quote_date="2026-05-25", deterministic_id_seed="seed_a")
    ctx_b = BOQContext(project_id="X", quote_date="2026-05-25", deterministic_id_seed="seed_b")
    assert mint_boq_id(ctx_a) != mint_boq_id(ctx_b)


def test_mint_boq_id_returns_uuid_format() -> None:
    """Output is a valid UUID string format."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25", deterministic_id_seed="test")
    boq_id = mint_boq_id(ctx)
    parsed = uuid.UUID(boq_id)
    assert parsed.version == 5  # UUID5 when seed set


def test_mint_boq_id_uuid4_when_no_seed_returns_v4() -> None:
    """When no seed, UUID4 returned (version=4)."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    boq_id = mint_boq_id(ctx)
    parsed = uuid.UUID(boq_id)
    assert parsed.version == 4


# ──────────────────────────────────────────────────────────────────────────────
# compute_generated_at
# ──────────────────────────────────────────────────────────────────────────────


def test_compute_generated_at_override_returned_verbatim() -> None:
    """When override is set, returned as-is."""
    ctx = BOQContext(
        project_id="X", quote_date="2026-05-25",
        generated_at_override="2026-05-25T00:00:00Z",
    )
    assert compute_generated_at(ctx) == "2026-05-25T00:00:00Z"


def test_compute_generated_at_no_override_returns_utc_iso() -> None:
    """When no override, returns current UTC, microsecond-truncated."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    result = compute_generated_at(ctx)
    # Format: YYYY-MM-DDTHH:MM:SS+00:00 (microseconds truncated)
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$", result)


def test_compute_generated_at_truncates_microseconds() -> None:
    """ASSUMPTION-BOQ-21: microsecond field is always zero."""
    ctx = BOQContext(project_id="X", quote_date="2026-05-25")
    result = compute_generated_at(ctx)
    # No fractional seconds in output
    assert "." not in result.split("T")[1]


# ──────────────────────────────────────────────────────────────────────────────
# build_audit_trail
# ──────────────────────────────────────────────────────────────────────────────


def test_build_audit_trail_includes_mapper_hash(p_int_8_mapper_output) -> None:
    """Audit trail's mapper_output_hash matches compute_mapper_output_hash()."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    expected_hash = compute_mapper_output_hash(p_int_8_mapper_output)
    assert audit.mapper_output_hash == expected_hash


def test_build_audit_trail_versions_from_constants(p_int_8_mapper_output) -> None:
    """boq_calculation_version + karthik_pricing_version from PR 1 constants."""
    from app.services.kos_boq_generator import BOQ_CALCULATION_VERSION, KARTHIK_PRICING_VERSION

    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    assert audit.boq_calculation_version == BOQ_CALCULATION_VERSION
    assert audit.karthik_pricing_version == KARTHIK_PRICING_VERSION


def test_build_audit_trail_review_flags_false_when_empty(p_int_8_mapper_output) -> None:
    """Both review_required flags are False when items are empty."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    assert audit.custom_quote_review_required is False
    assert audit.operator_review_required is False


def test_build_audit_trail_review_flags_true_when_populated(
    p_int_8_mapper_output, make_synth_custom_quote_item, make_synth_operator_review_item,
) -> None:
    """review_required flags True when respective items present."""
    custom = (make_synth_custom_quote_item(wall_id="P_X", reason="thickness_unknown"),)
    review = (make_synth_operator_review_item("orphan_opening"),)
    audit = build_audit_trail(p_int_8_mapper_output, custom, review)
    assert audit.custom_quote_review_required is True
    assert audit.operator_review_required is True


def test_build_audit_trail_pipeline_versions_alphabetically_sorted(p_int_8_mapper_output) -> None:
    """pipeline_versions sorted alphabetically by component name."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    names = [pair[0] for pair in audit.pipeline_versions]
    assert names == sorted(names)


def test_build_audit_trail_pipeline_versions_is_tuple_of_pairs(p_int_8_mapper_output) -> None:
    """pipeline_versions is tuple-of-pairs (PR 1 anti-pattern #2 carry)."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    assert isinstance(audit.pipeline_versions, tuple)
    for pair in audit.pipeline_versions:
        assert isinstance(pair, tuple) and len(pair) == 2
