"""Pydantic request models mirroring src/types/geometry.ts."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Geometry primitives ──────────────────────────────────────────────


class Vertex(BaseModel):
    x: float
    y: float
    z: float


class FootprintPoint(BaseModel):
    x: float
    y: float


class Face(BaseModel):
    vertices: list[int]


# ── Element properties ───────────────────────────────────────────────


class ElementProperties(BaseModel):
    name: str
    storey_index: int = Field(alias="storeyIndex", default=0)
    height: Optional[float] = None
    width: Optional[float] = None
    length: Optional[float] = None
    thickness: Optional[float] = None
    area: Optional[float] = None
    volume: Optional[float] = None
    is_partition: Optional[bool] = Field(alias="isPartition", default=None)
    radius: Optional[float] = None
    space_name: Optional[str] = Field(alias="spaceName", default=None)
    space_usage: Optional[str] = Field(alias="spaceUsage", default=None)
    space_footprint: Optional[list[FootprintPoint]] = Field(
        alias="spaceFootprint", default=None
    )
    sill_height: Optional[float] = Field(alias="sillHeight", default=None)
    wall_offset: Optional[float] = Field(alias="wallOffset", default=None)
    parent_wall_id: Optional[str] = Field(alias="parentWallId", default=None)
    wall_direction_x: Optional[float] = Field(alias="wallDirectionX", default=None)
    wall_direction_y: Optional[float] = Field(alias="wallDirectionY", default=None)
    wall_origin_x: Optional[float] = Field(alias="wallOriginX", default=None)
    wall_origin_y: Optional[float] = Field(alias="wallOriginY", default=None)
    material: Optional[str] = None
    discipline: Optional[Literal["architectural", "structural", "mep"]] = None
    diameter: Optional[float] = None
    is_exterior: Optional[bool] = Field(alias="isExterior", default=None)
    riser_count: Optional[int] = Field(alias="riserCount", default=None)
    riser_height: Optional[float] = Field(alias="riserHeight", default=None)
    tread_depth: Optional[float] = Field(alias="treadDepth", default=None)

    model_config = {"populate_by_name": True}


# ── Element types ────────────────────────────────────────────────────

ElementType = Literal[
    "wall", "slab", "column", "roof", "space", "window", "door",
    "beam", "stair", "balcony", "canopy", "parapet",
    "duct", "pipe", "cable-tray", "equipment",
    # Curtain-wall facade sub-elements emitted by src/features/3d-render/services/massing-generator.ts.
    # Accepted here so payloads validate; the builder currently skips them (the parent
    # IfcWall carries the facade), logging a warning rather than crashing.
    "mullion", "spandrel",
]

IfcTypeStr = Literal[
    "IfcWall", "IfcSlab", "IfcColumn", "IfcBuildingElementProxy", "IfcSpace",
    "IfcWindow", "IfcDoor", "IfcBeam", "IfcStairFlight", "IfcRailing",
    "IfcCovering", "IfcFooting", "IfcDuctSegment", "IfcPipeSegment",
    "IfcCableCarrierSegment", "IfcFlowTerminal",
]


class GeometryElement(BaseModel):
    id: str
    type: ElementType
    vertices: list[Vertex]
    faces: list[Face] = []
    ifc_type: IfcTypeStr = Field(alias="ifcType")
    properties: ElementProperties

    model_config = {"populate_by_name": True}


# ── Storey & geometry ────────────────────────────────────────────────


class MassingStorey(BaseModel):
    index: int = 0
    name: str
    elevation: float
    height: float
    elements: list[GeometryElement] = []
    is_basement: Optional[bool] = Field(alias="isBasement", default=None)

    model_config = {"populate_by_name": True}


class BoundingBox(BaseModel):
    min: Vertex
    max: Vertex


class MetricEntry(BaseModel):
    label: str
    value: str | float | int
    unit: Optional[str] = None


class MassingGeometry(BaseModel):
    building_type: str = Field(alias="buildingType")
    floors: int
    total_height: float = Field(alias="totalHeight")
    footprint_area: float = Field(alias="footprintArea")
    gfa: float
    footprint: list[FootprintPoint]
    storeys: list[MassingStorey]
    bounding_box: Optional[BoundingBox] = Field(alias="boundingBox", default=None)
    metrics: list[MetricEntry] = []

    model_config = {"populate_by_name": True}


# ── Export options ───────────────────────────────────────────────────

Discipline = Literal["architectural", "structural", "mep", "combined"]


class ExportOptions(BaseModel):
    project_name: str = Field(alias="projectName", default="NeoBIM Project")
    building_name: str = Field(alias="buildingName", default="Building")
    site_name: str = Field(alias="siteName", default="Default Site")
    author: str = "NeoBIM"
    disciplines: list[Discipline] = [
        "architectural", "structural", "mep", "combined"
    ]

    model_config = {"populate_by_name": True}


# ── Top-level request ───────────────────────────────────────────────


class ExportIFCRequest(BaseModel):
    geometry: MassingGeometry
    options: ExportOptions = ExportOptions()
    file_prefix: str = Field(alias="filePrefix", default="building")

    model_config = {"populate_by_name": True}
