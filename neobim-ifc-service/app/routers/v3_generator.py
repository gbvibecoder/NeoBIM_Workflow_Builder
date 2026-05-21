"""POST /api/v3/generator/{exec,validate,summary,finalize}

Tool-execution endpoints for the Brief-to-IFC v3 generator agent loop.
Session-keyed via the `bf-session-id` header (or `session_id` in body —
header takes precedence). Sessions persist their `BuildFlowIFC` state
on disk between calls.

Auth: shared `ApiKeyMiddleware` (configured at the app level — every
request already needs `X-API-Key`). Network namespace is NOT applied
because the sandbox runs in-process with a whitelisted-imports gate —
no spawned subprocess.

Bootstrap order (Phase v3 completion §D6):
  * The FIRST `/exec` call for a session goes through
    `SessionStore.bootstrap_session(brief)`, which (a) constructs
    `BuildFlowIFC`, (b) materialises every space in `brief["spaces"]`,
    (c) writes `state.ifc` to disk BEFORE the agent code runs.
  * Consequence: `/summary` and `/validate` work on turn 1 even with
    `require_state=True` — the bootstrap has already populated the
    on-disk state. The previous "no session yet" stub on the agent
    side is therefore exercised only on a truly cold start (no brief
    submitted yet).

The router never re-raises: every failure is captured into a structured
response so the TypeScript agent driver can decide whether to retry or
surface to the user.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.ifc_generator_v3 import (
    BuildFlowIFC,
    BuildFlowIFCError,
    Sandbox,
    SessionStore,
    summarize_ifc_file,
    validate_ifc_file,
)
from app.services.r2_uploader import upload_ifc_to_r2, ifc_to_base64_data_uri

log = structlog.get_logger()

router = APIRouter(tags=["v3-generator"])

_store = SessionStore()


def _load_brief_from_handle(handle) -> Optional[Dict[str, Any]]:
    """Recover the brief from the session's `meta.json`.

    `BuildFlowIFC.save_state` always writes the brief alongside state.ifc;
    this helper exists so the brief-aware validators don't need the
    caller to thread the brief through every endpoint."""
    meta_path = os.path.join(handle.path, "meta.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="ascii") as f:
            meta = json.load(f)
        return meta.get("brief")
    except Exception:
        return None


# ── Request / response models ─────────────────────────────────────────


class ExecRequest(BaseModel):
    """Body for POST /v3/generator/exec.

    `brief` is REQUIRED on the first call (no session state on disk yet);
    IGNORED on subsequent calls in the same session. `code` is the agent-
    authored Python — runs with `bf` pre-bound to the session's
    `BuildFlowIFC`.
    """

    code: str = Field(..., min_length=1, max_length=200_000)
    brief: Optional[Dict[str, Any]] = None


class ExecResponse(BaseModel):
    session_id: str
    ok: bool
    stdout: str = ""
    stderr: str = ""
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    error_traceback: Optional[str] = None
    duration_ms: int = 0


class ValidateResponse(BaseModel):
    session_id: str
    schema_name: Optional[str] = None
    entity_count: int = 0
    refs_resolve: bool = False
    spaces_present: list = Field(default_factory=list)
    spaces_missing: list = Field(default_factory=list)
    errors: list = Field(default_factory=list)
    web_ifc_load_test: str = "FAIL"
    ascii_only: bool = False
    ascii_first_bad_offset: Optional[int] = None
    # Brief-aware visual validators (None when no brief on disk).
    world_bbox: Optional[Dict[str, Any]] = None
    space_polygons: Optional[list] = None
    element_coverage: Optional[Dict[str, Any]] = None
    origin_collapse: Optional[Dict[str, Any]] = None


class SummaryResponse(BaseModel):
    session_id: str
    summary: Dict[str, Any]


class FinalizeRequest(BaseModel):
    file_prefix: str = Field(default="ai-ifc-v3", max_length=128)


class FinalizeResponse(BaseModel):
    session_id: str
    ifc_url: str
    ifc_size_bytes: int
    entity_count: int
    validation: Dict[str, Any]
    # Phase δ.0 — BuildTelemetry payload assembled by BuildFlowIFC
    # during the session (proxy fallbacks, material misses, dropped
    # elements, built element-type counts). Always emitted as a dict
    # (empty when the session had no telemetry events); never `null`
    # so the TS client can rely on the field's presence.
    telemetry: Dict[str, Any] = Field(default_factory=dict)


def _load_telemetry_from_handle(handle) -> Dict[str, Any]:
    """Read the persisted BuildTelemetry blob from the session's
    `meta.json`. Returns an empty dict when the file is missing,
    malformed, or pre-δ.0 (no `telemetry` key). Never raises."""
    meta_path = os.path.join(handle.path, "meta.json")
    if not os.path.isfile(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="ascii") as f:
            meta = json.load(f)
        tel = meta.get("telemetry")
        if isinstance(tel, dict):
            return tel
    except Exception:
        # Swallow — telemetry transport never breaks finalize.
        pass
    return {}


# ── Helpers ──────────────────────────────────────────────────────────


def _resolve_session(
    bf_session_id: Optional[str],
    *,
    require_state: bool,
):
    """Resolve a session handle. If `require_state` is True and the
    session has no `state.ifc` on disk, raises a 409 — the caller is
    asking for a state-dependent op before any state exists."""
    handle = _store.get_or_create(bf_session_id)
    if require_state and not handle.has_state:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SESSION_NOT_INITIALISED",
                "message": (
                    f"session {handle.session_id} has no state on disk yet — "
                    "call /v3/generator/exec with a `brief` first."
                ),
            },
        )
    return handle


# ── Endpoints ─────────────────────────────────────────────────────────


@router.post("/exec", response_model=ExecResponse)
def exec_code(
    request: ExecRequest,
    http_request: Request,
    bf_session_id: Optional[str] = Header(None, alias="bf-session-id"),
) -> ExecResponse:
    rid = getattr(http_request.state, "request_id", "unknown")

    try:
        handle = _store.get_or_create(bf_session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={
            "code": "BAD_SESSION_ID", "message": str(exc),
        })

    # Acquire or build the BuildFlowIFC. Three cases:
    #   1. Session has state on disk → load.
    #   2. No state + brief provided in body → bootstrap_session
    #      (materialises spaces AND saves state pre-exec so `/summary`
    #      and `/validate` work on turn 1 — Phase v3 completion §D6).
    #   3. No state + no brief → 400, can't proceed.
    if handle.has_state:
        try:
            bf = BuildFlowIFC.load_state(handle.path)
        except Exception as exc:
            log.error(
                "v3_load_state_failed",
                request_id=rid, session_id=handle.session_id,
                error=str(exc), error_type=type(exc).__name__,
            )
            raise HTTPException(status_code=500, detail={
                "code": "STATE_LOAD_FAILED",
                "message": f"could not restore session state: {exc!r}",
            })
    else:
        if not request.brief:
            raise HTTPException(status_code=400, detail={
                "code": "MISSING_BRIEF",
                "message": (
                    "first exec call in a session must include a `brief` body "
                    "field to initialise BuildFlowIFC."
                ),
            })
        try:
            # `bootstrap_session` is the single source of truth for
            # session initialisation: it constructs BuildFlowIFC,
            # materialises every space declared in the brief, AND
            # writes `state.ifc` immediately. The handle returned has
            # `has_state == True` even if the agent never calls
            # `run_python`, so summary/validate work on turn 1.
            handle, bf = _store.bootstrap_session(
                request.brief, session_id=handle.session_id,
            )
        except Exception as exc:
            log.error(
                "v3_init_failed",
                request_id=rid, session_id=handle.session_id,
                error=str(exc), error_type=type(exc).__name__,
            )
            raise HTTPException(status_code=400, detail={
                "code": "BRIEF_INIT_FAILED",
                "message": f"BuildFlowIFC init failed: {exc!r}",
            })

    sandbox = Sandbox(bf)
    result = sandbox.execute(request.code)

    # Always save state, even on agent code failure — the file may have
    # been partially mutated and the agent's next turn can reason about
    # what stuck.
    try:
        bf.save_state(handle.path)
    except Exception as exc:
        log.error(
            "v3_save_state_failed",
            request_id=rid, session_id=handle.session_id,
            error=str(exc), error_type=type(exc).__name__,
        )

    log.info(
        "v3_exec",
        request_id=rid, session_id=handle.session_id,
        ok=result.ok, duration_ms=result.duration_ms,
        code_chars=len(request.code), error_type=result.error_type,
    )

    return ExecResponse(
        session_id=handle.session_id,
        ok=result.ok,
        stdout=result.stdout,
        stderr=result.stderr,
        error_type=result.error_type,
        error_message=result.error_message,
        error_traceback=result.error_traceback,
        duration_ms=result.duration_ms,
    )


@router.post("/validate", response_model=ValidateResponse)
def validate(
    http_request: Request,
    bf_session_id: Optional[str] = Header(None, alias="bf-session-id"),
) -> ValidateResponse:
    rid = getattr(http_request.state, "request_id", "unknown")
    handle = _resolve_session(bf_session_id, require_state=True)
    brief = _load_brief_from_handle(handle)
    result = validate_ifc_file(handle.state_ifc_path, brief=brief)
    log.info(
        "v3_validate",
        request_id=rid, session_id=handle.session_id,
        entity_count=result.get("entity_count"),
        refs_resolve=result.get("refs_resolve"),
        ascii_only=result.get("ascii_only"),
        world_bbox_verdict=(result.get("world_bbox") or {}).get("verdict"),
        origin_collapsed=(result.get("origin_collapse") or {}).get("collapsed"),
    )
    return ValidateResponse(
        session_id=handle.session_id,
        schema_name=result.get("schema"),
        entity_count=result.get("entity_count", 0),
        refs_resolve=result.get("refs_resolve", False),
        spaces_present=list(result.get("spaces_present", [])),
        spaces_missing=list(result.get("spaces_missing", [])),
        errors=list(result.get("errors", [])),
        web_ifc_load_test=result.get("web_ifc_load_test", "FAIL"),
        ascii_only=result.get("ascii_only", False),
        ascii_first_bad_offset=result.get("ascii_first_bad_offset"),
        world_bbox=result.get("world_bbox"),
        space_polygons=result.get("space_polygons"),
        element_coverage=result.get("element_coverage"),
        origin_collapse=result.get("origin_collapse"),
    )


@router.post("/summary", response_model=SummaryResponse)
def summary(
    http_request: Request,
    bf_session_id: Optional[str] = Header(None, alias="bf-session-id"),
) -> SummaryResponse:
    handle = _resolve_session(bf_session_id, require_state=True)
    return SummaryResponse(
        session_id=handle.session_id,
        summary=summarize_ifc_file(handle.state_ifc_path),
    )


@router.post("/finalize", response_model=FinalizeResponse)
def finalize(
    request: FinalizeRequest,
    http_request: Request,
    bf_session_id: Optional[str] = Header(None, alias="bf-session-id"),
) -> FinalizeResponse:
    rid = getattr(http_request.state, "request_id", "unknown")
    handle = _resolve_session(bf_session_id, require_state=True)

    # Validate one more time — finalize is the last gate. Brief-aware
    # visual checks gate this: world bbox must verdict OK, no
    # origin-collapse, otherwise the IFC is rejected with
    # VISUAL_GEOMETRY_INVALID so the agent can retry rather than ship a
    # broken file. (This is the safeguard for the 2026-05-16 visual
    # collapse — see forensics/diagnosis.md.)
    brief = _load_brief_from_handle(handle)
    validation = validate_ifc_file(handle.state_ifc_path, brief=brief)

    world_bbox = validation.get("world_bbox") or {}
    origin_collapse = validation.get("origin_collapse") or {}
    bbox_verdict = world_bbox.get("verdict")
    if brief is not None and bbox_verdict not in (None, "OK"):
        log.warning(
            "v3_finalize_refused_visual",
            request_id=rid, session_id=handle.session_id,
            world_bbox_verdict=bbox_verdict,
            actual_extent=world_bbox.get("actual_extent"),
            expected_extent=world_bbox.get("expected_extent"),
        )
        raise HTTPException(status_code=422, detail={
            "code": "VISUAL_GEOMETRY_INVALID",
            "message": (
                f"Geometric world-bbox verdict is {bbox_verdict!r}: "
                f"{world_bbox.get('suggested_unit_fix') or 'see validation.world_bbox for details'}"
            ),
            "validation": validation,
        })
    if origin_collapse.get("collapsed"):
        log.warning(
            "v3_finalize_refused_origin_collapse",
            request_id=rid, session_id=handle.session_id,
            fraction_at_origin=origin_collapse.get("fraction_at_origin"),
        )
        raise HTTPException(status_code=422, detail={
            "code": "VISUAL_GEOMETRY_INVALID",
            "message": (
                f"{origin_collapse.get('at_origin_count')} of "
                f"{origin_collapse.get('total_elements')} elements collapsed "
                "at world origin. Most elements need non-zero placements."
            ),
            "validation": validation,
        })

    # Upload to R2 (or fall back to a base64 data URI when R2 is
    # unconfigured — matches the Phase 1 sandbox's fallback so the
    # caller's contract stays consistent across environments).
    ifc_size = os.path.getsize(handle.state_ifc_path)
    safe_prefix = (request.file_prefix or "ai-ifc-v3").strip()
    filename = f"{safe_prefix}-{handle.session_id[:12]}.ifc"
    with open(handle.state_ifc_path, "rb") as f:
        ifc_bytes = f.read()
    url = upload_ifc_to_r2(ifc_bytes, filename)
    if url is None:
        url = ifc_to_base64_data_uri(ifc_bytes)
        log.warning(
            "v3_finalize_r2_fallback_base64",
            request_id=rid, session_id=handle.session_id, size_bytes=ifc_size,
        )

    log.info(
        "v3_finalize",
        request_id=rid, session_id=handle.session_id,
        entity_count=validation.get("entity_count"),
        ifc_size_bytes=ifc_size,
        refs_resolve=validation.get("refs_resolve"),
        ascii_only=validation.get("ascii_only"),
    )

    # δ.0 — load the BuildTelemetry blob BEFORE discarding the session
    # (discard wipes the on-disk meta.json). The blob is empty for
    # pre-δ.0 sessions, so this is backwards-compatible.
    telemetry_payload = _load_telemetry_from_handle(handle)

    # Discard the session — finalize is terminal.
    _store.discard(handle)

    return FinalizeResponse(
        session_id=handle.session_id,
        ifc_url=url,
        ifc_size_bytes=ifc_size,
        entity_count=validation.get("entity_count", 0),
        validation=validation,
        telemetry=telemetry_payload,
    )


@router.post("/gc")
def gc(http_request: Request) -> Dict[str, Any]:
    """Sweep stale sessions. Safe to expose — admin-bearing operation
    but only deletes files older than `SESSION_TTL_SECONDS`."""
    purged = _store.purge_stale()
    rid = getattr(http_request.state, "request_id", "unknown")
    log.info("v3_gc", request_id=rid, purged_count=len(purged))
    return {"purged_count": len(purged), "purged_ids": purged[:50]}
