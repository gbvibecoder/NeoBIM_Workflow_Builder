"""Slice 2B.1.B — TemplateMatcher prompt + stage-runner tests.

Two test layers (mirroring test_brief_analyst.py):

* **Cache-only tests** (always run, no API key needed) — exercise the
  deterministic pieces: prompt builder, user-message builder, the
  internal :class:`_MatcherDecision` wire schema, the
  :func:`_decode_decision` translation logic, and the
  :class:`TemplateMatcherMetadata` accounting record. These pin the
  contract against the LLM-side surface without consuming any tokens.

* **LLM-driven tests** (added in slice 2B.1.C from cache fixtures)
  — run the full :func:`run_template_matcher` against the committed
  brief fixtures. They use a graceful skip helper so:

    - Cache present: tests run from disk, no API needed.
    - No cache + no ``ANTHROPIC_API_KEY``: ``pytest.skip`` cleanly
      naming the missing cache key.
    - No cache + valid key: real Haiku 4.5 call, cache file is
      written, test asserts on the returned envelope.

The 2B.1.B slice ships layer 1 only; layer 2 lights up in 2B.1.C once
the brief fixtures + cache are committed.
"""

from __future__ import annotations

import pytest

from app.services.design_agent import (
    BriefAnalysis,
    BuildingClass,
    FidelityHint,
    LLMClient,
    MatchFailed,
    MatchResult,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    TemplateId,
    TemplateMatcherMetadata,
    TemplateParameters,
)
from app.services.design_agent.prompts.template_matcher import (
    build_template_matcher_system_prompt,
    build_template_matcher_user_message,
)
from app.services.design_agent.stages.template_matcher import (
    _DEFAULT_CONFIDENCE_THRESHOLD,
    _TEMPLATE_MATCHER_TIMEOUT_S,
    _MatcherDecision,
    _decode_decision,
)


# ─── BriefAnalysis fixture builder ───────────────────────────────────


def _build_minimal_analysis(
    *,
    primary_type: str = "residential",
    sub_type: str = "duplex",
    nbc_group: str = "A-3",
    nbc_subdivision: str = "Two-family residential",
    plot_width_m: "float | None" = 7.32,
    plot_length_m: "float | None" = 15.24,
    location_city: "str | None" = "Pune",
    seismic_zone: "str | None" = "III",
    wind_zone: "int | None" = 2,
    floors_above_ground: int = 2,
    floors_below_ground: int = 0,
    architectural_style: str = "modern",
    raw_brief_summary: str = (
        "User wants a 2BHK G+1 duplex on a 24x50 ft Pune plot, modern "
        "north-facing with internal stair."
    ),
    explicit_room_list: "list[str] | None" = None,
    user_priorities: "list[str] | None" = None,
) -> BriefAnalysis:
    """Build a BriefAnalysis fixture for matcher tests.

    Defaults describe a 2BHK Pune duplex (the flagship template) so
    tests that don't override fields exercise the matcher's happy path.
    """
    return BriefAnalysis(
        building_class=BuildingClass(
            primary_type=primary_type,  # type: ignore[arg-type]
            sub_type=sub_type,
            nbc_group=nbc_group,  # type: ignore[arg-type]
            nbc_subdivision=nbc_subdivision,
        ),
        site_context=SiteContext(
            plot_width_m=plot_width_m,
            plot_length_m=plot_length_m,
            location_city=location_city,
            seismic_zone=seismic_zone,  # type: ignore[arg-type]
            wind_zone=wind_zone,
        ),
        style_intent=StyleIntent(architectural_style=architectural_style),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=floors_above_ground,
        floors_below_ground=floors_below_ground,
        explicit_room_list=explicit_room_list or [],
        user_priorities=user_priorities or [],
        raw_brief_summary=raw_brief_summary,
    )


# ─── System-prompt invariants ────────────────────────────────────────


def test_system_prompt_clears_anthropic_cache_minimum() -> None:
    """The matcher's system prompt must exceed 1024 tokens for
    Anthropic's ephemeral prompt cache to actually buy us anything.
    Rough estimate: chars/4. Guard with a comfortable margin
    (>= 1500 estimated tokens, ~6000 chars).
    """
    prompt = build_template_matcher_system_prompt()
    assert len(prompt) >= 1500 * 4, (
        f"matcher system prompt too short ({len(prompt)} chars ~ "
        f"{len(prompt) // 4} tokens) — cache minimum is 1024 tokens"
    )


def test_system_prompt_includes_every_template_id() -> None:
    """Every TemplateId enum value (the exact function-name string)
    appears at least once in the prompt — drift sentinel between the
    catalog and the prompt builder."""
    prompt = build_template_matcher_system_prompt()
    for tid in TemplateId:
        assert tid.value in prompt, (
            f"matcher prompt missing TemplateId {tid.value!r}; the "
            f"LLM cannot emit a value it has never seen"
        )


def test_system_prompt_includes_decision_discriminator_values() -> None:
    """The 'match' / 'refuse' discriminator values must be in the
    prompt so the LLM emits the exact tokens the wire schema accepts.
    """
    prompt = build_template_matcher_system_prompt()
    assert "match" in prompt
    assert "refuse" in prompt
    assert "decision" in prompt


def test_system_prompt_includes_refusal_triggers() -> None:
    """All five refusal categories from the spec must be enumerated."""
    prompt = build_template_matcher_system_prompt().lower()
    assert "commercial" in prompt
    assert "hospital" in prompt or "institutional" in prompt
    assert "4bhk" in prompt or ">3bhk" in prompt
    assert "cylindrical" in prompt or "non-rectangular" in prompt
    assert (
        "swimming pool" in prompt
        or "basement" in prompt
        or "helipad" in prompt
    )


def test_system_prompt_includes_parameter_extraction_rules() -> None:
    """Critical extraction guidance (ft↔m, G+N parsing, defaults) must
    be present — without these the matcher fabricates parameters."""
    prompt = build_template_matcher_system_prompt()
    assert "0.3048" in prompt or "ft" in prompt.lower(), (
        "ft↔m conversion guidance missing"
    )
    assert "G+5" in prompt or "G+11" in prompt or "habitable" in prompt
    assert "typical_plot" in prompt


def test_system_prompt_includes_suggested_action_values() -> None:
    """The three SuggestedAction literal values must appear so the
    LLM emits the canonical tokens."""
    prompt = build_template_matcher_system_prompt()
    assert "reject" in prompt
    assert "ask_user_clarification" in prompt
    assert "fallback_to_design_agent" in prompt


def test_system_prompt_is_deterministic() -> None:
    """Same prompt across calls — no randomness, no timestamps."""
    p1 = build_template_matcher_system_prompt()
    p2 = build_template_matcher_system_prompt()
    assert p1 == p2


# ─── User-message invariants ─────────────────────────────────────────


def test_user_message_is_deterministic_for_same_analysis() -> None:
    """Same BriefAnalysis -> identical user message (cache key
    stability)."""
    a = _build_minimal_analysis()
    msg1 = build_template_matcher_user_message(a)
    msg2 = build_template_matcher_user_message(a)
    assert msg1 == msg2


def test_user_message_includes_brief_summary() -> None:
    a = _build_minimal_analysis(
        raw_brief_summary="Custom summary text 12345."
    )
    msg = build_template_matcher_user_message(a)
    assert "Custom summary text 12345." in msg


def test_user_message_includes_floor_count() -> None:
    a = _build_minimal_analysis(floors_above_ground=11)
    msg = build_template_matcher_user_message(a)
    assert "11" in msg


def test_user_message_includes_city_and_zone() -> None:
    a = _build_minimal_analysis(
        location_city="Mumbai",
        seismic_zone="III",
        wind_zone=3,
    )
    msg = build_template_matcher_user_message(a)
    assert "Mumbai" in msg
    assert "III" in msg
    assert " 3" in msg or "3\n" in msg  # wind_zone integer present


def test_user_message_includes_plot_dimensions_when_set() -> None:
    a = _build_minimal_analysis(plot_width_m=8.5, plot_length_m=16.0)
    msg = build_template_matcher_user_message(a)
    assert "8.5" in msg
    assert "16.0" in msg


def test_user_message_marks_unspecified_when_plot_missing() -> None:
    a = _build_minimal_analysis(plot_width_m=None, plot_length_m=None)
    msg = build_template_matcher_user_message(a)
    assert "unspecified" in msg


def test_user_message_includes_explicit_rooms() -> None:
    a = _build_minimal_analysis(
        explicit_room_list=["living", "master_bedroom", "pooja"]
    )
    msg = build_template_matcher_user_message(a)
    assert "living" in msg
    assert "master_bedroom" in msg
    assert "pooja" in msg


def test_user_message_sorts_explicit_dimensions_for_determinism() -> None:
    """Explicit dimensions render in sorted-key order so two semantically
    identical analyses with differently-ordered dict literals share a
    cache hit."""
    # Build two BriefAnalyses whose explicit_dimensions dicts are
    # constructed in different insertion orders.
    a1 = _build_minimal_analysis().model_copy(
        update={"explicit_dimensions": {"living": "12x10", "kitchen": "8x6"}}
    )
    a2 = _build_minimal_analysis().model_copy(
        update={"explicit_dimensions": {"kitchen": "8x6", "living": "12x10"}}
    )
    assert build_template_matcher_user_message(a1) == build_template_matcher_user_message(a2)


# ─── _MatcherDecision wire-schema validators ─────────────────────────


def test_matcher_decision_rejects_match_without_template_id() -> None:
    with pytest.raises(Exception):
        _MatcherDecision(
            decision="match",
            confidence=0.9,
            reasoning="reasoning long enough",
            template_id=None,
            parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
        )


def test_matcher_decision_rejects_match_without_parameters() -> None:
    with pytest.raises(Exception):
        _MatcherDecision(
            decision="match",
            confidence=0.9,
            reasoning="reasoning long enough",
            template_id=TemplateId.BHK2_PUNE_DUPLEX,
            parameters=None,
        )


def test_matcher_decision_rejects_refuse_without_reason() -> None:
    with pytest.raises(Exception):
        _MatcherDecision(
            decision="refuse",
            confidence=0.1,
            reasoning="reasoning long enough",
            refusal_reason=None,
        )


def test_matcher_decision_rejects_refuse_with_blank_reason() -> None:
    with pytest.raises(Exception):
        _MatcherDecision(
            decision="refuse",
            confidence=0.1,
            reasoning="reasoning long enough",
            refusal_reason="   ",
        )


def test_matcher_decision_rejects_unknown_discriminator() -> None:
    with pytest.raises(Exception):
        _MatcherDecision(
            decision="maybe",
            confidence=0.5,
            reasoning="reasoning long enough",
        )


def test_matcher_decision_accepts_well_formed_match() -> None:
    d = _MatcherDecision(
        decision="match",
        confidence=0.9,
        reasoning="2BHK + duplex + Pune plot match.",
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    assert d.decision == "match"


def test_matcher_decision_accepts_well_formed_refuse() -> None:
    d = _MatcherDecision(
        decision="refuse",
        confidence=0.1,
        reasoning="Brief is for a hospital, out of catalogue scope.",
        refusal_reason="Hospital is not in the residential catalogue.",
        suggested_action="reject",
    )
    assert d.decision == "refuse"


# ─── _decode_decision translation logic ──────────────────────────────


def test_decode_match_above_threshold_returns_match_result() -> None:
    parsed = _MatcherDecision(
        decision="match",
        confidence=0.85,
        reasoning="2BHK duplex Pune match, plot 7.32x15.24.",
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    decoded = _decode_decision(parsed, threshold=0.6)
    assert isinstance(decoded, MatchResult)
    assert decoded.template_id == TemplateId.BHK2_PUNE_DUPLEX
    assert decoded.confidence == 0.85
    assert decoded.parameters.plot_width_m == 7.32


def test_decode_match_below_threshold_returns_match_failed() -> None:
    """Even when the LLM said decision='match', a confidence below
    threshold must downgrade to a refusal so the user is asked to
    clarify rather than receiving a wrong-template IFC.
    """
    parsed = _MatcherDecision(
        decision="match",
        confidence=0.4,
        reasoning="Possibly 2BHK duplex but brief is ambiguous.",
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    decoded = _decode_decision(parsed, threshold=0.6)
    assert isinstance(decoded, MatchFailed)
    assert decoded.best_template_attempted == TemplateId.BHK2_PUNE_DUPLEX
    assert decoded.best_confidence == 0.4
    assert decoded.threshold_required == 0.6
    assert decoded.suggested_action == "ask_user_clarification"


def test_decode_explicit_refusal_returns_match_failed() -> None:
    parsed = _MatcherDecision(
        decision="refuse",
        confidence=0.05,
        reasoning="Brief asks for a hospital with 50 beds.",
        refusal_reason="Hospitals are out of catalogue scope.",
        best_template_attempted=None,
        suggested_action="reject",
    )
    decoded = _decode_decision(parsed, threshold=0.6)
    assert isinstance(decoded, MatchFailed)
    assert decoded.suggested_action == "reject"
    assert "Hospital" in decoded.reason or "hospital" in decoded.reason
    assert decoded.best_template_attempted is None


def test_decode_refusal_defaults_action_to_clarification_when_unset() -> None:
    """Wire schema allows null suggested_action on refusal; runner
    falls back to the safe 'ask_user_clarification' default rather
    than silently mapping to 'reject'."""
    parsed = _MatcherDecision(
        decision="refuse",
        confidence=0.3,
        reasoning="Brief is too vague to classify.",
        refusal_reason="Missing BHK count and plot dimensions.",
        suggested_action=None,
    )
    decoded = _decode_decision(parsed, threshold=0.6)
    assert isinstance(decoded, MatchFailed)
    assert decoded.suggested_action == "ask_user_clarification"


# ─── Constants pinned ─────────────────────────────────────────────────


def test_default_confidence_threshold_is_zero_point_six() -> None:
    """Spec-mandated threshold; tunable but pinned for slice 2B.1.

    Loosening this without updating the test surface (and the spec
    risk register) would be a silent quality regression — refusal is
    the conservative lever and 0.6 is the calibrated value.
    """
    assert _DEFAULT_CONFIDENCE_THRESHOLD == 0.6


def test_matcher_timeout_is_thirty_seconds() -> None:
    """Spec-mandated wallclock ceiling for Haiku 4.5 matcher calls.

    This is the LLMClient per-model maximum (Haiku 4.5 = 30s in
    MODEL_MAX_TIMEOUT). The runner clamps to this; raising it would
    silently let a slow call block the route handler longer than the
    spec allows.
    """
    assert _TEMPLATE_MATCHER_TIMEOUT_S == 30.0


# ─── Metadata dataclass ──────────────────────────────────────────────


def test_template_matcher_metadata_is_frozen() -> None:
    md = TemplateMatcherMetadata(
        model="claude-haiku-4-5-20251001",
        latency_ms=120.0,
        cache_hit=True,
        cost_usd_estimated=0.00012,
        threshold=0.6,
        refused=False,
    )
    with pytest.raises(Exception):
        md.latency_ms = 0.0  # type: ignore[misc]


def test_template_matcher_metadata_records_refused_flag() -> None:
    md = TemplateMatcherMetadata(
        model="claude-haiku-4-5-20251001",
        latency_ms=120.0,
        cache_hit=True,
        cost_usd_estimated=0.0,
        threshold=0.6,
        refused=True,
    )
    assert md.refused is True


# ─── Runner — cache miss + no API key surfaces LLMUnavailableError ───


def test_run_template_matcher_raises_llm_unavailable_on_cache_miss(
    tmp_path,
    monkeypatch,
) -> None:
    """When neither cache nor API key is available, the runner must
    surface :class:`LLMUnavailableError` with a clear message — never
    return a fabricated MatchResult.
    """
    from app.services.design_agent import (
        LLMUnavailableError,
        run_template_matcher,
    )

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client = LLMClient(cache_dir=tmp_path)
    analysis = _build_minimal_analysis()

    with pytest.raises(LLMUnavailableError, match="ANTHROPIC_API_KEY"):
        run_template_matcher(analysis, llm_client=client)
