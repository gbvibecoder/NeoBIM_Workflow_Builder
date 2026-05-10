"""Slice T2.0.1.2 — IfcRailing parametric builder.

Mirrors `wall_builder.create_wall_parametric` but emits `IfcRailing`
instead of `IfcWall`. Used for balcony parapets, terrace edges,
mezzanine guard-rails, etc. — anywhere a `Wall(type="railing")` is
declared in the BuildingModel.

Design choice (Slice T2.0.1.2):
  * Wall(type="railing") rides the existing Wall validation + placement
    + geometry resolution pipeline. Only the IFC entity class differs.
  * The bridge layer (currently `scripts/export_2bhk_pune_to_ifc.py`)
    dispatches on `wall.type` — type="railing" → this builder; all
    other types → `wall_builder.create_wall_parametric`.
  * The railing's "thickness" (Wall.thickness, e.g., 0.050 m) is the
    width of the railing infill — not a structural dim. Visually a
    thin extruded panel; Phase 9 stair / railing detailing slice will
    refine to actual bars / glass panels.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid

if TYPE_CHECKING:
    from app.domain.building_model import Wall
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_railing_parametric(
    wall: "Wall",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Create an `IfcRailing` from a Wall(type="railing") node.

    Same signature as `create_wall_parametric` so callers can dispatch
    on `wall.type` without changing the call site shape. The geometry
    is a thin rectangle extruded vertically — same SweptSolid family
    as a wall, just with `IfcRailing` as the IFC class.

    `wall.thickness` is the railing infill thickness (e.g., 0.050 m for
    a thin metal panel; 0.012 m for toughened glass would be valid too).
    `extrusion_depth` is the railing height — determined by
    `wall.top_z - wall.base_z`, so the FLAT template controls the
    railing height by setting wall.top_z (e.g., elevation + 1.1 m for a
    1.1 m guard-rail).
    """
    if geometry.representation_type != "SweptSolid":
        raise ValueError(
            f"Railing '{wall.id}' geometry has representation_type "
            f"'{geometry.representation_type}', expected 'SweptSolid'."
        )
    if geometry.profile_type != "rectangle":
        raise ValueError(
            f"Railing '{wall.id}' geometry has profile_type "
            f"'{geometry.profile_type}', expected 'rectangle'."
        )
    if geometry.profile_x_dim is None or geometry.profile_y_dim is None:
        raise ValueError(
            f"Railing '{wall.id}' geometry missing rectangle dimensions "
            f"(x_dim={geometry.profile_x_dim}, y_dim={geometry.profile_y_dim})."
        )
    if geometry.extrusion_depth is None or geometry.extrusion_depth <= 0:
        raise ValueError(
            f"Railing '{wall.id}' geometry has invalid extrusion_depth "
            f"{geometry.extrusion_depth}; expected > 0."
        )

    length = float(geometry.profile_x_dim)
    thickness = float(geometry.profile_y_dim)
    height = float(geometry.extrusion_depth)
    extr_dir = geometry.extrusion_direction
    if extr_dir is None:
        # Default vertical extrusion (same as wall_builder._DEFAULT_UP).
        class _Up:
            x = 0.0
            y = 0.0
            z = 1.0
        extr_dir = _Up()

    railing_entity = api.run(
        "root.create_entity", ifc_file, ifc_class="IfcRailing"
    )
    railing_entity.GlobalId = derive_guid("IfcRailing", wall.id)
    railing_entity.Name = wall.name if wall.name else wall.id
    # IfcRailing PredefinedType: GUARDRAIL (balcony), HANDRAIL (stair),
    # BALUSTRADE (vertical bars). Default to GUARDRAIL since balcony
    # parapets are the primary use case.
    railing_entity.PredefinedType = "GUARDRAIL"

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, railing_entity)

    # IfcLocalPlacement built from ResolvedPlacement (same as wall).
    origin_pt = ifc_file.create_entity(
        "IfcCartesianPoint",
        Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
    )
    z_dir = ifc_file.create_entity(
        "IfcDirection",
        DirectionRatios=(
            placement.local_z_axis.x,
            placement.local_z_axis.y,
            placement.local_z_axis.z,
        ),
    )
    x_dir = ifc_file.create_entity(
        "IfcDirection",
        DirectionRatios=(
            placement.local_x_axis.x,
            placement.local_x_axis.y,
            placement.local_x_axis.z,
        ),
    )
    placement_3d = ifc_file.create_entity(
        "IfcAxis2Placement3D", Location=origin_pt, Axis=z_dir, RefDirection=x_dir
    )
    railing_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement", RelativePlacement=placement_3d
    )

    # IfcExtrudedAreaSolid — thin rectangular profile extruded upward.
    rect_profile = ifc_file.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=length,
        YDim=thickness,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement2D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(length / 2.0, 0.0)
            ),
        ),
    )
    extrusion_dir = ifc_file.create_entity(
        "IfcDirection", DirectionRatios=(extr_dir.x, extr_dir.y, extr_dir.z)
    )
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=rect_profile,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=extrusion_dir,
        Depth=height,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    railing_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    return railing_entity


__all__ = ["create_railing_parametric"]
