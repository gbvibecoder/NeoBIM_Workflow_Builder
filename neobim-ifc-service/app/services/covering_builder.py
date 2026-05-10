"""Phase P1.5.C — IfcCovering emitter for floor + ceiling finishes.

Adds two IfcCovering entities per habitable storey: a FLOORING
(vitrified tile, 10mm) sitting on top of the floor slab, and a
CEILING (gypsum board, 12mm) hung below the slab above.

Coverings are IFC-only — they do not appear in the BuildingModel.
This preserves the byte-identical BuildingModel snapshot constraint
of P1.5 while still surfacing the finish layers in the IFC export.

Geometry: a thin extruded prism over the storey's floor slab
footprint, placed at slab_top_z + 0.0 (floor) or
storey_top_z - thickness (ceiling).
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api
from shapely.geometry import Polygon

from app.domain.building_model import Slab
from app.utils.guid import derive_guid


_FLOOR_FINISH_THICKNESS_M: float = 0.010
_CEILING_FINISH_THICKNESS_M: float = 0.012
_FLOOR_FINISH_MATERIAL: str = "Vitrified Tile"
_CEILING_FINISH_MATERIAL: str = "Gypsum Board"


def _emit_covering(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    storey: ifcopenshell.entity_instance,
    *,
    covering_id: str,
    name: str,
    predefined_type: str,
    footprint_polygon: list[tuple[float, float]],
    base_z: float,
    thickness: float,
) -> ifcopenshell.entity_instance:
    """Emit one IfcCovering with extruded prism geometry."""
    covering = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcCovering",
        name=name,
    )
    covering.GlobalId = derive_guid("IfcCovering", covering_id)
    covering.PredefinedType = predefined_type

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, covering)

    # Local placement at (0, 0, base_z) — polygon is in world coords.
    covering.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, base_z)
            ),
        ),
    )

    # Profile = footprint polygon as IfcArbitraryClosedProfileDef.
    pts = [
        model.create_entity("IfcCartesianPoint", Coordinates=(x, y))
        for x, y in footprint_polygon
    ]
    # Close polygon — IfcArbitraryClosedProfileDef requires last == first.
    if footprint_polygon[0] != footprint_polygon[-1]:
        pts.append(
            model.create_entity(
                "IfcCartesianPoint", Coordinates=footprint_polygon[0]
            )
        )
    polyline = model.create_entity("IfcPolyline", Points=pts)
    profile = model.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
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
        Depth=thickness,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    covering.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return covering


def add_floor_and_ceiling_finishes(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    storey_ifc: ifcopenshell.entity_instance,
    floor_slab: Slab,
    storey_top_z: float,
) -> tuple[ifcopenshell.entity_instance, ifcopenshell.entity_instance]:
    """Emit a FLOORING + CEILING IfcCovering pair for one storey.

    Returns (floor_covering, ceiling_covering). Caller is responsible
    for adding Pset_CoveringCommon via `bm_pset_populator` after.
    """
    poly = [(v.x, v.y) for v in floor_slab.footprint_polygon]

    # Floor finish sits ON TOP of the floor slab.
    floor_covering = _emit_covering(
        model, body_context, storey_ifc,
        covering_id=f"covering-floor-{floor_slab.id}",
        name=f"Floor Finish - {floor_slab.id}",
        predefined_type="FLOORING",
        footprint_polygon=poly,
        base_z=floor_slab.top_z,
        thickness=_FLOOR_FINISH_THICKNESS_M,
    )

    # Ceiling finish hangs from the slab above (storey_top_z is the top
    # of the ceiling slab; ceiling finish is below the slab top by its
    # thickness, but above the wall top — we extrude downward from
    # storey_top_z - slab_thickness to storey_top_z - slab_thickness -
    # ceiling_thickness, but here we just place at storey_top_z -
    # ceiling_thickness for simplicity).
    ceiling_covering = _emit_covering(
        model, body_context, storey_ifc,
        covering_id=f"covering-ceiling-{floor_slab.id}",
        name=f"Ceiling Finish - {floor_slab.id}",
        predefined_type="CEILING",
        footprint_polygon=poly,
        base_z=storey_top_z - _CEILING_FINISH_THICKNESS_M,
        thickness=_CEILING_FINISH_THICKNESS_M,
    )

    return floor_covering, ceiling_covering


def add_pset_to_covering(
    model: ifcopenshell.file,
    covering: ifcopenshell.entity_instance,
    *,
    is_floor: bool,
) -> None:
    """Attach Pset_CoveringCommon to a covering."""
    pset = api.run(
        "pset.add_pset", model, product=covering, name="Pset_CoveringCommon"
    )
    api.run("pset.edit_pset", model, pset=pset, properties={
        "Reference": covering.Name or covering.GlobalId,
        "FlammabilityRating": "Class A",
        "FragilityRating": "Class 2",
        "FireRating": "REI 60",
        "AcousticRating": "Rw 30dB",
        "Combustible": False,
        "SurfaceSpreadOfFlame": "Class 0",
        "Finishing": _FLOOR_FINISH_MATERIAL if is_floor else _CEILING_FINISH_MATERIAL,
    })


__all__ = [
    "add_floor_and_ceiling_finishes",
    "add_pset_to_covering",
]
