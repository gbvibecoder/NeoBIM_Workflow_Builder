"""Slice 2B.1 — Template-matcher system prompt + user-message builder.

The matcher's job is *classification + extraction*, never geometry. The
system prompt (~2500-3000 tokens) gives the LLM:

* The closed catalogue of nine Tier-2 templates with their descriptors
  and few-shot brief examples (rendered from
  :data:`app.services.design_agent.template_catalog.CATALOG` so the
  prompt and the dispatcher cannot drift apart).
* Hard parameter-extraction rules (ft↔m conversion, "G+N" parsing,
  default-when-uncertain).
* Hard refusal rules (commercial / institutional / >3BHK / non-
  rectangular).
* The exact tool-output shape the runner expects.

Every literal value the LLM must emit is shown verbatim so the model
copies the exact tokens the Pydantic schema accepts. Drift here yields
``LLMResponseValidationError`` on every call.

The prompt clears the 1024-token Anthropic ephemeral-cache minimum
(verified by ``test_template_matcher_system_prompt_clears_cache_minimum``)
so :func:`LLMClient.call(cache_shared_context=True)` buys ~10x cheaper
reads on subsequent matcher calls within the same product session.
"""

from __future__ import annotations

from app.services.design_agent.template_catalog import (
    CATALOG,
    TemplateDescriptor,
)
from app.services.design_agent.types import BriefAnalysis


# Static sections ─ kept as module constants so the assembled prompt
# string is identical across calls (cache key stable).


_PROMPT_HEADER: str = """\
ROLE
====
You are the Template Matcher for an Indian residential IFC generation
system. Given a parsed brief (BriefAnalysis), pick the single closest
of NINE pre-built Tier-2 templates and extract the parameters needed
to call its builder. You are a CLASSIFIER and EXTRACTOR. You never
generate geometry, you never invent templates, you never pick
coordinates.

The downstream pipeline takes your decision and dispatches to a
deterministic, IDS-validated, LOD-300 template builder. Your accuracy
is the single biggest lever on output quality — pick well or refuse
cleanly. A confident refusal is always better than a wrong match.
"""


_PROMPT_HARD_CONSTRAINTS: str = """\
HARD CONSTRAINTS
================
1. Your output template_id MUST be one of the nine values listed in
   CANDIDATE TEMPLATES below — never any other string.
2. If no candidate fits with confidence >= 0.6, set decision="refuse"
   and explain why in refusal_reason. Do NOT force a low-confidence
   match.
3. AI's role is CLASSIFY + EXTRACT. Never write geometry, never pick
   coordinates, never override the dispatcher's parameter names.
4. Output exactly ONE tool_use call. Populate every required field
   on the tool input — empty / missing fields will fail validation
   and cost the user a retry.
"""


_PROMPT_REFUSAL_RULES: str = """\
REFUSAL RULES — set decision="refuse" when ANY of the following hold
=====================================================================
* Brief asks for a COMMERCIAL building (office, shop, retail, gym,
  showroom, warehouse, hotel, restaurant, mall, mixed-use).
  -> suggested_action="reject"
* Brief asks for an INSTITUTIONAL building (hospital, school,
  college, library, auditorium, ward, ICU, classroom).
  -> suggested_action="reject"
* Brief asks for >3BHK (4BHK, 5BHK, mansion, penthouse villa, "five
  bedroom").
  -> suggested_action="reject"
* Brief asks for NON-RECTANGULAR geometry (cylindrical, L-shape,
  U-shape, courtyard, hexagonal, free-form, glass-curtain tower).
  -> suggested_action="reject"
* Brief asks for features NOT in any candidate template (basement,
  swimming pool, helipad, atrium, double-height lobby, grand
  staircase).
  -> suggested_action="reject"
* Brief is too vague to classify with confidence (no BHK count, no
  form factor, no city) AND no defaults can be inferred.
  -> suggested_action="ask_user_clarification"

Refuse cleanly. The user prefers a "we don't yet support that"
response over a wrong-template IFC.
"""


_PROMPT_PARAMETER_RULES: str = """\
PARAMETER EXTRACTION RULES
==========================
plot_width_m / plot_length_m
  - If the brief gives explicit dimensions in metres ("8 x 15 m",
    "8m x 15m"), use them directly.
  - If the brief gives feet ("24 x 50 ft", "30x60"), convert
    1 ft = 0.3048 m exactly. "24x50 ft" -> 7.32 x 15.24 m.
  - If the brief gives an area ("1500 sqft plot"), do NOT invent
    dimensions; default to the matching candidate's typical_plot_min_m
    (a known-good plot the builder always accepts).
  - If the brief is silent on plot size, default to the candidate's
    typical_plot_min_m. NEVER pick anything outside the candidate's
    [typical_plot_min_m, typical_plot_max_m] range.

floor_height_m
  - Default 3.0. Only override if the brief explicitly specifies
    floor-to-floor or storey height (rare).

Tower-only fields (set ONLY when template_id ends in _TOWER)
  habitable_floor_count
    - Parse "G+5" -> 5, "G+11" -> 11, "G+23" -> 23.
    - Parse "12 storey" / "12-storey building" -> 11 habitable
      (subtract the stilt / ground level if explicitly mentioned;
      otherwise the bare integer IS the habitable count).
    - Range 1-30. If unspecified, leave null and the dispatcher
      uses 5 (the builder's default).
  has_stilt_parking
    - Default true for tower templates (most Indian apartment
      towers have stilt parking under bye-laws).
    - Set false only if brief explicitly says "no parking" or
      "open ground floor".
  stilt_height_m
    - Default 2.7. Only override if brief specifies (rare).

Site context
  seismic_zone / wind_zone are populated by the upstream BriefAnalyst
  via deterministic city lookup. Read them off the BriefAnalysis input
  verbatim; never re-derive. If both are null on the input, default to
  III (seismic) and 2 (wind) — Pune baseline.

has_balcony
  - Reserved for slice 2B.2; the dispatcher in this slice ignores it.
  - You may still populate it (true/false) when the brief is explicit;
    it costs nothing and downstream slices will consume it.
"""


_PROMPT_OUTPUT_FORMAT: str = """\
OUTPUT FORMAT — call submit_response with this shape
====================================================
* decision: "match" or "refuse" (the discriminator)
* confidence: float in [0.0, 1.0]; your self-rated probability that
  the chosen template_id + parameters is correct
* reasoning: 2-4 sentences naming the BHK family, form factor, and
  the brief tokens that drove your decision

When decision == "match":
  * template_id: one of the nine TemplateId enum values
    (e.g. "build_2bhk_pune_duplex")
  * parameters: full TemplateParameters object (plot_width_m,
    plot_length_m, floor_height_m required; tower fields set when
    appropriate; seismic_zone / wind_zone copied from input)

When decision == "refuse":
  * refusal_reason: 1-2 sentences naming the specific blocker
    (e.g. "brief requests a 4BHK; no candidate template covers
    >3BHK")
  * best_template_attempted: the closest candidate (or null) — for
    operator visibility only
  * suggested_action: "reject" | "ask_user_clarification" |
    "fallback_to_design_agent" (per the refusal rules above)
"""


_FEW_SHOT_PAIRS: str = """\
FEW-SHOT EXAMPLES — brief snippet -> intended decision
======================================================
1. "2BHK duplex on 24x50 north-facing Pune plot"
   -> match, build_2bhk_pune_duplex,
      plot_width_m=7.32, plot_length_m=15.24, confidence ~0.92
      Reasoning: explicit 2BHK + duplex + ft dims convert cleanly.

2. "G+11 apartment building, 60 flats, 2BHK each, Pune"
   -> match, build_2bhk_pune_tower,
      habitable_floor_count=11, has_stilt_parking=true,
      plot_width_m=7.32, plot_length_m=15.24 (default — brief silent),
      confidence ~0.85
      Reasoning: G+11 -> 11 habitable; "60 flats / 12 storeys" -> ~5
      flats per floor but builder pins flats_per_floor=1, so we accept
      the per-flat configuration and lower confidence accordingly.

3. "Small 1BHK house for parents, single floor, 25x40 ft"
   -> match, build_1bhk_pune_house,
      plot_width_m=7.62, plot_length_m=12.19, confidence ~0.90
      Reasoning: explicit 1BHK + single-floor + ft dims.

4. "3BHK G+5 apartment in Pune"
   -> match, build_3bhk_pune_tower,
      habitable_floor_count=5, has_stilt_parking=true,
      confidence ~0.88
      Reasoning: 3BHK + G+5 + apartment -> tower family.

5. "1500 sqft single-floor 2BHK home"
   -> match, build_2bhk_pune_house,
      plot_width_m=6.0, plot_length_m=12.0 (typical_plot_min for
      build_2bhk_pune_house; never invent dimensions from area),
      confidence ~0.75
      Reasoning: explicit 2BHK + single-floor; defaulting plot to
      typical because area alone does not determine dimensions.

6. "G+1 duplex 3BHK with pooja room, joint family"
   -> match, build_3bhk_pune_duplex,
      plot_width_m=8.0, plot_length_m=16.0, confidence ~0.85
      Reasoning: explicit 3BHK + G+1 (duplex) + pooja matches the
      template description.

7. "Small office with 3 cabins"
   -> refuse, suggested_action="reject"
      refusal_reason: "Office/commercial use. The catalogue covers
      residential 1BHK/2BHK/3BHK only."
      best_template_attempted=null, confidence ~0.05

8. "Hospital with 50 beds and ICU"
   -> refuse, suggested_action="reject"
      refusal_reason: "Institutional (hospital). No medical-use
      template in the catalogue."
      best_template_attempted=null, confidence ~0.02

9. "Cylindrical glass tower"
   -> refuse, suggested_action="reject"
      refusal_reason: "Non-rectangular footprint. Catalogue is
      rectangular plots only."
      best_template_attempted=build_2bhk_pune_tower (closest by
      mass), confidence ~0.05

10. "4BHK luxury bungalow with infinity pool"
    -> refuse, suggested_action="reject"
       refusal_reason: "4BHK exceeds the supported 1/2/3 BHK range,
       and infinity pool is not in any template."
       best_template_attempted=build_3bhk_pune_house, confidence ~0.20

11. "Modern apartment in Mumbai"
    -> refuse, suggested_action="ask_user_clarification"
       refusal_reason: "Brief is missing BHK count, form factor, and
       plot dimensions; cannot select a template confidently."
       best_template_attempted=null, confidence ~0.30

12. "Penthouse villa with infinity pool and helipad"
    -> refuse, suggested_action="reject"
       refusal_reason: "Penthouse / villa with helipad and pool is
       outside the residential template scope."
       confidence ~0.15
"""


def _render_descriptor(d: TemplateDescriptor) -> str:
    """Render one TemplateDescriptor block for the catalog section.

    Format mirrors a YAML-ish key:value layout — terse, regular, easy
    for the LLM to scan. Few-shot examples are bullet-listed so the
    model can spot the matching brief patterns at a glance.
    """
    min_w, min_l = d.typical_plot_min_m
    max_w, max_l = d.typical_plot_max_m
    examples = "\n".join(f"  - {e}" for e in d.suitable_for_briefs_like)
    return (
        f"\n{d.template_id.value}\n"
        f"  bhk_family:        {d.bhk_family}\n"
        f"  form_factor:       {d.form_factor}\n"
        f"  description:       {d.description}\n"
        f"  typical_plot_m:    {min_w} x {min_l}  ..  {max_w} x {max_l}\n"
        f"  floor_count:       {d.floor_count}\n"
        f"  target_market:     {d.target_market}\n"
        f"  suitable_for_briefs_like:\n{examples}\n"
    )


def _render_catalog() -> str:
    """Render the full nine-template catalog into a prompt section."""
    blocks = "".join(_render_descriptor(d) for d in CATALOG)
    return (
        "CANDIDATE TEMPLATES — pick exactly one, or refuse\n"
        "==================================================\n"
        + blocks
    )


def build_template_matcher_system_prompt() -> str:
    """Return the matcher's full system prompt.

    Static — does not depend on per-call input. Anthropic's prompt
    cache keys on the literal prompt text, so every matcher call
    within a deployment shares cache reads on this string.

    Size target: 2500-3000 tokens. Above the 1024-token Anthropic
    ephemeral-cache minimum so ``cache_shared_context=True`` buys
    cheap reads after the first cache write.
    """
    return "\n".join(
        [
            _PROMPT_HEADER,
            _PROMPT_HARD_CONSTRAINTS,
            _render_catalog(),
            _PROMPT_PARAMETER_RULES,
            _PROMPT_REFUSAL_RULES,
            _PROMPT_OUTPUT_FORMAT,
            _FEW_SHOT_PAIRS,
        ]
    )


def build_template_matcher_user_message(analysis: BriefAnalysis) -> str:
    """Return the per-call user-message string.

    Encodes the BriefAnalysis fields most relevant to template
    selection in a compact, deterministic, key-sorted format. The
    cache key includes this string verbatim, so two BriefAnalyses
    that produce the same encoded message share a cache hit.

    We do not pass the raw BriefAnalysis as JSON because (a) the
    LLMClient cache key is keyed on the canonical encoding and we
    want a stable representation, and (b) the LLM benefits from a
    human-readable summary it can scan, not a deeply nested object.
    """
    site = analysis.site_context
    bclass = analysis.building_class
    style = analysis.style_intent

    plot_dims = "unspecified"
    if site.plot_width_m and site.plot_length_m:
        plot_dims = f"{site.plot_width_m} x {site.plot_length_m} m"
    elif site.plot_area_sqm:
        plot_dims = f"area {site.plot_area_sqm} sqm (no explicit dims)"

    rooms = (
        ", ".join(analysis.explicit_room_list)
        if analysis.explicit_room_list
        else "(none extracted)"
    )
    explicit_dims = (
        "; ".join(f"{k}={v}" for k, v in sorted(analysis.explicit_dimensions.items()))
        if analysis.explicit_dimensions
        else "(none)"
    )
    priorities = (
        ", ".join(analysis.user_priorities)
        if analysis.user_priorities
        else "(none)"
    )

    return (
        "BRIEF SUMMARY\n"
        f"  raw_brief_summary: {analysis.raw_brief_summary}\n"
        f"  building_class:    {bclass.primary_type} / {bclass.sub_type}"
        f" (NBC {bclass.nbc_group or 'unknown'} - {bclass.nbc_subdivision})\n"
        f"  floors_above:      {analysis.floors_above_ground}\n"
        f"  floors_below:      {analysis.floors_below_ground}\n"
        f"  plot:              {plot_dims}\n"
        f"  city:              {site.location_city or '(unspecified)'}\n"
        f"  orientation:       {site.site_orientation or '(unspecified)'}\n"
        f"  seismic_zone:      {site.seismic_zone or '(unspecified)'}\n"
        f"  wind_zone:         {site.wind_zone if site.wind_zone is not None else '(unspecified)'}\n"
        f"  architectural_style: {style.architectural_style}\n"
        f"  cultural_overlay:  {style.cultural_overlay or '(none)'}\n"
        f"  explicit_rooms:    {rooms}\n"
        f"  explicit_dims:     {explicit_dims}\n"
        f"  user_priorities:   {priorities}\n"
        "\nDECIDE\n"
        "  Pick exactly one template_id from the nine candidates, or\n"
        "  set decision='refuse' per the refusal rules. Populate every\n"
        "  required field on the tool input.\n"
    )


__all__ = [
    "build_template_matcher_system_prompt",
    "build_template_matcher_user_message",
]
