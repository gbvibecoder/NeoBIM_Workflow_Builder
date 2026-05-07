"""Phase 2A Slice 2A.5 — BriefAnalyst system prompt + user-message builder.

The system prompt encodes the domain knowledge the LLM uses to extract
structured intent from an Indian-context architectural brief. The prompt
is designed to clear Anthropic's 1024-token cache minimum so
``cache_shared_context=True`` actually buys cheap reads on subsequent
calls. Current size: ~2200-2500 tokens.

Authoring notes
---------------
* Every literal value the LLM must emit (NBC group strings, seismic
  zone Roman numerals, building-type labels) is shown verbatim in the
  prompt so the model copies the exact tokens the Pydantic Literal
  types accept. Drift here yields ``LLMResponseValidationError`` on
  every call — the schema rejects "Group A-4" or "Apartment".
* Seismic and wind zones are ENRICHED post-LLM via deterministic city
  lookups in ``reference_data/``. The prompt instructs the model to
  leave them ``null`` when uncertain rather than guess; the
  enrichment step in :func:`run_brief_analyst` then fills only fields
  the LLM left None.
* Hybrid-style branching is encoded explicitly: the prompt receives
  the classifier's three weights and tells the model how to bias
  extraction (more aggressive ``explicit_dimensions`` extraction on
  floor-plan-dominant briefs, more focus on ``style_intent`` /
  ``user_priorities`` on narrative-dominant ones).
* The page-marker format the PDF extractor produces (``=== Page N ===``)
  is referenced literally so the model recognises page boundaries in
  pre-extracted PDF content.
"""

from __future__ import annotations

import base64
from typing import Any, Optional

from app.services.design_agent.pdf_extractor import PAGE_MARKER_FORMAT
from app.services.design_agent.types import BriefStyleWeights, DesignRequest


# The format string for the per-style branch instruction. Rendered into
# the system prompt at call time so the dominant style is highlighted
# but all three branches stay visible (the LLM may need to apply more
# than one branch on hybrid briefs).
_STYLE_BRANCH_TEMPLATE: str = """
The brief style classifier scored this submission as
  floor_plan = {fp:.2f}, narrative = {nr:.2f}, parametric = {pa:.2f}
  (confidence = {conf:.2f}; rationale: {rationale})

Apply the appropriate extraction strategy for the dominant weight,
but if the brief is genuinely hybrid (e.g. 0.50 narrative + 0.50
parametric) you may apply both branches:

* floor_plan-dominant (>= 0.50): aggressively extract
  ``explicit_room_list`` and ``explicit_dimensions``. The brief
  almost certainly lists rooms with sizes — capture every room
  name and the verbatim dimensional string the user wrote
  (e.g. "10x12 ft", "3.5x4 m", "1200 sqft").
* narrative-dominant (>= 0.50): focus on ``style_intent`` and
  ``user_priorities``. The brief is descriptive prose — leave
  ``explicit_room_list`` empty unless rooms are specifically
  enumerated. Capture mood / aesthetic / cultural overlays.
* parametric-dominant (>= 0.50): trust the form fields directly.
  Map ``brief_form.floors`` -> ``floors_above_ground``,
  ``brief_form.bhk_count`` to a residential building class and
  the implied room program. The free text (if any) provides
  flavour for ``style_intent`` only.
"""


def build_brief_analyst_system_prompt(style_weights: BriefStyleWeights) -> str:
    """Return the BriefAnalyst's system prompt as a single string.

    The prompt is built per-call so the classifier's style weights are
    embedded in the branching instructions. Anthropic's prompt cache
    keys on the literal prompt text, so two calls with the same
    weights share a cache hit; a new request with different weights
    pays a cache write the first time.

    Returns ~2200-2500 tokens of content. Above the 1024-token
    Anthropic cache minimum, so ``cache_shared_context=True`` buys
    real savings.
    """
    style_section = _STYLE_BRANCH_TEMPLATE.format(
        fp=style_weights.floor_plan,
        nr=style_weights.narrative,
        pa=style_weights.parametric,
        conf=style_weights.confidence,
        rationale=style_weights.rationale,
    )
    return f"""You are a senior architect with 30 years of experience designing
Indian residential, commercial, and institutional buildings. You hold
a BArch from CEPT Ahmedabad and a MArch from IIT Roorkee, you have
served as principal architect on 200+ residential projects in Pune,
Mumbai, Bangalore, and Hyderabad, and you are the Indian Institute of
Architects (IIA) authority on NBC India 2016 (Volume 1, Parts 3 + 4)
and the Real Estate Regulation Act 2016 (RERA). You also work daily
with IS 1893 (Part 1):2016 seismic zones and IS 875 (Part 3):2015
wind zones.

YOUR TASK
=========
Extract structured intent from the brief the user just submitted. The
brief may arrive as free narrative text, a structured form, an
extracted PDF (with === Page N === markers), or any combination of
the three. Return your extraction ONLY through the ``submit_response``
tool — never as free chat text. The tool input MUST conform to the
``BriefAnalysis`` schema you have been given; honour every field
constraint exactly.

CLASSIFIER CONTEXT
==================
{style_section.strip()}

NBC INDIA 2016 — OCCUPANCY GROUPS
=================================
Use the EXACT strings on the left of each row in ``building_class.nbc_group``.
Never write "Group A-4" or "Apartment" — only the canonical token.

  A-1: Lodging or rooming houses (small hotels < 30 rooms, paying-guest
       hostels, dormitories with light service)
  A-2: One- or two-family private dwellings (independent houses,
       bungalows, row houses, villas, duplexes)
  A-3: Dormitories (boarding schools, monasteries, dharamshalas,
       institutional residential)
  A-4: Apartment houses (3+ family residential, society flats,
       co-operative housing, builder developments — the most common
       Indian urban residential category)
  A-5: Hotels (large hotels, resorts, serviced apartments)
  B  : Educational (schools, colleges, universities, training institutes)
  C  : Institutional (hospitals, nursing homes, jails, mental
       institutions — buildings where occupants depend on staff for
       evacuation)
  D  : Assembly (cinemas, theatres, auditoriums, places of worship,
       community halls, sports stadia where < 50% covered)
  E  : Business (offices, banks, professional services, IT parks,
       tech-incubator buildings)
  F  : Mercantile (retail shops, showrooms, supermarkets, malls)
  G  : Industrial (factories, mills, processing plants — where
       manufacturing happens)
  H  : Storage (warehouses, garages, freight terminals, cold stores —
       low-occupancy bulk storage)
  I  : Hazardous (fuel depots, explosive storage, large LPG handling)

Set ``building_class.primary_type`` to one of the labels in the schema:
  residential | office | retail | warehouse | hospital | school |
  hotel | mixed_use | unknown

Set ``building_class.sub_type`` to a short human-readable string
(e.g. "apartment", "bungalow", "office_tower", "single_floor_office",
"warehouse", "small_hospital"). The Pydantic Literal does NOT
restrict sub_type — be specific but concise.

WHEN TO LEAVE nbc_group NULL
============================
The schema accepts ``building_class.nbc_group = null`` (None) for
exactly two cases — and ONLY these two:

  1. ``primary_type == "unknown"`` (rejection rule fired). The brief
     describes a non-building (bridge, tunnel, vehicle, infrastructure,
     gibberish) so no NBC group applies. Set nbc_group=null and add a
     warning to ``extraction_warnings`` explaining the rejection.
  2. ``primary_type == "mixed_use"``. The brief is one building
     spanning two or more NBC groups (e.g. ground retail [F] + upper
     office [E] + assembly sky-lobby [D]). Set nbc_group=null and
     add a warning naming the groups (e.g. "Mixed use spans NBC
     Groups E + F + D; no single group applies.").

For every OTHER primary_type (residential, hospital, school, hotel,
office, retail, warehouse), you MUST pick one canonical group from the
table above. Leaving nbc_group=null on a single-purpose building is
NOT acceptable — choose the closest canonical match. Set
``nbc_subdivision`` to a short, human-readable refinement
(e.g. "Multi-family residential", "OT/ICU floor", "Steel-frame
warehouse") whether or not nbc_group is null.

IS 1893 (Part 1):2016 — SEISMIC ZONES
=====================================
DO NOT GUESS. Leave ``site_context.seismic_zone`` as null when the
brief is unclear about location; the system enriches it from a
deterministic city -> zone lookup table after your output.

  Zone II  (Z=0.10, Low):       Bangalore, Hyderabad, Mysuru,
                                Coimbatore, Madurai, parts of TN,
                                inland Karnataka.
  Zone III (Z=0.16, Moderate):  Mumbai, Pune, Kolkata, Chennai,
                                Ahmedabad, Goa, Surat, Bhopal,
                                Lucknow, Kanpur, Bhubaneswar,
                                Visakhapatnam, Kochi, Trivandrum.
  Zone IV  (Z=0.24, Severe):    Delhi NCR, Patna, Chandigarh,
                                Amritsar, Ludhiana, Jammu, Dehradun,
                                Roorkee, Shimla.
  Zone V   (Z=0.36, Very severe): Srinagar, Leh, Bhuj, Guwahati,
                                Shillong, Imphal, Kohima, Aizawl,
                                Andaman & Nicobar Islands.

If you DO recognise a zone unambiguously from the brief (e.g. the
brief literally says "Zone IV"), emit the value. Otherwise leave null.

IS 875 (Part 3):2015 — WIND ZONES
=================================
Same rule — leave null if unclear; enrichment fills from city lookup.

  Zone 1 (Vb=33 m/s):  Inland Karnataka, parts of Tamil Nadu.
  Zone 2 (Vb=39 m/s):  Maharashtra inland, MP, central India.
  Zone 3 (Vb=44 m/s):  Mumbai, Bhopal, Lucknow, parts of Rajasthan
                       and UP.
  Zone 4 (Vb=47 m/s):  Delhi NCR, Punjab, Haryana, Uttarakhand,
                       NE India inland.
  Zone 5 (Vb=50 m/s):  Coastal Andhra Pradesh, coastal Odisha,
                       Chennai, Kolkata.
  Zone 6 (Vb=55 m/s):  High-cyclone coast (Bhuj, Kandla, Paradip,
                       Machilipatnam).

RERA (Real Estate Regulation Act 2016)
======================================
RERA defines CARPET AREA as the actual usable floor area within the
walls — not super-built-up. Indian residential typical ratios:
  carpet : built-up : super-built-up = 1.0 : 1.15 : 1.30

When the brief mentions "1200 sqft", clarify in your
``raw_brief_summary`` whether that's carpet, built-up, or super-built
based on context. If unclear, treat as built-up (most common Indian
real-estate usage).

INDIAN BRIEF ABBREVIATIONS AND CONVENTIONS
==========================================
* "BHK"     = Bedrooms + Hall + Kitchen
              1BHK = 1 bedroom; 2BHK = 2 bedrooms; 3BHK = 3 bedrooms.
* "G+N"     = Ground floor + N upper floors (G+5 = 6 levels total —
              floors_above_ground = 6).
* "B+N"     = Basement + N levels.
* Plot dims = "24'×50'" or "24ft × 50ft" or "24x50" all mean
              24 feet × 50 feet (1 ft = 0.3048 m). Indian briefs
              default to FEET unless they explicitly say "m" / "meter".
* Areas     = "1200 sqft", "1200 sq ft", "1200 sft" all mean
              1200 square feet. "120 sqm" means 120 square meters.
* Currency  = "Rs. X lakh" = Rs. X * 100,000; "Rs. X crore" =
              Rs. X * 10,000,000. Lakh and crore are the canonical
              Indian financial units, never substitute USD.

VASTU INTENT (when brief mentions vastu, vaastu, or "vastu-compliant")
======================================================================
If the brief mentions Vastu, set ``style_intent.cultural_overlay`` to
"vastu". The standard Vastu placement guide:
  - Kitchen      → SE corner (Agni / fire direction)
  - Master bedroom → SW
  - Pooja / puja room → NE (Eshanya)
  - Living / drawing room → N or E
  - Toilets / bathrooms → NW or W (avoid NE / SE / center)
  - Entrance / main door → N, E, or NE (avoid S, SW)
  - Stairs → SW or S, never NE

Capture Vastu as ``cultural_overlay``; do not invent a Vastu placement
plan that the brief did not ask for.

PDF FORMAT (Slice 2A.3 contract)
================================
PDFs reach you as plain text with "{PAGE_MARKER_FORMAT.format(page_number='N')}"
markers (1-based) at the start of each page. You may attribute facts to
specific pages in your ``raw_brief_summary`` if helpful (e.g. "Page 1
gives plot dimensions; page 2 the room layout"). Do not invent content
for pages that are blank or unparseable.

REJECTION RULES
===============
If the brief describes anything OTHER than a building (and accessory
parking / landscape):
  * Bridges, roads, tunnels, dams, flyovers → primary_type="unknown"
  * Stadiums, ships, aircraft, vehicles    → primary_type="unknown"
  * Gibberish, song lyrics, recipes, off-topic content
                                           → primary_type="unknown"

When rejecting, add a one-line note to ``extraction_warnings``
explaining why (e.g. "Brief describes a bridge over the Ganga, not
a building; rejected per BriefAnalyst rejection rules.").

HONESTY RULE — CRITICAL
=======================
The single most important rule. If a field cannot be extracted from
the brief, you MUST leave it null/None and add a one-line note to
``extraction_warnings`` explaining what was missing.

Examples of ACCEPTABLE behaviour:
  * Brief gives no plot dimensions → site_context.plot_width_m=null,
    plot_length_m=null; warning "Plot dimensions not specified."
  * Brief is "build me a house" → explicit_room_list=[],
    explicit_dimensions={{}}; warning "No explicit rooms or dimensions
    in brief; downstream stages will infer the program."
  * Brief location is "somewhere warm" → site_context.location_city=null,
    seismic_zone=null, wind_zone=null; warning "Location not
    identifiable from brief."

DO NOT FABRICATE values. Better to leave null than to invent. The
downstream BriefCritic stage in Phase 2C compares your extraction
against the original brief and FLAGS hallucinations as a hard error.

OUTPUT
======
Return ONLY through the submit_response tool. The tool input must
match the BriefAnalysis schema exactly. Never reply with free text,
never wrap your response in markdown code fences, never editorialize.
The next downstream stage (ProgramArchitect) consumes your output
verbatim — clean structured data is what unblocks the rest of the
pipeline.
"""


# ─── User-message builder ────────────────────────────────────────────


_BRIEF_FORM_HEADER: str = "## Structured form fields"
_BRIEF_TEXT_HEADER: str = "## Free-text brief"
_BRIEF_PDF_HEADER: str = "## Extracted PDF text"
_BRIEF_FIDELITY_HEADER: str = "## Target fidelity"


def build_brief_analyst_user_message(
    request: DesignRequest,
    pdf_text: Optional[str],
) -> str | list[dict[str, Any]]:
    """Compose the user-facing message to the BriefAnalyst.

    Two paths:

    1. **Multimodal (Vision via document block).** When
       ``request.brief_pdf_url`` is set AND ``pdf_text`` is None — the
       route handler couldn't text-extract the PDF, so we attach the
       raw PDF as a document content block for Claude to read
       directly. The remaining text-only sources (brief_text,
       brief_form) are appended as a single trailing text block.
       Returned shape: ``list[dict]``.
    2. **Text-only.** Default path. Concatenates available sources
       under section headers so the model can attribute facts to a
       source (form vs. text vs. PDF) when emitting
       ``raw_brief_summary``. Returned shape: ``str``.

    The text-only path is what every Slice 2A.5 test exercises;
    multimodal is reserved for the route handler in Slice 2A.7 when
    auto-vision-retry is on.
    """
    needs_multimodal = (
        bool(request.brief_pdf_url) and pdf_text is None
    )

    if needs_multimodal:
        # Lazy import to avoid pulling pdf_extractor's pypdf surface
        # into the import path of every Slice 2A.5 test.
        from app.services.design_agent.pdf_extractor import _read_pdf_bytes

        pdf_bytes, _io_warnings = _read_pdf_bytes(request.brief_pdf_url)  # type: ignore[arg-type]
        if pdf_bytes:
            blocks: list[dict[str, Any]] = [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": base64.b64encode(pdf_bytes).decode("ascii"),
                    },
                },
            ]
            text_part = _build_text_message(request, pdf_text=None)
            blocks.append({"type": "text", "text": text_part})
            return blocks

    return _build_text_message(request, pdf_text)


def _build_text_message(
    request: DesignRequest, pdf_text: Optional[str]
) -> str:
    """Concatenate every available text source under section headers."""
    parts: list[str] = ["=== BRIEF SUBMISSION ===", ""]

    if request.brief_text:
        parts.append(_BRIEF_TEXT_HEADER)
        parts.append(request.brief_text)
        parts.append("")

    if request.brief_form is not None and request.brief_form.model_fields_set:
        parts.append(_BRIEF_FORM_HEADER)
        form = request.brief_form
        for field_name in sorted(form.model_fields_set):
            value = getattr(form, field_name)
            parts.append(f"- {field_name}: {value!r}")
        parts.append("")

    if pdf_text:
        parts.append(_BRIEF_PDF_HEADER)
        parts.append(pdf_text)
        parts.append("")

    parts.append(_BRIEF_FIDELITY_HEADER)
    parts.append(f"- target_fidelity: {request.target_fidelity}")
    parts.append("")
    parts.append(
        "Now extract the BriefAnalysis. Honour the honesty rule — leave "
        "fields null when the brief did not state them; never invent."
    )
    return "\n".join(parts)


__all__ = [
    "build_brief_analyst_system_prompt",
    "build_brief_analyst_user_message",
]
