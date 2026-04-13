"""
IfcOpenShell Microservice — Service Skeleton
=============================================

This is a DESIGN DOCUMENT, not a running service.
It shows the complete structure, endpoints, types, and IfcOpenShell
function calls that the production service would implement.

Production deployment: Docker + FastAPI + Uvicorn
Estimated file: ~600 LOC when fully implemented.

Dependencies:
    pip install fastapi uvicorn ifcopenshell numpy python-multipart httpx pydantic
"""

from __future__ import annotations

import os
import time
import tempfile
import logging
from typing import Optional
from datetime import datetime, timezone
from enum import Enum

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ── IfcOpenShell imports ──
# These are the specific modules we use:
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.unit
import ifcopenshell.util.placement

logger = logging.getLogger("ifcservice")

# ============================================================================
# CONFIGURATION
# ============================================================================

API_KEY = os.getenv("IFCSERVICE_API_KEY", "")
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "200")) * 1024 * 1024
PARSE_TIMEOUT = int(os.getenv("PARSE_TIMEOUT_SECONDS", "120"))
ELEMENT_TIMEOUT = int(os.getenv("ELEMENT_TIMEOUT_SECONDS", "5"))

# ============================================================================
# PYDANTIC MODELS (match TypeScript IFCParseResult exactly)
# ============================================================================


class AreaQuantity(BaseModel):
    gross: Optional[float] = None
    net: Optional[float] = None
    unit: str = "m2"


class VolumeQuantity(BaseModel):
    base: float = 0.0
    withWaste: float = 0.0
    unit: str = "m3"


class WeightQuantity(BaseModel):
    gross: Optional[float] = None
    net: Optional[float] = None
    unit: str = "kg"


class QuantityData(BaseModel):
    count: int = 1
    area: Optional[AreaQuantity] = None
    volume: Optional[VolumeQuantity] = None
    weight: Optional[WeightQuantity] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    thickness: Optional[float] = None
    perimeter: Optional[float] = None
    openingArea: Optional[float] = None
    crossSectionArea: Optional[float] = None
    outerSurfaceArea: Optional[float] = None
    footprintArea: Optional[float] = None
    quantitySource: Optional[str] = None  # "qto_standard" | "custom" | "geometry_calculated"


class MaterialLayer(BaseModel):
    name: str
    thickness: float  # meters


class IFCElementData(BaseModel):
    id: str  # GlobalId
    type: str  # "IfcWall", "IfcSlab", etc.
    name: str
    storey: str
    material: str
    materialLayers: Optional[list[MaterialLayer]] = None
    quantities: QuantityData
    properties: Optional[dict] = None


class CSICategory(BaseModel):
    code: str
    name: str
    elements: list[IFCElementData]


class CSIDivision(BaseModel):
    code: str
    name: str
    totalVolume: Optional[float] = None
    volumeWithWaste: Optional[float] = None
    totalArea: Optional[float] = None
    totalNetArea: Optional[float] = None
    totalOpeningArea: Optional[float] = None
    areaWithWaste: Optional[float] = None
    wasteFactor: float
    elementCount: int
    categories: list[CSICategory]


class BuildingStorey(BaseModel):
    name: str
    elevation: float
    height: float
    elementCount: int


class SuspiciousDimension(BaseModel):
    elementType: str
    name: str
    dimension: str
    value: float
    expected: str


class ModelQualityReport(BaseModel):
    zeroVolumeElements: dict  # { count: int, types: list[str] }
    noMaterialElements: dict
    unassignedStoreyElements: dict
    suspiciousDimensions: list[SuspiciousDimension]
    duplicateElements: dict  # { count: int, estimatedImpact: str }
    unitConversion: dict  # { detectedUnit, conversionApplied, conversionFactor }
    score: int
    label: str  # "EXCELLENT" | "GOOD" | "FAIR" | "LIMITED"


class ParseMeta(BaseModel):
    version: str = "1.0"
    timestamp: str
    processingTimeMs: int
    ifcSchema: str
    projectName: str
    projectGuid: str
    units: dict = {"length": "m", "area": "m2", "volume": "m3"}
    warnings: list[str] = []
    errors: list[str] = []
    parser: str = "ifcopenshell"


class ParseSummary(BaseModel):
    totalElements: int
    processedElements: int
    failedElements: int
    divisionsFound: list[str]
    buildingStoreys: int
    grossFloorArea: float
    totalConcrete: Optional[float] = None
    totalMasonry: Optional[float] = None


class IFCParseResult(BaseModel):
    meta: ParseMeta
    summary: ParseSummary
    divisions: list[CSIDivision]
    buildingStoreys: list[BuildingStorey]
    modelQuality: Optional[ModelQualityReport] = None


# ============================================================================
# CSI MASTERFORMAT MAPPING (same as TypeScript ifc-parser.ts)
# ============================================================================

# Maps IFC type + material → CSI division
# This must stay in sync with the TypeScript version

CSI_MAPPINGS: dict[str, dict] = {
    "IfcWall": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcWallStandardCase": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcSlab": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcColumn": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcBeam": {"division": "05", "name": "Metals", "code": "05 12 00", "waste": 3.0},
    "IfcFooting": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcDoor": {"division": "08", "name": "Openings", "code": "08 10 00", "waste": 2.0},
    "IfcWindow": {"division": "08", "name": "Openings", "code": "08 50 00", "waste": 2.0},
    "IfcStair": {"division": "03", "name": "Concrete", "code": "03 30 00", "waste": 5.0},
    "IfcRoof": {"division": "07", "name": "Thermal/Moisture", "code": "07 40 00", "waste": 10.0},
    "IfcRailing": {"division": "05", "name": "Metals", "code": "05 52 00", "waste": 3.0},
    "IfcCovering": {"division": "09", "name": "Finishes", "code": "09 60 00", "waste": 15.0},
    "IfcCurtainWall": {"division": "08", "name": "Openings", "code": "08 44 00", "waste": 2.0},
    "IfcMember": {"division": "05", "name": "Metals", "code": "05 12 00", "waste": 3.0},
    "IfcPlate": {"division": "05", "name": "Metals", "code": "05 50 00", "waste": 3.0},
    "IfcReinforcingBar": {"division": "03", "name": "Concrete", "code": "03 21 00", "waste": 10.0},
    # MEP
    "IfcDuctSegment": {"division": "23", "name": "HVAC", "code": "23 31 00", "waste": 8.0},
    "IfcPipeSegment": {"division": "22", "name": "Plumbing", "code": "22 11 00", "waste": 5.0},
    "IfcCableSegment": {"division": "26", "name": "Electrical", "code": "26 05 19", "waste": 3.0},
}

# Material overrides (same logic as TypeScript)
MATERIAL_OVERRIDES: dict[str, dict[str, dict]] = {
    "IfcWall": {
        "brick": {"division": "04", "name": "Masonry", "code": "04 20 00", "waste": 8.0},
        "block": {"division": "04", "name": "Masonry", "code": "04 20 00", "waste": 8.0},
    },
    "IfcColumn": {
        "steel": {"division": "05", "name": "Metals", "code": "05 12 00", "waste": 3.0},
    },
    "IfcBeam": {
        "timber": {"division": "06", "name": "Wood", "code": "06 10 00", "waste": 10.0},
        "wood": {"division": "06", "name": "Wood", "code": "06 10 00", "waste": 10.0},
    },
}


def get_csi_mapping(ifc_type: str, material: str = "") -> dict:
    """Get CSI MasterFormat mapping for an IFC element type and material."""
    mat_lower = material.lower()
    if ifc_type in MATERIAL_OVERRIDES:
        for keyword, mapping in MATERIAL_OVERRIDES[ifc_type].items():
            if keyword in mat_lower:
                return mapping
    return CSI_MAPPINGS.get(ifc_type, {"division": "00", "name": "Unknown", "code": "00 00 00", "waste": 5.0})


# ============================================================================
# IFC ELEMENT TYPES TO EXTRACT (same 27+ as TypeScript)
# ============================================================================

IFC_ELEMENT_TYPES = [
    "IfcWall", "IfcWallStandardCase", "IfcWindow", "IfcDoor",
    "IfcSlab", "IfcColumn", "IfcBeam", "IfcStair", "IfcRailing",
    "IfcCovering", "IfcRoof", "IfcFooting", "IfcBuildingElementProxy",
    "IfcMember", "IfcPlate", "IfcCurtainWall", "IfcReinforcingBar",
    # MEP - HVAC
    "IfcDuctSegment", "IfcDuctFitting", "IfcFlowController",
    "IfcFlowMovingDevice", "IfcFlowTerminal", "IfcFlowTreatmentDevice",
    # MEP - Plumbing
    "IfcPipeSegment", "IfcPipeFitting", "IfcFlowStorageDevice",
    # MEP - Electrical
    "IfcCableSegment", "IfcCableCarrierSegment",
    "IfcCableFitting", "IfcCableCarrierFitting",
]


# ============================================================================
# GEOMETRY COMPUTATION (the key advantage over web-ifc)
# ============================================================================

def compute_volume_from_mesh(shape) -> float:
    """
    Compute volume using the divergence theorem on a triangle mesh.

    This handles ALL IFC geometry types because IfcOpenShell's C++ kernel
    tessellates every representation (IfcExtrudedAreaSolid, IfcBooleanResult,
    IfcFacetedBrep, IfcAdvancedBrep, IfcTriangulatedFaceSet) into a triangle
    mesh before returning it.

    This is the fundamental advantage over web-ifc which can only handle
    IfcExtrudedAreaSolid.
    """
    verts = np.array(shape.geometry.verts).reshape(-1, 3)
    faces = np.array(shape.geometry.faces).reshape(-1, 3)

    if len(faces) == 0:
        return 0.0

    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]

    # Signed volume of tetrahedra with origin (vectorized)
    volume = np.sum(np.einsum("ij,ij->i", v0, np.cross(v1, v2))) / 6.0
    return abs(float(volume))


def compute_surface_area_from_mesh(shape) -> float:
    """Compute total surface area from triangle mesh."""
    verts = np.array(shape.geometry.verts).reshape(-1, 3)
    faces = np.array(shape.geometry.faces).reshape(-1, 3)

    if len(faces) == 0:
        return 0.0

    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]

    # Area of each triangle = 0.5 * |cross(v1-v0, v2-v0)|
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) / 2.0
    return float(np.sum(areas))


def compute_bounding_box(shape) -> dict:
    """Get axis-aligned bounding box dimensions."""
    verts = np.array(shape.geometry.verts).reshape(-1, 3)
    if len(verts) == 0:
        return {"xDim": 0, "yDim": 0, "zDim": 0}
    mins = verts.min(axis=0)
    maxs = verts.max(axis=0)
    dims = maxs - mins
    return {"xDim": float(dims[0]), "yDim": float(dims[1]), "zDim": float(dims[2])}


# ============================================================================
# QUANTITY EXTRACTION
# ============================================================================

def extract_quantities(model: ifcopenshell.file, element, ifc_type: str) -> QuantityData:
    """
    Extract quantities for a single element.

    Priority order (same as Phase 1 ifc-parser.ts):
    1. Qto_* standard base quantities (from authoring tool)
    2. Custom IfcElementQuantity sets
    3. Geometry computation via IfcOpenShell kernel
    """
    quantities = QuantityData(count=1)

    # ── Priority 1 & 2: Read Qto/custom quantities from property sets ──
    qtos = ifcopenshell.util.element.get_psets(element, qtos_only=True)
    psets = ifcopenshell.util.element.get_psets(element, psets_only=True)
    has_qto = False

    for qto_name, qto_values in qtos.items():
        is_standard = qto_name.startswith("Qto_")
        if is_standard:
            has_qto = True

        # Area
        for key in ["GrossSideArea", "GrossArea", "GrossSurfaceArea", "GrossFootprintArea"]:
            if key in qto_values and qto_values[key]:
                if not quantities.area:
                    quantities.area = AreaQuantity()
                quantities.area.gross = float(qto_values[key])

        for key in ["NetSideArea", "NetArea", "NetSurfaceArea"]:
            if key in qto_values and qto_values[key]:
                if not quantities.area:
                    quantities.area = AreaQuantity()
                quantities.area.net = float(qto_values[key])

        # Volume
        for key in ["GrossVolume", "NetVolume", "Volume"]:
            if key in qto_values and qto_values[key]:
                vol = float(qto_values[key])
                if not quantities.volume or vol > quantities.volume.base:
                    quantities.volume = VolumeQuantity(base=vol)

        # Weight (critical for steel BOQ)
        for key in ["GrossWeight", "NetWeight", "Weight"]:
            if key in qto_values and qto_values[key]:
                if not quantities.weight:
                    quantities.weight = WeightQuantity()
                if key == "GrossWeight":
                    quantities.weight.gross = float(qto_values[key])
                elif key == "NetWeight":
                    quantities.weight.net = float(qto_values[key])
                else:
                    quantities.weight.gross = float(qto_values[key])

        # Linear dimensions
        if "Length" in qto_values and qto_values["Length"]:
            quantities.length = float(qto_values["Length"])
        if "Width" in qto_values and qto_values["Width"]:
            quantities.width = float(qto_values["Width"])
        if "Height" in qto_values and qto_values["Height"]:
            quantities.height = float(qto_values["Height"])
        if "Depth" in qto_values and qto_values["Depth"]:
            quantities.height = float(qto_values["Depth"])  # Depth = Height for slabs
        if "Perimeter" in qto_values and qto_values["Perimeter"]:
            quantities.perimeter = float(qto_values["Perimeter"])

        # Thickness
        for key in ["Thickness", "Width"]:
            if key in qto_values and qto_values[key]:
                quantities.thickness = float(qto_values[key])

        # New in Phase 1
        if "CrossSectionArea" in qto_values and qto_values["CrossSectionArea"]:
            quantities.crossSectionArea = float(qto_values["CrossSectionArea"])
        if "OuterSurfaceArea" in qto_values and qto_values["OuterSurfaceArea"]:
            quantities.outerSurfaceArea = float(qto_values["OuterSurfaceArea"])

    quantities.quantitySource = "qto_standard" if has_qto else ("custom" if qtos else None)

    # ── Extract Pset properties ──
    properties = {}
    for pset_name, pset_values in psets.items():
        if "IsExternal" in pset_values:
            properties["IsExternal"] = bool(pset_values["IsExternal"])
        if "LoadBearing" in pset_values:
            properties["LoadBearing"] = bool(pset_values["LoadBearing"])
        for key in ["ConcreteGrade", "Grade", "StrengthClass"]:
            if key in pset_values and pset_values[key]:
                properties["concreteGrade"] = str(pset_values[key])

    # ── Priority 3: Geometry computation (when Qto is missing/incomplete) ──
    has_area = (quantities.area and quantities.area.gross and quantities.area.gross > 0)
    has_volume = (quantities.volume and quantities.volume.base > 0)

    if not has_area or not has_volume:
        try:
            settings = ifcopenshell.geom.settings()
            settings.set("use-world-coords", True)
            shape = ifcopenshell.geom.create_shape(settings, element)

            if not has_volume:
                vol = compute_volume_from_mesh(shape)
                if vol > 0:
                    quantities.volume = VolumeQuantity(base=vol)
                    if not quantities.quantitySource:
                        quantities.quantitySource = "geometry_calculated"

            if not has_area:
                area = compute_surface_area_from_mesh(shape)
                if area > 0:
                    # For walls: gross side area = total surface area / 2 (front + back)
                    # For slabs: gross area = horizontal face area
                    if ifc_type in ("IfcWall", "IfcWallStandardCase"):
                        bbox = compute_bounding_box(shape)
                        # Wall area = height * max(xDim, yDim)
                        wall_area = bbox["zDim"] * max(bbox["xDim"], bbox["yDim"])
                        quantities.area = AreaQuantity(gross=wall_area, net=wall_area)
                        quantities.height = bbox["zDim"]
                        quantities.thickness = min(bbox["xDim"], bbox["yDim"])
                    elif ifc_type in ("IfcSlab", "IfcRoof", "IfcCovering"):
                        bbox = compute_bounding_box(shape)
                        slab_area = bbox["xDim"] * bbox["yDim"]
                        quantities.area = AreaQuantity(gross=slab_area, net=slab_area)
                        quantities.thickness = bbox["zDim"]
                    else:
                        quantities.area = AreaQuantity(gross=area, net=area)

                    if not quantities.quantitySource:
                        quantities.quantitySource = "geometry_calculated"

        except Exception as e:
            logger.warning(f"Geometry computation failed for {ifc_type} #{element.id()}: {e}")

    return quantities, properties


# ============================================================================
# MATERIAL EXTRACTION
# ============================================================================

def extract_material(model: ifcopenshell.file, element) -> tuple[str, list[MaterialLayer]]:
    """
    Extract material name and layers using IfcOpenShell utilities.

    Handles: IfcMaterial, IfcMaterialLayerSet, IfcMaterialLayerSetUsage,
    IfcMaterialProfileSet, IfcMaterialConstituentSet, IfcMaterialList.
    """
    material = ifcopenshell.util.element.get_material(element)
    if material is None:
        return "Unknown", []

    layers: list[MaterialLayer] = []

    # IfcMaterialLayerSetUsage or IfcMaterialLayerSet
    if hasattr(material, "MaterialLayers"):
        layer_set = material
    elif hasattr(material, "ForLayerSet"):
        layer_set = material.ForLayerSet
    else:
        layer_set = None

    if layer_set and hasattr(layer_set, "MaterialLayers"):
        names = []
        for layer in layer_set.MaterialLayers:
            mat = layer.Material
            name = mat.Name if mat else "Unknown"
            thickness = float(layer.LayerThickness) if layer.LayerThickness else 0.0
            names.append(name)
            if thickness > 0:
                layers.append(MaterialLayer(name=name, thickness=thickness))
        return " / ".join(names), layers

    # IfcMaterial (simple)
    if hasattr(material, "Name") and material.Name:
        return str(material.Name), []

    # IfcMaterialProfileSet
    if hasattr(material, "MaterialProfiles"):
        for profile in material.MaterialProfiles:
            if profile.Material and profile.Material.Name:
                return str(profile.Material.Name), []

    return "Unknown", []


# ============================================================================
# STOREY EXTRACTION
# ============================================================================

def get_element_storey(model: ifcopenshell.file, element) -> str:
    """Get the building storey name for an element."""
    container = ifcopenshell.util.element.get_container(element)
    if container and container.is_a("IfcBuildingStorey"):
        return container.Name or "Unassigned"
    return "Unassigned"


# ============================================================================
# OPENING DEDUCTION
# ============================================================================

def compute_wall_openings(model: ifcopenshell.file, wall) -> float:
    """
    Compute total opening area for a wall element.
    Uses IfcRelVoidsElement to find IfcOpeningElement children.
    """
    total_opening_area = 0.0
    for rel in model.by_type("IfcRelVoidsElement"):
        if rel.RelatingBuildingElement == wall:
            opening = rel.RelatedOpeningElement
            try:
                settings = ifcopenshell.geom.settings()
                shape = ifcopenshell.geom.create_shape(settings, opening)
                bbox = compute_bounding_box(shape)
                # Opening area = width * height
                area = bbox["xDim"] * bbox["zDim"]
                if area < 0.01:  # Try other orientations
                    area = max(bbox["xDim"] * bbox["yDim"], bbox["yDim"] * bbox["zDim"])
                total_opening_area += area
            except Exception:
                # Fallback: standard door/window size
                if opening.is_a("IfcDoor"):
                    total_opening_area += 1.89  # 0.9m * 2.1m
                elif opening.is_a("IfcWindow"):
                    total_opening_area += 1.80  # 1.2m * 1.5m
    return total_opening_area


# ============================================================================
# MAIN PARSE FUNCTION
# ============================================================================

def parse_ifc_file(file_path: str) -> IFCParseResult:
    """
    Parse an IFC file using IfcOpenShell and return results matching
    the TypeScript IFCParseResult interface.

    This is the core function. It:
    1. Opens the file with IfcOpenShell
    2. Extracts building storeys
    3. Iterates all element types
    4. For each element: extracts quantities (Qto → geometry fallback),
       material, storey, properties
    5. Organizes by CSI division
    6. Runs model quality validation
    7. Returns the complete IFCParseResult
    """
    start_time = time.time()
    warnings: list[str] = []
    errors: list[str] = []

    model = ifcopenshell.open(file_path)
    schema = model.schema

    # Project info
    projects = model.by_type("IfcProject")
    project = projects[0] if projects else None
    project_name = project.Name if project and project.Name else "Unknown Project"
    project_guid = project.GlobalId if project and project.GlobalId else ""

    # Unit detection
    # IfcOpenShell handles unit conversion internally via ifcopenshell.util.unit
    length_unit = "m"
    try:
        unit_scale = ifcopenshell.util.unit.calculate_unit_scale(model)
        # unit_scale converts model units to meters
        # If model is in mm: unit_scale = 0.001
        # If model is in m: unit_scale = 1.0
        if abs(unit_scale - 0.001) < 0.0001:
            length_unit = "MILLIMETRE"
        elif abs(unit_scale - 0.3048) < 0.001:
            length_unit = "FOOT"
        elif abs(unit_scale - 0.0254) < 0.001:
            length_unit = "INCH"
    except Exception:
        unit_scale = 1.0

    # Building storeys
    storey_list: list[BuildingStorey] = []
    storeys = model.by_type("IfcBuildingStorey")
    storey_data = []
    for s in storeys:
        elev = float(s.Elevation) if s.Elevation else 0.0
        storey_data.append({"name": s.Name or "Level", "elevation": elev, "id": s.id()})
    storey_data.sort(key=lambda x: x["elevation"])

    for i, sd in enumerate(storey_data):
        height = (storey_data[i + 1]["elevation"] - sd["elevation"]) if i < len(storey_data) - 1 else 3.0
        storey_list.append(BuildingStorey(
            name=sd["name"], elevation=sd["elevation"],
            height=max(height, 2.4), elementCount=0
        ))

    # Extract elements
    elements_by_division: dict[str, dict[str, list[IFCElementData]]] = {}
    total_elements = 0
    processed_elements = 0
    failed_elements = 0

    for ifc_type in IFC_ELEMENT_TYPES:
        try:
            elements = model.by_type(ifc_type)
        except Exception:
            continue

        for element in elements:
            total_elements += 1
            try:
                global_id = element.GlobalId or f"TEMP_{element.id()}"
                name = element.Name or f"{ifc_type}-{element.id()}"

                # Material
                material_name, material_layers = extract_material(model, element)

                # CSI mapping
                csi = get_csi_mapping(ifc_type, material_name)

                # Quantities (Qto → geometry fallback)
                quantities, properties = extract_quantities(model, element, ifc_type)

                # Storey
                storey_name = get_element_storey(model, element)

                # Opening deduction for walls
                if ifc_type in ("IfcWall", "IfcWallStandardCase"):
                    opening_area = compute_wall_openings(model, element)
                    if opening_area > 0:
                        quantities.openingArea = opening_area
                        if quantities.area and quantities.area.gross:
                            quantities.area.net = max(0, quantities.area.gross - opening_area)

                # Apply waste factor to volume
                if quantities.volume and quantities.volume.base > 0:
                    quantities.volume.withWaste = quantities.volume.base * (1 + csi["waste"] / 100)

                # Build element data
                elem_data = IFCElementData(
                    id=global_id,
                    type=ifc_type,
                    name=name,
                    storey=storey_name,
                    material=material_name,
                    materialLayers=material_layers if len(material_layers) > 1 else None,
                    quantities=quantities,
                    properties=properties if properties else None,
                )

                # Organize by division
                div_code = csi["division"]
                cat_code = csi["code"]
                if div_code not in elements_by_division:
                    elements_by_division[div_code] = {}
                if cat_code not in elements_by_division[div_code]:
                    elements_by_division[div_code][cat_code] = []
                elements_by_division[div_code][cat_code].append(elem_data)

                # Update storey element count
                for s in storey_list:
                    if s.name == storey_name:
                        s.elementCount += 1
                        break

                processed_elements += 1

            except Exception as e:
                failed_elements += 1
                warnings.append(f"Failed to process {ifc_type} #{element.id()}: {str(e)[:100]}")

    # Build divisions output (same structure as TypeScript)
    divisions: list[CSIDivision] = []
    divisions_found: list[str] = []

    for div_code, categories_map in sorted(elements_by_division.items()):
        categories: list[CSICategory] = []
        total_vol = 0.0
        total_area = 0.0
        total_net = 0.0
        total_opening = 0.0
        elem_count = 0

        for cat_code, elems in categories_map.items():
            csi = get_csi_mapping(elems[0].type, elems[0].material)
            categories.append(CSICategory(code=cat_code, name=csi["name"], elements=elems))
            for e in elems:
                elem_count += 1
                if e.quantities.volume:
                    total_vol += e.quantities.volume.base
                if e.quantities.area and e.quantities.area.gross:
                    total_area += e.quantities.area.gross
                if e.quantities.area and e.quantities.area.net:
                    total_net += e.quantities.area.net
                if e.quantities.openingArea:
                    total_opening += e.quantities.openingArea

        waste = float(categories[0].elements[0].type in CSI_MAPPINGS and CSI_MAPPINGS.get(categories[0].elements[0].type, {}).get("waste", 5.0) or 5.0)

        divisions.append(CSIDivision(
            code=div_code,
            name=categories[0].name if categories else "Unknown",
            totalVolume=total_vol if total_vol > 0 else None,
            volumeWithWaste=total_vol * (1 + waste / 100) if total_vol > 0 else None,
            totalArea=total_area if total_area > 0 else None,
            totalNetArea=total_net if total_net > 0 else None,
            totalOpeningArea=total_opening if total_opening > 0 else None,
            areaWithWaste=total_area * (1 + waste / 100) if total_area > 0 else None,
            wasteFactor=waste,
            elementCount=elem_count,
            categories=categories,
        ))
        divisions_found.append(div_code)

    # GFA from slab areas
    slab_area = sum(
        e.quantities.area.gross
        for d in divisions if d.code == "03"
        for c in d.categories
        for e in c.elements
        if e.type == "IfcSlab" and e.quantities.area and e.quantities.area.gross
    )

    processing_ms = int((time.time() - start_time) * 1000)

    return IFCParseResult(
        meta=ParseMeta(
            timestamp=datetime.now(timezone.utc).isoformat(),
            processingTimeMs=processing_ms,
            ifcSchema=schema,
            projectName=project_name,
            projectGuid=project_guid,
        ),
        summary=ParseSummary(
            totalElements=total_elements,
            processedElements=processed_elements,
            failedElements=failed_elements,
            divisionsFound=divisions_found,
            buildingStoreys=len(storey_list),
            grossFloorArea=slab_area if slab_area > 0 else len(storey_list) * 100,
        ),
        divisions=divisions,
        buildingStoreys=storey_list,
        # modelQuality would be computed here (same logic as TypeScript buildModelQualityReport)
    )


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="BuildFlow IfcOpenShell Service",
    description="IFC geometry parsing microservice for accurate quantity extraction",
    version="0.1.0",
)

# Startup metrics
_start_time = time.time()
_files_processed = 0
_total_processing_ms = 0


def verify_api_key(authorization: str = Header(None)) -> None:
    """Verify the service-to-service API key."""
    if not API_KEY:
        return  # No key configured = development mode
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing API key")
    if authorization[7:] != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


@app.get("/health")
async def health():
    """Health check endpoint for load balancer / uptime monitoring."""
    global _files_processed, _total_processing_ms
    return {
        "status": "healthy",
        "ifcopenshell_version": ifcopenshell.version,
        "python_version": f"{__import__('sys').version_info.major}.{__import__('sys').version_info.minor}",
        "uptime_seconds": int(time.time() - _start_time),
        "files_processed": _files_processed,
        "avg_processing_ms": int(_total_processing_ms / _files_processed) if _files_processed > 0 else 0,
    }


@app.post("/parse", response_model=IFCParseResult)
async def parse_ifc(
    file: UploadFile = File(...),
    authorization: str = Header(None),
):
    """
    Parse an IFC file and return structured quantity data.

    This endpoint handles ALL IFC geometry types including:
    - IfcExtrudedAreaSolid (standard)
    - IfcBooleanResult (intersections, subtractions)
    - IfcFacetedBrep (mesh geometry from SketchUp/Rhino)
    - IfcAdvancedBrep (NURBS from ArchiCAD)
    - IfcTriangulatedFaceSet (IFC4)

    Returns the same IFCParseResult structure as the web-ifc WASM parser.
    """
    verify_api_key(authorization)
    global _files_processed, _total_processing_ms

    # Validate
    if not file.filename or not file.filename.lower().endswith(".ifc"):
        raise HTTPException(400, "Only .ifc files accepted")

    # Save to temp file (IfcOpenShell needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit")
        if not content[:20].startswith(b"ISO-10303-21"):
            raise HTTPException(400, "Invalid IFC file format")
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = parse_ifc_file(tmp_path)
        _files_processed += 1
        _total_processing_ms += result.meta.processingTimeMs
        return result
    except Exception as e:
        logger.error(f"Parse failed: {e}", exc_info=True)
        raise HTTPException(422, f"IFC parsing failed: {str(e)[:200]}")
    finally:
        os.unlink(tmp_path)


class GeometryRequest(BaseModel):
    file_url: str
    element_ids: list[int]
    compute: list[str] = ["volume", "area"]


@app.post("/geometry-only")
async def geometry_only(
    request: GeometryRequest,
    authorization: str = Header(None),
):
    """
    Compute geometry (volume/area) for specific elements only.

    Used when web-ifc succeeded for most elements but couldn't handle
    complex geometry on a few. Much faster than a full parse.

    The file is downloaded from the provided URL (typically Cloudflare R2).
    """
    verify_api_key(authorization)

    # Download file from URL
    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(request.file_url)
        if resp.status_code != 200:
            raise HTTPException(502, f"Failed to download IFC file: HTTP {resp.status_code}")

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = tmp.name

    try:
        model = ifcopenshell.open(tmp_path)
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)

        results = {}
        failed = []

        for eid in request.element_ids:
            try:
                element = model.by_id(eid)
                shape = ifcopenshell.geom.create_shape(settings, element)

                result = {}
                if "volume" in request.compute:
                    result["volume"] = compute_volume_from_mesh(shape)
                if "area" in request.compute:
                    result["area_gross"] = compute_surface_area_from_mesh(shape)
                    # Net area would require opening deduction — skip for now
                    result["area_net"] = result["area_gross"]
                if "weight" in request.compute:
                    # Weight = volume * density (7850 for steel, 2400 for concrete)
                    vol = result.get("volume", compute_volume_from_mesh(shape))
                    material_name = extract_material(model, element)[0].lower()
                    density = 7850 if "steel" in material_name else 2400
                    result["weight"] = vol * density

                results[str(eid)] = result
            except Exception as e:
                failed.append(eid)
                logger.warning(f"Geometry failed for element #{eid}: {e}")

        return {
            "results": results,
            "failed": failed,
            "processing_ms": 0,  # Would be computed in production
        }
    finally:
        os.unlink(tmp_path)


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=2)
