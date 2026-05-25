"""POST /kos/parse-drawing — DXF drawing parser (Week 5C-1, Phase 1).

Accepts a customer DXF via multipart/form-data, runs the vector-only
wall + title-block + classifier pipeline, and returns a rich JSON report
including downstream-readiness flags (BOQ / formwork / shop drawings) and an
honest ``missing_data`` list.

Scope guards for this phase:
  * ``format`` must be ``dxf`` (PDF → 5C-2, DWG → converted locally in 5C-2).
  * Non-.dxf extensions → 400.
  * Files over 50 MB → 413.

This router ADDS a new capability; it touches no existing IFC code. Auth is
inherited from the app-level ``ApiKeyMiddleware`` (Bearer token). Errors are
returned as ``{"error": code, "message": ...}`` with the documented status
codes — we return JSONResponse directly (not raise) so the body shape is
exactly as specified rather than wrapped by the global HTTP handler.
"""

from __future__ import annotations

import base64
import os
import shutil
import tempfile
import time
import traceback
import uuid

import structlog
from fastapi import APIRouter, File, Form, Request, UploadFile
from starlette.responses import JSONResponse

from app.config import settings
from app.services.kos_drawing_classifier import classify_drawing
from app.services.kos_dxf_parser import parse_dxf_walls
from app.services.kos_pdf_parser import parse_pdf_walls
from app.services.kos_title_block_extractor import extract_title_block

log = structlog.get_logger()

router = APIRouter(prefix="/kos", tags=["kos-drawing"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
_CHUNK = 1024 * 1024
_TMP_ROOT = "/tmp/kos-drawing-parser"

# Title-block fields counted for the stats.title_block_fields_extracted metric.
_TB_FIELDS = (
    "project_name", "drawing_number", "drawing_title", "revision", "scale",
    "date", "sheet", "level", "client", "drawn_by", "checked_by",
)


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _parse_error_500(parsed: dict, fmt: str) -> JSONResponse:
    """Turn a parser ``{"error", "message"}`` payload into a 500 response."""
    tb = traceback.format_exc()[-2000:]
    return JSONResponse(
        {
            "error": "internal",
            "message": parsed.get("message", f"{fmt} parse failed"),
            "traceback": tb if settings.log_level.upper() == "DEBUG" else None,
        },
        status_code=500,
    )


def _assemble_response(upload_name, fmt, size, parsed, title_block, classification,
                       walls, junctions, warnings, debug_png_b64, started) -> JSONResponse:
    """Build the parse response. Format-agnostic — both the DXF and PDF paths
    feed the same shape here (the DXF output is byte-identical to before this
    helper was extracted; only the call site moved)."""
    # Downstream-readiness flags.
    has_thickness = any(w["thickness_mm"] is not None for w in walls)
    has_long_wall = any(w["length_mm"] > 100 for w in walls)
    boq_ready = has_thickness
    formwork_ready = boq_ready and has_long_wall
    shop_ready = formwork_ready and len(junctions) > 0

    # missing_data — as important as the data itself.
    missing: list[str] = []
    if classification["type"] == "FLOOR_PLAN":
        missing.append("wall_heights — need elevation drawing")
    if not has_thickness:
        missing.append("wall_thicknesses — none extracted")
    if not title_block.get("scale"):
        missing.append("no scale detected")
    if not parsed["has_dimensions"]:
        missing.append("no dimension entities")

    tb_extracted = sum(1 for f in _TB_FIELDS if title_block.get(f))

    counts = parsed["entity_counts"]
    stats = {
        "total_entities": parsed["total_entities"],
        "walls_count": len(walls),
        "junctions_count": len(junctions),
        "title_block_fields_extracted": tb_extracted,
        "lines": counts["LINE"],
        "polylines": counts["LWPOLYLINE"] + counts["POLYLINE"],
        "text": counts["TEXT"] + counts["MTEXT"],
        "dimensions": counts["DIMENSION"],
        "circles": counts["CIRCLE"],
        "blocks": counts["INSERT"],
    }

    duration_ms = int((time.monotonic() - started) * 1000)
    tier = parsed["detection_tier"]

    # ── Phase 5C-3: classification-gated openings ──────────────────────────
    # The parser ran detect_openings() with a default classification of
    # "FLOOR_PLAN". For non-floor-plan drawings (SECTION / ELEVATION /
    # DETAIL) the orchestrator's short-circuit means the parser already
    # returned an empty tuple; we mirror that here defensively so a future
    # parser-side default change can't accidentally leak openings into a
    # section/elevation response.
    raw_openings = parsed.get("openings", ())
    if classification["type"] != "FLOOR_PLAN":
        openings_payload: tuple = ()
    else:
        # Serialise ParserOpening dataclasses into plain dicts for the JSON
        # response. dataclasses.asdict isn't used because tuples become lists
        # — we want explicit field control to keep the wire shape stable.
        openings_payload = tuple(
            {
                "id": o.id,
                "opening_type": o.opening_type,
                "parent_wall_id": o.parent_wall_id,
                "position_mm": round(o.position_mm, 2),
                "width_mm": round(o.width_mm, 2),
                "height_mm": round(o.height_mm, 2),
                "sill_height_mm": round(o.sill_height_mm, 2),
                "detection_tier": o.detection_tier,
                "detection_method": o.detection_method,
                "confidence": round(o.confidence, 2),
                "source_entities": list(o.source_entities),
            }
            for o in raw_openings
        )

    response = {
        "filename": upload_name,
        "format": fmt,
        "size_bytes": size,
        "parser_version": parsed["parser_version"],
        "phase": parsed["phase"],
        "drawing_type": classification["type"],
        "drawing_type_confidence": classification["confidence"],
        "drawing_classification_signals": classification["signals_matched"],
        "drawing_classification_reasoning": classification["reasoning"],
        "title_block": title_block,
        "walls": walls,
        "junctions": junctions,
        "openings": list(openings_payload),
        "layers_found": parsed["layers_found"],
        "drawing_bounds": parsed["drawing_bounds"],
        "units_detected": parsed["units_detected"],
        "stats": stats,
        "warnings": warnings,
        "detection_strategy_used": f"tier_{tier}",
        "overall_confidence": parsed["overall_confidence"],
        "field_confidences": {
            "walls": parsed["walls_field_confidence"],
            "title_block": round(min(1.0, tb_extracted / 6.0), 2),
        },
        "missing_data": missing,
        "downstream_ready": {
            "boq": boq_ready,
            "formwork": formwork_ready,
            "shop_drawings": shop_ready,
        },
        "duration_ms": duration_ms,
        "debug_png_base64": debug_png_b64,
    }

    log.info(
        "kos_drawing_parsed",
        filename=upload_name,
        format=fmt,
        drawing_type=classification["type"],
        walls_count=len(walls),
        overall_confidence=parsed["overall_confidence"],
        duration_ms=duration_ms,
    )
    return JSONResponse(response, status_code=200)


@router.post("/parse-drawing")
async def parse_drawing(
    request: Request,
    file: UploadFile = File(...),
    format: str = Form("dxf"),
    debug: bool = Form(False),
    filename: str | None = Form(None),
):
    """Parse a DXF or PDF drawing → walls + title block + classification report."""
    started = time.monotonic()

    # Format is inferred from the filename extension (authoritative); the
    # ``format`` form field is accepted for back-compat but no longer gates.
    upload_name = filename or file.filename or "drawing.dxf"
    low = upload_name.lower()
    if low.endswith(".dxf"):
        ext = "dxf"
    elif low.endswith(".pdf"):
        ext = "pdf"
    else:
        return _err(
            400, "invalid_extension",
            f"file '{upload_name}' must be .dxf or .pdf (convert DWG to DXF; "
            "scanned-image PDFs are not supported).",
        )

    # Stream to a temp file, enforcing the size cap as we go.
    work_dir = os.path.join(_TMP_ROOT, uuid.uuid4().hex)
    os.makedirs(work_dir, exist_ok=True)
    tmp_path = os.path.join(work_dir, os.path.basename(upload_name))
    size = 0
    try:
        with open(tmp_path, "wb") as fh:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    fh.close()
                    shutil.rmtree(work_dir, ignore_errors=True)
                    return _err(
                        413, "file_too_large",
                        f"file exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB "
                        "limit for the drawing parser.",
                    )
                fh.write(chunk)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(work_dir, ignore_errors=True)
        return _err(500, "upload_write_failed",
                    f"could not buffer upload to disk: {type(exc).__name__}: {exc}")

    try:
        # 1. Parse walls + inventory; 2. title block; 3. classify — by format.
        if ext == "dxf":
            parsed = parse_dxf_walls(tmp_path, upload_name)
            if "error" in parsed:
                return _parse_error_500(parsed, "DXF")
            doc = parsed.pop("_doc")
            msp = parsed.pop("_msp")
            title_block = extract_title_block(doc, msp, upload_name)
            classification = classify_drawing(doc, msp, title_block)
        else:  # pdf
            parsed = parse_pdf_walls(tmp_path, upload_name)
            if "error" in parsed:
                return _parse_error_500(parsed, "PDF")
            pdf_doc = parsed.pop("_pdf_doc")
            parsed.pop("_page", None)
            # The PDF parser extracts the title block internally (needs the
            # scale to convert pt→mm) and returns it for reuse here.
            title_block = parsed.pop("title_block")
            classification = classify_drawing(None, None, title_block)

        walls = parsed["walls"]
        junctions = parsed["junctions"]
        warnings = list(parsed["warnings"])

        # 4. Debug PNG (optional, best-effort, format-specific renderer).
        debug_png_b64 = None
        if debug:
            try:
                from app.services import kos_drawing_debug_render as dr
                if ext == "dxf":
                    png = dr.render_debug_png(tmp_path, walls)
                else:
                    png = dr.render_pdf_debug_png(
                        tmp_path, walls, parsed["unit_multiplier_mm"])
                if png is not None:
                    debug_png_b64 = base64.b64encode(png).decode("ascii")
                else:
                    warnings.append("debug PNG skipped (render failed or over size cap)")
            except Exception as exc:  # noqa: BLE001 — debug is best-effort
                warnings.append(f"debug render error: {type(exc).__name__}: {exc}")

        if ext == "pdf":
            pdf_doc.close()

        return _assemble_response(upload_name, ext, size, parsed, title_block,
                                  classification, walls, junctions, warnings,
                                  debug_png_b64, started)

    except Exception as exc:  # noqa: BLE001
        tb = traceback.format_exc()[-2000:]
        log.error("kos_drawing_parse_failed", filename=upload_name,
                  error=str(exc), error_type=type(exc).__name__, exc_info=True)
        return JSONResponse(
            {
                "error": "internal",
                "message": f"{type(exc).__name__}: {exc}",
                "traceback": tb if settings.log_level.upper() == "DEBUG" else None,
            },
            status_code=500,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
