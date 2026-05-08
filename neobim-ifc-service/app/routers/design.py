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

from app.services.design_agent import (
    DesignContext,
    DesignContextValidationError,
    LLMClient,
    classify_brief,
    extract_pdf_text,
    parse_design_request,
    run_brief_analyst,
    run_program_architect,
    vision_extract_pdf,
)
from app.services.design_agent.llm_client import (
    CircuitBreakerTripped,
    LLMAPIError,
    LLMRateLimited,
    LLMResponseValidationError,
    LLMUnavailableError,
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


__all__ = ["router"]
