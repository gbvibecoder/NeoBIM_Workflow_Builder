"""Core IFC builder — orchestrates spatial hierarchy and element creation.

This is the main entry point for IFC generation. It:
1. Creates the IFC4 file with project/site/building/storeys
2. Iterates geometry elements and dispatches to type-specific builders
3. Assigns materials and property sets
4. Handles discipline filtering for multi-file export
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

import ifcopenshell
import ifcopenshell.api as api
import structlog

from app.models.request import (
    ExportIFCRequest,
    Discipline,
    GeometryElement,
    MassingGeometry,
    MassingStorey,
)
from app.models.response import BuildFailure, EntityCounts
from app.services.wall_builder import create_wall, create_wall_parametric
from app.services.slab_builder import create_slab, create_slab_parametric
from app.services.column_builder import create_column, create_column_parametric
from app.services.opening_builder import (
    create_door,
    create_door_parametric,
    create_opening_parametric,
    create_window,
    create_window_parametric,
)
from app.services.space_builder import create_space, create_space_parametric
from app.services.beam_builder import create_beam, create_beam_parametric
from app.services.stair_builder import create_stair, create_stair_parametric
from app.services.mep_builder import (
    create_cable_tray,
    create_duct,
    create_equipment,
    create_mep_equipment_parametric,
    create_mep_segment_parametric,
    create_mep_system,
    create_mep_terminal_parametric,
    create_pipe,
)
from app.services.material_library import (
    create_material_layer_set,
    assign_material_to_element,
    get_wall_preset,
    get_slab_preset,
    get_roof_preset,
)
from app.services.property_sets import (
    add_wall_psets,
    add_slab_psets,
    add_column_psets,
    add_window_psets,
    add_door_psets,
    add_space_psets,
    add_beam_psets,
)
from app.services.presentation import StyleCache, apply_color
from app.services.enrichment import enrich_building
from app.services.classification import attach_omniclass, attach_nbc_india
from app.services.rera_pset import ReraInputs, attach_rera_psets
from app.services.type_registry import TypeRegistry
from app.utils.guid import (
    new_guid,
    derive_guid,
    set_project_namespace,
    reset_new_guid_counter,
)

log = structlog.get_logger()

# Discipline filter sets (which element types belong to which discipline)
DISCIPLINE_TYPES: dict[str, set[str]] = {
    "architectural": {"wall", "window", "door", "space", "balcony", "canopy", "parapet"},
    "structural": {"column", "beam", "slab", "roof", "stair"},
    "mep": {"duct", "pipe", "cable-tray", "equipment"},
}


def _element_in_discipline(elem: GeometryElement, discipline: str) -> bool:
    """Check if an element belongs to a discipline."""
    if discipline == "combined":
        return True
    # Element-level override
    if elem.properties.discipline:
        return elem.properties.discipline == discipline
    return elem.type in DISCIPLINE_TYPES.get(discipline, set())


# ── Rich-mode dispatch tables ────────────────────────────────────────
#
# Mirrors the TypeScript-side resolver in src/features/ifc/lib/rich-mode.ts.
# Two orthogonal gates apply on every build:
#
#   1. Element-type allowlist — `_RICH_MODE_ELEMENT_TYPES` decides which
#      `GeometryElement.type` literals pass through. `None` means "no
#      filtering, all types allowed"; an empty frozenset means "no
#      elements at all" (spatial structure only). Applied alongside (and
#      independent of) the per-discipline filter below.
#
#   2. MEP body geometry — `_MEP_GEOMETRY_BY_MODE` decides whether MEP
#      elements get an IfcExtrudedAreaSolid body or stay bodyless (Pset +
#      IfcSystem grouping only). Bodyless is the safe default because the
#      pre-Phase-3 placement primitives produce "flying debris" on
#      non-rectangular footprints (see frozen TS exporter §2.1).
#
# Backward compat: rich_mode=None (no field on the wire) bypasses BOTH
# gates and emits the full element set with bodyful MEP. This preserves
# pre-Phase-1-audit behaviour for payloads that pre-date the typed field
# (notably tests/fixtures/baseline_building.json). An explicit "off"
# value is the new "minimal" mode and honoured strictly.

# Architectural + structural element types (no MEP, no rebar).
# `arch-only` and `structural` are equal here because the rebar emitter
# does not yet exist in Python — Phase 3 lifts structural above arch-only.
_ARCH_AND_STRUCT_TYPES: frozenset[str] = frozenset({
    "wall", "slab", "column", "roof", "space", "window", "door",
    "beam", "stair", "balcony", "canopy", "parapet",
})

_RICH_MODE_ELEMENT_TYPES: dict[str, frozenset[str] | None] = {
    "off": frozenset(),         # spatial structure only — no elements
    "arch-only": _ARCH_AND_STRUCT_TYPES,
    "structural": _ARCH_AND_STRUCT_TYPES,  # rebar emitter not yet implemented (Phase 3)
    "mep": None,                # all element types allowed
    "full": None,               # all element types allowed
}

_MEP_GEOMETRY_BY_MODE: dict[str, bool] = {
    "off": False,
    "arch-only": False,
    "mep": False,               # bodyless MEP — Pset + system grouping only
    "structural": False,
    "full": True,               # full = mep + bodyful MEP geometry
}


def _emit_mep_geometry(rich_mode: str | None) -> bool:
    if rich_mode is None:
        return True  # backward compat — pre-rich-mode callers got bodies
    return _MEP_GEOMETRY_BY_MODE.get(rich_mode, False)


def _element_passes_rich_mode(elem: GeometryElement, rich_mode: str | None) -> bool:
    """Rich-mode element-type gate.

    Returns True if `elem.type` is allowed under the current rich mode.
    None (no field on the wire) is backward-compat — no gating.
    """
    if rich_mode is None:
        return True
    allowed = _RICH_MODE_ELEMENT_TYPES.get(rich_mode)
    if allowed is None:
        return True  # mep, full
    return elem.type in allowed


# ── Main build function ──────────────────────────────────────────────


def build_ifc(
    geometry: MassingGeometry,
    project_name: str = "NeoBIM Project",
    building_name: str = "Building",
    site_name: str = "Default Site",
    author: str = "NeoBIM",
    discipline: Discipline = "combined",
    emit_mep_geometry: bool = False,
    rich_mode: str | None = None,
    rera_inputs: ReraInputs | None = None,
    use_parametric_pipeline: bool = False,
) -> tuple[ifcopenshell.file, EntityCounts, list[BuildFailure]]:
    """Build a complete IFC4 model from MassingGeometry.

    Returns (ifc_file, entity_counts, per_element_failures). Per-element
    failures do not abort the build — unrecoverable failures raise instead.
    """
    start = time.monotonic()

    # Phase 2 (Fix 5) — seed deterministic GUIDs for this build. Discipline
    # is intentionally NOT in the namespace: a single wall must keep the
    # same GlobalId across architectural.ifc and combined.ifc so external
    # change-tracking can correlate them. Same fixture + same richMode +
    # same options → same GUIDs across re-runs.
    set_project_namespace(project_name, building_name, site_name)
    reset_new_guid_counter()

    model = ifcopenshell.file(schema="IFC4")

    # ── Project + context ────────────────────────────────────────
    project = api.run("root.create_entity", model, ifc_class="IfcProject", name=project_name)
    project.GlobalId = derive_guid("IfcProject", project_name)

    # Units (SI: metres)
    api.run("unit.assign_unit", model, length={"is_metric": True, "raw": "METRE"})

    # Geometric representation context
    context = api.run("context.add_context", model, context_type="Model")
    body_context = api.run(
        "context.add_context",
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=context,
    )

    # ── Spatial hierarchy ────────────────────────────────────────
    site = api.run("root.create_entity", model, ifc_class="IfcSite", name=site_name)
    site.GlobalId = derive_guid("IfcSite", site_name)
    api.run("aggregate.assign_object", model, relating_object=project, products=[site])

    building = api.run("root.create_entity", model, ifc_class="IfcBuilding", name=building_name)
    building.GlobalId = derive_guid("IfcBuilding", building_name)
    api.run("aggregate.assign_object", model, relating_object=site, products=[building])

    # Create storeys
    ifc_storeys: dict[int, ifcopenshell.entity_instance] = {}
    for storey_data in geometry.storeys:
        ifc_storey = api.run(
            "root.create_entity",
            model,
            ifc_class="IfcBuildingStorey",
            name=storey_data.name,
        )
        ifc_storey.GlobalId = derive_guid("IfcBuildingStorey", str(storey_data.index), storey_data.name)
        ifc_storey.Elevation = storey_data.elevation
        ifc_storeys[storey_data.index] = ifc_storey

    if ifc_storeys:
        api.run(
            "aggregate.assign_object",
            model,
            relating_object=building,
            products=list(ifc_storeys.values()),
        )

    # ── Material presets (cached per building) ───────────────────
    building_type = geometry.building_type
    wall_mat_cache: dict[bool, ifcopenshell.entity_instance] = {}
    slab_mat = create_material_layer_set(model, get_slab_preset(building_type))
    roof_mat = create_material_layer_set(model, get_roof_preset())

    def _get_wall_mat(is_partition: bool) -> ifcopenshell.entity_instance:
        if is_partition not in wall_mat_cache:
            wall_mat_cache[is_partition] = create_material_layer_set(
                model, get_wall_preset(building_type, is_partition)
            )
        return wall_mat_cache[is_partition]

    # ── Phase 1 Slice 5 — full parametric pre-resolution ─────────
    # When the feature flag is on, lift the legacy MassingGeometry into
    # a BuildingModel once, then resolve placements + geometries for the
    # whole graph. Per-type dispatch maps are populated below; the
    # element-creation loop later picks the parametric builder whenever
    # a matching node exists in the lifted graph, falling back to the
    # legacy builder when the lift skipped a node (lift warnings will
    # have been emitted in that case).
    parametric_walls: dict[str, tuple[object, object, object]] = {}
    parametric_slabs: dict[str, tuple[object, object, object]] = {}
    parametric_columns: dict[str, tuple[object, object, object]] = {}
    parametric_beams: dict[str, tuple[object, object, object]] = {}
    parametric_rooms: dict[str, tuple[object, object, object]] = {}
    parametric_stairs: dict[str, tuple[object, object, object]] = {}
    # Door/Window dispatch carries the parent opening tuple so the
    # orchestrator can create the opening + filler together in one branch.
    parametric_doors: dict[str, tuple[object, object, object, object]] = {}
    parametric_windows: dict[str, tuple[object, object, object, object]] = {}
    parametric_mep_segments: dict[str, tuple[object, object, object]] = {}
    parametric_mep_equipment: dict[str, tuple[object, object, object]] = {}
    parametric_mep_terminals: dict[str, tuple[object, object, object]] = {}
    bm = None  # Populated when use_parametric_pipeline=True; used for provenance.

    if use_parametric_pipeline:
        from app.models.request import ExportOptions as _Opts
        from app.services.geometry_resolver import resolve_geometries
        from app.services.massing_to_building_model import lift
        from app.services.placement_resolver import resolve_placements

        _opts = _Opts(
            projectName=project_name,
            buildingName=building_name,
            siteName=site_name,
        )
        bm, _w = lift(geometry, _opts, build_id="parametric-bridge")
        placements = resolve_placements(bm)
        geometries = resolve_geometries(bm, placements)
        bld = bm.project.site.building
        # Walls + slabs + rooms + stairs live per-storey.
        for storey_node in bld.storeys:
            for w_node in storey_node.walls:
                if w_node.id in placements and w_node.id in geometries:
                    parametric_walls[w_node.id] = (
                        w_node, placements[w_node.id], geometries[w_node.id]
                    )
            for s_node in storey_node.slabs:
                if s_node.id in placements and s_node.id in geometries:
                    parametric_slabs[s_node.id] = (
                        s_node, placements[s_node.id], geometries[s_node.id]
                    )
            for r_node in storey_node.rooms:
                if r_node.id in placements and r_node.id in geometries:
                    parametric_rooms[r_node.id] = (
                        r_node, placements[r_node.id], geometries[r_node.id]
                    )
            for st_node in storey_node.stairs:
                if st_node.id in placements and st_node.id in geometries:
                    parametric_stairs[st_node.id] = (
                        st_node, placements[st_node.id], geometries[st_node.id]
                    )
        # Columns + beams live at structural_system level.
        for c_node in bld.structural_system.columns:
            if c_node.id in placements and c_node.id in geometries:
                parametric_columns[c_node.id] = (
                    c_node, placements[c_node.id], geometries[c_node.id]
                )
        for b_node in bld.structural_system.beams:
            if b_node.id in placements and b_node.id in geometries:
                parametric_beams[b_node.id] = (
                    b_node, placements[b_node.id], geometries[b_node.id]
                )
        # Doors/windows: bundle with their parent opening so the orchestrator
        # creates opening + filler together.
        openings_by_id = {o.id: o for st in bld.storeys for o in st.openings}
        opening_placements_by_id = {
            o.id: placements.get(o.id) for o in openings_by_id.values()
        }
        for d_node in bld.doors:
            opening = openings_by_id.get(d_node.in_opening_id)
            opening_p = opening_placements_by_id.get(d_node.in_opening_id)
            if opening is not None and opening_p is not None:
                parametric_doors[d_node.id] = (d_node, opening, opening_p, opening.in_wall_id)
        for w_node in bld.windows:
            opening = openings_by_id.get(w_node.in_opening_id)
            opening_p = opening_placements_by_id.get(w_node.in_opening_id)
            if opening is not None and opening_p is not None:
                parametric_windows[w_node.id] = (w_node, opening, opening_p, opening.in_wall_id)
        # MEP — segments, equipment, terminals.
        for sys in bld.mep_systems:
            if sys.source is not None:
                if sys.source.id in placements and sys.source.id in geometries:
                    parametric_mep_equipment[sys.source.id] = (
                        sys.source, placements[sys.source.id], geometries[sys.source.id]
                    )
            for seg in sys.distribution:
                if seg.id in placements and seg.id in geometries:
                    parametric_mep_segments[seg.id] = (
                        seg, placements[seg.id], geometries[seg.id]
                    )
            for term in sys.terminals:
                if term.id in placements and term.id in geometries:
                    parametric_mep_terminals[term.id] = (
                        term, placements[term.id], geometries[term.id]
                    )

    # ── Element creation ─────────────────────────────────────────
    counts = EntityCounts()
    failures: list[BuildFailure] = []
    wall_lookup: dict[str, ifcopenshell.entity_instance] = {}
    mep_elements: dict[str, list[ifcopenshell.entity_instance]] = {
        "HVAC": [],
        "Plumbing": [],
        "Electrical": [],
    }
    # One presentation-style cache per build — reused across every element
    # so the output stays compact while every geometry item carries a
    # discipline-appropriate IfcStyledItem for the viewer to paint.
    style_cache = StyleCache(model)

    # Phase 2 / Fix 3 — type-instance registry. Collects IfcXxxType
    # entities deduplicated by (material, thickness, predefined_type,
    # section_profile) signature. Flushed once at end-of-build, emitting
    # one IfcRelDefinesByType per type with all its instances. Material
    # association moves from instance level to type level inside the
    # registry — instances no longer carry their own IfcRelAssociatesMaterial.
    type_registry = TypeRegistry(model)

    for storey_data in geometry.storeys:
        ifc_storey = ifc_storeys.get(storey_data.index)
        if not ifc_storey:
            continue
        storey_elevation = storey_data.elevation

        # First pass: create walls (needed before windows/doors for opening relationships)
        for elem in storey_data.elements:
            if elem.type != "wall" or not _element_in_discipline(elem, discipline):
                continue
            if not _element_passes_rich_mode(elem, rich_mode):
                continue
            try:
                if use_parametric_pipeline and elem.id in parametric_walls:
                    wall_node, w_placement, w_geometry = parametric_walls[elem.id]
                    ifc_wall = create_wall_parametric(
                        wall_node,
                        w_placement,
                        w_geometry,
                        model,
                        body_context,
                        ifc_storey,
                        type_registry,
                    )
                else:
                    ifc_wall = create_wall(
                        model,
                        elem,
                        ifc_storey,
                        body_context,
                        storey_elevation=storey_elevation,
                    )
                wall_lookup[elem.id] = ifc_wall
                wall_mat = _get_wall_mat(elem.properties.is_partition or False)
                wall_sig = type_registry.signature(
                    type_class="IfcWallType",
                    material_layer_set=wall_mat,
                    thickness_m=elem.properties.thickness,
                    predefined_type="PARTITIONING" if elem.properties.is_partition else "STANDARD",
                )
                type_registry.attach(ifc_wall, wall_sig, material_layer_set=wall_mat)
                add_wall_psets(model, ifc_wall, elem, building_type)
                apply_color(model, ifc_wall, "wall-partition" if elem.properties.is_partition else "wall-exterior", style_cache)
                counts.IfcWall += 1
            except Exception as e:
                log.warning(
                    "wall_creation_failed",
                    elem_id=elem.id,
                    error=str(e),
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                failures.append(
                    BuildFailure(
                        element_id=elem.id,
                        element_type=elem.type,
                        error_type=type(e).__name__,
                        error=str(e),
                    )
                )

        # Second pass: all other elements
        for elem in storey_data.elements:
            if elem.type == "wall":
                continue  # already handled
            if not _element_in_discipline(elem, discipline):
                continue
            if not _element_passes_rich_mode(elem, rich_mode):
                continue

            try:
                if elem.type in ("slab", "roof"):
                    if use_parametric_pipeline and elem.id in parametric_slabs:
                        slab_node, sl_placement, sl_geometry = parametric_slabs[elem.id]
                        ifc_slab = create_slab_parametric(
                            slab_node, sl_placement, sl_geometry, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_slab = create_slab(
                            model, elem, ifc_storey, body_context,
                            footprint=geometry.footprint,
                            elevation=storey_elevation if elem.type == "slab" else storey_elevation + storey_data.height,
                        )
                    is_roof = elem.type == "roof"
                    slab_layer_set = roof_mat if is_roof else slab_mat
                    slab_sig = type_registry.signature(
                        type_class="IfcSlabType",
                        material_layer_set=slab_layer_set,
                        thickness_m=elem.properties.thickness,
                        predefined_type="ROOF" if is_roof else "FLOOR",
                    )
                    type_registry.attach(ifc_slab, slab_sig, material_layer_set=slab_layer_set)
                    add_slab_psets(model, ifc_slab, elem, is_roof=is_roof)
                    apply_color(model, ifc_slab, "slab-roof" if is_roof else "slab-floor", style_cache)
                    counts.IfcSlab += 1

                elif elem.type == "column":
                    if use_parametric_pipeline and elem.id in parametric_columns:
                        col_node, c_placement, c_geometry = parametric_columns[elem.id]
                        ifc_col = create_column_parametric(
                            col_node, c_placement, c_geometry, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_col = create_column(model, elem, ifc_storey, body_context, storey_elevation=storey_elevation)
                    col_sig = type_registry.signature(
                        type_class="IfcColumnType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="COLUMN",
                        section_profile=(elem.properties.section_profile or ""),
                    )
                    type_registry.attach(ifc_col, col_sig)
                    add_column_psets(model, ifc_col, elem)
                    apply_color(model, ifc_col, "column", style_cache)
                    counts.IfcColumn += 1

                elif elem.type == "window":
                    parent_wall = wall_lookup.get(elem.properties.parent_wall_id or "")
                    if (
                        use_parametric_pipeline
                        and elem.id in parametric_windows
                        and parent_wall is not None
                    ):
                        w_node, opening_node, op_placement, _wall_id = parametric_windows[elem.id]
                        opening_entity = create_opening_parametric(
                            opening_node, op_placement, parent_wall, model, body_context,
                        )
                        ifc_win = create_window_parametric(
                            w_node, opening_node, opening_entity, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_win = create_window(model, elem, ifc_storey, body_context, parent_wall, storey_elevation=storey_elevation)
                    win_sig = type_registry.signature(
                        type_class="IfcWindowType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="WINDOW",
                    )
                    type_registry.attach(ifc_win, win_sig)
                    add_window_psets(model, ifc_win, elem)
                    apply_color(model, ifc_win, "window", style_cache)
                    counts.IfcWindow += 1
                    if parent_wall:
                        counts.IfcOpeningElement += 1

                elif elem.type == "door":
                    parent_wall = wall_lookup.get(elem.properties.parent_wall_id or "")
                    if (
                        use_parametric_pipeline
                        and elem.id in parametric_doors
                        and parent_wall is not None
                    ):
                        d_node, opening_node, op_placement, _wall_id = parametric_doors[elem.id]
                        opening_entity = create_opening_parametric(
                            opening_node, op_placement, parent_wall, model, body_context,
                        )
                        ifc_door = create_door_parametric(
                            d_node, opening_node, opening_entity, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_door = create_door(model, elem, ifc_storey, body_context, parent_wall, storey_elevation=storey_elevation)
                    door_sig = type_registry.signature(
                        type_class="IfcDoorType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="DOOR",
                    )
                    type_registry.attach(ifc_door, door_sig)
                    add_door_psets(model, ifc_door, elem)
                    apply_color(model, ifc_door, "door", style_cache)
                    counts.IfcDoor += 1
                    if parent_wall:
                        counts.IfcOpeningElement += 1

                elif elem.type == "space":
                    if use_parametric_pipeline and elem.id in parametric_rooms:
                        r_node, r_placement, r_geometry = parametric_rooms[elem.id]
                        ifc_space = create_space_parametric(
                            r_node, r_placement, r_geometry, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_space = create_space(model, elem, ifc_storey, body_context, storey_elevation=storey_elevation)
                    space_sig = type_registry.signature(
                        type_class="IfcSpaceType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="SPACE",
                    )
                    type_registry.attach(ifc_space, space_sig)
                    add_space_psets(model, ifc_space, elem)
                    apply_color(model, ifc_space, "space", style_cache)
                    counts.IfcSpace += 1

                elif elem.type == "beam":
                    if use_parametric_pipeline and elem.id in parametric_beams:
                        b_node, b_placement, b_geometry = parametric_beams[elem.id]
                        ifc_beam = create_beam_parametric(
                            b_node, b_placement, b_geometry, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_beam = create_beam(model, elem, ifc_storey, body_context, storey_elevation=storey_elevation)
                    beam_sig = type_registry.signature(
                        type_class="IfcBeamType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="BEAM",
                        section_profile=(elem.properties.section_profile or ""),
                    )
                    type_registry.attach(ifc_beam, beam_sig)
                    add_beam_psets(model, ifc_beam, elem)
                    apply_color(model, ifc_beam, "beam", style_cache)
                    counts.IfcBeam += 1

                elif elem.type == "stair":
                    if use_parametric_pipeline and elem.id in parametric_stairs:
                        st_node, st_placement, st_geometry = parametric_stairs[elem.id]
                        ifc_stair = create_stair_parametric(
                            st_node, st_placement, st_geometry, model,
                            body_context, ifc_storey, type_registry,
                        )
                    else:
                        ifc_stair = create_stair(model, elem, ifc_storey, body_context, storey_elevation=storey_elevation)
                    stair_sig = type_registry.signature(
                        type_class="IfcStairFlightType",
                        material_layer_set=None,
                        thickness_m=None,
                        predefined_type="STRAIGHT",
                    )
                    type_registry.attach(ifc_stair, stair_sig)
                    apply_color(model, ifc_stair, "stair", style_cache)
                    counts.IfcStairFlight += 1

                elif elem.type == "duct":
                    if use_parametric_pipeline and elem.id in parametric_mep_segments:
                        seg_node, seg_p, seg_g = parametric_mep_segments[elem.id]
                        ifc_duct = create_mep_segment_parametric(
                            seg_node, seg_p, seg_g, model, body_context,
                            ifc_storey, type_registry,
                            emit_geometry=emit_mep_geometry,
                        )
                    else:
                        ifc_duct = create_duct(
                            model, elem, ifc_storey, body_context,
                            storey_elevation=storey_elevation,
                            emit_geometry=emit_mep_geometry,
                        )
                    apply_color(model, ifc_duct, "duct", style_cache)
                    mep_elements["HVAC"].append(ifc_duct)
                    counts.IfcDuctSegment += 1

                elif elem.type == "pipe":
                    if use_parametric_pipeline and elem.id in parametric_mep_segments:
                        seg_node, seg_p, seg_g = parametric_mep_segments[elem.id]
                        ifc_pipe = create_mep_segment_parametric(
                            seg_node, seg_p, seg_g, model, body_context,
                            ifc_storey, type_registry,
                            emit_geometry=emit_mep_geometry,
                        )
                    else:
                        ifc_pipe = create_pipe(
                            model, elem, ifc_storey, body_context,
                            storey_elevation=storey_elevation,
                            emit_geometry=emit_mep_geometry,
                        )
                    apply_color(model, ifc_pipe, "pipe", style_cache)
                    mep_elements["Plumbing"].append(ifc_pipe)
                    counts.IfcPipeSegment += 1

                elif elem.type == "cable-tray":
                    if use_parametric_pipeline and elem.id in parametric_mep_segments:
                        seg_node, seg_p, seg_g = parametric_mep_segments[elem.id]
                        ifc_tray = create_mep_segment_parametric(
                            seg_node, seg_p, seg_g, model, body_context,
                            ifc_storey, type_registry,
                            emit_geometry=emit_mep_geometry,
                        )
                    else:
                        ifc_tray = create_cable_tray(
                            model, elem, ifc_storey, body_context,
                            storey_elevation=storey_elevation,
                            emit_geometry=emit_mep_geometry,
                        )
                    apply_color(model, ifc_tray, "cable-tray", style_cache)
                    mep_elements["Electrical"].append(ifc_tray)

                elif elem.type == "equipment":
                    if use_parametric_pipeline and elem.id in parametric_mep_equipment:
                        eq_node, eq_p, eq_g = parametric_mep_equipment[elem.id]
                        ifc_equip = create_mep_equipment_parametric(
                            eq_node, eq_p, eq_g, model, body_context,
                            ifc_storey, type_registry,
                            emit_geometry=emit_mep_geometry,
                        )
                    else:
                        ifc_equip = create_equipment(
                            model, elem, ifc_storey, body_context,
                            storey_elevation=storey_elevation,
                            emit_geometry=emit_mep_geometry,
                        )
                    apply_color(model, ifc_equip, "equipment", style_cache)
                    mep_elements["HVAC"].append(ifc_equip)

                elif elem.type in ("balcony", "canopy", "parapet"):
                    proxy = api.run(
                        "root.create_entity", model, ifc_class="IfcBuildingElementProxy"
                    )
                    proxy.GlobalId = derive_guid("IfcBuildingElementProxy", elem.id)
                    proxy.Name = elem.properties.name
                    from app.utils.ifc_helpers import assign_to_storey
                    assign_to_storey(model, ifc_storey, proxy)

            except Exception as e:
                log.warning(
                    "element_creation_failed",
                    elem_id=elem.id,
                    elem_type=elem.type,
                    error=str(e),
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                failures.append(
                    BuildFailure(
                        element_id=elem.id,
                        element_type=elem.type,
                        error_type=type(e).__name__,
                        error=str(e),
                    )
                )

    # ── MEP systems ──────────────────────────────────────────────
    if discipline in ("mep", "combined"):
        for sys_name, elements in mep_elements.items():
            if elements:
                create_mep_system(model, building, sys_name, elements)

    # ── Enrichment: real-world features the massing-generator skips ──
    # Parapets, podium, ceilings, roof railing, entrance canopy — these
    # turn a bare geometric skeleton into something that reads as a real
    # building in the viewer. Architectural disciplines get the full set;
    # structural / MEP only get what applies (podium, ceiling soffit).
    # Failures are logged but never abort the build.
    #
    # Skipped when rich_mode == "off": the contract for "off" is "spatial
    # structure only — no elements". Enrichment would emit parapet walls,
    # podium slabs, ceiling coverings, etc. — all elements — which would
    # break the off-mode invariant the audit endpoint exists to verify.
    if discipline in ("architectural", "combined") and rich_mode != "off":
        enrich_building(model, geometry, ifc_storeys, body_context, style_cache)

    # ── Type-instance flush (Phase 2 / Fix 3) ───────────────────
    # Emit one IfcRelDefinesByType per type with its full instance list.
    # Ran AFTER element creation so every typed instance is already in
    # the registry; runs BEFORE classification so the OmniClass scan
    # sees both type entities and instances.
    type_registry.flush()

    # ── Classification: OmniClass + NBC India ────────────────────
    # OmniClass — element-level, every emitter type has an entry.
    # NBC India 2016 Part 4 — building-level, occupancy group derived
    # from buildingType. Both attach via IfcRelAssociatesClassification.
    # Always on — classification is cheap and every professional IFC
    # carries it.
    attach_omniclass(model)
    attach_nbc_india(model, geometry.building_type)

    # ── RERA Pset (Phase 2 / Task 7) ─────────────────────────────
    # Indian Real Estate Regulation Act metadata, attached only to
    # residential IfcSpaces (NBC Group A). Falls back to defaults when
    # `rera_inputs` is None (no extension on the BuildFlow side yet).
    # Skipped on richMode='off' because there are no spaces to attach
    # to. No-op for non-residential buildings.
    inputs = rera_inputs or ReraInputs.from_options(None, None, None)
    attach_rera_psets(model, geometry.building_type, inputs)

    # ── Slice 5 — Provenance Pset (parametric pipeline only) ─────
    # Slice 3's stamp_provenance attaches Pset_BuildFlow_Provenance with
    # the 15 fields (build_id, target_fidelity, fixture_match, IDS counts
    # to be re-stamped post-Stage-2.5 in Slice 6, etc.). Adds 17 entities
    # per fixture (1 IfcPropertySet + 1 IfcRelDefinesByProperties + 15
    # IfcPropertySingleValue) — that's the documented expected delta vs
    # legacy on the verification-gate entity counts.
    if use_parametric_pipeline and bm is not None:
        from app.services.provenance import stamp_provenance

        stamp_provenance(model, bm.project.metadata.provenance, project)

    elapsed = round((time.monotonic() - start) * 1000, 1)
    log.info(
        "ifc_build_complete",
        discipline=discipline,
        storeys=len(geometry.storeys),
        walls=counts.IfcWall,
        windows=counts.IfcWindow,
        openings=counts.IfcOpeningElement,
        failures=len(failures),
        elapsed_ms=elapsed,
    )

    return model, counts, failures


# ── Multi-file export ────────────────────────────────────────────────


def build_multi_discipline(
    request: ExportIFCRequest,
) -> dict[str, tuple[bytes, EntityCounts, list[BuildFailure]]]:
    """Build IFC files for each requested discipline.

    Returns a dict mapping discipline name to
    (ifc_bytes, entity_counts, per_element_failures).
    """
    results: dict[str, tuple[bytes, EntityCounts, list[BuildFailure]]] = {}
    rich_mode = request.options.rich_mode
    emit_mep_geometry = _emit_mep_geometry(rich_mode)
    rera_inputs = ReraInputs.from_options(
        rera_project_id=request.options.rera_project_id,
        seismic_zone=request.options.seismic_zone,
        wind_zone=request.options.wind_zone,
    )

    for discipline in request.options.disciplines:
        model, counts, failures = build_ifc(
            geometry=request.geometry,
            project_name=request.options.project_name,
            building_name=request.options.building_name,
            site_name=request.options.site_name,
            author=request.options.author,
            discipline=discipline,
            emit_mep_geometry=emit_mep_geometry,
            rich_mode=rich_mode,
            rera_inputs=rera_inputs,
            use_parametric_pipeline=request.options.use_parametric_pipeline,
        )

        # Write to bytes
        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=True) as tmp:
            model.write(tmp.name)
            tmp.seek(0)
            ifc_bytes = tmp.read()

        results[discipline] = (ifc_bytes, counts, failures)

    return results
