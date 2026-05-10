"""Slice T2.0.4.B — IfcTransportElement (lift cabin) emitter.

Adds one IfcTransportElement (PredefinedType=ELEVATOR) per Room with
``usage="lift"`` in the BuildingModel. The cabin is a 1.2 × 1.2 × 2.2 m
box placed at the SOUTH end of the shaft footprint (closest to the
lobby door, where lifts physically sit), centered laterally on X. The
spec calls for "shaft center", but the diagnostic at
``scripts/inspect_lift_visual_correctness.py`` showed the 3BHK template
authors a 1.3 × 8.8 m shaft — placing the cabin at the geometric
centroid would put it ~4 m away from the lobby door, which is
architecturally wrong. South-end placement matches how lifts actually
sit in Indian residential towers.

Cabins are IFC-only — they do NOT appear in the BuildingModel. This
preserves the byte-identical BuildingModel snapshot constraint of
slice T2.0.4 while still surfacing a recognisable cabin in the IFC
export.

Stub naming: every cabin is named ``lift-cabin-stub-{storey_id}``,
following the P1.6 stub-naming convention. Phase 9 will replace this
with a single moving cabin (with proper IfcRelAssignsToGroup linkage
to the shaft IfcSpace) and animation hooks; v1's per-storey emission
is a visual-recognisability concession.

Material: ``Lift-Cabin-Steel`` — distinct from the brick shaft walls
so a viewer can SEE the cabin as a different element. Reused via the
``IfcMaterial`` cache (idempotent name lookup).

Pset_TransportElementCommon (per IFC4 schema):
  * Reference            = "stub-lift-cabin"
  * Status               = "NEW"
  * CapacityPeople       = 6   (default Indian residential)
  * CapacityWeight       = 408 (kg, 6 × 68 kg standard)
"""

from __future__ import annotations

from typing import Optional

import ifcopenshell
import ifcopenshell.api as api

from app.domain.building_model import BuildingModel, Room, Storey
from app.utils.guid import derive_guid


# Cabin geometric constants (per slice T2.0.4 spec §3 Phase B.1).
CABIN_WIDTH_M: float = 1.2     # X dim (lateral)
CABIN_DEPTH_M: float = 1.2     # Y dim (along shaft depth)
CABIN_HEIGHT_M: float = 2.2    # Z dim (vertical)
CABIN_FLOOR_OFFSET_M: float = 0.020  # cabin sits 20 mm above storey floor
CABIN_SOUTH_EDGE_OFFSET_M: float = 0.050  # 50 mm clearance from south wall

# Pset_TransportElementCommon defaults — Indian residential lift,
# 6-person 408-kg capacity. Tunable in a future slice.
LIFT_CAPACITY_PEOPLE: int = 6
LIFT_CAPACITY_WEIGHT_KG: int = 408

# Material name pinned for cross-discovery via `model.by_type
# ("IfcMaterial") + filter on .Name == "Lift-Cabin-Steel"`.
LIFT_CABIN_MATERIAL_NAME: str = "Lift-Cabin-Steel"


def _ensure_lift_cabin_material(
    model: ifcopenshell.file,
) -> ifcopenshell.entity_instance:
    """Idempotent lookup-or-create of the cabin steel material."""
    for m in model.by_type("IfcMaterial"):
        if m.Name == LIFT_CABIN_MATERIAL_NAME:
            return m
    return api.run(
        "material.add_material",
        model,
        name=LIFT_CABIN_MATERIAL_NAME,
        category="metal",
    )


def _emit_one_cabin(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    storey: ifcopenshell.entity_instance,
    storey_node: Storey,
    lift_room: Room,
    cabin_material: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Emit one IfcTransportElement at the south end of ``lift_room``,
    centered laterally."""
    poly = lift_room.footprint_polygon
    xs = [p.x for p in poly]
    ys = [p.y for p in poly]
    x_center = (min(xs) + max(xs)) / 2.0
    y_south_edge = min(ys) + CABIN_SOUTH_EDGE_OFFSET_M
    z_bottom = storey_node.elevation + CABIN_FLOOR_OFFSET_M

    cabin_id = f"lift-cabin-stub-{storey_node.id}"
    cabin = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcTransportElement",
        name=cabin_id,
    )
    cabin.GlobalId = derive_guid("IfcTransportElement", cabin_id)
    cabin.PredefinedType = "ELEVATOR"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, cabin)

    # Local placement at the south-edge centroid; the swept solid is
    # built at local origin and extends:
    #   * ±0.6 m in local X (rectangle profile centered)
    #   * 0 .. CABIN_DEPTH_M in local Y (rectangle profile centered;
    #     so we offset the placement north by CABIN_DEPTH/2 to push
    #     the rectangle's southern edge to y_south_edge)
    #   * 0 .. CABIN_HEIGHT_M vertically
    cabin.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint",
                Coordinates=(
                    x_center,
                    y_south_edge + CABIN_DEPTH_M / 2.0,
                    z_bottom,
                ),
            ),
        ),
    )

    # Body geometry: 1.2 × 1.2 m profile extruded 2.2 m vertically.
    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=CABIN_WIDTH_M,
        YDim=CABIN_DEPTH_M,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0)
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
        Depth=CABIN_HEIGHT_M,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    cabin.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    # Material assignment — distinct from shaft brick walls so the
    # cabin reads as a different element in the viewer. Required for
    # P1.6 IDS instance-material rule inheritance.
    api.run(
        "material.assign_material",
        model,
        products=[cabin],
        type="IfcMaterial",
        material=cabin_material,
    )

    # Pset_TransportElementCommon — IFC4 standard property set.
    pset = api.run(
        "pset.add_pset",
        model,
        product=cabin,
        name="Pset_TransportElementCommon",
    )
    api.run(
        "pset.edit_pset",
        model,
        pset=pset,
        properties={
            "Reference": "stub-lift-cabin",
            "Status": "NEW",
            "CapacityPeople": LIFT_CAPACITY_PEOPLE,
            "CapacityWeight": float(LIFT_CAPACITY_WEIGHT_KG),
        },
    )
    return cabin


def emit_lift_cabins(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    bm: BuildingModel,
    ifc_storeys: dict[str, ifcopenshell.entity_instance],
) -> list[ifcopenshell.entity_instance]:
    """Emit one IfcTransportElement per Room with usage='lift'.

    Returns the list of emitted cabin entities. House and duplex
    templates contain no lift rooms, so the return list is empty for
    those — non-tower templates do not gain transport elements.
    """
    bld = bm.project.site.building
    cabin_material: Optional[ifcopenshell.entity_instance] = None
    cabins: list[ifcopenshell.entity_instance] = []

    for storey_node in sorted(bld.storeys, key=lambda s: s.index):
        ifc_storey = ifc_storeys.get(storey_node.id)
        if ifc_storey is None:
            continue
        for room in storey_node.rooms:
            if room.usage != "lift":
                continue
            if cabin_material is None:
                cabin_material = _ensure_lift_cabin_material(model)
            cabin = _emit_one_cabin(
                model,
                body_context,
                storey=ifc_storey,
                storey_node=storey_node,
                lift_room=room,
                cabin_material=cabin_material,
            )
            cabins.append(cabin)

    return cabins


__all__ = [
    "emit_lift_cabins",
    "CABIN_WIDTH_M",
    "CABIN_DEPTH_M",
    "CABIN_HEIGHT_M",
    "LIFT_CABIN_MATERIAL_NAME",
    "LIFT_CAPACITY_PEOPLE",
    "LIFT_CAPACITY_WEIGHT_KG",
]
