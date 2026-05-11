"""Phase T1.2 / T2.0 — 2BHK Pune duplex Tier-2 BuildingModel template.

Layer-3 building assembler for the duplex configuration of the 2BHK Pune
template. Composes one GF-style floor unit (kitchen / living / etc., with
stair) + one FF-style floor unit (bedrooms / baths / balcony) + foundation
+ continuous columns + per-ceiling beam grids + roof slab + provenance.

Slice T2.0 split this template into three layers:

  * Layer 1 (`_common.py`) — atomic helpers (walls, rooms, slabs, etc.).
  * Layer 2 (`_2bhk_pune_floor_unit.py`) — per-floor builders returning
    a `FloorUnit` for the GF-style and FF-style layouts.
  * Layer 3 (this module + future house/tower modules) — assemblers that
    stitch FloorUnits into a complete invariant-valid `BuildingModel`.

The duplex assembler is exposed as both `build_2bhk_pune_duplex` (the
canonical name added in T2.0) and `build_2bhk_pune_template` (the
T1.2 alias preserved for backward compatibility — every existing caller
keeps working). The two names produce byte-identical BuildingModels.

Architectural decisions (locked in Slice T1.1 + clarified during T1.2):

  * Setbacks: 0 side, 3 m front (north, road-facing), 1.5 m rear (south).
  * Foundation: isolated pad footings under each column, 1.5 m × 1.5 m,
    0.6 m thick, founding plane at z = -1.1 m.
  * Storey topology: 2 storeys above ground; roof is a flat slab on the
    upper storey.
  * Structural grid: 3 × 4 RCC column grid (12 columns), 0.300 × 0.300 m
    sections, M25 RCC, with X- and Y-direction beams between every
    adjacent column pair on each ceiling level.
  * Beam hosting: beams are hosted on the storey whose floor they support
    (matches the canonical test fixture). Both ceiling-of-GF and
    ceiling-of-FF beams host on `storey-first`.
  * MEP: deliberately empty (`mep_systems=[]`); Phase 5 populates.
  * Provenance stamps: `target_fidelity="LOD-300"`,
    `source_contract="BuildingModel"`,
    `input_contract_version="Tier2Template-1.0.0"`.

Determinism: same inputs → byte-identical output. No `random`, no
`datetime.now()`. The `generated_at` parameter must be supplied by callers
that need a wall-clock timestamp; the default is fixed for reproducibility.
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
from app.templates._2bhk_pune_floor_unit import (
    build_2bhk_pune_ff_floor_unit,
    build_2bhk_pune_gf_floor_unit,
)
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


# ─── Geometric constants used by the duplex assembler ────────────────
# Floor-unit-local constants live in `_2bhk_pune_floor_unit.py`. The
# constants below are the ones the assembler reads to position the
# foundation, columns, and roof — elements that span multiple floors.

_FRONT_SETBACK_M: float = 3.0
_REAR_SETBACK_M: float = 1.5
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.6
_FOUNDATION_TOP_DEPTH_M: float = 0.5

_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_Y_LABELS: tuple[str, ...] = ("1", "2", "3", "4")


def build_2bhk_pune_duplex(
    *,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    floor_to_floor_m: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-2bhk-pune-v1",
    generated_at: str = "2026-05-08T00:00:00Z",
) -> BuildingModel:
    """Build the 2BHK Pune duplex (Layer-3 assembler — Slice T2.0).

    Composition:
      * GF FloorUnit (kitchen / living / pooja / powder / utility / store /
        stair-foyer + stair to FF) at elevation = 0.
      * FF FloorUnit (common-bath / bedroom-2 / study / master-bath /
        master-bedroom / stair-landing / balcony-w / balcony-e) at
        elevation = floor_to_floor_m.
      * Foundation: 12 isolated pad footings under the column grid.
      * Columns: 12 RCC columns spanning -0.5 m → 2 × floor_to_floor_m.
      * Beams: 17 per ceiling level × 2 levels (= 34 beams), all hosted on
        storey-first.
      * Roof: flat slab at 2 × floor_to_floor_m, hosted on storey-first.

    Returns an invariant-valid `BuildingModel` ready for Phase 1 Pass 1
    placement + geometry resolution. Callers may scale plot dimensions
    and floor-to-floor height; internal proportions auto-recompute.

    Raises:
        ValueError: when the plot minus setbacks yields a buildable area
            below the layout's minimum (4.0 m × 5.0 m). The floor-unit
            module raises with a "buildable" diagnostic that includes
            the offending dimensions.
        BuildingModelValidationError: only if the template author got
            the geometry wrong. Caller-supplied parameters cannot trigger
            this; if they do, it's a template bug, not a caller bug.
    """
    # ─── Z-coordinates spanning multiple floors ──────────────────
    z_first_floor = floor_to_floor_m
    z_slab_first_bottom = floor_to_floor_m - _SLAB_THICKNESS_M
    z_slab_roof_top = 2.0 * floor_to_floor_m
    z_slab_roof_bottom = z_slab_roof_top - _SLAB_THICKNESS_M
    z_footing_top = -_FOUNDATION_TOP_DEPTH_M
    z_footing_bottom = z_footing_top - _FOOTING_THICKNESS_M
    z_column_top = z_slab_roof_top  # column extends to top of roof slab

    # ─── Layer-2: per-floor units (each does its own buildable-bounds
    # check; tiny-plot ValueError fires from the GF unit first) ──────
    fu_gf = build_2bhk_pune_gf_floor_unit(
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
        side_setback_m=0.0,
        door_to_stair_outside=True,
        stair_id="stair-gf-to-ff",
        has_stair=True,
    )
    fu_ff = build_2bhk_pune_ff_floor_unit(
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
        side_setback_m=0.0,
        has_balcony=True,
    )

    # Both floor units use the same buildable rectangle and column grid;
    # take them from the GF unit (single source of truth).
    envelope_polygon = fu_gf.floor_footprint_polygon

    # ─── Roof slab (assembler-owned, not floor-unit-owned) ───────
    slab_roof = Slab(
        id="slab-roof",
        host_storey_id="storey-first",
        footprint_polygon=envelope_polygon,
        top_z=z_slab_roof_top,
        bottom_z=z_slab_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    # ─── Structural grid: 12 columns + 12 footings ──────────────
    x_axes_dict: dict[str, float] = dict(zip(_X_LABELS, fu_gf.column_grid_x))
    y_axes_dict: dict[str, float] = dict(zip(_Y_LABELS, fu_gf.column_grid_y))

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

    # ─── Beams: 17/level × 2 levels = 34 ────────────────────────
    # Ceiling-of-GF beams sit at z_slab_first_bottom (bottom of FF slab).
    # Ceiling-of-FF beams sit at z_slab_roof_bottom (bottom of roof slab).
    # Both batches host on storey-first per the validator's convention
    # (beam hosted on the storey whose floor it supports).
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

    # ─── Storey assembly ────────────────────────────────────────
    # GF storey: per the floor unit (1 floor slab, walls, rooms, stair,
    # openings). FF storey: floor unit's slab + the roof slab tacked on.
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

    # Building-level doors / windows: combine across floors and sort.
    all_doors = sorted(
        list(fu_gf.doors) + list(fu_ff.doors), key=lambda d: d.id
    )
    all_windows = sorted(
        list(fu_gf.windows) + list(fu_ff.windows), key=lambda w: w.id
    )

    # ─── Building, Site, Project ────────────────────────────────
    building = Building(
        id="building-1",
        name="2BHK Pune Duplex",
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
        fixture_match="tier2-2bhk-pune-v1",
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
        name="2BHK Pune Duplex Project",
        site=site,
        metadata=metadata,
    )

    # `BuildingModel.build` runs the 12 invariants and unwraps any invariant
    # failure into the structured BuildingModelValidationError form.
    return BuildingModel.build({"project": project.model_dump()})


def build_2bhk_pune_template(
    *,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    floor_to_floor_m: float = 3.0,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-2bhk-pune-v1",
    generated_at: str = "2026-05-08T00:00:00Z",
) -> BuildingModel:
    """Backward-compatible alias for `build_2bhk_pune_duplex`.

    The Slice T1.2 public API stays valid — the same name returns the
    same BuildingModel byte-for-byte. Slice T2.0 added the canonical
    `build_2bhk_pune_duplex` to make the building-type explicit and to
    leave room for `build_2bhk_pune_house` (single storey) and
    `build_2bhk_pune_tower` (G+N apartment tower) under sibling names.
    """
    return build_2bhk_pune_duplex(
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        floor_to_floor_m=floor_to_floor_m,
        seismic_zone=seismic_zone,
        wind_zone=wind_zone,
        build_id=build_id,
        generated_at=generated_at,
    )


__all__ = ["build_2bhk_pune_duplex", "build_2bhk_pune_template"]
