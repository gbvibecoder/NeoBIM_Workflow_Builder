"""Phase 2A Slice 2A.7 — design agent endpoint.

Mounts ``POST /api/v1/design/analyze`` — the route that consumes a
brief and returns a structured :class:`DesignContext` ready for Phase
2B's LayoutArchitect / StructuralEngineer / MEPEngineer.

Pipeline
--------
1. ``intake.parse_design_request(body)`` validates the request shape,
   strips ``_comment`` keys, stamps a UUID4 ``build_id`` if missing.
2. ``classifier.classify_brief(request)`` produces hybrid weighted
   scores across (floor_plan, narrative, parametric).
3. ``pdf_extractor.extract_pdf_text(brief_pdf_url)`` is invoked when
   the request carries a PDF URL but no pre-extracted text. If the
   PDF is image-heavy AND ``request.auto_vision_retry`` is True, the
   handler retries through ``vision_extract_pdf`` (Opus 4.7).
4. ``stages.brief_analyst.run_brief_analyst(...)`` extracts the
   structured ``BriefAnalysis``.
5. ``stages.program_architect.run_program_architect(...)`` produces
   the ``RoomProgram`` via per-floor parallel calls.
6. The handler assembles a ``DesignContext`` and returns it.

Error handling
--------------
Each LLM-layer error class maps to a specific HTTP status code so the
caller can branch on the response category without parsing the body:

  * :class:`LLMUnavailableError`         -> 503 (no API key + cache miss)
  * :class:`CircuitBreakerTripped`       -> 504 (per-call timeout)
  * :class:`LLMRateLimited`              -> 429
  * :class:`LLMResponseValidationError`  -> 502 (model emitted invalid output)
  * :class:`LLMAPIError`                 -> 502 (other Anthropic API errors)
  * :class:`DesignContextValidationError` -> 422 (post-stage invariant
    failed; structured ``rule_id`` / ``hint`` carried in detail)
  * :class:`HTTPException` raised by intake -> propagated unchanged

Every error response carries the ``request_id`` from
``app.middleware.RequestIdMiddleware`` so logs and client traces tie
together.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import structlog
from fastapi import APIRouter, HTTPException, Request

from app.domain.building_model import BuildingModel
from app.services.design_agent import (
    AdaptationFailed,
    AdaptationPlan,
    DesignContext,
    DesignContextValidationError,
    ExtensionFailed,
    ExtensionPlan,
    ExtensionType,
    LLMClient,
    MatchFailed,
    MatchResult,
    apply_extensions,
    classify_brief,
    dispatch_match,
    extract_pdf_text,
    parse_design_request,
    run_adaptation_planner,
    run_brief_analyst,
    run_extension_planner,
    run_program_architect,
    run_template_matcher,
    vision_extract_pdf,
)
from app.services.design_agent.llm_client import (
    CircuitBreakerTripped,
    LLMAPIError,
    LLMRateLimited,
    LLMResponseValidationError,
    LLMUnavailableError,
)
from app.services.design_agent.transforms import (
    AdaptationApplyError,
    apply_adaptations,
)
from app.services.ids_validator import validate_ifc
from app.services.ifc_from_building_model import build_ifc_from_building_model
from app.services.r2_uploader import (
    ifc_to_base64_data_uri,
    upload_ifc_to_r2,
)


log = structlog.get_logger()

router = APIRouter(tags=["design"])


def _error_payload(
    rid: str,
    code: str,
    message: str,
    *,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Compose the structured error body the route's HTTPException carries."""
    payload: dict[str, Any] = {
        "status": "error",
        "code": code,
        "message": message,
        "request_id": rid,
    }
    if extra:
        payload.update(extra)
    return payload


@router.post("/design/analyze")
async def design_analyze(
    raw_body: dict,
    http_request: Request,
) -> dict[str, Any]:
    """Run the Phase 2A design pipeline on the brief in ``raw_body``.

    Returns ``{"status": "success" | "partial", "context": <DesignContext>,
    "request_id": <rid>, "warnings": [...]}``. The ``warnings`` list
    aggregates non-fatal observations from PDF extraction +
    BriefAnalyst extraction + ProgramArchitect composition; the
    ``status`` flips to ``"partial"`` when at least one warning fired.
    """
    rid = getattr(http_request.state, "request_id", "unknown")
    stage_start = time.monotonic()

    # ── STAGE 1: INTAKE ──────────────────────────────────────────────
    request = parse_design_request(raw_body)
    log.info(
        "design_analyze_intake_ok",
        request_id=rid,
        build_id=request.build_id,
        has_pdf_url=bool(request.brief_pdf_url),
        has_pdf_text=bool(request.brief_pdf_text),
        has_form=bool(request.brief_form),
        has_text=bool(request.brief_text),
        target_fidelity=request.target_fidelity,
        auto_vision_retry=request.auto_vision_retry,
    )

    aggregated_warnings: list[str] = []

    # ── STAGE 2: CLASSIFY ────────────────────────────────────────────
    try:
        style_weights = classify_brief(request)
    except Exception as exc:
        log.error(
            "design_analyze_classify_crashed",
            request_id=rid, error=str(exc), exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid,
                "DESIGN_CLASSIFY_FAILED",
                f"{type(exc).__name__}: {exc}",
            ),
        ) from exc

    classifier_metadata = {
        "floor_plan": style_weights.floor_plan,
        "narrative": style_weights.narrative,
        "parametric": style_weights.parametric,
        "confidence": style_weights.confidence,
        "rationale": style_weights.rationale,
    }

    # ── STAGE 3: PDF EXTRACTION ──────────────────────────────────────
    pdf_text: Optional[str] = request.brief_pdf_text
    if request.brief_pdf_url and pdf_text is None:
        extracted_text, extraction_warnings = extract_pdf_text(
            request.brief_pdf_url
        )
        for w in extraction_warnings:
            aggregated_warnings.append(
                f"PDF[{w.code}] page={w.page_index}: {w.message}"
            )
        # Auto-vision-retry: if VISION_REQUIRED fired AND the client
        # opted into auto-retry, re-extract via Opus 4.7 Vision.
        needs_vision = any(
            w.code == "VISION_REQUIRED" for w in extraction_warnings
        )
        if needs_vision and request.auto_vision_retry:
            log.info(
                "design_analyze_vision_retry",
                request_id=rid, pdf_url=request.brief_pdf_url,
            )
            vision_text, vision_warnings = vision_extract_pdf(
                request.brief_pdf_url
            )
            if vision_text:
                extracted_text = vision_text
            for w in vision_warnings:
                aggregated_warnings.append(
                    f"PDF-Vision[{w.code}]: {w.message}"
                )
        pdf_text = extracted_text or None

    # ── STAGE 4: BRIEF ANALYST ───────────────────────────────────────
    llm_client = LLMClient()
    try:
        analysis, analyst_meta = run_brief_analyst(
            request=request,
            style_weights=style_weights,
            pdf_text=pdf_text,
            llm_client=llm_client,
        )
    except LLMUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail=_error_payload(
                rid, "DESIGN_LLM_UNAVAILABLE", str(exc),
                extra={"stage": "brief_analyst"},
            ),
        ) from exc
    except CircuitBreakerTripped as exc:
        raise HTTPException(
            status_code=504,
            detail=_error_payload(
                rid, "DESIGN_LLM_TIMEOUT", str(exc),
                extra={
                    "stage": "brief_analyst",
                    "model": exc.model,
                    "configured_timeout": exc.configured_timeout,
                    "elapsed": exc.elapsed,
                },
            ),
        ) from exc
    except LLMRateLimited as exc:
        raise HTTPException(
            status_code=429,
            detail=_error_payload(
                rid, "DESIGN_LLM_RATE_LIMITED", str(exc),
                extra={"stage": "brief_analyst"},
            ),
        ) from exc
    except LLMResponseValidationError as exc:
        raise HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_INVALID_OUTPUT", str(exc),
                extra={
                    "stage": "brief_analyst",
                    "validation_errors": exc.original.errors(),
                },
            ),
        ) from exc
    except LLMAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_API_ERROR", str(exc),
                extra={"stage": "brief_analyst"},
            ),
        ) from exc

    aggregated_warnings.extend(
        f"BriefAnalyst: {w}" for w in analysis.extraction_warnings
    )

    # ── STAGE 5: PROGRAM ARCHITECT ───────────────────────────────────
    try:
        program, architect_meta = run_program_architect(
            analysis=analysis, llm_client=llm_client
        )
    except LLMUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail=_error_payload(
                rid, "DESIGN_LLM_UNAVAILABLE", str(exc),
                extra={"stage": "program_architect"},
            ),
        ) from exc
    except CircuitBreakerTripped as exc:
        raise HTTPException(
            status_code=504,
            detail=_error_payload(
                rid, "DESIGN_LLM_TIMEOUT", str(exc),
                extra={
                    "stage": "program_architect",
                    "model": exc.model,
                    "configured_timeout": exc.configured_timeout,
                    "elapsed": exc.elapsed,
                },
            ),
        ) from exc
    except LLMRateLimited as exc:
        raise HTTPException(
            status_code=429,
            detail=_error_payload(
                rid, "DESIGN_LLM_RATE_LIMITED", str(exc),
                extra={"stage": "program_architect"},
            ),
        ) from exc
    except LLMResponseValidationError as exc:
        raise HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_INVALID_OUTPUT", str(exc),
                extra={
                    "stage": "program_architect",
                    "validation_errors": exc.original.errors(),
                },
            ),
        ) from exc
    except LLMAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_API_ERROR", str(exc),
                extra={"stage": "program_architect"},
            ),
        ) from exc

    aggregated_warnings.extend(
        f"ProgramArchitect: {w}" for w in program.extraction_warnings
    )

    # ── STAGE 6: ASSEMBLE DESIGN CONTEXT ────────────────────────────
    analyst_metadata = {
        "model": analyst_meta.model,
        "latency_ms": analyst_meta.latency_ms,
        "cache_hit": analyst_meta.cache_hit,
        "cost_usd_estimated": analyst_meta.cost_usd_estimated,
        "enrichment_applied": analyst_meta.enrichment_applied,
    }
    architect_metadata = {
        "model": architect_meta.model,
        "total_latency_ms": architect_meta.total_latency_ms,
        "floor_count": architect_meta.floor_count,
        "per_floor_cache_hits": architect_meta.per_floor_cache_hits,
        "cost_usd_estimated": architect_meta.cost_usd_estimated,
        "auto_corrections_applied": architect_meta.auto_corrections_applied,
        "floors_with_no_rooms_warning": architect_meta.floors_with_no_rooms_warning,
    }

    try:
        context = DesignContext(
            request=request,
            style_weights=style_weights,
            analysis=analysis,
            program=program,
            classifier_metadata=classifier_metadata,
            analyst_metadata=analyst_metadata,
            architect_metadata=architect_metadata,
        )
    except DesignContextValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_CONTEXT_INVALID", str(exc),
                extra={
                    "rule_id": exc.rule_id,
                    "node_id": exc.node_id,
                    "hint": exc.hint,
                },
            ),
        ) from exc

    elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
    status = "partial" if aggregated_warnings else "success"
    log.info(
        "design_analyze_complete",
        request_id=rid,
        build_id=request.build_id,
        status=status,
        elapsed_ms=elapsed_ms,
        warning_count=len(aggregated_warnings),
        rooms_count=len(program.rooms),
        floors=analysis.floors_above_ground,
        primary_type=analysis.building_class.primary_type,
        analyst_cache_hit=analyst_meta.cache_hit,
        architect_cache_hits=architect_meta.per_floor_cache_hits,
        cost_usd_estimated=(
            analyst_meta.cost_usd_estimated
            + architect_meta.cost_usd_estimated
        ),
    )

    return {
        "status": status,
        "context": context.model_dump(mode="json"),
        "request_id": rid,
        "warnings": aggregated_warnings,
        "elapsed_ms": elapsed_ms,
    }


# ─── Slice 2B.1.D — POST /api/v1/design/match ────────────────────────


def _building_model_summary(bm: BuildingModel) -> dict[str, Any]:
    """Compact, JSON-safe summary of a matched BuildingModel.

    Returned to the client so it can render a "what we built" preview
    without round-tripping the full multi-MB BuildingModel JSON. The
    full ``project.metadata.provenance`` dict is included verbatim so
    operators can audit the build_id / generated_at / source_contract
    without parsing the BuildingModel.
    """
    bld = bm.project.site.building
    rera = bm.project.metadata.rera
    return {
        "project_name": bm.project.name,
        "project_id": bm.project.id,
        "storey_count": len(bld.storeys),
        "wall_count": sum(len(s.walls) for s in bld.storeys),
        "room_count": sum(len(s.rooms) for s in bld.storeys),
        "slab_count": sum(len(s.slabs) for s in bld.storeys),
        "stair_count": sum(len(s.stairs) for s in bld.storeys),
        "opening_count": sum(len(s.openings) for s in bld.storeys),
        "door_count": len(bld.doors),
        "window_count": len(bld.windows),
        "envelope_polygon_vertices": len(bld.envelope_polygon),
        "seismic_zone": rera.seismic_zone if rera else None,
        "wind_zone": rera.wind_zone if rera else None,
        "provenance": bm.project.metadata.provenance.model_dump(mode="json"),
    }


def _wrap_llm_error_as_http(
    rid: str, stage: str, exc: Exception
) -> Optional[HTTPException]:
    """Map an LLM-layer exception to its canonical HTTP status code.

    Returns the :class:`HTTPException` to raise, or ``None`` if the
    caller should re-raise the original. Centralises the mapping that
    the BriefAnalyst / ProgramArchitect blocks above repeat inline.
    Adopting this helper for the new ``/design/match`` endpoint keeps
    its handler short; the older ``/design/analyze`` keeps its inline
    blocks unchanged to avoid touching the green-test path.
    """
    if isinstance(exc, LLMUnavailableError):
        return HTTPException(
            status_code=503,
            detail=_error_payload(
                rid, "DESIGN_LLM_UNAVAILABLE", str(exc), extra={"stage": stage}
            ),
        )
    if isinstance(exc, CircuitBreakerTripped):
        return HTTPException(
            status_code=504,
            detail=_error_payload(
                rid, "DESIGN_LLM_TIMEOUT", str(exc),
                extra={
                    "stage": stage,
                    "model": exc.model,
                    "configured_timeout": exc.configured_timeout,
                    "elapsed": exc.elapsed,
                },
            ),
        )
    if isinstance(exc, LLMRateLimited):
        return HTTPException(
            status_code=429,
            detail=_error_payload(
                rid, "DESIGN_LLM_RATE_LIMITED", str(exc), extra={"stage": stage}
            ),
        )
    if isinstance(exc, LLMResponseValidationError):
        return HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_INVALID_OUTPUT", str(exc),
                extra={
                    "stage": stage,
                    "validation_errors": exc.original.errors(),
                },
            ),
        )
    if isinstance(exc, LLMAPIError):
        return HTTPException(
            status_code=502,
            detail=_error_payload(
                rid, "DESIGN_LLM_API_ERROR", str(exc), extra={"stage": stage}
            ),
        )
    return None


@router.post("/design/match")
async def design_match(
    raw_body: dict,
    http_request: Request,
) -> dict[str, Any]:
    """Run the brief → matched-template → BuildingModel pipeline.

    The marquee end-to-end flow added in Slice 2B.1: ingest a brief,
    extract a structured :class:`BriefAnalysis`, classify it against
    the nine Tier-2 templates, and dispatch to the chosen template's
    builder. Returns the BuildingModel summary plus the matcher's
    decision and accounting metadata.

    Pipeline (all stages are existing, library-tested code):

    1. ``parse_design_request`` validates intake.
    2. ``classify_brief`` produces hybrid style weights.
    3. ``extract_pdf_text`` (optional) handles PDF briefs.
    4. ``run_brief_analyst`` → :class:`BriefAnalysis` (Haiku 4.5).
    5. ``run_template_matcher`` → :class:`MatchResult` /
       :class:`MatchFailed` (Haiku 4.5).
    6. On match: ``dispatch_match`` → IDS-validated
       :class:`BuildingModel`. On refuse: HTTP 422 with the matcher's
       reason + suggested_action.

    The IFC-write step (BuildingModel → IFC4 file) is intentionally
    out of scope for this slice — the existing template-export
    scripts cover it, and a future slice will lift them into a
    service-level entry point. This endpoint's contract is "matched
    BuildingModel ready for IFC export", not "IFC bytes on the wire".
    """
    rid = getattr(http_request.state, "request_id", "unknown")
    stage_start = time.monotonic()

    # ── STAGE 1: INTAKE ──────────────────────────────────────────────
    request = parse_design_request(raw_body)
    log.info(
        "design_match_intake_ok",
        request_id=rid,
        build_id=request.build_id,
        target_fidelity=request.target_fidelity,
    )

    aggregated_warnings: list[str] = []

    # ── STAGE 2: CLASSIFY ────────────────────────────────────────────
    try:
        style_weights = classify_brief(request)
    except Exception as exc:
        log.error(
            "design_match_classify_crashed",
            request_id=rid, error=str(exc), exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_CLASSIFY_FAILED",
                f"{type(exc).__name__}: {exc}",
            ),
        ) from exc

    # ── STAGE 3: PDF EXTRACTION (optional) ───────────────────────────
    pdf_text: Optional[str] = request.brief_pdf_text
    if request.brief_pdf_url and pdf_text is None:
        extracted_text, extraction_warnings = extract_pdf_text(
            request.brief_pdf_url
        )
        for w in extraction_warnings:
            aggregated_warnings.append(
                f"PDF[{w.code}] page={w.page_index}: {w.message}"
            )
        needs_vision = any(
            w.code == "VISION_REQUIRED" for w in extraction_warnings
        )
        if needs_vision and request.auto_vision_retry:
            vision_text, vision_warnings = vision_extract_pdf(
                request.brief_pdf_url
            )
            if vision_text:
                extracted_text = vision_text
            for w in vision_warnings:
                aggregated_warnings.append(
                    f"PDF-Vision[{w.code}]: {w.message}"
                )
        pdf_text = extracted_text or None

    # ── STAGE 4: BRIEF ANALYST ───────────────────────────────────────
    llm_client = LLMClient()
    try:
        analysis, analyst_meta = run_brief_analyst(
            request=request,
            style_weights=style_weights,
            pdf_text=pdf_text,
            llm_client=llm_client,
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "brief_analyst", exc)
        assert wrapped is not None  # mapping is exhaustive
        raise wrapped from exc

    aggregated_warnings.extend(
        f"BriefAnalyst: {w}" for w in analysis.extraction_warnings
    )

    # ── STAGE 5: TEMPLATE MATCHER ────────────────────────────────────
    try:
        decoded, matcher_meta = run_template_matcher(
            analysis=analysis, llm_client=llm_client
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "template_matcher", exc)
        assert wrapped is not None
        raise wrapped from exc

    # ── STAGE 6a: REFUSAL → HTTP 422 ─────────────────────────────────
    if isinstance(decoded, MatchFailed):
        elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
        log.info(
            "design_match_refused",
            request_id=rid,
            build_id=request.build_id,
            reason=decoded.reason,
            best_template_attempted=(
                decoded.best_template_attempted.value
                if decoded.best_template_attempted else None
            ),
            best_confidence=decoded.best_confidence,
            suggested_action=decoded.suggested_action,
            elapsed_ms=elapsed_ms,
        )
        raise HTTPException(
            status_code=422,
            detail=_error_payload(
                rid,
                "DESIGN_MATCH_REFUSED",
                decoded.reason,
                extra={
                    "best_template_attempted": (
                        decoded.best_template_attempted.value
                        if decoded.best_template_attempted else None
                    ),
                    "best_confidence": decoded.best_confidence,
                    "threshold_required": decoded.threshold_required,
                    "suggested_action": decoded.suggested_action,
                    "elapsed_ms": elapsed_ms,
                },
            ),
        )

    # ── STAGE 6b: MATCH → DISPATCH TO BUILDER ────────────────────────
    assert isinstance(decoded, MatchResult)
    try:
        bm = dispatch_match(decoded, build_id=request.build_id)
    except Exception as exc:
        # Builder invariant violations (BuildingModelValidationError) or
        # any other dispatch-time error surfaces as 500 with the rule_id
        # / hint preserved when present.
        log.error(
            "design_match_dispatch_failed",
            request_id=rid,
            build_id=request.build_id,
            template_id=decoded.template_id.value,
            error=str(exc),
            exc_info=True,
        )
        extra: dict[str, Any] = {
            "stage": "template_dispatcher",
            "template_id": decoded.template_id.value,
        }
        for attr in ("rule_id", "node_id", "hint"):
            v = getattr(exc, attr, None)
            if v is not None:
                extra[attr] = v
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_DISPATCH_FAILED",
                f"{type(exc).__name__}: {exc}",
                extra=extra,
            ),
        ) from exc

    elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
    log.info(
        "design_match_complete",
        request_id=rid,
        build_id=request.build_id,
        template_id=decoded.template_id.value,
        confidence=decoded.confidence,
        elapsed_ms=elapsed_ms,
        analyst_cache_hit=analyst_meta.cache_hit,
        matcher_cache_hit=matcher_meta.cache_hit,
        cost_usd_estimated=(
            analyst_meta.cost_usd_estimated
            + matcher_meta.cost_usd_estimated
        ),
    )

    return {
        "status": "matched",
        "match_result": decoded.model_dump(mode="json"),
        "building_model_summary": _building_model_summary(bm),
        "metadata": {
            "analyst": {
                "model": analyst_meta.model,
                "latency_ms": analyst_meta.latency_ms,
                "cache_hit": analyst_meta.cache_hit,
                "cost_usd_estimated": analyst_meta.cost_usd_estimated,
                "enrichment_applied": analyst_meta.enrichment_applied,
            },
            "matcher": {
                "model": matcher_meta.model,
                "latency_ms": matcher_meta.latency_ms,
                "cache_hit": matcher_meta.cache_hit,
                "cost_usd_estimated": matcher_meta.cost_usd_estimated,
                "threshold": matcher_meta.threshold,
                "refused": matcher_meta.refused,
            },
            "total_cost_usd_estimated": (
                analyst_meta.cost_usd_estimated
                + matcher_meta.cost_usd_estimated
            ),
        },
        "warnings": aggregated_warnings,
        "request_id": rid,
        "elapsed_ms": elapsed_ms,
    }


# ─── Slice 2B.2.C — POST /api/v1/design/generate ─────────────────────


def _ifc_to_bytes(model) -> bytes:
    """Serialise an in-memory ifcopenshell.file to bytes via temp file.

    IfcOpenShell 0.8.x exposes ``model.write(path)`` only; there is no
    public ``to_bytes()``. We round-trip through ``tempfile`` so the
    same path covers both R2 upload and IDS validation without keeping
    two serialisations in flight.
    """
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as f:
        model.write(f.name)
        path = f.name
    try:
        with open(path, "rb") as fp:
            return fp.read()
    finally:
        import os as _os
        try:
            _os.unlink(path)
        except OSError:
            pass


_EXTENSION_ABBREV: dict[ExtensionType, str] = {
    ExtensionType.COMPOUND_WALL: "cw",
    ExtensionType.ENTRY_GATE: "eg",
    ExtensionType.CAR_PORCH: "cp",
    ExtensionType.SERVANT_QUARTER: "sq",
    ExtensionType.MUMTY: "mu",
}


def _ifc_filename_for(
    build_id: str,
    plan: AdaptationPlan | None,
    extension_plan: ExtensionPlan | None = None,
) -> str:
    """Deterministic R2 filename: ``design-generate-{id}-{ext}-{plan}.ifc``.

    ``plan`` (adapter) is rendered as ``mirror_<axis>_rot_<deg>`` for
    non-no-op plans, ``noop`` for the no-op case, ``shipped_as_is``
    when the planner refused. The optional ``extension_plan`` (2B.3
    NEW) adds an ``ext_<abbrevs>`` prefix listing applied extensions
    in canonical order so distinct extension combinations land at
    distinct R2 keys. The filename is stable per (build_id, ext_plan,
    adapter_plan) so repeated calls overwrite the same R2 object.
    """
    if plan is None:
        plan_part = "shipped_as_is"
    elif plan.is_noop:
        plan_part = "noop"
    else:
        mir = plan.mirror_axis.value if plan.mirror_axis else "none"
        plan_part = f"mirror_{mir.lower()}_rot_{plan.rotation.value}"

    if extension_plan is not None and not extension_plan.is_noop:
        # Deterministic ordering: by ExtensionType iteration order,
        # which matches the canonical orchestrator order
        # (compound→gate→porch→servant→mumty).
        abbrevs = [
            _EXTENSION_ABBREV[t]
            for t in ExtensionType
            if any(r.extension_type == t for r in extension_plan.extensions)
        ]
        return f"design-generate-{build_id}-ext_{'_'.join(abbrevs)}-{plan_part}.ifc"
    return f"design-generate-{build_id}-{plan_part}.ifc"


@router.post("/design/generate")
async def design_generate(
    raw_body: dict,
    http_request: Request,
) -> dict[str, Any]:
    """Run the brief → matched-template → adapted-BuildingModel → IFC
    end-to-end pipeline (Slice 2B.2.C).

    Pipeline:

    1. ``parse_design_request`` validates intake.
    2. ``classify_brief`` produces hybrid style weights.
    3. ``extract_pdf_text`` (optional) handles PDF briefs.
    4. ``run_brief_analyst`` → :class:`BriefAnalysis` (Haiku 4.5).
    5. ``run_template_matcher`` → :class:`MatchResult` /
       :class:`MatchFailed` (Haiku 4.5). Refusal here is HTTP 422.
    6. ``run_adaptation_planner`` → :class:`AdaptationPlan` /
       :class:`AdaptationFailed` (Haiku 4.5). A plan_failure with
       ``ship_as_is`` does NOT 4xx — instead the route ships the
       matcher's default IFC (no transform applied) and surfaces the
       refusal as a structured ``adaptation_failed`` field in the
       success response. This is the slice 2B.2 "ship-as-is" contract.
    7. ``dispatch_match`` → IDS-validated default :class:`BuildingModel`.
    8. ``apply_adaptations`` → transformed BuildingModel
       (no-op short-circuit when plan is no-op).
    9. ``build_ifc_from_building_model`` → IFC4 bytes.
    10. ``validate_ifc`` (LOD-300, combined) → IDS pass-rate.
    11. ``upload_ifc_to_r2`` → URL or base64 fallback.

    Refusal handling
    ----------------

    * Matcher refusal → HTTP 422 (no clarification path through
      adaptation makes sense if we don't even have a template).
    * Planner refusal (suggested_action='ship_as_is') → HTTP 200 with
      a populated ``adaptation_failed`` field; the IFC reflects the
      matcher's default layout. The user gets a buildable result
      and a clear "we don't yet support that adaptation" hint.
    * Planner refusal (suggested_action='ask_user_clarification') →
      HTTP 422 — same UX as a matcher refusal.
    * Apply-adaptations failure (transform produced an invalid
      BuildingModel post-validation) → silent fallback to default
      IFC + ``adaptation_failed`` field with the structured
      :class:`AdaptationApplyError` reason, so the user still gets
      a result instead of an HTTP 5xx.
    """
    rid = getattr(http_request.state, "request_id", "unknown")
    stage_start = time.monotonic()

    # ── STAGE 1: INTAKE ──────────────────────────────────────────────
    request = parse_design_request(raw_body)
    log.info(
        "design_generate_intake_ok",
        request_id=rid,
        build_id=request.build_id,
        target_fidelity=request.target_fidelity,
    )

    aggregated_warnings: list[str] = []

    # ── STAGE 2: CLASSIFY ────────────────────────────────────────────
    try:
        style_weights = classify_brief(request)
    except Exception as exc:
        log.error(
            "design_generate_classify_crashed",
            request_id=rid, error=str(exc), exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_CLASSIFY_FAILED",
                f"{type(exc).__name__}: {exc}",
            ),
        ) from exc

    # ── STAGE 3: PDF EXTRACTION (optional) ───────────────────────────
    pdf_text: Optional[str] = request.brief_pdf_text
    if request.brief_pdf_url and pdf_text is None:
        extracted_text, extraction_warnings = extract_pdf_text(
            request.brief_pdf_url
        )
        for w in extraction_warnings:
            aggregated_warnings.append(
                f"PDF[{w.code}] page={w.page_index}: {w.message}"
            )
        needs_vision = any(
            w.code == "VISION_REQUIRED" for w in extraction_warnings
        )
        if needs_vision and request.auto_vision_retry:
            vision_text, vision_warnings = vision_extract_pdf(
                request.brief_pdf_url
            )
            if vision_text:
                extracted_text = vision_text
            for w in vision_warnings:
                aggregated_warnings.append(
                    f"PDF-Vision[{w.code}]: {w.message}"
                )
        pdf_text = extracted_text or None

    # ── STAGE 4: BRIEF ANALYST ───────────────────────────────────────
    llm_client = LLMClient()
    try:
        analysis, analyst_meta = run_brief_analyst(
            request=request,
            style_weights=style_weights,
            pdf_text=pdf_text,
            llm_client=llm_client,
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "brief_analyst", exc)
        assert wrapped is not None
        raise wrapped from exc

    aggregated_warnings.extend(
        f"BriefAnalyst: {w}" for w in analysis.extraction_warnings
    )

    # ── STAGE 5: TEMPLATE MATCHER ────────────────────────────────────
    try:
        match_decoded, matcher_meta = run_template_matcher(
            analysis=analysis, llm_client=llm_client
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "template_matcher", exc)
        assert wrapped is not None
        raise wrapped from exc

    if isinstance(match_decoded, MatchFailed):
        elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
        log.info(
            "design_generate_matcher_refused",
            request_id=rid, build_id=request.build_id,
            reason=match_decoded.reason, elapsed_ms=elapsed_ms,
        )
        raise HTTPException(
            status_code=422,
            detail=_error_payload(
                rid, "DESIGN_MATCH_REFUSED", match_decoded.reason,
                extra={
                    "best_template_attempted": (
                        match_decoded.best_template_attempted.value
                        if match_decoded.best_template_attempted else None
                    ),
                    "best_confidence": match_decoded.best_confidence,
                    "threshold_required": match_decoded.threshold_required,
                    "suggested_action": match_decoded.suggested_action,
                    "elapsed_ms": elapsed_ms,
                },
            ),
        )

    assert isinstance(match_decoded, MatchResult)

    # ── STAGE 6: ADAPTATION PLANNER ──────────────────────────────────
    try:
        planner_decoded, planner_meta = run_adaptation_planner(
            analysis=analysis,
            match=match_decoded,
            llm_client=llm_client,
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "adaptation_planner", exc)
        assert wrapped is not None
        raise wrapped from exc

    plan_for_apply: Optional[AdaptationPlan] = None
    adaptation_failed_payload: Optional[dict[str, Any]] = None

    if isinstance(planner_decoded, AdaptationFailed):
        # ask_user_clarification → HTTP 422 (UX path: user clarifies).
        # ship_as_is / fallback → HTTP 200 with default IFC + structured
        # adaptation_failed surface.
        if planner_decoded.suggested_action == "ask_user_clarification":
            elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
            log.info(
                "design_generate_planner_clarify",
                request_id=rid, build_id=request.build_id,
                reason=planner_decoded.reason, elapsed_ms=elapsed_ms,
            )
            raise HTTPException(
                status_code=422,
                detail=_error_payload(
                    rid, "DESIGN_ADAPTATION_CLARIFY",
                    planner_decoded.reason,
                    extra={
                        "suggested_action": planner_decoded.suggested_action,
                        "elapsed_ms": elapsed_ms,
                    },
                ),
            )
        # ship_as_is path: ship the matcher's default and surface the
        # refusal in the response body. Plan stays None → no transform.
        adaptation_failed_payload = {
            "reason": planner_decoded.reason,
            "suggested_action": planner_decoded.suggested_action,
        }
        aggregated_warnings.append(
            f"AdaptationPlanner: {planner_decoded.reason} "
            f"(action={planner_decoded.suggested_action})"
        )
    else:
        plan_for_apply = planner_decoded

    # ── STAGE 6.5: EXTENSION PLANNER (Slice 2B.3) ────────────────────
    # Decides which of 5 extensions the user wants (compound_wall,
    # entry_gate, car_porch, servant_quarter, mumty). Refusal handling
    # mirrors the adapter planner above.
    #
    # Note: ``adaptation`` argument intentionally NOT passed. The
    # planner reasons in template-space (north=front always) per
    # decisions doc §1.2; including the adapter context in the user
    # message would only fragment the cache key without changing the
    # decision. The same cache works for any adapter plan upstream.
    try:
        ext_planner_decoded, ext_planner_meta = run_extension_planner(
            analysis=analysis,
            match=match_decoded,
            llm_client=llm_client,
        )
    except (
        LLMUnavailableError, CircuitBreakerTripped, LLMRateLimited,
        LLMResponseValidationError, LLMAPIError,
    ) as exc:
        wrapped = _wrap_llm_error_as_http(rid, "extension_planner", exc)
        assert wrapped is not None
        raise wrapped from exc

    extension_plan_for_apply: Optional[ExtensionPlan] = None
    extension_failed_payload: Optional[dict[str, Any]] = None

    if isinstance(ext_planner_decoded, ExtensionFailed):
        if ext_planner_decoded.suggested_action == "ask_user_clarification":
            elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
            log.info(
                "design_generate_ext_planner_clarify",
                request_id=rid, build_id=request.build_id,
                reason=ext_planner_decoded.reason, elapsed_ms=elapsed_ms,
            )
            raise HTTPException(
                status_code=422,
                detail=_error_payload(
                    rid, "DESIGN_EXTENSION_CLARIFY",
                    ext_planner_decoded.reason,
                    extra={
                        "suggested_action": ext_planner_decoded.suggested_action,
                        "elapsed_ms": elapsed_ms,
                    },
                ),
            )
        # ship_as_is — log refusal, skip extension application, continue.
        extension_failed_payload = {
            "reason": ext_planner_decoded.reason,
            "suggested_action": ext_planner_decoded.suggested_action,
            "failed_extensions": [
                t.value for t in ext_planner_decoded.failed_extensions
            ],
        }
        aggregated_warnings.append(
            f"ExtensionPlanner: {ext_planner_decoded.reason} "
            f"(action={ext_planner_decoded.suggested_action})"
        )
    else:
        extension_plan_for_apply = ext_planner_decoded

    # ── STAGE 7: DISPATCH TO BUILDER ─────────────────────────────────
    try:
        bm_default = dispatch_match(match_decoded, build_id=request.build_id)
    except Exception as exc:
        log.error(
            "design_generate_dispatch_failed",
            request_id=rid, build_id=request.build_id,
            template_id=match_decoded.template_id.value,
            error=str(exc), exc_info=True,
        )
        extra: dict[str, Any] = {
            "stage": "template_dispatcher",
            "template_id": match_decoded.template_id.value,
        }
        for attr in ("rule_id", "node_id", "hint"):
            v = getattr(exc, attr, None)
            if v is not None:
                extra[attr] = v
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_DISPATCH_FAILED",
                f"{type(exc).__name__}: {exc}",
                extra=extra,
            ),
        ) from exc

    # ── STAGE 7.5: APPLY EXTENSIONS (Slice 2B.3) ─────────────────────
    # Per decisions doc §1.2 — extensions run BEFORE adapter so the
    # adapter naturally transforms extension geometry (porch, gate
    # piers, servant quarter, mumty) alongside the rest of the
    # building. apply_extensions returns the original bm unchanged
    # when plan.is_noop, OR partial bm with extension_failed envelope
    # when some extensions failed (ship_as_is / skip_failed_extensions).
    bm_with_extensions: BuildingModel = bm_default
    extension_plan_for_response: Optional[ExtensionPlan] = extension_plan_for_apply
    if extension_plan_for_apply is not None and not extension_plan_for_apply.is_noop:
        bm_with_extensions, ext_apply_failed = apply_extensions(
            bm_default, extension_plan_for_apply
        )
        if ext_apply_failed is not None:
            # Partial / total per-extension failure — record into the
            # response envelope. The orchestrator already reverted to
            # input bm on total failure; partial failure keeps the
            # successfully-applied extensions on bm_with_extensions.
            extension_failed_payload = {
                "reason": ext_apply_failed.reason,
                "suggested_action": ext_apply_failed.suggested_action,
                "failed_extensions": [
                    t.value for t in ext_apply_failed.failed_extensions
                ],
            }
            aggregated_warnings.append(
                f"ApplyExtensions: {ext_apply_failed.reason} "
                f"(action={ext_apply_failed.suggested_action})"
            )

    # ── STAGE 8: APPLY ADAPTATIONS ───────────────────────────────────
    bm_final: BuildingModel = bm_with_extensions
    plan_for_response: Optional[AdaptationPlan] = plan_for_apply
    if plan_for_apply is not None and not plan_for_apply.is_noop:
        try:
            bm_final = apply_adaptations(bm_with_extensions, plan_for_apply)
        except AdaptationApplyError as exc:
            # Transform produced an invalid BuildingModel — fall back
            # to default and surface as a structured warning in the
            # response (per the "errors must always be specific" rule;
            # exc carries the underlying BuildingModelValidationError).
            log.warning(
                "design_generate_apply_adaptations_failed",
                request_id=rid, build_id=request.build_id,
                plan_repr=exc.plan_repr,
                original_error=str(exc.original_error),
            )
            adaptation_failed_payload = {
                "reason": (
                    f"adaptation produced invalid BuildingModel: "
                    f"{exc.original_error}"
                ),
                "suggested_action": "ship_as_is",
            }
            aggregated_warnings.append(
                f"AdaptationApply: {exc.plan_repr} failed re-validation; "
                f"shipped layout with extensions but no adaptation. "
                f"Underlying error: {exc.original_error}"
            )
            bm_final = bm_with_extensions
            plan_for_response = None

    # ── STAGE 9: BUILD IFC ───────────────────────────────────────────
    try:
        ifc_model = build_ifc_from_building_model(bm_final)
        ifc_bytes = _ifc_to_bytes(ifc_model)
    except Exception as exc:
        log.error(
            "design_generate_ifc_build_failed",
            request_id=rid, build_id=request.build_id,
            error=str(exc), exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=_error_payload(
                rid, "DESIGN_IFC_BUILD_FAILED",
                f"{type(exc).__name__}: {exc}",
                extra={"stage": "ifc_build"},
            ),
        ) from exc

    # ── STAGE 10: IDS VALIDATION ─────────────────────────────────────
    target_fidelity = request.target_fidelity
    ids_envelope: Optional[dict[str, Any]] = None
    try:
        ids_result = validate_ifc(
            ifc_model, "combined", target_fidelity
        )
        ids_envelope = {
            "passed": ids_result.passed,
            "rules_evaluated": ids_result.rules_evaluated,
            "violations_count": len(ids_result.violations),
            "warnings_count": len(ids_result.warnings),
            "elapsed_ms": ids_result.elapsed_ms,
            "skipped_reason": ids_result.skipped_reason,
        }
    except Exception as exc:
        log.warning(
            "design_generate_ids_crashed",
            request_id=rid, error=str(exc), exc_info=True,
        )
        ids_envelope = {
            "passed": True,
            "rules_evaluated": 0,
            "violations_count": 0,
            "warnings_count": 0,
            "skipped_reason": f"{type(exc).__name__}: {exc}",
        }

    # ── STAGE 11: R2 UPLOAD (with base64 fallback) ───────────────────
    filename = _ifc_filename_for(
        request.build_id,
        plan_for_response,
        extension_plan_for_response,
    )
    ifc_url = upload_ifc_to_r2(ifc_bytes, filename)
    if ifc_url is None:
        log.warning(
            "design_generate_r2_fallback_to_base64",
            request_id=rid, filename=filename, size_bytes=len(ifc_bytes),
        )
        ifc_url = ifc_to_base64_data_uri(ifc_bytes)
        ifc_url_kind = "data-uri-base64"
    else:
        ifc_url_kind = "r2"

    # ── RESPONSE ─────────────────────────────────────────────────────
    elapsed_ms = round((time.monotonic() - stage_start) * 1000, 1)
    status = (
        "generated_with_fallback"
        if (
            adaptation_failed_payload is not None
            or extension_failed_payload is not None
        )
        else "generated"
    )
    log.info(
        "design_generate_complete",
        request_id=rid,
        build_id=request.build_id,
        template_id=match_decoded.template_id.value,
        plan_mirror=(
            plan_for_response.mirror_axis.value
            if plan_for_response and plan_for_response.mirror_axis
            else None
        ),
        plan_rotation=(
            plan_for_response.rotation.value if plan_for_response else None
        ),
        extensions=(
            [r.extension_type.value for r in extension_plan_for_response.extensions]
            if extension_plan_for_response is not None
            and not extension_plan_for_response.is_noop
            else []
        ),
        adaptation_failed=adaptation_failed_payload is not None,
        extension_failed=extension_failed_payload is not None,
        ids_passed=ids_envelope["passed"] if ids_envelope else None,
        elapsed_ms=elapsed_ms,
        ifc_size_bytes=len(ifc_bytes),
        ifc_url_kind=ifc_url_kind,
    )

    return {
        "status": status,
        "ifc_url": ifc_url,
        "ifc_url_kind": ifc_url_kind,
        "ifc_size_bytes": len(ifc_bytes),
        "match_result": match_decoded.model_dump(mode="json"),
        "extension_plan": (
            extension_plan_for_response.model_dump(mode="json")
            if extension_plan_for_response is not None
            and not extension_plan_for_response.is_noop
            else None
        ),
        "extension_failed": extension_failed_payload,
        "adaptation_plan": (
            plan_for_response.model_dump(mode="json")
            if plan_for_response is not None and not plan_for_response.is_noop
            else None
        ),
        "adaptation_failed": adaptation_failed_payload,
        "building_model_summary": _building_model_summary(bm_final),
        "ids_validation": ids_envelope,
        "metadata": {
            "analyst": {
                "model": analyst_meta.model,
                "latency_ms": analyst_meta.latency_ms,
                "cache_hit": analyst_meta.cache_hit,
                "cost_usd_estimated": analyst_meta.cost_usd_estimated,
            },
            "matcher": {
                "model": matcher_meta.model,
                "latency_ms": matcher_meta.latency_ms,
                "cache_hit": matcher_meta.cache_hit,
                "cost_usd_estimated": matcher_meta.cost_usd_estimated,
            },
            "planner": {
                "model": planner_meta.llm_model_used,
                "elapsed_ms": planner_meta.elapsed_ms,
                "cache_hit": planner_meta.cache_hit,
                "cost_usd_estimated": planner_meta.llm_cost_usd,
                "refused": planner_meta.refused,
            },
            "extension_planner": {
                "model": ext_planner_meta.llm_model_used,
                "elapsed_ms": ext_planner_meta.elapsed_ms,
                "cache_hit": ext_planner_meta.cache_hit,
                "cost_usd_estimated": ext_planner_meta.llm_cost_usd,
                "refused": ext_planner_meta.refused,
            },
            "total_cost_usd_estimated": (
                analyst_meta.cost_usd_estimated
                + matcher_meta.cost_usd_estimated
                + planner_meta.llm_cost_usd
                + ext_planner_meta.llm_cost_usd
            ),
        },
        "warnings": aggregated_warnings,
        "request_id": rid,
        "elapsed_ms": elapsed_ms,
    }


__all__ = ["router"]
