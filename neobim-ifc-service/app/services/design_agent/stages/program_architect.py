"""Phase 2A Slice 2A.6 (post-restructure) — ProgramArchitect stage.

Per-floor parallel architecture
-------------------------------
Stage 2 of the design agent consumes a :class:`BriefAnalysis` (output
of Slice 2A.5) and produces a :class:`RoomProgram` for downstream
Phase 2B agents (LayoutArchitect, StructuralEngineer, MEPEngineer).

The Slice 2A.6 first-attempt architecture (one big LLM call returning
the whole RoomProgram) hit two compounding walls on multi-floor briefs:

  * the response exceeded the 4096-token output cap on Haiku, then
    Sonnet, with truncation;
  * even after raising the cap to 16384, large outputs (~10K tokens)
    needed 60-125s of wallclock generation time — beyond every
    reasonable per-call ceiling.

The restructure splits the work across floors: ONE LLM call per floor,
all calls dispatched in parallel through a thread pool. Each per-floor
output is small (~5 rooms × ~150 tokens = ~1500 tokens) and finishes
in 10-25s. The end-to-end wallclock is ``max(per-floor calls)``,
typically ~20-30s regardless of building size.

Slim LLM schema
---------------
The per-floor LLM call returns only the fields the model actually
decides:

    id, name, usage, target_area_sqm, floor_index,
    adjacency_required, adjacency_forbidden, notes

The composer enriches each emission with deterministic post-process
fields drawn from the room's ``usage`` literal:

  * :data:`reference_data.USAGE_DEFAULTS` supplies aspect-ratio bounds,
    natural-light / ventilation flags, and privacy level.
  * :func:`reference_data.get_nbc_min_area_sqm` supplies the NBC India
    minimum carpet area, and the composer auto-corrects any sub-NBC
    target_area_sqm upward (with a warning).

Output assembly
---------------
The composer also derives the program-level fields:

  * :class:`CirculationSpec` from
    (primary_type, floors_above_ground): residential <= 4 floors get
    1 stair / 0 lifts / 1 egress / 1.2m corridor; residential 5+
    get 2 stairs / 1 lift / 2 egress; commercial / institutional get
    2 stairs / 1+ lifts / 2 egress / 1.5m corridor.
  * :class:`ProgramConstraints` from sum-of-room-areas and the
    analysis's setbacks / max_floors.
  * ``summary`` — 1-line auto-generated description plus the
    per-floor summaries the LLM returned.

Determinism
-----------
Each per-floor call is independently cache-keyed (different prompts
per floor), so committed cache files reproduce the program byte-for-
byte. Composer logic is pure / deterministic given the same per-floor
LLM outputs.
"""

from __future__ import annotations

import concurrent.futures
import logging
from dataclasses import dataclass
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.design_agent.llm_client import (
    LLMCallMetadata,
    LLMClient,
)
from app.services.design_agent.prompts.program_architect import (
    build_floor_system_prompt,
    build_floor_user_message,
)
from app.services.design_agent.reference_data.nbc_india_minimums import (
    DEFAULT_RERA_RATIOS,
    get_nbc_min_area_sqm,
)
from app.services.design_agent.reference_data.usage_defaults import (
    get_usage_defaults,
)
from app.services.design_agent.types import (
    BriefAnalysis,
    CirculationSpec,
    ProgramConstraints,
    RoomProgram,
    RoomSpec,
    RoomUsage,
)


log = logging.getLogger(__name__)

# Per-floor LLM call budget. Sized to fit the smaller per-floor output
# comfortably below the LLMClient's per-model ceiling — we never use
# the full ceiling, but the 30s budget accommodates the rare slow call.
_FLOOR_CALL_TIMEOUT_S: float = 30.0

# Maximum number of floor-LLM calls dispatched concurrently. Buildings
# beyond this cap (e.g. 20-floor towers) sequence in batches; the
# overall wallclock is still ``max(call) × ceil(total / max_workers)``.
_MAX_PARALLEL_FLOORS: int = 8


# ─── Per-floor LLM response schema (internal) ───────────────────────


class _LLMRoomSpec(BaseModel):
    """Slim per-floor RoomSpec for the LLM emission.

    Excludes the 5 derived fields that are filled from
    :data:`USAGE_DEFAULTS` and :data:`NBC_MIN_AREAS_SQM`. The composer
    transforms each instance into a strict :class:`RoomSpec` post-call.
    """

    model_config = ConfigDict(frozen=True)
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    usage: RoomUsage
    target_area_sqm: float = Field(gt=0)
    floor_index: int = Field(ge=-10, le=50)
    adjacency_required: list[str] = Field(default_factory=list)
    adjacency_forbidden: list[str] = Field(default_factory=list)
    notes: str = ""


class _FloorRoomsResponse(BaseModel):
    """The Pydantic schema each per-floor LLM call validates against."""

    model_config = ConfigDict(frozen=True)
    rooms: list[_LLMRoomSpec] = Field(min_length=1)
    floor_summary: str = ""


# ─── Public stage metadata ──────────────────────────────────────────


@dataclass(frozen=True)
class ProgramArchitectMetadata:
    """Per-stage accounting record. Aggregates across all per-floor
    LLM calls so the route handler in Slice 2A.7 can stamp a single
    cost / latency figure onto Pset_BuildFlow_Provenance.
    """

    model: str
    total_latency_ms: float
    floor_count: int
    per_floor_cache_hits: int
    cost_usd_estimated: float
    auto_corrections_applied: int
    floors_with_no_rooms_warning: bool


# ─── Public entry point ──────────────────────────────────────────────


def run_program_architect(
    analysis: BriefAnalysis,
    llm_client: LLMClient,
) -> tuple[RoomProgram, ProgramArchitectMetadata]:
    """Run ProgramArchitect via per-floor parallel LLM calls + composer.

    The orchestration:

    1. Compute the floor index list spanning
       [-floors_below_ground, floors_above_ground - 1].
    2. Dispatch one LLM call per floor through a ThreadPoolExecutor
       (Python's GIL releases on I/O so the calls genuinely run
       concurrently; thread-based is simpler than async refactor of
       the SDK call path).
    3. Collect per-floor responses + per-call metadata.
    4. Compose the strict :class:`RoomProgram`: enrich each emitted
       _LLMRoomSpec with USAGE_DEFAULTS + NBC minimum, auto-correct
       sub-NBC areas, build rooms_per_floor, derive
       CirculationSpec / ProgramConstraints / summary.
    """
    floors = _floor_indices(analysis)
    if not floors:
        # Defensive — schema requires floors_above_ground >= 1.
        raise ValueError(
            f"BriefAnalysis declares no floors above ground: "
            f"{analysis.floors_above_ground}"
        )

    floor_results = _dispatch_floor_calls(analysis, floors, llm_client)

    program, auto_corrections, missed_floors = _compose_program(
        analysis, floor_results
    )

    metadata = _build_stage_metadata(
        floor_results=floor_results,
        floor_count=len(floors),
        auto_corrections=auto_corrections,
        floors_missing=bool(missed_floors),
    )
    return program, metadata


# ─── Floor indices ──────────────────────────────────────────────────


def _floor_indices(analysis: BriefAnalysis) -> list[int]:
    """Compute every floor index this stage must produce rooms for.

    Above-ground floors run 0..N-1. Below-ground (basement) levels
    run -1..-M for an analysis declaring M basements; we include
    them so parking / utility spaces are part of the program.
    """
    above = list(range(0, analysis.floors_above_ground))
    below = list(range(-analysis.floors_below_ground, 0))
    return below + above


# ─── Dispatch ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class _FloorCallResult:
    """Per-floor call outcome captured for the composer + metadata
    aggregator."""

    floor_index: int
    response: _FloorRoomsResponse
    metadata: LLMCallMetadata


def _dispatch_floor_calls(
    analysis: BriefAnalysis,
    floors: list[int],
    llm_client: LLMClient,
) -> dict[int, _FloorCallResult]:
    """Run one LLM call per floor in parallel through a thread pool.

    Per-floor exceptions propagate (the route handler treats the
    whole stage as failed). LLMUnavailableError on any floor is the
    canonical "no API key + no cache" signal — letting it propagate
    means the route handler returns 503 with the cache key surfaced,
    same as the BriefAnalyst stage does.
    """
    max_workers = min(len(floors), _MAX_PARALLEL_FLOORS)
    results: dict[int, _FloorCallResult] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        future_to_floor = {
            ex.submit(_call_one_floor, analysis, f, llm_client): f
            for f in floors
        }
        for fut in concurrent.futures.as_completed(future_to_floor):
            floor = future_to_floor[fut]
            results[floor] = fut.result()

    return results


def _call_one_floor(
    analysis: BriefAnalysis,
    floor_index: int,
    llm_client: LLMClient,
) -> _FloorCallResult:
    """Build prompt + user message for one floor, call the LLM, parse."""
    system_prompt = build_floor_system_prompt(analysis, floor_index)
    user_message = build_floor_user_message(analysis, floor_index)

    parsed, llm_metadata = llm_client.call(
        model="sonnet-4.6",
        system_prompt=system_prompt,
        user_message=user_message,
        response_schema=_FloorRoomsResponse,
        timeout_seconds=_FLOOR_CALL_TIMEOUT_S,
        cache_shared_context=True,
    )
    assert isinstance(parsed, _FloorRoomsResponse)
    return _FloorCallResult(
        floor_index=floor_index,
        response=parsed,
        metadata=llm_metadata,
    )


# ─── Composition ────────────────────────────────────────────────────


def _compose_program(
    analysis: BriefAnalysis,
    floor_results: dict[int, _FloorCallResult],
) -> tuple[RoomProgram, int, set[int]]:
    """Assemble the strict :class:`RoomProgram` from per-floor results.

    Returns ``(program, auto_corrections_count, floors_missing_rooms_set)``.
    """
    warnings: list[str] = []
    auto_corrections = 0
    used_ids: set[str] = set()

    rooms: list[RoomSpec] = []
    rooms_per_floor: dict[int, list[str]] = {}

    for floor_index in sorted(floor_results):
        result = floor_results[floor_index]
        floor_room_ids: list[str] = []

        for raw in result.response.rooms:
            # Snap floor_index to the call's floor (defensive: the LLM
            # may have echoed the wrong number).
            unique_id = _make_unique_id(raw.id, floor_index, used_ids)
            used_ids.add(unique_id)
            if unique_id != raw.id:
                warnings.append(
                    f"Renamed room id {raw.id!r} -> {unique_id!r} to "
                    f"resolve cross-floor collision."
                )

            usage = raw.usage
            defaults = get_usage_defaults(usage)
            nbc_min = get_nbc_min_area_sqm(usage)
            target = float(raw.target_area_sqm)
            if target < nbc_min:
                warnings.append(
                    f"Auto-corrected room {unique_id!r} from "
                    f"{target:.2f} sqm to NBC minimum {nbc_min:.2f} sqm "
                    f"(usage={usage!r})."
                )
                target = nbc_min
                auto_corrections += 1

            full_room = RoomSpec(
                id=unique_id,
                name=raw.name,
                usage=usage,
                target_area_sqm=target,
                nbc_min_area_sqm=nbc_min,
                aspect_ratio_min=defaults["aspect_ratio_min"],
                aspect_ratio_max=defaults["aspect_ratio_max"],
                natural_light_required=defaults["natural_light_required"],
                natural_ventilation_required=defaults[
                    "natural_ventilation_required"
                ],
                privacy_level=defaults["privacy_level"],
                floor_index=floor_index,
                adjacency_required=list(raw.adjacency_required),
                adjacency_forbidden=list(raw.adjacency_forbidden),
                notes=raw.notes,
            )
            rooms.append(full_room)
            floor_room_ids.append(full_room.id)

        rooms_per_floor[floor_index] = floor_room_ids

    # Validate adjacency refs — drop any that don't resolve to
    # another room id in the final program OR to "Outside". This is
    # essential because per-floor LLM calls never see other floors'
    # ids; a referenced room may not exist in the final program.
    rooms, drop_warnings = _drop_invalid_adjacency_refs(rooms)
    warnings.extend(drop_warnings)

    # Floors with no rooms — defensive sentinel; shouldn't fire if
    # _FloorRoomsResponse(min_length=1) holds.
    expected_floors = set(_floor_indices(analysis))
    missed = {
        f for f in expected_floors if not rooms_per_floor.get(f)
    }
    if missed:
        warnings.append(
            f"Floors {sorted(missed)} produced no rooms; downstream "
            f"stages may need to backfill placeholder spaces."
        )

    circulation = _derive_circulation(analysis)
    constraints = _derive_constraints(rooms, analysis)
    summary = _derive_summary(analysis, rooms, floor_results)

    program = RoomProgram(
        rooms=rooms,
        rooms_per_floor=rooms_per_floor,
        circulation=circulation,
        constraints=constraints,
        summary=summary,
        extraction_warnings=warnings,
    )
    return program, auto_corrections, missed


def _make_unique_id(
    raw_id: str, floor_index: int, used: set[str]
) -> str:
    """Return a unique room id, prefixing with the floor index when
    a raw collision occurs."""
    if raw_id not in used:
        return raw_id
    candidate = f"f{floor_index}-{raw_id}"
    if candidate not in used:
        return candidate
    n = 1
    while f"{candidate}-{n}" in used:
        n += 1
    return f"{candidate}-{n}"


def _drop_invalid_adjacency_refs(
    rooms: list[RoomSpec],
) -> tuple[list[RoomSpec], list[str]]:
    """Remove adjacency references that don't resolve to another room
    id in the program OR the literal ``"Outside"``.

    Per-floor LLM calls only see THIS floor's ids; cross-floor refs
    don't survive into the final program. Dropping is safer than
    failing the whole stage.
    """
    valid = {r.id for r in rooms} | {"Outside"}
    out: list[RoomSpec] = []
    warnings: list[str] = []
    for r in rooms:
        # Drop self-references too (the schema's
        # ROOM_ADJACENCY_REFERENCES_VALID rejects them).
        new_required = [
            a for a in r.adjacency_required if a in valid and a != r.id
        ]
        new_forbidden = [
            a for a in r.adjacency_forbidden if a in valid and a != r.id
        ]
        dropped_required = set(r.adjacency_required) - set(new_required)
        dropped_forbidden = set(r.adjacency_forbidden) - set(new_forbidden)
        if dropped_required:
            warnings.append(
                f"Dropped invalid adjacency_required entries "
                f"{sorted(dropped_required)} from room {r.id!r}."
            )
        if dropped_forbidden:
            warnings.append(
                f"Dropped invalid adjacency_forbidden entries "
                f"{sorted(dropped_forbidden)} from room {r.id!r}."
            )
        out.append(
            r.model_copy(
                update={
                    "adjacency_required": new_required,
                    "adjacency_forbidden": new_forbidden,
                }
            )
        )
    return out, warnings


def _derive_circulation(analysis: BriefAnalysis) -> CirculationSpec:
    """Compute :class:`CirculationSpec` from analysis (no LLM)."""
    primary = analysis.building_class.primary_type
    floors = analysis.floors_above_ground
    is_residential = primary in {"residential"}
    is_commercial = primary in {
        "office", "retail", "hospital", "school", "hotel",
        "warehouse", "mixed_use",
    }

    if is_residential and floors <= 4:
        stair_count = 1
        lift_count = 0
        egress = 1
    elif is_residential:
        stair_count = 2
        lift_count = 1 if floors <= 6 else 2
        egress = 2
    elif is_commercial:
        stair_count = 1 if floors == 1 else 2
        if floors >= 4:
            lift_count = 2 if floors >= 6 else 1
        else:
            lift_count = 0
        egress = 1 if floors == 1 else 2
    else:
        # primary_type=="unknown" — minimal valid circulation.
        stair_count = 1
        lift_count = 0
        egress = 1

    corridor_width = 1.5 if is_commercial else 1.2
    return CirculationSpec(
        corridor_min_width_m=corridor_width,
        stair_count=stair_count,
        lift_count=lift_count,
        egress_paths_required=egress,
    )


def _derive_constraints(
    rooms: list[RoomSpec], analysis: BriefAnalysis
) -> ProgramConstraints:
    """Compute :class:`ProgramConstraints` from rooms + analysis."""
    total_min = sum(r.target_area_sqm for r in rooms)
    if total_min <= 0:
        # Defensive — schema requires gt=0; warehouse_floor alone is
        # ~50 sqm so we should be safely above zero in any real case.
        total_min = 1.0
    total_max = total_min * 1.5
    return ProgramConstraints(
        total_carpet_area_sqm_min=total_min,
        total_carpet_area_sqm_max=total_max,
        rera_carpet_built_super_ratio=DEFAULT_RERA_RATIOS,
        setbacks_m=analysis.site_context.setbacks_m or {},
        max_floors=analysis.floors_above_ground,
    )


def _derive_summary(
    analysis: BriefAnalysis,
    rooms: list[RoomSpec],
    floor_results: dict[int, _FloorCallResult],
) -> str:
    """Compose a 1-line program summary from analysis + per-floor
    summaries."""
    parts: list[str] = [
        f"{analysis.building_class.sub_type} ({analysis.building_class.primary_type})",
        f"{analysis.floors_above_ground} floor(s) above ground",
    ]
    if analysis.floors_below_ground:
        parts.append(f"{analysis.floors_below_ground} basement(s)")
    parts.append(f"{len(rooms)} rooms total")
    floor_lines = []
    for f in sorted(floor_results):
        s = floor_results[f].response.floor_summary.strip()
        if s:
            floor_lines.append(f"floor {f}: {s}")
    summary = "; ".join(parts) + "."
    if floor_lines:
        summary += " " + " | ".join(floor_lines)
    return summary


# ─── Metadata aggregation ───────────────────────────────────────────


def _build_stage_metadata(
    *,
    floor_results: dict[int, _FloorCallResult],
    floor_count: int,
    auto_corrections: int,
    floors_missing: bool,
) -> ProgramArchitectMetadata:
    """Aggregate per-floor LLM metadata into a single stage record."""
    if not floor_results:
        return ProgramArchitectMetadata(
            model="claude-sonnet-4-6",
            total_latency_ms=0.0,
            floor_count=floor_count,
            per_floor_cache_hits=0,
            cost_usd_estimated=0.0,
            auto_corrections_applied=auto_corrections,
            floors_with_no_rooms_warning=floors_missing,
        )
    total_latency = sum(r.metadata.latency_ms for r in floor_results.values())
    cache_hits = sum(1 for r in floor_results.values() if r.metadata.cache_hit)
    cost = sum(r.metadata.cost_usd_estimated for r in floor_results.values())
    # All per-floor calls use the same model; sample any.
    sample = next(iter(floor_results.values()))
    return ProgramArchitectMetadata(
        model=sample.metadata.model,
        total_latency_ms=total_latency,
        floor_count=floor_count,
        per_floor_cache_hits=cache_hits,
        cost_usd_estimated=cost,
        auto_corrections_applied=auto_corrections,
        floors_with_no_rooms_warning=floors_missing,
    )


__all__ = [
    "run_program_architect",
    "ProgramArchitectMetadata",
]
