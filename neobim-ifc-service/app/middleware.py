"""Observability middleware: request IDs, access logging, timing.

Every request gets a unique X-Request-ID. It's attached to `request.state`
(so handlers and exception handlers can include it), echoed in the response
header, and included in structured logs. Paired with the access-log line this
gives a single grep-able trace for any production incident.

IMPORTANT: BaseHTTPMiddleware.dispatch() exceptions escape the anyio TaskGroup
and surface as opaque 500s. This middleware catches *every* exception, logs
it with full context, and returns a structured JSON 500 — the app is never
left in the "ExceptionGroup: unhandled errors in a TaskGroup" state again.
"""

from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

log = structlog.get_logger()


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        start = time.monotonic()

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            log.error(
                "request_unhandled_exception",
                request_id=rid,
                method=request.method,
                path=str(request.url.path),
                query=str(request.url.query),
                duration_ms=duration_ms,
                error=str(exc),
                error_type=type(exc).__name__,
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
                        "Search Railway logs for this request_id to see the full "
                        "traceback and preceding request context."
                    ),
                },
                status_code=500,
                headers={"X-Request-ID": rid},
            )

        duration_ms = round((time.monotonic() - start) * 1000, 1)
        response.headers["X-Request-ID"] = rid
        log.info(
            "request_complete",
            request_id=rid,
            method=request.method,
            path=str(request.url.path),
            status=response.status_code,
            duration_ms=duration_ms,
        )
        return response
