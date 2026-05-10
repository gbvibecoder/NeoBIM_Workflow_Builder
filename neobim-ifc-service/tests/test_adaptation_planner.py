"""Slice 2B.2.B — Stage-level unit tests for the adaptation planner.

Tests that need NO LLM call: prompt sanity, wire schema enforcement,
and the runner's translation from wire schema → public envelope. The
fixture-driven tests in :mod:`tests.test_adaptation_planner_fixtures`
exercise the live (cache-backed) LLM path.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.design_agent.llm_client import (
    PROMPT_CACHE_MIN_INPUT_TOKENS,
)
from app.services.design_agent.prompts.adaptation_planner import (
    build_adaptation_planner_system_prompt,
    build_adaptation_planner_user_message,
)
from app.services.design_agent.stages.adaptation_planner import (
    _AdaptationDecision,
    _decode_decision,
)
from app.services.design_agent.types import (
    AdaptationFailed,
    AdaptationPlan,
    BriefAnalysis,
    BuildingClass,
    FidelityHint,
    MatchResult,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    TemplateId,
    TemplateParameters,
    TransformAxis,
    TransformRotation,
)


# ─── Test helpers (mini brief-and-match constructors) ────────────────


def _ba() -> BriefAnalysis:
    return BriefAnalysis(
        building_class=BuildingClass(
            primary_type="residential",
            sub_type="duplex",
            nbc_group="A-3",
            nbc_subdivision="Two-family residential",
        ),
        site_context=SiteContext(
            plot_width_m=7.32,
            plot_length_m=15.24,
            location_city="Pune",
            seismic_zone="III",
            wind_zone=2,
        ),
        style_intent=StyleIntent(architectural_style="modern"),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=2,
        floors_below_ground=0,
        raw_brief_summary="Standard 2BHK duplex on north-facing plot",
    )


def _mr() -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.88,
        reasoning="2BHK + duplex form factor + Pune defaults; clean match.",
    )


# ─── Prompt sanity ───────────────────────────────────────────────────


def test_system_prompt_is_static() -> None:
    """Anthropic ephemeral prompt cache keys on the literal prompt
    text — two builds in the same process must produce the byte-
    identical string, otherwise the cache rate is zero."""
    a = build_adaptation_planner_system_prompt()
    b = build_adaptation_planner_system_prompt()
    assert a == b


def test_system_prompt_clears_ephemeral_cache_minimum() -> None:
    """Prompt must clear 1024 input tokens for ``cache_control:
    ephemeral`` to record any cache hit. We use a 4-char-per-token
    rough estimate; current prompt is ~10k chars / ~2.5k tokens."""
    prompt = build_adaptation_planner_system_prompt()
    estimated_tokens = len(prompt) // 4
    assert estimated_tokens >= PROMPT_CACHE_MIN_INPUT_TOKENS, (
        f"prompt is ~{estimated_tokens} tokens; need ≥ "
        f"{PROMPT_CACHE_MIN_INPUT_TOKENS} for ephemeral cache benefit"
    )


def test_system_prompt_mentions_six_canonical_transforms() -> None:
    """Surface signal — the prompt must list every transform shape
    the wire schema can emit, otherwise the LLM lacks a few-shot
    example for at least one outcome."""
    prompt = build_adaptation_planner_system_prompt()
    for token in (
        "north-facing", "south-facing", "east-facing", "west-facing",
        "mirror", "ship_as_is", "vastu", "Room swap",
    ):
        assert token.lower() in prompt.lower(), (
            f"prompt missing expected token: {token!r}"
        )


def test_user_message_is_deterministic() -> None:
    """Same BriefAnalysis + MatchResult must yield byte-identical
    user messages — the cache key includes this string verbatim."""
    a = build_adaptation_planner_user_message(_ba(), _mr())
    b = build_adaptation_planner_user_message(_ba(), _mr())
    assert a == b


def test_user_message_includes_brief_summary_and_template_id() -> None:
    """The bulk of the orientation signal lives in raw_brief_summary;
    the matched template_id grounds the planner's reasoning."""
    msg = build_adaptation_planner_user_message(_ba(), _mr())
    assert "Standard 2BHK duplex" in msg
    assert "build_2bhk_pune_duplex" in msg
    assert "north-facing entry" in msg


# ─── Wire schema validation ──────────────────────────────────────────


def test_wire_schema_accepts_no_op_adapt() -> None:
    d = _AdaptationDecision(
        decision="adapt",
        reasoning="north-facing template default; no transform requested",
    )
    assert d.mirror_axis == "none"
    assert d.rotation == "0"


def test_wire_schema_accepts_full_combined_adapt() -> None:
    d = _AdaptationDecision(
        decision="adapt",
        reasoning="mirrored AND south-facing; combined transform",
        mirror_axis="X",
        rotation="180",
    )
    assert d.mirror_axis == "X"
    assert d.rotation == "180"


def test_wire_schema_rejects_invalid_mirror_axis() -> None:
    with pytest.raises(ValidationError, match="mirror_axis"):
        _AdaptationDecision(
            decision="adapt",
            reasoning="invalid mirror axis test",
            mirror_axis="Z",  # not in {X, Y, none}
        )


def test_wire_schema_rejects_invalid_rotation() -> None:
    with pytest.raises(ValidationError, match="rotation"):
        _AdaptationDecision(
            decision="adapt",
            reasoning="invalid rotation test",
            rotation="45",  # not in {0, 90, 180, 270}
        )


def test_wire_schema_rejects_invalid_decision() -> None:
    with pytest.raises(ValidationError, match="decision must be"):
        _AdaptationDecision(
            decision="maybe",
            reasoning="invalid discriminator value test",
        )


def test_wire_schema_refuse_requires_reason_and_action() -> None:
    with pytest.raises(ValidationError, match="non-empty refusal_reason"):
        _AdaptationDecision(
            decision="refuse",
            reasoning="refuse without reason fails validation",
            suggested_action="ship_as_is",
        )
    with pytest.raises(ValidationError, match="suggested_action"):
        _AdaptationDecision(
            decision="refuse",
            reasoning="refuse without action fails validation",
            refusal_reason="vastu deferral",
        )


def test_wire_schema_rejects_short_reasoning() -> None:
    with pytest.raises(ValidationError):
        _AdaptationDecision(decision="adapt", reasoning="x")  # too short


# ─── _decode_decision translation ────────────────────────────────────


def test_decode_no_op_yields_no_op_plan() -> None:
    parsed = _AdaptationDecision(
        decision="adapt",
        reasoning="default orientation, no transform required",
    )
    out = _decode_decision(parsed)
    assert isinstance(out, AdaptationPlan)
    assert out.is_noop is True
    assert out.mirror_axis is None
    assert out.rotation == TransformRotation.NONE


def test_decode_mirror_only_yields_mirror_plan() -> None:
    parsed = _AdaptationDecision(
        decision="adapt",
        reasoning="explicit east-west mirror requested",
        mirror_axis="X",
    )
    out = _decode_decision(parsed)
    assert isinstance(out, AdaptationPlan)
    assert out.mirror_axis == TransformAxis.X
    assert out.rotation == TransformRotation.NONE
    assert out.is_noop is False


def test_decode_combined_yields_combined_plan() -> None:
    parsed = _AdaptationDecision(
        decision="adapt",
        reasoning="mirrored AND south-facing; combined plan",
        mirror_axis="Y",
        rotation="180",
    )
    out = _decode_decision(parsed)
    assert isinstance(out, AdaptationPlan)
    assert out.mirror_axis == TransformAxis.Y
    assert out.rotation == TransformRotation.CW_180


def test_decode_refuse_yields_adaptation_failed() -> None:
    parsed = _AdaptationDecision(
        decision="refuse",
        reasoning="vastu interpretation deferred to v2",
        refusal_reason="Vastu interpretation requires v2 planner.",
        suggested_action="ship_as_is",
    )
    out = _decode_decision(parsed)
    assert isinstance(out, AdaptationFailed)
    assert out.suggested_action == "ship_as_is"
    assert "v2" in out.reason.lower()


def test_decode_all_four_rotations_round_trip() -> None:
    """Every wire literal value for ``rotation`` decodes to the
    corresponding TransformRotation. Pinning this prevents a future
    schema change from silently dropping a rotation case."""
    for wire, expected in [
        ("0", TransformRotation.NONE),
        ("90", TransformRotation.CW_90),
        ("180", TransformRotation.CW_180),
        ("270", TransformRotation.CW_270),
    ]:
        parsed = _AdaptationDecision(
            decision="adapt",
            reasoning=f"rotate {wire} round-trip test",
            rotation=wire,
        )
        out = _decode_decision(parsed)
        assert isinstance(out, AdaptationPlan)
        assert out.rotation == expected


def test_decode_both_mirror_axes_round_trip() -> None:
    for wire, expected in [
        ("X", TransformAxis.X),
        ("Y", TransformAxis.Y),
        ("none", None),
    ]:
        parsed = _AdaptationDecision(
            decision="adapt",
            reasoning=f"mirror {wire} round-trip test",
            mirror_axis=wire,
        )
        out = _decode_decision(parsed)
        assert isinstance(out, AdaptationPlan)
        assert out.mirror_axis == expected
