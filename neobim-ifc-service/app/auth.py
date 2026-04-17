"""API key authentication middleware.

Design notes
------------
- Returns JSONResponse directly instead of raising HTTPException. Raising
  inside BaseHTTPMiddleware.dispatch() escapes Starlette's anyio TaskGroup
  and surfaces as an opaque 500 (unhandled "ExceptionGroup"). This was the
  root cause of the Railway 500s on every unauthed request.
- Wrapped in a top-level try/except so any *unexpected* failure (config
  load error, attribute error on Request, etc.) returns a structured 500
  JSON rather than crashing the ASGI app.
- Every response carries the request_id set by RequestIdMiddleware, so
  unauthed attempts are greppable in logs the same way successful calls are.
"""

from __future__ import annotations

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings

log = structlog.get_logger()

# Paths that don't require authentication.
PUBLIC_PATHS = {
    "/",
    "/health",
    "/ready",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}


def _json_error(status_code: int, error_code: str, detail: str, rid: str) -> JSONResponse:
    return JSONResponse(
        {
            "status": "error",
            "error_code": error_code,
            "detail": detail,
            "request_id": rid,
        },
        status_code=status_code,
        headers={"X-Request-ID": rid},
    )


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = getattr(request.state, "request_id", "unknown")
        try:
            if request.url.path in PUBLIC_PATHS:
                return await call_next(request)

            if not settings.api_key:
                # Dev mode — no API key configured, allow all. Warn once per request
                # at debug level so it's visible but doesn't flood production logs.
                log.debug("auth_disabled_no_api_key", request_id=rid, path=str(request.url.path))
                return await call_next(request)

            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                log.warning(
                    "auth_missing_token",
                    request_id=rid,
                    path=str(request.url.path),
                    method=request.method,
                )
                return _json_error(401, "AUTH_MISSING_TOKEN", "Missing Bearer token", rid)

            token = auth_header[7:]
            if token != settings.api_key:
                log.warning(
                    "auth_invalid_token",
                    request_id=rid,
                    path=str(request.url.path),
                    method=request.method,
                    token_prefix=token[:6] + "..." if len(token) > 6 else "<short>",
                )
                return _json_error(401, "AUTH_INVALID_TOKEN", "Invalid API key", rid)

            return await call_next(request)

        except Exception as exc:
            # Defense in depth — never let the auth middleware itself crash the app.
            log.error(
                "auth_middleware_unhandled",
                request_id=rid,
                path=str(request.url.path),
                error=str(exc),
                error_type=type(exc).__name__,
                exc_info=True,
            )
            return JSONResponse(
                {
                    "status": "error",
                    "error_code": "AUTH_INTERNAL_ERROR",
                    "error_type": type(exc).__name__,
                    "detail": "Authentication middleware failed unexpectedly",
                    "message": str(exc),
                    "request_id": rid,
                },
                status_code=500,
                headers={"X-Request-ID": rid},
            )
