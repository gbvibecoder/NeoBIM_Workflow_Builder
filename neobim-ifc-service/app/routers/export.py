"""IFC export endpoint — POST /api/v1/export-ifc."""

from __future__ import annotations

import time

import ifcopenshell
import structlog
from fastapi import APIRouter, HTTPException

from app.models.request import ExportIFCRequest
from app.models.response import (
    ExportIFCResponse,
    ExportedFile,
    ExportMetadata,
    EntityCounts,
)
from app.services.ifc_builder import build_multi_discipline
from app.services.r2_uploader import upload_ifc_to_r2, ifc_to_base64_data_uri

log = structlog.get_logger()

router = APIRouter(tags=["export"])


@router.post("/export-ifc", response_model=ExportIFCResponse)
async def export_ifc(request: ExportIFCRequest) -> ExportIFCResponse:
    """Generate IFC4 files from MassingGeometry and upload to R2."""
    start = time.monotonic()

    # Validate input
    if not request.geometry.storeys:
        raise HTTPException(
            status_code=422,
            detail="Geometry must have at least one storey",
        )
    if len(request.geometry.storeys) > 100:
        raise HTTPException(
            status_code=422,
            detail="Maximum 100 storeys supported",
        )

    try:
        # Build IFC files for each discipline
        results = build_multi_discipline(request)

        files: list[ExportedFile] = []
        combined_counts = EntityCounts()

        for discipline, (ifc_bytes, counts) in results.items():
            filename = f"{request.file_prefix}_{discipline}.ifc"

            # Upload to R2 or fall back to base64
            url = upload_ifc_to_r2(ifc_bytes, filename)
            if url is None:
                url = ifc_to_base64_data_uri(ifc_bytes)

            files.append(ExportedFile(
                discipline=discipline,
                file_name=filename,
                download_url=url,
                size=len(ifc_bytes),
                schema_version="IFC4",
                entity_count=sum([
                    counts.IfcWall, counts.IfcSlab, counts.IfcColumn,
                    counts.IfcBeam, counts.IfcWindow, counts.IfcDoor,
                    counts.IfcSpace, counts.IfcStairFlight,
                    counts.IfcDuctSegment, counts.IfcPipeSegment,
                ]),
            ))

            # Accumulate counts from combined discipline
            if discipline == "combined":
                combined_counts = counts

        elapsed_ms = round((time.monotonic() - start) * 1000, 1)

        return ExportIFCResponse(
            status="success",
            files=files,
            metadata=ExportMetadata(
                engine="ifcopenshell",
                ifcopenshell_version=ifcopenshell.version,
                generation_time_ms=elapsed_ms,
                validation_passed=True,
                entity_counts=combined_counts,
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("ifc_export_failed", error=str(e), exc_info=True)
        return ExportIFCResponse(
            status="error",
            error=str(e),
            code="IFC_GENERATION_ERROR",
        )
