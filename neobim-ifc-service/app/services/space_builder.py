"""Space builder — creates IfcSpace for room volumes.

Slice 5 adds `create_space_parametric` (Room → IfcSpace).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Room
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


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
    space.GlobalId = derive_guid("IfcSpace", elem.id)
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


def create_space_parametric(
    room: "Room",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcSpace. Footprint is taken verbatim from the
    Room; ceiling height comes from ResolvedGeometry.extrusion_depth."""
    if geometry.representation_type != "SweptSolid":
        raise ValueError(
            f"Room '{room.id}' representation_type "
            f"'{geometry.representation_type}', expected 'SweptSolid'."
        )
    if geometry.profile_type != "polygon" or not geometry.profile_polygon:
        raise ValueError(
            f"Room '{room.id}' has no polygon footprint in resolved geometry."
        )
    if geometry.extrusion_depth is None or geometry.extrusion_depth <= 0:
        raise ValueError(
            f"Room '{room.id}' invalid ceiling height "
            f"{geometry.extrusion_depth}."
        )

    space_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcSpace")
    space_entity.GlobalId = derive_guid("IfcSpace", room.id)
    space_entity.Name = room.name
    space_entity.LongName = room.usage
    space_entity.CompositionType = "ELEMENT"

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, space_entity)

    space_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
        ),
    )

    ifc_pts = [
        ifc_file.create_entity(
            "IfcCartesianPoint",
            Coordinates=(v.x - placement.origin.x, v.y - placement.origin.y),
        )
        for v in geometry.profile_polygon
    ]
    ifc_pts.append(ifc_pts[0])
    polyline = ifc_file.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc_file.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=geometry.extrusion_depth,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    space_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return space_entity
