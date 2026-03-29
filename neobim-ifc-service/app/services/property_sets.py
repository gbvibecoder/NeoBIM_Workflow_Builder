"""Standard IFC property set and quantity generators (Pset_*, Qto_*)."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


# ── Property set helpers ─────────────────────────────────────────────


def _create_pset(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    pset_name: str,
    properties: dict[str, object],
) -> None:
    """Create a property set and assign it to an element."""
    pset = api.run(
        "pset.add_pset",
        model,
        product=element,
        name=pset_name,
    )
    api.run(
        "pset.edit_pset",
        model,
        pset=pset,
        properties=properties,
    )


def _create_qto(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    qto_name: str,
    quantities: dict[str, float],
) -> None:
    """Create a quantity set and assign it to an element."""
    qto = api.run(
        "pset.add_qto",
        model,
        product=element,
        name=qto_name,
    )
    api.run(
        "pset.edit_qto",
        model,
        qto=qto,
        properties=quantities,
    )


# ── Wall property sets ───────────────────────────────────────────────


def add_wall_psets(
    model: ifcopenshell.file,
    ifc_wall: ifcopenshell.entity_instance,
    elem: GeometryElement,
    building_type: str = "",
) -> None:
    """Add Pset_WallCommon and Qto_WallBaseQuantities to a wall."""
    props = elem.properties
    is_external = not (props.is_partition or False)

    _create_pset(model, ifc_wall, "Pset_WallCommon", {
        "Reference": props.name,
        "IsExternal": is_external,
        "LoadBearing": is_external,
        "FireRating": "REI 120" if is_external else "EI 60",
        "ThermalTransmittance": 0.25 if is_external else 0.0,
        "ExtendToStructure": False,
        "Compartmentation": is_external,
    })

    length = props.length or 1.0
    height = props.height or 3.0
    thickness = props.thickness or 0.25
    gross_area = length * height
    net_area = gross_area * 0.85  # approximate window/door deduction

    _create_qto(model, ifc_wall, "Qto_WallBaseQuantities", {
        "Length": length,
        "Height": height,
        "Width": thickness,
        "GrossSideArea": gross_area,
        "NetSideArea": net_area,
        "GrossVolume": gross_area * thickness,
        "NetVolume": net_area * thickness,
    })


# ── Slab property sets ──────────────────────────────────────────────


def add_slab_psets(
    model: ifcopenshell.file,
    ifc_slab: ifcopenshell.entity_instance,
    elem: GeometryElement,
    is_roof: bool = False,
) -> None:
    """Add Pset_SlabCommon and Qto_SlabBaseQuantities."""
    props = elem.properties
    thickness = props.thickness or 0.3

    _create_pset(model, ifc_slab, "Pset_SlabCommon", {
        "Reference": props.name,
        "IsExternal": is_roof,
        "LoadBearing": True,
        "FireRating": "REI 120",
        "ThermalTransmittance": 0.20 if is_roof else 0.0,
    })

    area = props.area or 100.0
    perimeter = 40.0  # approximate

    _create_qto(model, ifc_slab, "Qto_SlabBaseQuantities", {
        "Depth": thickness,
        "Perimeter": perimeter,
        "GrossArea": area,
        "NetArea": area * 0.95,
        "GrossVolume": area * thickness,
        "NetVolume": area * 0.95 * thickness,
    })


# ── Column property sets ────────────────────────────────────────────


def add_column_psets(
    model: ifcopenshell.file,
    ifc_col: ifcopenshell.entity_instance,
    elem: GeometryElement,
) -> None:
    """Add Pset_ColumnCommon and Qto_ColumnBaseQuantities."""
    props = elem.properties
    height = props.height or 3.0
    radius = props.radius or 0.25
    import math
    cross_area = math.pi * radius * radius

    _create_pset(model, ifc_col, "Pset_ColumnCommon", {
        "Reference": props.name,
        "LoadBearing": True,
        "FireRating": "R 120",
    })

    _create_qto(model, ifc_col, "Qto_ColumnBaseQuantities", {
        "Length": height,
        "CrossSectionArea": cross_area,
        "OuterSurfaceArea": 2 * math.pi * radius * height,
        "GrossVolume": cross_area * height,
        "NetVolume": cross_area * height,
    })


# ── Window property sets ────────────────────────────────────────────


def add_window_psets(
    model: ifcopenshell.file,
    ifc_window: ifcopenshell.entity_instance,
    elem: GeometryElement,
) -> None:
    """Add Pset_WindowCommon."""
    _create_pset(model, ifc_window, "Pset_WindowCommon", {
        "Reference": elem.properties.name,
        "IsExternal": True,
        "ThermalTransmittance": 1.4,
        "GlazingAreaFraction": 0.85,
        "SmokeStop": False,
    })


# ── Door property sets ──────────────────────────────────────────────


def add_door_psets(
    model: ifcopenshell.file,
    ifc_door: ifcopenshell.entity_instance,
    elem: GeometryElement,
) -> None:
    """Add Pset_DoorCommon."""
    width = elem.properties.width or 1.0
    _create_pset(model, ifc_door, "Pset_DoorCommon", {
        "Reference": elem.properties.name,
        "IsExternal": elem.properties.is_exterior or False,
        "FireRating": "EI 30",
        "SmokeStop": False,
        "HandicapAccessible": width >= 0.9,
    })


# ── Space property sets ─────────────────────────────────────────────


def add_space_psets(
    model: ifcopenshell.file,
    ifc_space: ifcopenshell.entity_instance,
    elem: GeometryElement,
) -> None:
    """Add Pset_SpaceCommon."""
    props = elem.properties
    area = props.area or 20.0

    _create_pset(model, ifc_space, "Pset_SpaceCommon", {
        "Reference": props.space_name or props.name,
        "Category": props.space_usage or "USERDEFINED",
        "IsExternal": False,
        "GrossPlannedArea": area,
        "NetPlannedArea": area * 0.90,
    })


# ── Beam property sets ──────────────────────────────────────────────


def add_beam_psets(
    model: ifcopenshell.file,
    ifc_beam: ifcopenshell.entity_instance,
    elem: GeometryElement,
) -> None:
    """Add Pset_BeamCommon and Qto_BeamBaseQuantities."""
    props = elem.properties
    length = props.length or 6.0

    _create_pset(model, ifc_beam, "Pset_BeamCommon", {
        "Reference": props.name,
        "LoadBearing": True,
        "FireRating": "R 90",
    })

    _create_qto(model, ifc_beam, "Qto_BeamBaseQuantities", {
        "Length": length,
    })
