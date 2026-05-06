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

    # ── Phase 1 Track C: architectural fields ───────────────────────
    # All optional — payloads produced against the pre-Track-C schema still
    # validate. Emitters set these in Phase 2+; the builder consumes them
    # on the gated rich-mode path.
    wall_type: Optional[Literal["exterior", "interior", "partition", "shear", "curtain"]] = Field(
        alias="wallType", default=None
    )
    load_bearing: Optional[bool] = Field(alias="loadBearing", default=None)
    fire_rating: Optional[str] = Field(alias="fireRating", default=None)
    acoustic_rating: Optional[str] = Field(alias="acousticRating", default=None)
    u_value: Optional[float] = Field(alias="uValue", default=None)
    glazing_type: Optional[str] = Field(alias="glazingType", default=None)
    frame_material: Optional[str] = Field(alias="frameMaterial", default=None)
    operation_type: Optional[str] = Field(alias="operationType", default=None)
    handedness: Optional[Literal["left", "right"]] = None
    finish_material: Optional[str] = Field(alias="finishMaterial", default=None)
    occupancy_type: Optional[str] = Field(alias="occupancyType", default=None)

    # ── Phase 1 Track C: structural fields ──────────────────────────
    structural_material: Optional[
        Literal["concrete", "steel", "timber", "masonry", "composite"]
    ] = Field(alias="structuralMaterial", default=None)
    material_grade: Optional[str] = Field(alias="materialGrade", default=None)
    section_profile: Optional[str] = Field(alias="sectionProfile", default=None)
    rebar_ratio: Optional[float] = Field(alias="rebarRatio", default=None)
    concrete_strength: Optional[float] = Field(alias="concreteStrength", default=None)
    member_role: Optional[Literal["primary", "secondary", "tertiary"]] = Field(
        alias="memberRole", default=None
    )
    axial_load: Optional[float] = Field(alias="axialLoad", default=None)
    span_length: Optional[float] = Field(alias="spanLength", default=None)

    # ── Phase 1 Track C: MEP fields ─────────────────────────────────
    mep_system: Optional[
        Literal[
            "hvac-supply",
            "hvac-return",
            "hvac-exhaust",
            "plumbing-cold",
            "plumbing-hot",
            "plumbing-waste",
            "plumbing-vent",
            "electrical-power",
            "electrical-lighting",
            "electrical-low-voltage",
            "fire-protection",
            "data",
        ]
    ] = Field(alias="mepSystem", default=None)
    flow_rate: Optional[float] = Field(alias="flowRate", default=None)
    pressure: Optional[float] = None
    voltage: Optional[float] = None
    power_rating: Optional[float] = Field(alias="powerRating", default=None)
    insulation_thickness: Optional[float] = Field(alias="insulationThickness", default=None)
    connection_size: Optional[float] = Field(alias="connectionSize", default=None)

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
    # Phase 1 Track C: new entity-type literals. Accepted here so Track C+
    # emitters can begin producing them without extra='ignore' silently
    # dropping the whole element. Builder dispatches what it knows; unknown
    # (type, ifc_type) pairs fall back to IfcBuildingElementProxy with a warn.
    "railing", "ramp", "covering-ceiling", "covering-floor", "furniture",
    "plate", "member", "footing", "curtain-wall",
    "sanitary-terminal", "light-fixture", "air-terminal", "flow-terminal",
]

IfcTypeStr = Literal[
    "IfcWall", "IfcSlab", "IfcColumn", "IfcBuildingElementProxy", "IfcSpace",
    "IfcWindow", "IfcDoor", "IfcBeam", "IfcStairFlight", "IfcRailing",
    "IfcCovering", "IfcFooting", "IfcDuctSegment", "IfcPipeSegment",
    "IfcCableCarrierSegment", "IfcFlowTerminal",
    # Phase 1 Track C: new IFC4 classes matching the ElementType additions above.
    "IfcRamp", "IfcFurniture", "IfcPlate", "IfcMember", "IfcCurtainWall",
    "IfcSanitaryTerminal", "IfcLightFixture", "IfcAirTerminal",
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
    # Phase 1 (audit) — richMode is now a typed Literal, not a free-form
    # string. Honors the same five values the TS resolver in
    # src/features/ifc/lib/rich-mode.ts produces. Default None is treated
    # as "no gating" (backward-compatible with payloads that pre-date the
    # field — tests/fixtures/baseline_building.json relies on this).
    # Garbage values now hit the 422 path via Pydantic Literal validation
    # instead of being silently accepted.
    rich_mode: Optional[
        Literal["off", "arch-only", "mep", "structural", "full"]
    ] = Field(alias="richMode", default=None)

    # ── Phase 0 — IDS / LOD-tier target ─────────────────────────────
    # Drives Stage 2.5 (VALIDATE-IFC) in routers/export.py. Orthogonal
    # to rich_mode: rich_mode controls *what is emitted*; target_fidelity
    # controls *which IDS rule set the emitted IFC is validated against*.
    # See neobim-ifc-service/docs/lod-target.md for the per-tier contract.
    target_fidelity: Literal["concept", "design-development", "tender-ready"] = Field(
        alias="targetFidelity",
        default="design-development",
    )

    # ── Phase 2 / Task 7 — RERA inputs ────────────────────────────
    # Indian Real Estate Regulation Act 2016 metadata, attached to
    # residential IfcSpaces via Pset_ReraData. All Optional so existing
    # callers (BuildFlow's ifc-service-client) don't need to send these
    # — defaults are documented in `app/services/rera_pset.py`. Adding
    # new Optional fields under extra="forbid" is safe; existing
    # payloads still validate.
    rera_project_id: Optional[str] = Field(alias="reraProjectId", default=None)
    seismic_zone: Optional[Literal["II", "III", "IV", "V"]] = Field(
        alias="seismicZone", default=None
    )
    wind_zone: Optional[int] = Field(alias="windZone", default=None, ge=1, le=6)

    # extra="forbid" is intentionally on ExportOptions only — the inner
    # geometry models stay loose because the TS massing-generator may emit
    # experimental fields that should round-trip through Pydantic without
    # 422'ing the whole request. Locking ExportOptions surfaces contract
    # drift on the *control plane* (rich mode, disciplines, etc.) loudly.
    model_config = {"populate_by_name": True, "extra": "forbid"}


# ── Top-level request ───────────────────────────────────────────────


class ExportIFCRequest(BaseModel):
    geometry: MassingGeometry
    options: ExportOptions = ExportOptions()
    file_prefix: str = Field(alias="filePrefix", default="building")

    # Top-level extra="forbid" — same reasoning as ExportOptions: the
    # request envelope is small, stable, and any unknown field here is
    # almost certainly a typo. Inner models stay loose for forward compat.
    model_config = {"populate_by_name": True, "extra": "forbid"}
