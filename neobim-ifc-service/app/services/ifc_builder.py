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
from app.services.wall_builder import create_wall
from app.services.slab_builder import create_slab
from app.services.column_builder import create_column
from app.services.opening_builder import create_window, create_door
from app.services.space_builder import create_space
from app.services.beam_builder import create_beam
from app.services.stair_builder import create_stair
from app.services.mep_builder import (
    create_duct,
    create_pipe,
    create_cable_tray,
    create_equipment,
    create_mep_system,
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
from app.utils.guid import new_guid

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


# ── Main build function ──────────────────────────────────────────────


def build_ifc(
    geometry: MassingGeometry,
    project_name: str = "NeoBIM Project",
    building_name: str = "Building",
    site_name: str = "Default Site",
    author: str = "NeoBIM",
    discipline: Discipline = "combined",
) -> tuple[ifcopenshell.file, EntityCounts, list[BuildFailure]]:
    """Build a complete IFC4 model from MassingGeometry.

    Returns (ifc_file, entity_counts, per_element_failures). Per-element
    failures do not abort the build — unrecoverable failures raise instead.
    """
    start = time.monotonic()

    model = ifcopenshell.file(schema="IFC4")

    # ── Project + context ────────────────────────────────────────
    project = api.run("root.create_entity", model, ifc_class="IfcProject", name=project_name)
    project.GlobalId = new_guid()

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
    site.GlobalId = new_guid()
    api.run("aggregate.assign_object", model, relating_object=project, products=[site])

    building = api.run("root.create_entity", model, ifc_class="IfcBuilding", name=building_name)
    building.GlobalId = new_guid()
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
        ifc_storey.GlobalId = new_guid()
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

    # ── Element creation ─────────────────────────────────────────
    counts = EntityCounts()
    failures: list[BuildFailure] = []
    wall_lookup: dict[str, ifcopenshell.entity_instance] = {}
    mep_elements: dict[str, list[ifcopenshell.entity_instance]] = {
        "HVAC": [],
        "Plumbing": [],
        "Electrical": [],
    }

    for storey_data in geometry.storeys:
        ifc_storey = ifc_storeys.get(storey_data.index)
        if not ifc_storey:
            continue

        # First pass: create walls (needed before windows/doors for opening relationships)
        for elem in storey_data.elements:
            if elem.type != "wall" or not _element_in_discipline(elem, discipline):
                continue
            try:
                ifc_wall = create_wall(model, elem, ifc_storey, body_context)
                wall_lookup[elem.id] = ifc_wall
                assign_material_to_element(model, ifc_wall, _get_wall_mat(elem.properties.is_partition or False))
                add_wall_psets(model, ifc_wall, elem, building_type)
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

            try:
                if elem.type in ("slab", "roof"):
                    ifc_slab = create_slab(
                        model, elem, ifc_storey, body_context,
                        footprint=geometry.footprint,
                        elevation=storey_data.elevation if elem.type == "slab" else storey_data.elevation + storey_data.height,
                    )
                    is_roof = elem.type == "roof"
                    assign_material_to_element(model, ifc_slab, roof_mat if is_roof else slab_mat)
                    add_slab_psets(model, ifc_slab, elem, is_roof=is_roof)
                    counts.IfcSlab += 1

                elif elem.type == "column":
                    ifc_col = create_column(model, elem, ifc_storey, body_context)
                    add_column_psets(model, ifc_col, elem)
                    counts.IfcColumn += 1

                elif elem.type == "window":
                    parent_wall = wall_lookup.get(elem.properties.parent_wall_id or "")
                    ifc_win = create_window(model, elem, ifc_storey, body_context, parent_wall)
                    add_window_psets(model, ifc_win, elem)
                    counts.IfcWindow += 1
                    if parent_wall:
                        counts.IfcOpeningElement += 1

                elif elem.type == "door":
                    parent_wall = wall_lookup.get(elem.properties.parent_wall_id or "")
                    ifc_door = create_door(model, elem, ifc_storey, body_context, parent_wall)
                    add_door_psets(model, ifc_door, elem)
                    counts.IfcDoor += 1
                    if parent_wall:
                        counts.IfcOpeningElement += 1

                elif elem.type == "space":
                    ifc_space = create_space(model, elem, ifc_storey, body_context)
                    add_space_psets(model, ifc_space, elem)
                    counts.IfcSpace += 1

                elif elem.type == "beam":
                    ifc_beam = create_beam(model, elem, ifc_storey, body_context)
                    add_beam_psets(model, ifc_beam, elem)
                    counts.IfcBeam += 1

                elif elem.type == "stair":
                    create_stair(model, elem, ifc_storey, body_context)
                    counts.IfcStairFlight += 1

                elif elem.type == "duct":
                    ifc_duct = create_duct(model, elem, ifc_storey, body_context)
                    mep_elements["HVAC"].append(ifc_duct)
                    counts.IfcDuctSegment += 1

                elif elem.type == "pipe":
                    ifc_pipe = create_pipe(model, elem, ifc_storey, body_context)
                    mep_elements["Plumbing"].append(ifc_pipe)
                    counts.IfcPipeSegment += 1

                elif elem.type == "cable-tray":
                    ifc_tray = create_cable_tray(model, elem, ifc_storey, body_context)
                    mep_elements["Electrical"].append(ifc_tray)

                elif elem.type == "equipment":
                    ifc_equip = create_equipment(model, elem, ifc_storey, body_context)
                    mep_elements["HVAC"].append(ifc_equip)

                elif elem.type in ("balcony", "canopy", "parapet"):
                    proxy = api.run(
                        "root.create_entity", model, ifc_class="IfcBuildingElementProxy"
                    )
                    proxy.GlobalId = new_guid()
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

    for discipline in request.options.disciplines:
        model, counts, failures = build_ifc(
            geometry=request.geometry,
            project_name=request.options.project_name,
            building_name=request.options.building_name,
            site_name=request.options.site_name,
            author=request.options.author,
            discipline=discipline,
        )

        # Write to bytes
        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=True) as tmp:
            model.write(tmp.name)
            tmp.seek(0)
            ifc_bytes = tmp.read()

        results[discipline] = (ifc_bytes, counts, failures)

    return results
