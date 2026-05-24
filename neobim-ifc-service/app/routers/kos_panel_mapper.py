"""POST /kos/generate-panel-layout — KOS Panel-Grid Mapper (Week 5D-1).

Accepts a parsed-drawing payload (from /kos/parse-drawing) plus a
ProjectContext, runs the full mapper pipeline (DESIGN §6.1), and returns a
PanelGridMapperOutput JSON.

The mapper itself (`app.services.kos_panel_grid_mapper.map_walls_to_panels`)
is CPU-bound and deterministic. This router is the HTTP boundary: it
deserializes the request body, calls the mapper via `asyncio.to_thread`
(so the event loop isn't blocked), and translates exceptions to structured
HTTP responses.

Error model (per DESIGN §6 + 03_MODULE_LAYOUT §F.3):
  - MapperInputError    → HTTP 400 + structured error body
  - OutputInvariantError → HTTP 500 ("should never happen" — algorithm bug)
  - Pydantic validation  → HTTP 422 (handled by FastAPI's global handler)
  - Any other Exception  → HTTP 500 via fallback handler

Auth + CORS + RequestId + global exception handlers are inherited from
app/main.py — this router only registers the endpoint.
"""

from __future__ import annotations

import asyncio
import dataclasses
import time
import traceback
from typing import Optional

import structlog
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from app.config import settings
from app.services.kos_panel_grid_mapper import (
    MapperInput,
    MapperInputError,
    OutputInvariantError,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
    map_walls_to_panels,
)
from app.services.kos_panel_grid_mapper.constants import (
    Application,
    SeismicZone,
    SplitStrategy,
)

log = structlog.get_logger()

router = APIRouter(prefix="/kos", tags=["kos-panel-mapper"])


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic API models — request body shape at the HTTP boundary
#
# `parser_output` is `dict` (not a typed Pydantic model) because it's expected
# to be passed VERBATIM from /kos/parse-drawing — 25+ nested fields, all
# already validated by the parser. We trust the upstream call.
# `project_context` is fully typed since the API caller (Next.js) constructs it.
# ──────────────────────────────────────────────────────────────────────────────


class ProjectContextAPI(BaseModel):
    """API-layer view of ProjectContext. Pydantic validates the enum values;
    deeper conversion to the internal dataclass happens in `_api_to_dataclass`."""

    model_config = ConfigDict(extra="forbid")

    project_name: str = Field(..., min_length=1, description="Project name (non-empty)")
    seismic_zone: SeismicZone = "III"
    application_hint: Optional[Application] = None
    split_strategy: SplitStrategy = "minimize_cuts"
    wall_height_mm: int = Field(default=3000, ge=1, le=20000)


class MapperInputAPI(BaseModel):
    """API-layer view of MapperInput. The `parser_output` field accepts any
    dict (typically the verbatim JSON response from /kos/parse-drawing)."""

    model_config = ConfigDict(extra="forbid")

    parser_output: dict = Field(
        ..., description="Verbatim ParserOutput JSON from /kos/parse-drawing"
    )
    project_context: ProjectContextAPI


# ──────────────────────────────────────────────────────────────────────────────
# Dict → dataclass conversion (defensive, permissive)
# ──────────────────────────────────────────────────────────────────────────────


def _api_to_dataclass(body: MapperInputAPI) -> MapperInput:
    """Convert a validated API body into the internal MapperInput dataclass.

    Permissive about extra keys in nested dicts (parser may evolve schema);
    strict about required keys (raises KeyError if missing, caught by handler).
    """
    po = body.parser_output

    parser_output = ParserOutput(
        walls=tuple(_build_wall(w) for w in po.get("walls", [])),
        junctions=tuple(_build_junction(j) for j in po.get("junctions", [])),
        title_block=_build_title_block(po.get("title_block") or {}),
        drawing_classification=po["drawing_classification"],
        drawing_classification_confidence=float(po["drawing_classification_confidence"]),
        drawing_classification_signals=tuple(po.get("drawing_classification_signals", [])),
        drawing_classification_reasoning=po.get("drawing_classification_reasoning", ""),
        layers_found=tuple(po.get("layers_found", [])),
        drawing_bounds=dict(po.get("drawing_bounds", {})),
        units_detected=po.get("units_detected", "mm"),
        stats=dict(po.get("stats", {})),
        field_confidences=dict(po.get("field_confidences", {})),
        downstream_ready=dict(po.get("downstream_ready", {})),
        missing_data=tuple(po.get("missing_data", [])),
        detection_strategy_used=po.get("detection_strategy_used", ""),
        overall_confidence=float(po.get("overall_confidence", 0.0)),
        parser_version=po.get("parser_version", ""),
        phase=po.get("phase", ""),
        duration_ms=float(po.get("duration_ms", 0.0)),
        warnings=tuple(po.get("warnings", [])),
    )

    pc = body.project_context
    project_context = ProjectContext(
        project_name=pc.project_name,
        seismic_zone=pc.seismic_zone,
        application_hint=pc.application_hint,
        split_strategy=pc.split_strategy,
        wall_height_mm=pc.wall_height_mm,
    )

    return MapperInput(parser_output=parser_output, project_context=project_context)


def _build_wall(w: dict) -> ParserWall:
    return ParserWall(
        id=w["id"],
        start=tuple(w["start"]),
        end=tuple(w["end"]),
        length_mm=float(w["length_mm"]),
        thickness_mm=(
            float(w["thickness_mm"]) if w.get("thickness_mm") is not None else None
        ),
        angle_degrees=float(w["angle_degrees"]),
        layer=w["layer"],
        detection_tier=int(w["detection_tier"]),
        confidence=float(w["confidence"]),
    )


def _build_junction(j: dict) -> ParserJunction:
    return ParserJunction(
        point=tuple(j["point"]),
        type=j["type"],
        wall_ids=tuple(j["wall_ids"]),
        wall_count=int(j["wall_count"]),
    )


def _build_title_block(tb: dict) -> ParserTitleBlock:
    """Build ParserTitleBlock filtering only known fields (permissive on
    parser-future evolution)."""
    known = {f.name for f in dataclasses.fields(ParserTitleBlock)}
    filtered = {k: v for k, v in tb.items() if k in known}
    return ParserTitleBlock(**filtered)


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────────────


def _err(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(
        {"error": code, "message": message, **extra}, status_code=status
    )


@router.post(
    "/generate-panel-layout",
    summary="Map a parsed drawing → Kalzen panel layout (DESIGN §6.1).",
    description=(
        "Runs the full Panel-Grid Mapper pipeline on a parser output + project "
        "context. Returns a PanelGridMapperOutput JSON with wall_segments, "
        "panels, totals, validations applied, and any custom_quote_requests for "
        "K6-180 / K8-250 / CUSTOM walls."
    ),
)
async def generate_panel_layout(
    request: Request, body: MapperInputAPI
) -> JSONResponse:
    started = time.monotonic()

    # ── Step 1: dict → dataclass conversion ───────────────────────────
    try:
        inp = _api_to_dataclass(body)
    except (KeyError, TypeError, ValueError) as exc:
        log.warning(
            "mapper_input_conversion_failed",
            error=str(exc), error_type=type(exc).__name__,
        )
        return _err(
            400,
            "MAPPER_INPUT_CONVERSION_FAILED",
            f"{type(exc).__name__}: {exc}",
            hint=(
                "parser_output dict shape doesn't match the schema produced by "
                "/kos/parse-drawing. Pass the response verbatim."
            ),
        )

    # ── Step 2: run the mapper (CPU-bound → thread pool) ──────────────
    try:
        output = await asyncio.to_thread(map_walls_to_panels, inp)
    except MapperInputError as exc:
        log.warning("mapper_input_invalid", error=str(exc), exc_info=False)
        return _err(400, exc.error_code, str(exc))
    except OutputInvariantError as exc:
        log.error(
            "mapper_output_invariant_violated",
            error=str(exc), error_type=type(exc).__name__, exc_info=True,
        )
        tb = traceback.format_exc()[-2000:]
        return JSONResponse(
            {
                "error": exc.error_code,
                "message": str(exc),
                "traceback": tb if settings.log_level.upper() == "DEBUG" else None,
                "hint": (
                    "This is an algorithm bug — the mapper produced an "
                    "internally-inconsistent output. Search Railway logs for "
                    "the validation issue details."
                ),
            },
            status_code=500,
        )
    except Exception as exc:  # noqa: BLE001 — last-resort safety net
        log.error(
            "mapper_unexpected_error",
            error=str(exc), error_type=type(exc).__name__, exc_info=True,
        )
        tb = traceback.format_exc()[-2000:]
        return JSONResponse(
            {
                "error": "internal",
                "message": f"{type(exc).__name__}: {exc}",
                "traceback": tb if settings.log_level.upper() == "DEBUG" else None,
            },
            status_code=500,
        )

    duration_ms = int((time.monotonic() - started) * 1000)

    log.info(
        "kos_panel_layout_generated",
        project_name=output.project_name,
        segments=len(output.wall_segments),
        grand_total_panels=output.total_counts.grand_total,
        total_cost_inr=output.total_cost_inr,
        custom_quote_count=len(output.custom_quote_requests),
        warnings_count=len(output.warnings),
        duration_ms=duration_ms,
    )

    # ── Step 3: dataclass → JSON-serialisable dict ────────────────────
    payload = dataclasses.asdict(output)
    payload["duration_ms"] = duration_ms
    return JSONResponse(payload, status_code=200)
