"""THE CRITICAL CONTRACT TEST (PR 4 extension).

Extends PR 3's golden reproduction to audit_trail + custom_quote_items +
operator_review_items + the full 24-invariant validator. Verifies P_INT_8's
end-to-end pipeline produces byte-equal output to the PR 1 golden.

If any test here fails:

* SHA-256 mapper_output_hash drift → check canonicalization (pre-flight B)
* UUID5 boq_id drift → check seed format + namespace (pre-flight C)
* Audit trail field drift → check ``build_audit_trail`` ordering/types
* Validator raises BOQInvariantError on golden values → algorithm bug

Compared via JSON round-trip normalization (preserves PR 2/3 tuple/list pattern).
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from app.services.kos_boq_generator import (
    BOQContext,
    build_audit_trail,
    build_custom_quote_items,
    build_operator_review_items,
    build_tier1_project_summary,
    build_tier2_categories,
    build_tier3_sku_types,
    build_tier4_sku_details,
    build_tier5_segments,
    build_tier6_panel_pieces,
    compute_generated_at,
    compute_mapper_output_hash,
    mint_boq_id,
    validate_boq_output,
)


def _normalize(obj: object) -> object:
    """JSON round-trip normalization (tuples → lists; matches PR 2/3 pattern)."""
    return json.loads(json.dumps(obj))


# Frozen contract values — PR 1 golden
EXPECTED_BOQ_ID = "fd9d8a26-97e4-50e2-a623-47327379d185"
EXPECTED_MAPPER_HASH = "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"


# ──────────────────────────────────────────────────────────────────────────────
# SHA-256 + UUID5 byte-equal reproduction (smoke confirms across files)
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_mapper_hash_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """🚨 CRITICAL: compute_mapper_output_hash byte-equal to golden."""
    computed = compute_mapper_output_hash(p_int_8_mapper_output)
    assert computed == EXPECTED_MAPPER_HASH
    assert computed == p_int_8_boq_canonical_json["audit_trail"]["mapper_output_hash"]


def test_p_int_8_boq_id_reproduces_golden_byte_equal(
    boq_context_p_int_8, p_int_8_boq_canonical_json,
) -> None:
    """🚨 CRITICAL: mint_boq_id byte-equal to golden."""
    boq_id = mint_boq_id(boq_context_p_int_8)
    assert boq_id == EXPECTED_BOQ_ID
    assert boq_id == p_int_8_boq_canonical_json["boq_id"]


# ──────────────────────────────────────────────────────────────────────────────
# audit_trail byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_audit_trail_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Audit trail byte-equal to PR 1 golden (P_INT_8 has 0 customs, 0 reviews)."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    computed = _normalize(dataclasses.asdict(audit))
    golden = p_int_8_boq_canonical_json["audit_trail"]
    if computed != golden:
        diffs = []
        for k in sorted(set(computed.keys()) | set(golden.keys())):
            if computed.get(k) != golden.get(k):
                diffs.append(f"  {k}: computed={computed.get(k)!r}, golden={golden.get(k)!r}")
        pytest.fail("audit_trail differs from golden:\n" + "\n".join(diffs))


def test_p_int_8_audit_trail_review_flags_both_false(p_int_8_mapper_output) -> None:
    """P_INT_8: 0 customs + 0 reviews → both flags False (matches golden)."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    assert audit.custom_quote_review_required is False
    assert audit.operator_review_required is False


# ──────────────────────────────────────────────────────────────────────────────
# custom_quote_items + operator_review_items byte-equal reproduction
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_custom_quote_items_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """P_INT_8 has 0 custom_quote_requests → algorithm returns ()."""
    custom = build_custom_quote_items(p_int_8_mapper_output)
    computed = _normalize([dataclasses.asdict(item) for item in custom])
    golden = p_int_8_boq_canonical_json["custom_quote_items"]
    assert computed == golden
    assert custom == ()  # explicit empty assertion


def test_p_int_8_operator_review_items_reproduces_golden_byte_equal(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """P_INT_8 has 0 orphan warnings → algorithm returns ()."""
    review = build_operator_review_items(p_int_8_mapper_output)
    computed = _normalize([dataclasses.asdict(item) for item in review])
    golden = p_int_8_boq_canonical_json["operator_review_items"]
    assert computed == golden
    assert review == ()  # explicit empty assertion


# ──────────────────────────────────────────────────────────────────────────────
# Full-pipeline validator integration
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_full_pipeline_validates_all_24_invariants(
    p_int_8_mapper_output, boq_context_p_int_8,
) -> None:
    """🚨 CRITICAL: full pipeline T6→T1 + custom + review + audit → validator passes."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    custom = build_custom_quote_items(p_int_8_mapper_output)
    review = build_operator_review_items(p_int_8_mapper_output)
    tier3 = build_tier3_sku_types(tier4, custom)
    tier2 = build_tier2_categories(tier3, custom)
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, custom, review, boq_context_p_int_8, p_int_8_mapper_output,
    )
    audit = build_audit_trail(p_int_8_mapper_output, custom, review)

    soft_warnings = validate_boq_output(
        tier_6_panel_pieces=tier6,
        tier_5_wall_segments=tier5,
        tier_4_sku_details=tier4,
        tier_3_sku_types=tier3,
        tier_2_categories=tier2,
        tier_1_summary=tier1,
        custom_quote_items=custom,
        operator_review_items=review,
        audit_trail=audit,
        mapper_output=p_int_8_mapper_output,
        context=boq_context_p_int_8,
    )
    assert soft_warnings == ()


def test_p_int_8_full_pipeline_grand_total_matches_golden(
    p_int_8_mapper_output, p_int_8_boq_canonical_json, boq_context_p_int_8,
) -> None:
    """Grand total INR + formatted byte-match golden tier_1_summary."""
    tier6 = build_tier6_panel_pieces(p_int_8_mapper_output)
    tier5 = build_tier5_segments(p_int_8_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    tier3 = build_tier3_sku_types(tier4, ())
    tier2 = build_tier2_categories(tier3, ())
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, (), (), boq_context_p_int_8, p_int_8_mapper_output,
    )
    g_t1 = p_int_8_boq_canonical_json["tier_1_summary"]
    assert tier1.grand_total_inr == g_t1["grand_total_inr"]
    assert tier1.grand_total_inr_formatted == g_t1["grand_total_inr_formatted"]


# ──────────────────────────────────────────────────────────────────────────────
# generated_at override (deterministic test mode)
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_generated_at_override_returns_canonical_value(
    boq_context_p_int_8, p_int_8_boq_canonical_json,
) -> None:
    """When override is set (fixture: 2026-05-25T00:00:00Z), it's returned verbatim."""
    result = compute_generated_at(boq_context_p_int_8)
    assert result == "2026-05-25T00:00:00Z"
    assert result == p_int_8_boq_canonical_json["generated_at"]


# ──────────────────────────────────────────────────────────────────────────────
# 90VR-MR full-pipeline integration (validates PR 2 + 3 + 4 carry-forwards)
# ──────────────────────────────────────────────────────────────────────────────


def test_90vr_mr_full_pipeline_validates_all_24_invariants(
    ninety_vr_mr_mapper_output,
) -> None:
    """🚨 90VR-MR full pipeline: 573 panels, 37 customs, 6 reviews, all invariants pass."""
    ctx = BOQContext(
        project_id="90VR", quote_date="2026-05-25",
        deterministic_id_seed="test", generated_at_override="2026-05-25T00:00:00Z",
    )
    tier6 = build_tier6_panel_pieces(ninety_vr_mr_mapper_output)
    tier5 = build_tier5_segments(ninety_vr_mr_mapper_output)
    tier4 = build_tier4_sku_details(tier6)
    custom = build_custom_quote_items(ninety_vr_mr_mapper_output)
    review = build_operator_review_items(ninety_vr_mr_mapper_output)
    tier3 = build_tier3_sku_types(tier4, custom)
    tier2 = build_tier2_categories(tier3, custom)
    tier1 = build_tier1_project_summary(
        tier6, tier5, tier2, custom, review, ctx, ninety_vr_mr_mapper_output,
    )
    audit = build_audit_trail(ninety_vr_mr_mapper_output, custom, review)

    soft = validate_boq_output(
        tier_6_panel_pieces=tier6,
        tier_5_wall_segments=tier5,
        tier_4_sku_details=tier4,
        tier_3_sku_types=tier3,
        tier_2_categories=tier2,
        tier_1_summary=tier1,
        custom_quote_items=custom,
        operator_review_items=review,
        audit_trail=audit,
        mapper_output=ninety_vr_mr_mapper_output,
        context=ctx,
    )
    assert soft == ()


def test_90vr_mr_custom_quote_items_count_baseline(
    ninety_vr_mr_mapper_output,
) -> None:
    """🚨 CONTEXT_CONFIRMED: 37 custom items across 6 reason buckets."""
    custom = build_custom_quote_items(ninety_vr_mr_mapper_output)
    assert len(custom) == 37


def test_90vr_mr_operator_review_items_count_baseline(
    ninety_vr_mr_mapper_output,
) -> None:
    """🚨 CONTEXT_CONFIRMED: 6 orphan operator-review items."""
    review = build_operator_review_items(ninety_vr_mr_mapper_output)
    assert len(review) == 6


def test_90vr_mr_audit_trail_review_flags_both_true(
    ninety_vr_mr_mapper_output,
) -> None:
    """90VR-MR: 37 customs + 6 reviews → both flags True."""
    custom = build_custom_quote_items(ninety_vr_mr_mapper_output)
    review = build_operator_review_items(ninety_vr_mr_mapper_output)
    audit = build_audit_trail(ninety_vr_mr_mapper_output, custom, review)
    assert audit.custom_quote_review_required is True
    assert audit.operator_review_required is True


# ──────────────────────────────────────────────────────────────────────────────
# Soft-fail diagnostic: detailed diff for any future drift
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_audit_trail_field_by_field_diagnostic(
    p_int_8_mapper_output, p_int_8_boq_canonical_json,
) -> None:
    """Diagnostic helper: per-field diff if audit drifts."""
    audit = build_audit_trail(p_int_8_mapper_output, (), ())
    computed = _normalize(dataclasses.asdict(audit))
    golden = p_int_8_boq_canonical_json["audit_trail"]
    for k in sorted(golden.keys()):
        assert computed.get(k) == golden.get(k), (
            f"audit_trail.{k} drift:\n"
            f"  computed: {computed.get(k)!r}\n"
            f"  golden:   {golden.get(k)!r}"
        )
