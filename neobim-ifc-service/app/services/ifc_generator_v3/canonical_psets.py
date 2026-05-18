"""Canonical Pset and Qto definitions per IFC class + schema.

Centralized from `BuildFlowIFC.PSET_DEFAULTS` (Phase BCD) so that both
the agent-loop path and the deterministic builder share one source of
truth. Schema-aware: some Pset names differ between IFC2X3 and IFC4.

Usage:
    from canonical_psets import get_pset_config, get_qto_config
    config = get_pset_config("IfcWall", "IFC4")
    # -> {"pset_name": "Pset_WallCommon", "props": {...}}
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


# ── Canonical Pset defaults ─────────────────────────────────────────────
#
# These mirror industry-standard property values. The `props` dict is
# passed to `pset.edit_pset` — None-valued entries are stripped before
# assignment (ifcopenshell rejects None IfcPropertySingleValue).

PSET_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "IfcWall": {
        "pset_name": "Pset_WallCommon",
        "props": {
            "LoadBearing": False,
            "IsExternal": True,
            "ThermalTransmittance": 0.30,
            "AcousticRating": "Rw 45 dB",
            "FireRating": "REI 60",
            "Compartmentation": False,
            "Combustible": False,
            "SurfaceSpreadOfFlame": "Class 0",
        },
    },
    "IfcDoor": {
        "pset_name": "Pset_DoorCommon",
        "props": {
            "IsExternal": True,
            "FireRating": "EI 30",
            "AcousticRating": "Rw 35 dB",
            "ThermalTransmittance": 1.6,
            "SmokeStop": False,
            "SecurityRating": "Standard",
            "HandicapAccessible": True,
        },
    },
    "IfcWindow": {
        "pset_name": "Pset_WindowCommon",
        "props": {
            "IsExternal": True,
            "ThermalTransmittance": 1.2,
            "GlazingAreaFraction": 0.78,
            "FireRating": "Not Required",
            "AcousticRating": "Rw 32 dB",
            "SecurityRating": "Standard",
        },
    },
    "IfcSpace": {
        "pset_name": "Pset_SpaceCommon",
        "props": {
            "Reference": None,
            "IsExternal": False,
            "PubliclyAccessible": False,
            "HandicapAccessible": True,
            "OccupancyType": None,
            "OccupancyNumber": None,
            "GrossPlannedArea": None,
            "NetPlannedArea": None,
        },
    },
    "IfcSlab": {
        "pset_name": "Pset_SlabCommon",
        "props": {
            "LoadBearing": True,
            "IsExternal": False,
            "ThermalTransmittance": 0.25,
            "FireRating": "REI 60",
            "AcousticRating": "Rw 52 dB",
        },
    },
    "IfcFurnishingElement": {
        "pset_name": "Pset_FurnitureCommon",
        "props": {
            "Reference": None,
            "Manufacturer": "BuildFlow Reference Spec",
        },
    },
    "IfcLightFixture": {
        "pset_name": "Pset_LightFixtureTypeCommon",
        "props": {
            "Reference": None,
            "LightFixturePlacingType": "SURFACE",
            "MaintenanceFactor": 0.85,
            "NumberOfSources": 1,
            "TotalWattage": 36.0,
        },
    },
    "IfcCovering": {
        "pset_name": "Pset_CoveringCommon",
        "props": {
            "IsExternal": False,
            "Reference": None,
        },
    },
}


# ── Canonical Qto field lists + names ────────────────────────────────────

QTO_FIELDS: Dict[str, List[str]] = {
    "IfcWall": ["Length", "Width", "Height", "GrossSideArea", "NetSideArea", "GrossVolume", "NetVolume"],
    "IfcDoor": ["Width", "Height", "Area"],
    "IfcWindow": ["Width", "Height", "Area"],
    "IfcSpace": ["Height", "FinishCeilingHeight", "GrossFloorArea", "NetFloorArea", "GrossWallArea", "NetWallArea", "GrossVolume", "NetVolume", "GrossPerimeter"],
    "IfcSlab": ["Width", "Length", "Depth", "GrossArea", "NetArea", "GrossVolume", "NetVolume"],
    "IfcFurnishingElement": ["Width", "Depth", "Height"],
    "IfcLightFixture": [],
    "IfcCovering": ["GrossArea", "NetArea"],
}

QTO_NAMES: Dict[str, str] = {
    "IfcWall": "Qto_WallBaseQuantities",
    "IfcDoor": "Qto_DoorBaseQuantities",
    "IfcWindow": "Qto_WindowBaseQuantities",
    "IfcSpace": "Qto_SpaceBaseQuantities",
    "IfcSlab": "Qto_SlabBaseQuantities",
    "IfcFurnishingElement": "Qto_FurnitureBaseQuantities",
    "IfcCovering": "Qto_CoveringBaseQuantities",
}


# ── IFC4 PredefinedType allow-lists ─────────────────────────────────────
#
# In IFC4 most entity types gain a PredefinedType attribute that was
# absent or on a separate TypeObject in IFC2X3. We accept these values.

IFC4_PREDEFINED_TYPES: Dict[str, frozenset] = {
    "IfcWall": frozenset({
        "MOVABLE", "PARAPET", "PARTITIONING", "PLUMBINGWALL",
        "SHEAR", "SOLIDWALL", "STANDARD", "POLYGONAL",
        "ELEMENTEDWALL", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcColumn": frozenset({
        "COLUMN", "PILASTER", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcBeam": frozenset({
        "BEAM", "JOIST", "HOLLOWCORE", "LINTEL", "SPANDREL",
        "T_BEAM", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcDoor": frozenset({
        "DOOR", "GATE", "TRAPDOOR", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcWindow": frozenset({
        "WINDOW", "SKYLIGHT", "LIGHTDOME", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcSlab": frozenset({
        "FLOOR", "ROOF", "LANDING", "BASESLAB", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcCovering": frozenset({
        "CEILING", "FLOORING", "CLADDING", "ROOFING", "MOLDING",
        "SKIRTINGBOARD", "INSULATION", "MEMBRANE", "SLEEVING",
        "WRAPPING", "USERDEFINED", "NOTDEFINED",
    }),
    "IfcFurnishingElement": frozenset({
        "USERDEFINED", "NOTDEFINED",
    }),
    "IfcLightFixture": frozenset({
        "POINTSOURCE", "DIRECTIONSOURCE", "SECURITYLIGHTING",
        "USERDEFINED", "NOTDEFINED",
    }),
    "IfcBuildingElementProxy": frozenset({
        "COMPLEX", "ELEMENT", "PARTIAL", "PROVISIONFORVOID",
        "PROVISIONFORSPACE", "USERDEFINED", "NOTDEFINED",
    }),
}


# ── Schema-aware helpers ────────────────────────────────────────────────

def get_pset_config(
    ifc_class: str,
    schema: str = "IFC4",
) -> Optional[Dict[str, Any]]:
    """Return the canonical Pset config for a given IFC class.

    The Pset names are the same across IFC2X3 and IFC4 for the classes
    we support. The helper exists so a future schema might remap.
    """
    return PSET_DEFAULTS.get(ifc_class)


def get_qto_config(
    ifc_class: str,
    schema: str = "IFC4",
) -> Optional[Dict[str, Any]]:
    """Return the Qto name + field list for a given IFC class."""
    name = QTO_NAMES.get(ifc_class)
    fields = QTO_FIELDS.get(ifc_class)
    if not name or fields is None:
        return None
    return {"qto_name": name, "fields": fields}


def get_predefined_type_enum(
    ifc_class: str,
    schema: str = "IFC4",
) -> Optional[frozenset]:
    """Return the valid PredefinedType values for a class in the given schema.

    Returns None if the class has no PredefinedType in that schema.
    """
    if schema == "IFC4":
        return IFC4_PREDEFINED_TYPES.get(ifc_class)
    # IFC2X3 — import from the module-level frozenset already in buildflow_ifc.py
    # but also available here for standalone use.
    from . import buildflow_ifc
    return buildflow_ifc._PREDEFINED_TYPE_ENUMS.get(ifc_class)
