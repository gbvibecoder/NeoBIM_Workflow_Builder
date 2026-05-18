"""POST /api/v3/deterministic/build

Deterministic builder endpoint — takes a validated BriefSpec, runs the
appropriate archetype builder, finalizes the IFC, uploads to R2, and
returns the result. No LLM in the loop. Typical response time: <5 s.

Auth: same `ApiKeyMiddleware` as all other endpoints.

Phase G — feature-flagged behind `USE_DETERMINISTIC_BUILDER` env on the
TypeScript side. This endpoint is always available; the flag only controls
whether the Next.js route dispatches here vs to the agent loop.
"""

from __future__ import annotations

import os
import tempfile
import time
from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.ifc_generator_v3.builders import build_office
from app.services.ifc_generator_v3.validate import validate_ifc_file
from app.services.r2_uploader import upload_ifc_to_r2

log = structlog.get_logger()

router = APIRouter(tags=["v3-deterministic"])


class DeterministicBuildRequest(BaseModel):
    brief_spec: Dict[str, Any] = Field(..., description="Validated BriefSpec dict")
    schema_version: str = Field("IFC4", description="IFC schema: 'IFC4' or 'IFC2X3'")


class DeterministicBuildResponse(BaseModel):
    ok: bool
    ifc_url: Optional[str] = None
    entity_count: int = 0
    build_duration_ms: int = 0
    validation: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/build", response_model=DeterministicBuildResponse)
async def deterministic_build(req: DeterministicBuildRequest):
    """Run the deterministic builder for the given BriefSpec."""
    start = time.monotonic()

    archetype = req.brief_spec.get("archetype", "office")
    schema = req.schema_version if req.schema_version in ("IFC4", "IFC2X3") else "IFC4"

    log.info(
        "deterministic_build_start",
        archetype=archetype,
        schema=schema,
        space_count=len(req.brief_spec.get("spaces", [])),
        element_count=len(req.brief_spec.get("elements", [])),
        opening_count=len(req.brief_spec.get("openings", [])),
        furniture_count=len(req.brief_spec.get("furniture", [])),
    )

    # Dispatch to the right builder. For now, only office is supported.
    # Other archetypes will be Phase H.
    if archetype not in ("office",):
        return DeterministicBuildResponse(
            ok=False,
            error=f"Archetype '{archetype}' not yet supported. Supported: office.",
            build_duration_ms=int((time.monotonic() - start) * 1000),
        )

    try:
        bf = build_office(req.brief_spec, schema=schema)
    except Exception as exc:
        log.error("deterministic_build_failed", error=str(exc), exc_info=True)
        return DeterministicBuildResponse(
            ok=False,
            error=f"Builder error: {type(exc).__name__}: {exc}",
            build_duration_ms=int((time.monotonic() - start) * 1000),
        )

    # Write to temp file, validate, upload to R2.
    with tempfile.TemporaryDirectory() as tmpdir:
        ifc_path = os.path.join(tmpdir, "output.ifc")
        try:
            entity_count = bf.write(ifc_path)
        except Exception as exc:
            log.error("deterministic_write_failed", error=str(exc), exc_info=True)
            return DeterministicBuildResponse(
                ok=False,
                error=f"Write error: {type(exc).__name__}: {exc}",
                build_duration_ms=int((time.monotonic() - start) * 1000),
            )

        # Validate the written file.
        validation = validate_ifc_file(
            ifc_path,
            brief=req.brief_spec,
        )

        # Upload to R2.
        try:
            ifc_url = upload_ifc_to_r2(ifc_path)
        except Exception as exc:
            log.warning("deterministic_r2_upload_failed", error=str(exc))
            ifc_url = None

    duration_ms = int((time.monotonic() - start) * 1000)

    log.info(
        "deterministic_build_complete",
        entity_count=entity_count,
        duration_ms=duration_ms,
        ifc_url=ifc_url,
        validation_refs_resolve=validation.get("refs_resolve"),
        validation_entity_count=validation.get("entity_count"),
    )

    return DeterministicBuildResponse(
        ok=True,
        ifc_url=ifc_url,
        entity_count=entity_count,
        build_duration_ms=duration_ms,
        validation=validation,
    )
