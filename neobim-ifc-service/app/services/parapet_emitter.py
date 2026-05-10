"""Phase P1.5.D — IFC-only roof parapet emitter.

Indian rooftops always have a 0.9-1.2m parapet around the perimeter.
This module emits 4 IfcWall entities at parapet height around each
roof slab AT IFC EXPORT TIME — without modifying the BuildingModel.

Why IFC-only? P1.5 §2.1 mandates byte-identical BuildingModel JSON
across all 12 templates. Adding parapets to the BuildingModel via
Layer-3 assemblers would drift every snapshot. By emitting at the
IFC layer instead, the BuildingModel stays clean and parapets still
appear in every export.

The parapet wraps the roof slab's footprint polygon: 4 walls walked
CCW (S → E → N → W). Each wall is 1.0m tall, 230mm thick, brick.
Standard Pset_WallCommon attached.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.domain.building_model import Slab
from app.utils.guid import derive_guid


_PARAPET_HEIGHT_M: float = 1.0
_PARAPET_THICKNESS_M: float = 0.230
_PARAPET_MATERIAL: str = "Burnt-Clay-Brick-230mm"


def _emit_parapet_wall(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    storey: ifcopenshell.entity_instance,
    *,
    wall_id: str,
    name: str,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    base_z: float,
) -> ifcopenshell.entity_instance:
    """Emit one IfcWall as a parapet segment along (start)→(end)."""
    wall = api.run(
        "root.create_entity", model, ifc_class="IfcWall", name=name
    )
    wall.GlobalId = derive_guid("IfcWall-Parapet", wall_id)
    wall.PredefinedType = "PARAPET"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, wall)

    # Local placement at start point.
    length = ((end_x - start_x) ** 2 + (end_y - start_y) ** 2) ** 0.5
    if length < 1e-6:
        # Degenerate — return without geometry.
        return wall

    dx = (end_x - start_x) / length
    dy = (end_y - start_y) / length

    wall.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(start_x, start_y, base_z)
            ),
            RefDirection=model.create_entity(
                "IfcDirection", DirectionRatios=(dx, dy, 0.0)
            ),
        ),
    )

    # Profile: rectangular cross-section, length × thickness, centered
    # so that local Y is the wall's thickness axis.
    half_t = _PARAPET_THICKNESS_M / 2.0
    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=length,
        YDim=_PARAPET_THICKNESS_M,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(length / 2.0, half_t)
            ),
        ),
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=model.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=_PARAPET_HEIGHT_M,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    wall.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    # Pset_WallCommon — parapet is external, non-load-bearing.
    pset = api.run(
        "pset.add_pset", model, product=wall, name="Pset_WallCommon"
    )
    api.run("pset.edit_pset", model, pset=pset, properties={
        "Reference": wall_id,
        "IsExternal": True,
        "LoadBearing": False,
        "FireRating": "REI 30",
        "ThermalTransmittance": 0.30,
    })

    return wall


def emit_roof_parapets(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    storey: ifcopenshell.entity_instance,
    *,
    roof_slab: Slab,
) -> list[ifcopenshell.entity_instance]:
    """Emit 4 parapet walls (S/E/N/W) around a roof slab.

    Roof slab polygon must be a simple quadrilateral (CCW). Walks
    consecutive vertices: poly[0]→poly[1] (S), poly[1]→poly[2] (E),
    poly[2]→poly[3] (N), poly[3]→poly[0] (W). Returns the 4 IfcWalls.
    """
    poly = roof_slab.footprint_polygon
    if len(poly) < 4:
        return []
    base_z = roof_slab.top_z

    # First 4 vertices — assume rectangle (templates guarantee this).
    p_sw = poly[0]
    p_se = poly[1]
    p_ne = poly[2]
    p_nw = poly[3]

    walls: list[ifcopenshell.entity_instance] = []
    for label, p_start, p_end in [
        ("S", p_sw, p_se),
        ("E", p_se, p_ne),
        ("N", p_ne, p_nw),
        ("W", p_nw, p_sw),
    ]:
        wall_id = f"parapet-{roof_slab.id}-{label}"
        walls.append(
            _emit_parapet_wall(
                model, body_context, storey,
                wall_id=wall_id,
                name=f"Roof Parapet {label} - {roof_slab.id}",
                start_x=p_start.x, start_y=p_start.y,
                end_x=p_end.x, end_y=p_end.y,
                base_z=base_z,
            )
        )
    return walls


__all__ = ["emit_roof_parapets"]
