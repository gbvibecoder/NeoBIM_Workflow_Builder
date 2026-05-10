"""Phase T2.1 Phase C — Single-storey 1BHK Pune house (bungalow).

Layer-3 building assembler that composes ONE 1BHK GF-style floor unit +
foundation, columns, beams, and a flat roof slab into a complete
single-storey 1BHK bungalow.

Differs from the 1BHK duplex (`tier2_1bhk_pune.py`) in:

  * One storey instead of two (no FF FloorUnit).
  * GF floor unit invoked with `has_stair=False` — there is no upper
    floor for the stair to climb to. The "Stair & Foyer" room id is
    preserved (`room-gf-stair-foyer`) but is functionally just a foyer.
  * Beams emitted at one ceiling level only.
  * Roof slab hosted on `storey-ground`.

Element counts (default plot 7.32 × 12.20m, default floor_height 3.0):

    walls=9, rooms=5, slabs=2, columns=9, footings=9, beams=12,
    openings=12, doors=6, windows=6, stairs=0  →  70 total.

The bungalow uses 1BHK structural sizing — 230×230mm RCC columns and
1.2 × 1.2 × 0.5m pad footings (smaller than 2BHK's 300mm columns and
1.5 × 1.5 × 0.6m pads), appropriate for the smaller footprint and
single-storey load.
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
)
from app.templates._1bhk_pune_floor_unit import (
    build_1bhk_pune_gf_floor_unit,
    make_1bhk_grid_columns_and_footings,
)
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_roof_slab_layers,
)


# ─── Constants used by the house assembler ─────────────────────────

_FRONT_SETBACK_M: float = 2.5
_REAR_SETBACK_M: float = 1.5
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.5
_FOUNDATION_TOP_DEPTH_M: float = 0.5

_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_Y_LABELS: tuple[str, ...] = ("1", "2", "3")


def build_1bhk_pune_house(
    *,
    plot_width_m: float = 7.32,
    plot_length_m: float = 12.20,
    floor_height: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-1bhk-pune-house-v1",
    generated_at: str = "2026-05-10T00:00:00Z",
) -> BuildingModel:
    """Build a single-storey 1BHK Pune bungalow."""
    z_roof_top = floor_height
    z_roof_bottom = floor_height - _SLAB_THICKNESS_M
    z_footing_top = -_FOUNDATION_TOP_DEPTH_M
    z_footing_bottom = z_footing_top - _FOOTING_THICKNESS_M
    z_column_top = z_roof_top

    fu = build_1bhk_pune_gf_floor_unit(
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

    slab_roof = Slab(
        id="slab-roof",
        host_storey_id="storey-ground",
        footprint_polygon=envelope_polygon,
        top_z=z_roof_top,
        bottom_z=z_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    x_axes_dict = dict(zip(_X_LABELS, fu.column_grid_x))
    y_axes_dict = dict(zip(_Y_LABELS, fu.column_grid_y))

    columns, footings = make_1bhk_grid_columns_and_footings(
        x_axes=x_axes_dict,
        y_axes=y_axes_dict,
        column_base_z=z_footing_top,
        column_top_z=z_column_top,
        footing_top_z=z_footing_top,
        footing_bottom_z=z_footing_bottom,
        host_storey_id="storey-ground",
    )
    columns_by_label = {c.id.removeprefix("col-"): c for c in columns}

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

    storey_ground = Storey(
        id="storey-ground",
        name="Ground Floor",
        elevation=0.0,
        actual_height=floor_height,
        index=0,
        rooms=fu.rooms,
        walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs,
        openings=fu.openings,
    )

    all_doors = sorted(list(fu.doors), key=lambda d: d.id)
    all_windows = sorted(list(fu.windows), key=lambda w: w.id)

    building = Building(
        id="building-1",
        name="1BHK Pune House",
        occupancy_nbc_group="A-1",
        envelope_polygon=envelope_polygon,
        structural_system=structural_system,
        mep_systems=[],
        storeys=[storey_ground],
        foundation=foundation,
        roof=roof,
        doors=all_doors,
        windows=all_windows,
    )
    site = Site(
        id="site-1",
        name="Pune Plot",
        true_north_deg=0.0,
        terrain_polygon=[],
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
        fixture_match="tier2-1bhk-pune-house-v1",
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
        name="1BHK Pune House Project",
        site=site,
        metadata=metadata,
    )

    return BuildingModel.build({"project": project.model_dump()})


__all__ = ["build_1bhk_pune_house"]
