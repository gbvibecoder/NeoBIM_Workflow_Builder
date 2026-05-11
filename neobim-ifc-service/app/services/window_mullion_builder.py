"""Slice P2.B — Window mullion emitter.

Real LOD-300 windows have at least one vertical mullion dividing the
glazing. The 2014-baseline IFCs render windows as a single flat pane,
which reads as "AI generated" to any architect. This module emits one
`IfcMember` (PredefinedType=MULLION) at the horizontal midpoint of
each `IfcWindow`.

Design choices
--------------
* IFC-layer only — Window schema unchanged.
* One mullion per window (2-pane division is the LOD-300 default).
* 50 mm × 100 mm rectangular cross-section (XDim × YDim).
* Material: Aluminum-Mullion (new material, deterministic name).
* Anchored to the parent opening's `IfcLocalPlacement` so the mullion
  tracks the window through the wall→opening→window placement chain
  — no recomputed world coords, no drift.
* Pset_MemberCommon carries Reference + Span; closes the LOD-300 IDS
  "every member has a Pset" expectation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Opening, Window


MULLION_WIDTH_M: float = 0.050  # 50 mm along wall length.
MULLION_DEPTH_M: float = 0.100  # 100 mm perpendicular to wall.


def emit_window_mullion(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    window: "Window",
    opening: "Opening",
    parent_opening_entity: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    aluminum_material: ifcopenshell.entity_instance | None,
) -> ifcopenshell.entity_instance:
    """Emit a single vertical IfcMember(MULLION) at the window's
    horizontal midpoint."""
    from app.utils.ifc_helpers import assign_to_storey

    mullion = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcMember",
        name=f"mullion-{window.id}",
    )
    mullion.GlobalId = derive_guid("IfcMember-Mullion", window.id)
    mullion.PredefinedType = "MULLION"

    if ifc_storey is not None:
        assign_to_storey(model, ifc_storey, mullion)

    # Anchor to the same opening placement as the window. The opening's
    # local frame has X along wall length (same as the wall), Z vertical;
    # the window occupies x ∈ [0, opening.width]. The mullion sits at
    # the horizontal midpoint (x = width/2) with thickness 50 mm
    # spanning the wall direction.
    mid_x = opening.width / 2.0
    mullion.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        PlacementRelTo=parent_opening_entity.ObjectPlacement,
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(mid_x, 0.0, 0.0)
            ),
        ),
    )

    # Rectangle profile 50 mm × 100 mm, centered on the mullion's
    # local origin (no Position offset → profile centered at (0,0)).
    rect = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=MULLION_WIDTH_M,
        YDim=MULLION_DEPTH_M,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0)
            ),
        ),
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=model.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=opening.height,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    mullion.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    pset = api.run(
        "pset.add_pset", model, product=mullion, name="Pset_MemberCommon"
    )
    api.run(
        "pset.edit_pset",
        model,
        pset=pset,
        properties={
            "Reference": f"mullion-{window.id}",
            "Span": opening.height,
            "LoadBearing": False,
        },
    )

    if aluminum_material is not None:
        api.run(
            "material.assign_material",
            model,
            products=[mullion],
            type="IfcMaterial",
            material=aluminum_material,
        )

    return mullion


__all__ = ["emit_window_mullion", "MULLION_WIDTH_M", "MULLION_DEPTH_M"]
