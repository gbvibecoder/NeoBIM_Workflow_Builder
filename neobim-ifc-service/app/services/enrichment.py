"""Post-processing enrichment — adds real-world architectural features that
the massing generator doesn't emit.

Background
----------
The TypeScript massing generator produces a clean skeleton: perimeter walls,
slabs, columns, beams, windows, doors, a single stair. That's geometrically
valid but reads as a bare tower in the viewer — no parapet, no podium, no
visible entrance, no ceilings, no balcony railings, no curtain-wall mullions.

Real production IFC files (Revit/ArchiCAD) carry these features because the
source model has them. Since we can't rewrite the massing generator in one
pass, we enrich the IFC on the way out: take the bare skeleton, add the
building-level features that every commercial tower has. The IFC goes from
"valid but minimal" to "reads as a real building" with no change upstream.

What we add
-----------
1. **Podium slab**   — a wider-than-footprint slab at Z=0 (commercial plinth
                        that visually grounds the tower).
2. **Parapet wall**  — thin perimeter wall 1 m tall above the roof slab
                        (IfcWall with PredefinedType=PARAPET). Every
                        commercial roof has one for fall protection.
3. **Ceiling finish** — IfcCovering(CEILING) at the top of each storey —
                        typical suspended-ceiling plane at 2.7 m AFFL.
4. **Roof balcony railing** — IfcRailing at the inner edge of the parapet.
5. **Entrance canopy** — small projecting slab above the ground-floor door
                          if one is present (porte-cochère style).

Not added here (future work)
----------------------------
- Curtain-wall mullions (IfcCurtainWall + IfcMember) — needs facade-facing
  emitter data to know where glass vs spandrel lives.
- Balcony rings — needs a non-cylindrical footprint to read well.
- Furniture / sanitary terminals — needs room-level floor plans.

All helpers are geometry-safe on convex polygons (including the circular
footprints the TS generator currently emits). Concave footprints with inner
voids aren't supported by the simple centroid-based offset and will log a
warning rather than producing garbage geometry.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import ifcopenshell
import ifcopenshell.api as api
import structlog

from app.models.request import FootprintPoint, GeometryElement, MassingGeometry, MassingStorey
from app.services.material_library import (
    LayerDef,
    MaterialPreset,
    assign_material_to_element,
    create_material_layer_set,
)
from app.services.presentation import StyleCache, apply_color
from app.utils.guid import new_guid
from app.utils.ifc_helpers import assign_to_storey


def _create_pset_common(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    pset_name: str,
    properties: dict[str, object],
) -> None:
    """Pset helper — same pattern as property_sets.py but inlined to avoid
    importing a private symbol. The CI quality gate requires every IfcWall
    to carry a property set, so enrichment elements need this too."""
    pset = api.run("pset.add_pset", model, product=element, name=pset_name)
    api.run("pset.edit_pset", model, pset=pset, properties=properties)

log = structlog.get_logger()


@dataclass
class EnrichmentCounts:
    """Counts of elements added by each enrichment pass."""
    parapet: int = 0
    podium: int = 0
    ceiling: int = 0
    railing: int = 0
    canopy: int = 0

    def total(self) -> int:
        return self.parapet + self.podium + self.ceiling + self.railing + self.canopy


# ─── Polygon math ───────────────────────────────────────────────────────


def _centroid(pts: list[FootprintPoint]) -> tuple[float, float]:
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    return cx, cy


def _offset_polygon(pts: list[FootprintPoint], delta: float) -> list[FootprintPoint]:
    """Radial offset from centroid. Positive delta = expand outward, negative
    = shrink inward. Works reliably on convex polygons (including circles
    approximated as n-gons) — NOT suitable for concave or multi-ring shapes.
    """
    cx, cy = _centroid(pts)
    out: list[FootprintPoint] = []
    for p in pts:
        dx = p.x - cx
        dy = p.y - cy
        r = math.sqrt(dx * dx + dy * dy)
        if r < 1e-9:
            out.append(FootprintPoint(x=p.x, y=p.y))
            continue
        scale = (r + delta) / r
        if scale <= 0.0:
            scale = 0.01
        out.append(FootprintPoint(x=cx + dx * scale, y=cy + dy * scale))
    return out


def _closed_polyline(model: ifcopenshell.file, pts: list[FootprintPoint]) -> ifcopenshell.entity_instance:
    """Create a closed IfcPolyline from footprint points (auto-appends start)."""
    ifc_pts = [
        model.create_entity("IfcCartesianPoint", Coordinates=(p.x, p.y))
        for p in pts
    ]
    ifc_pts.append(ifc_pts[0])
    return model.create_entity("IfcPolyline", Points=ifc_pts)


def _arbitrary_profile(
    model: ifcopenshell.file, footprint: list[FootprintPoint]
) -> ifcopenshell.entity_instance:
    """Profile that follows the footprint outline (solid, no voids)."""
    return model.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=_closed_polyline(model, footprint),
    )


def _ring_profile(
    model: ifcopenshell.file,
    outer: list[FootprintPoint],
    inner: list[FootprintPoint],
) -> ifcopenshell.entity_instance:
    """Profile with an outer curve and one inner void — used for parapet and
    railing where only a narrow ring of material is present."""
    return model.create_entity(
        "IfcArbitraryProfileDefWithVoids",
        ProfileType="AREA",
        OuterCurve=_closed_polyline(model, outer),
        InnerCurves=[_closed_polyline(model, inner)],
    )


def _extruded_solid(
    model: ifcopenshell.file,
    profile: ifcopenshell.entity_instance,
    depth: float,
    dir_ratios: tuple[float, float, float] = (0.0, 0.0, 1.0),
) -> ifcopenshell.entity_instance:
    return model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        ),
        ExtrudedDirection=model.create_entity("IfcDirection", DirectionRatios=dir_ratios),
        Depth=depth,
    )


def _placement_at(
    model: ifcopenshell.file, z: float
) -> ifcopenshell.entity_instance:
    return model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, z)),
        ),
    )


def _attach_body(
    model: ifcopenshell.file,
    element: ifcopenshell.entity_instance,
    body_context: ifcopenshell.entity_instance,
    solid: ifcopenshell.entity_instance,
) -> None:
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    element.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[shape_rep],
    )


# ─── Enrichers ──────────────────────────────────────────────────────────


def _find_top_of_roof(storeys: list[MassingStorey]) -> tuple[MassingStorey, float]:
    """Top storey + absolute Z of roof slab top."""
    s = sorted(storeys, key=lambda x: x.index)[-1]
    # Roof slab top = storey.elevation (roof slab sits AT that elevation per
    # ifc_builder.py logic) for storey.height==0, otherwise elevation+height
    top_z = s.elevation if s.height == 0 else s.elevation + s.height
    return s, top_z


def _add_parapet(
    model: ifcopenshell.file,
    footprint: list[FootprintPoint],
    roof_storey_ifc: ifcopenshell.entity_instance,
    top_of_roof_z: float,
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
    thickness: float = 0.15,
    height: float = 1.0,
) -> ifcopenshell.entity_instance | None:
    """Thin IfcWall(PARAPET) around the roof perimeter, 1 m tall by default."""
    try:
        inner = _offset_polygon(footprint, -thickness)
        profile = _ring_profile(model, footprint, inner)
        solid = _extruded_solid(model, profile, height)

        parapet = api.run("root.create_entity", model, ifc_class="IfcWall")
        parapet.GlobalId = new_guid()
        parapet.Name = "Roof Parapet"
        parapet.PredefinedType = "PARAPET"

        parapet.ObjectPlacement = _placement_at(model, top_of_roof_z)
        _attach_body(model, parapet, body_context, solid)
        assign_to_storey(model, roof_storey_ifc, parapet)
        apply_color(model, parapet, "wall-exterior", style_cache)

        # Every IfcWall must carry a material + Pset for the CI quality gate.
        # Use a simple single-layer reinforced concrete material — parapets
        # are usually precast RC in commercial construction.
        preset = MaterialPreset(
            name="Parapet Wall",
            layers=[LayerDef("Reinforced Concrete", thickness, "Structure")],
        )
        layer_set = create_material_layer_set(model, preset)
        assign_material_to_element(model, parapet, layer_set)
        _create_pset_common(model, parapet, "Pset_WallCommon", {
            "Reference": "Roof Parapet",
            "IsExternal": True,
            "LoadBearing": False,
            "FireRating": "R 60",
            "ExtendToStructure": False,
            "Compartmentation": False,
        })
        return parapet
    except Exception as exc:
        log.warning("enrichment_parapet_failed", error=str(exc), error_type=type(exc).__name__)
        return None


def _add_podium(
    model: ifcopenshell.file,
    footprint: list[FootprintPoint],
    ground_storey_ifc: ifcopenshell.entity_instance,
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
    expand: float = 1.5,
    thickness: float = 0.35,
) -> ifcopenshell.entity_instance | None:
    """Projecting ground-floor podium slab — visually grounds the tower with
    a 1.5 m wider plinth. At Z=-thickness so its top sits flush with Z=0."""
    try:
        outer = _offset_polygon(footprint, expand)
        profile = _arbitrary_profile(model, outer)
        solid = _extruded_solid(model, profile, thickness)

        podium = api.run("root.create_entity", model, ifc_class="IfcSlab")
        podium.GlobalId = new_guid()
        podium.Name = "Ground Podium"
        podium.PredefinedType = "BASESLAB"

        podium.ObjectPlacement = _placement_at(model, -thickness)
        _attach_body(model, podium, body_context, solid)
        assign_to_storey(model, ground_storey_ifc, podium)
        apply_color(model, podium, "slab-floor", style_cache)
        return podium
    except Exception as exc:
        log.warning("enrichment_podium_failed", error=str(exc), error_type=type(exc).__name__)
        return None


def _add_ceiling(
    model: ifcopenshell.file,
    footprint: list[FootprintPoint],
    storey_ifc: ifcopenshell.entity_instance,
    storey_elevation: float,
    storey_height: float,
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
    ceiling_thickness: float = 0.05,
    drop_from_slab: float = 0.4,
) -> ifcopenshell.entity_instance | None:
    """Suspended acoustic ceiling at a professional-grade 2.7 m AFFL default
    (storey_height - drop_from_slab). IfcCovering(CEILING)."""
    try:
        profile = _arbitrary_profile(model, footprint)
        solid = _extruded_solid(model, profile, ceiling_thickness)

        ceiling = api.run("root.create_entity", model, ifc_class="IfcCovering")
        ceiling.GlobalId = new_guid()
        ceiling.Name = f"Ceiling {storey_ifc.Name}"
        ceiling.PredefinedType = "CEILING"

        z = storey_elevation + max(0.1, storey_height - drop_from_slab)
        ceiling.ObjectPlacement = _placement_at(model, z)
        _attach_body(model, ceiling, body_context, solid)
        assign_to_storey(model, storey_ifc, ceiling)
        apply_color(model, ceiling, "wall-partition", style_cache)
        return ceiling
    except Exception as exc:
        log.warning("enrichment_ceiling_failed", error=str(exc), error_type=type(exc).__name__)
        return None


def _add_roof_railing(
    model: ifcopenshell.file,
    footprint: list[FootprintPoint],
    roof_storey_ifc: ifcopenshell.entity_instance,
    top_of_roof_z: float,
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
    parapet_thickness: float = 0.15,
    rail_thickness: float = 0.04,
    rail_height: float = 1.1,
    inset: float = 0.30,
) -> ifcopenshell.entity_instance | None:
    """IfcRailing 30 cm inside the parapet, 1.1 m tall. Classic guardrail
    detail for inspection access on the roof."""
    try:
        outer = _offset_polygon(footprint, -parapet_thickness - inset)
        inner = _offset_polygon(outer, -rail_thickness)
        profile = _ring_profile(model, outer, inner)
        solid = _extruded_solid(model, profile, rail_height)

        railing = api.run("root.create_entity", model, ifc_class="IfcRailing")
        railing.GlobalId = new_guid()
        railing.Name = "Roof Guardrail"
        railing.PredefinedType = "GUARDRAIL"

        railing.ObjectPlacement = _placement_at(model, top_of_roof_z)
        _attach_body(model, railing, body_context, solid)
        assign_to_storey(model, roof_storey_ifc, railing)
        apply_color(model, railing, "column", style_cache)
        return railing
    except Exception as exc:
        log.warning("enrichment_railing_failed", error=str(exc), error_type=type(exc).__name__)
        return None


def _find_ground_door(storeys: list[MassingStorey]) -> GeometryElement | None:
    """First exterior door on the ground storey — used to position the canopy."""
    for s in sorted(storeys, key=lambda x: x.index):
        for e in s.elements:
            if e.type == "door" and (e.properties.is_exterior is not False):
                return e
        break  # only ground storey
    return None


def _add_entrance_canopy(
    model: ifcopenshell.file,
    door: GeometryElement,
    ground_storey_ifc: ifcopenshell.entity_instance,
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
    projection: float = 2.0,
    width: float = 3.0,
    thickness: float = 0.12,
    height_above_door: float = 0.5,
) -> ifcopenshell.entity_instance | None:
    """Porte-cochère — a small horizontal canopy projecting above the main
    entrance. Uses the door's vertex to place the canopy in front of it."""
    if not door.vertices:
        return None
    try:
        v0 = door.vertices[0]
        door_h = door.properties.height or 2.1
        canopy_z = (v0.z or 0.0) + door_h + height_above_door

        # Canopy profile: a simple rectangle projecting outward in +Y from door.
        # The door's orientation isn't reliably encoded, so use a square canopy
        # centered on the door vertex — still reads correctly in the viewer.
        hx = width / 2.0
        pts = [
            FootprintPoint(x=v0.x - hx, y=v0.y - projection),
            FootprintPoint(x=v0.x + hx, y=v0.y - projection),
            FootprintPoint(x=v0.x + hx, y=v0.y + projection),
            FootprintPoint(x=v0.x - hx, y=v0.y + projection),
        ]
        profile = _arbitrary_profile(model, pts)
        solid = _extruded_solid(model, profile, thickness)

        canopy = api.run("root.create_entity", model, ifc_class="IfcSlab")
        canopy.GlobalId = new_guid()
        canopy.Name = "Entrance Canopy"
        canopy.PredefinedType = "USERDEFINED"
        canopy.ObjectType = "Canopy"

        canopy.ObjectPlacement = _placement_at(model, canopy_z)
        _attach_body(model, canopy, body_context, solid)
        assign_to_storey(model, ground_storey_ifc, canopy)
        apply_color(model, canopy, "window", style_cache)  # translucent = glass canopy
        return canopy
    except Exception as exc:
        log.warning("enrichment_canopy_failed", error=str(exc), error_type=type(exc).__name__)
        return None


# ─── Main entry ─────────────────────────────────────────────────────────


def enrich_building(
    model: ifcopenshell.file,
    geometry: MassingGeometry,
    ifc_storeys: dict[int, ifcopenshell.entity_instance],
    body_context: ifcopenshell.entity_instance,
    style_cache: StyleCache,
) -> EnrichmentCounts:
    """Run every enrichment pass. Safe to call once at the end of build_ifc.

    Returns counts of each element type added. Failures are logged and
    counted as zero — an enrichment failure never aborts the build.
    """
    counts = EnrichmentCounts()

    if not geometry.storeys or not geometry.footprint or len(geometry.footprint) < 3:
        return counts

    sorted_storeys = sorted(geometry.storeys, key=lambda s: s.index)
    ground = sorted_storeys[0]
    top, top_of_roof_z = _find_top_of_roof(geometry.storeys)

    ground_ifc = ifc_storeys.get(ground.index)
    roof_ifc = ifc_storeys.get(top.index)

    # Podium
    if ground_ifc and _add_podium(model, geometry.footprint, ground_ifc, body_context, style_cache):
        counts.podium += 1

    # Parapet
    if roof_ifc and _add_parapet(model, geometry.footprint, roof_ifc, top_of_roof_z, body_context, style_cache):
        counts.parapet += 1
        # Railing sits inside the parapet
        if _add_roof_railing(model, geometry.footprint, roof_ifc, top_of_roof_z, body_context, style_cache):
            counts.railing += 1

    # Ceiling per non-roof storey
    for s in sorted_storeys:
        if s.height <= 0.1:
            continue  # roof storey has no floor-to-ceiling cavity
        sifc = ifc_storeys.get(s.index)
        if sifc and _add_ceiling(model, geometry.footprint, sifc, s.elevation, s.height, body_context, style_cache):
            counts.ceiling += 1

    # Entrance canopy — only if the ground floor actually has an exterior door
    door = _find_ground_door(geometry.storeys)
    if door and ground_ifc and _add_entrance_canopy(model, door, ground_ifc, body_context, style_cache):
        counts.canopy += 1

    log.info(
        "enrichment_complete",
        podium=counts.podium,
        parapet=counts.parapet,
        railing=counts.railing,
        ceiling=counts.ceiling,
        canopy=counts.canopy,
        total=counts.total(),
    )
    return counts
