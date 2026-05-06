"""Column builder — creates IfcColumn with circular or rectangular profiles.

Slice 5 adds `create_column_parametric` (BuildingModel-driven) alongside
the legacy `create_column`. The parametric path consumes ResolvedPlacement
+ ResolvedGeometry and carries no fallback chains.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.services.steel_profiles import get_is_section, is_steel_material
from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Column
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_column(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcColumn at the element's position.

    `storey_elevation` is the Z floor for this column — without it every
    storey's columns stack up at ground, producing the "flying slab" bug.
    """
    props = elem.properties
    height = props.height or 3.0
    radius = props.radius or 0.25

    column = api.run("root.create_entity", model, ifc_class="IfcColumn")
    column.GlobalId = derive_guid("IfcColumn", elem.id)
    column.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, column)

    # Position at first vertex. Emitters put absolute world Z on the vertex
    # (TS massing-generator line 848: `z: elevation`); fall back to the
    # storey elevation only when v0.z is zero (storey-local emitters).
    cx, cy, cz = 0.0, 0.0, storey_elevation
    if elem.vertices:
        v0 = elem.vertices[0]
        cx, cy = v0.x, v0.y
        cz = v0.z if v0.z else storey_elevation

    column.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    # Profile selection (Phase 2 / Fix 11):
    #   1. Steel + IS-808 designation → IfcIShapeProfileDef with spec dims.
    #   2. Anything else → existing circular fallback (matches pre-Phase-2).
    # Steel material can come from either `properties.structuralMaterial`
    # (Track C typed Literal) or `properties.material` (older free-form).
    structural_material = (
        props.structural_material if props.structural_material else props.material
    )
    is_section = (
        get_is_section(props.section_profile)
        if is_steel_material(structural_material)
        else None
    )

    if is_section is not None:
        d = is_section.as_metres()
        profile = model.create_entity(
            "IfcIShapeProfileDef",
            ProfileType="AREA",
            ProfileName=is_section.designation,
            OverallDepth=d["depth"],
            OverallWidth=d["flange_width"],
            FlangeThickness=d["flange_thickness"],
            WebThickness=d["web_thickness"],
        )
    else:
        # Circular profile (pre-Phase-2 default)
        profile = model.create_entity(
            "IfcCircleProfileDef",
            ProfileType="AREA",
            Radius=radius,
        )

    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
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
    column.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return column


def create_column_parametric(
    column: "Column",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcColumn. Profile (rectangle / circle) + extrusion
    are derived from ResolvedGeometry; legacy fallback chains have been
    eliminated — every dimension comes from BuildingModel + resolver."""
    if geometry.representation_type != "SweptSolid":
        raise ValueError(
            f"Column '{column.id}' geometry representation_type "
            f"'{geometry.representation_type}', expected 'SweptSolid'."
        )
    if geometry.extrusion_depth is None or geometry.extrusion_depth <= 0:
        raise ValueError(
            f"Column '{column.id}' invalid extrusion_depth "
            f"{geometry.extrusion_depth}."
        )

    column_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcColumn")
    column_entity.GlobalId = derive_guid("IfcColumn", column.id)
    column_entity.Name = column.id

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, column_entity)

    column_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
        ),
    )

    # Profile: per ProfileRef + steel-section override (legacy parity).
    structural_material = column.material
    is_section = (
        get_is_section(column.profile.name)
        if is_steel_material(structural_material)
        else None
    )
    if is_section is not None:
        d = is_section.as_metres()
        profile = ifc_file.create_entity(
            "IfcIShapeProfileDef",
            ProfileType="AREA",
            ProfileName=is_section.designation,
            OverallDepth=d["depth"],
            OverallWidth=d["flange_width"],
            FlangeThickness=d["flange_thickness"],
            WebThickness=d["web_thickness"],
        )
    elif geometry.profile_type == "circle":
        if geometry.profile_x_dim is None:
            raise ValueError(
                f"Column '{column.id}' circle profile missing profile_x_dim (radius)."
            )
        profile = ifc_file.create_entity(
            "IfcCircleProfileDef",
            ProfileType="AREA",
            Radius=float(geometry.profile_x_dim),
        )
    else:  # rectangle
        if geometry.profile_x_dim is None or geometry.profile_y_dim is None:
            raise ValueError(
                f"Column '{column.id}' rectangle profile missing dimensions "
                f"(x={geometry.profile_x_dim}, y={geometry.profile_y_dim})."
            )
        profile = ifc_file.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            XDim=float(geometry.profile_x_dim),
            YDim=float(geometry.profile_y_dim),
        )

    extr_dir = geometry.extrusion_direction
    extrusion_dir_ent = ifc_file.create_entity(
        "IfcDirection",
        DirectionRatios=(extr_dir.x, extr_dir.y, extr_dir.z) if extr_dir else (0.0, 0.0, 1.0),
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
        ExtrudedDirection=extrusion_dir_ent,
        Depth=geometry.extrusion_depth,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    column_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return column_entity
