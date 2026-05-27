"""HTTP router for KOS Formwork Generator.

POST /formwork/generate — generate formwork quantities from mapper output + context
GET  /formwork/health   — service health check

🚨 SECURITY: error responses do NOT echo wrapped exception strings from the
FormworkError catch-all path. Only orchestrator-controlled messages
(``FormworkInputError`` / ``FormworkInvariantError`` / ``FormworkConfigError``)
are safe to expose verbatim. ``FormworkError`` may wrap PR 2-4 RuntimeErrors
whose ``str()`` could contain secrets/paths/tracebacks — the catch-all uses a
generic message; details land in the server log only.

Error model — FLAT shape (mirrors BOQ; NOT wrapped under FastAPI's "detail"):
    422  FormworkInputError       → {"error_code", "message", "hint"}
    500  FormworkInvariantError   → {"error_code", "invariant_id", "message", "hint"}
    500  FormworkConfigError      → {"error_code", "message", "hint"}
    500  FormworkError (catch-all) → {"error_code", "message", "hint"} — GENERIC message

Auth / CORS / RequestId remain inherited from ``app/main.py`` for the
production app; absent from bare-app test fixtures.

Reference: PR 6 of 5F-IMPLEMENT slice; mirrors ``kos_boq_router.py``.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.services.kos_formwork_generator import generate_formwork
from app.services.kos_formwork_generator.constants import FORMWORK_SCHEMA_VERSION
from app.services.kos_formwork_generator.exceptions import (
    FormworkConfigError,
    FormworkError,
    FormworkInputError,
    FormworkInvariantError,
)
from app.services.kos_formwork_generator.http_serializers import (
    dict_to_formwork_context,
    dict_to_panel_grid_mapper_output,
    format_formwork_output_json,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/formwork", tags=["kos-formwork-generator"])


# ═════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═════════════════════════════════════════════════════════════════════


@router.get("/health")
def health() -> dict[str, str]:
    """Service health check. No request body, no orchestrator call."""
    return {
        "status": "ok",
        "service": "kos_formwork_generator",
        "schema_version": FORMWORK_SCHEMA_VERSION,
    }


@router.post("/generate", status_code=status.HTTP_200_OK)
def generate(body: dict[str, Any]) -> dict[str, Any]:
    """Generate formwork quantities from mapper output + context.

    Body schema::

        {"mapper_output": {...}, "context": {...}}

    Response: ``FormworkGeneratorOutput`` as JSON-safe dict (16 fields).

    Exceptions propagate to FastAPI's exception handlers, which produce flat
    JSON responses (``error_code`` + ``message`` + ``hint`` [+ ``invariant_id``]).
    """
    t_start = time.perf_counter()
    log.info("POST /formwork/generate received")

    # ───── Body shape validation (mirror BOQ) ─────
    if not isinstance(body, dict):
        raise FormworkInputError(
            "Request body must be a JSON object.",
            hint="Send 'application/json' with an object containing "
                 "'mapper_output' and 'context'.",
        )
    if "mapper_output" not in body:
        raise FormworkInputError(
            "Missing required field: mapper_output",
            hint="Body must contain 'mapper_output' (from PanelGridMapperOutput).",
        )
    if "context" not in body:
        raise FormworkInputError(
            "Missing required field: context",
            hint="Body must contain 'context' (FormworkContext shape).",
        )
    if not isinstance(body["mapper_output"], dict):
        raise FormworkInputError(
            "Field 'mapper_output' must be a JSON object.",
            hint=None,
        )
    if not isinstance(body["context"], dict):
        raise FormworkInputError(
            "Field 'context' must be a JSON object.",
            hint=None,
        )

    # ───── Deserialize request body ─────
    try:
        mapper_output = dict_to_panel_grid_mapper_output(body["mapper_output"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("Formwork mapper_output deserialization failed: %s", exc)
        raise FormworkInputError(
            f"Failed to parse mapper_output: {exc}",
            hint="Verify mapper_output schema matches PanelGridMapperOutput.",
        ) from exc

    try:
        context = dict_to_formwork_context(body["context"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("Formwork context deserialization failed: %s", exc)
        raise FormworkInputError(
            f"Failed to parse context: {exc}",
            hint="Verify context schema matches FormworkContext.",
        ) from exc

    # ───── Call orchestrator (typed exceptions propagate to handlers below) ─
    output = generate_formwork(mapper_output, context)

    # ───── Serialize response ─────
    response_body = format_formwork_output_json(output)

    elapsed_ms = (time.perf_counter() - t_start) * 1000
    log.info(
        "POST /formwork/generate SUCCESS formwork_id=%s in %.1fms",
        output.formwork_id, elapsed_ms,
    )
    return response_body


# ═════════════════════════════════════════════════════════════════════
# EXCEPTION HANDLERS (registered via register_formwork_exception_handlers)
# ═════════════════════════════════════════════════════════════════════


async def _handle_formwork_input_error(
    request: Request, exc: FormworkInputError,
) -> JSONResponse:
    """FormworkInputError → 422. FLAT shape; orchestrator-controlled message."""
    log.warning("Formwork input error at %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error_code": exc.error_code,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_formwork_invariant_error(
    request: Request, exc: FormworkInvariantError,
) -> JSONResponse:
    """FormworkInvariantError → 500 with invariant_id. Algorithm/orchestrator bug."""
    log.error(
        "Formwork invariant violation at %s: %s: %s",
        request.url.path, exc.invariant_id, exc,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error_code": exc.error_code,
            "invariant_id": exc.invariant_id,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_formwork_config_error(
    request: Request, exc: FormworkConfigError,
) -> JSONResponse:
    """FormworkConfigError → 500. Config / lookup-data error."""
    log.error("Formwork config error at %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error_code": exc.error_code,
            "message": str(exc),
            "hint": exc.hint,
        },
    )


async def _handle_formwork_error(
    request: Request, exc: FormworkError,
) -> JSONResponse:
    """Catch-all FormworkError handler — 500 with **GENERIC** message.

    🚨 SECURITY: This handler fires for bare ``FormworkError`` instances
    (i.e., exceptions wrapped by the orchestrator with phase context). Those
    wrap PR 2-4 RuntimeErrors whose ``str()`` can contain:

      * Internal file paths
      * Secret/API-key tokens echoed from configs
      * Tier-internal field dumps with raw repr

    We MUST NOT echo ``str(exc)`` to the client. The full exception is logged
    server-side via ``logger.exception`` (includes traceback) — that is the
    only place sensitive details land. The client gets a generic message.

    FastAPI matches the most-specific registered handler first; this handler
    only fires for instances whose class is NOT a registered subclass.
    """
    log.exception(
        "Formwork generation failed at %s: %s",
        request.url.path, type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error_code": exc.error_code,
            "message": "An error occurred during formwork generation.",
            "hint": None,
        },
    )


def register_formwork_exception_handlers(app: FastAPI) -> None:
    """Register the four Formwork exception handlers on a FastAPI app.

    Use from ``app/main.py`` after registering the router::

        app.include_router(kos_formwork_router.router)
        register_formwork_exception_handlers(app)

    And from test fixtures that mount a bare app::

        app = FastAPI()
        app.include_router(router)
        register_formwork_exception_handlers(app)
    """
    app.add_exception_handler(FormworkInputError, _handle_formwork_input_error)
    app.add_exception_handler(FormworkInvariantError, _handle_formwork_invariant_error)
    app.add_exception_handler(FormworkConfigError, _handle_formwork_config_error)
    app.add_exception_handler(FormworkError, _handle_formwork_error)
