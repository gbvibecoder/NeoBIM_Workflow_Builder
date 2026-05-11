"""Slice T2.0 Phase D — Single-storey 2BHK Pune house (bungalow).

Layer-3 building assembler that composes ONE GF-style floor unit + a
foundation, columns, beams, and a flat roof slab into a complete
single-storey 2BHK bungalow. Differs from the duplex assembler in:

  * One storey instead of two (no FF FloorUnit).
  * GF floor unit invoked with `has_stair=False` — there is no upper
    floor for the stair to climb to. The room labelled "Stair & Foyer"
    in the duplex layout is preserved by id (`room-gf-stair-foyer`)
    but is functionally just a foyer in the bungalow.
  * Beams emitted at one ceiling level only (z = top_of_storey
    - slab thickness), instead of two.
  * Roof slab hosted on `storey-ground` (the only storey).
  * Provenance carries `build_id="tier2-2bhk-pune-house-v1"` and
    `fixture_match="tier2-2bhk-pune-house-v1"` so downstream IDS
    auditing can distinguish the bungalow output from the duplex.

Element counts (default plot 7.32 × 15.24, default floor_height 3.0):
  walls=12, rooms=7, slabs=2, columns=12, footings=12, beams=17,
  openings=13, doors=7, windows=6, stairs=0  →  88 total.

Note that the bungalow is naturally ~56 % of the duplex's 156 elements:
per-floor elements (walls / rooms / openings / doors / windows / beams)
halve when one floor is removed, while foundation + columns stay
constant. The element-density test in `tests/test_template_2bhk_pune.py`
asserts exact counts — a regression that drops elements unexpectedly
will fail it.
"""

from __future__ import annotations

from typing import Literal

from app.domain.building_model import (
    Building,
    BuildingModel,
    Foundation,
    Project,
    ProjectMetadata,
    Provenance,
    ReraData,
    Roof,
    Site,
    Slab,
    Storey,
    StructuralSystem,
    Vec2,
)
from app.templates._2bhk_pune_floor_unit import build_2bhk_pune_gf_floor_unit
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


# ─── Constants used by the house assembler ─────────────────────────
# Same defaults as the duplex assembler — Pune municipal setbacks,
# 0.150 m slab, 0.6 m footing pad, 0.5 m foundation top below grade.

_FRONT_SETBACK_M: float = 3.0
_REAR_SETBACK_M: float = 1.5
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.6
_FOUNDATION_TOP_DEPTH_M: float = 0.5

_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_Y_LABELS: tuple[str, ...] = ("1", "2", "3", "4")


def build_2bhk_pune_house(
    *,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    floor_height: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-2bhk-pune-house-v1",
    generated_at: str = "2026-05-09T00:00:00Z",
) -> BuildingModel:
    """Build a single-storey 2BHK Pune bungalow (Slice T2.0 Layer-3).

    Composition:
      * One GF FloorUnit (kitchen / living / pooja / powder / utility /
        store / foyer; `has_stair=False`) at elevation = 0.
      * Foundation: 12 isolated pad footings under the column grid.
      * Columns: 12 RCC columns spanning -0.5 → floor_height.
      * Beams: 17 RCC beams at z = floor_height - slab_thickness, all
        hosted on storey-ground.
      * Roof: flat slab at z = floor_height (top) / floor_height -
        slab_thickness (bottom), hosted on storey-ground.

    Returns an invariant-valid `BuildingModel`. Caller-supplied parameters
    cannot trigger BuildingModelValidationError; if it fires it's a
    template bug. ValueError fires from the floor unit on tiny plots.
    """
    # ─── Z-coordinates ───────────────────────────────────────────
    z_roof_top = floor_height
    z_roof_bottom = floor_height - _SLAB_THICKNESS_M
    z_footing_top = -_FOUNDATION_TOP_DEPTH_M
    z_footing_bottom = z_footing_top - _FOOTING_THICKNESS_M
    z_column_top = z_roof_top  # column extends to top of roof slab

    # ─── Layer-2: GF floor unit, no stair ──────────────────────
    fu = build_2bhk_pune_gf_floor_unit(
        storey_id="storey-ground",
        storey_index=0,
        name_prefix="gf",
        floor_slab_id="slab-ground",
        elevation=0.0,
        floor_height=floor_height,
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        front_setback_m=_FRONT_SETBACK_M,
        rear_setback_m=_REAR_SETBACK_M,
        side_setback_m=0.0,
        door_to_stair_outside=True,
        has_stair=False,
    )

    envelope_polygon = fu.floor_footprint_polygon

    # ─── Roof slab (assembler-owned) ───────────────────────────
    slab_roof = Slab(
        id="slab-roof",
        host_storey_id="storey-ground",
        footprint_polygon=envelope_polygon,
        top_z=z_roof_top,
        bottom_z=z_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    # ─── Structural grid: 12 columns + 12 footings ────────────
    x_axes_dict: dict[str, float] = dict(zip(_X_LABELS, fu.column_grid_x))
    y_axes_dict: dict[str, float] = dict(zip(_Y_LABELS, fu.column_grid_y))

    columns, footings = make_rcc_grid_columns_and_footings(
        x_axes=x_axes_dict,
        y_axes=y_axes_dict,
        column_base_z=z_footing_top,
        column_top_z=z_column_top,
        footing_top_z=z_footing_top,
        footing_bottom_z=z_footing_bottom,
        host_storey_id="storey-ground",
    )
    columns_by_label = {c.id.removeprefix("col-"): c for c in columns}

    # ─── Beams: 17 (one ceiling level) ─────────────────────────
    # Ceiling beams sit at z_roof_bottom (bottom of roof slab). They
    # support slab-roof, which is hosted on storey-ground; so beams
    # also host on storey-ground (validator's convention).
    beams = make_orthogonal_beam_grid(
        columns_by_label=columns_by_label,
        x_labels_in_order=list(_X_LABELS),
        y_labels_in_order=list(_Y_LABELS),
        beam_top_z=z_roof_bottom,
        host_storey_id="storey-ground",
        level_label="L1",
    )
    beams.sort(key=lambda b: b.id)

    structural_system = StructuralSystem(
        id="structural-system-1",
        columns=columns,
        beams=beams,
        allows_slanted=False,
    )
    foundation = Foundation(id="foundation-1", footings=footings)
    roof = Roof(id="roof-1", type="flat")

    # ─── Single storey holds everything (floor slab + roof slab,
    # walls, rooms, openings; no stairs) ──────────────────────
    storey_ground = Storey(
        id="storey-ground",
        name="Ground Floor",
        elevation=0.0,
        actual_height=floor_height,
        index=0,
        rooms=fu.rooms,
        walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs,  # always [] when has_stair=False
        openings=fu.openings,
    )

    all_doors = sorted(list(fu.doors), key=lambda d: d.id)
    all_windows = sorted(list(fu.windows), key=lambda w: w.id)

    # ─── Building, Site, Project ───────────────────────────────
    building = Building(
        id="building-1",
        name="2BHK Pune House",
        occupancy_nbc_group="A-1",  # NBC: single-family private dwelling
        envelope_polygon=envelope_polygon,
        structural_system=structural_system,
        mep_systems=[],
        storeys=[storey_ground],
        foundation=foundation,
        roof=roof,
        doors=all_doors,
        windows=all_windows,
    )
    # Slice 2B.3 — legal plot polygon (CCW rectangle anchored at origin).
    plot_polygon = [
        Vec2(x=0.0, y=0.0),
        Vec2(x=plot_width_m, y=0.0),
        Vec2(x=plot_width_m, y=plot_length_m),
        Vec2(x=0.0, y=plot_length_m),
    ]
    site = Site(
        id="site-1",
        name="Pune Plot",
        true_north_deg=0.0,
        terrain_polygon=[],
        plot_polygon=plot_polygon,
        building=building,
    )

    provenance = Provenance(
        model_version="1.0.0",
        input_contract_version="Tier2Template-1.0.0",
        ifcopenshell_version="",
        agent_stages_run="tier2-template-author",
        agent_models_used="",
        total_llm_cost_usd=0.0,
        total_wallclock_ms=0,
        prompt_cache_hit_rate=0.0,
        ids_rules_passed=0,
        ids_rules_failed=0,
        target_fidelity="LOD-300",
        fixture_match="tier2-2bhk-pune-house-v1",
        generated_at=generated_at,
        build_id=build_id,
        source_contract="BuildingModel",
    )
    rera = ReraData(
        seismic_zone=seismic_zone,
        wind_zone=wind_zone,
        nbc_occupancy_group="A-1",
    )
    metadata = ProjectMetadata(
        rera=rera,
        permits=[],
        cobie_defaults={},
        provenance=provenance,
    )
    project = Project(
        id="project-1",
        name="2BHK Pune House Project",
        site=site,
        metadata=metadata,
    )

    return BuildingModel.build({"project": project.model_dump()})


__all__ = ["build_2bhk_pune_house"]
