"""HTTP router for KOS BOQ Generator.

POST /boq/generate — generate BOQ from mapper output + context
GET  /boq/health   — service health check

This module ships a router PLUS a helper to register BOQ-specific exception
handlers on a FastAPI app instance. ``app/main.py`` calls
``register_boq_exception_handlers(app)`` after ``app.include_router(router)``.
Tests can do the same on a bare app for isolation (project convention; see
``tests/test_kos_panel_grid_mapper/test_router_kos_panel_mapper.py``).

Error model — PR 6 spec (FLAT shape, not detail-wrapped):
    422  BOQInputError                 → {"error_code", "message", "hint"}
    500  BOQInvariantError             → {"error_code", "invariant_id", "message", "hint"}
    500  BOQConfigError / BOQError     → {"error_code", "message", "hint"}

Auth + CORS + RequestId remain inherited from ``app/main.py`` for the
production app; they're absent from bare-app test fixtures.

Source: PR 6 of BOQ Generator IMPLEMENT slice.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.services.kos_boq_generator import BOQInput, generate_boq
from app.services.kos_boq_generator.constants import BOQ_SCHEMA_VERSION
from app.services.kos_boq_generator.exceptions import (
    BOQConfigError,
    BOQError,
    BOQInputError,
    BOQInvariantError,
)
from app.services.kos_boq_generator.http_serializers import (
    boq_output_to_dict,
    dict_to_boq_context,
    dict_to_panel_grid_mapper_output,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/boq", tags=["kos-boq-generator"])


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/health")
def health() -> dict[str, str]:
    """Service health check. No request body."""
    return {
        "status": "ok",
        "service": "kos_boq_generator",
        "schema_version": BOQ_SCHEMA_VERSION,
    }


@router.post("/generate", status_code=status.HTTP_200_OK)
def generate(body: dict[str, Any]) -> dict[str, Any]:
    """Generate BOQ from mapper output + context.

    Body schema::

        {"mapper_output": {...}, "context": {...}}

    Response: ``BOQGeneratorOutput`` as dict (16 fields).

    Exceptions propagate to FastAPI's exception handlers, which produce
    flat JSON responses with ``error_code`` + ``message`` + ``hint``.
    """
    if not isinstance(body, dict):
        raise BOQInputError(
            "Request body must be a JSON object.",
            hint="Send 'application/json' with an object containing "
            "'mapper_output' and 'context'.",
        )

    if "mapper_output" not in body:
        raise BOQInputError(
            "Missing required field: mapper_output",
            hint="Body must contain 'mapper_output' (from PanelGridMapperOutput).",
        )

    if "context" not in body:
        raise BOQInputError(
            "Missing required field: context",
            hint="Body must contain 'context' (BOQContext shape).",
        )

    if not isinstance(body["mapper_output"], dict):
        raise BOQInputError(
            "Field 'mapper_output' must be a JSON object.",
            hint=None,
        )

    if not isinstance(body["context"], dict):
        raise BOQInputError(
            "Field 'context' must be a JSON object.",
            hint=None,
        )

    try:
        mapper_output = dict_to_panel_grid_mapper_output(body["mapper_output"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("BOQ mapper_output deserialization failed: %s", exc)
        raise BOQInputError(
            f"Failed to parse mapper_output: {exc}",
            hint="Verify mapper_output schema matches PanelGridMapperOutput.",
        ) from exc

    try:
        context = dict_to_boq_context(body["context"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("BOQ context deserialization failed: %s", exc)
        raise BOQInputError(
            f"Failed to parse context: {exc}",
            hint="Verify context schema matches BOQContext.",
        ) from exc

    boq_input = BOQInput(mapper_output=mapper_output, context=context)

    output = generate_boq(boq_input)

    return boq_output_to_dict(output)


# ─────────────────────────────────────────────────────────────────────────────
# Exception handlers (registered on the FastAPI app via the helper below)
# ─────────────────────────────────────────────────────────────────────────────


async def _handle_boq_input_error(request: Request, exc: BOQInputError) -> JSONResponse:
    """BOQInputError → 422. Flat shape; never wraps in 'detail'."""
    log.warning(
        "BOQ input error at %s: %s", request.url.path, exc,
    )
    return JSONResponse(
        status_code=422,
        content={
            "error_code": exc.error_code,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_boq_invariant_error(
    request: Request, exc: BOQInvariantError,
) -> JSONResponse:
    """BOQInvariantError → 500 with invariant_id. Algorithm bug."""
    log.error(
        "BOQ invariant violation at %s: %s: %s",
        request.url.path, exc.invariant_id, exc,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error_code": exc.error_code,
            "invariant_id": exc.invariant_id,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_boq_config_error(
    request: Request, exc: BOQConfigError,
) -> JSONResponse:
    """BOQConfigError → 500. Config / pricing-data error."""
    log.error("BOQ config error at %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "error_code": exc.error_code,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_boq_error(request: Request, exc: BOQError) -> JSONResponse:
    """Catch-all for direct ``BOQError`` instances or future subclasses.

    FastAPI matches the most-specific registered handler first, so the
    three handlers above fire for known subclasses; this one only matches
    a bare ``BOQError`` or an as-yet-unregistered subclass.
    """
    log.error("BOQ error at %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "error_code": exc.error_code,
            "message": str(exc),
            "hint": getattr(exc, "hint", None),
        },
    )


def register_boq_exception_handlers(app: FastAPI) -> None:
    """Register the four BOQ exception handlers on a FastAPI app.

    Use from ``app/main.py`` after registering the router::

        app.include_router(kos_boq_router)
        register_boq_exception_handlers(app)

    And from test fixtures that mount a bare app::

        app = FastAPI()
        app.include_router(router)
        register_boq_exception_handlers(app)
    """
    app.add_exception_handler(BOQInputError, _handle_boq_input_error)
    app.add_exception_handler(BOQInvariantError, _handle_boq_invariant_error)
    app.add_exception_handler(BOQConfigError, _handle_boq_config_error)
    app.add_exception_handler(BOQError, _handle_boq_error)
