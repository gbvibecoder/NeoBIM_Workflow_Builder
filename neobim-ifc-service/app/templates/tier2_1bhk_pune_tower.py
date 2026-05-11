"""Phase T2.1 Phase E — 1BHK Pune apartment-tower assembler.

Layer-3 building assembler that composes:

  * 1 stilt parking floor (optional, default True) at elevation 0,
    with a parking IfcSpace, perimeter screen walls, and the side-core
    starting from the ground for fire egress.
  * N habitable floors (default 5), each one self-contained 1BHK
    FLAT FloorUnit (Phase B) with the side-core glued on the east edge.
  * 1 flat roof slab on top.
  * Continuous RCC columns (230×230mm) spanning -0.5m → top of roof.
  * Per-ceiling-level RCC beam grids.
  * Isolated pad foundations (one per column, 1.2 × 1.2 × 0.5m).

Reuses `make_2bhk_pune_tower_core()` — the side-core (lobby + stair +
lift) is BHK-agnostic and the same 2-zone layout serves 1BHK flats
just as well. The flat's east wall id contract (`-E-s` for habitable
storeys, `-E` for stilt) is identical to the 2BHK FLAT, so the core's
west-bound substitution works without modification.

Element scaling (default 7.32 × 12.20 plot, has_stilt_parking=True):

   habitable_floor_count │ storeys │ walls │ rooms │ doors │ stairs
                       5 │      6  │   85  │   44  │   37  │     5
                      11 │     12  │  175  │   92  │   79  │    11

Storey continuity holds at variable heights (2.7m stilt + 3.0m habitable).

Documented limitations (defer to follow-up slices):
  * Isolated pad foundations are unrealistic for G+11+. Phase 4 adds
    raft / pile alternatives.
  * No `IfcMappedItem` geometry reuse — every floor's walls/rooms get
    their own geometry. File size grows linearly.
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
from app.templates._1bhk_pune_flat_floor_unit import (
    build_1bhk_pune_flat_floor_unit,
)
from app.templates._1bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    make_1bhk_grid_columns_and_footings,
)
from app.templates._2bhk_pune_floor_unit import _perimeter_walls
from app.templates._2bhk_pune_tower_core import make_2bhk_pune_tower_core
from app.templates._common import (
    make_axis_aligned_room,
    make_door_pair,
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_rectangular_polygon_ccw,
    make_roof_slab_layers,
    make_slab_layers,
)


# ─── Constants ──────────────────────────────────────────────────────

_FRONT_SETBACK_M: float = 2.5
_REAR_SETBACK_M: float = 1.5
_SIDE_SETBACK_M: float = 0.0
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.5
_FOUNDATION_TOP_DEPTH_M: float = 0.5
_COLUMN_SIZE_M: float = 0.230  # 1BHK column size

_CORE_WIDTH_M: float = 3.0

# Flat column-grid labels (3 × 3 = 9 columns).
_FLAT_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_FLAT_Y_LABELS: tuple[str, ...] = ("1", "2", "3")

# Core column labels (2 × 2 grid at the core's outer corners). Use
# "1"/"3" to match the flat's southernmost / northernmost Y axes
# (so flat south column and core south column align in plan).
_CORE_X_LABELS: tuple[str, ...] = ("CW", "CE")
_CORE_Y_LABELS: tuple[str, ...] = ("1", "3")

_HALF_EXT_WALL: float = 0.250 / 2.0


def build_1bhk_pune_tower(
    *,
    habitable_floor_count: int = 5,
    has_stilt_parking: bool = True,
    flats_per_floor: Literal[1] = 1,
    plot_width_m: float = 7.32,
    plot_length_m: float = 12.20,
    floor_height: float = 3.0,
    stilt_height: float = 2.7,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-1bhk-pune-tower-v1",
    generated_at: str = "2026-05-10T00:00:00Z",
) -> BuildingModel:
    """Build a G+N 1BHK apartment tower (Phase E).

    Parameters mirror the 2BHK tower assembler. Default plot
    7.32 × 12.20 yields buildable depth 8.20m — just above the
    side-core's `_MIN_CORE_DEPTH_M=8.0` threshold; smaller plot
    lengths will raise from `make_2bhk_pune_tower_core`.

    Raises:
        NotImplementedError: when flats_per_floor != 1 (v2 territory).
        ValueError: habitable_floor_count < 1, plot too small for
            the FLAT layout, or buildable depth < 8.0m for the core.
    """
    if flats_per_floor != 1:
        raise NotImplementedError(
            f"build_1bhk_pune_tower v1 supports only flats_per_floor=1; "
            f"got {flats_per_floor}. Mirrored side-by-side units are v2."
        )
    if habitable_floor_count < 1:
        raise ValueError(
            f"habitable_floor_count must be >= 1; got {habitable_floor_count}"
        )

    # ─── Storey topology ───────────────────────────────────────────
    storey_meta: list[tuple[int, str, float, float, bool]] = []
    z_running = 0.0
    idx = 0
    if has_stilt_parking:
        storey_meta.append((idx, f"storey-s{idx}", z_running, stilt_height, False))
        z_running += stilt_height
        idx += 1
    for _ in range(habitable_floor_count):
        storey_meta.append((idx, f"storey-s{idx}", z_running, floor_height, True))
        z_running += floor_height
        idx += 1
    total_storeys = len(storey_meta)
    z_top_of_building = z_running
    z_roof_top = z_top_of_building
    z_roof_bottom = z_top_of_building - _SLAB_THICKNESS_M

    # ─── Building footprint (flat + core combined) ────────────────
    buildable_y_min = _REAR_SETBACK_M
    buildable_y_max = plot_length_m - _FRONT_SETBACK_M
    flat_x_min = _SIDE_SETBACK_M
    flat_x_max = plot_width_m - _SIDE_SETBACK_M
    core_x_min = flat_x_max
    core_x_max = core_x_min + _CORE_WIDTH_M
    combined_envelope = make_rectangular_polygon_ccw(
        flat_x_min, core_x_max, buildable_y_min, buildable_y_max
    )

    # ─── Core configuration ───────────────────────────────────────
    is_habitable_by_idx = {idx: is_hab for idx, _, _, _, is_hab in storey_meta}

    def flat_east_id(storey_idx: int) -> str:
        if is_habitable_by_idx.get(storey_idx, False):
            return f"wall-flat-s{storey_idx}-E-s"
        return f"wall-flat-s{storey_idx}-E"

    core = make_2bhk_pune_tower_core(
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        front_setback_m=_FRONT_SETBACK_M,
        rear_setback_m=_REAR_SETBACK_M,
        side_setback_m=_SIDE_SETBACK_M,
        core_width_m=_CORE_WIDTH_M,
        name_prefix="core",
        flat_east_wall_id_per_storey=flat_east_id,
    )

    # ─── Per-storey assembly ──────────────────────────────────────
    storeys: list[Storey] = []
    all_doors: list = []
    all_windows: list = []
    flat_column_grid_x: list[float] | None = None
    flat_column_grid_y: list[float] | None = None

    for s_idx, s_id, s_elev, s_h, is_hab in storey_meta:
        s_top = s_elev + s_h
        z_wall_top = s_top - _SLAB_THICKNESS_M
        s_walls: list = []
        s_rooms: list = []
        s_slabs: list = []
        s_openings: list = []

        if is_hab:
            fu = build_1bhk_pune_flat_floor_unit(
                storey_id=s_id,
                storey_index=s_idx,
                name_prefix=f"flat-s{s_idx}",
                floor_slab_id=f"slab-flat-s{s_idx}-floor-discarded",
                elevation=s_elev,
                floor_height=s_h,
                plot_width_m=plot_width_m,
                plot_length_m=plot_length_m,
                front_setback_m=_FRONT_SETBACK_M,
                rear_setback_m=_REAR_SETBACK_M,
                side_setback_m=_SIDE_SETBACK_M,
                door_to_stair_outside=False,  # use lobby sentinel
                has_balcony=True,
            )
            if flat_column_grid_x is None:
                flat_column_grid_x = list(fu.column_grid_x)
                flat_column_grid_y = list(fu.column_grid_y)
            s_walls.extend(fu.walls)
            s_rooms.extend(fu.rooms)
            s_openings.extend(fu.openings)

            lobby_id = f"room-core-s{s_idx}-lobby"
            for d in fu.doors:
                if TOWER_CORE_LOBBY_SENTINEL in d.connects_room_ids:
                    new_conn = [
                        (lobby_id if rid == TOWER_CORE_LOBBY_SENTINEL else rid)
                        for rid in d.connects_room_ids
                    ]
                    all_doors.append(d.model_copy(update={"connects_room_ids": new_conn}))
                else:
                    all_doors.append(d)
            all_windows.extend(fu.windows)
        else:
            sw = Vec2(x=flat_x_min, y=buildable_y_min)
            se = Vec2(x=flat_x_max, y=buildable_y_min)
            ne = Vec2(x=flat_x_max, y=buildable_y_max)
            nw = Vec2(x=flat_x_min, y=buildable_y_max)
            stilt_perimeter = _perimeter_walls(
                name_prefix=f"flat-s{s_idx}",
                storey_id=s_id,
                base_z=s_elev,
                top_z=z_wall_top,
                sw=sw, se=se, ne=ne, nw=nw,
            )
            s_walls.extend(stilt_perimeter)

            parking_room = make_axis_aligned_room(
                room_id=f"room-flat-s{s_idx}-parking",
                name=f"Stilt Parking - s{s_idx}",
                usage="parking",
                xmin=flat_x_min + _HALF_EXT_WALL,
                xmax=flat_x_max - _HALF_EXT_WALL,
                ymin=buildable_y_min + _HALF_EXT_WALL,
                ymax=buildable_y_max - _HALF_EXT_WALL,
                south_wall=(f"wall-flat-s{s_idx}-S", "left"),
                east_wall=(f"wall-flat-s{s_idx}-E", "left"),
                north_wall=(f"wall-flat-s{s_idx}-N", "left"),
                west_wall=(f"wall-flat-s{s_idx}-W", "left"),
            )
            s_rooms.append(parking_room)

        # Add core walls + rooms to this storey.
        core_walls = core.core_walls_per_floor(s_idx, s_id, s_elev, z_wall_top)
        core_rooms = core.core_rooms_per_floor(s_idx, s_id)
        s_walls.extend(core_walls)
        s_rooms.extend(core_rooms)

        # 2-zone core means 2 doors per floor on `ph-lobby-north`:
        # lobby↔stair (west half) and lobby↔lift (east half).
        ph_lobby_north_id = f"wall-core-s{s_idx}-ph-lobby-north"
        stair_door_dist = _CORE_WIDTH_M * 0.5 / 2.0 - 0.45
        lift_door_dist = (_CORE_WIDTH_M * 0.5) + (_CORE_WIDTH_M * 0.5) / 2.0 - 0.45
        core_door_specs = [
            (
                f"door-core-s{s_idx}-lobby-stair",
                f"opening-core-s{s_idx}-d01",
                ph_lobby_north_id,
                stair_door_dist,
                0.9, 2.1, "inward", "right",
                [f"room-core-s{s_idx}-lobby", f"room-core-s{s_idx}-stair"],
            ),
            (
                f"door-core-s{s_idx}-lobby-lift",
                f"opening-core-s{s_idx}-d02",
                ph_lobby_north_id,
                lift_door_dist,
                0.9, 2.1, "inward", "right",
                [f"room-core-s{s_idx}-lobby", f"room-core-s{s_idx}-lift"],
            ),
        ]
        for did, opid, wid, dist, w, h, swing, hand, conn in core_door_specs:
            op, dr = make_door_pair(
                door_id=did, opening_id=opid, wall_id=wid,
                distance_along_wall=dist, width=w, height=h,
                floor_z=s_elev, swing=swing, handedness=hand,
                connects_room_ids=conn,
            )
            s_openings.append(op)
            all_doors.append(dr)

        # Combined floor slab spanning flat + core (one FLOOR per storey).
        s_slabs.append(
            Slab(
                id=f"slab-s{s_idx}-floor",
                host_storey_id=s_id,
                footprint_polygon=make_rectangular_polygon_ccw(
                    flat_x_min, core_x_max, buildable_y_min, buildable_y_max
                ),
                top_z=s_elev,
                bottom_z=s_elev - _SLAB_THICKNESS_M,
                layers=make_slab_layers(),
                predefined_type="FLOOR",
            )
        )

        # Stair from this storey UP to the next (only if there is one).
        s_stairs: list = []
        if s_idx < total_storeys - 1:
            next_meta = storey_meta[s_idx + 1]
            slab_below_top = s_elev
            slab_above_bottom = next_meta[2] - _SLAB_THICKNESS_M
            s_stairs.append(
                core.stair_per_floor(
                    s_idx, s_id, slab_below_top, slab_above_bottom
                )
            )

        storeys.append(
            Storey(
                id=s_id,
                name=f"Storey {s_idx}" + (" (Stilt)" if not is_hab else ""),
                elevation=s_elev,
                actual_height=s_h,
                index=s_idx,
                rooms=sorted(s_rooms, key=lambda r: r.id),
                walls=sorted(s_walls, key=lambda w: w.id),
                slabs=sorted(s_slabs, key=lambda s: s.id),
                stairs=s_stairs,
                openings=sorted(s_openings, key=lambda o: o.id),
            )
        )

    # ─── Roof slab (combined flat + core) on top storey ──────────
    top_storey = storeys[-1]
    roof_slab = Slab(
        id="slab-roof",
        host_storey_id=top_storey.id,
        footprint_polygon=combined_envelope,
        top_z=z_roof_top,
        bottom_z=z_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )
    storeys[-1] = top_storey.model_copy(
        update={
            "slabs": sorted(
                list(top_storey.slabs) + [roof_slab],
                key=lambda s: s.id,
            ),
        }
    )

    # ─── Foundation + columns (continuous, span -0.5 → roof top) ──
    z_footing_top = -_FOUNDATION_TOP_DEPTH_M
    z_footing_bottom = z_footing_top - _FOOTING_THICKNESS_M
    z_column_top = z_roof_top

    if flat_column_grid_x is None or flat_column_grid_y is None:
        raise RuntimeError(
            "1BHK tower has no habitable storeys — column grid uninitialised"
        )
    flat_x_dict: dict[str, float] = dict(zip(_FLAT_X_LABELS, flat_column_grid_x))
    flat_y_dict: dict[str, float] = dict(zip(_FLAT_Y_LABELS, flat_column_grid_y))

    # Core column grid (2×2 at corners of the core).
    core_x_dict: dict[str, float] = {
        "CW": core_x_min + _COLUMN_SIZE_M / 2.0,
        "CE": core_x_max - _COLUMN_SIZE_M / 2.0,
    }
    core_y_dict: dict[str, float] = {
        "1": buildable_y_min + _COLUMN_SIZE_M / 2.0,
        "3": buildable_y_max - _COLUMN_SIZE_M / 2.0,
    }

    flat_columns, flat_footings = make_1bhk_grid_columns_and_footings(
        x_axes=flat_x_dict, y_axes=flat_y_dict,
        column_base_z=z_footing_top, column_top_z=z_column_top,
        footing_top_z=z_footing_top, footing_bottom_z=z_footing_bottom,
        host_storey_id=storey_meta[0][1],
    )
    # Core columns also use 230mm sections (matches 1BHK column size).
    core_columns, core_footings = make_1bhk_grid_columns_and_footings(
        x_axes=core_x_dict, y_axes=core_y_dict,
        column_base_z=z_footing_top, column_top_z=z_column_top,
        footing_top_z=z_footing_top, footing_bottom_z=z_footing_bottom,
        host_storey_id=storey_meta[0][1],
    )
    all_columns = sorted(flat_columns + core_columns, key=lambda c: c.id)
    all_footings = sorted(flat_footings + core_footings, key=lambda f: f.id)

    # ─── Beams: per-ceiling-level grid for flat + core ────────────
    flat_cols_by_label = {c.id.removeprefix("col-"): c for c in flat_columns}
    core_cols_by_label = {c.id.removeprefix("col-"): c for c in core_columns}

    all_beams: list = []
    for s_idx, s_id, s_elev, s_h, _is_hab in storey_meta:
        if s_idx < total_storeys - 1:
            next_meta = storey_meta[s_idx + 1]
            ceiling_top_z = next_meta[2] - _SLAB_THICKNESS_M
            host_id = next_meta[1]
            level_label = f"L{s_idx + 1}-FLOOR"
        else:
            ceiling_top_z = z_roof_bottom
            host_id = s_id
            level_label = f"L{s_idx + 1}-ROOF"

        flat_beams = make_orthogonal_beam_grid(
            columns_by_label=flat_cols_by_label,
            x_labels_in_order=list(_FLAT_X_LABELS),
            y_labels_in_order=list(_FLAT_Y_LABELS),
            beam_top_z=ceiling_top_z,
            host_storey_id=host_id,
            level_label=level_label + "-FLAT",
        )
        core_beams = make_orthogonal_beam_grid(
            columns_by_label=core_cols_by_label,
            x_labels_in_order=list(_CORE_X_LABELS),
            y_labels_in_order=list(_CORE_Y_LABELS),
            beam_top_z=ceiling_top_z,
            host_storey_id=host_id,
            level_label=level_label + "-CORE",
        )
        all_beams.extend(flat_beams)
        all_beams.extend(core_beams)

    all_beams.sort(key=lambda b: b.id)

    structural_system = StructuralSystem(
        id="structural-system-1",
        columns=all_columns,
        beams=all_beams,
        allows_slanted=False,
    )
    foundation = Foundation(id="foundation-1", footings=all_footings)
    roof = Roof(id="roof-1", type="flat")

    building = Building(
        id="building-1",
        name=f"1BHK Pune Tower G+{habitable_floor_count}",
        occupancy_nbc_group="A-4",
        envelope_polygon=combined_envelope,
        structural_system=structural_system,
        mep_systems=[],
        storeys=storeys,
        foundation=foundation,
        roof=roof,
        doors=sorted(all_doors, key=lambda d: d.id),
        windows=sorted(all_windows, key=lambda w: w.id),
    )
    # Slice 2B.3 — plot_polygon intentionally left empty.
    # The tower's combined_envelope spans flat_x_min .. core_x_max where
    # core_x_max = plot_width_m + _CORE_WIDTH_M, exceeding plot_width_m.
    # Defining a plot_polygon = [(0,0),(plot_width_m, 0),...] would
    # violate PLOT_POLYGON_VALID's containment sub-rule. Tower-plot
    # semantics (the actual legal plot exceeds the flat unit's
    # plot_width_m) are deferred to a future slice; until then, the
    # invariant skips on empty plot_polygon and the 2B.3 extension
    # planner refuses non-mumty extensions for tower templates.
    site = Site(
        id="site-1",
        name="Pune Tower Plot",
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
        fixture_match=f"tier2-1bhk-pune-tower-g{habitable_floor_count}",
        generated_at=generated_at,
        build_id=build_id,
        source_contract="BuildingModel",
    )
    rera = ReraData(
        seismic_zone=seismic_zone,
        wind_zone=wind_zone,
        nbc_occupancy_group="A-4",
    )
    metadata = ProjectMetadata(
        rera=rera,
        permits=[],
        cobie_defaults={},
        provenance=provenance,
    )
    project = Project(
        id="project-1",
        name=f"1BHK Pune Tower Project (G+{habitable_floor_count})",
        site=site,
        metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


__all__ = ["build_1bhk_pune_tower"]
