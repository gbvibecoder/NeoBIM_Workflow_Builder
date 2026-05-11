"""Slice P2.D — Stilt parking line painter.

Emits 4 `IfcAnnotation` rectangles representing painted parking-bay
outlines on a tower's stilt floor (the lowest storey, marked
``usage="parking"``). Indian standard car bay: 2.5 m × 5.0 m. House
and duplex templates have no stilt floor and emit nothing.

Design choices
--------------
* IFC-layer only — Storey schema unchanged.
* 4 bays in a 2 × 2 grid (default), centred on the storey's
  floor-slab bounding box centre. Future iterations can read a
  parking-layout planner output; v1 keeps the count deterministic.
* Geometry: each bay is an `IfcAnnotation` whose representation is a
  closed `IfcPolyline` rectangle (no extrusion — pure 2D line art).
* No material (painted lines are not materialised geometry).
* Bay name encodes the layout grid (`parking-bay-r1c2`) for tests.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Slab, Storey


BAY_WIDTH_M: float = 2.5   # Bay short-side (Indian standard car parking).
BAY_DEPTH_M: float = 5.0   # Bay long-side.
BAY_ROWS: int = 2
BAY_COLS: int = 2


def _floor_slab_of(storey: "Storey") -> "Slab | None":
    """Return the storey's primary FLOOR slab (the parking deck)."""
    for s in storey.slabs:
        if s.predefined_type == "FLOOR":
            return s
    return None


def emit_parking_lines(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    storey: "Storey",
    ifc_storey: ifcopenshell.entity_instance,
) -> list[ifcopenshell.entity_instance]:
    """Emit 4 IfcAnnotation parking-bay rectangles if `storey` is a
    stilt parking floor; returns the list of created annotations
    (empty if the storey has no parking usage)."""
    is_parking = any(r.usage == "parking" for r in storey.rooms)
    if not is_parking:
        return []

    slab = _floor_slab_of(storey)
    if slab is None or not slab.footprint_polygon:
        return []

    from app.utils.ifc_helpers import assign_to_storey

    xs = [v.x for v in slab.footprint_polygon]
    ys = [v.y for v in slab.footprint_polygon]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    # Bay deck level — top of the slab (parking floor surface).
    bay_z = slab.top_z

    # Layout 2 × 2 grid of bays centred on the slab centroid.
    grid_w = BAY_COLS * BAY_WIDTH_M
    grid_d = BAY_ROWS * BAY_DEPTH_M
    grid_x0 = cx - grid_w / 2.0
    grid_y0 = cy - grid_d / 2.0

    annotations: list[ifcopenshell.entity_instance] = []
    for row in range(BAY_ROWS):
        for col in range(BAY_COLS):
            bay_x0 = grid_x0 + col * BAY_WIDTH_M
            bay_y0 = grid_y0 + row * BAY_DEPTH_M
            bay_x1 = bay_x0 + BAY_WIDTH_M
            bay_y1 = bay_y0 + BAY_DEPTH_M
            tag = f"r{row + 1}c{col + 1}"

            annotation = api.run(
                "root.create_entity",
                model,
                ifc_class="IfcAnnotation",
                name=f"parking-bay-{storey.id}-{tag}",
            )
            annotation.GlobalId = derive_guid(
                "IfcAnnotation-ParkingBay", storey.id, tag
            )
            annotation.Description = f"Parking bay {tag}"
            annotation.ObjectType = "Parking Bay"
            assign_to_storey(model, ifc_storey, annotation)

            annotation.ObjectPlacement = model.create_entity(
                "IfcLocalPlacement",
                RelativePlacement=model.create_entity(
                    "IfcAxis2Placement3D",
                    Location=model.create_entity(
                        "IfcCartesianPoint",
                        Coordinates=(0.0, 0.0, bay_z),
                    ),
                ),
            )

            # 5-point closed polyline rectangle (last == first).
            points = [
                (bay_x0, bay_y0),
                (bay_x1, bay_y0),
                (bay_x1, bay_y1),
                (bay_x0, bay_y1),
                (bay_x0, bay_y0),
            ]
            ifc_pts = [
                model.create_entity("IfcCartesianPoint", Coordinates=p)
                for p in points
            ]
            polyline = model.create_entity("IfcPolyline", Points=ifc_pts)
            shape_rep = model.create_entity(
                "IfcShapeRepresentation",
                ContextOfItems=body_context,
                RepresentationIdentifier="Annotation",
                RepresentationType="Annotation2D",
                Items=[polyline],
            )
            annotation.Representation = model.create_entity(
                "IfcProductDefinitionShape", Representations=[shape_rep]
            )
            annotations.append(annotation)

    return annotations


__all__ = [
    "emit_parking_lines",
    "BAY_WIDTH_M",
    "BAY_DEPTH_M",
    "BAY_ROWS",
    "BAY_COLS",
]
