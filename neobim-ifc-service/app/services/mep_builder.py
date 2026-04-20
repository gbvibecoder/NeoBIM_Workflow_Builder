"""MEP builder — creates ducts, pipes, cable trays, and equipment.

Default behaviour is **bodyless**: the IFC element, Pset, and IfcSystem
grouping are still produced, but `.Representation` is left unset so the
viewer doesn't render the chaotic horizontal rods the absolute-coordinate
extrusion pattern used to produce. This matches the frozen TS exporter
(`emitMEPGeometry=false` by default, gated via Phase 1 Track B). Rich mode
"mep" / "full" re-enables bodies via `emit_geometry=True`.
"""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


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
    duct.GlobalId = new_guid()
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
    pipe.GlobalId = new_guid()
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
    tray.GlobalId = new_guid()
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
    equip.GlobalId = new_guid()
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


def create_mep_system(
    model: ifcopenshell.file,
    building: ifcopenshell.entity_instance,
    system_name: str,
    elements: list[ifcopenshell.entity_instance],
) -> ifcopenshell.entity_instance | None:
    """Group MEP elements into an IfcSystem and link to the building."""
    if not elements:
        return None

    system = api.run("root.create_entity", model, ifc_class="IfcSystem")
    system.GlobalId = new_guid()
    system.Name = system_name

    # Group elements into system
    model.create_entity(
        "IfcRelAssignsToGroup",
        GlobalId=new_guid(),
        RelatedObjects=elements,
        RelatingGroup=system,
    )

    # Link system to building
    model.create_entity(
        "IfcRelServicesBuildings",
        GlobalId=new_guid(),
        RelatingSystem=system,
        RelatedBuildings=[building],
    )

    return system
