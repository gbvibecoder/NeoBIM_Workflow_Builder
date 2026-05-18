"""Health check endpoints for Railway and monitoring.

Two levels of probes:

* /health — shallow liveness. Returns 200 as long as the process is up.
  Used by Railway for liveness. Enriched with diagnostic info (python
  version, git SHA, config flags) so Railway-side issues are diagnosable
  without shell access.
* /ready  — deep readiness. Actually exercises IfcOpenShell so a broken
  install surfaces before traffic is routed. Returns 503 when unhealthy.
"""

from __future__ import annotations

import os
import platform
import sys
import time

import ifcopenshell
from fastapi import APIRouter
from starlette.responses import JSONResponse

from app.config import settings
from app.state import get_uptime

router = APIRouter(tags=["health"])


def _git_sha() -> str:
    """Railway injects this env var; fall back to 'unknown' locally."""
    return (
        os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or os.environ.get("GIT_COMMIT_SHA")
        or "unknown"
    )[:12]


def _memory_info() -> dict | None:
    """Best-effort memory snapshot; returns None if psutil isn't available."""
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        return {"max_rss_kb": usage.ru_maxrss}
    except Exception:
        return None


@router.get("/health")
async def health():
    """Shallow health check — used by Railway for liveness."""
    return {
        "status": "healthy",
        "service": "neobim-ifc-service",
        "version": "1.0.0",
        "ifcopenshell_version": ifcopenshell.version,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "uptime_seconds": round(get_uptime(), 1),
        "git_sha": _git_sha(),
        "config": {
            "api_key_configured": bool(settings.api_key),
            "r2_configured": settings.r2_configured,
            "r2_bucket": settings.r2_bucket_name if settings.r2_configured else None,
            "log_level": settings.log_level,
        },
        "memory": _memory_info(),
    }


@router.get("/ready")
async def ready():
    """Deep readiness check — verifies IfcOpenShell can create IFC files."""
    start = time.monotonic()
    try:
        model = ifcopenshell.file(schema="IFC4")
        ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcProject")
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {
            "ready": True,
            "ifc_creation_test_ms": elapsed_ms,
            "git_sha": _git_sha(),
        }
    except Exception as exc:
        return JSONResponse(
            {
                "ready": False,
                "error_code": "IFCOPENSHELL_UNAVAILABLE",
                "error_type": type(exc).__name__,
                "error": str(exc),
                "hint": (
                    "ifcopenshell is installed but cannot create entities. "
                    "Check Docker build logs for incomplete install; "
                    "ifcopenshell requires libgomp1 on slim images."
                ),
            },
            status_code=503,
        )


@router.get("/api/v1/health/v3-readiness")
async def v3_readiness():
    """Post-deploy smoke check for v3 pipeline helpers.

    Probes every helper that the agent sandbox pre-binds. If any returns
    false, the agent loop will crash at runtime when it calls that helper.
    One curl post-deploy tells you immediately.
    """
    helpers = {
        "resolve_material": False,
        "compose_furniture": False,
        "apply_naming_convention": False,
        "add_site_context": False,
        "validate_brief_spec": False,
        "run_preflight": False,
    }
    _probe_map = {
        "resolve_material": "app.services.ifc_generator_v3.material_library",
        "compose_furniture": "app.services.ifc_generator_v3.furniture_compositor",
        "apply_naming_convention": "app.services.ifc_generator_v3.naming_resolver",
        "add_site_context": "app.services.ifc_generator_v3.site_context",
        "validate_brief_spec": "app.services.ifc_generator_v3.spec_validator",
        "run_preflight": "app.services.ifc_generator_v3.preflight",
    }
    for name, module_path in _probe_map.items():
        try:
            mod = __import__(module_path, fromlist=[name])
            fn = getattr(mod, name, None)
            helpers[name] = callable(fn)
        except Exception:
            helpers[name] = False

    ifc_version = "unknown"
    try:
        ifc_version = ifcopenshell.version
    except Exception:
        pass

    all_ok = all(helpers.values())
    return JSONResponse(
        {
            "ok": all_ok,
            "buildflow_ifc_helpers": helpers,
            "schema_default": "IFC4",
            "ifcopenshell_version": ifc_version,
        },
        status_code=200 if all_ok else 503,
    )
