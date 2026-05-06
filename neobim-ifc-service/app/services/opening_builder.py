"""Window and door builder with proper IfcOpeningElement relationships.

Slice 5 adds three parametric variants alongside the legacy functions:

  * `create_opening_parametric(opening, placement, parent_wall_entity,
    ifc_file, body_context)` — IfcOpeningElement + IfcRelVoidsElement.
  * `create_window_parametric(window, parent_opening, parent_opening_entity,
    ifc_file, body_context, ifc_storey, type_registry)` — IfcWindow +
    IfcRelFillsElement.
  * `create_door_parametric(door, parent_opening, parent_opening_entity,
    ifc_file, body_context, ifc_storey, type_registry)` — IfcDoor +
    IfcRelFillsElement.

The orchestrator calls them in order: opening first, then the filler.
Door / Window dimensions come from the parent Opening (where width /
height live in the BuildingModel schema), not from the filler node
itself — this matches the structural reality (the wall opening defines
the slot; the door / window panel fills it).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.services.wall_builder import create_opening_in_wall, fill_opening
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Door, Opening, Window
    from app.services.placement_resolver import ResolvedPlacement


def create_window(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    parent_wall: ifcopenshell.entity_instance | None = None,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcWindow, optionally cutting an opening in the parent wall.

    When a `parent_wall` is supplied the window inherits the wall's placement
    (which already carries the storey elevation). The standalone branch uses
    `storey_elevation` directly so glazing doesn't collapse to Z=0.
    """
    props = elem.properties
    width = props.width or 1.2
    height = props.height or 1.5
    sill_height = props.sill_height or 0.9
    wall_offset = props.wall_offset or 0.0

    window = api.run("root.create_entity", model, ifc_class="IfcWindow")
    window.GlobalId = derive_guid("IfcWindow", elem.id)
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
        # Standalone window (no parent wall). Emitter puts absolute Z on v0.
        cx, cy = 0.0, 0.0
        base_z = storey_elevation
        if elem.vertices:
            v0 = elem.vertices[0]
            cx, cy = v0.x, v0.y
            base_z = v0.z if v0.z else storey_elevation
        cz = base_z + sill_height

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
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcDoor, optionally cutting an opening in the parent wall.

    When a `parent_wall` is supplied the door inherits the wall's placement
    (which already carries the storey elevation). The standalone branch
    uses `storey_elevation` so orphaned doors don't stack at Z=0.
    """
    props = elem.properties
    width = props.width or 1.0
    height = props.height or 2.1
    wall_offset = props.wall_offset or 0.0

    door = api.run("root.create_entity", model, ifc_class="IfcDoor")
    door.GlobalId = derive_guid("IfcDoor", elem.id)
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
        cz = storey_elevation
        if elem.vertices:
            v0 = elem.vertices[0]
            cx, cy = v0.x, v0.y
            cz = v0.z if v0.z else storey_elevation
        door.ObjectPlacement = model.create_entity(
            "IfcLocalPlacement",
            RelativePlacement=model.create_entity(
                "IfcAxis2Placement3D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
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


# ─── Slice 5 parametric variants ──────────────────────────────────────


def create_opening_parametric(
    opening: "Opening",
    placement: "ResolvedPlacement",
    parent_wall_entity: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcOpeningElement that voids `parent_wall_entity`.

    Placement is given relative to the wall (placement.relative_to_node_id ==
    wall.id). Geometry is derived from `opening.width × wall.thickness +
    buffer × opening.height` — mirrors `create_opening_in_wall` but reads
    BuildingModel fields instead of legacy props.
    """
    opening_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcOpeningElement")
    opening_entity.GlobalId = derive_guid("IfcOpeningElement", opening.id)
    opening_entity.Name = opening.id
    opening_entity.PredefinedType = "OPENING"

    # Local placement relative to the parent wall.
    opening_origin = ifc_file.create_entity(
        "IfcCartesianPoint",
        Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
    )
    opening_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=parent_wall_entity.ObjectPlacement,
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D", Location=opening_origin
        ),
    )

    # Opening geometry: rectangle (width × wall_thickness+buffer) extruded
    # by opening.height. The buffer ensures the cut goes fully through the
    # wall thickness (mirrors the legacy hard-coded 1.0 buffer).
    rect = ifc_file.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=opening.width,
        YDim=1.0,  # full-wall pass-through buffer (legacy convention)
        Position=ifc_file.create_entity(
            "IfcAxis2Placement2D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(opening.width / 2.0, 0.0)
            ),
        ),
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=opening.height,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    opening_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    # IfcRelVoidsElement linking opening into the wall.
    ifc_file.create_entity(
        "IfcRelVoidsElement",
        GlobalId=derive_guid(
            "IfcRelVoidsElement", parent_wall_entity.GlobalId, opening_entity.GlobalId
        ),
        RelatingBuildingElement=parent_wall_entity,
        RelatedOpeningElement=opening_entity,
    )
    return opening_entity


def create_window_parametric(
    window: "Window",
    parent_opening: "Opening",
    parent_opening_entity: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcWindow filling `parent_opening_entity`.

    Width / height come from the parent Opening (where they live in the
    BuildingModel schema). The window panel is a rectangular solid sized
    to the opening, anchored to the opening's placement.
    """
    window_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcWindow")
    window_entity.GlobalId = derive_guid("IfcWindow", window.id)
    window_entity.Name = window.id
    window_entity.OverallWidth = parent_opening.width
    window_entity.OverallHeight = parent_opening.height

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, window_entity)

    # Anchor to opening placement.
    window_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=parent_opening_entity.ObjectPlacement,
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
    )

    # Glass panel body — width × 0.05 × height, mirrors legacy create_window.
    rect = ifc_file.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=parent_opening.width,
        YDim=0.05,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement2D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(parent_opening.width / 2.0, 0.0)
            ),
        ),
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=parent_opening.height,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    window_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    fill_opening(ifc_file, parent_opening_entity, window_entity)
    return window_entity


def create_door_parametric(
    door: "Door",
    parent_opening: "Opening",
    parent_opening_entity: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcDoor filling `parent_opening_entity`.

    OperationType is derived from the Door schema (`swing` + `handedness`)
    where the Phase 1 BuildingModel carries the answer. Width / height
    come from the parent Opening.
    """
    door_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcDoor")
    door_entity.GlobalId = derive_guid("IfcDoor", door.id)
    door_entity.Name = door.id
    door_entity.OverallWidth = parent_opening.width
    door_entity.OverallHeight = parent_opening.height
    # Map Door.{swing, handedness} → IFC4 OperationType.
    door_entity.OperationType = _door_operation_type(
        door.swing, door.handedness, parent_opening.width
    )

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, door_entity)

    door_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=parent_opening_entity.ObjectPlacement,
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
    )

    rect = ifc_file.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=parent_opening.width,
        YDim=0.05,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement2D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(parent_opening.width / 2.0, 0.0)
            ),
        ),
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=parent_opening.height,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    door_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    fill_opening(ifc_file, parent_opening_entity, door_entity)
    return door_entity


def _door_operation_type(swing: str, handedness: str, width: float) -> str:
    """Map Door schema fields to IFC4 IfcDoor.OperationType.

    Slice 5 covers the most common cases; full enum coverage (folding,
    revolving variants) is Phase 7's IFC4 hardening territory.
    """
    if swing == "sliding":
        return "SLIDING_TO_LEFT" if handedness == "left" else "SLIDING_TO_RIGHT"
    if swing == "folding":
        return "FOLDING_TO_LEFT" if handedness == "left" else "FOLDING_TO_RIGHT"
    if swing == "revolving":
        return "REVOLVING"
    # default = swinging door
    if width >= 1.8:
        return "DOUBLE_DOOR_SINGLE_SWING"
    return "SINGLE_SWING_LEFT" if handedness == "left" else "SINGLE_SWING_RIGHT"
