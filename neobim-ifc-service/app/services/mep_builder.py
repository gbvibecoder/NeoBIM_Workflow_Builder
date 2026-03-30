"""MEP builder — creates ducts, pipes, cable trays, and equipment."""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_duct(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcDuctSegment with rectangular profile."""
    props = elem.properties
    length = props.length or 3.0
    width = props.width or 0.4
    height = props.height or 0.3

    duct = api.run("root.create_entity", model, ifc_class="IfcDuctSegment")
    duct.GlobalId = new_guid()
    duct.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, duct)

    cx, cy, cz = 0.0, 0.0, 0.0
    if elem.vertices:
        cx, cy, cz = elem.vertices[0].x, elem.vertices[0].y, elem.vertices[0].z

    duct.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=height,
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
        Depth=length,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    duct.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return duct


def create_pipe(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcPipeSegment with circular profile."""
    props = elem.properties
    length = props.length or 3.0
    diameter = props.diameter or 0.1
    radius = diameter / 2.0

    pipe = api.run("root.create_entity", model, ifc_class="IfcPipeSegment")
    pipe.GlobalId = new_guid()
    pipe.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, pipe)

    cx, cy, cz = 0.0, 0.0, 0.0
    if elem.vertices:
        cx, cy, cz = elem.vertices[0].x, elem.vertices[0].y, elem.vertices[0].z

    pipe.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    profile = model.create_entity(
        "IfcCircleProfileDef",
        ProfileType="AREA",
        Radius=radius,
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
        Depth=length,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    pipe.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return pipe


def create_cable_tray(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcCableCarrierSegment with U-profile."""
    props = elem.properties
    length = props.length or 3.0
    width = props.width or 0.3
    height = props.height or 0.1

    tray = api.run("root.create_entity", model, ifc_class="IfcCableCarrierSegment")
    tray.GlobalId = new_guid()
    tray.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, tray)

    cx, cy, cz = 0.0, 0.0, 0.0
    if elem.vertices:
        cx, cy, cz = elem.vertices[0].x, elem.vertices[0].y, elem.vertices[0].z

    tray.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=height,
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
        Depth=length,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    tray.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return tray


def create_equipment(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcFlowTerminal for mechanical equipment."""
    props = elem.properties
    width = props.width or 0.6
    height = props.height or 0.6
    length = props.length or 0.6

    equip = api.run("root.create_entity", model, ifc_class="IfcFlowTerminal")
    equip.GlobalId = new_guid()
    equip.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, equip)

    cx, cy, cz = 0.0, 0.0, 0.0
    if elem.vertices:
        cx, cy, cz = elem.vertices[0].x, elem.vertices[0].y, elem.vertices[0].z

    equip.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=length,
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=height,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    equip.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

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
