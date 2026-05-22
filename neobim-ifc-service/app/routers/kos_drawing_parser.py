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
from app.services.kos_dxf_parser import PARSER_VERSION, PHASE, parse_dxf_walls
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


@router.post("/parse-drawing")
async def parse_drawing(
    request: Request,
    file: UploadFile = File(...),
    format: str = Form("dxf"),
    debug: bool = Form(False),
    filename: str | None = Form(None),
):
    """Parse a DXF drawing → walls + title block + classification report."""
    started = time.monotonic()

    fmt = (format or "dxf").lower().strip()
    if fmt != "dxf":
        return _err(
            400, "unsupported_format",
            f"format='{fmt}' is not supported in phase 5C-1 — only 'dxf'. "
            "PDF parsing lands in 5C-2; DWG is converted to DXF locally "
            "before upload.",
        )

    upload_name = filename or file.filename or "drawing.dxf"
    if not upload_name.lower().endswith(".dxf"):
        return _err(
            400, "invalid_extension",
            f"file '{upload_name}' is not a .dxf — phase 5C-1 only accepts "
            "DXF. Convert DWG/PDF before upload.",
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
        # 1. Parse walls + inventory (also opens the doc for reuse).
        parsed = parse_dxf_walls(tmp_path, upload_name)
        if "error" in parsed:
            tb = traceback.format_exc()[-2000:]
            return JSONResponse(
                {
                    "error": "internal",
                    "message": parsed.get("message", "DXF parse failed"),
                    "traceback": tb if settings.log_level.upper() == "DEBUG" else None,
                },
                status_code=500,
            )

        doc = parsed.pop("_doc")
        msp = parsed.pop("_msp")

        # 2. Title block (extracted first so the classifier can use it).
        title_block = extract_title_block(doc, msp, upload_name)

        # 3. Classify drawing type (title block is the dominant signal).
        classification = classify_drawing(doc, msp, title_block)

        walls = parsed["walls"]
        junctions = parsed["junctions"]
        warnings = list(parsed["warnings"])

        # 4. Debug PNG (optional).
        debug_png_b64 = None
        if debug:
            try:
                from app.services.kos_drawing_debug_render import render_debug_png
                png = render_debug_png(tmp_path, walls)
                if png is not None:
                    debug_png_b64 = base64.b64encode(png).decode("ascii")
                else:
                    warnings.append("debug PNG skipped (render failed or over size cap)")
            except Exception as exc:  # noqa: BLE001 — debug is best-effort
                warnings.append(f"debug render error: {type(exc).__name__}: {exc}")

        # 5. Downstream-readiness flags.
        has_thickness = any(w["thickness_mm"] is not None for w in walls)
        has_long_wall = any(w["length_mm"] > 100 for w in walls)
        boq_ready = has_thickness
        formwork_ready = boq_ready and has_long_wall
        shop_ready = formwork_ready and len(junctions) > 0

        # 6. missing_data — as important as the data itself.
        missing: list[str] = []
        if classification["type"] == "FLOOR_PLAN":
            missing.append("wall_heights — need elevation drawing")
        if not has_thickness:
            missing.append("wall_thicknesses — none extracted")
        scale_unknown = not title_block.get("scale")
        if scale_unknown:
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

        response = {
            "filename": upload_name,
            "format": "dxf",
            "size_bytes": size,
            "parser_version": PARSER_VERSION,
            "phase": PHASE,
            "drawing_type": classification["type"],
            "drawing_type_confidence": classification["confidence"],
            "drawing_classification_signals": classification["signals_matched"],
            "drawing_classification_reasoning": classification["reasoning"],
            "title_block": title_block,
            "walls": walls,
            "junctions": junctions,
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
            format="dxf",
            drawing_type=classification["type"],
            walls_count=len(walls),
            overall_confidence=parsed["overall_confidence"],
            duration_ms=duration_ms,
        )
        return JSONResponse(response, status_code=200)

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
