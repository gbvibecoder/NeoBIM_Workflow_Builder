"""Stair builder — creates IfcStairFlight with stepped geometry.

Slice 5 adds `create_stair_parametric`. Note: full IfcStair composite
assembly (IfcStair + flights + landings + railings) is reserved for
Phase 7's IFC4 hardening — this builder produces a single IfcStairFlight
matching the legacy output, but riser_count / riser_height come from
the BuildingModel (already validated by STAIR_RISE_MATCHES) instead of
free-form props.

Slice T2.0.4.A — STAIR_FLIGHT_CLEARANCE_M lateral inset
-------------------------------------------------------
The pre-fix flight extruded across the full lateral span of its plan
polygon, leaving the south shaft wall touching the flight (0 mm gap)
and the north wall at the polygon edge. The diagnostic at
``scripts/inspect_stair_shaft_clearance.py`` quantifies this on the
3BHK G+5 tower (5 flights × multiple touching wall pairs).

The fix applies a 150 mm lateral inset INSIDE the IfcExtrudedAreaSolid's
local frame so the flight's external IfcLocalPlacement origin (used by
the placement resolver and any cross-product references) stays
unchanged. The inset shrinks ``Depth`` by 2 × 150 mm and shifts the
extrusion start by +150 mm in world Y via the swept solid's local
``Position.Location`` (which, after the T2.0.1.1 axis flip, maps
local −Z to world +Y).

Run-direction (X) overhang — where the flight's total_run
(``riser_count × tread_depth``) exceeds the shaft's inner X dimension —
is *not* addressed here. That requires a BuildingModel-level change to
the templates' stair plan_polygon and is deferred to a future slice.
NBC-India residential minimum stair width is 900 mm; the inset takes
the 3BHK G+5 example from 1.365 m to 1.065 m, comfortably above NBC.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.api as api

from app.models.request import GeometryElement
from app.utils.guid import derive_guid


# Lateral clearance inset between the IfcStairFlight and its enclosing
# shaft walls. 150 mm matches the spec; tunable but pinned by
# `test_stair_flight_clearance_from_shaft_walls`.
STAIR_FLIGHT_CLEARANCE_M: float = 0.150

if TYPE_CHECKING:
    from app.domain.building_model import Stair
    from app.services.geometry_resolver import ResolvedGeometry
    from app.services.placement_resolver import ResolvedPlacement


def create_stair(
    model: ifcopenshell.file,
    elem: GeometryElement,
    storey: ifcopenshell.entity_instance,
    context: ifcopenshell.entity_instance,
    storey_elevation: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Create an IfcStairFlight as a simplified extruded solid."""
    props = elem.properties
    height = props.height or 3.0
    width = props.width or 1.2
    riser_count = props.riser_count or 17
    riser_height = props.riser_height or (height / riser_count)
    tread_depth = props.tread_depth or 0.28
    total_run = riser_count * tread_depth

    stair = api.run("root.create_entity", model, ifc_class="IfcStairFlight")
    stair.GlobalId = derive_guid("IfcStairFlight", elem.id)
    stair.Name = props.name
    stair.NumberOfRisers = riser_count
    stair.RiserHeight = riser_height
    stair.TreadLength = tread_depth

    from app.utils.ifc_helpers import assign_to_storey
    assign_to_storey(model, storey, stair)

    # Position. Emitters put absolute world Z on v0.z; use it when present,
    # fall back to storey_elevation only when v0.z is zero.
    cx, cy, cz = 0.0, 0.0, storey_elevation
    if elem.vertices:
        v0 = elem.vertices[0]
        cx, cy = v0.x, v0.y
        cz = v0.z if v0.z else storey_elevation

    stair.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(cx, cy, cz)),
        ),
    )

    # Build stepped profile as polyline
    points = [(0.0, 0.0)]
    for i in range(riser_count):
        x = i * tread_depth
        z = i * riser_height
        points.append((x, z + riser_height))
        points.append((x + tread_depth, z + riser_height))
    # Close back to start
    points.append((total_run, 0.0))
    points.append((0.0, 0.0))

    ifc_pts = [
        model.create_entity("IfcCartesianPoint", Coordinates=(x, z))
        for x, z in points
    ]
    polyline = model.create_entity("IfcPolyline", Points=ifc_pts)
    profile = model.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    # Extrude along Y for stair width
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            RefDirection=model.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=(0.0, 1.0, 0.0)),
        Depth=width,
    )

    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    stair.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )

    return stair


def create_stair_parametric(
    stair: "Stair",
    placement: "ResolvedPlacement",
    geometry: "ResolvedGeometry",
    ifc_file: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    ifc_storey: ifcopenshell.entity_instance,
    type_registry,
) -> ifcopenshell.entity_instance:
    """Slice 5 parametric IfcStairFlight. riser_count and riser_height come
    directly from the BuildingModel (already validated by
    STAIR_RISE_MATCHES); no defaults applied."""
    stair_entity = api.run("root.create_entity", ifc_file, ifc_class="IfcStairFlight")
    stair_entity.GlobalId = derive_guid("IfcStairFlight", stair.id)
    stair_entity.Name = stair.id
    stair_entity.NumberOfRisers = stair.riser_count
    stair_entity.RiserHeight = stair.riser_height
    stair_entity.TreadLength = stair.tread_depth

    from app.utils.ifc_helpers import assign_to_storey

    assign_to_storey(ifc_file, ifc_storey, stair_entity)

    stair_entity.ObjectPlacement = ifc_file.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(placement.origin.x, placement.origin.y, placement.origin.z),
            ),
        ),
    )

    # Stepped polyline profile (mirrors legacy create_stair geometry).
    total_run = stair.riser_count * stair.tread_depth
    points = [(0.0, 0.0)]
    for i in range(stair.riser_count):
        x = i * stair.tread_depth
        z = i * stair.riser_height
        points.append((x, z + stair.riser_height))
        points.append((x + stair.tread_depth, z + stair.riser_height))
    points.append((total_run, 0.0))
    points.append((0.0, 0.0))

    ifc_pts = [
        ifc_file.create_entity("IfcCartesianPoint", Coordinates=(x, z))
        for x, z in points
    ]
    polyline = ifc_file.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc_file.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    # Stair width — derive from plan_polygon bounding box width (Slice 5
    # uses the simpler legacy convention; Phase 7 will model proper
    # IfcStair composite).
    xs = [p.x for p in stair.plan_polygon]
    ys = [p.y for p in stair.plan_polygon]
    raw_width = min(max(xs) - min(xs), max(ys) - min(ys))

    # Slice T2.0.4.A — lateral clearance inset.
    # Shrink the extrusion depth by 2 × CLEARANCE so the flight clears
    # the south + north shaft walls. NBC India residential minimum
    # stair width is 0.9 m; the diagnostic at
    # `scripts/inspect_stair_shaft_clearance.py` shows current
    # plan_polygon widths of 1.0-1.5 m, so a 0.3 m total inset stays
    # well above NBC. Defensive floor guards against future templates
    # that author a narrower polygon.
    width = max(raw_width - 2.0 * STAIR_FLIGHT_CLEARANCE_M, 0.9)

    # Slice T2.0.1.1 — IFC axis configuration for the stepped stair
    # body. The polyline above is constructed in (x, z) world-intent
    # coords (x = run direction, "z" = vertical rise). IFC profiles
    # always live in the local XY plane; to make local Y map to world Z
    # (so the polyline's "rise" axis becomes vertical), we set
    # Axis=(0,-1,0) — local Z = world -Y. The right-handed cross
    # gives Local Y = (0,-1,0) × (1,0,0) = (0,0,1) = world +Z, exactly
    # what we want. ExtrudedDirection=(0,0,-1) is local -Z = world +Y,
    # so the body extends laterally for the stair WIDTH along world Y.
    # Pre-fix: Position had no Axis (defaulted to (0,0,1)), so local Y
    # = (0,1,0) = world Y. Polyline's "rise" was interpreted as world Y
    # (lateral, not vertical), and ExtrudedDirection=(0,1,0) extruded
    # along the SAME local Y axis as the profile — collapsing the body
    # into a flat shape with z=[0,0]. The diagnostic at
    # `scripts/inspect_g5_balconies.py` caught this.
    #
    # Slice T2.0.4.A — Position.Location shifts the swept solid's
    # profile origin to apply the lateral clearance inset INSIDE the
    # stair entity's local frame, leaving the entity's external
    # IfcLocalPlacement origin unchanged (so cross-product references
    # to placement.origin keep working).
    #
    # Location is a TRANSLATION in the *entity-local* coordinate system
    # (the parent of the profile). With no entity rotation in our
    # ObjectPlacement, entity-local Y = world Y. So Location.y = +0.150
    # shifts the extrusion start by +150 mm in world Y. Combined with
    # the 2 × CLEARANCE depth reduction above, the flight clears 150 mm
    # from the south shaft wall and 150 mm from the north shaft wall.
    #
    # Note: this is *entity-local Y translation*, NOT the rotated
    # profile-local Z. The Axis/RefDirection rotation only affects the
    # orientation of the SWEPT PROFILE inside the entity-local frame —
    # it does NOT rotate the Location vector. An earlier attempt at
    # Location.z=-CLEARANCE (under the misread that local−Z=world+Y
    # for translation purposes) shifted the stair *vertically* below
    # the storey floor; the diagnostic at
    # `scripts/inspect_stair_shaft_clearance.py` caught this in a single
    # round-trip.
    solid = ifc_file.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc_file.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc_file.create_entity(
                "IfcCartesianPoint",
                Coordinates=(0.0, STAIR_FLIGHT_CLEARANCE_M, 0.0),
            ),
            Axis=ifc_file.create_entity(
                "IfcDirection", DirectionRatios=(0.0, -1.0, 0.0)
            ),
            RefDirection=ifc_file.create_entity(
                "IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=ifc_file.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, -1.0)
        ),
        Depth=width,
    )
    shape_rep = ifc_file.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    stair_entity.Representation = ifc_file.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    return stair_entity
