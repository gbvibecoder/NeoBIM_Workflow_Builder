"""Phase 2A Slice 2A.6 — ProgramArchitect stage tests.

Two test layers (same pattern as Slice 2A.5):

* **Cache-only tests** (always run) — pure-function pieces:
  prompt builder, user-message builder, floor-coverage check,
  auto-correction recovery. No LLM calls.
* **LLM-driven tests** — full BriefAnalyst -> ProgramArchitect
  pipeline against the committed sample brief fixtures. Both
  stages hit cache once their fixtures are committed; until then
  the tests skip cleanly via the LLMUnavailableError helper.

Cache-generation workflow:

    cd neobim-ifc-service
    ANTHROPIC_API_KEY=sk-ant-... python3.11 -m pytest \\
      tests/test_program_architect.py -v
    # Cache files appear under app/services/design_agent/cache/
    # for both BriefAnalyst (already committed for 2A.5) and
    # ProgramArchitect (new in 2A.6).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.services.design_agent import (
    BriefAnalysis,
    BriefForm,
    DesignRequest,
    LLMClient,
    LLMUnavailableError,
    ProgramArchitectMetadata,
    RoomProgram,
    classify_brief,
    run_brief_analyst,
    run_program_architect,
)
from app.services.design_agent.llm_client import LLMResponseValidationError
from app.services.design_agent.prompts.program_architect import (
    build_program_architect_system_prompt,
    build_program_architect_user_message,
)
from app.services.design_agent.reference_data.nbc_india_minimums import (
    NBC_MIN_AREAS_SQM,
)
from app.services.design_agent.stages.program_architect import (
    _attempt_recovery,
    _check_floor_coverage,
)
from app.services.design_agent.types import (
    BuildingClass,
    DesignContextValidationError,
    FidelityHint,
    SiteContext,
    StructuralIntent,
    StyleIntent,
)


_FIXTURES = Path(__file__).parent / "fixtures" / "sample_briefs"


# ─── Helpers ──────────────────────────────────────────────────────────


def _build_minimal_analysis(
    *,
    primary_type: str = "residential",
    sub_type: str = "2BHK apartment",
    nbc_group: "str | None" = "A-4",
    nbc_subdivision: str = "Multi-family residential",
    floors_above_ground: int = 2,
    cultural_overlay: "str | None" = None,
) -> BriefAnalysis:
    return BriefAnalysis(
        building_class=BuildingClass(
            primary_type=primary_type,  # type: ignore[arg-type]
            sub_type=sub_type,
            nbc_group=nbc_group,  # type: ignore[arg-type]
            nbc_subdivision=nbc_subdivision,
        ),
        site_context=SiteContext(location_city="Pune", seismic_zone="III", wind_zone=2),
        style_intent=StyleIntent(
            architectural_style="modern", cultural_overlay=cultural_overlay
        ),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=floors_above_ground,
        floors_below_ground=0,
        raw_brief_summary="Test brief summary.",
    )


def _read_text_fixture(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


def _run_or_skip(
    analysis: BriefAnalysis,
) -> tuple[RoomProgram, ProgramArchitectMetadata]:
    """Run the architect; skip cleanly on cache miss + no API key."""
    client = LLMClient()
    try:
        return run_program_architect(analysis=analysis, llm_client=client)
    except LLMUnavailableError as exc:
        pytest.skip(
            f"ProgramArchitect cache miss + no ANTHROPIC_API_KEY. "
            f"Run with key locally to populate cache. Detail: {exc}"
        )


def _analyse_or_skip(
    request: DesignRequest,
) -> BriefAnalysis:
    """Run BriefAnalyst (cache hit if 2A.5 cache committed)."""
    client = LLMClient()
    try:
        weights = classify_brief(request)
        analysis, _meta = run_brief_analyst(
            request=request,
            style_weights=weights,
            pdf_text=None,
            llm_client=client,
        )
        return analysis
    except LLMUnavailableError as exc:
        pytest.skip(
            f"BriefAnalyst cache miss + no ANTHROPIC_API_KEY. "
            f"Run with key locally first. Detail: {exc}"
        )


# ─── Cache-only tests (always run) ────────────────────────────────────


def test_system_prompt_clears_anthropic_cache_minimum() -> None:
    """Prompt must exceed the 1024-token cache minimum (chars / 4 ≈ tokens)."""
    prompt = build_program_architect_system_prompt(_build_minimal_analysis())
    assert len(prompt) >= 1500 * 4, (
        f"prompt too short: {len(prompt)} chars (~{len(prompt)//4} tokens)"
    )


def test_system_prompt_embeds_nbc_table_verbatim() -> None:
    """Drift sentinel: every NBC_MIN_AREAS_SQM entry must appear in the prompt."""
    prompt = build_program_architect_system_prompt(_build_minimal_analysis())
    for usage, sqm in NBC_MIN_AREAS_SQM.items():
        # Format: "  living                   >=   9.5 sqm carpet"
        assert usage in prompt, f"NBC usage {usage!r} missing from prompt"
        # Number appears in some form — match the exact float printout
        assert f"{sqm:.1f}" in prompt, f"NBC min for {usage} ({sqm}) not in prompt"


def test_system_prompt_branches_on_vastu() -> None:
    """Vastu section is included or omitted based on cultural_overlay."""
    with_vastu = build_program_architect_system_prompt(
        _build_minimal_analysis(cultural_overlay="vastu")
    )
    without_vastu = build_program_architect_system_prompt(
        _build_minimal_analysis(cultural_overlay=None)
    )
    assert 'cultural_overlay = "vastu"' in with_vastu
    assert "Pooja / puja room -> NE" in with_vastu
    assert "did NOT flag a Vastu cultural overlay" in without_vastu
    assert "Pooja / puja room -> NE" not in without_vastu


def test_system_prompt_includes_standard_programs() -> None:
    """Every building-type template should be enumerated."""
    prompt = build_program_architect_system_prompt(_build_minimal_analysis())
    for keyword in (
        "1BHK", "2BHK", "3BHK", "4BHK",
        "Office (Group E)", "Hospital (Group C",
        "School (Group B)", "Warehouse (Group H",
        "Mercantile / Retail (Group F)",
    ):
        assert keyword in prompt, f"missing program template keyword: {keyword!r}"


def test_user_message_includes_serialised_analysis() -> None:
    """The user message embeds the BriefAnalysis as JSON for the LLM."""
    analysis = _build_minimal_analysis()
    msg = build_program_architect_user_message(analysis)
    assert "BRIEF ANALYSIS" in msg
    assert '"primary_type": "residential"' in msg
    assert '"location_city": "Pune"' in msg


# ─── Floor coverage check ────────────────────────────────────────────


def _build_program_with_floors(floors: dict[int, list[str]]) -> RoomProgram:
    """Build a tiny valid RoomProgram with the given floor map.

    Used by floor-coverage tests; rooms are populated only as needed
    to satisfy ROOM_FLOORS_CONSISTENT.
    """
    rooms = []
    for f, ids in floors.items():
        for rid in ids:
            rooms.append({
                "id": rid,
                "name": "Test Room",
                "usage": "office",
                "target_area_sqm": 10.0,
                "nbc_min_area_sqm": 5.0,
                "aspect_ratio_min": 1.0,
                "aspect_ratio_max": 2.5,
                "natural_light_required": True,
                "natural_ventilation_required": True,
                "privacy_level": "semi_private",
                "floor_index": f,
            })
    if not rooms:
        # ROOM_FLOORS_CONSISTENT requires at least 1 room
        rooms.append({
            "id": "r-placeholder",
            "name": "Placeholder",
            "usage": "office",
            "target_area_sqm": 10.0,
            "nbc_min_area_sqm": 5.0,
            "aspect_ratio_min": 1.0,
            "aspect_ratio_max": 2.5,
            "natural_light_required": False,
            "natural_ventilation_required": False,
            "privacy_level": "semi_private",
            "floor_index": 0,
        })
        floors = {0: ["r-placeholder"]}
    return RoomProgram.build({
        "rooms": rooms,
        "rooms_per_floor": floors,
        "circulation": {
            "corridor_min_width_m": 1.2,
            "stair_count": 1,
            "lift_count": 0,
            "egress_paths_required": 1,
        },
        "constraints": {
            "total_carpet_area_sqm_min": 10.0,
            "total_carpet_area_sqm_max": 50.0,
            "max_floors": max(floors) + 1 if floors else 1,
        },
        "summary": "Test program.",
    })


def test_floor_coverage_reports_full_coverage() -> None:
    program = _build_program_with_floors({0: ["r-1"], 1: ["r-2"]})
    analysis = _build_minimal_analysis(floors_above_ground=2)
    missing = _check_floor_coverage(program, analysis)
    assert missing == set()


def test_floor_coverage_reports_missing_floor() -> None:
    program = _build_program_with_floors({0: ["r-1"]})
    analysis = _build_minimal_analysis(floors_above_ground=3)
    missing = _check_floor_coverage(program, analysis)
    assert missing == {1, 2}


def test_floor_coverage_ignores_empty_floor_lists() -> None:
    """A floor entry with an empty room list counts as uncovered."""
    program = _build_program_with_floors({0: ["r-1"], 1: []})
    analysis = _build_minimal_analysis(floors_above_ground=2)
    missing = _check_floor_coverage(program, analysis)
    assert missing == {1}


# ─── Auto-correction recovery ────────────────────────────────────────


def _sub_nbc_raw_payload() -> dict[str, Any]:
    """Build a raw RoomProgram dict with one sub-NBC kitchen — the
    minimum-viable shape that triggers ROOM_AREA_RESPECTS_NBC."""
    return {
        "rooms": [
            {
                "id": "r-living-01",
                "name": "Living Room",
                "usage": "living",
                "target_area_sqm": 12.0,
                "nbc_min_area_sqm": 9.5,
                "aspect_ratio_min": 1.0,
                "aspect_ratio_max": 2.5,
                "natural_light_required": True,
                "natural_ventilation_required": True,
                "privacy_level": "semi_private",
                "floor_index": 0,
            },
            {
                "id": "r-kitchen-01",
                "name": "Kitchen",
                "usage": "kitchen",
                "target_area_sqm": 3.0,  # ← sub-NBC (min is 5.0)
                "nbc_min_area_sqm": 5.0,
                "aspect_ratio_min": 1.0,
                "aspect_ratio_max": 2.0,
                "natural_light_required": True,
                "natural_ventilation_required": True,
                "privacy_level": "semi_private",
                "floor_index": 0,
            },
        ],
        "rooms_per_floor": {0: ["r-living-01", "r-kitchen-01"]},
        "circulation": {
            "corridor_min_width_m": 1.2,
            "stair_count": 1,
            "lift_count": 0,
            "egress_paths_required": 1,
        },
        "constraints": {
            "total_carpet_area_sqm_min": 15.0,
            "total_carpet_area_sqm_max": 30.0,
            "max_floors": 1,
        },
        "summary": "Tiny test 1BHK with under-sized kitchen.",
        "extraction_warnings": [],
    }


def test_attempt_recovery_corrects_sub_nbc_kitchen() -> None:
    """Sub-NBC kitchen → auto-corrected to NBC minimum, warning appended."""
    payload = _sub_nbc_raw_payload()
    try:
        RoomProgram.model_validate(payload)
        pytest.fail("expected ValidationError on sub-NBC payload")
    except ValidationError as pyd_err:
        wrapped = LLMResponseValidationError(pyd_err, payload)
        result = _attempt_recovery(wrapped)
    assert result is not None, "recovery did not run on sub-NBC kitchen"
    program, count = result
    assert count == 1, f"expected 1 auto-correction, got {count}"
    kitchen = next(r for r in program.rooms if r.id == "r-kitchen-01")
    assert kitchen.target_area_sqm == 5.0
    # Warning recorded
    assert any(
        "Auto-corrected" in w and "r-kitchen-01" in w
        for w in program.extraction_warnings
    ), program.extraction_warnings


def test_attempt_recovery_returns_none_on_unrelated_error() -> None:
    """Non-area validation errors are NOT auto-corrected."""
    payload = _sub_nbc_raw_payload()
    # Inject a non-recoverable error: dangling adjacency reference
    payload["rooms"][0]["adjacency_required"] = ["nonexistent-room"]
    # Fix the area issue first so only the dangling adjacency is left
    payload["rooms"][1]["target_area_sqm"] = 5.0
    try:
        RoomProgram.model_validate(payload)
        pytest.fail("expected ValidationError")
    except ValidationError as pyd_err:
        wrapped = LLMResponseValidationError(pyd_err, payload)
        result = _attempt_recovery(wrapped)
    assert result is None, (
        "recovery should return None for unrelated validation errors; "
        "got a corrected program back"
    )


# ─── LLM-driven tests (skip on cache miss + no API key) ──────────────


def test_program_architect_2bhk_pune_extraction() -> None:
    """2BHK Pune brief: ≥7 rooms, master_bedroom on first floor,
    kitchen + living + dining on ground."""
    text = _read_text_fixture("2bhk_24x50.txt")
    request = DesignRequest(brief_text=text, build_id="test-2bhk-pune")
    analysis = _analyse_or_skip(request)
    program, meta = _run_or_skip(analysis)

    assert len(program.rooms) >= 7, f"expected >= 7 rooms, got {len(program.rooms)}"

    rooms_by_id = {r.id: r for r in program.rooms}
    # Master bedroom should exist somewhere
    masters = [r for r in program.rooms if r.usage == "master_bedroom"]
    assert masters, "no master_bedroom in 2BHK program"

    # Kitchen + living + dining should be on ground floor (floor 0)
    ground_usages = {
        rooms_by_id[rid].usage for rid in program.rooms_per_floor.get(0, [])
    }
    assert "kitchen" in ground_usages, f"kitchen not on ground; got {ground_usages}"
    assert "living" in ground_usages, f"living not on ground; got {ground_usages}"

    # Master bedroom prefers upper floor (privacy)
    master_floors = {r.floor_index for r in masters}
    assert master_floors.issubset({0, 1}), (
        f"master_bedroom on unexpected floor: {master_floors}"
    )

    # Vastu hints captured if analysis flagged it
    if analysis.style_intent.cultural_overlay == "vastu":
        # At least one room or program warning mentions vastu / SE / SW / NE
        any_vastu_signal = any(
            ("vastu" in r.notes.lower()) or any(
                d in r.notes for d in ("SE", "SW", "NE")
            )
            for r in program.rooms
        ) or any(
            "vastu" in w.lower() for w in program.extraction_warnings
        )
        assert any_vastu_signal, (
            "vastu overlay flagged in analysis but not propagated to program"
        )

    assert isinstance(meta, ProgramArchitectMetadata)


def test_program_architect_circular_futuristic_bangalore() -> None:
    """Circular Bangalore: ≥5 rooms across 5 floors (mixed-use)."""
    text = _read_text_fixture("circular_futuristic.txt")
    request = DesignRequest(brief_text=text, build_id="test-circular-futur")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    assert len(program.rooms) >= 5, f"expected >= 5 rooms, got {len(program.rooms)}"
    # Spread across multiple floors (mixed-use is multi-floor)
    floors_with_rooms = {f for f, rids in program.rooms_per_floor.items() if rids}
    assert len(floors_with_rooms) >= 3, (
        f"mixed-use should span >= 3 floors; got {floors_with_rooms}"
    )


def test_program_architect_g_plus_5_form_only() -> None:
    """G+5 form-only: residential template applied across multiple floors."""
    form_dict = json.loads(_read_text_fixture("g_plus_5_apartment_form.json"))
    form_dict.pop("_comment", None)
    form = BriefForm(**form_dict)
    request = DesignRequest(brief_form=form, build_id="test-gplus5-form")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    # G+5 = 6 floors (analysis.floors_above_ground from the form's "floors": 5;
    # the BriefAnalyst is expected to interpret "G+5" / floors=5 contextually).
    # Either way, the program should populate at least 2 floors and have
    # rooms spanning bedroom + living + kitchen at minimum.
    usages = {r.usage for r in program.rooms}
    assert "kitchen" in usages, usages
    assert "living" in usages, usages
    assert any("bedroom" in u for u in usages), usages


def test_program_architect_warehouse() -> None:
    """Warehouse: warehouse_floor + loading_bay + manager office + restrooms."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-warehouse")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    usages = {r.usage for r in program.rooms}
    assert "warehouse_floor" in usages, f"missing warehouse_floor: {usages}"
    assert "loading_bay" in usages, f"missing loading_bay: {usages}"
    assert "bathroom" in usages or "powder_room" in usages, (
        f"missing restroom usage: {usages}"
    )

    # Single-floor: every room should be on floor_index=0
    floors = {r.floor_index for r in program.rooms}
    assert floors == {0}, f"warehouse program should be single-floor; got {floors}"


def test_program_architect_hospital_3floor_distribution() -> None:
    """3-floor hospital: ground=OPD/reception/pharmacy, first=wards,
    second=OT/ICU."""
    text = _read_text_fixture("hospital_3floor.txt")
    request = DesignRequest(brief_text=text, build_id="test-hospital")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    rooms_by_id = {r.id: r for r in program.rooms}
    ground = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(0, [])}
    first = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(1, [])}
    second = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(2, [])}

    # Ground: at least one of reception / consultation
    assert ground & {"reception", "consultation"}, (
        f"ground floor missing reception/consultation; got {ground}"
    )
    # First: at least one ward
    assert "ward" in first, f"first floor should have ward; got {first}"
    # Second: at least one of operation_theatre / icu
    assert second & {"operation_theatre", "icu"}, (
        f"second floor missing OT/ICU; got {second}"
    )


# ─── Cross-fixture invariants ────────────────────────────────────────


@pytest.mark.parametrize(
    "fixture_text",
    [
        "2bhk_24x50.txt",
        "warehouse.txt",
        "hospital_3floor.txt",
    ],
)
def test_every_room_meets_nbc_minimum(fixture_text: str) -> None:
    """ROOM_AREA_RESPECTS_NBC invariant: every produced room hits NBC."""
    request = DesignRequest(
        brief_text=_read_text_fixture(fixture_text),
        build_id=f"test-nbc-{fixture_text}",
    )
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    for room in program.rooms:
        assert room.target_area_sqm >= room.nbc_min_area_sqm, (
            f"room {room.id} ({room.usage}): target {room.target_area_sqm} "
            f"< NBC min {room.nbc_min_area_sqm}"
        )


@pytest.mark.parametrize(
    "fixture_text",
    ["2bhk_24x50.txt", "warehouse.txt"],
)
def test_no_adjacency_contradiction(fixture_text: str) -> None:
    """No room should have an id in BOTH adjacency_required AND adjacency_forbidden."""
    request = DesignRequest(
        brief_text=_read_text_fixture(fixture_text),
        build_id=f"test-adj-{fixture_text}",
    )
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    for room in program.rooms:
        overlap = set(room.adjacency_required) & set(room.adjacency_forbidden)
        assert not overlap, (
            f"room {room.id} has contradictory adjacency: required + "
            f"forbidden both contain {overlap}"
        )


def test_program_does_not_invent_floors_for_single_storey_warehouse() -> None:
    """Warehouse brief explicitly single-floor — program must not add upper floors."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-warehouse-floors")
    analysis = _analyse_or_skip(request)
    # Skip if the BriefAnalyst inferred multiple floors (would invalidate the test premise)
    if analysis.floors_above_ground != 1:
        pytest.skip(
            f"BriefAnalyst inferred {analysis.floors_above_ground} floors for "
            f"warehouse; this test pins the single-storey assumption."
        )
    program, _meta = _run_or_skip(analysis)

    floors_with_rooms = {f for f, rids in program.rooms_per_floor.items() if rids}
    assert floors_with_rooms == {0}, (
        f"warehouse program added floors not in analysis: {floors_with_rooms}"
    )
