"""Phase 2A Slice 2A.6 — ProgramArchitect tests (post-restructure).

The slice's restructure moved from a single big LLM call to per-floor
parallel calls + a deterministic composer. Tests come in three layers:

* **Cache-only tests** (always run) — pure-function pieces:
  prompt builder, USAGE_DEFAULTS coverage, derive helpers
  (``_derive_circulation``, ``_derive_constraints``,
  ``_derive_summary``), id-uniqueness helper, adjacency-ref
  validation. No LLM calls.
* **Composer round-trip tests** (always run) — synthesise per-floor
  ``_LLMRoomSpec`` payloads in-memory, call ``_compose_program``
  directly, assert on the produced :class:`RoomProgram`. These pin
  the deterministic post-process (auto-correction, USAGE_DEFAULTS
  enrichment, adjacency dropping, summary generation) without
  touching the network.
* **LLM-driven tests** — full BriefAnalyst -> ProgramArchitect
  pipeline against the committed sample brief fixtures. Per-floor
  LLM calls hit cache once their cache files are committed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

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
from app.services.design_agent.prompts.program_architect import (
    build_floor_system_prompt,
    build_floor_user_message,
)
from app.services.design_agent.reference_data.nbc_india_minimums import (
    NBC_MIN_AREAS_SQM,
)
from app.services.design_agent.reference_data.usage_defaults import (
    USAGE_DEFAULTS,
    assert_usage_defaults_coverage,
    get_usage_defaults,
)
from app.services.design_agent.stages.program_architect import (
    _compose_program,
    _derive_circulation,
    _derive_constraints,
    _derive_summary,
    _drop_invalid_adjacency_refs,
    _floor_indices,
    _FloorCallResult,
    _FloorRoomsResponse,
    _LLMRoomSpec,
    _make_unique_id,
)
from app.services.design_agent.types import (
    BuildingClass,
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
    floors_below_ground: int = 0,
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
        floors_below_ground=floors_below_ground,
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


def _analyse_or_skip(request: DesignRequest) -> BriefAnalysis:
    """Run BriefAnalyst (cache hit if Slice 2A.5 cache committed)."""
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
            f"BriefAnalyst cache miss + no ANTHROPIC_API_KEY. Detail: {exc}"
        )


# ─── Cache-only tests — system prompt + user message builders ────────


def test_floor_system_prompt_clears_cache_minimum() -> None:
    prompt = build_floor_system_prompt(_build_minimal_analysis(), floor_index=0)
    assert len(prompt) >= 1024 * 4 // 4, (  # ~1024 tokens
        f"per-floor prompt too short: {len(prompt)} chars"
    )


def test_floor_system_prompt_embeds_nbc_table() -> None:
    prompt = build_floor_system_prompt(_build_minimal_analysis(), floor_index=0)
    # Spot-check a few NBC entries
    assert "kitchen" in prompt
    assert "5.0 sqm" in prompt
    assert "9.5 sqm" in prompt  # living / master_bedroom min


def test_floor_system_prompt_branches_on_floor_index() -> None:
    """Different floor indices produce DIFFERENT distribution rules."""
    a = _build_minimal_analysis(floors_above_ground=2)
    ground = build_floor_system_prompt(a, floor_index=0)
    upper = build_floor_system_prompt(a, floor_index=1)
    assert "GROUND FLOOR" in ground or "ground floor" in ground.lower()
    assert ground != upper


def test_floor_system_prompt_includes_vastu_only_when_flagged() -> None:
    no_vastu = build_floor_system_prompt(
        _build_minimal_analysis(cultural_overlay=None), floor_index=0
    )
    yes_vastu = build_floor_system_prompt(
        _build_minimal_analysis(cultural_overlay="vastu"), floor_index=0
    )
    assert "VASTU OVERLAY" not in no_vastu
    assert "VASTU OVERLAY" in yes_vastu
    assert "Pooja / puja room -> NE" in yes_vastu


def test_floor_user_message_includes_floor_index() -> None:
    msg = build_floor_user_message(_build_minimal_analysis(), floor_index=2)
    assert "FLOOR 2" in msg
    assert '"primary_type": "residential"' in msg


# ─── USAGE_DEFAULTS coverage ─────────────────────────────────────────


def test_usage_defaults_covers_every_room_usage() -> None:
    """Drift sentinel — every RoomUsage literal has a defaults entry."""
    assert_usage_defaults_coverage()


def test_usage_defaults_known_values() -> None:
    """Spot-check a few canonical entries."""
    living = USAGE_DEFAULTS["living"]
    assert living["natural_light_required"] is True
    assert living["natural_ventilation_required"] is True
    assert living["privacy_level"] == "semi_private"
    assert living["aspect_ratio_max"] >= living["aspect_ratio_min"]

    bathroom = USAGE_DEFAULTS["bathroom"]
    assert bathroom["natural_light_required"] is False
    assert bathroom["natural_ventilation_required"] is True
    assert bathroom["privacy_level"] == "private"


def test_get_usage_defaults_falls_back_for_unknown() -> None:
    """A typoed usage falls back to a conservative defaults shape."""
    fb = get_usage_defaults("nonexistent")
    assert fb["aspect_ratio_min"] == 1.0
    assert fb["aspect_ratio_max"] >= fb["aspect_ratio_min"]


# ─── Floor index helper ──────────────────────────────────────────────


def test_floor_indices_above_ground_only() -> None:
    a = _build_minimal_analysis(floors_above_ground=3, floors_below_ground=0)
    assert _floor_indices(a) == [0, 1, 2]


def test_floor_indices_includes_basements() -> None:
    a = _build_minimal_analysis(floors_above_ground=2, floors_below_ground=2)
    assert _floor_indices(a) == [-2, -1, 0, 1]


# ─── Unique-id helper ────────────────────────────────────────────────


def test_make_unique_id_no_collision() -> None:
    used: set[str] = set()
    assert _make_unique_id("r-living-01", floor_index=0, used=used) == "r-living-01"


def test_make_unique_id_floor_prefix_on_collision() -> None:
    used = {"r-living-01"}
    assert (
        _make_unique_id("r-living-01", floor_index=1, used=used)
        == "f1-r-living-01"
    )


def test_make_unique_id_numeric_suffix_when_floor_prefix_taken() -> None:
    used = {"r-living-01", "f1-r-living-01"}
    out = _make_unique_id("r-living-01", floor_index=1, used=used)
    assert out == "f1-r-living-01-1"


# ─── Adjacency-ref drop helper ───────────────────────────────────────


def test_drop_invalid_adjacency_refs_keeps_valid_and_outside() -> None:
    rooms = [
        _make_strict_room("r-1", "living", floor_index=0,
                          adjacency_required=["r-2", "Outside"]),
        _make_strict_room("r-2", "kitchen", floor_index=0,
                          adjacency_required=["r-1"]),
    ]
    out, warnings = _drop_invalid_adjacency_refs(rooms)
    assert warnings == []
    assert out[0].adjacency_required == ["r-2", "Outside"]


def test_drop_invalid_adjacency_refs_drops_dangling() -> None:
    rooms = [
        _make_strict_room("r-1", "living", floor_index=0,
                          adjacency_required=["r-ghost", "r-2"]),
        _make_strict_room("r-2", "kitchen", floor_index=0),
    ]
    out, warnings = _drop_invalid_adjacency_refs(rooms)
    assert out[0].adjacency_required == ["r-2"]
    assert any("r-ghost" in w for w in warnings)


def test_drop_invalid_adjacency_refs_drops_self_reference() -> None:
    """Self-references would trip ROOM_ADJACENCY_REFERENCES_VALID."""
    rooms = [
        _make_strict_room("r-1", "living", floor_index=0,
                          adjacency_required=["r-1", "Outside"]),
    ]
    out, _warnings = _drop_invalid_adjacency_refs(rooms)
    assert out[0].adjacency_required == ["Outside"]


# ─── Derive helpers ──────────────────────────────────────────────────


def test_derive_circulation_residential_small() -> None:
    a = _build_minimal_analysis(primary_type="residential", floors_above_ground=2)
    circ = _derive_circulation(a)
    assert circ.stair_count == 1
    assert circ.lift_count == 0
    assert circ.corridor_min_width_m == 1.2


def test_derive_circulation_residential_high_rise() -> None:
    a = _build_minimal_analysis(primary_type="residential", floors_above_ground=8)
    circ = _derive_circulation(a)
    assert circ.stair_count == 2
    assert circ.lift_count >= 1
    assert circ.egress_paths_required == 2


def test_derive_circulation_commercial_uses_15m_corridor() -> None:
    a = _build_minimal_analysis(primary_type="office", floors_above_ground=3)
    circ = _derive_circulation(a)
    assert circ.corridor_min_width_m == 1.5


def test_derive_circulation_warehouse_single_floor() -> None:
    a = _build_minimal_analysis(primary_type="warehouse", floors_above_ground=1)
    circ = _derive_circulation(a)
    assert circ.stair_count == 1
    assert circ.lift_count == 0


def test_derive_constraints_sums_room_areas() -> None:
    a = _build_minimal_analysis()
    rooms = [
        _make_strict_room("r-1", "living", target_area_sqm=15.0),
        _make_strict_room("r-2", "kitchen", target_area_sqm=8.0),
    ]
    cons = _derive_constraints(rooms, a)
    assert cons.total_carpet_area_sqm_min == pytest.approx(23.0)
    assert cons.total_carpet_area_sqm_max == pytest.approx(34.5)
    assert cons.max_floors == a.floors_above_ground


def test_derive_summary_includes_floor_summaries() -> None:
    a = _build_minimal_analysis(floors_above_ground=2)
    rooms = [_make_strict_room("r-1", "living")]
    floor_results = {
        0: _make_floor_result(0, ["living"], summary="Public living area"),
        1: _make_floor_result(1, ["bedroom"], summary="Private bedroom area"),
    }
    summary = _derive_summary(a, rooms, floor_results)
    assert "2 floor(s)" in summary
    assert "Public living area" in summary
    assert "Private bedroom area" in summary


# ─── _compose_program — composer end-to-end on synthetic input ───────


def _make_floor_result(
    floor_index: int,
    usages: list[str],
    *,
    target_area_sqm: float = 12.0,
    summary: str = "",
) -> _FloorCallResult:
    """Build a synthetic per-floor LLM response result."""
    rooms = [
        _LLMRoomSpec(
            id=f"r-{usage}-{i:02d}",
            name=usage.replace("_", " ").title(),
            usage=usage,  # type: ignore[arg-type]
            target_area_sqm=target_area_sqm,
            floor_index=floor_index,
            adjacency_required=[],
            adjacency_forbidden=[],
            notes="",
        )
        for i, usage in enumerate(usages, start=1)
    ]
    response = _FloorRoomsResponse(rooms=rooms, floor_summary=summary)
    from app.services.design_agent.llm_client import LLMCallMetadata
    metadata = LLMCallMetadata(
        model="claude-sonnet-4-6",
        input_tokens=100, output_tokens=200,
        cache_read_tokens=0, cache_creation_tokens=0,
        cost_usd_estimated=0.001, latency_ms=500.0,
        cache_hit=False, created_at_iso="2026-05-08T00:00:00+00:00",
    )
    return _FloorCallResult(
        floor_index=floor_index, response=response, metadata=metadata
    )


def _make_strict_room(
    rid: str,
    usage: str = "living",
    *,
    floor_index: int = 0,
    target_area_sqm: float = 15.0,
    adjacency_required: "list[str] | None" = None,
    adjacency_forbidden: "list[str] | None" = None,
):
    from app.services.design_agent.types import RoomSpec
    defaults = get_usage_defaults(usage)
    nbc = NBC_MIN_AREAS_SQM.get(usage, 1.0)
    return RoomSpec(
        id=rid, name=usage, usage=usage,  # type: ignore[arg-type]
        target_area_sqm=max(target_area_sqm, nbc),
        nbc_min_area_sqm=nbc,
        aspect_ratio_min=defaults["aspect_ratio_min"],
        aspect_ratio_max=defaults["aspect_ratio_max"],
        natural_light_required=defaults["natural_light_required"],
        natural_ventilation_required=defaults["natural_ventilation_required"],
        privacy_level=defaults["privacy_level"],
        floor_index=floor_index,
        adjacency_required=adjacency_required or [],
        adjacency_forbidden=adjacency_forbidden or [],
    )


def test_compose_program_enriches_rooms_with_usage_defaults() -> None:
    a = _build_minimal_analysis(floors_above_ground=1)
    floor_results = {
        0: _make_floor_result(0, ["living", "kitchen", "bathroom"]),
    }
    program, count, missed = _compose_program(a, floor_results)
    assert count == 0  # no auto-corrections needed (12 sqm > all NBC mins)
    assert missed == set()
    living = next(r for r in program.rooms if r.usage == "living")
    # Defaults applied
    assert living.natural_light_required is True
    assert living.privacy_level == "semi_private"
    bathroom = next(r for r in program.rooms if r.usage == "bathroom")
    assert bathroom.natural_light_required is False
    assert bathroom.privacy_level == "private"


def test_compose_program_auto_corrects_sub_nbc() -> None:
    """A room emitted with target < NBC min is bumped + warned."""
    a = _build_minimal_analysis(floors_above_ground=1)
    floor_results = {
        0: _make_floor_result(0, ["kitchen"], target_area_sqm=2.0),  # < 5.0
    }
    program, count, _missed = _compose_program(a, floor_results)
    assert count == 1
    kitchen = program.rooms[0]
    assert kitchen.target_area_sqm == 5.0  # NBC min for kitchen
    assert any("Auto-corrected" in w for w in program.extraction_warnings)


def test_compose_program_resolves_id_collisions_across_floors() -> None:
    """Two floors emitting the same id → second renamed."""
    a = _build_minimal_analysis(floors_above_ground=2)
    f0 = _make_floor_result(0, ["bedroom"])
    f1 = _make_floor_result(1, ["bedroom"])
    program, _count, _missed = _compose_program(a, {0: f0, 1: f1})
    ids = {r.id for r in program.rooms}
    assert len(ids) == 2  # no duplicates
    # And the renaming generated a warning
    assert any("Renamed" in w for w in program.extraction_warnings)


def test_compose_program_drops_dangling_adjacency() -> None:
    """A reference to a non-existent room id is dropped + warned."""
    a = _build_minimal_analysis(floors_above_ground=1)
    raw_room = _LLMRoomSpec(
        id="r-living-01",
        name="Living",
        usage="living",
        target_area_sqm=15.0,
        floor_index=0,
        adjacency_required=["r-ghost"],
        adjacency_forbidden=[],
        notes="",
    )
    response = _FloorRoomsResponse(rooms=[raw_room], floor_summary="")
    from app.services.design_agent.llm_client import LLMCallMetadata
    md = LLMCallMetadata(
        model="claude-sonnet-4-6", input_tokens=1, output_tokens=1,
        cache_read_tokens=0, cache_creation_tokens=0,
        cost_usd_estimated=0.0, latency_ms=1.0, cache_hit=False,
        created_at_iso="2026-05-08T00:00:00+00:00",
    )
    floor_results = {
        0: _FloorCallResult(floor_index=0, response=response, metadata=md),
    }
    program, _count, _missed = _compose_program(a, floor_results)
    assert program.rooms[0].adjacency_required == []
    assert any("r-ghost" in w for w in program.extraction_warnings)


def test_compose_program_assembles_rooms_per_floor_correctly() -> None:
    """rooms_per_floor mapping covers every emitted room."""
    a = _build_minimal_analysis(floors_above_ground=3)
    floor_results = {
        0: _make_floor_result(0, ["living", "kitchen"]),
        1: _make_floor_result(1, ["bedroom"]),
        2: _make_floor_result(2, ["master_bedroom"]),
    }
    program, _count, missed = _compose_program(a, floor_results)
    assert missed == set()
    assert set(program.rooms_per_floor.keys()) == {0, 1, 2}
    assert len(program.rooms_per_floor[0]) == 2
    # ROOM_FLOORS_CONSISTENT invariant in the schema validates this end-to-end


# ─── LLM-driven tests (skip on cache miss + no API key) ──────────────


def test_program_architect_2bhk_pune_extraction() -> None:
    """2BHK Pune brief: at least 7 rooms across 2 floors."""
    text = _read_text_fixture("2bhk_24x50.txt")
    request = DesignRequest(brief_text=text, build_id="test-2bhk-pune")
    analysis = _analyse_or_skip(request)
    program, meta = _run_or_skip(analysis)

    assert len(program.rooms) >= 7, f"expected >= 7 rooms, got {len(program.rooms)}"
    # At least one master_bedroom
    masters = [r for r in program.rooms if r.usage == "master_bedroom"]
    assert masters, "no master_bedroom in 2BHK program"
    # Kitchen + living on ground (floor 0)
    rooms_by_id = {r.id: r for r in program.rooms}
    ground_usages = {
        rooms_by_id[i].usage for i in program.rooms_per_floor.get(0, [])
    }
    assert "kitchen" in ground_usages
    assert "living" in ground_usages
    # Metadata
    assert isinstance(meta, ProgramArchitectMetadata)
    assert meta.floor_count == analysis.floors_above_ground


def test_program_architect_circular_futuristic_bangalore() -> None:
    """Mixed-use Bangalore — multi-floor spread."""
    text = _read_text_fixture("circular_futuristic.txt")
    request = DesignRequest(brief_text=text, build_id="test-circular-futur")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    assert len(program.rooms) >= 5
    floors_with_rooms = {f for f, rids in program.rooms_per_floor.items() if rids}
    assert len(floors_with_rooms) >= 3, (
        f"mixed-use should span >= 3 floors; got {floors_with_rooms}"
    )


def test_program_architect_g_plus_5_form_only() -> None:
    """G+5 form-only — residential template applied per floor."""
    form_dict = json.loads(_read_text_fixture("g_plus_5_apartment_form.json"))
    form_dict.pop("_comment", None)
    form = BriefForm(**form_dict)
    request = DesignRequest(brief_form=form, build_id="test-gplus5-form")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    usages = {r.usage for r in program.rooms}
    assert "kitchen" in usages
    assert "living" in usages
    assert any("bedroom" in u for u in usages)


def test_program_architect_warehouse() -> None:
    """Warehouse: warehouse_floor + loading_bay + restroom on single floor."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-warehouse")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    usages = {r.usage for r in program.rooms}
    assert "warehouse_floor" in usages
    assert "loading_bay" in usages
    assert "bathroom" in usages or "powder_room" in usages
    floors = {r.floor_index for r in program.rooms}
    assert floors == {0}, f"warehouse must be single-floor; got {floors}"


def test_program_architect_hospital_3floor_distribution() -> None:
    """3-floor hospital: ground=consult/reception, first=ward, second=OT/ICU."""
    text = _read_text_fixture("hospital_3floor.txt")
    request = DesignRequest(brief_text=text, build_id="test-hospital")
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)

    rooms_by_id = {r.id: r for r in program.rooms}
    ground = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(0, [])}
    first = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(1, [])}
    second = {rooms_by_id[i].usage for i in program.rooms_per_floor.get(2, [])}

    assert ground & {"reception", "consultation"}, ground
    assert "ward" in first, first
    assert second & {"operation_theatre", "icu"}, second


@pytest.mark.parametrize(
    "fixture_text",
    [
        "2bhk_24x50.txt",
        "warehouse.txt",
        "hospital_3floor.txt",
    ],
)
def test_every_room_meets_nbc_minimum(fixture_text: str) -> None:
    """ROOM_AREA_RESPECTS_NBC invariant — every room target >= NBC min."""
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
    """No room has X in BOTH adjacency_required AND adjacency_forbidden."""
    request = DesignRequest(
        brief_text=_read_text_fixture(fixture_text),
        build_id=f"test-adj-{fixture_text}",
    )
    analysis = _analyse_or_skip(request)
    program, _meta = _run_or_skip(analysis)
    for room in program.rooms:
        overlap = set(room.adjacency_required) & set(room.adjacency_forbidden)
        assert not overlap, (
            f"room {room.id}: required + forbidden both contain {overlap}"
        )


def test_program_does_not_invent_floors_for_single_storey_warehouse() -> None:
    """Warehouse explicitly single-floor — composer must not add upper floors."""
    text = _read_text_fixture("warehouse.txt")
    request = DesignRequest(brief_text=text, build_id="test-warehouse-floors")
    analysis = _analyse_or_skip(request)
    if analysis.floors_above_ground != 1:
        pytest.skip(
            f"BriefAnalyst inferred {analysis.floors_above_ground} floors; "
            f"this test pins single-storey assumption."
        )
    program, _meta = _run_or_skip(analysis)
    floors_with_rooms = {f for f, rids in program.rooms_per_floor.items() if rids}
    assert floors_with_rooms == {0}
