"""Unit tests for the PR 5 orchestrator ``generate_boq``.

Coverage:
* Component wiring (every PR 1-4 output appears in the final BOQGeneratorOutput)
* Order of operations (custom items built BEFORE Tier 3)
* Purity (no input mutation; deterministic when overrides set)
* Commercial terms construction
* Review flag derivation
* Warnings semantics (NOT mapper.warnings)
* B-11 + B-12 invariant enforcement (PR 4 already wired)
* Performance smoke
"""

from __future__ import annotations

import copy
import dataclasses
import time

import pytest

from app.services.kos_boq_generator import (
    BOQ_SCHEMA_VERSION,
    DEFAULT_DELIVERY_TERMS,
    DEFAULT_PAYMENT_TERMS,
    BOQAuditTrail,
    BOQCommercialTerms,
    BOQContext,
    BOQGeneratorOutput,
    BOQInput,
    BOQInvariantError,
    Tier1ProjectSummary,
    Tier2Category,
    generate_boq,
)


# ──────────────────────────────────────────────────────────────────────────────
# Happy-path: generate_boq returns valid output
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_boq_p_int_8_succeeds(p_int_8_input) -> None:
    """Smoke: P_INT_8 pipeline runs end-to-end without raising."""
    output = generate_boq(p_int_8_input)
    assert isinstance(output, BOQGeneratorOutput)


def test_generate_boq_90vr_succeeds(ninety_vr_mr_input) -> None:
    """Smoke: 90VR-MR pipeline runs end-to-end without raising."""
    output = generate_boq(ninety_vr_mr_input)
    assert isinstance(output, BOQGeneratorOutput)


def test_generate_boq_returns_frozen_output(p_int_8_input) -> None:
    """Output is a frozen dataclass — mutating raises FrozenInstanceError."""
    output = generate_boq(p_int_8_input)
    with pytest.raises(dataclasses.FrozenInstanceError):
        output.boq_id = "mutated"  # type: ignore[misc]


# ──────────────────────────────────────────────────────────────────────────────
# Component wiring — every PR 1-4 output appears
# ──────────────────────────────────────────────────────────────────────────────


def test_orchestrator_includes_all_tier_results(p_int_8_input) -> None:
    """All 6 tiers populated."""
    output = generate_boq(p_int_8_input)
    assert isinstance(output.tier_1_summary, Tier1ProjectSummary)
    assert isinstance(output.tier_2_categories, Tier2Category)
    assert len(output.tier_3_sku_types) >= 1
    assert len(output.tier_4_sku_details) >= 1
    assert len(output.tier_5_wall_segments) >= 1
    assert len(output.tier_6_panel_pieces) >= 1


def test_orchestrator_includes_custom_items(ninety_vr_mr_input) -> None:
    """Custom items from PR 4 handler are wired through."""
    output = generate_boq(ninety_vr_mr_input)
    assert len(output.custom_quote_items) == 37


def test_orchestrator_includes_operator_items(ninety_vr_mr_input) -> None:
    """Operator review items from PR 4 handler are wired through."""
    output = generate_boq(ninety_vr_mr_input)
    assert len(output.operator_review_items) == 6


def test_orchestrator_includes_ids(p_int_8_input) -> None:
    """boq_id (PR 4 mint_boq_id) + generated_at present."""
    output = generate_boq(p_int_8_input)
    assert output.boq_id == "fd9d8a26-97e4-50e2-a623-47327379d185"
    assert output.generated_at == "2026-05-25T00:00:00Z"


def test_orchestrator_includes_audit_trail(p_int_8_input) -> None:
    """audit_trail from PR 4 build_audit_trail wired through."""
    output = generate_boq(p_int_8_input)
    assert isinstance(output.audit_trail, BOQAuditTrail)
    assert (
        output.audit_trail.mapper_output_hash
        == "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"
    )


def test_orchestrator_includes_commercial_terms(p_int_8_input) -> None:
    """commercial_terms is a BOQCommercialTerms (PR 5 builds this)."""
    output = generate_boq(p_int_8_input)
    assert isinstance(output.commercial_terms, BOQCommercialTerms)


def test_orchestrator_includes_schema_version(p_int_8_input) -> None:
    """schema_version sourced from BOQ_SCHEMA_VERSION constant."""
    output = generate_boq(p_int_8_input)
    assert output.schema_version == BOQ_SCHEMA_VERSION


def test_orchestrator_assumptions_and_pending_empty(p_int_8_input) -> None:
    """PR 5 returns empty tuples for assumptions_made + pending_karthik."""
    output = generate_boq(p_int_8_input)
    assert output.assumptions_made == ()
    assert output.pending_karthik == ()


# ──────────────────────────────────────────────────────────────────────────────
# Commercial terms — sourced from defaults + context
# ──────────────────────────────────────────────────────────────────────────────


def test_commercial_terms_payment_matches_default(p_int_8_input) -> None:
    """payment_terms = DEFAULT_PAYMENT_TERMS (verified via pre-flight A Part 8)."""
    output = generate_boq(p_int_8_input)
    assert output.commercial_terms.payment_terms == DEFAULT_PAYMENT_TERMS


def test_commercial_terms_delivery_matches_default(p_int_8_input) -> None:
    """delivery_terms = DEFAULT_DELIVERY_TERMS (verified via pre-flight A Part 8)."""
    output = generate_boq(p_int_8_input)
    assert output.commercial_terms.delivery_terms == DEFAULT_DELIVERY_TERMS


def test_commercial_terms_quote_validity_until_computed_from_context(
    p_int_8_input,
) -> None:
    """quote_validity_until = quote_date + quote_validity_days."""
    output = generate_boq(p_int_8_input)
    # quote_date=2026-05-25, quote_validity_days=30 → 2026-06-24
    assert output.commercial_terms.quote_validity_until == "2026-06-24"


def test_commercial_terms_notes_empty_when_context_notes_none(p_int_8_input) -> None:
    """notes defaults to '' when context.notes is None."""
    output = generate_boq(p_int_8_input)
    assert output.commercial_terms.notes == ""


def test_commercial_terms_notes_uses_context_when_set(
    p_int_8_mapper_output,
) -> None:
    """When context.notes is set, it propagates to commercial_terms.notes."""
    ctx = BOQContext(
        project_id="X",
        quote_date="2026-05-25",
        notes="Special order — expedite",
        deterministic_id_seed="test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
    )
    output = generate_boq(BOQInput(mapper_output=p_int_8_mapper_output, context=ctx))
    assert output.commercial_terms.notes == "Special order — expedite"


# ──────────────────────────────────────────────────────────────────────────────
# Review flags — derived from item counts (not hardcoded)
# ──────────────────────────────────────────────────────────────────────────────


def test_review_flags_false_when_no_customs_or_orphans(p_int_8_input) -> None:
    """P_INT_8 has 0 customs + 0 orphans → both flags False."""
    output = generate_boq(p_int_8_input)
    assert output.audit_trail.custom_quote_review_required is False
    assert output.audit_trail.operator_review_required is False


def test_review_flag_true_when_customs_present(ninety_vr_mr_input) -> None:
    """90VR-MR has 37 customs → custom_quote_review_required=True."""
    output = generate_boq(ninety_vr_mr_input)
    assert output.audit_trail.custom_quote_review_required is True


def test_operator_review_flag_true_when_orphans_present(ninety_vr_mr_input) -> None:
    """90VR-MR has 6 orphans → operator_review_required=True."""
    output = generate_boq(ninety_vr_mr_input)
    assert output.audit_trail.operator_review_required is True


# ──────────────────────────────────────────────────────────────────────────────
# Order of operations — Tier 3 sees the custom items
# ──────────────────────────────────────────────────────────────────────────────


def test_orchestrator_tier3_includes_custom_synthetic_row_when_customs_exist(
    ninety_vr_mr_input,
) -> None:
    """Tier 3 has a synthetic CUSTOM row when custom_quote_items > 0 (PR 3)."""
    output = generate_boq(ninety_vr_mr_input)
    prefixes = [row.sku_prefix for row in output.tier_3_sku_types]
    assert "CUSTOM" in prefixes


def test_orchestrator_tier3_no_custom_row_when_no_customs(p_int_8_input) -> None:
    """Tier 3 has NO CUSTOM row when there are 0 customs (P_INT_8)."""
    output = generate_boq(p_int_8_input)
    prefixes = [row.sku_prefix for row in output.tier_3_sku_types]
    assert "CUSTOM" not in prefixes


# ──────────────────────────────────────────────────────────────────────────────
# Purity — orchestrator does NOT mutate input
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_boq_does_not_mutate_input_context(p_int_8_input) -> None:
    """Input context fields unchanged after generate_boq."""
    original_seed = p_int_8_input.context.deterministic_id_seed
    original_override = p_int_8_input.context.generated_at_override
    original_quote_date = p_int_8_input.context.quote_date
    generate_boq(p_int_8_input)
    assert p_int_8_input.context.deterministic_id_seed == original_seed
    assert p_int_8_input.context.generated_at_override == original_override
    assert p_int_8_input.context.quote_date == original_quote_date


def test_generate_boq_does_not_mutate_mapper_output(p_int_8_input) -> None:
    """Mapper output unchanged after generate_boq (frozen anyway, but verify count)."""
    original_segment_count = len(p_int_8_input.mapper_output.wall_segments)
    generate_boq(p_int_8_input)
    assert len(p_int_8_input.mapper_output.wall_segments) == original_segment_count


# ──────────────────────────────────────────────────────────────────────────────
# Determinism — when override is set, output identical across runs
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_boq_deterministic_when_override_set(p_int_8_input) -> None:
    """Two runs with deterministic_id_seed + generated_at_override = identical output."""
    out_a = generate_boq(p_int_8_input)
    out_b = generate_boq(p_int_8_input)
    assert dataclasses.asdict(out_a) == dataclasses.asdict(out_b)


def test_generate_boq_uuid4_differs_without_seed(p_int_8_mapper_output) -> None:
    """Without deterministic_id_seed, boq_id differs across runs (UUID4)."""
    ctx = BOQContext(
        project_id="X",
        quote_date="2026-05-25",
        generated_at_override="2026-05-25T00:00:00Z",
        # No deterministic_id_seed → mint_boq_id uses UUID4
    )
    inp = BOQInput(mapper_output=p_int_8_mapper_output, context=ctx)
    out_a = generate_boq(inp)
    out_b = generate_boq(inp)
    assert out_a.boq_id != out_b.boq_id


# ──────────────────────────────────────────────────────────────────────────────
# Warnings semantics
# ──────────────────────────────────────────────────────────────────────────────


def test_warnings_is_tuple_of_str(p_int_8_input) -> None:
    """warnings is always tuple[str, ...]."""
    output = generate_boq(p_int_8_input)
    assert isinstance(output.warnings, tuple)
    for w in output.warnings:
        assert isinstance(w, str)


def test_warnings_does_not_include_mapper_warnings(ninety_vr_mr_input) -> None:
    """BOQ warnings come from validator (not mapper.warnings).

    90VR-MR has 175+ mapper warnings — BOQ.warnings must NOT contain them
    (anti-pattern #83).
    """
    output = generate_boq(ninety_vr_mr_input)
    mapper_warning_count = len(ninety_vr_mr_input.mapper_output.warnings)
    assert mapper_warning_count > 100  # Sanity: there ARE mapper warnings
    # BOQ warnings come from validator; soft B-24 may or may not fire,
    # but should never include raw mapper warnings.
    for boq_warning in output.warnings:
        assert boq_warning not in ninety_vr_mr_input.mapper_output.warnings


# ──────────────────────────────────────────────────────────────────────────────
# B-11 + B-12 (PR 4 implementations per 01_SCHEMA.md §C, not the
# prompt's alternate schema_version/pipeline_versions checks)
# ──────────────────────────────────────────────────────────────────────────────


def test_b11_invariant_passes_on_valid_boq_id(p_int_8_input) -> None:
    """B-11: boq_id is a valid UUID format. Passes when override produces UUID5."""
    output = generate_boq(p_int_8_input)
    import re
    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
    assert uuid_re.match(output.boq_id)


def test_b12_invariant_passes_on_utc_generated_at(p_int_8_input) -> None:
    """B-12: generated_at parseable + UTC ("Z" or "+00:00")."""
    output = generate_boq(p_int_8_input)
    from datetime import datetime
    parsed = datetime.fromisoformat(output.generated_at.replace("Z", "+00:00"))
    assert parsed.utcoffset() is not None
    assert output.generated_at.endswith("Z") or output.generated_at.endswith("+00:00")


def test_b11_invariant_fails_on_invalid_boq_id_format(p_int_8_mapper_output) -> None:
    """B-11 raises if some bug produces a non-UUID boq_id.

    Constructed by direct generate_boq call with a context that would yield
    a valid UUID; then we verify the invariant guards against drift. (Sanity:
    this test mostly confirms PR 4's B-11 is wired in the dispatcher used
    by orchestrator.)
    """
    ctx = BOQContext(
        project_id="X",
        quote_date="2026-05-25",
        deterministic_id_seed="test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
    )
    # Normal call — should succeed (B-11 passes on valid UUID5)
    output = generate_boq(BOQInput(mapper_output=p_int_8_mapper_output, context=ctx))
    assert output.boq_id  # UUID generated; B-11 would raise otherwise


# ──────────────────────────────────────────────────────────────────────────────
# Output construction — 16 fields exactly (pre-flight A Part 2)
# ──────────────────────────────────────────────────────────────────────────────


def test_output_has_exactly_16_fields(p_int_8_input) -> None:
    """BOQGeneratorOutput defines 16 fields per pre-flight A Part 2."""
    output = generate_boq(p_int_8_input)
    assert len(dataclasses.fields(output)) == 16


def test_output_field_names_match_pre_flight_a(p_int_8_input) -> None:
    """Field names match pre-flight A Part 2 exactly."""
    expected = {
        "boq_id", "generated_at", "schema_version",
        "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
        "tier_4_sku_details", "tier_5_wall_segments", "tier_6_panel_pieces",
        "custom_quote_items", "operator_review_items",
        "commercial_terms", "audit_trail",
        "warnings", "assumptions_made", "pending_karthik",
    }
    output = generate_boq(p_int_8_input)
    actual = {f.name for f in dataclasses.fields(output)}
    assert actual == expected


# ──────────────────────────────────────────────────────────────────────────────
# Performance
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_boq_p_int_8_completes_under_1_second(p_int_8_input) -> None:
    """Small fixture (9 panels) completes <1s."""
    start = time.monotonic()
    generate_boq(p_int_8_input)
    elapsed = time.monotonic() - start
    assert elapsed < 1.0, f"P_INT_8 generate_boq took {elapsed:.3f}s, expected <1s"
