"""FastAPI application entry point."""

import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import ApiKeyMiddleware
from app.config import settings
from app.routers import health, export

log = structlog.get_logger()

# Track service start time for uptime reporting
_start_time: float = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _start_time
    _start_time = time.time()

    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            structlog.get_level_from_name(settings.log_level)
        ),
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

# Routers
app.include_router(health.router)
app.include_router(export.router, prefix="/api/v1")


def get_uptime() -> float:
    return time.time() - _start_time
