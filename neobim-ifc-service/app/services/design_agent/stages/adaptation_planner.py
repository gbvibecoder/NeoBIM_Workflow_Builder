"""Slice 2B.2.B — AdaptationPlanner stage runner.

One LLM call (Haiku 4.5): feeds a :class:`BriefAnalysis` +
:class:`MatchResult` through the prompt module, parses the tool_use
output via :class:`_AdaptationDecision` (a private wire schema), then
bifurcates into the public :class:`AdaptationPlan` /
:class:`AdaptationFailed` envelope based on the model's discriminator.

Why a private wire schema
-------------------------
Same lesson as the matcher (slice 2B.1.B): Haiku tool_use honours
flat object schemas more reliably than ``oneOf`` discriminator
unions. :class:`_AdaptationDecision` is therefore a single flat
schema with a ``decision`` discriminator and per-branch fields
default-populated to sentinel values; a model_validator enforces
shape-by-discriminator.

Mapping from wire schema to public types
----------------------------------------

* ``decision="adapt"`` with ``mirror_axis="none"`` AND
  ``rotation="0"`` → :class:`AdaptationPlan` (no-op; ``is_noop``
  short-circuits :func:`apply_adaptations`).
* ``decision="adapt"`` with any non-default mirror or rotation →
  :class:`AdaptationPlan` (real transform).
* ``decision="refuse"`` → :class:`AdaptationFailed` carrying the
  ``refusal_reason`` and ``suggested_action`` directly.

Determinism
-----------
``cache_shared_context=True`` on :class:`LLMClient` lets the static
system prompt amortise across calls. ``max_retries=0`` on the
Anthropic SDK (set globally in :class:`LLMClient`). Two calls with
the same BriefAnalysis + MatchResult yield byte-identical
AdaptationPlans on every CI run (the cache key is the SHA-256 of
the canonical input tuple).
"""

from __future__ import annotations

import time
from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.design_agent.llm_client import LLMClient
from app.services.design_agent.prompts.adaptation_planner import (
    build_adaptation_planner_system_prompt,
    build_adaptation_planner_user_message,
)
from app.services.design_agent.types import (
    AdaptationFailed,
    AdaptationPlan,
    AdaptationPlannerMetadata,
    BriefAnalysis,
    MatchResult,
    TransformAxis,
    TransformRotation,
)


_PLANNER_TIMEOUT_S: float = 30.0
"""Wallclock ceiling for the planner LLM call.

Same ceiling as the matcher (30s clamped at the per-model maximum
in :data:`MODEL_MAX_TIMEOUT`). Planner output is even smaller than
matcher output (~6 fields vs ~10) and Haiku 4.5 generates this in
1-3 seconds typically. The 30s bound keeps the "no LLM call blocks
a route forever" contract intact.
"""


# ─── Internal LLM wire schema ────────────────────────────────────────


_MIRROR_LITERAL = ("X", "Y", "none")
_ROTATION_LITERAL = ("0", "90", "180", "270")
_SUGGESTED_ACTION_LITERAL = (
    "ship_as_is",
    "ask_user_clarification",
    "fallback_to_design_agent",
)


class _AdaptationDecision(BaseModel):
    """LLM tool_use wire format. Private — never returned by the runner.

    The runner translates a successful, well-shaped ``decision="adapt"``
    into :class:`AdaptationPlan`; ``decision="refuse"`` becomes
    :class:`AdaptationFailed`.

    Why string sentinels instead of ``Optional[Enum]``:
        Haiku's tool_use is more reliable when every required field
        has a concrete value to fill. Flat ``Literal["X","Y","none"]``
        with a sensible default ("none" / "0") yields fewer mid-call
        validation errors than ``Optional[TransformAxis]``.

    The :func:`_decision_shape_well_formed` validator enforces the
    per-discriminator field shape so a malformed LLM response surfaces
    as :class:`LLMResponseValidationError` (caught by the LLMClient
    and propagated up) rather than as a None-deref deeper in the
    runner.
    """

    model_config = ConfigDict(frozen=True)

    decision: str = Field(..., min_length=1)
    reasoning: str = Field(..., min_length=10)
    mirror_axis: str = Field(default="none")
    rotation: str = Field(default="0")
    refusal_reason: Optional[str] = None
    suggested_action: Optional[str] = None

    @model_validator(mode="after")
    def _decision_shape_well_formed(self) -> "_AdaptationDecision":
        if self.decision == "adapt":
            if self.mirror_axis not in _MIRROR_LITERAL:
                raise ValueError(
                    f"decision='adapt' requires mirror_axis in "
                    f"{_MIRROR_LITERAL}; got {self.mirror_axis!r}"
                )
            if self.rotation not in _ROTATION_LITERAL:
                raise ValueError(
                    f"decision='adapt' requires rotation in "
                    f"{_ROTATION_LITERAL}; got {self.rotation!r}"
                )
        elif self.decision == "refuse":
            if not (self.refusal_reason and self.refusal_reason.strip()):
                raise ValueError(
                    "decision='refuse' requires a non-empty refusal_reason"
                )
            if self.suggested_action not in _SUGGESTED_ACTION_LITERAL:
                raise ValueError(
                    f"decision='refuse' requires suggested_action in "
                    f"{_SUGGESTED_ACTION_LITERAL}; got "
                    f"{self.suggested_action!r}"
                )
        else:
            raise ValueError(
                f"decision must be 'adapt' or 'refuse'; got {self.decision!r}"
            )
        return self


# ─── Runner ──────────────────────────────────────────────────────────


def run_adaptation_planner(
    analysis: BriefAnalysis,
    match: MatchResult,
    *,
    llm_client: LLMClient,
) -> tuple[Union[AdaptationPlan, AdaptationFailed], AdaptationPlannerMetadata]:
    """Run the adaptation-planner stage.

    Calls Haiku 4.5 with a 30-second wallclock ceiling and the
    :class:`_AdaptationDecision` Pydantic schema as the structured-
    output target. The system prompt is shared across calls
    (``cache_shared_context=True``).

    Returns a tuple of:

    * Either an :class:`AdaptationPlan` (canonical adaptation —
      possibly the no-op plan with mirror=None, rotation=NONE) OR an
      :class:`AdaptationFailed` (v2-deferral or clarification needed).
    * An :class:`AdaptationPlannerMetadata` accounting record (model
      used, tokens, cost, latency, cache_hit, refused).
    """
    system_prompt = build_adaptation_planner_system_prompt()
    user_message = build_adaptation_planner_user_message(analysis, match)

    call_start = time.monotonic()
    parsed, llm_metadata = llm_client.call(
        model="haiku-4.5",
        system_prompt=system_prompt,
        user_message=user_message,
        response_schema=_AdaptationDecision,
        timeout_seconds=_PLANNER_TIMEOUT_S,
        cache_shared_context=True,
    )
    elapsed_ms = (time.monotonic() - call_start) * 1000.0

    assert isinstance(parsed, _AdaptationDecision)
    decoded = _decode_decision(parsed)

    metadata = AdaptationPlannerMetadata(
        llm_model_used=llm_metadata.model,
        llm_input_tokens=llm_metadata.input_tokens,
        llm_output_tokens=llm_metadata.output_tokens,
        llm_cost_usd=llm_metadata.cost_usd_estimated,
        elapsed_ms=elapsed_ms,
        cache_hit=llm_metadata.cache_hit,
        refused=isinstance(decoded, AdaptationFailed),
    )
    return decoded, metadata


def _decode_decision(
    parsed: _AdaptationDecision,
) -> Union[AdaptationPlan, AdaptationFailed]:
    """Translate the LLM wire schema into the public envelope.

    Three branches:

    1. ``decision="adapt"`` AND mirror="none" AND rotation="0" →
       :class:`AdaptationPlan` (no-op; ``is_noop=True``).
    2. ``decision="adapt"`` AND any non-default → :class:`AdaptationPlan`
       carrying the parsed mirror_axis (or None if "none") and the
       parsed rotation enum.
    3. ``decision="refuse"`` → :class:`AdaptationFailed` carrying the
       refusal_reason and suggested_action directly.
    """
    if parsed.decision == "adapt":
        mirror = (
            None
            if parsed.mirror_axis == "none"
            else TransformAxis(parsed.mirror_axis)
        )
        rotation = TransformRotation(parsed.rotation)
        return AdaptationPlan(
            mirror_axis=mirror,
            rotation=rotation,
            reasoning=parsed.reasoning,
        )

    # decision="refuse" — wire-schema validator already asserted
    # refusal_reason and suggested_action are populated.
    assert parsed.refusal_reason is not None
    assert parsed.suggested_action is not None
    return AdaptationFailed(
        reason=parsed.refusal_reason,
        suggested_action=parsed.suggested_action,  # type: ignore[arg-type]
    )


__all__ = [
    "run_adaptation_planner",
]
