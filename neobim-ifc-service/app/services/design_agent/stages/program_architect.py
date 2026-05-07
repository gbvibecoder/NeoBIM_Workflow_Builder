"""Phase 2A Slice 2A.6 — ProgramArchitect stage runner.

Stage 2 of the design agent: consumes a :class:`BriefAnalysis` and
produces a :class:`RoomProgram` that downstream Phase 2B agents
(LayoutArchitect, StructuralEngineer, MEPEngineer) can build a
floor plan from.

Flow
----
1. Build system prompt + user message (per-call, embeds the analysis
   so the prompt branches on building type / vastu / floor count).
2. Call Haiku 4.5 with a 10s wallclock ceiling.
3. **Recovery**: if the LLM emits a sub-NBC room area
   (ROOM_AREA_RESPECTS_NBC fires inside Pydantic), catch the
   :class:`LLMResponseValidationError`, auto-correct the offending
   rooms upward to the NBC minimum, append warnings, and re-validate.
   The recovery path keeps the agent resilient to occasional LLM
   slips without forcing a re-call (which would burn tokens for the
   same outcome).
4. **Floor coverage check**: if the LLM declared rooms only on a
   subset of ``analysis.floors_above_ground`` floors, append a
   warning naming the missed floors. (We do NOT auto-add empty
   floors — that would invent program scope; the warning lets the
   route handler decide whether to surface to the user.)

Determinism
-----------
Same as BriefAnalyst — the LLM call is cache-keyed, so once
committed the cache files reproduce the program byte-for-byte.
The auto-correction post-process is pure / deterministic given
the same LLM output.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from pydantic import ValidationError

from app.services.design_agent.llm_client import (
    LLMCallMetadata,
    LLMClient,
    LLMResponseValidationError,
)
from app.services.design_agent.prompts.program_architect import (
    build_program_architect_system_prompt,
    build_program_architect_user_message,
)
from app.services.design_agent.reference_data.nbc_india_minimums import (
    get_nbc_min_area_sqm,
)
from app.services.design_agent.types import (
    BriefAnalysis,
    DesignContextValidationError,
    RoomProgram,
)


_PROGRAM_ARCHITECT_TIMEOUT_S: float = 10.0


@dataclass(frozen=True)
class ProgramArchitectMetadata:
    """Per-stage accounting record. Same shape as BriefAnalystMetadata
    so Slice 2A.7 can sum the two records onto Pset_BuildFlow_Provenance
    without per-stage branching.
    """

    model: str
    latency_ms: float
    cache_hit: bool
    cost_usd_estimated: float
    auto_corrections_applied: int
    floors_with_no_rooms_warning: bool


def run_program_architect(
    analysis: BriefAnalysis,
    llm_client: LLMClient,
) -> tuple[RoomProgram, ProgramArchitectMetadata]:
    """Run the ProgramArchitect stage.

    Calls Haiku 4.5 (same model as BriefAnalyst, same 10-second
    ceiling). When the LLM emits a sub-NBC room area, the recovery
    path auto-corrects upward + appends a warning rather than
    re-calling the API.
    """
    system_prompt = build_program_architect_system_prompt(analysis)
    user_message = build_program_architect_user_message(analysis)

    auto_corrections = 0
    try:
        parsed, llm_metadata = llm_client.call(
            model="haiku-4.5",
            system_prompt=system_prompt,
            user_message=user_message,
            response_schema=RoomProgram,
            timeout_seconds=_PROGRAM_ARCHITECT_TIMEOUT_S,
            cache_shared_context=True,
        )
        assert isinstance(parsed, RoomProgram)
    except LLMResponseValidationError as exc:
        # Recovery — auto-correct the LLM's raw output, retry validation.
        # Only triggered for ROOM_AREA_RESPECTS_NBC (and adjacency-self-
        # reference) failures we know how to fix; other validation
        # errors propagate.
        recovered = _attempt_recovery(exc)
        if recovered is None:
            raise  # not a recoverable error — let caller surface
        parsed, auto_corrections = recovered
        # Synthesise metadata when recovery fires — the LLMClient never
        # got to write its accounting record because the call raised
        # before _build_metadata. We mark the call as a cache miss with
        # zero accounting; the route handler will see auto_corrections
        # > 0 and know recovery happened.
        llm_metadata = LLMCallMetadata(
            model="claude-haiku-4-5-20251001",
            input_tokens=0, output_tokens=0,
            cache_read_tokens=0, cache_creation_tokens=0,
            cost_usd_estimated=0.0,
            latency_ms=0.0,
            cache_hit=False,
            created_at_iso="",
        )

    floors_with_no_rooms = _check_floor_coverage(parsed, analysis)
    if floors_with_no_rooms:
        parsed = _append_warning(
            parsed,
            (
                f"ProgramArchitect declared rooms only on "
                f"{sorted(parsed.rooms_per_floor)}; floors "
                f"{sorted(floors_with_no_rooms)} carry no rooms despite "
                f"the analysis declaring {analysis.floors_above_ground} "
                f"floors above ground."
            ),
        )

    metadata = ProgramArchitectMetadata(
        model=llm_metadata.model,
        latency_ms=llm_metadata.latency_ms,
        cache_hit=llm_metadata.cache_hit,
        cost_usd_estimated=llm_metadata.cost_usd_estimated,
        auto_corrections_applied=auto_corrections,
        floors_with_no_rooms_warning=bool(floors_with_no_rooms),
    )
    return parsed, metadata


# ─── Recovery (auto-correction) ──────────────────────────────────────


def _attempt_recovery(
    exc: LLMResponseValidationError,
) -> Optional[tuple[RoomProgram, int]]:
    """Walk the LLM's raw tool input, auto-correct sub-NBC room areas,
    re-validate. Returns ``(corrected_program, count)`` on success, or
    ``None`` if the validation error is not auto-correctable.

    The recovery strategy:

    1. For each room in ``raw_input["rooms"]``, if
       ``target_area_sqm < nbc_min_area_sqm``, bump
       ``target_area_sqm`` up to ``nbc_min_area_sqm`` and append a
       warning to the program-level ``extraction_warnings``.
    2. For each room, if the stated ``nbc_min_area_sqm`` does not
       match :func:`get_nbc_min_area_sqm` for the usage, swap in the
       canonical value (the LLM may have written a number that's
       lower than the table; using the table is authoritative).
    3. Re-validate via :func:`RoomProgram.build`. If validation now
       passes, return the corrected program. If it fails again, the
       error was not just a sub-NBC issue; return None and let the
       original exception propagate.
    """
    raw = exc.raw_input
    if not isinstance(raw, dict):
        return None

    # Only attempt recovery if at least one error is a
    # ROOM_AREA_RESPECTS_NBC. Other validation failures need different
    # handling.
    is_area_error = any(
        getattr(err, "rule_id", None) == "ROOM_AREA_RESPECTS_NBC"
        if hasattr(err, "rule_id")
        else _is_area_error_dict(err)
        for err in exc.original.errors()
    )
    if not is_area_error:
        return None

    rooms = list(raw.get("rooms", []))
    new_rooms: list[dict[str, Any]] = []
    new_warnings: list[str] = list(raw.get("extraction_warnings", []))
    auto_corrections = 0

    for room in rooms:
        room = dict(room)
        usage = room.get("usage")
        canonical_min = get_nbc_min_area_sqm(usage) if isinstance(usage, str) else None
        target = float(room.get("target_area_sqm", 0))
        stated_min = float(room.get("nbc_min_area_sqm", 0))

        # Snap nbc_min_area_sqm to canonical table value if the LLM
        # wrote a smaller number (an honest copy-from-table is fine;
        # a smaller number is wrong).
        if canonical_min is not None and stated_min < canonical_min:
            room["nbc_min_area_sqm"] = canonical_min
            stated_min = canonical_min

        if target < stated_min:
            old = target
            room["target_area_sqm"] = stated_min
            auto_corrections += 1
            new_warnings.append(
                f"Auto-corrected room {room.get('id')!r} from "
                f"{old:.2f} sqm to NBC minimum {stated_min:.2f} sqm "
                f"(usage={usage!r})."
            )
        new_rooms.append(room)

    raw_corrected = dict(raw)
    raw_corrected["rooms"] = new_rooms
    raw_corrected["extraction_warnings"] = new_warnings

    try:
        program = RoomProgram.build(raw_corrected)
    except (ValidationError, DesignContextValidationError):
        return None

    return program, auto_corrections


def _is_area_error_dict(err: dict) -> bool:
    """Recognise a ROOM_AREA_RESPECTS_NBC error in Pydantic's error dict shape.

    Pydantic v2 wraps our DesignContextValidationError into a
    ``ValueError`` inside the model_validator and reports the wrapper's
    ctx with the original DesignContextValidationError instance.
    """
    ctx = err.get("ctx") or {}
    inner = ctx.get("error")
    if isinstance(inner, DesignContextValidationError):
        return inner.rule_id == "ROOM_AREA_RESPECTS_NBC"
    # Stringly-typed fallback for shapes Pydantic may have already
    # serialised to text.
    msg = err.get("msg", "")
    return "ROOM_AREA_RESPECTS_NBC" in msg


# ─── Floor coverage check ───────────────────────────────────────────


def _check_floor_coverage(
    program: RoomProgram, analysis: BriefAnalysis
) -> set[int]:
    """Return the set of floor indices the analysis declared but the
    program did NOT populate with any rooms. An empty set is the
    happy path (full coverage).

    Below-ground floors (``floors_below_ground > 0``) are NOT covered
    by this check — the analysis only counts above-ground; basement
    parking / utility levels are LayoutArchitect's responsibility.
    """
    expected = set(range(analysis.floors_above_ground))
    actual = {
        f for f, rids in program.rooms_per_floor.items() if rids
    }
    return expected - actual


def _append_warning(program: RoomProgram, message: str) -> RoomProgram:
    """Append a single string to the program's extraction_warnings.

    The Pydantic model is frozen, so we use model_copy with a fresh
    list rather than mutating in place.
    """
    new_warnings = list(program.extraction_warnings) + [message]
    return program.model_copy(update={"extraction_warnings": new_warnings})


__all__ = [
    "run_program_architect",
    "ProgramArchitectMetadata",
]
