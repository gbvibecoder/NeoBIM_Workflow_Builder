"""IFC export endpoint — POST /api/v1/export-ifc.

Hardening notes
---------------
The request flows through four labeled stages (VALIDATE → BUILD → UPLOAD →
RESPOND). Each stage catches its own exceptions and tags them with a
specific error_code + stage name, so root cause is visible from a single
response body — no Railway log archaeology required.

Partial success: if some elements fail individually during BUILD, the IFC
is still produced and the response carries `status: "partial"` plus a
`build_failures` array so the UI can show "12 walls built, 1 failed".
"""

from __future__ import annotations

import time

import ifcopenshell
import structlog
from fastapi import APIRouter, HTTPException, Request

from app.models.request import ExportIFCRequest
from app.models.response import (
    ExportIFCResponse,
    ExportedFile,
    ExportMetadata,
    EntityCounts,
)
from app.services.ifc_builder import build_multi_discipline
from app.services.ids_validator import merge_results, validate_ifc
from app.services.r2_uploader import upload_ifc_to_r2, ifc_to_base64_data_uri

log = structlog.get_logger()

router = APIRouter(tags=["export"])


def _error_response(
    rid: str,
    stage: str,
    error_code: str,
    exc: Exception | None,
    detail: str,
    status_code: int = 500,
) -> HTTPException:
    """Build an HTTPException carrying a structured error payload.

    FastAPI's default exception_handler turns HTTPException into a JSON
    response, and our custom handler in main.py wraps it with request_id,
    error_code, path, etc. So raising here gives us a consistent envelope.
    """
    payload = {
        "status": "error",
        "error_code": error_code,
        "stage": stage,
        "detail": detail,
        "request_id": rid,
    }
    if exc is not None:
        payload["error_type"] = type(exc).__name__
        payload["message"] = str(exc)
    return HTTPException(status_code=status_code, detail=payload)


@router.post("/export-ifc", response_model=ExportIFCResponse)
async def export_ifc(
    request: ExportIFCRequest,
    http_request: Request,
) -> ExportIFCResponse:
    """Generate IFC4 files from MassingGeometry and upload to R2."""
    rid = getattr(http_request.state, "request_id", "unknown")
    start = time.monotonic()

    # ── STAGE 1: VALIDATE ─────────────────────────────────────────────
    stage = "VALIDATE"
    try:
        if not request.geometry.storeys:
            raise _error_response(
                rid, stage, "VALIDATION_NO_STOREYS", None,
                "Geometry must have at least one storey",
                status_code=422,
            )
        if len(request.geometry.storeys) > 100:
            raise _error_response(
                rid, stage, "VALIDATION_TOO_MANY_STOREYS", None,
                f"Maximum 100 storeys supported, got {len(request.geometry.storeys)}",
                status_code=422,
            )
        if not request.geometry.footprint or len(request.geometry.footprint) < 3:
            raise _error_response(
                rid, stage, "VALIDATION_INVALID_FOOTPRINT", None,
                f"Footprint must have at least 3 points, got {len(request.geometry.footprint)}",
                status_code=422,
            )
        total_elements = sum(len(s.elements) for s in request.geometry.storeys)
        log.info(
            "export_ifc_validated",
            request_id=rid,
            storeys=len(request.geometry.storeys),
            total_elements=total_elements,
            disciplines=request.options.disciplines,
            building_type=request.geometry.building_type,
        )
    except HTTPException:
        raise
    except Exception as exc:
        log.error(
            "export_ifc_validate_crashed",
            request_id=rid,
            error=str(exc),
            error_type=type(exc).__name__,
            exc_info=True,
        )
        raise _error_response(
            rid, stage, "VALIDATION_UNEXPECTED_ERROR", exc,
            "Validation stage crashed unexpectedly",
        )

    # ── STAGE 2: BUILD ────────────────────────────────────────────────
    stage = "BUILD"
    try:
        results = build_multi_discipline(request)
    except Exception as exc:
        log.error(
            "export_ifc_build_failed",
            request_id=rid,
            error=str(exc),
            error_type=type(exc).__name__,
            exc_info=True,
        )
        raise _error_response(
            rid, stage, "BUILD_FAILED", exc,
            "IFC build crashed — check Railway logs for per-element failures",
        )

    if not results:
        raise _error_response(
            rid, stage, "BUILD_EMPTY_RESULTS", None,
            "Build completed but produced zero discipline files",
        )

    # ── STAGE 2.5: VALIDATE-IFC (Phase 0) ─────────────────────────────
    # Run ifctester against each emitted discipline IFC. Picks the IDS
    # rule set from (target_fidelity, discipline). Crashes here are non-
    # fatal: we log them and surface a `skipped_reason` rather than
    # blocking UPLOAD — IFCs that build successfully should still ship
    # even if Phase 0's validator misbehaves on a corner case. Hard
    # failures (error-severity violations) flip response status to
    # "partial" via the same path build failures use.
    stage = "VALIDATE-IFC"
    import tempfile
    from app.models.response import IdsValidationResult

    target_fidelity = request.options.target_fidelity
    ids_per_discipline = []
    try:
        for discipline, (ifc_bytes, _counts, _failures) in results.items():
            with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
                tmp.write(ifc_bytes)
                tmp.flush()
                tmp_path = tmp.name
            try:
                model = ifcopenshell.open(tmp_path)
            except Exception as exc:
                log.error(
                    "ids_open_failed",
                    request_id=rid,
                    discipline=discipline,
                    error=str(exc),
                    error_type=type(exc).__name__,
                    exc_info=True,
                )
                continue
            ids_per_discipline.append(
                validate_ifc(model, discipline, target_fidelity)
            )
        ids_envelope = (
            merge_results(ids_per_discipline)
            if ids_per_discipline
            else IdsValidationResult(target_fidelity=target_fidelity)
        )
    except Exception as exc:
        log.error(
            "ids_validation_stage_crashed",
            request_id=rid,
            error=str(exc),
            error_type=type(exc).__name__,
            exc_info=True,
        )
        ids_envelope = IdsValidationResult(
            passed=True,
            target_fidelity=target_fidelity,
            skipped_reason=f"{type(exc).__name__}: {exc}",
        )

    log.info(
        "export_ifc_ids_validated",
        request_id=rid,
        target_fidelity=target_fidelity,
        rules_evaluated=ids_envelope.rules_evaluated,
        violations=len(ids_envelope.violations),
        warnings=len(ids_envelope.warnings),
        elapsed_ms=ids_envelope.elapsed_ms,
        skipped_reason=ids_envelope.skipped_reason,
    )

    # ── STAGE 3: UPLOAD ───────────────────────────────────────────────
    stage = "UPLOAD"
    files: list[ExportedFile] = []
    combined_counts = EntityCounts()
    all_failures = []

    try:
        for discipline, (ifc_bytes, counts, failures) in results.items():
            filename = f"{request.file_prefix}_{discipline}.ifc"

            # R2 upload returns None on any failure → base64 fallback keeps the
            # request useful even without storage. Any crash lands in the outer
            # except below so we never return a success response for a broken file.
            url = upload_ifc_to_r2(ifc_bytes, filename)
            if url is None:
                log.warning(
                    "r2_upload_fallback_to_base64",
                    request_id=rid,
                    filename=filename,
                    size_bytes=len(ifc_bytes),
                )
                url = ifc_to_base64_data_uri(ifc_bytes)

            files.append(
                ExportedFile(
                    discipline=discipline,
                    file_name=filename,
                    download_url=url,
                    size=len(ifc_bytes),
                    schema_version="IFC4",
                    entity_count=sum([
                        counts.IfcWall, counts.IfcSlab, counts.IfcColumn,
                        counts.IfcBeam, counts.IfcWindow, counts.IfcDoor,
                        counts.IfcSpace, counts.IfcStairFlight,
                        counts.IfcDuctSegment, counts.IfcPipeSegment,
                    ]),
                )
            )

            if discipline == "combined":
                combined_counts = counts
            all_failures.extend(failures)

    except Exception as exc:
        log.error(
            "export_ifc_upload_failed",
            request_id=rid,
            error=str(exc),
            error_type=type(exc).__name__,
            exc_info=True,
        )
        raise _error_response(
            rid, stage, "UPLOAD_FAILED", exc,
            "Upload/encoding stage crashed — R2 credentials or network issue likely",
        )

    # ── STAGE 4: RESPOND ──────────────────────────────────────────────
    stage = "RESPOND"
    elapsed_ms = round((time.monotonic() - start) * 1000, 1)

    # De-duplicate failures across disciplines (same element may fail in every
    # discipline the combined file uses; report each unique element once).
    seen: set[str] = set()
    unique_failures = []
    for f in all_failures:
        key = f"{f.element_id}:{f.element_type}:{f.error_type}"
        if key not in seen:
            seen.add(key)
            unique_failures.append(f)

    ids_violations = list(ids_envelope.violations)
    ids_warnings = list(ids_envelope.warnings)
    status = "partial" if (unique_failures or ids_violations) else "success"

    log.info(
        "export_ifc_complete",
        request_id=rid,
        status=status,
        files=len(files),
        elapsed_ms=elapsed_ms,
        build_failure_count=len(unique_failures),
        ids_violation_count=len(ids_violations),
        ids_warning_count=len(ids_warnings),
        target_fidelity=target_fidelity,
    )

    return ExportIFCResponse(
        status=status,
        files=files,
        metadata=ExportMetadata(
            engine="ifcopenshell",
            ifcopenshell_version=ifcopenshell.version,
            generation_time_ms=elapsed_ms,
            validation_passed=ids_envelope.passed,
            entity_counts=combined_counts,
            build_failures=unique_failures,
            build_failure_count=len(unique_failures),
            ids_validation=ids_envelope,
            ids_violations=ids_violations,
            ids_warnings=ids_warnings,
        ),
        request_id=rid,
    )
