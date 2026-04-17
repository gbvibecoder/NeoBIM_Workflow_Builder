"""FastAPI application entry point."""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import ApiKeyMiddleware
from app.config import settings
from app.state import init_start_time

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_start_time()

    import logging
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(level),
    )
    log.info(
        "ifc_service_starting",
        port=settings.port,
        r2_configured=settings.r2_configured,
    )
    yield
    log.info("ifc_service_stopping")


app = FastAPI(
    title="NeoBIM IFC Service",
    description="IfcOpenShell-based IFC4 generation microservice",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow Vercel and local dev
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
)

# API key auth (skips /health, /ready)
app.add_middleware(ApiKeyMiddleware)

# Routers (imported here to avoid circular imports)
from app.routers import health, export  # noqa: E402

app.include_router(health.router)
app.include_router(export.router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "service": "neobim-ifc-service",
        "status": "ok",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }
