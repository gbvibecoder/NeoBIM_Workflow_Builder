"""Slab builder — creates IfcSlab for floors and roofs."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement, FootprintPoint
from app.utils.guid import new_guid


def create_slab(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    footprint: list[FootprintPoint] | None = None,
    elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcSlab from element data or building footprint.

    Uses IfcArbitraryClosedProfileDef for non-rectangular footprints,
    extruded by slab thickness.
    """
    props = elem.properties
    thickness = props.thickness or 0.30
    is_roof = elem.type == "roof" or "roof" in props.name.lower()

    slab = api.run("root.create_entity", model, ifc_class="IfcSlab")
    slab.GlobalId = new_guid()
    slab.Name = props.name
    slab.PredefinedType = "ROOF" if is_roof else "FLOOR"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, slab)

    # Placement at slab elevation
    slab.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, elevation)),
        ),
    )

    # Build footprint polyline from element vertices or building footprint
    pts = footprint if footprint else []
    if not pts and elem.vertices:
        pts = [FootprintPoint(x=v.x, y=v.y) for v in elem.vertices if hasattr(v, "x")]

    if len(pts) >= 3:
        # Arbitrary closed profile from polygon
        ifc_points = [
            model.create_entity("IfcCartesianPoint", Coordinates=(p.x, p.y))
            for p in pts
        ]
        # Close the polyline
        ifc_points.append(ifc_points[0])

        polyline = model.create_entity("IfcPolyline", Points=ifc_points)
        profile = model.create_entity(
            "IfcArbitraryClosedProfileDef",
            ProfileType="AREA",
            OuterCurve=polyline,
        )
    else:
        # Fallback: rectangular profile
        width = 20.0
        depth = 20.0
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=width,
            YDim=depth,
            Position=model.create_entity(
                "IfcAxis2Placement2D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(width / 2.0, depth / 2.0)),
            ),
        )

    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=thickness,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    slab.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return slab
