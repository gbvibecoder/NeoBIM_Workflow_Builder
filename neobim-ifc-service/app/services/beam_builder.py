"""Beam builder — creates IfcBeam with I-section or rectangular profiles."""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.services.steel_profiles import get_is_section, is_steel_material
from app.utils.guid import derive_guid


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
