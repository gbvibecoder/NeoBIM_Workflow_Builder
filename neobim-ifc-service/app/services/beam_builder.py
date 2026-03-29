"""Beam builder — creates IfcBeam with I-section or rectangular profiles."""

from __future__ import annotations

import math

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import new_guid


def create_beam(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
) -> ifcopenshell.entity_instance:
    """Create an IfcBeam with I-section profile."""
    props = elem.properties
    length = props.length or 6.0
    height = props.height or 0.4  # beam depth
    width = props.width or 0.2  # flange width

    beam = api.run("root.create_entity", model, ifc_class="IfcBeam")
    beam.GlobalId = new_guid()
    beam.Name = props.name

    api.run("spatial.assign_container", model, relating_structure=storey, products=[beam])

    # Position from vertices
    if len(elem.vertices) >= 2:
        v0, v1 = elem.vertices[0], elem.vertices[1]
        cx, cy, cz = v0.x, v0.y, v0.z
        dx = v1.x - v0.x
        dy = v1.y - v0.y
    else:
        cx, cy, cz = 0.0, 0.0, 0.0
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

    # I-shape profile
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
