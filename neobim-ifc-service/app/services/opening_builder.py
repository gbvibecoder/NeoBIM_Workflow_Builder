"""Window and door builder with proper IfcOpeningElement relationships."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.services.wall_builder import create_opening_in_wall, fill_opening
from app.utils.guid import new_guid


def create_window(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    parent_wall: ifcopenshell.entity_instance | None = None,
) -> ifcopenshell.entity_instance:
    """Create an IfcWindow, optionally cutting an opening in the parent wall."""
    props = elem.properties
    width = props.width or 1.2
    height = props.height or 1.5
    sill_height = props.sill_height or 0.9
    wall_offset = props.wall_offset or 0.0

    window = api.run("root.create_entity", model, ifc_class="IfcWindow")
    window.GlobalId = new_guid()
    window.Name = props.name
    window.OverallHeight = height
    window.OverallWidth = width

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, window)

    # If parent wall exists, create proper opening + fill relationship
    if parent_wall is not None:
        opening = create_opening_in_wall(
            model, parent_wall, context,
            offset_along_wall=wall_offset,
            sill_height=sill_height,
            opening_width=width,
            opening_height=height,
        )

        # Place window at opening location
        window.ObjectPlacement = model.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=opening.ObjectPlacement,
            RelativePlacement=model.create_entity(
                "IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            ),
        )

        fill_opening(model, opening, window)
    else:
        # Standalone window (no parent wall found)
        cx, cy, cz = 0.0, 0.0, sill_height
        if elem.vertices:
            cx, cy = elem.vertices[0].x, elem.vertices[0].y

        window.ObjectPlacement = model.create_entity(
            "IfcLocalPlacement",
            RelativePlacement=model.create_entity(
                "IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
            ),
        )

    # Window geometry (simplified glass panel)
    rect = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=0.05,  # glass thickness
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(width / 2.0, 0.0)),
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
        Depth=height,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    window.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return window


def create_door(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    parent_wall: ifcopenshell.entity_instance | None = None,
) -> ifcopenshell.entity_instance:
    """Create an IfcDoor, optionally cutting an opening in the parent wall."""
    props = elem.properties
    width = props.width or 1.0
    height = props.height or 2.1
    wall_offset = props.wall_offset or 0.0

    door = api.run("root.create_entity", model, ifc_class="IfcDoor")
    door.GlobalId = new_guid()
    door.Name = props.name
    door.OverallHeight = height
    door.OverallWidth = width
    door.OperationType = "DOUBLE_DOOR_SINGLE_SWING" if width >= 1.8 else "SINGLE_SWING_LEFT"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, door)

    if parent_wall is not None:
        opening = create_opening_in_wall(
            model, parent_wall, context,
            offset_along_wall=wall_offset,
            sill_height=0.0,  # doors start at floor
            opening_width=width,
            opening_height=height,
        )
        door.ObjectPlacement = model.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=opening.ObjectPlacement,
            RelativePlacement=model.create_entity(
                "IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            ),
        )
        fill_opening(model, opening, door)
    else:
        cx, cy = 0.0, 0.0
        if elem.vertices:
            cx, cy = elem.vertices[0].x, elem.vertices[0].y
        door.ObjectPlacement = model.create_entity(
            "IfcLocalPlacement",
            RelativePlacement=model.create_entity(
                "IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, 0.0)),
            ),
        )

    # Door geometry (simplified panel)
    rect = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=0.05,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(width / 2.0, 0.0)),
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
        Depth=height,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    door.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return door
