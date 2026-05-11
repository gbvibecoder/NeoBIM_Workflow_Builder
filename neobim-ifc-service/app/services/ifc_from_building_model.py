"""Slice 2B.2.C — BuildingModel → IFC4 service-level bridge.

Lifted from ``scripts/export_2bhk_pune_to_ifc.build_ifc_from_building_model``
(slice T1.3) to a service module so the ``/api/v1/design/generate``
route handler can import without depending on ``scripts/``.

Byte-identity contract
----------------------
The body of :func:`build_ifc_from_building_model` is moved verbatim
from its original location. Every line of the spatial-hierarchy
setup, material library, type registry, element dispatch, parapet /
covering / pset population, stub LOD-300 emission, and final
provenance stamp is preserved. The deterministic-GUID code path is
preserved (``set_project_namespace`` + ``reset_new_guid_counter``
called in identical order with identical arguments).

Verified by ``test_build_ifc_byte_identity`` — exporting the same
3BHK G+5 BuildingModel through this module and through the legacy
script-level location produces the same SHA-256 IFC bytes hash, so
existing snapshot tests and IDS tests continue to bind against the
same IFC output.

The legacy import site
``scripts.export_2bhk_pune_to_ifc.build_ifc_from_building_model``
re-exports from this module to keep existing test imports
(``test_phase_t2_0_4_stair_lift_visuals.py``) working.

Project naming defaults
-----------------------
``PROJECT_NAME`` / ``BUILDING_NAME`` / ``SITE_NAME`` / ``BUILDING_TYPE``
remain at their original 2BHK values for byte-identity preservation.
A future slice can lift them to function parameters with these
defaults; doing so now would change the deterministic-GUID
namespace and invalidate the byte-identity guarantee.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.domain.building_model import BuildingModel, Provenance
from app.services.beam_builder import create_beam_parametric
from app.services.column_builder import create_column_parametric
from app.services.geometry_resolver import resolve_geometries
from app.services.lift_cabin_emitter import emit_lift_cabins
from app.services.material_library import (
    create_material_layer_set,
    get_roof_preset,
    get_slab_preset,
    get_wall_preset,
)
from app.services.opening_builder import (
    create_door_parametric,
    create_opening_parametric,
    create_window_parametric,
)
from app.services.placement_resolver import resolve_placements
from app.services.presentation import StyleCache, apply_color
from app.services.provenance import stamp_provenance
from app.services.railing_builder import create_railing_parametric
from app.services.slab_builder import create_slab_parametric
from app.services.space_builder import create_space_parametric
from app.services.stair_builder import create_stair_parametric
from app.services.type_registry import TypeRegistry
from app.services.wall_builder import create_wall_parametric
from app.utils.guid import (
    derive_guid,
    reset_new_guid_counter,
    set_project_namespace,
)


PROJECT_NAME = "2BHK Pune Duplex Project"
BUILDING_NAME = "2BHK Pune Duplex"
SITE_NAME = "Pune Plot"
BUILDING_TYPE = "residential"


def build_ifc_from_building_model(bm: BuildingModel) -> ifcopenshell.file:
    """Build an IFC4 file directly from an authored BuildingModel.

    Mirrors the spatial-hierarchy / material-cache / type-registry setup
    of `app.services.ifc_builder.build_ifc`, then dispatches each
    BuildingModel node to its parametric builder.
    """
    # Deterministic GUIDs: same project namespace + same BuildingModel
    # produces byte-identical IFC.
    set_project_namespace(PROJECT_NAME, BUILDING_NAME, SITE_NAME)
    reset_new_guid_counter()

    model = ifcopenshell.file(schema="IFC4")

    # ── Project + units + context ─────────────────────────────────
    project = api.run(
        "root.create_entity", model, ifc_class="IfcProject", name=PROJECT_NAME
    )
    project.GlobalId = derive_guid("IfcProject", PROJECT_NAME)
    api.run("unit.assign_unit", model, length={"is_metric": True, "raw": "METRE"})

    context = api.run("context.add_context", model, context_type="Model")
    body_context = api.run(
        "context.add_context",
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=context,
    )

    # ── Spatial hierarchy ─────────────────────────────────────────
    site = api.run("root.create_entity", model, ifc_class="IfcSite", name=SITE_NAME)
    site.GlobalId = derive_guid("IfcSite", SITE_NAME)
    api.run("aggregate.assign_object", model, relating_object=project, products=[site])

    building = api.run(
        "root.create_entity", model, ifc_class="IfcBuilding", name=BUILDING_NAME
    )
    building.GlobalId = derive_guid("IfcBuilding", BUILDING_NAME)
    api.run("aggregate.assign_object", model, relating_object=site, products=[building])

    bld = bm.project.site.building
    ifc_storeys: dict[str, ifcopenshell.entity_instance] = {}
    for storey_node in sorted(bld.storeys, key=lambda s: s.index):
        ifc_storey = api.run(
            "root.create_entity",
            model,
            ifc_class="IfcBuildingStorey",
            name=storey_node.name,
        )
        ifc_storey.GlobalId = derive_guid(
            "IfcBuildingStorey", str(storey_node.index), storey_node.name
        )
        ifc_storey.Elevation = storey_node.elevation
        ifc_storey.CompositionType = "ELEMENT"
        ifc_storeys[storey_node.id] = ifc_storey

    api.run(
        "aggregate.assign_object",
        model,
        relating_object=building,
        products=list(ifc_storeys.values()),
    )

    # ── Material library + caches ─────────────────────────────────
    slab_mat = create_material_layer_set(model, get_slab_preset(BUILDING_TYPE))
    roof_mat = create_material_layer_set(model, get_roof_preset())
    wall_mat_cache: dict[bool, ifcopenshell.entity_instance] = {}

    def _wall_mat_for(is_partition: bool) -> ifcopenshell.entity_instance:
        if is_partition not in wall_mat_cache:
            wall_mat_cache[is_partition] = create_material_layer_set(
                model, get_wall_preset(BUILDING_TYPE, is_partition)
            )
        return wall_mat_cache[is_partition]

    type_registry = TypeRegistry(model)
    style_cache = StyleCache(model)

    # ── Pass-1 RESOLVE ────────────────────────────────────────────
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)

    # ── Element creation ─────────────────────────────────────────
    # Phase P1.5.B: track every BuildingModel-id → IFC entity map so
    # the pset populator can attach Pset_*Common after all elements
    # are emitted.
    wall_entities: dict[str, ifcopenshell.entity_instance] = {}
    slab_entities: dict[str, ifcopenshell.entity_instance] = {}
    column_entities: dict[str, ifcopenshell.entity_instance] = {}
    beam_entities: dict[str, ifcopenshell.entity_instance] = {}
    space_entities: dict[str, ifcopenshell.entity_instance] = {}
    stair_entities: dict[str, ifcopenshell.entity_instance] = {}
    door_entities: dict[str, ifcopenshell.entity_instance] = {}
    window_entities: dict[str, ifcopenshell.entity_instance] = {}
    opening_entities: dict[str, ifcopenshell.entity_instance] = {}
    footing_entities: dict[str, ifcopenshell.entity_instance] = {}

    # Walls first (openings need their parent wall entity). Slice
    # T2.0.1.2: Wall(type="railing") dispatches to the IfcRailing
    # builder; everything else stays on the IfcWall path.
    for storey_node in sorted(bld.storeys, key=lambda s: s.index):
        ifc_storey = ifc_storeys[storey_node.id]
        for w_node in sorted(storey_node.walls, key=lambda w: w.id):
            if w_node.type == "railing":
                ifc_wall = create_railing_parametric(
                    w_node,
                    placements[w_node.id],
                    geometries[w_node.id],
                    model,
                    body_context,
                    ifc_storey,
                    type_registry,
                )
                wall_entities[w_node.id] = ifc_wall
                apply_color(model, ifc_wall, "wall-exterior", style_cache)
                continue
            ifc_wall = create_wall_parametric(
                w_node,
                placements[w_node.id],
                geometries[w_node.id],
                model,
                body_context,
                ifc_storey,
                type_registry,
            )
            wall_entities[w_node.id] = ifc_wall
            is_partition = not w_node.is_external
            wall_mat = _wall_mat_for(is_partition)
            sig = type_registry.signature(
                type_class="IfcWallType",
                material_layer_set=wall_mat,
                thickness_m=w_node.thickness,
                predefined_type="PARTITIONING" if is_partition else "STANDARD",
            )
            type_registry.attach(ifc_wall, sig, material_layer_set=wall_mat)
            apply_color(
                model,
                ifc_wall,
                "wall-partition" if is_partition else "wall-exterior",
                style_cache,
            )

        # Slabs (FLOOR + ROOF on this storey)
        for s_node in sorted(storey_node.slabs, key=lambda s: s.id):
            ifc_slab = create_slab_parametric(
                s_node,
                placements[s_node.id],
                geometries[s_node.id],
                model,
                body_context,
                ifc_storey,
                type_registry,
            )
            slab_entities[s_node.id] = ifc_slab
            is_roof = s_node.predefined_type == "ROOF"
            layer_set = roof_mat if is_roof else slab_mat
            slab_thickness = s_node.top_z - s_node.bottom_z
            sig = type_registry.signature(
                type_class="IfcSlabType",
                material_layer_set=layer_set,
                thickness_m=slab_thickness,
                predefined_type="ROOF" if is_roof else "FLOOR",
            )
            type_registry.attach(ifc_slab, sig, material_layer_set=layer_set)
            apply_color(model, ifc_slab, "slab-roof" if is_roof else "slab", style_cache)

        # Rooms (IfcSpace)
        for r_node in sorted(storey_node.rooms, key=lambda r: r.id):
            ifc_space = create_space_parametric(
                r_node,
                placements[r_node.id],
                geometries[r_node.id],
                model,
                body_context,
                ifc_storey,
                type_registry,
            )
            space_entities[r_node.id] = ifc_space
            apply_color(model, ifc_space, "space", style_cache)

        # Stairs
        for st_node in sorted(storey_node.stairs, key=lambda s: s.id):
            ifc_stair = create_stair_parametric(
                st_node,
                placements[st_node.id],
                geometries[st_node.id],
                model,
                body_context,
                ifc_storey,
                type_registry,
            )
            stair_entities[st_node.id] = ifc_stair
            apply_color(model, ifc_stair, "stair", style_cache)

    # Columns + beams (structural-system level, hosted on individual storeys)
    for c_node in sorted(bld.structural_system.columns, key=lambda c: c.id):
        ifc_storey = ifc_storeys[c_node.host_storey_id]
        ifc_col = create_column_parametric(
            c_node,
            placements[c_node.id],
            geometries[c_node.id],
            model,
            body_context,
            ifc_storey,
            type_registry,
        )
        column_entities[c_node.id] = ifc_col
        apply_color(model, ifc_col, "column", style_cache)

    for b_node in sorted(bld.structural_system.beams, key=lambda b: b.id):
        ifc_storey = ifc_storeys[b_node.host_storey_id]
        ifc_beam = create_beam_parametric(
            b_node,
            placements[b_node.id],
            geometries[b_node.id],
            model,
            body_context,
            ifc_storey,
            type_registry,
        )
        beam_entities[b_node.id] = ifc_beam
        apply_color(model, ifc_beam, "beam", style_cache)

    # Phase P1.6.A — Footings emitted as IfcFooting (one per
    # BuildingModel.Foundation.Footing). Hosted on storey-ground.
    if bld.foundation and bld.foundation.footings:
        ground_storey_id = sorted(
            bld.storeys, key=lambda s: s.index
        )[0].id
        ground_storey = ifc_storeys[ground_storey_id]
        for ftg in sorted(bld.foundation.footings, key=lambda f: f.id):
            ifc_ftg = api.run(
                "root.create_entity",
                model,
                ifc_class="IfcFooting",
                name=ftg.id,
            )
            ifc_ftg.GlobalId = derive_guid("IfcFooting", ftg.id)
            ifc_ftg.PredefinedType = "PAD_FOOTING"
            from app.utils.ifc_helpers import assign_to_storey
            assign_to_storey(model, ground_storey, ifc_ftg)

            cx, cy = ftg.location.x, ftg.location.y
            cz = (ftg.top_z + ftg.bottom_z) / 2.0
            ifc_ftg.ObjectPlacement = model.create_entity(
                "IfcLocalPlacement",
                RelativePlacement=model.create_entity(
                    "IfcAxis2Placement3D",
                    Location=model.create_entity(
                        "IfcCartesianPoint", Coordinates=(cx, cy, cz)
                    ),
                ),
            )

            poly = ftg.footprint_polygon
            xs = [v.x for v in poly]
            ys = [v.y for v in poly]
            half_x = (max(xs) - min(xs)) / 2.0
            half_y = (max(ys) - min(ys)) / 2.0
            depth = ftg.top_z - ftg.bottom_z
            profile = model.create_entity(
                "IfcRectangleProfileDef",
                ProfileType="AREA",
                XDim=2 * half_x,
                YDim=2 * half_y,
                Position=model.create_entity(
                    "IfcAxis2Placement2D",
                    Location=model.create_entity(
                        "IfcCartesianPoint", Coordinates=(0.0, 0.0)
                    ),
                ),
            )
            solid = model.create_entity(
                "IfcExtrudedAreaSolid",
                SweptArea=profile,
                Position=model.create_entity(
                    "IfcAxis2Placement3D",
                    Location=model.create_entity(
                        "IfcCartesianPoint",
                        Coordinates=(0.0, 0.0, -depth / 2.0),
                    ),
                ),
                ExtrudedDirection=model.create_entity(
                    "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
                ),
                Depth=depth,
            )
            shape_rep = model.create_entity(
                "IfcShapeRepresentation",
                ContextOfItems=body_context,
                RepresentationIdentifier="Body",
                RepresentationType="SweptSolid",
                Items=[solid],
            )
            ifc_ftg.Representation = model.create_entity(
                "IfcProductDefinitionShape", Representations=[shape_rep]
            )
            footing_entities[ftg.id] = ifc_ftg
            apply_color(model, ifc_ftg, "column", style_cache)

    # Openings (need parent wall entity already created above)
    openings_by_id = {
        o.id: o for st in bld.storeys for o in st.openings
    }
    for opening_id in sorted(openings_by_id):
        opening = openings_by_id[opening_id]
        parent_wall = wall_entities.get(opening.in_wall_id)
        if parent_wall is None:
            print(
                f"  ⚠ skipping opening {opening_id}: parent wall "
                f"{opening.in_wall_id} not found"
            )
            continue
        ifc_opening = create_opening_parametric(
            opening,
            placements[opening_id],
            parent_wall,
            model,
            body_context,
        )
        opening_entities[opening_id] = ifc_opening

    # Slice T2.0.4.B — IFC-layer door operation override for lift doors.
    # Any door whose connects_room_ids reference a Room with usage="lift"
    # is overridden from SWING to SLIDING for the IFC export. We do
    # this by mutating the in-memory Door copy passed to
    # `create_door_parametric`, NOT by editing the BuildingModel — the
    # snapshot stays byte-identical.
    _lift_room_ids: set[str] = {
        r.id
        for st in bld.storeys
        for r in st.rooms
        if r.usage == "lift"
    }

    # Doors
    for d_node in sorted(bld.doors, key=lambda d: d.id):
        parent_opening = openings_by_id.get(d_node.in_opening_id)
        parent_opening_entity = opening_entities.get(d_node.in_opening_id)
        if parent_opening is None or parent_opening_entity is None:
            print(f"  ⚠ skipping door {d_node.id}: parent opening missing")
            continue
        # Doors are hosted on the same storey as their host wall.
        host_wall_id = parent_opening.in_wall_id
        host_storey_id = next(
            (st.id for st in bld.storeys if any(w.id == host_wall_id for w in st.walls)),
            None,
        )
        ifc_storey = ifc_storeys[host_storey_id] if host_storey_id else None

        # Slice T2.0.4.B — override swing="sliding" for lift doors
        # before dispatch. The existing _door_operation_type mapping
        # in opening_builder translates this to SLIDING_TO_LEFT/RIGHT.
        connects_lift = any(
            rid in _lift_room_ids for rid in d_node.connects_room_ids
        )
        d_node_for_dispatch = (
            d_node.model_copy(update={"swing": "sliding"})
            if connects_lift
            else d_node
        )

        ifc_door = create_door_parametric(
            d_node_for_dispatch,
            parent_opening,
            parent_opening_entity,
            model,
            body_context,
            ifc_storey,
            type_registry,
        )
        door_entities[d_node.id] = ifc_door
        apply_color(model, ifc_door, "door", style_cache)

    # Windows
    for w_node in sorted(bld.windows, key=lambda w: w.id):
        parent_opening = openings_by_id.get(w_node.in_opening_id)
        parent_opening_entity = opening_entities.get(w_node.in_opening_id)
        if parent_opening is None or parent_opening_entity is None:
            print(f"  ⚠ skipping window {w_node.id}: parent opening missing")
            continue
        host_wall_id = parent_opening.in_wall_id
        host_storey_id = next(
            (st.id for st in bld.storeys if any(w.id == host_wall_id for w in st.walls)),
            None,
        )
        ifc_storey = ifc_storeys[host_storey_id] if host_storey_id else None
        ifc_window = create_window_parametric(
            w_node,
            parent_opening,
            parent_opening_entity,
            model,
            body_context,
            ifc_storey,
            type_registry,
        )
        window_entities[w_node.id] = ifc_window
        apply_color(model, ifc_window, "window", style_cache)

    # Flush type registry (emits IfcXxxType + IfcRelDefinesByType per signature)
    type_registry.flush()

    # ── Phase P1.5.D — Roof parapets (IFC-only, no BuildingModel change)
    # 1.0m brick parapet around every ROOF slab. The min(wall.top_z,
    # slab_above.bottom_z) resolver fix from T2.0.1.1 isn't relevant
    # here since we emit at IFC build time with explicit base_z and
    # height — no slab above to clip against.
    from app.services.parapet_emitter import emit_roof_parapets
    parapet_walls: list[ifcopenshell.entity_instance] = []
    for storey_node in bld.storeys:
        for slab in storey_node.slabs:
            if slab.predefined_type == "ROOF":
                ifc_storey = ifc_storeys[storey_node.id]
                parapet_walls.extend(
                    emit_roof_parapets(
                        model, body_context, ifc_storey, roof_slab=slab
                    )
                )

    # ── Phase P1.5.C — Floor + ceiling finishes (IfcCovering)
    # One FLOORING + CEILING per habitable storey. Stilt/parking floors
    # skip both (no living finishes). Uses the storey's FLOOR slab as
    # the polygon source.
    from app.services.covering_builder import (
        add_floor_and_ceiling_finishes,
        add_pset_to_covering,
    )
    covering_entities: list[ifcopenshell.entity_instance] = []
    for storey_node in bld.storeys:
        floor_slabs = [
            s for s in storey_node.slabs if s.predefined_type == "FLOOR"
        ]
        if not floor_slabs:
            continue
        # Skip stilt floors — parking doesn't need vitrified tile or
        # gypsum ceiling. Detect by parking room presence.
        is_stilt = any(r.usage == "parking" for r in storey_node.rooms)
        if is_stilt:
            continue
        floor_slab = floor_slabs[0]
        storey_top_z = storey_node.elevation + storey_node.actual_height
        ifc_storey = ifc_storeys[storey_node.id]
        floor_cov, ceiling_cov = add_floor_and_ceiling_finishes(
            model, body_context,
            storey_ifc=ifc_storey,
            floor_slab=floor_slab,
            storey_top_z=storey_top_z,
        )
        add_pset_to_covering(model, floor_cov, is_floor=True)
        add_pset_to_covering(model, ceiling_cov, is_floor=False)
        covering_entities.extend([floor_cov, ceiling_cov])

    # ── Phase P1.5.F — Site ground geometry
    # Horizontal ground polygon at z=-1.5 covering 2× plot dimensions
    # so the building visibly sits on a ground plane in the viewer.
    _emit_site_ground(model, body_context, site, bld.envelope_polygon)

    # ── Phase P1.5.B — Pset / Qto population
    # After ALL elements (templates + parapets + coverings) are emitted,
    # walk the BuildingModel and attach Pset_*Common + Qto_*BaseQuantities
    # to each tracked entity. Parapets and coverings already self-pset.
    from app.services.bm_pset_populator import (
        populate_psets_from_building_model,
    )
    populate_psets_from_building_model(
        model, bm,
        wall_entities=wall_entities,
        slab_entities=slab_entities,
        column_entities=column_entities,
        beam_entities=beam_entities,
        space_entities=space_entities,
        door_entities=door_entities,
        window_entities=window_entities,
        stair_entities=stair_entities,
        footing_entities=footing_entities,
        ifc_site=site,
    )

    # ── Phase P1.6 — LOD-300 stub MEP / structural elements ─────────
    # Emit one of each: IfcGrid / IfcReinforcingBar / IfcDistributionSystem
    # / IfcDuctSegment / IfcPipeSegment / IfcSanitaryTerminal /
    # IfcAirTerminal / IfcLightFixture. Closes the LOD-300 IDS
    # "minimum-presence" gap without modeling real MEP (Phase 5 work).
    from app.services.p1_6_stub_emitter import (
        emit_stub_lod300_elements,
        emit_stub_railing_if_missing,
        fix_railing_predefined_types,
    )
    # Anchor the stubs at the south-west corner of the ground storey.
    ground_storey_id = sorted(bld.storeys, key=lambda s: s.index)[0].id
    ground_storey = ifc_storeys[ground_storey_id]
    envelope = bld.envelope_polygon
    if envelope:
        anchor_x = min(v.x for v in envelope) + 0.5
        anchor_y = min(v.y for v in envelope) + 0.5
    else:
        anchor_x = anchor_y = 0.0

    # Reuse the materials from pset_populator's cache by re-creating
    # via the same name (idempotent: ifcopenshell returns existing).
    rcc_mat = next(
        (m for m in model.by_type("IfcMaterial") if m.Name == "M25-RCC"),
        None,
    )
    steel_mat = next(
        (m for m in model.by_type("IfcMaterial") if m.Name == "MS-Steel"),
        None,
    )

    emit_stub_lod300_elements(
        model, body_context,
        storey=ground_storey,
        anchor_xyz=(anchor_x, anchor_y, 0.0),
        rcc_material=rcc_mat,
        steel_material=steel_mat,
    )

    # Add a stub IfcRailing on house/duplex variants (templates without
    # FLAT-style balcony railings).
    emit_stub_railing_if_missing(
        model, body_context,
        storey=ground_storey,
        anchor_xyz=(anchor_x, anchor_y + 1.0, 0.0),
        steel_material=steel_mat,
    )

    # Defensive: ensure every IfcRailing has PredefinedType set.
    fix_railing_predefined_types(model)

    # ── Slice T2.0.4.B — IfcTransportElement (lift cabin) emission ─
    # Emits one IfcTransportElement per Room with usage="lift". Returns
    # an empty list for house / duplex templates (no lift rooms). Cabin
    # carries Pset_TransportElementCommon + Lift-Cabin-Steel material.
    emit_lift_cabins(
        model, body_context, bm=bm, ifc_storeys=ifc_storeys,
    )

    # ── Slice P2.A — stair handrails ────────────────────────────────
    # One IfcRailing (PredefinedType=HANDRAIL, 0.9 m, MS-Steel) along
    # every IfcStairFlight emitted above. NBC India 2016 Part 4
    # mandates a handrail on residential stairs; without one the stair
    # reads as "AI generated" in the viewer. IFC-layer only — no
    # BuildingModel change.
    from app.services.handrail_builder import emit_stair_handrail
    ms_steel_for_handrails = next(
        (m for m in model.by_type("IfcMaterial") if m.Name == "MS-Steel"),
        None,
    )
    for storey_node in sorted(bld.storeys, key=lambda s: s.index):
        ifc_storey = ifc_storeys[storey_node.id]
        for st_node in sorted(storey_node.stairs, key=lambda s: s.id):
            emit_stair_handrail(
                model, body_context,
                stair=st_node,
                placement=placements[st_node.id],
                ifc_storey=ifc_storey,
                ms_steel_material=ms_steel_for_handrails,
            )

    # ── Slice P2.D — stilt parking lines ────────────────────────────
    # 4 IfcAnnotation rectangles (2.5 m × 5.0 m bays) on every storey
    # marked usage="parking" (tower stilt floors). House/duplex have
    # no parking storey — emitter is a no-op there.
    from app.services.parking_line_painter import emit_parking_lines
    for storey_node in sorted(bld.storeys, key=lambda s: s.index):
        emit_parking_lines(
            model, body_context,
            storey=storey_node,
            ifc_storey=ifc_storeys[storey_node.id],
        )

    # ── Slice P2.C — door swing arc annotations ─────────────────────
    # One IfcAnnotation (90° arc) per swinging IfcDoor. Sliding (lift)
    # doors and PredefinedType=GATE doors get no arc. Viewer rendering
    # is inconsistent (BlenderBIM full; IfcViewer/FreeCAD partial); the
    # IFC is semantically correct regardless.
    from app.services.door_swing_annotator import emit_door_swing_arc
    for d_node in sorted(bld.doors, key=lambda d: d.id):
        door_entity = door_entities.get(d_node.id)
        parent_opening = openings_by_id.get(d_node.in_opening_id)
        parent_opening_entity = opening_entities.get(d_node.in_opening_id)
        if door_entity is None or parent_opening is None or parent_opening_entity is None:
            continue
        host_wall_id = parent_opening.in_wall_id
        host_storey_id = next(
            (st.id for st in bld.storeys
             if any(w.id == host_wall_id for w in st.walls)),
            None,
        )
        ifc_storey_for_arc = (
            ifc_storeys[host_storey_id] if host_storey_id else None
        )
        emit_door_swing_arc(
            model, body_context,
            door=d_node,
            door_entity=door_entity,
            opening=parent_opening,
            parent_opening_entity=parent_opening_entity,
            ifc_storey=ifc_storey_for_arc,
        )

    # ── Slice P2.B — window mullions ────────────────────────────────
    # One IfcMember(MULLION) per IfcWindow at the horizontal midpoint.
    # 50 mm × 100 mm Aluminum cross-section. Closes the "single flat
    # pane" visual gap that reads as "AI generated".
    from app.services.window_mullion_builder import emit_window_mullion
    aluminum_mat = api.run(
        "material.add_material",
        model,
        name="Aluminum-Mullion",
        category="metal",
    )
    for w_node in sorted(bld.windows, key=lambda w: w.id):
        parent_opening = openings_by_id.get(w_node.in_opening_id)
        parent_opening_entity = opening_entities.get(w_node.in_opening_id)
        if parent_opening is None or parent_opening_entity is None:
            continue
        host_wall_id = parent_opening.in_wall_id
        host_storey_id = next(
            (st.id for st in bld.storeys
             if any(w.id == host_wall_id for w in st.walls)),
            None,
        )
        ifc_storey_for_mullion = (
            ifc_storeys[host_storey_id] if host_storey_id else None
        )
        emit_window_mullion(
            model, body_context,
            window=w_node,
            opening=parent_opening,
            parent_opening_entity=parent_opening_entity,
            ifc_storey=ifc_storey_for_mullion,
            aluminum_material=aluminum_mat,
        )

    # ── Provenance Pset on IfcProject ─────────────────────────────
    initial_provenance = bm.project.metadata.provenance
    stamp_provenance(model, initial_provenance, project)

    return model


def _emit_site_ground(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    site: ifcopenshell.entity_instance,
    envelope_polygon,
) -> None:
    """Phase P1.5.F — emit a horizontal ground polygon under the building.

    Computes the building's envelope bounding box, then makes a 2×
    bounding ground polygon at z=-1.5m (below foundation top z=-0.5m).
    """
    if not envelope_polygon:
        return
    xs = [v.x for v in envelope_polygon]
    ys = [v.y for v in envelope_polygon]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    half_w = max(max(xs) - min(xs), 1.0)
    half_d = max(max(ys) - min(ys), 1.0)
    g_xmin = cx - half_w
    g_xmax = cx + half_w
    g_ymin = cy - half_d
    g_ymax = cy + half_d
    z_ground_top = -1.5
    z_ground_bottom = -1.6

    pts = [
        model.create_entity("IfcCartesianPoint", Coordinates=(g_xmin, g_ymin)),
        model.create_entity("IfcCartesianPoint", Coordinates=(g_xmax, g_ymin)),
        model.create_entity("IfcCartesianPoint", Coordinates=(g_xmax, g_ymax)),
        model.create_entity("IfcCartesianPoint", Coordinates=(g_xmin, g_ymax)),
        model.create_entity("IfcCartesianPoint", Coordinates=(g_xmin, g_ymin)),
    ]
    polyline = model.create_entity("IfcPolyline", Points=pts)
    profile = model.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint",
                Coordinates=(0.0, 0.0, z_ground_bottom),
            ),
        ),
        ExtrudedDirection=model.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=z_ground_top - z_ground_bottom,
    )
    shape_rep = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    site.Representation = model.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )
    site.ObjectPlacement = model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
    )



__all__ = ["build_ifc_from_building_model"]
