"""Slice P2.A — Stair handrail emitter.

Emits one `IfcRailing` (PredefinedType=HANDRAIL) alongside every
`IfcStairFlight`. NBC India 2016 Part 4 mandates a handrail on
residential stairs at 0.9 m above the tread; without one the stair
reads as "AI generated" in any architect's first glance.

Design choices
--------------
* IFC-layer only — BuildingModel is untouched (no Stair schema change).
* One handrail entity per stair flight (1 per IfcStairFlight). L-shaped
  2-flight stairs would produce 2 handrails; the current templates use
  single-flight straight stairs so this is a 1:1 mapping.
* Geometry: a thin rectangular panel (50 mm × total_slope_length)
  tilted to follow the stair flight's rise, then extruded perpendicular
  to the slope by 0.9 m (the NBC-required handrail height; tests pin
  `extrusion_depth == 0.9 m`).
* Material: MS-Steel (re-uses the cache material the IFC builder has
  already created for balcony GUARDRAILs / stub MEP).
* Pset_RailingCommon carries Reference + Height + Diameter so the
  P1.5 "every railing has Pset" test continues to pass.

Lateral placement: mirrors `stair_builder.STAIR_FLIGHT_CLEARANCE_M`
inset semantics — the handrail sits on the wall-side edge of the
flight (the +Y end of the flight extrusion) so it doesn't visually
collide with the flight body itself.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.services.stair_builder import STAIR_FLIGHT_CLEARANCE_M
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Stair
    from app.services.placement_resolver import ResolvedPlacement


HANDRAIL_HEIGHT_M: float = 0.9  # NBC India 2016 Part 4 residential minimum.
HANDRAIL_THICKNESS_M: float = 0.05  # 50 mm metal handrail panel thickness.


def emit_stair_handrail(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    stair: "Stair",
    placement: "ResolvedPlacement",
    ifc_storey: ifcopenshell.entity_instance,
    ms_steel_material: ifcopenshell.entity_instance | None,
) -> ifcopenshell.entity_instance:
    """Emit one `IfcRailing` (HANDRAIL) along a stair flight's wall-side edge."""
    from app.utils.ifc_helpers import assign_to_storey

    total_run = stair.riser_count * stair.tread_depth
    total_rise = stair.riser_count * stair.riser_height
    slope_length = math.sqrt(total_run * total_run + total_rise * total_rise)
    if slope_length < 1e-6:
        slope_length = max(total_run, 1e-6)

    xs = [p.x for p in stair.plan_polygon]
    ys = [p.y for p in stair.plan_polygon]
    raw_width = min(max(xs) - min(xs), max(ys) - min(ys))
    # Mirror stair_builder's lateral inset; floor at NBC 0.9m minimum.
    flight_width = max(raw_width - 2.0 * STAIR_FLIGHT_CLEARANCE_M, 0.9)
    # Place the handrail just inside the +Y (wall-side) edge of the flight,
    # 25 mm in from the wall so it doesn't collide with the IfcWall body.
    side_offset_y = STAIR_FLIGHT_CLEARANCE_M + flight_width - 0.025

    handrail = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcRailing",
        name=f"handrail-{stair.id}",
    )
    handrail.GlobalId = derive_guid("IfcRailing-Handrail", stair.id)
    handrail.PredefinedType = "HANDRAIL"

    assign_to_storey(model, ifc_storey, handrail)

    # Entity placement — at the world-space start of the stair flight,
    # offset to the wall-side edge, lifted to the stair's base elevation.
    origin = model.create_entity(
        "IfcCartesianPoint",
        Coordinates=(
            placement.origin.x,
            placement.origin.y + side_offset_y,
            placement.origin.z,
        ),
    )
    handrail.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=origin,
        ),
    )

    # Tilted swept solid: local X follows the slope; local Z is the
    # in-plane vertical perpendicular to slope. Extruding 0.9 m along
    # local Z lifts the handrail panel perpendicular to the stair —
    # the angle visually matches the flight.
    cos_a = total_run / slope_length
    sin_a = total_rise / slope_length
    rect_profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=slope_length,
        YDim=HANDRAIL_THICKNESS_M,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(slope_length / 2.0, 0.0)
            ),
        ),
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect_profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
            Axis=model.create_entity(
                "IfcDirection", DirectionRatios=(-sin_a, 0.0, cos_a)
            ),
            RefDirection=model.create_entity(
                "IfcDirection", DirectionRatios=(cos_a, 0.0, sin_a)
            ),
        ),
        ExtrudedDirection=model.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=HANDRAIL_HEIGHT_M,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    handrail.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    pset = api.run(
        "pset.add_pset", model, product=handrail, name="Pset_RailingCommon"
    )
    api.run(
        "pset.edit_pset",
        model,
        pset=pset,
        properties={
            "Reference": f"handrail-{stair.id}",
            "Height": HANDRAIL_HEIGHT_M,
            "Diameter": HANDRAIL_THICKNESS_M,
        },
    )

    if ms_steel_material is not None:
        api.run(
            "material.assign_material",
            model,
            products=[handrail],
            type="IfcMaterial",
            material=ms_steel_material,
        )

    return handrail


__all__ = ["emit_stair_handrail", "HANDRAIL_HEIGHT_M", "HANDRAIL_THICKNESS_M"]
