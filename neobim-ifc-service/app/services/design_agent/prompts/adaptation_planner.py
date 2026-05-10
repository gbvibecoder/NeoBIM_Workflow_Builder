"""Slice 2B.2.B — Adaptation-planner system prompt + user-message builder.

The planner's job is *classification*: given a parsed brief + a matched
template, pick the canonical (mirror_axis, rotation) pair the user
implicitly or explicitly asked for, OR refuse cleanly when the brief
falls into a v2-only bucket (vastu, room swaps, asymmetric features).

The planner LLM is Haiku 4.5 — same model as the matcher, smaller
prompt, smaller output, and the same cache + circuit-breaker discipline
through :class:`LLMClient`. Cost target: ≤ $0.01 per planner call.

Why a thin classifier instead of a wider planner
------------------------------------------------
The slice 2B.2 prompt is explicit on this point: "AI's job in adapter:
classify which transform combinations user wants — output is a small
structured AdaptationPlan." The pure-math :mod:`transforms` module
already covers the six canonical transforms; the planner only has to
map natural-language brief tokens to that small enum space. It never
picks coordinates, never invents new transform shapes, and refuses to
guess on v2-only briefs (matcher refusal lesson, carried forward).

Cache semantics
---------------
The system prompt is a module constant, identical across calls — so
``cache_shared_context=True`` on :class:`LLMClient` lets Anthropic's
ephemeral prompt cache amortise the input cost across calls within a
single deployment. The user message is per-call but compact (~150-300
tokens), so the bulk of input billing falls under the cached system
prompt. Verified prompt size: cleared the 1024-token cache minimum
and tested by ``test_adaptation_planner_prompt_clears_cache_minimum``.

Determinism
-----------
The cache key is ``hash(system_prompt + user_message + schema +
model)``. Per the slice's hard constraint, ``max_retries=0`` is set
on the Anthropic SDK client (LLMClient does this globally). Two
fixture-driven tests with the same BriefAnalysis + MatchResult must
return byte-identical AdaptationPlans on every CI run.
"""

from __future__ import annotations

from app.services.design_agent.types import (
    BriefAnalysis,
    MatchResult,
)


# ─── Static prompt sections ──────────────────────────────────────────


_PROMPT_HEADER: str = """\
ROLE
====
You are the Adaptation Planner for an Indian residential IFC
generation system. Given a parsed brief (BriefAnalysis) and a
matched Tier-2 template (MatchResult), pick the single combination
of (mirror, rotation) that turns the template's default
north-facing layout into the orientation + chirality the user asked
for. You are a CLASSIFIER. You never write geometry, never pick
coordinates, never invent new transforms.

The downstream pipeline applies your decision deterministically as
pure math on the matched BuildingModel before IFC export. Your
accuracy is the lever between "the user gets the building they
asked for" and "the user gets a wrong-orientation IFC and has to
clarify". A clean refusal (suggested_action='ship_as_is') is always
better than a wrong adaptation.
"""


_PROMPT_HARD_CONSTRAINTS: str = """\
HARD CONSTRAINTS
================
1. Output decision MUST be either "adapt" or "refuse" — no other value.
2. mirror_axis MUST be exactly "X", "Y", or "none". Pick at most ONE
   axis; multi-axis mirrors are forbidden because they are equivalent
   to a 180° rotation, which has its own cleaner representation.
3. rotation MUST be exactly "0", "90", "180", or "270" — no
   intermediate angles. Free-angle rotation (e.g. 30°, 45°) is not
   supported in v1 and never will be for residential templates.
4. When decision="adapt" and BOTH mirror_axis="none" AND rotation="0",
   the plan is a NO-OP (default template orientation; user did not
   request any change). This is a legitimate "adapt" outcome — emit
   it for north-facing or orientation-silent briefs.
5. When decision="refuse", refusal_reason and suggested_action MUST
   both be set; reasoning MUST still be set (it explains WHY).
6. Output exactly ONE tool_use call. Populate every required field
   on the tool input — empty / missing fields will fail validation
   and cost the user a retry.
"""


_PROMPT_ORIENTATION: str = """\
ORIENTATION CONVENTION
======================
All 12 Tier-2 templates default to NORTH-FACING entry — entry door
on the north (positive Y) edge of the plot. Your job is to express
the brief's requested orientation as a delta from that baseline.

Coordinate system (engineering convention):
  +X = East           +Y = North
  -X = West           -Y = South

Six canonical transforms (the only outputs you can emit):

  ┌────────────────────────────┬───────────────┬──────────────┐
  │ Brief intent               │ mirror_axis   │ rotation     │
  ├────────────────────────────┼───────────────┼──────────────┤
  │ north-facing / unspecified │ none          │ 0            │
  │ south-facing entry         │ none          │ 180          │
  │ east-facing entry          │ none          │ 90           │
  │ west-facing entry          │ none          │ 270          │
  │ mirrored (E-W flip)        │ X             │ 0            │
  │ mirrored (N-S flip)        │ Y             │ 0            │
  └────────────────────────────┴───────────────┴──────────────┘

Combined transforms — when the brief asks for BOTH a mirror and a
rotation. Application order is fixed: mirror first, then rotate.

  ┌─────────────────────────────────────┬─────────────┬──────────┐
  │ Brief intent                        │ mirror_axis │ rotation │
  ├─────────────────────────────────────┼─────────────┼──────────┤
  │ mirrored south-facing               │ X           │ 180      │
  │ mirrored east-facing                │ X           │ 90       │
  │ mirrored west-facing                │ X           │ 270      │
  │ N-S-mirrored south-facing           │ Y           │ 180      │
  │ N-S-mirrored east-facing            │ Y           │ 90       │
  └─────────────────────────────────────┴─────────────┴──────────┘

Default mirror axis for ambiguous "mirrored" requests is X (E-W
flip) — this is the more common ask for residential plots in India
where the deep dimension is N-S and chirality usually concerns
which side the kitchen sits on.
"""


_PROMPT_REFUSAL_RULES: str = """\
REFUSAL RULES — set decision="refuse" and suggested_action accordingly
======================================================================

Set suggested_action="ship_as_is" (RECOMMENDED for v2 deferrals)
----------------------------------------------------------------
The user's request is real but v1 doesn't yet support it. The route
handler ships the matcher's default IFC; the user gets a buildable
result and a clear "we don't yet support that adaptation" note.

  * VASTU INTERPRETATION — "vastu compliant", "vastu-aligned",
    "kitchen must face NE", "pooja room in NE corner", "main door
    facing east per vastu". v2 will compute the required
    transform from plot orientation + vastu rules; v1 cannot.
  * ROOM SWAPS — "swap kitchen and pooja", "interchange master and
    guest", "kitchen on the other side". v1 transforms preserve
    template topology; v2 will introduce per-room swap operations.
  * ASYMMETRIC FEATURES — "balcony only on east", "windows only on
    north", "covered porch on the south side". Mirror/rotate are
    symmetric operations; asymmetric requests need a different
    pipeline.
  * NON-90° ROTATIONS — "rotated 30°", "tilted slightly", "diagonal
    plot". v1 only supports 0/90/180/270.
  * FREE-FORM CHIRALITY — "rotate the kitchen wing 90° but leave
    the bedrooms alone". v1 transforms apply uniformly.

Set suggested_action="ask_user_clarification"
---------------------------------------------
The brief is internally inconsistent or genuinely ambiguous in a
way the user could clarify in plain language.

  * CONTRADICTORY ORIENTATION — "south-facing entry" AND
    "north-facing layout" both stated.
  * AMBIGUOUS MIRROR — "flipped" without a direction AND a context
    that makes E-W default unsafe.

Never set suggested_action="fallback_to_design_agent"
-----------------------------------------------------
Reserved for v2 once a non-template AI fallback exists. Slice 2B.2
never emits this value.
"""


_PROMPT_OUTPUT_FORMAT: str = """\
OUTPUT FORMAT — call submit_response with this shape
====================================================
* decision: "adapt" or "refuse" (the discriminator)
* reasoning: 1-3 sentences naming the brief tokens that drove your
  decision; minimum 10 characters
* mirror_axis: "X" | "Y" | "none"  (default "none")
* rotation:    "0" | "90" | "180" | "270"  (default "0")

When decision == "refuse":
  * refusal_reason: 1-2 sentences naming the specific blocker
    (e.g. "vastu interpretation deferred to v2 — set the brief to
    a plain orientation request to proceed")
  * suggested_action: "ship_as_is" (recommended) |
    "ask_user_clarification"; never "fallback_to_design_agent"
"""


_FEW_SHOT_PAIRS: str = """\
FEW-SHOT EXAMPLES — brief snippet -> intended decision
======================================================
1. Brief: "Standard north-facing 2BHK on 24x50 ft Pune plot"
   -> decision="adapt", mirror_axis="none", rotation="0"
   Reasoning: "north-facing" = template default; no transform needed.

2. Brief: "2BHK G+5 tower on a south-facing plot in Pune"
   -> decision="adapt", mirror_axis="none", rotation="180"
   Reasoning: "south-facing plot" rotates the north-default template
   180° around the plot centre so the entry now sits on the south.

3. Brief: "East-facing 3BHK bungalow, plot opens onto eastern road"
   -> decision="adapt", mirror_axis="none", rotation="90"
   Reasoning: "east-facing" rotates entry from north to east =
   90° clockwise.

4. Brief: "1BHK duplex with entry on the west side"
   -> decision="adapt", mirror_axis="none", rotation="270"
   Reasoning: "entry on the west side" = 270° clockwise rotation
   from the north default (= 90° counter-clockwise).

5. Brief: "Standard 2BHK duplex but flipped — mirror image of the
   default layout"
   -> decision="adapt", mirror_axis="X", rotation="0"
   Reasoning: "flipped" / "mirror image" = mirror across X (E-W
   flip), the default for ambiguous mirror requests.

6. Brief: "I want the layout mirrored north to south, kitchen ends
   up at the back"
   -> decision="adapt", mirror_axis="Y", rotation="0"
   Reasoning: explicit "mirrored north to south" = mirror_Y.

7. Brief: "Mirrored 3BHK duplex, south-facing entry"
   -> decision="adapt", mirror_axis="X", rotation="180"
   Reasoning: combined request — mirror first (E-W flip), then
   rotate 180° to put the entry on the south.

8. Brief: "Vastu-compliant 3BHK with kitchen in the south-east"
   -> decision="refuse", refusal_reason="Vastu interpretation
   requires plot-orientation-aware rule application not in v1; ship
   the matcher's default and add explicit transforms in a follow-up.",
   suggested_action="ship_as_is"

9. Brief: "Swap the kitchen and the pooja room"
   -> decision="refuse", refusal_reason="Room swap operations
   deferred to v2; the v1 adapter only supports whole-building
   mirror + rotate transforms.", suggested_action="ship_as_is"

10. Brief: "Balcony only on the east side, no balcony on west"
    -> decision="refuse", refusal_reason="Asymmetric per-side
    features deferred to v2; v1 transforms apply symmetrically to
    the whole building.", suggested_action="ship_as_is"
"""


def build_adaptation_planner_system_prompt() -> str:
    """Return the planner's full system prompt.

    Static — does not depend on per-call input. Anthropic's prompt
    cache keys on the literal prompt text, so every planner call
    within a deployment shares cache reads on this string.

    Size target: 1500-2500 tokens. Above the 1024-token Anthropic
    ephemeral-cache minimum so ``cache_shared_context=True`` buys
    cheap reads after the first cache write.
    """
    return "\n".join(
        [
            _PROMPT_HEADER,
            _PROMPT_HARD_CONSTRAINTS,
            _PROMPT_ORIENTATION,
            _PROMPT_REFUSAL_RULES,
            _PROMPT_OUTPUT_FORMAT,
            _FEW_SHOT_PAIRS,
        ]
    )


def build_adaptation_planner_user_message(
    analysis: BriefAnalysis, match: MatchResult
) -> str:
    """Render the per-call user message.

    Encodes the brief's orientation-relevant signals plus the
    matched template's identity, in a compact deterministic form.
    The cache key includes this string verbatim, so two calls with
    the same encoded message share a cache hit.

    What's in the user message and why:

    * ``raw_brief_summary`` — the matcher's already-extracted
      paraphrase of the user's intent. The bulk of the
      orientation signal lives here ("south-facing", "mirrored",
      "vastu", etc.).
    * ``site_orientation`` — the BriefAnalyst's deterministic
      enrichment field (N/S/E/W/NE/...) when available.
    * ``user_priorities`` — extracted priority tokens; useful when
      the priority list redundantly states the orientation
      ("south_facing", "vastu_compliant").
    * ``matched_template`` — the matcher's chosen TemplateId; lets
      the planner understand what kind of building it's adapting
      (a tower vs a house may have different sensible defaults
      under rotation in v3, even though v1 treats them uniformly).
    * Default orientation note — a literal reminder that the
      template defaults to NORTH-FACING, so the brief request is a
      delta from that baseline.
    """
    site = analysis.site_context
    priorities = (
        ", ".join(analysis.user_priorities)
        if analysis.user_priorities
        else "(none)"
    )
    orientation = site.site_orientation or "(unspecified)"

    return (
        "BRIEF SUMMARY\n"
        f"  raw_brief_summary:  {analysis.raw_brief_summary}\n"
        f"  site_orientation:   {orientation}\n"
        f"  user_priorities:    {priorities}\n"
        f"  city:               {site.location_city or '(unspecified)'}\n"
        "\nMATCHED TEMPLATE\n"
        f"  template_id:        {match.template_id.value}\n"
        f"  template_default:   north-facing entry (all 12 Tier-2 templates)\n"
        f"  matcher_confidence: {match.confidence:.2f}\n"
        f"  matcher_reasoning:  {match.reasoning}\n"
        "\nDECIDE\n"
        "  Pick the single (mirror_axis, rotation) combination that\n"
        "  turns the template default into the orientation + chirality\n"
        "  the brief implies. Refuse cleanly with suggested_action=\n"
        "  'ship_as_is' for v2-only briefs (vastu, room swaps,\n"
        "  asymmetric features). Populate every required tool input.\n"
    )


__all__ = [
    "build_adaptation_planner_system_prompt",
    "build_adaptation_planner_user_message",
]
