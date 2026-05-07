"""Phase 2A Slice 2 — brief style classifier tests.

Covers the four R3 reference weight distributions in the Phase 2A prompt
within ±0.15 tolerance per weight, plus 12 additional edge cases:
empty / low-signal briefs, PDF-text equivalence, combined-source
briefs, deterministic-output guarantee, BriefForm explicit-field
counting, weight-sum and confidence-range invariants.

Each test starts from a fresh ``DesignRequest`` constructed inline
(no shared fixture) so failures pin to a single combination of input
signals — the same independent-test discipline as
``tests/test_building_model_construction.py``.

The tolerance is ±0.15 per weight (so a 0.7 expected weight passes for
any actual in [0.55, 0.85]). Tightening this below ±0.15 to "game" a
test would mean the rule weights are over-fitted to that exact phrase;
the prompt explicitly forbids that.
"""

from __future__ import annotations

import pytest

from app.services.design_agent import (
    BriefForm,
    BriefStyleWeights,
    DesignRequest,
    classify_brief,
)
from app.services.design_agent.classifier import (
    LOW_SIGNAL_THRESHOLD,
    _llm_classify_fallback,
)


# ─── Tolerance helper ─────────────────────────────────────────────────


_TOL: float = 0.15


def _assert_weights_close(
    weights: BriefStyleWeights,
    expected_fp: float,
    expected_nr: float,
    expected_pa: float,
    tol: float = _TOL,
) -> None:
    """Assert the three weights match expected within ``tol`` each.

    Reports all three differences in one message on failure so
    iterating on the scoring constants is fast (you see all three
    deltas at once instead of fixing them one at a time).
    """
    actual = (weights.floor_plan, weights.narrative, weights.parametric)
    expected = (expected_fp, expected_nr, expected_pa)
    deltas = tuple(a - e for a, e in zip(actual, expected))
    if any(abs(d) > tol for d in deltas):
        pytest.fail(
            f"Weights mismatch (tol={tol}):\n"
            f"  expected floor_plan={expected_fp:.2f}, "
            f"narrative={expected_nr:.2f}, parametric={expected_pa:.2f}\n"
            f"  got      floor_plan={actual[0]:.2f}, "
            f"narrative={actual[1]:.2f}, parametric={actual[2]:.2f}\n"
            f"  deltas   floor_plan={deltas[0]:+.2f}, "
            f"narrative={deltas[1]:+.2f}, parametric={deltas[2]:+.2f}\n"
            f"  rationale: {weights.rationale}"
        )


def _make_request(
    *,
    brief_text: str | None = None,
    brief_pdf_text: str | None = None,
    brief_form: BriefForm | None = None,
    build_id: str = "test-build",
) -> DesignRequest:
    return DesignRequest(
        brief_text=brief_text,
        brief_pdf_text=brief_pdf_text,
        brief_form=brief_form,
        build_id=build_id,
    )


# ─── R3 reference distribution #1 — floor-plan dominant ──────────────


def test_classify_floor_plan_dominant() -> None:
    """R3 case 1: explicit room dims + plot dims + BHK shorthand.

    Expected: floor_plan ≈ 0.7, narrative ≈ 0.1, parametric ≈ 0.2.
    """
    req = _make_request(
        brief_text="24'×50' plot, 2BHK with 10x12 master bedroom and 8x10 kitchen"
    )
    w = classify_brief(req)
    _assert_weights_close(w, 0.7, 0.1, 0.2)
    assert w.confidence > 0.3, f"strong floor-plan brief should be confident, got {w.confidence}"


# ─── R3 reference distribution #2 — narrative dominant ───────────────


def test_classify_narrative_dominant() -> None:
    """R3 case 2: pure descriptive prose with one envelope dim.

    Expected: floor_plan ≈ 0.0, narrative ≈ 0.7, parametric ≈ 0.3.
    """
    req = _make_request(
        brief_text="Circular futuristic building, 30m diameter, sky-lobby on top floor"
    )
    w = classify_brief(req)
    _assert_weights_close(w, 0.0, 0.7, 0.3)
    assert w.floor_plan < 0.15


# ─── R3 reference distribution #3 — pure parametric ──────────────────


def test_classify_pure_parametric_form() -> None:
    """R3 case 3: BriefForm with 3 fields, no text.

    Expected: floor_plan = 0, narrative = 0, parametric = 1.0.
    """
    form = BriefForm(floors=3, bhk_count=2, plot_area_sqft=1200)
    req = _make_request(brief_form=form)
    w = classify_brief(req)
    _assert_weights_close(w, 0.0, 0.0, 1.0)
    assert w.confidence > 0.5  # high concentration → high confidence


# ─── R3 reference distribution #4 — narrative + form (50/50 hybrid) ──


def test_classify_hybrid_narrative_plus_form() -> None:
    """R3 case 4: narrative text plus a single-field BriefForm.

    Expected: floor_plan ≈ 0.0, narrative ≈ 0.5, parametric ≈ 0.5.
    """
    form = BriefForm(floors=3)
    req = _make_request(
        brief_text="Modern apartment for young couple, lots of natural light",
        brief_form=form,
    )
    w = classify_brief(req)
    _assert_weights_close(w, 0.0, 0.5, 0.5)


# ─── Reminder example from the prompt ────────────────────────────────


def test_classify_envelope_only_brief_reminder_case() -> None:
    """Prompt's reminder: "30m circular futuristic, 5 floors".

    Has numbers (30m, 5 floors) but no room-level dimensions.
    Expected: narrative ≈ 0.7, parametric ≈ 0.3, floor_plan ≈ 0.0.
    """
    req = _make_request(brief_text="30m circular futuristic, 5 floors")
    w = classify_brief(req)
    _assert_weights_close(w, 0.0, 0.7, 0.3)


# ─── Edge case: low-signal → uniform fallback ────────────────────────


def test_classify_low_signal_returns_uniform_fallback() -> None:
    """A brief with no recognised signals must take the LLM-stub path.

    Returns uniform 1/3 weights with low confidence and a rationale
    that flags the fallback.
    """
    req = _make_request(brief_text="hello")
    w = classify_brief(req)
    third = 1.0 / 3.0
    assert abs(w.floor_plan - third) < 1e-6
    assert abs(w.narrative - third) < 1e-6
    assert abs(w.parametric - third) < 1e-6
    assert w.confidence < 0.3
    assert "uniform fallback" in w.rationale.lower()


def test_classify_completely_empty_request_falls_back() -> None:
    """Even with nothing but a build_id, classifier still returns a valid envelope."""
    req = _make_request()
    w = classify_brief(req)
    third = 1.0 / 3.0
    assert abs(w.floor_plan - third) < 1e-6
    assert w.confidence < 0.3


# ─── Edge case: metric-unit dims should still register as floor-plan ─


def test_classify_floor_plan_with_metric_dims() -> None:
    """5x6 m kitchen + 4x5 m living → floor-plan dominant."""
    req = _make_request(
        brief_text="5x6 m kitchen, 4x5 m living, 3.5x4 m bedroom"
    )
    w = classify_brief(req)
    assert w.floor_plan > 0.6
    assert w.floor_plan > w.narrative
    assert w.floor_plan > w.parametric


# ─── Edge case: empty BriefForm provides no parametric signal ────────


def test_classify_form_default_fields_dont_count() -> None:
    """An untouched BriefForm() must NOT add parametric signal.

    ``model_fields_set`` excludes default values that the user never
    explicitly passed. So ``BriefForm()`` plus narrative text should
    classify as pure narrative, not 50/50 with parametric.
    """
    empty_form = BriefForm()
    req = _make_request(
        brief_text="Modern luxurious villa with open plan living",
        brief_form=empty_form,
    )
    w = classify_brief(req)
    assert w.narrative > 0.6, f"empty form must not split signal: {w}"


def test_classify_form_with_one_explicit_field_counts() -> None:
    """One explicitly-set BriefForm field is one parametric signal."""
    form = BriefForm(floors=4)
    req = _make_request(brief_form=form)
    w = classify_brief(req)
    assert w.parametric > 0.95, "single-field form is pure parametric"


# ─── Edge case: PDF text and free text must be treated identically ───


def test_classify_pdf_text_treated_as_text() -> None:
    """Same brief routed via brief_pdf_text or brief_text → identical weights."""
    text = "30m circular futuristic, 5 floors"
    via_text = classify_brief(_make_request(brief_text=text))
    via_pdf = classify_brief(_make_request(brief_pdf_text=text))
    assert abs(via_text.floor_plan - via_pdf.floor_plan) < 1e-9
    assert abs(via_text.narrative - via_pdf.narrative) < 1e-9
    assert abs(via_text.parametric - via_pdf.parametric) < 1e-9


def test_classify_combined_pdf_form_text_concatenates() -> None:
    """All three sources together accumulate signals from each."""
    form = BriefForm(floors=3, bhk_count=2)
    req = _make_request(
        brief_text="Modern apartment",
        brief_pdf_text="With a 4x5 m kitchen",
        brief_form=form,
    )
    w = classify_brief(req)
    # Should have non-zero weight in all three styles
    assert w.floor_plan > 0.0   # from "4x5 m kitchen"
    assert w.narrative > 0.0    # from "modern", "apartment"
    assert w.parametric > 0.0   # from BriefForm fields


def test_classify_indian_2bhk_pune_brief() -> None:
    """Realistic Indian residential brief — moderate parametric lean."""
    req = _make_request(
        brief_text="2 BHK in Pune, 1200 sqft, modern style"
    )
    w = classify_brief(req)
    # Parametric leads (2BHK, 1200 sqft, "Pune" not a signal).
    assert w.parametric > w.floor_plan
    assert w.parametric > w.narrative * 0.7  # narrative still material from "modern"
    assert w.floor_plan < 0.15


# ─── Invariant tests ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "brief",
    [
        "24'×50' plot, 2BHK with 10x12 master bedroom",
        "Circular futuristic building, 30m diameter",
        "Modern apartment for young couple",
        "2 BHK in Pune, 1200 sqft, modern",
        "hello",  # low-signal → fallback
        "",       # empty → fallback
    ],
)
def test_classify_weights_always_sum_to_one(brief: str) -> None:
    """The BRIEF_STYLE_WEIGHTS_NORMALIZED invariant fires inside .build();
    if classify_brief ever produced un-normalized weights, this test would
    raise DesignContextValidationError before the assert is reached."""
    req = _make_request(brief_text=brief or None)
    w = classify_brief(req)
    total = w.floor_plan + w.narrative + w.parametric
    assert abs(total - 1.0) < 1e-6, f"weights {w} did not normalize"


@pytest.mark.parametrize(
    "brief",
    [
        "24'×50' plot, 2BHK with 10x12 master bedroom",
        "Circular futuristic building, 30m diameter",
        "Modern apartment for young couple",
    ],
)
def test_classify_rationale_non_empty_and_useful(brief: str) -> None:
    """The rationale field must mention the dominant style."""
    w = classify_brief(_make_request(brief_text=brief))
    assert len(w.rationale) >= 10
    rationale_lower = w.rationale.lower()
    assert any(
        s in rationale_lower for s in ("floor-plan", "narrative", "parametric", "hybrid")
    ), f"rationale must reference a style: {w.rationale}"


@pytest.mark.parametrize(
    "brief,form",
    [
        ("24'×50' plot, 2BHK with 10x12 master bedroom", None),
        ("Circular futuristic building, 30m diameter", None),
        (None, BriefForm(floors=3, bhk_count=2)),
        ("hello", None),
    ],
)
def test_classify_confidence_in_zero_one_range(brief, form) -> None:
    w = classify_brief(_make_request(brief_text=brief, brief_form=form))
    assert 0.0 <= w.confidence <= 1.0


def test_classify_deterministic_pure_function() -> None:
    """Same input → same output. Critical for the route handler's caching."""
    req = _make_request(
        brief_text="Modern apartment for young couple, lots of natural light",
        brief_form=BriefForm(floors=3),
    )
    a = classify_brief(req)
    b = classify_brief(req)
    assert a.floor_plan == b.floor_plan
    assert a.narrative == b.narrative
    assert a.parametric == b.parametric
    assert a.confidence == b.confidence
    assert a.rationale == b.rationale


# ─── LLM fallback stub direct test ────────────────────────────────────


def test_llm_fallback_stub_returns_uniform_distribution() -> None:
    """Direct unit test on the fallback function (Slice 2A.4 swaps the body).

    This guards the API the route handler relies on — the stub must
    return a valid BriefStyleWeights envelope (sum=1.0, low confidence,
    rationale signaling the fallback) so 2A.4 can't accidentally break
    the contract when wiring in the real LLM call.
    """
    req = _make_request(brief_text="x")  # any request — stub ignores it
    w = _llm_classify_fallback(req)
    assert isinstance(w, BriefStyleWeights)
    assert abs(w.floor_plan + w.narrative + w.parametric - 1.0) < 1e-6
    assert w.confidence < 0.3
    assert "fallback" in w.rationale.lower()


def test_low_signal_threshold_is_documented_constant() -> None:
    """Sanity: the threshold is a positive small number, not zero."""
    assert 0.0 < LOW_SIGNAL_THRESHOLD < 2.0
