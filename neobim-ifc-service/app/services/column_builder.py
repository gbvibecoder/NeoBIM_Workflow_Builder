"""Column builder — creates IfcColumn with circular or rectangular profiles."""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_column(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcColumn at the element's position."""
    props = elem.properties
    height = props.height or 3.0
    radius = props.radius or 0.25

    column = api.run("root.create_entity", model, ifc_class="IfcColumn")
    column.GlobalId = new_guid()
    column.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, column)

    # Position at first vertex
    cx, cy = 0.0, 0.0
    if elem.vertices:
        cx, cy = elem.vertices[0].x, elem.vertices[0].y

    column.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, 0.0)),
        ),
    )

    # Circular profile
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
    column.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return column
