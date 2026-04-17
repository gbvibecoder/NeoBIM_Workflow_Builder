"""API key authentication middleware."""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings

# Paths that don't require authentication.
# `/` is a friendly identity probe; `/health` + `/ready` are Railway liveness/readiness;
# `/docs` + `/openapi.json` keep interactive docs reachable; `/favicon.ico` avoids
# noisy 401s from browsers that auto-request it.
PUBLIC_PATHS = {
    "/",
    "/health",
    "/ready",
    "/docs",
    "/openapi.json",
    "/favicon.ico",
}


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        if not settings.api_key:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        # Raising HTTPException here would escape BaseHTTPMiddleware's TaskGroup
        # and surface as a 500 — return a JSONResponse instead.
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                {"detail": "Missing Bearer token"}, status_code=401
            )

        if auth_header[7:] != settings.api_key:
            return JSONResponse(
                {"detail": "Invalid API key"}, status_code=401
            )

        return await call_next(request)
