"""Slab builder — creates IfcSlab for floors and roofs.

Two entry points coexist during the Phase 1 migration:

  * `create_slab(model, elem, storey, context, footprint, elevation)` —
    legacy. Carries `props.thickness or 0.30` fallback chain.
  * `create_slab_parametric(slab, placement, geometry, ifc_file,
    body_context, ifc_storey, type_registry)` — Slice 5 parametric
    signature. Consumes BuildingModel Slab + ResolvedPlacement +
    ResolvedGeometry. No fallbacks — every dimension is authoritative.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement, FootprintPoint
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Slab
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_slab(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    footprint: list[FootprintPoint] | None = None,
    elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcSlab from element data or building footprint.

    Uses IfcArbitraryClosedProfileDef for non-rectangular footprints,
    extruded by slab thickness.
    """
    props = elem.properties
    thickness = props.thickness or 0.30
    is_roof = elem.type == "roof" or "roof" in props.name.lower()

    slab = api.run("root.create_entity", model, ifc_class="IfcSlab")
    slab.GlobalId = derive_guid("IfcSlab", elem.id)
    slab.Name = props.name
    slab.PredefinedType = "ROOF" if is_roof else "FLOOR"

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, slab)

    # Placement at slab elevation
    slab.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, elevation)),
        ),
    )

    # Build footprint polyline from element vertices or building footprint
    pts = footprint if footprint else []
    if not pts and elem.vertices:
        pts = [FootprintPoint(x=v.x, y=v.y) for v in elem.vertices if hasattr(v, "x")]

    if len(pts) >= 3:
        # Arbitrary closed profile from polygon
        ifc_points = [
            model.create_entity("IfcCartesianPoint", Coordinates=(p.x, p.y))
            for p in pts
        ]
        # Close the polyline
        ifc_points.append(ifc_points[0])

        polyline = model.create_entity("IfcPolyline", Points=ifc_points)
        profile = model.create_entity(
            "IfcArbitraryClosedProfileDef",
            ProfileType="AREA",
            OuterCurve=polyline,
        )
    else:
        # Fallback: rectangular profile
        width = 20.0
        depth = 20.0
        profile = model.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=width,
            YDim=depth,
            Position=model.create_entity(
                "IfcAxis2Placement2D",
                Location=model.create_entity("IfcCartesianPoint", Coordinates=(width / 2.0, depth / 2.0)),
            ),
        )

    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=thickness,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    slab.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return slab


def create_slab_parametric(
    slab: "Slab",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcSlab. Consumes ResolvedGeometry.profile_polygon
    + extrusion_depth + extrusion_direction; never re-reads slab fields."""
    if geometry.representation_type != "SweptSolid":
        raise ValueError(
            f"Slab '{slab.id}' geometry has representation_type "
            f"'{geometry.representation_type}', expected 'SweptSolid'."
        )
    if geometry.profile_type != "polygon":
        raise ValueError(
            f"Slab '{slab.id}' geometry has profile_type "
            f"'{geometry.profile_type}', expected 'polygon'."
        )
    if not geometry.profile_polygon or len(geometry.profile_polygon) < 3:
        raise ValueError(
            f"Slab '{slab.id}' geometry has < 3 polygon vertices."
        )
    if geometry.extrusion_depth is None or geometry.extrusion_depth <= 0:
        raise ValueError(
            f"Slab '{slab.id}' geometry has invalid extrusion_depth "
            f"{geometry.extrusion_depth}."
        )
    extr_dir = geometry.extrusion_direction
    if extr_dir is None:
        raise ValueError(f"Slab '{slab.id}' geometry missing extrusion_direction.")

    slab_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcSlab")
    slab_entity.GlobalId = derive_guid("IfcSlab", slab.id)
    slab_entity.Name = slab.id
    slab_entity.PredefinedType = slab.predefined_type

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, slab_entity)

    # IfcLocalPlacement at resolved origin.
    origin_pt = ifc_file.create_entity(
        "IfcCartesianPoint",
        Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
    )
    slab_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D", Location=origin_pt
        ),
    )

    # Build polyline profile in slab-local coords (relative to placement.origin).
    ifc_pts = [
        ifc_file.create_entity(
            "IfcCartesianPoint",
            Coordinates=(v.x - placement.origin.x, v.y - placement.origin.y),
        )
        for v in geometry.profile_polygon
    ]
    ifc_pts.append(ifc_pts[0])  # close
    polyline = ifc_file.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc_file.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    extrusion_dir = ifc_file.create_entity(
        "IfcDirection", DirectionRatios=(extr_dir.x, extr_dir.y, extr_dir.z)
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=extrusion_dir,
        Depth=geometry.extrusion_depth,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    slab_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return slab_entity
