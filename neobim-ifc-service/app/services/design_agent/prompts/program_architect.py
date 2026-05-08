"""Phase 2A Slice 2A.6 (post-restructure) — per-floor ProgramArchitect prompt.

The slice's first attempt called Sonnet once for a full RoomProgram and
hit per-call wallclock + token-cap walls on multi-floor briefs. The
restructure runs ONE call per floor in parallel, with a tightly scoped
prompt asking the LLM to design only that floor's rooms. Each per-floor
output is small (~5 rooms × ~150 tokens = ~1500 tokens), fits any
reasonable timeout, and the parallel composition keeps the
end-to-end wallclock at ``max(per-call) ≈ 20s`` regardless of building
size.

The LLM emits a slim per-room shape — only the fields the LLM actually
decides:

    id, name, usage, target_area_sqm, floor_index,
    adjacency_required, adjacency_forbidden, notes

The composer (in ``stages/program_architect.py``) enriches each
emitted room with the deterministic post-process fields from
:data:`reference_data.USAGE_DEFAULTS` (aspect ratios, light /
ventilation requirements, privacy level) and ``NBC_MIN_AREAS_SQM``
(per-usage carpet-area floor) to construct the strict
:class:`RoomSpec`.

Authoring notes
---------------
* The system prompt embeds NBC minimum carpet areas verbatim so the
  LLM sizes rooms above the floor on the first emission. The
  composer's auto-correction is a safety net, not the primary
  mechanism.
* Per-floor distribution rules are computed at prompt-build time
  based on (primary_type, floor_index, total_floors) — only the
  rules relevant to THIS floor appear in the prompt, keeping it
  small.
* Vastu placement guidance is included only when
  ``analysis.style_intent.cultural_overlay == "vastu"``, and even
  then, only the rules relevant to THIS floor's typical room set.
"""

from __future__ import annotations

from app.services.design_agent.reference_data.nbc_india_minimums import (
    NBC_MIN_AREAS_SQM,
)
from app.services.design_agent.types import BriefAnalysis


def _format_nbc_table_compact() -> str:
    """Render NBC_MIN_AREAS_SQM as a 2-column compact list (smaller
    than the original 3-column table; per-floor prompts trim where
    they can)."""
    rows = [
        f"  {usage:<22s} >= {sqm:.1f} sqm"
        for usage, sqm in NBC_MIN_AREAS_SQM.items()
    ]
    return "\n".join(rows)


def _floor_distribution_rule(
    primary_type: str, floor_index: int, floors_above_ground: int
) -> str:
    """Return the natural-language distribution guidance for one floor.

    Branches on the building type and the floor's position in the
    stack so the prompt only contains rules relevant to THIS floor.
    """
    is_residential = primary_type in {"residential", "mixed_use"}
    is_basement = floor_index < 0
    is_ground = floor_index == 0
    is_top = floor_index == floors_above_ground - 1
    is_upper = (not is_basement) and (not is_ground) and (not is_top)

    if is_basement:
        return (
            "BASEMENT FLOOR: parking, utility, store. NO habitable rooms "
            "(NBC India does not permit residential / office occupancy "
            "below ground in this slice). Typical 1-3 rooms: parking "
            "(usage='external'), store, utility."
        )

    if primary_type == "warehouse":
        if is_ground:
            return (
                "WAREHOUSE GROUND FLOOR (single-storey building): the "
                "main warehouse_floor + 1-2 loading_bay + small office "
                "for the manager + 1-2 bathrooms + store."
            )
        return "FLOOR ABOVE A WAREHOUSE: rare; expect office mezzanine."

    if primary_type == "hospital":
        if is_ground:
            return (
                "HOSPITAL GROUND FLOOR: reception, consultation x 4-6, "
                "pharmacy, lab, lobby, bathroom x 2."
            )
        if is_top:
            return (
                "HOSPITAL TOP FLOOR: operation_theatre x 1-2, icu, "
                "consultation, corridor, bathroom."
            )
        return (
            "HOSPITAL MID FLOOR: ward x 4-8 (each its own RoomSpec), "
            "office (use 'office' usage for nurses_station), corridor, "
            "bathroom."
        )

    if primary_type == "school":
        if is_ground:
            return (
                "SCHOOL GROUND FLOOR: reception/office, classroom x 2-4, "
                "library, bathroom x 2, store."
            )
        return (
            "SCHOOL UPPER FLOOR: classroom x 4-6, study, office, "
            "bathroom x 2."
        )

    if primary_type == "office":
        if is_ground:
            return (
                "OFFICE GROUND FLOOR: reception, lobby, meeting_room x 1, "
                "office (workspace), pantry, bathroom x 2."
            )
        if is_top:
            return (
                "OFFICE TOP FLOOR: executive office (use 'office'), "
                "meeting_room (boardroom), pantry, bathroom x 2."
            )
        return (
            "OFFICE UPPER FLOOR: open office workspaces (~2-4 'office' "
            "rooms), meeting_room x 1-2, pantry, bathroom x 2."
        )

    if primary_type == "retail":
        if is_ground:
            return (
                "RETAIL GROUND FLOOR: showroom or shop (main customer "
                "floor), reception, stock_room, bathroom."
            )
        return "RETAIL UPPER FLOOR: more showroom / shop, stock_room, bathroom."

    # Residential or mixed_use — apply BHK template rules
    if is_residential:
        if is_ground:
            return (
                "RESIDENTIAL GROUND FLOOR: living, dining, kitchen, "
                "powder_room, balcony, entrance lobby, parking "
                "(usage='external'). Pooja_room if vastu is requested."
            )
        if is_top and floors_above_ground >= 2:
            return (
                "RESIDENTIAL TOP FLOOR: master_bedroom + master "
                "bathroom (en-suite), 1-2 bedroom, common bathroom, "
                "study, balcony. May also include terrace "
                "(usage='external')."
            )
        if is_upper:
            return (
                "RESIDENTIAL UPPER FLOOR: bedroom x 2-3, bathroom x 1-2, "
                "study (if 3+ BHK), balcony. Typical apartment-stack "
                "floor — replicate per-BHK template if multi-flat."
            )
        # Single-floor residential (G+0 bungalow)
        return (
            "SINGLE-FLOOR RESIDENTIAL: living, dining, kitchen, "
            "master_bedroom (en-suite), bedroom x 1-2, bathroom, "
            "balcony, store. Pooja_room if vastu."
        )

    # Fallback for unknown / mixed
    return (
        "GENERIC FLOOR: emit rooms appropriate for a "
        f"{primary_type} building on floor {floor_index}. Use the NBC "
        "table above as the size floor."
    )


def _vastu_overlay_section(has_vastu: bool, floor_index: int) -> str:
    """Insert Vastu placement guidance only when the analysis flagged
    it AND this floor would typically receive vastu-positioned rooms."""
    if not has_vastu:
        return ""
    return (
        "\n\nVASTU OVERLAY (cultural_overlay = 'vastu')\n"
        "==========================================\n"
        "Apply standard Indian Vastu placement on rooms YOU emit:\n"
        "  Kitchen           -> SE corner of plot\n"
        "  Master bedroom    -> SW\n"
        "  Pooja / puja room -> NE\n"
        "  Living            -> N or E\n"
        "  Toilets / baths   -> NW or W (avoid NE / SE / center)\n"
        "  Stairs            -> SW or S, never NE\n"
        "Encode the placement in the room's ``notes`` field (e.g.\n"
        "notes='Vastu: SE corner placement')."
    )


def build_floor_system_prompt(
    analysis: BriefAnalysis, floor_index: int
) -> str:
    """System prompt for ONE floor's room design.

    Compact (~1500-2000 tokens) — enough above Anthropic's 1024-token
    cache minimum that ``cache_shared_context=True`` still buys
    real savings, but small enough that even a per-floor LLM call
    runs in 10-20 seconds wallclock.
    """
    nbc_table = _format_nbc_table_compact()
    primary = analysis.building_class.primary_type
    sub = analysis.building_class.sub_type
    floors = analysis.floors_above_ground
    has_vastu = analysis.style_intent.cultural_overlay == "vastu"
    distribution = _floor_distribution_rule(primary, floor_index, floors)
    vastu_section = _vastu_overlay_section(has_vastu, floor_index)

    return f"""You are a senior Indian architect with 30 years of experience producing
detailed-design room programs. You hold authoritative working
knowledge of NBC India 2016 (Volumes 1-2, Parts 3 + 4), RERA 2016
carpet-area definitions, CPWD DSR + IS 14660 commercial workspace
norms, IPHS hospital-room minima, AICTE classroom-density norms, and
Vastu placement (when the brief requests it).

YOUR TASK
=========
Design EXACTLY ONE floor — floor {floor_index} of a
{primary} ({sub}) building with {floors} floor(s) above ground.

You will receive the full BriefAnalysis as user-message context.
Your job is to:

  * Emit a list of ``RoomSpec`` entries for floor_index = {floor_index}.
  * Each room is sized at or above the NBC India minimum (table below).
  * Adjacency arrays reference ONLY rooms YOU emit on this floor, OR
    the literal ``"Outside"`` for relationships to the building
    exterior. Cross-floor adjacency (stairs / lifts) is the
    Composer's responsibility, not yours.
  * Emit a short ``floor_summary`` (1 sentence) describing what this
    floor does in the building.

OTHER FLOORS DO NOT CONCERN YOU. Other parallel calls are designing
other floors. Stay narrow.

THIS FLOOR'S DISTRIBUTION RULE
==============================
{distribution}

NBC INDIA MINIMUM ROOM AREAS (CARPET, sqm)
==========================================
Use these as the FLOOR for every room's ``target_area_sqm``. Sizing
larger is fine when the brief justifies it; smaller is auto-corrected
upward by the composer post-call (preferable to size right up front).

{nbc_table}

ADJACENCY RULES
===============
Populate ``adjacency_required`` (list of room ids on this floor or
"Outside") and ``adjacency_forbidden``.

REQUIRED on this floor:
  * kitchen <-> dining
  * master_bedroom <-> master bathroom (en-suite, when present)
  * lobby <-> reception (offices)
  * loading_bay <-> warehouse_floor
  * operation_theatre <-> icu
  * balcony <-> "Outside"

FORBIDDEN on this floor:
  * kitchen <-> bathroom (NBC India hygiene)
  * pooja_room / puja <-> bathroom (cultural)
  * pooja_room <-> kitchen (purity)
  * operation_theatre <-> bathroom (hospital infection control){vastu_section}

ROOM ID CONVENTION
==================
Use short kebab-case ids. Prefix with "f<floor_index>-" if you want
to namespace; the composer renames duplicates across floors anyway.
Example: "f{floor_index}-r-living-01", "f{floor_index}-r-kitchen-01".
Every room id you emit MUST be unique within YOUR floor's list.

OUTPUT — slim per-floor schema
==============================
Return ONLY through the ``submit_response`` tool with a payload
matching the supplied schema:

  rooms          (list[FloorRoomSpec], min 1) — every floor has at
                  least 1 room. Each FloorRoomSpec has:
    - id                 (str, unique per floor)
    - name               (str, human-readable)
    - usage              (Literal — pick from NBC table above)
    - target_area_sqm    (float > 0, >= NBC min for the usage)
    - floor_index        ({floor_index} — emit literally this number)
    - adjacency_required (list[str], may be empty)
    - adjacency_forbidden(list[str], may be empty)
    - notes              (str, default "" — use for vastu hints etc.)
  floor_summary  (str, may be empty — 1-sentence description)

The schema does NOT ask for nbc_min_area_sqm, aspect_ratio_min/max,
natural_light_required, natural_ventilation_required, or
privacy_level — the composer derives those from the ``usage``
literal post-call. Don't waste output tokens on them.

CONCRETE EXAMPLE — minimal output for a single-room floor
=========================================================
{{
  "rooms": [
    {{
      "id": "f{floor_index}-r-store-01",
      "name": "Store",
      "usage": "store",
      "target_area_sqm": 4.0,
      "floor_index": {floor_index},
      "adjacency_required": [],
      "adjacency_forbidden": [],
      "notes": ""
    }}
  ],
  "floor_summary": "Storage and utility space."
}}

DO NOT skip a field. Empty values are fine; absent fields are NOT.

Return ONLY through the submit_response tool. Never reply with free
text, never wrap in markdown code fences, never editorialize.
"""


def build_floor_user_message(
    analysis: BriefAnalysis, floor_index: int
) -> str:
    """User message for ONE floor — JSON-serialised analysis + the
    floor target.

    Same JSON-serialisation shape as the BriefAnalyst stage uses for
    its user message; gives the model a canonical, self-describing
    view of the upstream extraction.
    """
    payload = analysis.model_dump_json(indent=2)
    return f"""=== BRIEF ANALYSIS (output of BriefAnalyst, Stage 1) ===

You are designing FLOOR {floor_index} of this building. Other floors
are being designed in parallel by other instances of this stage.

```json
{payload}
```

Now emit the rooms for floor {floor_index} via the submit_response
tool. Honour the OUTPUT spec, the NBC minimums, and the adjacency
rules.
"""


__all__ = [
    "build_floor_system_prompt",
    "build_floor_user_message",
]
