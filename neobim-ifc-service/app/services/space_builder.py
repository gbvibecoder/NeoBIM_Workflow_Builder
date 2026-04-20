"""Space builder — creates IfcSpace for room volumes."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_space(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcSpace representing an interior room volume."""
    props = elem.properties
    height = props.height or 3.0

    space = api.run("root.create_entity", model, ifc_class="IfcSpace")
    space.GlobalId = new_guid()
    space.Name = props.space_name or props.name
    space.LongName = props.space_usage or ""
    space.CompositionType = "ELEMENT"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, space)

    # Position from vertex centroid. Emitters put absolute world Z on each
    # vertex, so the min-Z of the polygon is the floor level for this space.
    # Fall back to storey_elevation if no vertices or vertices carry z=0.
    cx, cy, cz = 0.0, 0.0, storey_elevation
    if elem.vertices:
        cx = sum(v.x for v in elem.vertices) / len(elem.vertices)
        cy = sum(v.y for v in elem.vertices) / len(elem.vertices)
        vz = min(v.z for v in elem.vertices)
        cz = vz if vz else storey_elevation

    space.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    # Build space geometry from footprint polygon or vertices
    fp = props.space_footprint
    pts = []
    if fp and len(fp) >= 3:
        pts = [(p.x, p.y) for p in fp]
    elif len(elem.vertices) >= 3:
        pts = [(v.x, v.y) for v in elem.vertices]

    if len(pts) >= 3:
        ifc_points = [
            model.create_entity("IfcCartesianPoint", Coordinates=(x, y))
            for x, y in pts
        ]
        ifc_points.append(ifc_points[0])  # close polyline
        polyline = model.create_entity("IfcPolyline", Points=ifc_points)
        profile = model.create_entity(
            "IfcArbitraryClosedProfileDef",
            ProfileType="AREA",
            OuterCurve=polyline,
        )
    else:
        # Fallback: small rectangular space
        area = props.area or 20.0
        side = area ** 0.5
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=side,
            YDim=side,
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
    space.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return space
