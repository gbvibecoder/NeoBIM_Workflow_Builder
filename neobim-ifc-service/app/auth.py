"""API key authentication middleware."""

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings

# Paths that don't require authentication (health checks for Railway)
PUBLIC_PATHS = {"/health", "/ready", "/docs", "/openapi.json"}


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        if not settings.api_key:
            # No API key configured — allow all (dev mode)
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")

        token = auth_header[7:]
        if token != settings.api_key:
            raise HTTPException(status_code=401, detail="Invalid API key")

        return await call_next(request)
