"""PR 5: integration tests — P_INT_8 byte-equal via generate_formwork.

PR 5 tests reuse PR 4 conftest fixtures (pytest auto-loads).
"""
from __future__ import annotations

import dataclasses

from app.services.kos_formwork_generator import generate_formwork


def _normalize(obj):
    """Recursively convert tuples to lists for JSON-shaped golden comparison."""
    if isinstance(obj, dict):
        return {k: _normalize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize(v) for v in obj]
    return obj


# ═════════════════════════════════════════════════════════════════════
# FULL BYTE-EQUAL vs golden — orchestrator entry point
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8ByteEqualViaOrchestrator:
    def test_full_output_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        actual = _normalize(dataclasses.asdict(output))
        for k, expected in p_int_8_formwork_golden.items():
            assert actual.get(k) == expected, (
                f"Field {k!r} mismatch:\n  expected: {expected!r}\n  actual: {actual.get(k)!r}"
            )

    def test_each_tier_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        actual = _normalize(dataclasses.asdict(output))
        for tier_key in (
            "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
            "tier_4_sku_details", "tier_5_wall_segments", "tier_6_components",
        ):
            assert actual[tier_key] == p_int_8_formwork_golden[tier_key], (
                f"{tier_key} diverged from golden"
            )

    def test_audit_trail_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        actual = _normalize(dataclasses.asdict(output.audit_trail))
        assert actual == p_int_8_formwork_golden["audit_trail"]

    def test_formwork_id_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.formwork_id == p_int_8_formwork_golden["formwork_id"]

    def test_generated_at_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.generated_at == p_int_8_formwork_golden["generated_at"]

    def test_handler_outputs_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert list(output.custom_quote_items) == p_int_8_formwork_golden["custom_quote_items"]
        assert list(output.operator_review_items) == p_int_8_formwork_golden["operator_review_items"]

    def test_orchestrator_fields_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert list(output.warnings) == p_int_8_formwork_golden["warnings"]
        assert list(output.assumptions_made) == p_int_8_formwork_golden["assumptions_made"]
        assert list(output.pending_karthik) == p_int_8_formwork_golden["pending_karthik"]


# ═════════════════════════════════════════════════════════════════════
# EQUIVALENCE WITH PR 4 fixture (tier subset)
# ═════════════════════════════════════════════════════════════════════


class TestEquivalenceToFixture:
    """generate_formwork output equals PR 4 fixture for tier fields.

    PR 4 fixture set warnings/assumptions_made/pending_karthik to () (didn't
    populate them); PR 5 orchestrator populates from constants. So tier fields
    + audit_trail + ids match; orchestrator-populated fields will differ.
    """

    def test_tier_outputs_equivalent(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_full_output,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        a = dataclasses.asdict(output)
        b = dataclasses.asdict(p_int_8_full_output)
        for tier_key in (
            "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
            "tier_4_sku_details", "tier_5_wall_segments", "tier_6_components",
            "custom_quote_items", "operator_review_items", "audit_trail",
        ):
            assert a[tier_key] == b[tier_key]

    def test_formwork_id_equivalent(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_full_output,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.formwork_id == p_int_8_full_output.formwork_id

    def test_orchestrator_fields_diverge_from_fixture(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_full_output,
    ):
        """PR 4 fixture left these as ()  — PR 5 orchestrator populates them."""
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        # PR 5 orchestrator: 5 assumptions, 4 pending — fixture: 0 of each
        assert len(output.assumptions_made) == 5
        assert len(output.pending_karthik) == 4
        assert p_int_8_full_output.assumptions_made == ()
        assert p_int_8_full_output.pending_karthik == ()


# ═════════════════════════════════════════════════════════════════════
# SYNTHETIC TRIGGERS — full pipeline reaches handlers
# ═════════════════════════════════════════════════════════════════════


class TestSyntheticTriggerIntegration:
    def test_curved_wall_full_pipeline(
        self, p_int_8_mapper_output, formwork_context_p_int_8, curved_wall,
    ):
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        output = generate_formwork(mapper, formwork_context_p_int_8)
        assert output.custom_quote_items
        assert output.audit_trail.custom_quote_review_required is True
        assert output.tier_1_summary.total_custom_quote_items == len(output.custom_quote_items)

    def test_zone_v_full_pipeline(self, p_int_8_mapper_output, seismic_v_context):
        output = generate_formwork(p_int_8_mapper_output, seismic_v_context)
        assert output.custom_quote_items
        assert output.operator_review_items
        assert output.audit_trail.custom_quote_review_required is True
        assert output.audit_trail.operator_review_required is True

    def test_multiple_triggers_in_same_call(
        self, p_int_8_mapper_output, seismic_v_context, curved_wall,
    ):
        """Combined: Zone V + curved wall → both kinds of triggers fire."""
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        output = generate_formwork(mapper, seismic_v_context)
        assert any(r.reason == "inherited_curved_wall" for r in output.custom_quote_items)
        # Curved walls are inherited so they skip seismic Zone V check (first-match-wins)
        # BUT we still expect seismic_zone_high in operator_review
        assert any(r.review_type == "seismic_zone_high" for r in output.operator_review_items)

    def test_tall_wall_full_pipeline(
        self, p_int_8_mapper_output, formwork_context_p_int_8, tall_k4_wall,
    ):
        """Wall above FRB max routes to custom_quote, NOT to wcm — orchestrator skips it."""
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(tall_k4_wall,))
        output = generate_formwork(mapper, formwork_context_p_int_8)
        assert any(
            r.reason == "height_exceeds_field_rule_book_max" for r in output.custom_quote_items
        )
        # tall wall skipped from wcm → tier_5 empty
        assert output.tier_5_wall_segments == ()
        # validator must still pass (vacuous invariants for empty tier_5)
