"""Slice P2.C — Door swing arc annotation emitter.

Emits one `IfcAnnotation` (90° arc) per swinging IfcDoor showing the
door's swing direction in plan. Real architectural drawings always
carry this annotation; without it, a viewer can't tell a door's
swing direction. Slide-style doors (lift cabins) and PredefinedType=
GATE doors get NO arc.

Design choices
--------------
* IFC-layer only — Door schema unchanged.
* `IfcAnnotation` with a single `IfcTrimmedCurve` over an `IfcCircle`
  is the canonical 2D swing-arc representation in IFC4.
* Arc radius = door width (the swing arc's natural radius is the
  door's panel length).
* Quarter-circle (90°) sweep starting from the door's hinge edge.
* No material (annotations are line art, not materialised geometry).
* Linked to the door's parent storey via
  `IfcRelContainedInSpatialStructure` (handled by `assign_to_storey`).
  We also store the door's name in `IfcAnnotation.Description` so
  P2-test assertions can pair annotation ↔ door by name.

Viewer support
--------------
`IfcAnnotation` rendering is inconsistent across viewers:
  * BlenderBIM renders the arc.
  * IfcViewer partial — depends on version.
  * FreeCAD partial.
The IFC is semantically correct regardless. Documented in the slice
prompt's risk register.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Door, Opening


def _is_swing_operation(operation_type: str | None) -> bool:
    """Return True if the IfcDoor.OperationType indicates a swinging door
    (single-swing, double-swing, double-door-single-swing, etc.)."""
    if not operation_type:
        return False
    op = operation_type.upper()
    if "SLIDING" in op or "FOLDING" in op or "REVOLVING" in op:
        return False
    return "SWING" in op


def emit_door_swing_arc(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    door: "Door",
    door_entity: ifcopenshell.entity_instance,
    opening: "Opening",
    parent_opening_entity: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance | None,
) -> ifcopenshell.entity_instance | None:
    """Emit a 90° swing arc annotation for a swinging door.

    Returns the `IfcAnnotation` entity, or `None` if the door is not a
    swing-type door (sliding, folding, revolving, or PredefinedType=GATE).
    """
    if door.predefined_type == "GATE":
        return None
    if not _is_swing_operation(door_entity.OperationType):
        return None

    from app.utils.ifc_helpers import assign_to_storey

    radius = float(opening.width)
    handedness = (door.handedness or "right").lower()
    # Right-hand door: hinge on the right edge of the opening, arc sweeps
    # CCW from 90° (along wall, opening away from observer) to 180°
    # (perpendicular to wall, fully open). Left-hand door mirrors.
    if handedness == "left":
        hinge_x = 0.0  # left edge of opening
        # Arc spans from along-wall (0°) to perpendicular (90°).
        trim_start_param = 0.0
        trim_end_param = 90.0
    else:
        hinge_x = float(opening.width)  # right edge of opening
        # Arc spans from along-wall (180°) to perpendicular (90°).
        trim_start_param = 90.0
        trim_end_param = 180.0

    annotation = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcAnnotation",
        name=f"swing-arc-{door.id}",
    )
    annotation.GlobalId = derive_guid("IfcAnnotation-SwingArc", door.id)
    annotation.Description = door_entity.Name
    annotation.ObjectType = "Door Swing"

    if ifc_storey is not None:
        assign_to_storey(model, ifc_storey, annotation)

    # Place the annotation at the door's hinge corner, in the parent
    # opening's local frame (X along wall, Y perpendicular into room,
    # Z vertical). The arc lives in the local XY plane at z=0.
    annotation.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=parent_opening_entity.ObjectPlacement,
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(hinge_x, 0.0, 0.0)
            ),
        ),
    )

    # Build a 90° arc:
    #   * IfcCircle centred at the annotation's local origin (hinge).
    #   * IfcTrimmedCurve trims it to a quarter-arc.
    circle_position = model.create_entity(
        "IfcAxis2Placement2D",
        Location=model.create_entity(
            "IfcCartesianPoint", Coordinates=(0.0, 0.0)
        ),
    )
    circle = model.create_entity(
        "IfcCircle",
        Position=circle_position,
        Radius=radius,
    )
    trimmed = model.create_entity(
        "IfcTrimmedCurve",
        BasisCurve=circle,
        Trim1=(model.create_entity("IfcParameterValue", trim_start_param),),
        Trim2=(model.create_entity("IfcParameterValue", trim_end_param),),
        SenseAgreement=True,
        MasterRepresentation="PARAMETER",
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Annotation",
        RepresentationType="Annotation2D",
        Items=[trimmed],
    )
    annotation.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    return annotation


__all__ = ["emit_door_swing_arc"]
