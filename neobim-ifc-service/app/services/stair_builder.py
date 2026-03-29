"""Stair builder — creates IfcStairFlight with stepped geometry."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_stair(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcStairFlight as a simplified extruded solid."""
    props = elem.properties
    height = props.height or 3.0
    width = props.width or 1.2
    riser_count = props.riser_count or 17
    riser_height = props.riser_height or (height / riser_count)
    tread_depth = props.tread_depth or 0.28
    total_run = riser_count * tread_depth

    stair = api.run("root.create_entity", model, ifc_class="IfcStairFlight")
    stair.GlobalId = new_guid()
    stair.Name = props.name
    stair.NumberOfRisers = riser_count
    stair.RiserHeight = riser_height
    stair.TreadLength = tread_depth

    api.run("spatial.assign_container", model, relating_structure=storey, products=[stair])

    # Position
    cx, cy = 0.0, 0.0
    if elem.vertices:
        cx, cy = elem.vertices[0].x, elem.vertices[0].y

    stair.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, 0.0)),
        ),
    )

    # Build stepped profile as polyline
    points = [(0.0, 0.0)]
    for i in range(riser_count):
        x = i * tread_depth
        z = i * riser_height
        points.append((x, z + riser_height))
        points.append((x + tread_depth, z + riser_height))
    # Close back to start
    points.append((total_run, 0.0))
    points.append((0.0, 0.0))

    ifc_pts = [
        model.create_entity("IfcCartesianPoint", Coordinates=(x, z))
        for x, z in points
    ]
    polyline = model.create_entity("IfcPolyline", Points=ifc_pts)
    profile = model.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    # Extrude along Y for stair width
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            RefDirection=model.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 1.0, 0.0)),
        Depth=width,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    stair.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return stair
