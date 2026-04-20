"""Wall builder — creates IfcWall with proper geometry and opening support."""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_wall(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcWall with extruded area solid representation.

    The wall is positioned along two vertices (start → end) with the given
    thickness and height from element properties. `storey_elevation` lifts
    the wall onto its storey — without it, every wall collapses to Z=0 and
    produces the "flying floor plates" bug.
    """
    props = elem.properties
    height = props.height or 3.0
    thickness = props.thickness or 0.25

    # Determine wall start/end from first two vertices
    if len(elem.vertices) >= 2:
        v0, v1 = elem.vertices[0], elem.vertices[1]
        dx = v1.x - v0.x
        dy = v1.y - v0.y
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1e-6:
            length = props.length or 1.0
    else:
        v0 = elem.vertices[0] if elem.vertices else None
        length = props.length or 1.0
        dx, dy = length, 0.0

    # Create the wall entity
    wall = api.run("root.create_entity", model, ifc_class="IfcWall")
    wall.GlobalId = new_guid()
    wall.Name = props.name
    wall.PredefinedType = "PARTITIONING" if props.is_partition else "STANDARD"

    # Assign to storey
    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, wall)

    # Build placement at wall origin. Emitters (TS massing-generator + the
    # baseline fixture) already put the absolute world Z on v0.z. When the
    # vertex carries an explicit Z we trust it; when it's zero we fall back
    # to the storey elevation so storey-local emitters still work.
    v0_z = v0.z if v0 else 0.0
    base_z = v0_z if v0_z else storey_elevation
    origin = model.create_entity("IfcCartesianPoint", Coordinates=(v0.x if v0 else 0.0, v0.y if v0 else 0.0, base_z))
    dir_len = math.sqrt(dx * dx + dy * dy) if (dx * dx + dy * dy) > 1e-12 else 1.0
    ref_dir = model.create_entity("IfcDirection", DirectionRatios=(dx / dir_len, dy / dir_len, 0.0))
    axis = model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))

    placement_3d = model.create_entity(
        "IfcAxis2Placement3D",
        Location=origin,
        Axis=axis,
        RefDirection=ref_dir,
    )
    wall.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=placement_3d,
    )

    # Build extruded rectangle profile (local coordinates: along X, thickness along Y)
    rect_profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=length,
        YDim=thickness,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(length / 2.0, 0.0)),
        ),
    )

    extrusion_dir = model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect_profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=extrusion_dir,
        Depth=height,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    wall.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return wall


def create_opening_in_wall(
    model: ifcopenshell.file,
    wall: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    offset_along_wall: float,
    sill_height: float,
    opening_width: float,
    opening_height: float,
) -> ifcopenshell.entity_instance:
    """Create an IfcOpeningElement that voids the wall.

    The opening is positioned relative to the wall's local coordinate system:
    - X: offset along wall length
    - Y: centered on wall thickness
    - Z: sill height above wall base
    """
    opening = api.run("root.create_entity", model, ifc_class="IfcOpeningElement")
    opening.GlobalId = new_guid()
    opening.Name = "Opening"
    opening.PredefinedType = "OPENING"

    # Placement relative to wall origin
    opening_origin = model.create_entity(
        "IfcCartesianPoint", Coordinates=(offset_along_wall, 0.0, sill_height)
    )
    opening.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=wall.ObjectPlacement,
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=opening_origin,
        ),
    )

    # Opening geometry: rectangular void
    rect = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=opening_width,
        YDim=1.0,  # through full wall + buffer
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(opening_width / 2.0, 0.0)),
        ),
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=opening_height,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    opening.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    # Void the wall with this opening
    model.create_entity(
        "IfcRelVoidsElement",
        GlobalId=new_guid(),
        RelatingBuildingElement=wall,
        RelatedOpeningElement=opening,
    )

    return opening


def fill_opening(
    model: ifcopenshell.file,
    opening: ifcopenshell.entity_instance,
    filling_element: ifcopenshell.entity_instance,
) -> None:
    """Create IfcRelFillsElement linking an opening to a window or door."""
    model.create_entity(
        "IfcRelFillsElement",
        GlobalId=new_guid(),
        RelatingOpeningElement=opening,
        RelatedBuildingElement=filling_element,
    )
