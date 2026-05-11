"""Phase P1.5.B + P1.6.A — BuildingModel-keyed Pset / Qto populator
plus instance-level material assignment.

The existing `app/services/property_sets.py` is keyed off
`GeometryElement` (the lifted-massing pipeline). Tier-2 templates skip
that lift and build IFC directly from `BuildingModel`. This module
mirrors the standard Pset/Qto population for the BuildingModel-direct
path.

For each IFC element produced by `scripts/export_2bhk_pune_to_ifc.py`
(and the 1BHK/3BHK family equivalents), attach the appropriate
Pset_*Common (and Qto_*BaseQuantities where applicable):

  * IfcWall   → Pset_WallCommon + Qto_WallBaseQuantities
  * IfcSlab   → Pset_SlabCommon + Qto_SlabBaseQuantities
  * IfcColumn → Pset_ColumnCommon + Qto_ColumnBaseQuantities
  * IfcBeam   → Pset_BeamCommon + Qto_BeamBaseQuantities
  * IfcDoor   → Pset_DoorCommon
  * IfcWindow → Pset_WindowCommon
  * IfcSpace  → Pset_SpaceCommon + Qto_SpaceBaseQuantities
  * IfcStair  / IfcStairFlight → Pset_StairCommon
  * IfcRailing → Pset_RailingCommon
  * IfcCovering → Pset_CoveringCommon
  * IfcSite   → Pset_SiteCommon

Determinism: same BuildingModel + same fixed wall-clock fields
produce byte-identical IFC. ifcopenshell's `pset.add_pset` /
`pset.edit_pset` API uses `derive_guid` on each Pset.
"""

from __future__ import annotations

from typing import Mapping

import ifcopenshell
import ifcopenshell.api as api
from shapely.geometry import Polygon

from app.domain.building_model import (
    Beam,
    BuildingModel,
    Column,
    Door,
    Room,
    Slab,
    Stair,
    Wall,
    Window,
)


def _create_pset(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    pset_name: str,
    properties: dict[str, object],
) -> None:
    pset = api.run("pset.add_pset", model, product=element, name=pset_name)
    api.run("pset.edit_pset", model, pset=pset, properties=properties)


# ─── P1.6.A — Instance-level material cache ────────────────────────


def _get_or_create_material(
    model: ifcopenshell.file,
    cache: dict[str, ifcopenshell.entity_instance],
    name: str,
    category: str = "concrete",
) -> ifcopenshell.entity_instance:
    """Return a cached IfcMaterial, creating it on first access."""
    if name not in cache:
        mat = api.run("material.add_material", model, name=name, category=category)
        cache[name] = mat
    return cache[name]


def _assign_material(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    material: ifcopenshell.entity_instance,
) -> None:
    """Attach an IfcMaterial to an element via IfcRelAssociatesMaterial.

    P1.6 fix: instance-level material assignment (LOD-300 IDS rule
    requires IfcRelAssociatesMaterial on every IfcBeam/IfcColumn/IfcSlab/
    IfcFooting instance, not just on its IfcXxxType).
    """
    api.run(
        "material.assign_material",
        model,
        products=[element],
        type="IfcMaterial",
        material=material,
    )


def _create_qto(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    qto_name: str,
    quantities: dict[str, float],
) -> None:
    qto = api.run("pset.add_qto", model, product=element, name=qto_name)
    api.run("pset.edit_qto", model, qto=qto, properties=quantities)


# ─── Wall ──────────────────────────────────────────────────────────


def _populate_wall(
    model: ifcopenshell.file,
    ifc_wall: ifcopenshell.entity_instance,
    wall: Wall,
) -> None:
    is_external = bool(wall.is_external)
    is_load_bearing = bool(wall.is_load_bearing)
    height = max(wall.top_z - wall.base_z, 0.001)
    # axis_points is at least 2 Vec2s; length = first→last segment for
    # straight walls (the templates use straight axes).
    p0 = wall.axis_points[0]
    p1 = wall.axis_points[-1]
    length = ((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2) ** 0.5

    _create_pset(model, ifc_wall, "Pset_WallCommon", {
        "Reference": wall.id,
        "IsExternal": is_external,
        "LoadBearing": is_load_bearing,
        "FireRating": "REI 120" if is_external else "EI 60",
        "AcousticRating": "Rw 50dB" if is_external else "Rw 40dB",
        "ThermalTransmittance": 0.25 if is_external else 0.0,
        "Compartmentation": is_external,
        "ExtendToStructure": False,
    })

    gross_side = length * height
    _create_qto(model, ifc_wall, "Qto_WallBaseQuantities", {
        "Length": length,
        "Height": height,
        "Width": wall.thickness,
        "GrossSideArea": gross_side,
        "NetSideArea": gross_side * 0.92,
        "GrossVolume": gross_side * wall.thickness,
        "NetVolume": gross_side * 0.92 * wall.thickness,
    })


# ─── Railing (Wall(type="railing")) ────────────────────────────────


def _populate_railing(
    model: ifcopenshell.file,
    ifc_railing: ifcopenshell.entity_instance,
    wall: Wall,
) -> None:
    height = max(wall.top_z - wall.base_z, 0.001)
    _create_pset(model, ifc_railing, "Pset_RailingCommon", {
        "Reference": wall.id,
        "Height": height,
        "Diameter": wall.thickness,
    })


# ─── Slab ──────────────────────────────────────────────────────────


def _populate_slab(
    model: ifcopenshell.file,
    ifc_slab: ifcopenshell.entity_instance,
    slab: Slab,
) -> None:
    is_roof = slab.predefined_type == "ROOF"
    thickness = max(slab.top_z - slab.bottom_z, 0.001)
    poly = Polygon([(v.x, v.y) for v in slab.footprint_polygon])
    area = poly.area if poly.is_valid else 0.0
    perimeter = poly.length if poly.is_valid else 0.0

    _create_pset(model, ifc_slab, "Pset_SlabCommon", {
        "Reference": slab.id,
        "IsExternal": is_roof,
        "LoadBearing": True,
        "FireRating": "REI 120",
        "AcousticRating": "Rw 50dB",
        "ThermalTransmittance": 0.20 if is_roof else 0.0,
        "Combustible": False,
    })
    _create_qto(model, ifc_slab, "Qto_SlabBaseQuantities", {
        "Depth": thickness,
        "Perimeter": perimeter,
        "GrossArea": area,
        "NetArea": area * 0.95,
        "GrossVolume": area * thickness,
        "NetVolume": area * 0.95 * thickness,
    })


# ─── Column ────────────────────────────────────────────────────────


def _populate_column(
    model: ifcopenshell.file,
    ifc_col: ifcopenshell.entity_instance,
    col: Column,
) -> None:
    height = max(col.top_z - col.base_z, 0.001)
    width = float(col.profile.dimensions.get("width", 0.300))
    depth = float(col.profile.dimensions.get("depth", 0.300))
    cross_area = width * depth
    perimeter = 2 * (width + depth)

    _create_pset(model, ifc_col, "Pset_ColumnCommon", {
        "Reference": col.id,
        "LoadBearing": bool(col.is_load_bearing),
        "FireRating": "R 120",
        "Slope": 0.0,
    })
    _create_qto(model, ifc_col, "Qto_ColumnBaseQuantities", {
        "Length": height,
        "CrossSectionArea": cross_area,
        "OuterSurfaceArea": perimeter * height,
        "GrossVolume": cross_area * height,
        "NetVolume": cross_area * height,
    })


# ─── Beam ──────────────────────────────────────────────────────────


def _populate_beam(
    model: ifcopenshell.file,
    ifc_beam: ifcopenshell.entity_instance,
    beam: Beam,
) -> None:
    sx, sy, sz = beam.start_point.x, beam.start_point.y, beam.start_point.z
    ex, ey, ez = beam.end_point.x, beam.end_point.y, beam.end_point.z
    length = ((ex - sx) ** 2 + (ey - sy) ** 2 + (ez - sz) ** 2) ** 0.5
    width = float(beam.profile.dimensions.get("width", 0.230))
    depth = float(beam.profile.dimensions.get("depth", 0.450))
    cross_area = width * depth

    _create_pset(model, ifc_beam, "Pset_BeamCommon", {
        "Reference": beam.id,
        "LoadBearing": True,
        "FireRating": "R 90",
        "Span": length,
        "Roll": 0.0,
    })
    _create_qto(model, ifc_beam, "Qto_BeamBaseQuantities", {
        "Length": length,
        "CrossSectionArea": cross_area,
        "OuterSurfaceArea": 2 * (width + depth) * length,
        "GrossVolume": cross_area * length,
        "NetVolume": cross_area * length,
    })


# ─── Door ──────────────────────────────────────────────────────────


def _populate_door(
    model: ifcopenshell.file,
    ifc_door: ifcopenshell.entity_instance,
    door: Door,
    is_exterior: bool,
    width: float,
    height: float,
) -> None:
    _create_pset(model, ifc_door, "Pset_DoorCommon", {
        "Reference": door.id,
        "IsExternal": is_exterior,
        "FireRating": "EI 60" if is_exterior else "EI 30",
        "AcousticRating": "Rw 35dB",
        "SecurityRating": "Class 3" if is_exterior else "Class 1",
        "HandicapAccessible": width >= 0.9,
        "SmokeStop": False,
    })


def _door_material_kind(
    door: Door, ifc_door: ifcopenshell.entity_instance
) -> str:
    """Slice P2.E — pick the door material kind by Door.predefined_type +
    final IfcDoor.OperationType (which already reflects the T2.0.4.B
    lift-door SLIDING override applied at the IFC layer)."""
    if door.predefined_type == "GATE":
        return "gate"
    op = ifc_door.OperationType or ""
    if "SLIDING" in op.upper():
        return "sliding-lift"
    return "swing"


# ─── Window ────────────────────────────────────────────────────────


def _populate_window(
    model: ifcopenshell.file,
    ifc_window: ifcopenshell.entity_instance,
    window: Window,
    width: float,
    height: float,
) -> None:
    _create_pset(model, ifc_window, "Pset_WindowCommon", {
        "Reference": window.id,
        "IsExternal": True,
        "FireRating": "REI 30",
        "SecurityRating": "Class 1",
        "AcousticRating": "Rw 30dB",
        "GlazingAreaFraction": 0.85,
        "ThermalTransmittance": 1.4,
        "SmokeStop": False,
    })


# ─── Space (Room) ──────────────────────────────────────────────────


def _populate_space(
    model: ifcopenshell.file,
    ifc_space: ifcopenshell.entity_instance,
    room: Room,
    storey_height: float,
) -> None:
    poly = Polygon([(v.x, v.y) for v in room.footprint_polygon])
    area = poly.area if poly.is_valid else 0.0
    perimeter = poly.length if poly.is_valid else 0.0

    _create_pset(model, ifc_space, "Pset_SpaceCommon", {
        "Reference": room.id,
        "Category": room.usage,
        "IsExternal": False,
        "PubliclyAccessible": False,
        "HandicapAccessible": True,
        "GrossPlannedArea": area,
        "NetPlannedArea": area * 0.92,
    })
    _create_qto(model, ifc_space, "Qto_SpaceBaseQuantities", {
        "Height": storey_height,
        "FinishCeilingHeight": storey_height - 0.012,  # ceiling finish
        "FinishFloorHeight": 0.010,                    # floor finish
        "GrossPerimeter": perimeter,
        "NetPerimeter": perimeter,
        "GrossFloorArea": area,
        "NetFloorArea": area * 0.92,
        "GrossWallArea": perimeter * storey_height,
        "NetWallArea": perimeter * storey_height * 0.85,
        "GrossVolume": area * storey_height,
        "NetVolume": area * 0.92 * storey_height,
    })


# ─── Stair ─────────────────────────────────────────────────────────


def _populate_stair(
    model: ifcopenshell.file,
    ifc_stair: ifcopenshell.entity_instance,
    stair: Stair,
) -> None:
    _create_pset(model, ifc_stair, "Pset_StairCommon", {
        "Reference": stair.id,
        "FireExit": True,
        "HandicapAccessible": True,
        "FireRating": "R 60",
        "NumberOfRiser": stair.riser_count,
        "NumberOfTreads": stair.riser_count - 1,
        "RiserHeight": stair.riser_height,
        "TreadLength": stair.tread_depth,
        "NosingLength": 0.020,
        "WalkingLineOffset": 0.500,
    })


# ─── Site ──────────────────────────────────────────────────────────


def _populate_site(
    model: ifcopenshell.file,
    ifc_site: ifcopenshell.entity_instance,
) -> None:
    _create_pset(model, ifc_site, "Pset_SiteCommon", {
        "Reference": "Tier-2 Pune Plot",
        "BuildableArea": 100.0,
        "TotalArea": 200.0,
        "BuildingHeightLimit": 36.0,
    })


# ─── Public API ────────────────────────────────────────────────────


def populate_psets_from_building_model(
    model: ifcopenshell.file,
    bm: BuildingModel,
    *,
    wall_entities: Mapping[str, ifcopenshell.entity_instance],
    slab_entities: Mapping[str, ifcopenshell.entity_instance],
    column_entities: Mapping[str, ifcopenshell.entity_instance],
    beam_entities: Mapping[str, ifcopenshell.entity_instance],
    space_entities: Mapping[str, ifcopenshell.entity_instance],
    door_entities: Mapping[str, ifcopenshell.entity_instance],
    window_entities: Mapping[str, ifcopenshell.entity_instance],
    stair_entities: Mapping[str, ifcopenshell.entity_instance],
    footing_entities: Mapping[str, ifcopenshell.entity_instance] | None = None,
    railing_entities: Mapping[str, ifcopenshell.entity_instance] | None = None,
    ifc_site: ifcopenshell.entity_instance | None = None,
) -> None:
    """Populate Pset_*Common + Qto_*BaseQuantities on every IFC element
    derived from a BuildingModel node.

    Caller passes `<class>_entities` maps from BuildingModel-id → IFC
    instance. Missing entries are silently skipped (some nodes may have
    been pruned before reaching IFC, e.g., stilt-floor flat slabs).
    """
    bld = bm.project.site.building
    storey_height_by_id: dict[str, float] = {
        s.id: float(s.actual_height) for s in bld.storeys
    }

    # P1.6.A — instance-level material cache for structural elements.
    mat_cache: dict[str, ifcopenshell.entity_instance] = {}
    rcc = _get_or_create_material(model, mat_cache, "M25-RCC", "concrete")
    brick = _get_or_create_material(
        model, mat_cache, "Burnt-Clay-Brick-230mm", "masonry"
    )
    ms_steel = _get_or_create_material(model, mat_cache, "MS-Steel", "steel")
    vit_tile = _get_or_create_material(
        model, mat_cache, "Vitrified-Tile-Floor", "finish"
    )
    gypsum = _get_or_create_material(model, mat_cache, "Gypsum-Board", "finish")
    # Slice P2.E — door-specific material set.
    teak = _get_or_create_material(model, mat_cache, "Teak-Door", "wood")
    glass = _get_or_create_material(
        model, mat_cache, "Glass-Tempered", "glass"
    )

    # Collect all walls for railing/wall dispatch.
    for storey in bld.storeys:
        for wall in storey.walls:
            ifc_w = wall_entities.get(wall.id)
            if ifc_w is None:
                continue
            if wall.type == "railing":
                _populate_railing(model, ifc_w, wall)
                _assign_material(model, ifc_w, ms_steel)
            else:
                _populate_wall(model, ifc_w, wall)
                _assign_material(model, ifc_w, brick)

        for slab in storey.slabs:
            ifc_s = slab_entities.get(slab.id)
            if ifc_s is None:
                continue
            _populate_slab(model, ifc_s, slab)
            _assign_material(model, ifc_s, rcc)

        for room in storey.rooms:
            ifc_sp = space_entities.get(room.id)
            if ifc_sp is None:
                continue
            _populate_space(
                model, ifc_sp, room,
                storey_height=storey_height_by_id.get(storey.id, 3.0),
            )

        for stair in storey.stairs:
            ifc_st = stair_entities.get(stair.id)
            if ifc_st is None:
                continue
            _populate_stair(model, ifc_st, stair)
            _assign_material(model, ifc_st, rcc)

    for col in bld.structural_system.columns:
        ifc_c = column_entities.get(col.id)
        if ifc_c is None:
            continue
        _populate_column(model, ifc_c, col)
        _assign_material(model, ifc_c, rcc)

    for beam in bld.structural_system.beams:
        ifc_b = beam_entities.get(beam.id)
        if ifc_b is None:
            continue
        _populate_beam(model, ifc_b, beam)
        _assign_material(model, ifc_b, rcc)

    # P1.6.A — Footings (if tracked).
    if footing_entities and bld.foundation:
        for footing in bld.foundation.footings:
            ifc_f = footing_entities.get(footing.id)
            if ifc_f is None:
                continue
            _create_pset(model, ifc_f, "Pset_FootingCommon", {
                "Reference": footing.id,
                "LoadBearing": True,
                "FireRating": "REI 120",
            })
            _assign_material(model, ifc_f, rcc)

    # Doors / Windows — width/height from the linked Opening.
    openings_by_id = {
        o.id: o for st in bld.storeys for o in st.openings
    }
    walls_by_id = {
        w.id: w for st in bld.storeys for w in st.walls
    }
    for door in bld.doors:
        ifc_d = door_entities.get(door.id)
        if ifc_d is None:
            continue
        op = openings_by_id.get(door.in_opening_id)
        if op is None:
            continue
        host_wall = walls_by_id.get(op.in_wall_id)
        is_exterior = bool(host_wall.is_external) if host_wall else False
        _populate_door(model, ifc_d, door, is_exterior, op.width, op.height)
        # Slice P2.E — instance-level door material differentiation.
        kind = _door_material_kind(door, ifc_d)
        if kind == "gate":
            _assign_material(model, ifc_d, ms_steel)
        elif kind == "sliding-lift":
            # Lift cabin doors: MS-Steel frame + Glass panel.
            # IfcMaterialList carries both so the model.by_type query
            # surfaces them as instance-level materials. ifcopenshell's
            # `material.assign_material` for `type="IfcMaterialList"`
            # accepts a single material= argument that IS the list
            # entity; we build it manually so both members are present.
            mat_list = model.create_entity(
                "IfcMaterialList", Materials=[ms_steel, glass]
            )
            api.run(
                "material.assign_material",
                model,
                products=[ifc_d],
                type="IfcMaterialList",
                material=mat_list,
            )
        else:
            _assign_material(model, ifc_d, teak)

    for window in bld.windows:
        ifc_w = window_entities.get(window.id)
        if ifc_w is None:
            continue
        op = openings_by_id.get(window.in_opening_id)
        if op is None:
            continue
        _populate_window(model, ifc_w, window, op.width, op.height)

    if ifc_site is not None:
        _populate_site(model, ifc_site)


__all__ = ["populate_psets_from_building_model"]
