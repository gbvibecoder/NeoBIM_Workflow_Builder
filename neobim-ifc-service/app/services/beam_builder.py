"""Beam builder — creates IfcBeam with I-section or rectangular profiles.

Slice 5 adds `create_beam_parametric` consuming BuildingModel + resolved
data; no fallback chains. Legacy `create_beam` retained.
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
    from app.domain.building_model import Beam
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_beam(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcBeam with I-section profile.

    `storey_elevation` lifts the beam onto its storey so multi-storey
    frames stack correctly.
    """
    props = elem.properties
    length = props.length or 6.0
    height = props.height or 0.4  # beam depth
    width = props.width or 0.2  # flange width

    beam = api.run("root.create_entity", model, ifc_class="IfcBeam")
    beam.GlobalId = derive_guid("IfcBeam", elem.id)
    beam.Name = props.name

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, beam)

    # Position from vertices. Emitters put absolute world Z on v0.z; use it
    # when present, fall back to storey_elevation only when v0.z is zero.
    if len(elem.vertices) >= 2:
        v0, v1 = elem.vertices[0], elem.vertices[1]
        cx, cy = v0.x, v0.y
        cz = v0.z if v0.z else storey_elevation
        dx = v1.x - v0.x
        dy = v1.y - v0.y
    else:
        cx, cy, cz = 0.0, 0.0, storey_elevation
        dx, dy = 1.0, 0.0

    dir_len = math.sqrt(dx * dx + dy * dy)
    if dir_len < 1e-9:
        dx, dy = 1.0, 0.0
        dir_len = 1.0

    beam.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
            Axis=model.create_entity("IfcDirection", DirectionRatios=(dx / dir_len, dy / dir_len, 0.0)),
            RefDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        ),
    )

    # I-shape profile (Phase 2 / Fix 11):
    #   * Steel + IS-808 designation → spec dimensions (ProfileName set).
    #   * Otherwise → generic 15mm/10mm flange/web fallback (pre-Phase-2).
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
        flange_thickness = 0.015
        web_thickness = 0.010
        profile = model.create_entity(
            "IfcIShapeProfileDef",
            ProfileType="AREA",
            OverallWidth=width,
            OverallDepth=height,
            WebThickness=web_thickness,
            FlangeThickness=flange_thickness,
        )

    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=length,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    beam.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return beam


def create_beam_parametric(
    beam: "Beam",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcBeam. Length comes from
    ResolvedGeometry.extrusion_depth (axis distance, not props.length);
    profile comes from BuildingModel ProfileRef."""
    if geometry.representation_type != "SweptSolid":
        raise ValueError(
            f"Beam '{beam.id}' representation_type "
            f"'{geometry.representation_type}', expected 'SweptSolid'."
        )
    if geometry.extrusion_depth is None or geometry.extrusion_depth <= 0:
        raise ValueError(
            f"Beam '{beam.id}' invalid extrusion_depth {geometry.extrusion_depth}."
        )

    beam_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcBeam")
    beam_entity.GlobalId = derive_guid("IfcBeam", beam.id)
    beam_entity.Name = beam.id

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, beam_entity)

    # Placement carries axis direction in local_x_axis; this is the
    # direction the I-section gets extruded along.
    beam_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
            Axis=ifc_file.create_entity(
                "IfcDirection",
                DirectionRatios=(
                    placement.local_x_axis.x,
                    placement.local_x_axis.y,
                    placement.local_x_axis.z,
                ),
            ),
            RefDirection=ifc_file.create_entity(
                "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
            ),
        ),
    )

    # Profile selection: steel-section override, then ProfileRef-based I-shape.
    is_section = (
        get_is_section(beam.profile.name)
        if is_steel_material(beam.material)
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
    else:
        if geometry.profile_x_dim is None or geometry.profile_y_dim is None:
            raise ValueError(
                f"Beam '{beam.id}' rectangle profile missing dimensions "
                f"(x={geometry.profile_x_dim}, y={geometry.profile_y_dim})."
            )
        profile = ifc_file.create_entity(
            "IfcIShapeProfileDef",
            ProfileType="AREA",
            OverallWidth=float(geometry.profile_x_dim),
            OverallDepth=float(geometry.profile_y_dim),
            FlangeThickness=0.015,
            WebThickness=0.010,
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
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=geometry.extrusion_depth,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    beam_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return beam_entity
