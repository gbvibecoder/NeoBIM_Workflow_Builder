"""Pydantic response models for IFC export."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ExportedFile(BaseModel):
    discipline: str
    file_name: str
    download_url: str
    size: int
    schema_version: str = "IFC4"
    entity_count: int = 0


class EntityCounts(BaseModel):
    IfcWall: int = 0
    IfcSlab: int = 0
    IfcColumn: int = 0
    IfcBeam: int = 0
    IfcWindow: int = 0
    IfcDoor: int = 0
    IfcOpeningElement: int = 0
    IfcSpace: int = 0
    IfcStairFlight: int = 0
    IfcDuctSegment: int = 0
    IfcPipeSegment: int = 0
    IfcFooting: int = 0


class BuildFailure(BaseModel):
    """One element that raised during IFC creation.

    Logged server-side with full traceback; surfaced here so callers can
    render a partial-success UI without parsing Railway logs.
    """

    element_id: str
    element_type: str
    error_type: str
    error: str


class ExportMetadata(BaseModel):
    engine: str = "ifcopenshell"
    ifcopenshell_version: str = ""
    generation_time_ms: float = 0
    validation_passed: bool = False
    entity_counts: EntityCounts = EntityCounts()
    # Per-element build failures. Non-empty means the IFC was produced with
    # some elements skipped — caller should decide whether that's acceptable.
    build_failures: list[BuildFailure] = Field(default_factory=list)
    build_failure_count: int = 0


class ExportIFCResponse(BaseModel):
    # "partial" means the IFC was generated but some elements failed to build.
    status: Literal["success", "partial", "error"]
    files: list[ExportedFile] = []
    metadata: ExportMetadata = ExportMetadata()
    error: Optional[str] = None
    code: Optional[str] = None
    # Populated on error responses so callers can correlate with server logs.
    request_id: Optional[str] = None
    stage: Optional[str] = None
    error_type: Optional[str] = None
