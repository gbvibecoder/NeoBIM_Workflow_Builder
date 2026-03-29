"""Pydantic response models for IFC export."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


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


class ExportMetadata(BaseModel):
    engine: str = "ifcopenshell"
    ifcopenshell_version: str = ""
    generation_time_ms: float = 0
    validation_passed: bool = False
    entity_counts: EntityCounts = EntityCounts()


class ExportIFCResponse(BaseModel):
    status: Literal["success", "error"]
    files: list[ExportedFile] = []
    metadata: ExportMetadata = ExportMetadata()
    error: Optional[str] = None
    code: Optional[str] = None
