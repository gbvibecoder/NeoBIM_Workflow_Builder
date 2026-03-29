"""Health check endpoints for Railway and monitoring."""

import time

import ifcopenshell
from fastapi import APIRouter

from app.main import get_uptime

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    """Shallow health check — used by Railway for liveness."""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "ifcopenshell_version": ifcopenshell.version,
        "uptime_seconds": round(get_uptime(), 1),
    }


@router.get("/ready")
async def ready():
    """Deep readiness check — verifies IfcOpenShell can create IFC files."""
    start = time.monotonic()
    try:
        model = ifcopenshell.file(schema="IFC4")
        ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcProject")
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {"ready": True, "ifc_creation_test_ms": elapsed_ms}
    except Exception as e:
        return {"ready": False, "error": str(e)}
