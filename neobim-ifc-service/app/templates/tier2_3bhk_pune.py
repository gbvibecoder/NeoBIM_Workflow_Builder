"""Phase T2.2 Phase D — 3BHK Pune duplex Tier-2 BuildingModel template.

Layer-3 building assembler for the 3BHK duplex. Composes one GF
floor-unit (8 rooms incl. drawing/pooja/stair) + one FF floor-unit
(8 rooms incl. 3 bedrooms + 2 baths + balcony) + foundation +
continuous columns + per-ceiling beam grids + roof slab.

Exposed as both `build_3bhk_pune_duplex` (canonical) and
`build_3bhk_pune_template` (backward-compatible alias).

Default plot 11.0 × 20.0m. 3BHK setbacks (4.5/3.0/1.5/1.5). 3 × 4 RCC
column grid (12 columns, 300mm) — same as 2BHK.

Element counts (default plot, default floor_to_floor 3.0m):
  walls=21 (10 GF + 11 FF), rooms=16 (8 + 8),
  slabs=3 (GF + FF + roof), columns=12, footings=12,
  beams=34 (17/level × 2 levels), openings=32,
  doors=16 (8 GF + 8 FF), windows=16 (8 GF + 8 FF), stairs=1.
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
from app.templates._3bhk_pune_floor_unit import (
    build_3bhk_pune_ff_floor_unit,
    build_3bhk_pune_gf_floor_unit,
)
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


_FRONT_SETBACK_M: float = 4.5
_REAR_SETBACK_M: float = 3.0
_SIDE_SETBACK_M: float = 1.5
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.6
_FOUNDATION_TOP_DEPTH_M: float = 0.5

_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_Y_LABELS: tuple[str, ...] = ("1", "2", "3", "4")


def build_3bhk_pune_duplex(
    *,
    plot_width_m: float = 11.0,
    plot_length_m: float = 20.0,
    floor_to_floor_m: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-3bhk-pune-v1",
    generated_at: str = "2026-05-10T00:00:00Z",
) -> BuildingModel:
    """Build the 3BHK Pune duplex (Phase D Layer-3 assembler)."""
    z_first_floor = floor_to_floor_m
    z_slab_first_bottom = floor_to_floor_m - _SLAB_THICKNESS_M
    z_slab_roof_top = 2.0 * floor_to_floor_m
    z_slab_roof_bottom = z_slab_roof_top - _SLAB_THICKNESS_M
    z_footing_top = -_FOUNDATION_TOP_DEPTH_M
    z_footing_bottom = z_footing_top - _FOOTING_THICKNESS_M
    z_column_top = z_slab_roof_top

    fu_gf = build_3bhk_pune_gf_floor_unit(
        storey_id="storey-ground",
        storey_index=0,
        name_prefix="gf",
        floor_slab_id="slab-ground",
        elevation=0.0,
        floor_height=floor_to_floor_m,
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        front_setback_m=_FRONT_SETBACK_M,
        rear_setback_m=_REAR_SETBACK_M,
        side_setback_m=_SIDE_SETBACK_M,
        door_to_stair_outside=True,
        stair_id="stair-gf-to-ff",
        has_stair=True,
    )
    fu_ff = build_3bhk_pune_ff_floor_unit(
        storey_id="storey-first",
        storey_index=1,
        name_prefix="ff",
        floor_slab_id="slab-first",
        elevation=z_first_floor,
        floor_height=floor_to_floor_m,
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        front_setback_m=_FRONT_SETBACK_M,
        rear_setback_m=_REAR_SETBACK_M,
        side_setback_m=_SIDE_SETBACK_M,
        has_balcony=True,
    )

    envelope_polygon = fu_gf.floor_footprint_polygon

    slab_roof = Slab(
        id="slab-roof",
        host_storey_id="storey-first",
        footprint_polygon=envelope_polygon,
        top_z=z_slab_roof_top,
        bottom_z=z_slab_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    x_axes_dict = dict(zip(_X_LABELS, fu_gf.column_grid_x))
    y_axes_dict = dict(zip(_Y_LABELS, fu_gf.column_grid_y))

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

    beams_l1 = make_orthogonal_beam_grid(
        columns_by_label=columns_by_label,
        x_labels_in_order=list(_X_LABELS),
        y_labels_in_order=list(_Y_LABELS),
        beam_top_z=z_slab_first_bottom,
        host_storey_id="storey-first",
        level_label="L1",
    )
    beams_l2 = make_orthogonal_beam_grid(
        columns_by_label=columns_by_label,
        x_labels_in_order=list(_X_LABELS),
        y_labels_in_order=list(_Y_LABELS),
        beam_top_z=z_slab_roof_bottom,
        host_storey_id="storey-first",
        level_label="L2",
    )
    all_beams = sorted(beams_l1 + beams_l2, key=lambda b: b.id)

    structural_system = StructuralSystem(
        id="structural-system-1",
        columns=columns,
        beams=all_beams,
        allows_slanted=False,
    )
    foundation = Foundation(id="foundation-1", footings=footings)
    roof = Roof(id="roof-1", type="flat")

    storey_ground = Storey(
        id="storey-ground",
        name="Ground Floor",
        elevation=0.0,
        actual_height=floor_to_floor_m,
        index=0,
        rooms=fu_gf.rooms,
        walls=fu_gf.walls,
        slabs=fu_gf.slabs,
        stairs=fu_gf.stairs,
        openings=fu_gf.openings,
    )
    storey_first = Storey(
        id="storey-first",
        name="First Floor",
        elevation=z_first_floor,
        actual_height=floor_to_floor_m,
        index=1,
        rooms=fu_ff.rooms,
        walls=fu_ff.walls,
        slabs=list(fu_ff.slabs) + [slab_roof],
        stairs=fu_ff.stairs,
        openings=fu_ff.openings,
    )

    all_doors = sorted(
        list(fu_gf.doors) + list(fu_ff.doors), key=lambda d: d.id
    )
    all_windows = sorted(
        list(fu_gf.windows) + list(fu_ff.windows), key=lambda w: w.id
    )

    building = Building(
        id="building-1",
        name="3BHK Pune Duplex",
        occupancy_nbc_group="A-2",
        envelope_polygon=envelope_polygon,
        structural_system=structural_system,
        mep_systems=[],
        storeys=[storey_ground, storey_first],
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
        fixture_match="tier2-3bhk-pune-v1",
        generated_at=generated_at,
        build_id=build_id,
        source_contract="BuildingModel",
    )
    rera = ReraData(
        seismic_zone=seismic_zone,
        wind_zone=wind_zone,
        nbc_occupancy_group="A-2",
    )
    metadata = ProjectMetadata(
        rera=rera,
        permits=[],
        cobie_defaults={},
        provenance=provenance,
    )
    project = Project(
        id="project-1",
        name="3BHK Pune Duplex Project",
        site=site,
        metadata=metadata,
    )

    return BuildingModel.build({"project": project.model_dump()})


def build_3bhk_pune_template(
    *,
    plot_width_m: float = 11.0,
    plot_length_m: float = 20.0,
    floor_to_floor_m: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-3bhk-pune-v1",
    generated_at: str = "2026-05-10T00:00:00Z",
) -> BuildingModel:
    """Backward-compatible alias for `build_3bhk_pune_duplex`."""
    return build_3bhk_pune_duplex(
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        floor_to_floor_m=floor_to_floor_m,
        seismic_zone=seismic_zone,
        wind_zone=wind_zone,
        build_id=build_id,
        generated_at=generated_at,
    )


__all__ = ["build_3bhk_pune_duplex", "build_3bhk_pune_template"]
