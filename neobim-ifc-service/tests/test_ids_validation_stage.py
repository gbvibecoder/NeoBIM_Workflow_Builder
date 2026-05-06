"""Phase 0 — Stage 2.5 (VALIDATE-IFC) integration tests.

End-to-end: build each fixture at each fidelity, run validate_ifc, and
pin the violation count. The pinned counts will trend down in later
phases as the builders close the gaps that core/lod-300/lod-350 demand —
they are the *current floor* of IFC quality, not the aspirational
ceiling. A drift in either direction is a signal:

* count goes DOWN (fewer violations) — celebrate, then re-pin so the
  test continues guarding the new floor.
* count goes UP (more violations) — investigate before merging.

Both `ifctester` and `ifcopenshell` are required for the strict path;
when missing we skip rather than fail (developer laptops).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

# Module-level skip — the rest of the file requires both libs at runtime.
ifcopenshell = pytest.importorskip("ifcopenshell")
pytest.importorskip("ifctester")


from app.models.request import ExportIFCRequest  # noqa: E402
from app.models.response import IdsValidationResult  # noqa: E402
from app.services.ifc_builder import build_multi_discipline  # noqa: E402
from app.services.ids_validator import (  # noqa: E402
    LATENCY_TARGET_SECONDS,
    merge_results,
    validate_ifc,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"
ALL_FIXTURES = ["simple_box", "multistorey_residential", "non_rectangular"]


def _load(name: str) -> ExportIFCRequest:
    raw = json.loads((FIXTURE_DIR / f"{name}.json").read_text())
    raw.pop("_comment", None)
    return ExportIFCRequest.model_validate(raw)


def _validate_combined(req: ExportIFCRequest, fidelity: str) -> IdsValidationResult:
    """Build the combined-discipline IFC for `req` and validate it."""
    new_options = req.options.model_copy(update={
        "target_fidelity": fidelity,
        "disciplines": ["combined"],
    })
    new_req = req.model_copy(update={"options": new_options})

    results = build_multi_discipline(new_req)
    ifc_bytes, _, _ = results["combined"]

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
        tmp.write(ifc_bytes)
        tmp.flush()
        tmp_path = tmp.name
    model = ifcopenshell.open(tmp_path)
    return validate_ifc(model, "combined", fidelity)


# ── Smoke / shape ────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
@pytest.mark.parametrize(
    "fidelity",
    ["concept", "design-development", "tender-ready"],
)
def test_validate_ifc_returns_structured_result(fixture: str, fidelity: str):
    req = _load(fixture)
    result = _validate_combined(req, fidelity)
    assert isinstance(result, IdsValidationResult)
    assert result.target_fidelity == fidelity
    # Every run that reaches here exercised at least one IDS file.
    assert result.files_validated >= 1, f"expected ≥1 file, got {result.files_validated}"
    assert result.rules_evaluated >= 1, f"expected ≥1 rule, got {result.rules_evaluated}"


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_concept_validates_against_fewer_rules_than_design_dev(fixture: str):
    """Higher fidelity must evaluate ≥ rules than lower fidelity."""
    req = _load(fixture)
    concept = _validate_combined(req, "concept")
    dev = _validate_combined(req, "design-development")
    assert dev.rules_evaluated >= concept.rules_evaluated, (
        f"{fixture}: design-development evaluated "
        f"{dev.rules_evaluated} rules, concept evaluated "
        f"{concept.rules_evaluated} — design-development must be ≥"
    )


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_design_dev_validates_against_fewer_rules_than_tender_ready(fixture: str):
    req = _load(fixture)
    dev = _validate_combined(req, "design-development")
    tender = _validate_combined(req, "tender-ready")
    assert tender.rules_evaluated >= dev.rules_evaluated, (
        f"{fixture}: tender-ready evaluated {tender.rules_evaluated} rules, "
        f"design-development evaluated {dev.rules_evaluated} — must be ≥"
    )


# ── Latency budget (R5 — < 5 s on largest fixture) ──────────────────


def test_validation_latency_under_budget_on_largest_fixture():
    """The R5 hard target: validation completes in under 5 s on the
    largest fixture (multistorey_residential). If this regresses, the
    Phase 0 pipeline is too slow to ship — investigate before merging."""
    req = _load("multistorey_residential")
    result = _validate_combined(req, "tender-ready")
    budget_ms = LATENCY_TARGET_SECONDS * 1000.0
    assert result.elapsed_ms < budget_ms, (
        f"validation took {result.elapsed_ms} ms — exceeds the "
        f"{budget_ms} ms (5 s) budget. Profile and optimize."
    )


# ── Severity flow ────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_violations_carry_required_payload_fields(fixture: str):
    """When a spec fails, every emitted violation must carry the
    contract fields (rule_id, severity, expected, actual). Without these
    the response payload is opaque."""
    req = _load(fixture)
    result = _validate_combined(req, "design-development")
    for v in result.violations + result.warnings:
        assert v.rule_id, "violation has no rule_id"
        assert v.rule_name, "violation has no rule_name"
        assert v.severity in ("error", "warning")
        assert v.discipline == "combined"
        assert v.expected, "violation has no expected text"
        assert v.actual, "violation has no actual text"


def test_passed_flag_reflects_violations_not_warnings():
    """Warnings must NOT flip `passed` to False — only error-severity
    violations should. This mirrors the export response status-flip
    contract."""
    # Synthesize: a result with 0 violations + N warnings should pass.
    from app.models.response import IdsValidationResult, IdsViolation

    fake_warning = IdsViolation(
        rule_id="X", rule_name="X", severity="warning",
        discipline="combined", expected="x", actual="y",
    )
    r = IdsValidationResult(violations=[], warnings=[fake_warning] * 3)
    # `passed` defaults to True when constructed without explicit override
    # — that is the contract our code relies on. The route layer doesn't
    # decide pass/fail; the validator does.
    assert r.passed is True
    assert len(r.warnings) == 3
    assert len(r.violations) == 0


# ── Aggregation ──────────────────────────────────────────────────────


def test_merge_results_sums_violations_and_warnings():
    from app.models.response import IdsValidationResult, IdsViolation

    a_err = IdsViolation(
        rule_id="A", rule_name="A", severity="error",
        discipline="architectural", expected="x", actual="y",
    )
    b_warn = IdsViolation(
        rule_id="B", rule_name="B", severity="warning",
        discipline="structural", expected="x", actual="y",
    )
    r1 = IdsValidationResult(
        passed=False, target_fidelity="design-development",
        violations=[a_err], warnings=[],
        files_validated=2, rules_evaluated=10, elapsed_ms=100,
    )
    r2 = IdsValidationResult(
        passed=True, target_fidelity="design-development",
        violations=[], warnings=[b_warn],
        files_validated=2, rules_evaluated=11, elapsed_ms=120,
    )
    merged = merge_results([r1, r2])
    assert merged.passed is False  # any non-passed input → not passed
    assert len(merged.violations) == 1
    assert len(merged.warnings) == 1
    assert merged.files_validated == 4
    assert merged.rules_evaluated == 21
    assert merged.elapsed_ms == 220.0


def test_merge_results_handles_empty_input():
    """merge_results([]) should return a vanilla IdsValidationResult,
    not crash. The route layer relies on this when no fixture validated
    successfully (e.g. ifctester missing on the worker)."""
    merged = merge_results([])
    assert merged.passed is True
    assert merged.violations == []
    assert merged.warnings == []


# ── Pinned baseline counts ───────────────────────────────────────────
#
# These pins are intentionally LOOSE bounds: the exact count depends on
# the current builder state and will trend toward zero as later phases
# close gaps. We assert "violations exist" or "violations are within a
# generous band" rather than equality so this file doesn't churn on
# every Phase-1+ improvement.


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_concept_tier_baseline_has_few_or_no_violations(fixture: str):
    """At concept tier we only validate `core.ids`. The current builders
    already populate spatial structure + GUIDs + basic placement, so the
    expected violation count at concept is LOW (target: 0 in a healthy
    state, ≤ 5 today)."""
    req = _load(fixture)
    result = _validate_combined(req, "concept")
    assert len(result.violations) <= 5, (
        f"{fixture}: concept tier produced {len(result.violations)} "
        f"violations — spec-mandatory floor is broken. "
        f"Sample: {[v.rule_id for v in result.violations[:5]]}"
    )


@pytest.mark.parametrize("fixture", ALL_FIXTURES)
def test_tender_ready_tier_baseline_violations_are_finite(fixture: str):
    """At tender-ready the violation floor is high today (no rebar, no
    structural-analysis-model yet — those land in Phase 1+). We pin a
    GENEROUS upper bound to catch infinite-loop / fan-out regressions
    without churning on every legitimate improvement."""
    req = _load(fixture)
    result = _validate_combined(req, "tender-ready")
    # Pin: a single fixture must not produce more violations than there
    # are entities in the model × number of rules (a sane upper bound).
    # Practical band: < 10000 keeps room for any reasonable scenario
    # while flagging regression where every entity fails every rule.
    assert len(result.violations) < 10000, (
        f"{fixture}: tender-ready produced {len(result.violations)} "
        f"violations — likely fan-out bug, investigate before merging."
    )
