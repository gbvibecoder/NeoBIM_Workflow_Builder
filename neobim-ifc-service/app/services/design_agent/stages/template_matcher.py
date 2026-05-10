"""Slice 2B.1.B — TemplateMatcher stage runner.

One LLM call: feeds a :class:`BriefAnalysis` through Haiku 4.5, parses
the tool_use output via :class:`_MatcherDecision` (a private wire
schema), then bifurcates into the public :class:`MatchResult` /
:class:`MatchFailed` envelope based on the model's discriminator and
its self-rated confidence vs the fixed threshold.

Why a private wire schema
-------------------------
The LLM's tool_use accepts exactly one JSON shape, but our public API
has two semantically distinct envelopes (success vs refusal). A
discriminated union over the wire is technically expressible in JSON
Schema (``oneOf`` + ``required`` per branch), but Haiku's tool_use
honours flat object shapes more reliably than ``oneOf`` discriminators.
:class:`_MatcherDecision` is therefore a single flat schema with a
``decision`` discriminator and per-branch optional fields, validated by
a model_validator that enforces shape-by-discriminator. The runner
then maps it to the public types.

Threshold
---------
A self-rated confidence below the threshold (default 0.6) downgrades a
``decision="match"`` to a :class:`MatchFailed` with
``suggested_action="ask_user_clarification"``. This is the conservative
refusal lever the spec calls for: better to ask for clarification than
to ship a wrong-template IFC.

Determinism
-----------
The LLM call is deterministic-by-cache via :class:`LLMClient`. Same
``(system_prompt, user_message, schema, model)`` -> same response from
disk. The committed cache files mint at slice 2B.1.C.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.design_agent.llm_client import LLMClient
from app.services.design_agent.prompts.template_matcher import (
    build_template_matcher_system_prompt,
    build_template_matcher_user_message,
)
from app.services.design_agent.types import (
    BriefAnalysis,
    MatchFailed,
    MatchResult,
    SuggestedAction,
    TemplateId,
    TemplateParameters,
)


_TEMPLATE_MATCHER_TIMEOUT_S: float = 30.0
"""Wallclock ceiling for the matcher LLM call.

Matcher responses are tightly bounded: nine TemplateId values, ~10
parameter fields, 2-4 sentences of reasoning. Haiku 4.5 generates
this in 2-5 seconds typically. The 30s ceiling is the LLMClient
per-model maximum and gives generous headroom for ephemeral-cache
warm-up + first-call cost; it is NOT the typical latency.
"""


_DEFAULT_CONFIDENCE_THRESHOLD: float = 0.6
"""Confidence floor below which a "match" decision is downgraded to a
refusal. Tunable; see slice 2B.1 risk register notes on calibration.
"""


# ─── Internal LLM wire schema ────────────────────────────────────────


class _MatcherDecision(BaseModel):
    """LLM tool_use wire format. Private — never returned by the runner.

    The runner translates a successful, above-threshold ``decision="match"``
    into :class:`MatchResult`; everything else (LLM-emitted refusal, or
    LLM-emitted match with confidence below threshold) becomes a
    :class:`MatchFailed`.

    The :func:`_decision_shape_well_formed` validator enforces the
    per-discriminator field shape so a malformed LLM response surfaces
    as :class:`LLMResponseValidationError` (caught by the LLMClient and
    propagated up) rather than as a None-deref deeper in the runner.
    """

    model_config = ConfigDict(frozen=True)

    decision: str = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: str = Field(..., min_length=10)

    # Populated when decision == "match".
    template_id: Optional[TemplateId] = None
    parameters: Optional[TemplateParameters] = None

    # Populated when decision == "refuse".
    refusal_reason: Optional[str] = None
    best_template_attempted: Optional[TemplateId] = None
    suggested_action: Optional[SuggestedAction] = None

    @model_validator(mode="after")
    def _decision_shape_well_formed(self) -> "_MatcherDecision":
        if self.decision == "match":
            if self.template_id is None:
                raise ValueError(
                    "decision='match' requires a non-null template_id"
                )
            if self.parameters is None:
                raise ValueError(
                    "decision='match' requires a non-null parameters object"
                )
        elif self.decision == "refuse":
            if not (self.refusal_reason and self.refusal_reason.strip()):
                raise ValueError(
                    "decision='refuse' requires a non-empty refusal_reason"
                )
        else:
            raise ValueError(
                f"decision must be 'match' or 'refuse'; got {self.decision!r}"
            )
        return self


# ─── Per-stage accounting ────────────────────────────────────────────


@dataclass(frozen=True)
class TemplateMatcherMetadata:
    """Per-call accounting record for the matcher stage.

    Mirrors :class:`BriefAnalystMetadata` /
    :class:`ProgramArchitectMetadata` so the route handler can sum
    cost / latency across stages without a custom aggregator.

    ``threshold`` is the confidence floor used for this call (always
    :data:`_DEFAULT_CONFIDENCE_THRESHOLD` in slice 2B.1; promoted to a
    parameter so future tuning can be observed in provenance).

    ``refused`` is True when the runner's output is a
    :class:`MatchFailed` (either because the LLM refused or because
    its confidence was below threshold).
    """

    model: str
    latency_ms: float
    cache_hit: bool
    cost_usd_estimated: float
    threshold: float
    refused: bool


# ─── Runner ──────────────────────────────────────────────────────────


def run_template_matcher(
    analysis: BriefAnalysis,
    *,
    llm_client: LLMClient,
    confidence_threshold: float = _DEFAULT_CONFIDENCE_THRESHOLD,
) -> tuple[Union[MatchResult, MatchFailed], TemplateMatcherMetadata]:
    """Run the matcher stage.

    Calls Haiku 4.5 with a 30-second wallclock ceiling and the
    :class:`_MatcherDecision` Pydantic schema as the structured-output
    target. The system prompt is shared across calls
    (``cache_shared_context=True``) so a sequence of matcher calls
    within the same product session benefits from Anthropic's
    ephemeral prompt cache.

    The LLM's self-rated confidence is the gating signal: above
    ``confidence_threshold`` (default 0.6) and ``decision="match"`` →
    :class:`MatchResult`. Anything else → :class:`MatchFailed` with an
    operator-actionable ``suggested_action``.
    """
    system_prompt = build_template_matcher_system_prompt()
    user_message = build_template_matcher_user_message(analysis)

    parsed, llm_metadata = llm_client.call(
        model="haiku-4.5",
        system_prompt=system_prompt,
        user_message=user_message,
        response_schema=_MatcherDecision,
        timeout_seconds=_TEMPLATE_MATCHER_TIMEOUT_S,
        cache_shared_context=True,
    )
    # Tighten the type: LLMClient returns a generic BaseModel.
    assert isinstance(parsed, _MatcherDecision)

    decoded = _decode_decision(parsed, threshold=confidence_threshold)

    metadata = TemplateMatcherMetadata(
        model=llm_metadata.model,
        latency_ms=llm_metadata.latency_ms,
        cache_hit=llm_metadata.cache_hit,
        cost_usd_estimated=llm_metadata.cost_usd_estimated,
        threshold=confidence_threshold,
        refused=isinstance(decoded, MatchFailed),
    )
    return decoded, metadata


def _decode_decision(
    parsed: _MatcherDecision,
    *,
    threshold: float,
) -> Union[MatchResult, MatchFailed]:
    """Translate the LLM wire schema into the public envelope.

    Three branches:

    1. ``decision="match"`` AND ``confidence >= threshold`` ->
       :class:`MatchResult`.
    2. ``decision="match"`` BUT ``confidence < threshold`` ->
       :class:`MatchFailed` with ``suggested_action=
       "ask_user_clarification"`` and ``best_template_attempted`` set
       to the LLM's chosen template (so operators can see why it
       didn't clear the bar).
    3. ``decision="refuse"`` -> :class:`MatchFailed` carrying the
       LLM's refusal_reason / suggested_action / best_template_attempted
       directly.
    """
    if parsed.decision == "match" and parsed.confidence >= threshold:
        # Branch 1 — confident match. parameters / template_id are
        # guaranteed non-null by the wire schema's validator.
        assert parsed.template_id is not None
        assert parsed.parameters is not None
        return MatchResult(
            template_id=parsed.template_id,
            parameters=parsed.parameters,
            confidence=parsed.confidence,
            reasoning=parsed.reasoning,
        )

    if parsed.decision == "match":
        # Branch 2 — match but below threshold. Downgrade to refusal.
        return MatchFailed(
            reason=(
                f"Matcher's self-rated confidence {parsed.confidence:.2f} "
                f"below threshold {threshold:.2f}. {parsed.reasoning}"
            ),
            best_template_attempted=parsed.template_id,
            best_confidence=parsed.confidence,
            threshold_required=threshold,
            suggested_action="ask_user_clarification",
        )

    # Branch 3 — explicit refusal. The wire-schema validator already
    # asserted refusal_reason is non-empty.
    assert parsed.refusal_reason is not None
    return MatchFailed(
        reason=parsed.refusal_reason,
        best_template_attempted=parsed.best_template_attempted,
        best_confidence=parsed.confidence,
        threshold_required=threshold,
        suggested_action=parsed.suggested_action or "ask_user_clarification",
    )


__all__ = [
    "run_template_matcher",
    "TemplateMatcherMetadata",
]
