"""Slice 2B.3.B — ExtensionPlanner stage runner.

One LLM call (Haiku 4.5): feeds a :class:`BriefAnalysis` +
:class:`MatchResult` (+ optional :class:`AdaptationPlan` for
context) through the prompt module, parses the tool_use output via
:class:`_ExtensionDecision` (a private wire schema), then bifurcates
into the public :class:`ExtensionPlan` / :class:`ExtensionFailed`
envelope based on the model's discriminator.

Why a private wire schema
-------------------------
Same lesson as matcher (2B.1) and adapter (2B.2): Haiku tool_use
honours flat object schemas more reliably than ``oneOf`` unions.
:class:`_ExtensionDecision` is a single flat schema with a
``decision`` discriminator + 5 booleans + per-branch sentinel
fields; a model_validator enforces shape-by-discriminator.

Mapping from wire schema to public types
----------------------------------------

* ``decision="plan"`` with all five booleans False → empty
  :class:`ExtensionPlan` (no-op; downstream orchestrator
  short-circuits ``apply_extensions``).
* ``decision="plan"`` with one or more booleans True → populated
  :class:`ExtensionPlan` with one :class:`ExtensionRequest` per
  True boolean, attachment defaulting to FRONT (extensions ignore
  attachment in v1 — geometry is hardcoded).
* ``decision="refuse"`` → :class:`ExtensionFailed` carrying
  refusal_reason + suggested_action directly.

Determinism
-----------
``cache_shared_context=True`` on :class:`LLMClient` lets the static
system prompt amortise across calls. ``max_retries=0`` on the
Anthropic SDK. Same fixture brief → byte-identical decision on
every CI run (cache key = SHA-256 of canonical input tuple).
"""

from __future__ import annotations

import time
from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.design_agent.llm_client import LLMClient
from app.services.design_agent.prompts.extension_planner import (
    build_extension_planner_system_prompt,
    build_extension_planner_user_message,
)
from app.services.design_agent.types import (
    AdaptationPlan,
    BriefAnalysis,
    ExtensionAttachment,
    ExtensionFailed,
    ExtensionPlan,
    ExtensionPlannerMetadata,
    ExtensionRequest,
    ExtensionType,
    MatchResult,
)


_PLANNER_TIMEOUT_S: float = 30.0
"""Wallclock ceiling. Clamped to MODEL_MAX_TIMEOUT (10s for Haiku
in :class:`LLMClient`). Output is compact (~8 fields) and Haiku 4.5
typically generates this in 1-3 seconds."""


_SUGGESTED_ACTION_LITERAL = (
    "ship_as_is",
    "ask_user_clarification",
)
"""Valid suggested_action values for planner-emitted ExtensionFailed.

Restricted to two values (in contrast to AdaptationPlanner's three):
``skip_failed_extensions`` is an orchestrator-only action emitted by
``apply_extensions`` for partial-failure paths; the LLM planner
itself never produces it. ``fallback_to_design_agent`` is reserved
for a future slice once an AI-driven fallback path exists; Slice
2B.3 v1 prompt forbids it.
"""


# Attach each include_* flag to an extension type. Stable order so
# the emitted ExtensionPlan.extensions list is deterministic.
_BOOLEAN_TO_TYPE: tuple[tuple[str, ExtensionType], ...] = (
    ("include_compound_wall", ExtensionType.COMPOUND_WALL),
    ("include_entry_gate", ExtensionType.ENTRY_GATE),
    ("include_car_porch", ExtensionType.CAR_PORCH),
    ("include_servant_quarter", ExtensionType.SERVANT_QUARTER),
    ("include_mumty", ExtensionType.MUMTY),
)


# ─── Internal LLM wire schema ────────────────────────────────────────


class _ExtensionDecision(BaseModel):
    """LLM tool_use wire format. Private — never returned by the
    runner.

    Single flat schema with a discriminator field (``decision``) and
    one boolean per extension type plus a per-branch refusal pair.
    Defaults set so an LLM that under-populates the tool input still
    produces a parseable response (the model_validator catches
    decision-vs-shape mismatches).

    The runner translates ``decision="plan"`` into
    :class:`ExtensionPlan` (empty or populated); ``decision="refuse"``
    becomes :class:`ExtensionFailed`.
    """

    model_config = ConfigDict(frozen=True)

    decision: str = Field(..., min_length=1)
    reasoning: str = Field(..., min_length=10)

    include_compound_wall: bool = False
    include_entry_gate: bool = False
    include_car_porch: bool = False
    include_servant_quarter: bool = False
    include_mumty: bool = False

    refusal_reason: Optional[str] = None
    suggested_action: Optional[str] = None

    @model_validator(mode="after")
    def _decision_shape_well_formed(self) -> "_ExtensionDecision":
        if self.decision == "plan":
            # Booleans are all bool by Pydantic typing; nothing extra
            # to validate. Refusal fields, when accidentally set,
            # are ignored (we don't fail on extra fields here — the
            # discriminator drives interpretation).
            pass
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
                f"decision must be 'plan' or 'refuse'; got {self.decision!r}"
            )
        return self


# ─── Runner ──────────────────────────────────────────────────────────


def run_extension_planner(
    analysis: BriefAnalysis,
    match: MatchResult,
    *,
    llm_client: LLMClient,
    adaptation: Optional[AdaptationPlan] = None,
) -> tuple[Union[ExtensionPlan, ExtensionFailed], ExtensionPlannerMetadata]:
    """Run the extension-planner stage.

    Calls Haiku 4.5 with a 30-second wallclock ceiling (clamped to
    LLMClient's Haiku ceiling) and the :class:`_ExtensionDecision`
    Pydantic schema as the structured-output target. The system
    prompt is shared across calls (``cache_shared_context=True``).

    Returns a tuple of:

    * Either an :class:`ExtensionPlan` (possibly the no-op plan
      with extensions=[]) OR an :class:`ExtensionFailed` (v2-deferral
      or clarification needed).
    * An :class:`ExtensionPlannerMetadata` accounting record.

    The ``adaptation`` argument is INFORMATIONAL only — the planner
    reasons in template-space (north = front, always) regardless of
    whether the upstream adapter chose a rotation. Passing it lets
    the LLM trace include the adapter's decision for debugging.
    """
    system_prompt = build_extension_planner_system_prompt()
    user_message = build_extension_planner_user_message(
        analysis, match, adaptation
    )

    call_start = time.monotonic()
    parsed, llm_metadata = llm_client.call(
        model="haiku-4.5",
        system_prompt=system_prompt,
        user_message=user_message,
        response_schema=_ExtensionDecision,
        timeout_seconds=_PLANNER_TIMEOUT_S,
        cache_shared_context=True,
    )
    elapsed_ms = (time.monotonic() - call_start) * 1000.0

    assert isinstance(parsed, _ExtensionDecision)
    decoded = _decode_decision(parsed)

    metadata = ExtensionPlannerMetadata(
        llm_model_used=llm_metadata.model,
        llm_input_tokens=llm_metadata.input_tokens,
        llm_output_tokens=llm_metadata.output_tokens,
        llm_cost_usd=llm_metadata.cost_usd_estimated,
        elapsed_ms=elapsed_ms,
        cache_hit=llm_metadata.cache_hit,
        refused=isinstance(decoded, ExtensionFailed),
    )
    return decoded, metadata


def _decode_decision(
    parsed: _ExtensionDecision,
) -> Union[ExtensionPlan, ExtensionFailed]:
    """Translate the LLM wire schema into the public envelope.

    Three branches:

    1. ``decision="plan"`` with no include_* True → empty
       :class:`ExtensionPlan` (no-op).
    2. ``decision="plan"`` with one or more include_* True →
       populated :class:`ExtensionPlan` carrying one
       :class:`ExtensionRequest` per True flag in canonical
       extension order.
    3. ``decision="refuse"`` → :class:`ExtensionFailed`.
    """
    if parsed.decision == "plan":
        requests: list[ExtensionRequest] = []
        for flag_name, ext_type in _BOOLEAN_TO_TYPE:
            if getattr(parsed, flag_name):
                requests.append(
                    ExtensionRequest(
                        extension_type=ext_type,
                        attachment=ExtensionAttachment.FRONT,
                    )
                )
        return ExtensionPlan(
            extensions=requests,
            reasoning=parsed.reasoning,
        )

    # decision="refuse" — wire-schema validator already asserted
    # refusal_reason + suggested_action are populated.
    assert parsed.refusal_reason is not None
    assert parsed.suggested_action is not None
    return ExtensionFailed(
        reason=parsed.refusal_reason,
        suggested_action=parsed.suggested_action,  # type: ignore[arg-type]
        failed_extensions=[],
    )


__all__ = ["run_extension_planner"]
