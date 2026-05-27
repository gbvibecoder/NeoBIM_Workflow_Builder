"""PR 5: tests for generate_formwork orchestrator.

PR 5 tests reuse PR 4 conftest fixtures (pytest auto-loads).

Covers:
* Happy path P_INT_8 (output equivalent to PR 4 fixture).
* Phase ordering — handlers before tier_1/audit_trail; review counts consistent.
* Synthetic triggers reach handlers through orchestrator.
* Input validation IV-F-1..IV-F-7 + defensive None guards.
* Error propagation — typed errors unwrapped, unexpected wrapped with phase tag.
* Determinism — 5 calls byte-equal.
* Empty walls (valid empty output).
* Orchestrator-populated fields match golden.
* Logging + monkeypatch path correctness.
"""
from __future__ import annotations

import dataclasses
import logging

import pytest

from app.services.kos_formwork_generator import (
    FormworkContext,
    FormworkError,
    FormworkGeneratorOutput,
    FormworkInputError,
    FormworkInvariantError,
    generate_formwork,
)


# ═════════════════════════════════════════════════════════════════════
# HAPPY PATH
# ═════════════════════════════════════════════════════════════════════


class TestP_INT_8HappyPath:
    def test_returns_output(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output is not None

    def test_returns_correct_type(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert isinstance(output, FormworkGeneratorOutput)

    def test_handlers_empty(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.custom_quote_items == ()
        assert output.operator_review_items == ()

    def test_audit_booleans_false(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.audit_trail.custom_quote_review_required is False
        assert output.audit_trail.operator_review_required is False

    def test_validator_does_not_raise(self, p_int_8_mapper_output, formwork_context_p_int_8):
        """If validator raised, we wouldn't reach here."""
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.formwork_id

    def test_warnings_empty(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.warnings == ()


# ═════════════════════════════════════════════════════════════════════
# PHASE ORDERING — handlers BEFORE tier_1/audit_trail
# ═════════════════════════════════════════════════════════════════════


class TestPhaseOrdering:
    def test_tier_1_review_counts_match_handler_outputs(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.tier_1_summary.total_custom_quote_items == len(output.custom_quote_items)
        assert output.tier_1_summary.operator_review_items_count == len(output.operator_review_items)

    def test_audit_booleans_match_item_lists(
        self, p_int_8_mapper_output, formwork_context_p_int_8
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.audit_trail.custom_quote_review_required == (len(output.custom_quote_items) > 0)
        assert output.audit_trail.operator_review_required == (len(output.operator_review_items) > 0)

    def test_with_triggering_walls_all_counts_consistent(
        self, p_int_8_mapper_output, formwork_context_p_int_8, curved_wall
    ):
        """When triggers fire, ALL downstream fields update consistently."""
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        output = generate_formwork(mapper, formwork_context_p_int_8)
        assert output.tier_1_summary.total_custom_quote_items == len(output.custom_quote_items)
        assert output.audit_trail.custom_quote_review_required is True


# ═════════════════════════════════════════════════════════════════════
# SYNTHETIC TRIGGERS
# ═════════════════════════════════════════════════════════════════════


class TestSyntheticTriggers:
    def test_curved_wall_produces_custom_quote(
        self, p_int_8_mapper_output, formwork_context_p_int_8, curved_wall
    ):
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        output = generate_formwork(mapper, formwork_context_p_int_8)
        assert any(r.reason == "inherited_curved_wall" for r in output.custom_quote_items)
        assert output.audit_trail.custom_quote_review_required is True

    def test_zone_v_triggers_both_handlers(
        self, p_int_8_mapper_output, seismic_v_context
    ):
        """Zone V fires custom_quote (verification) AND operator_review (high) — per DESIGN v2."""
        output = generate_formwork(p_int_8_mapper_output, seismic_v_context)
        assert any(r.reason == "seismic_zone_v_verification" for r in output.custom_quote_items)
        assert any(r.review_type == "seismic_zone_high" for r in output.operator_review_items)
        assert output.audit_trail.custom_quote_review_required is True
        assert output.audit_trail.operator_review_required is True

    def test_zone_iv_triggers_operator_review_only(
        self, p_int_8_mapper_output, seismic_iv_context
    ):
        output = generate_formwork(p_int_8_mapper_output, seismic_iv_context)
        assert any(r.review_type == "seismic_zone_high" for r in output.operator_review_items)
        assert not any(
            r.reason == "seismic_zone_v_verification" for r in output.custom_quote_items
        )

    def test_pour_override_triggers_review(
        self, p_int_8_mapper_output, pour_override_context
    ):
        output = generate_formwork(p_int_8_mapper_output, pour_override_context)
        assert any(r.review_type == "pour_rate_override" for r in output.operator_review_items)

    def test_tall_wall_triggers_height_quote(
        self, p_int_8_mapper_output, formwork_context_p_int_8, tall_k4_wall
    ):
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(tall_k4_wall,))
        output = generate_formwork(mapper, formwork_context_p_int_8)
        assert any(
            r.reason == "height_exceeds_field_rule_book_max" for r in output.custom_quote_items
        )


# ═════════════════════════════════════════════════════════════════════
# INPUT VALIDATION — defensive guards + IV-F-1..IV-F-7
# ═════════════════════════════════════════════════════════════════════


class TestDefensiveNoneGuards:
    def test_none_mapper_output_raises(self, formwork_context_p_int_8):
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(None, formwork_context_p_int_8)
        assert "mapper_output" in str(exc.value)

    def test_none_context_raises(self, p_int_8_mapper_output):
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, None)
        assert "context" in str(exc.value)


class TestIvF1ProjectIdNonEmpty:
    def test_empty_project_id_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, project_id="")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-1" in str(exc.value)

    def test_whitespace_project_id_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, project_id="  ")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-1" in str(exc.value)

    def test_leading_whitespace_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, project_id=" PROJ")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-1" in str(exc.value)


class TestIvF2QuoteDateIso8601:
    def test_invalid_format_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, quote_date="not-a-date")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-2" in str(exc.value)

    def test_wrong_format_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, quote_date="05/27/2026")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-2" in str(exc.value)


class TestIvF3SeismicZone:
    def test_invalid_zone_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, seismic_zone="VII")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-3" in str(exc.value)

    def test_zone_I_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        """Zone I not in FRB §9.5 supported list."""
        bad = dataclasses.replace(formwork_context_p_int_8, seismic_zone="I")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-3" in str(exc.value)

    @pytest.mark.parametrize("zone", [None, "II", "III", "IV", "V"])
    def test_valid_zones_pass(self, p_int_8_mapper_output, formwork_context_p_int_8, zone):
        good = dataclasses.replace(formwork_context_p_int_8, seismic_zone=zone)
        # Should not raise on Phase 0
        generate_formwork(p_int_8_mapper_output, good)


class TestIvF4PourRateNoneOrPositive:
    def test_zero_pour_rate_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, pour_rate_m_per_hr=0.0)
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-4" in str(exc.value)

    def test_negative_pour_rate_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, pour_rate_m_per_hr=-1.0)
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-4" in str(exc.value)

    def test_none_pour_rate_passes(self, p_int_8_mapper_output, formwork_context_p_int_8):
        good = dataclasses.replace(formwork_context_p_int_8, pour_rate_m_per_hr=None)
        generate_formwork(p_int_8_mapper_output, good)  # no raise


class TestIvF5WastagePercent:
    def test_negative_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, wastage_percent=-1.0)
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-5" in str(exc.value)

    def test_above_25_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(formwork_context_p_int_8, wastage_percent=30.0)
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-5" in str(exc.value)

    @pytest.mark.parametrize("wp", [0.0, 5.0, 10.0, 25.0])
    def test_valid_values_pass(self, p_int_8_mapper_output, formwork_context_p_int_8, wp):
        good = dataclasses.replace(formwork_context_p_int_8, wastage_percent=wp)
        generate_formwork(p_int_8_mapper_output, good)


class TestIvF6WallTypeOverrides:
    def test_unknown_wall_id_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(
            formwork_context_p_int_8,
            wall_type_overrides=(("UNKNOWN_WALL_ID", "basement"),),
        )
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-6" in str(exc.value)

    def test_invalid_type_raises(self, p_int_8_mapper_output, formwork_context_p_int_8):
        bad = dataclasses.replace(
            formwork_context_p_int_8,
            wall_type_overrides=(("P_INT_8", "unknown_type"),),
        )
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(p_int_8_mapper_output, bad)
        assert "IV-F-6" in str(exc.value)

    def test_valid_override_passes(self, p_int_8_mapper_output, k4_basement_override_context):
        # P_INT_8 wall exists; type='basement' is valid; passes IV-F-6
        output = generate_formwork(p_int_8_mapper_output, k4_basement_override_context)
        # Should produce custom_quote (wall_type_override_high_risk for K4 basement)
        assert any(
            r.reason == "wall_type_override_high_risk" for r in output.custom_quote_items
        )


class TestIvF7MapperSchema:
    def test_unsupported_schema_version_raises(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        # Force a non-supported prefix (e.g., '99.99.0')
        bad = dataclasses.replace(p_int_8_mapper_output, schema_version="99.99.0")
        with pytest.raises(FormworkInputError) as exc:
            generate_formwork(bad, formwork_context_p_int_8)
        assert "IV-F-7" in str(exc.value)


# ═════════════════════════════════════════════════════════════════════
# ERROR PROPAGATION
# ═════════════════════════════════════════════════════════════════════


class TestErrorPropagation:
    def test_validator_hard_failure_propagates(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """FormworkInvariantError from validator propagates unwrapped."""
        def fake_validator(output):
            raise FormworkInvariantError("synthetic", invariant_id="F-99")

        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.validate_formwork_output",
            fake_validator,
        )
        with pytest.raises(FormworkInvariantError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert exc.value.invariant_id == "F-99"

    def test_phase_1_unexpected_error_wraps(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        def fake_count_corners(wall_segments):
            raise RuntimeError("synthetic Phase 1 failure")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.count_corners",
            fake_count_corners,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "Phase 1" in str(exc.value)

    def test_handlers_phase_unexpected_error_wraps(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """Handlers run in Phase 2 (after corners, before wcm)."""
        def fake_handler(*args, **kwargs):
            raise RuntimeError("synthetic handler failure")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.build_custom_quote_items",
            fake_handler,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "Phase 2" in str(exc.value)

    def test_typed_formwork_error_passes_through(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """If a phase raises FormworkError (typed), orchestrator re-raises without wrap."""
        def fake_count_corners(wall_segments):
            raise FormworkError("typed Phase 1 error")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.count_corners",
            fake_count_corners,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "typed Phase 1 error" in str(exc.value)

    def test_tier3_phase_unexpected_error_wraps(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """tier_3 is built in Phase 4."""
        def fake(*a, **kw):
            raise RuntimeError("tier_3 fail")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.build_tier3_categories",
            fake,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "Phase 4" in str(exc.value)

    def test_tier1_phase_unexpected_error_wraps(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """tier_1 is built in Phase 5."""
        def fake(*a, **kw):
            raise RuntimeError("tier_1 fail")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.build_tier1_project",
            fake,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "Phase 5" in str(exc.value)

    def test_id_phase_unexpected_error_wraps(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """mint_formwork_id runs in Phase 6."""
        def fake(*a, **kw):
            raise RuntimeError("id fail")
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.mint_formwork_id",
            fake,
        )
        with pytest.raises(FormworkError) as exc:
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "Phase 6" in str(exc.value)


# ═════════════════════════════════════════════════════════════════════
# DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestDeterminism:
    def test_byte_equal_on_repeat(self, p_int_8_mapper_output, formwork_context_p_int_8):
        o1 = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        o2 = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert dataclasses.asdict(o1) == dataclasses.asdict(o2)

    def test_byte_equal_across_5_calls(self, p_int_8_mapper_output, formwork_context_p_int_8):
        outputs = [
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
            for _ in range(5)
        ]
        first = dataclasses.asdict(outputs[0])
        for i, o in enumerate(outputs[1:], 1):
            assert dataclasses.asdict(o) == first, f"Output {i} diverged"


# ═════════════════════════════════════════════════════════════════════
# EMPTY WALLS (Option B — valid empty output per Pre-flight B)
# ═════════════════════════════════════════════════════════════════════


class TestEmptyWalls:
    def test_empty_walls_produces_empty_tiers(self, p_int_8_mapper_output, formwork_context_p_int_8):
        empty = dataclasses.replace(p_int_8_mapper_output, wall_segments=())
        output = generate_formwork(empty, formwork_context_p_int_8)
        assert output.tier_5_wall_segments == ()
        assert output.tier_6_components == ()
        assert output.tier_4_sku_details == ()

    def test_empty_walls_handlers_empty(self, p_int_8_mapper_output, formwork_context_p_int_8):
        empty = dataclasses.replace(p_int_8_mapper_output, wall_segments=())
        output = generate_formwork(empty, formwork_context_p_int_8)
        assert output.custom_quote_items == ()
        assert output.operator_review_items == ()


# ═════════════════════════════════════════════════════════════════════
# ORCHESTRATOR-POPULATED FIELDS — byte-equal vs golden
# ═════════════════════════════════════════════════════════════════════


class TestOrchestratorFieldsByteEqual:
    def test_warnings_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert list(output.warnings) == p_int_8_formwork_golden["warnings"]

    def test_assumptions_made_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert list(output.assumptions_made) == p_int_8_formwork_golden["assumptions_made"]

    def test_pending_karthik_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert list(output.pending_karthik) == p_int_8_formwork_golden["pending_karthik"]

    def test_schema_version_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.schema_version == p_int_8_formwork_golden["schema_version"]


# ═════════════════════════════════════════════════════════════════════
# LOGGING + monkeypatch path correctness
# ═════════════════════════════════════════════════════════════════════


class TestLogging:
    def test_phase_logging_present(
        self, p_int_8_mapper_output, formwork_context_p_int_8, caplog,
    ):
        with caplog.at_level(logging.INFO):
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        text = caplog.text
        assert "Phase 1" in text
        assert "Phase 3" in text
        assert "SUCCESS" in text

    def test_logs_count_metrics(
        self, p_int_8_mapper_output, formwork_context_p_int_8, caplog,
    ):
        with caplog.at_level(logging.INFO):
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        text = caplog.text
        assert "corners" in text.lower() or "tier" in text.lower()

    def test_no_full_mapper_in_logs(
        self, p_int_8_mapper_output, formwork_context_p_int_8, caplog,
    ):
        """Logs must not include raw mapper_output object dump."""
        with caplog.at_level(logging.DEBUG):
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        text = caplog.text
        # Indicators of full object dump
        assert "wall_segments=" not in text
        assert "PanelGridMapperOutput(" not in text


class TestValidatorCallTracking:
    def test_validator_called_on_happy_path(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        validator_called = []
        from app.services.kos_formwork_generator import orchestrator as orch_module
        original = orch_module.validate_formwork_output

        def tracking_validator(output):
            validator_called.append(True)
            return original(output)

        monkeypatch.setattr(orch_module, "validate_formwork_output", tracking_validator)
        generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert validator_called == [True]

    def test_validator_not_called_on_early_failure(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """If Phase 1 fails, validator MUST NOT be called."""
        validator_called = []

        def fake_count_corners(wall_segments):
            raise RuntimeError("Phase 1 fail")

        def tracking_validator(output):
            validator_called.append(True)
            return ()

        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.count_corners",
            fake_count_corners,
        )
        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.validate_formwork_output",
            tracking_validator,
        )
        with pytest.raises(FormworkError):
            generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert validator_called == []


# ═════════════════════════════════════════════════════════════════════
# SOFT WARNINGS MERGE (Phase 9)
# ═════════════════════════════════════════════════════════════════════


class TestSoftWarningsMerge:
    def test_soft_warnings_merge_into_output_warnings(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """Validator soft warnings extend output.warnings."""
        def fake_validator(output):
            return ("F-1 (soft): synthetic warning A", "F-6 (soft): synthetic B")

        monkeypatch.setattr(
            "app.services.kos_formwork_generator.orchestrator.validate_formwork_output",
            fake_validator,
        )
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert "F-1 (soft): synthetic warning A" in output.warnings
        assert "F-6 (soft): synthetic B" in output.warnings


# ═════════════════════════════════════════════════════════════════════
# RETURN VALUE INTEGRITY
# ═════════════════════════════════════════════════════════════════════


class TestReturnIntegrity:
    def test_formwork_id_is_uuid(self, p_int_8_mapper_output, formwork_context_p_int_8):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        # Pattern: 8-4-4-4-12 hex
        import re
        assert re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            output.formwork_id,
        )

    def test_generated_at_has_z_suffix(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        output = generate_formwork(p_int_8_mapper_output, formwork_context_p_int_8)
        assert output.generated_at.endswith("Z")
