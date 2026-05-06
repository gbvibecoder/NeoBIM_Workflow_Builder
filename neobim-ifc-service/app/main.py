"""FastAPI application entry point.

Hardening overview
------------------
* Middleware order (request → response): CORS → RequestId → ApiKey → app
  RequestId runs early so every downstream log line has a trace id.
* Global exception handlers turn every uncaught error into a structured
  JSON 500 with error_code, request_id, error_type, path, method. A full
  traceback is logged server-side — never leaked to the client.
* RequestValidationError surfaces field-level `loc` + `msg` so schema
  drift between the Next.js caller and Pydantic is instantly obvious.
* Lifespan runs a self-test (ifcopenshell can create an IfcProject).
  Failure is logged loudly but doesn't crash the process — /ready will
  report unhealthy and Railway will retry.
"""

from __future__ import annotations

import platform
import sys
import traceback
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.auth import ApiKeyMiddleware
from app.config import settings
from app.middleware import RequestIdMiddleware
from app.state import init_start_time

log = structlog.get_logger()


# ── Startup self-test ──────────────────────────────────────────────────
def _run_startup_self_test() -> tuple[bool, str | None]:
    """Verify ifcopenshell is importable and can create a minimal IFC file."""
    try:
        import ifcopenshell
        import ifcopenshell.api as api

        model = ifcopenshell.file(schema="IFC4")
        api.run("root.create_entity", model, ifc_class="IfcProject")
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_start_time()

    import logging
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(level),
    )

    ok, err = _run_startup_self_test()
    log.info(
        "ifc_service_starting",
        port=settings.port,
        python_version=sys.version.split()[0],
        platform=platform.platform(),
        r2_configured=settings.r2_configured,
        api_key_configured=bool(settings.api_key),
        ifcopenshell_self_test=ok,
        ifcopenshell_self_test_error=err,
    )
    if not ok:
        log.error(
            "ifc_service_startup_self_test_failed",
            error=err,
            hint=(
                "ifcopenshell import or entity creation failed. /ready will "
                "report unhealthy; check Railway build logs for install errors."
            ),
        )

    yield
    log.info("ifc_service_stopping")


app = FastAPI(
    title="NeoBIM IFC Service",
    description="IfcOpenShell-based IFC4 generation microservice",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Middleware stack (outermost first) ─────────────────────────────────
# CORS must be outermost so OPTIONS preflight is answered before auth.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://trybuildflow.in",
        "https://www.trybuildflow.in",
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# RequestId runs before auth so every auth log line has a trace id.
app.add_middleware(RequestIdMiddleware)

# Auth last so it wraps just the handlers (not the trace/logging layer).
app.add_middleware(ApiKeyMiddleware)


# ── Global exception handlers ──────────────────────────────────────────


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    rid = getattr(request.state, "request_id", "unknown")
    log.warning(
        "http_exception",
        request_id=rid,
        path=str(request.url.path),
        method=request.method,
        status_code=exc.status_code,
        detail=exc.detail,
    )
    return JSONResponse(
        {
            "status": "error",
            "error_code": f"HTTP_{exc.status_code}",
            "detail": exc.detail,
            "request_id": rid,
            "path": str(request.url.path),
            "method": request.method,
        },
        status_code=exc.status_code,
        headers={"X-Request-ID": rid},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    rid = getattr(request.state, "request_id", "unknown")
    errors = []
    for err in exc.errors():
        input_repr = repr(err.get("input"))
        errors.append(
            {
                "loc": list(err.get("loc", [])),
                "msg": err.get("msg"),
                "type": err.get("type"),
                "input_preview": input_repr[:200],
            }
        )
    log.warning(
        "validation_error",
        request_id=rid,
        path=str(request.url.path),
        method=request.method,
        error_count=len(errors),
        errors=errors,
    )
    return JSONResponse(
        {
            "status": "error",
            "error_code": "VALIDATION_ERROR",
            "message": "Request payload failed Pydantic validation",
            "errors": errors,
            "request_id": rid,
            "hint": (
                "Each entry's 'loc' pinpoints the failing field path. "
                "Compare against app/models/request.py. A 'literal_error' "
                "on elements[n].type usually means a new element type was "
                "emitted by massing-generator but not added to ElementType."
            ),
        },
        status_code=422,
        headers={"X-Request-ID": rid},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for any unhandled server error.

    Important: with RequestIdMiddleware catching exceptions upstream, this
    handler is a belt-and-suspenders safety net. Both emit the same shape.
    """
    rid = getattr(request.state, "request_id", "unknown")
    tb_preview = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-2000:]
    log.error(
        "unhandled_exception",
        request_id=rid,
        path=str(request.url.path),
        method=request.method,
        error=str(exc),
        error_type=type(exc).__name__,
        traceback_preview=tb_preview,
        exc_info=True,
    )
    return JSONResponse(
        {
            "status": "error",
            "error_code": "INTERNAL_SERVER_ERROR",
            "error_type": type(exc).__name__,
            "message": "An unexpected error occurred",
            "details": str(exc),
            "request_id": rid,
            "path": str(request.url.path),
            "method": request.method,
            "hint": (
                "Search Railway deploy logs for this request_id — the full "
                "traceback is logged adjacent to the request_complete line."
            ),
        },
        status_code=500,
        headers={"X-Request-ID": rid},
    )


# ── Routers ───────────────────────────────────────────────────────────
from app.routers import health, export, audit  # noqa: E402

app.include_router(health.router)
app.include_router(export.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "service": "neobim-ifc-service",
        "status": "ok",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
        "ready": "/ready",
    }
