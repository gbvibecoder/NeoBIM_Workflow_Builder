"""Stair builder — creates IfcStairFlight with stepped geometry.

Slice 5 adds `create_stair_parametric`. Note: full IfcStair composite
assembly (IfcStair + flights + landings + railings) is reserved for
Phase 7's IFC4 hardening — this builder produces a single IfcStairFlight
matching the legacy output, but riser_count / riser_height come from
the BuildingModel (already validated by STAIR_RISE_MATCHES) instead of
free-form props.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Stair
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_stair(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
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
    stair.GlobalId = derive_guid("IfcStairFlight", elem.id)
    stair.Name = props.name
    stair.NumberOfRisers = riser_count
    stair.RiserHeight = riser_height
    stair.TreadLength = tread_depth

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, stair)

    # Position. Emitters put absolute world Z on v0.z; use it when present,
    # fall back to storey_elevation only when v0.z is zero.
    cx, cy, cz = 0.0, 0.0, storey_elevation
    if elem.vertices:
        v0 = elem.vertices[0]
        cx, cy = v0.x, v0.y
        cz = v0.z if v0.z else storey_elevation

    stair.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
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


def create_stair_parametric(
    stair: "Stair",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcStairFlight. riser_count and riser_height come
    directly from the BuildingModel (already validated by
    STAIR_RISE_MATCHES); no defaults applied."""
    stair_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcStairFlight")
    stair_entity.GlobalId = derive_guid("IfcStairFlight", stair.id)
    stair_entity.Name = stair.id
    stair_entity.NumberOfRisers = stair.riser_count
    stair_entity.RiserHeight = stair.riser_height
    stair_entity.TreadLength = stair.tread_depth

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, stair_entity)

    stair_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
        ),
    )

    # Stepped polyline profile (mirrors legacy create_stair geometry).
    total_run = stair.riser_count * stair.tread_depth
    points = [(0.0, 0.0)]
    for i in range(stair.riser_count):
        x = i * stair.tread_depth
        z = i * stair.riser_height
        points.append((x, z + stair.riser_height))
        points.append((x + stair.tread_depth, z + stair.riser_height))
    points.append((total_run, 0.0))
    points.append((0.0, 0.0))

    ifc_pts = [
        ifc_file.create_entity("IfcCartesianPoint", Coordinates=(x, z))
        for x, z in points
    ]
    polyline = ifc_file.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc_file.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    # Stair width — derive from plan_polygon bounding box width (Slice 5
    # uses the simpler legacy convention; Phase 7 will model proper
    # IfcStair composite).
    xs = [p.x for p in stair.plan_polygon]
    ys = [p.y for p in stair.plan_polygon]
    width = min(max(xs) - min(xs), max(ys) - min(ys))

    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
            RefDirection=ifc_file.create_entity(
                "IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 1.0, 0.0)
        ),
        Depth=width,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    stair_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return stair_entity
