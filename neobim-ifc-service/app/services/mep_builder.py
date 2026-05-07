"""MEP builder — creates ducts, pipes, cable trays, and equipment.

Default behaviour is **bodyless**: the IFC element, Pset, and IfcSystem
grouping are still produced, but `.Representation` is left unset so the
viewer doesn't render the chaotic horizontal rods the absolute-coordinate
extrusion pattern used to produce. This matches the frozen TS exporter
(`emitMEPGeometry=false` by default, gated via Phase 1 Track B). Rich mode
"mep" / "full" re-enables bodies via `emit_geometry=True`.

Slice 5 adds three parametric variants — `create_mep_equipment_parametric`,
`create_mep_segment_parametric`, `create_mep_terminal_parametric` —
consuming BuildingModel MEPEquipment / MEPSegment / MEPTerminal. The
parametric path emits IfcAirHandlingUnit / IfcDuctSegment etc. with
ResolvedPlacement-driven local placements. Bodyless-by-default contract
preserved.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import (
        MEPEquipment,
        MEPSegment,
        MEPTerminal,
    )
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def _mep_placement(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey_elevation: float,
) -> ifcopenshell.entity_instance:
    """Build an IfcLocalPlacement at the element's first vertex. Emitters
    put absolute world Z on v0.z; we honour it when present and fall back
    to the storey elevation only when v0.z is zero (storey-local emitter).
    Shared by every MEP helper."""
    cx, cy, cz = 0.0, 0.0, storey_elevation
    if elem.vertices:
        v0 = elem.vertices[0]
        cx, cy = v0.x, v0.y
        cz = v0.z if v0.z else storey_elevation
    return model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )


def _attach_extruded_body(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    profile: ifcopenshell.entity_instance,
    extrude_direction: tuple[float, float, float],
    depth: float,
) -> None:
    """Attach a SweptSolid body to an MEP element. Factored out so the
    bodyless path simply skips this call."""
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=extrude_direction),
        Depth=depth,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    element.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )


def create_duct(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Create an IfcDuctSegment with rectangular profile.

    Bodyless by default. Pass `emit_geometry=True` (rich mode "mep"/"full")
    to attach a SweptSolid body.
    """
    props = elem.properties
    length = props.length or 3.0
    width = props.width or 0.4
    height = props.height or 0.3

    duct = api.run("root.create_entity", model, ifc_class="IfcDuctSegment")
    duct.GlobalId = derive_guid("IfcDuctSegment", elem.id)
    duct.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, duct)

    duct.ObjectPlacement = _mep_placement(model, elem, storey_elevation)

    if emit_geometry:
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=width,
            YDim=height,
        )
        _attach_extruded_body(model, duct, context, profile, (1.0, 0.0, 0.0), length)

    return duct


def create_pipe(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Create an IfcPipeSegment with circular profile.

    Bodyless by default. Pass `emit_geometry=True` (rich mode "mep"/"full")
    to attach a SweptSolid body.
    """
    props = elem.properties
    length = props.length or 3.0
    diameter = props.diameter or 0.1
    radius = diameter / 2.0

    pipe = api.run("root.create_entity", model, ifc_class="IfcPipeSegment")
    pipe.GlobalId = derive_guid("IfcPipeSegment", elem.id)
    pipe.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, pipe)

    pipe.ObjectPlacement = _mep_placement(model, elem, storey_elevation)

    if emit_geometry:
        profile = model.create_entity(
            "IfcCircleProfileDef",
            ProfileType="AREA",
            Radius=radius,
        )
        _attach_extruded_body(model, pipe, context, profile, (1.0, 0.0, 0.0), length)

    return pipe


def create_cable_tray(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Create an IfcCableCarrierSegment with rectangular profile.

    Bodyless by default — matches the locked "no flying MEP" visual floor.
    """
    props = elem.properties
    length = props.length or 3.0
    width = props.width or 0.3
    height = props.height or 0.1

    tray = api.run("root.create_entity", model, ifc_class="IfcCableCarrierSegment")
    tray.GlobalId = derive_guid("IfcCableCarrierSegment", elem.id)
    tray.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, tray)

    tray.ObjectPlacement = _mep_placement(model, elem, storey_elevation)

    if emit_geometry:
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=width,
            YDim=height,
        )
        _attach_extruded_body(model, tray, context, profile, (1.0, 0.0, 0.0), length)

    return tray


def create_equipment(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Create an IfcFlowTerminal for mechanical equipment.

    Bodyless by default.
    """
    props = elem.properties
    width = props.width or 0.6
    height = props.height or 0.6
    length = props.length or 0.6

    equip = api.run("root.create_entity", model, ifc_class="IfcFlowTerminal")
    equip.GlobalId = derive_guid("IfcFlowTerminal", elem.id)
    equip.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, equip)

    equip.ObjectPlacement = _mep_placement(model, elem, storey_elevation)

    if emit_geometry:
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=width,
            YDim=length,
        )
        _attach_extruded_body(model, equip, context, profile, (0.0, 0.0, 1.0), height)

    return equip


# ── System name → IfcDistributionSystem PredefinedType (Phase 2 / Fix 8) ──
#
# IfcDistributionSystem subclasses IfcSystem and adds a PredefinedType
# enum so downstream tools can disambiguate "this group is HVAC" from
# "this group is plumbing" without parsing the system Name. Mirrors the
# Fix 8 contract from §2.1 of the TS-exporter R&D report.
_SYSTEM_PREDEFINED_TYPE: dict[str, str] = {
    "HVAC": "VENTILATION",
    "Plumbing": "DOMESTICCOLDWATER",
    "Electrical": "ELECTRICAL",
    "Data": "DATA",
}


def _system_predefined_type(system_name: str) -> str:
    """Map an internal system bucket name to an IFC4 PredefinedType.

    Unknown buckets fall through to USERDEFINED — the IFC4 spec value
    for "system kind not in the standard enum but the modeller still
    wants to mark it as distribution".
    """
    return _SYSTEM_PREDEFINED_TYPE.get(system_name, "USERDEFINED")


# ─── Slice 5 parametric variants ──────────────────────────────────────


_SEGMENT_IFC_CLASS = {
    "HVAC": "IfcDuctSegment",
    "Plumbing": "IfcPipeSegment",
    "Electrical": "IfcCableCarrierSegment",
    "FireProtection": "IfcPipeSegment",
}

_TERMINAL_IFC_CLASS = {
    "HVAC": "IfcAirTerminal",
    "Plumbing": "IfcSanitaryTerminal",
    "Electrical": "IfcLightFixture",
    "FireProtection": "IfcFireSuppressionTerminal",
}

_EQUIPMENT_IFC_CLASS = {
    # IFC4 only — IfcAirHandlingUnit was added in IFC4x3 and isn't in the
    # ifcopenshell IFC4 schema; IfcUnitaryEquipment with PredefinedType
    # AIRHANDLER is the correct IFC4 mapping.
    "HVAC": "IfcUnitaryEquipment",
    "Plumbing": "IfcPump",
    "Electrical": "IfcElectricDistributionBoard",
    # FireProtection has no canonical "source" in IFC4; emit as
    # IfcUnitaryEquipment for now (Phase 5a will revisit).
    "FireProtection": "IfcUnitaryEquipment",
}


def _placement_from_resolved(
    ifc_file: ifcopenshell.file, placement: "ResolvedPlacement"
) -> ifcopenshell.entity_instance:
    """Build an IfcLocalPlacement from a ResolvedPlacement. No fallback —
    every coordinate comes from the resolver."""
    return ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
        ),
    )


def create_mep_equipment_parametric(
    equip: "MEPEquipment",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric MEP source equipment. Bodyless by default
    (matches the locked IFC visual quality floor — no flying MEP)."""
    ifc_class = _EQUIPMENT_IFC_CLASS.get(equip.system_kind, "IfcFlowTerminal")
    entity = api.run("root.create_entity", ifc_file, ifc_class=ifc_class)
    entity.GlobalId = derive_guid(ifc_class, equip.id)
    entity.Name = equip.name or equip.id
    if hasattr(entity, "PredefinedType"):
        # Some IFC equipment subclasses have a PredefinedType attribute
        try:
            entity.PredefinedType = equip.predefined_type
        except Exception:
            pass  # Schema constraint — silently leave default if value rejected

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, entity)
    entity.ObjectPlacement = _placement_from_resolved(ifc_file, placement)

    if emit_geometry and geometry.representation_type == "BoundingBox":
        if geometry.bbox_x is None or geometry.bbox_y is None or geometry.bbox_z is None:
            raise ValueError(
                f"Equipment '{equip.id}' BoundingBox geometry missing bbox dimensions."
            )
        profile = ifc_file.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=float(geometry.bbox_x),
            YDim=float(geometry.bbox_y),
        )
        _attach_extruded_body(
            ifc_file, entity, body_context, profile, (0.0, 0.0, 1.0),
            float(geometry.bbox_z),
        )
    return entity


def create_mep_segment_parametric(
    seg: "MEPSegment",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric MEP segment (duct / pipe / cable tray)."""
    ifc_class = _SEGMENT_IFC_CLASS.get(seg.system_kind, "IfcPipeSegment")
    entity = api.run("root.create_entity", ifc_file, ifc_class=ifc_class)
    entity.GlobalId = derive_guid(ifc_class, seg.id)
    entity.Name = seg.id
    # Slice 6 — IDS reduction: set PredefinedType (RIGIDSEGMENT etc.) per
    # the IFC4 schema. Different segment classes accept different enums;
    # IDS rules check the attribute is populated.
    if hasattr(entity, "PredefinedType"):
        try:
            entity.PredefinedType = seg.predefined_type
        except Exception:
            pass  # schema enum mismatch — leave default

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, entity)
    entity.ObjectPlacement = _placement_from_resolved(ifc_file, placement)

    if emit_geometry and geometry.representation_type == "SweptSolid":
        if geometry.profile_type == "circle":
            profile = ifc_file.create_entity(
                "IfcCircleProfileDef",
                ProfileType="AREA",
                Radius=geometry.profile_x_dim,
            )
        else:
            if geometry.profile_x_dim is None or geometry.profile_y_dim is None:
                raise ValueError(
                    f"Segment '{seg.id}' rectangle profile missing dimensions."
                )
            profile = ifc_file.create_entity(
                "IfcRectangleProfileDef",
                ProfileType="AREA",
                XDim=float(geometry.profile_x_dim),
                YDim=float(geometry.profile_y_dim),
            )
        _attach_extruded_body(
            ifc_file,
            entity,
            body_context,
            profile,
            (1.0, 0.0, 0.0),  # local X — placement carries world rotation
            geometry.extrusion_depth,
        )
    return entity


def create_mep_terminal_parametric(
    term: "MEPTerminal",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
    emit_geometry: bool = False,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric MEP terminal (air diffuser / sanitary fitting / etc.)."""
    ifc_class = _TERMINAL_IFC_CLASS.get(term.system_kind, "IfcFlowTerminal")
    entity = api.run("root.create_entity", ifc_file, ifc_class=ifc_class)
    entity.GlobalId = derive_guid(ifc_class, term.id)
    entity.Name = term.name or term.id
    # Slice 6 — IDS reduction: PredefinedType per IFC4 enum.
    if hasattr(entity, "PredefinedType"):
        try:
            entity.PredefinedType = term.predefined_type
        except Exception:
            pass

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, entity)
    entity.ObjectPlacement = _placement_from_resolved(ifc_file, placement)

    if emit_geometry and geometry.representation_type == "BoundingBox":
        if geometry.bbox_x is None or geometry.bbox_y is None or geometry.bbox_z is None:
            raise ValueError(
                f"Terminal '{term.id}' BoundingBox geometry missing bbox dimensions."
            )
        profile = ifc_file.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=float(geometry.bbox_x),
            YDim=float(geometry.bbox_y),
        )
        _attach_extruded_body(
            ifc_file, entity, body_context, profile, (0.0, 0.0, 1.0),
            float(geometry.bbox_z),
        )
    return entity


def create_mep_system(
    model: ifcopenshell.file,
    building: ifcopenshell.entity_instance,
    system_name: str,
    elements: list[ifcopenshell.entity_instance],
) -> ifcopenshell.entity_instance | None:
    """Group MEP elements into an IfcDistributionSystem and link to the building.

    Phase 2 (Fix 8): emits IfcDistributionSystem (subclass of IfcSystem)
    with a discipline-appropriate PredefinedType so downstream tools can
    distinguish HVAC vs plumbing vs electrical without parsing the Name.
    """
    if not elements:
        return None

    system = api.run("root.create_entity", model, ifc_class="IfcDistributionSystem")
    system.GlobalId = derive_guid("IfcDistributionSystem", system_name)
    system.Name = system_name
    system.PredefinedType = _system_predefined_type(system_name)

    # Group elements into system. IfcRelAssignsToGroup pattern unchanged
    # — only the relating group's class differs from Phase 1.
    model.create_entity(
        "IfcRelAssignsToGroup",
        GlobalId=derive_guid("IfcRelAssignsToGroup", system.GlobalId),
        RelatedObjects=elements,
        RelatingGroup=system,
    )

    # Link system to building
    model.create_entity(
        "IfcRelServicesBuildings",
        GlobalId=derive_guid("IfcRelServicesBuildings", system.GlobalId, building.GlobalId),
        RelatingSystem=system,
        RelatedBuildings=[building],
    )

    return system
