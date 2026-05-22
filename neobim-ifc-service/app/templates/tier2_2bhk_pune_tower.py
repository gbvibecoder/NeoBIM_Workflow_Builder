"""Slice T2.0 Phase E2+E3 — 2BHK Pune apartment-tower assembler.

Layer-3 building assembler that composes:

  * 1 stilt parking floor (optional, default True) at elevation 0,
    with a parking IfcSpace, perimeter screen walls, and the side-core
    starting from the ground for fire egress.
  * N habitable floors (default 5), each one self-contained 2BHK
    FLAT FloorUnit (Phase E0) with the side-core (Phase E1) glued on
    the east edge.
  * 1 flat roof slab on top.
  * Continuous RCC columns spanning -0.5 m → top of roof.
  * Per-ceiling-level RCC beam grids (~21 beams × ceiling level).
  * Isolated pad foundations (one per column) — Phase 4 will upgrade
    to raft / pile when realistic structural engineering is in scope.

Element scaling (default 7.32 × 15.24 plot, has_stilt_parking=True):

   habitable_floor_count │ storeys │ walls │ rooms │ doors │ stairs │ beams
                       5 │      6  │   94  │   34  │   40  │     5  │  126
                      11 │     12  │  196  │   70  │   88  │    11  │  252
                      23 │     24  │  400  │  142  │  184  │    23  │  504

(Counts computed in Phase E2 smoke; revise if invariant-pruning fires
on any node.)

Phase 1 builder behaviour at scale (Phase E3 explicit verification):

  * Column extrusion height = 17.7 m (G+5), 35.7 m (G+11), 71.7 m (G+23).
    geometry_resolver currently uses IfcExtrudedAreaSolid which has no
    practical upper height limit in IfcOpenShell — verified at G+23.
  * Pass-1 RESOLVE walks every node sorted by id; with G+23 producing
    ~1100 placements, runtime is < 1 s.

Documented limitations (defer to follow-up slices, NOT Phase E):
  * Isolated pad foundations are unrealistic for G+11+. Phase 4 adds
    raft / pile alternatives.
  * No `IfcMappedItem` geometry reuse — every floor's walls/rooms get
    their own geometry. File size grows linearly. Add Phase 1 polish
    slice if G+23 IFC > 10 MB after export.
  * Lift shaft modelled as one IfcSpace per floor (no per-floor cab).
    Real lift modelling lives in MEP / vertical-transport phase.
"""

from __future__ import annotations

from typing import Literal

from app.domain.building_model import (
    Building,
    BuildingModel,
    Door,
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
from app.templates._2bhk_pune_flat_floor_unit import (
    build_2bhk_pune_flat_floor_unit,
)
from app.templates._2bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
)
from app.templates._2bhk_pune_tower_core import make_2bhk_pune_tower_core
from app.templates._common import (
    _perimeter_walls,
    make_axis_aligned_room,
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_rectangular_polygon_ccw,
    make_roof_slab_layers,
    make_slab_layers,
)


# ─── Constants ──────────────────────────────────────────────────────

_FRONT_SETBACK_M: float = 3.0
_REAR_SETBACK_M: float = 1.5
_SIDE_SETBACK_M: float = 0.0
_SLAB_THICKNESS_M: float = 0.150
_FOOTING_THICKNESS_M: float = 0.6
_FOUNDATION_TOP_DEPTH_M: float = 0.5
_COLUMN_SIZE_M: float = 0.300

_CORE_WIDTH_M: float = 3.0

# Flat column-grid labels reused per storey.
_FLAT_X_LABELS: tuple[str, ...] = ("A", "B", "C")
_FLAT_Y_LABELS: tuple[str, ...] = ("1", "2", "3", "4")

# Core column labels (2 × 2 grid at the core corners).
_CORE_X_LABELS: tuple[str, ...] = ("CW", "CE")
_CORE_Y_LABELS: tuple[str, ...] = ("1", "4")

_HALF_EXT_WALL: float = 0.250 / 2.0


def build_2bhk_pune_tower(
    *,
    habitable_floor_count: int = 5,
    has_stilt_parking: bool = True,
    flats_per_floor: Literal[1] = 1,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    floor_height: float = 3.0,
    stilt_height: float = 2.7,
    seismic_zone: Literal["II", "III", "IV", "V"] = "III",
    wind_zone: int = 2,
    build_id: str = "tier2-2bhk-pune-tower-v1",
    generated_at: str = "2026-05-10T00:00:00Z",
) -> BuildingModel:
    """Build a G+N apartment tower (Slice T2.0 Phase E2 / E3).

    Returns an invariant-valid `BuildingModel` for an N-storey apartment
    tower with optional stilt parking and a side-core (lift + fire stair
    + lobby) east of each flat.

    Parameters:
        habitable_floor_count: number of 2BHK floors above stilt
            (typical: 5 / 11 / 23). Each floor is one self-contained
            2BHK FLAT FloorUnit.
        has_stilt_parking: when True (default), storey 0 is a 2.7 m
            stilt floor with parking + the side-core starting from
            ground (so the fire stair and lift terminate at parking
            level). When False, storey 0 IS the first habitable floor.
        flats_per_floor: only `1` supported in v1.
        plot_width_m: flat plot width. Building width = plot_width_m +
            core_width (3.0 m by default — the side-core sits east of
            this).
        floor_height: habitable storey height (default 3.0 m).
        stilt_height: stilt storey height (default 2.7 m, NBC minimum
            for parking clearance).
        seismic_zone, wind_zone: Pune defaults III / 2.
        build_id, generated_at: provenance fields.

    Raises:
        NotImplementedError: when flats_per_floor != 1 (v2 territory).
        ValueError: when habitable_floor_count < 1, or plot dimensions
            are too small for the FLAT layout, or buildable depth is
            too shallow for the side-core stack.
    """
    if flats_per_floor != 1:
        raise NotImplementedError(
            f"build_2bhk_pune_tower v1 supports only flats_per_floor=1; "
            f"got {flats_per_floor}. Mirrored side-by-side units are v2."
        )
    if habitable_floor_count < 1:
        raise ValueError(
            f"habitable_floor_count must be >= 1; got {habitable_floor_count}"
        )

    # ─── Storey topology ───────────────────────────────────────────
    # Each tuple: (storey_idx, storey_id, elevation, height, is_habitable)
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
    # Per-storey-aware mapping. Slice T2.0.1: when the storey is
    # habitable (uses the FLAT unit with has_balcony=True), the FLAT's
    # east perimeter is SPLIT at y=y_p110 into E-s (south, full-height)
    # and E-n (north, parapet height for the balcony). The core's
    # lobby / lift / stair-shaft sit south of y_p110 (lobby + lift) or
    # straddle it (stair-shaft); using E-s as the west bound is correct
    # for all three because the corner resolver extends the axis line
    # infinitely to find corners. Stilt floors emit a standard
    # 4-perimeter (no split), so they use the unsplit `wall-flat-s0-E`.
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

        # Floor slab + walls + rooms — habitable uses FLAT unit, stilt
        # uses bare perimeter + parking room.
        if is_hab:
            # FLAT unit emits its own floor slab (`slab-flat-s{idx}-floor`),
            # which we DON'T add to the storey — STAIR_RISE_MATCHES requires
            # exactly one FLOOR slab per storey, and the assembler emits a
            # combined slab spanning flat + core below. We discard the
            # FLAT-only slab and keep only the unit's walls/rooms/openings.
            fu = build_2bhk_pune_flat_floor_unit(
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
                door_to_stair_outside=False,  # use TOWER_CORE_LOBBY sentinel
                has_balcony=True,
            )
            if flat_column_grid_x is None:
                flat_column_grid_x = list(fu.column_grid_x)
                flat_column_grid_y = list(fu.column_grid_y)
            s_walls.extend(fu.walls)
            s_rooms.extend(fu.rooms)
            # Note: fu.slabs is intentionally NOT extended — we use a
            # combined slab below.
            s_openings.extend(fu.openings)

            # Substitute the lobby sentinel in the flat's main entry door.
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
            # Stilt: 4 flat-region perimeter walls + 1 parking room +
            # 1 floor slab. No internal partitions, no openings, no
            # windows, no doors. (The tower's vertical circulation —
            # stairs from stilt up to floor 1 — comes from the core.)
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

            # Parking room — full flat-region footprint, bounded by
            # the 4 stilt perimeter walls (CCW with parking on left).
            parking_polygon = make_rectangular_polygon_ccw(
                flat_x_min + _HALF_EXT_WALL,
                flat_x_max - _HALF_EXT_WALL,
                buildable_y_min + _HALF_EXT_WALL,
                buildable_y_max - _HALF_EXT_WALL,
            )
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

        # Add core walls + rooms + (optionally) stair to this storey.
        core_walls = core.core_walls_per_floor(s_idx, s_id, s_elev, z_wall_top)
        core_rooms = core.core_rooms_per_floor(s_idx, s_id)
        s_walls.extend(core_walls)
        s_rooms.extend(core_rooms)

        # Slice T2.0.3 — 2-zone core layout means 2 doors per floor on
        # the SAME partition wall (`ph-lobby-north`):
        #   * lobby ↔ stair (door in west half — stair occupies west
        #     half of the north zone)
        #   * lobby ↔ lift  (door in east half)
        # Both doors face SOUTH (toward the lobby) because both stair
        # and lift sit NORTH of the partition. Real Indian apartment
        # circulation: enter lobby → pick stair OR lift directly.
        from app.templates._common import make_door_pair as _mdp
        ph_lobby_north_id = f"wall-core-s{s_idx}-ph-lobby-north"
        # Stair occupies west 50 % of core (x in [0, 1.5] of core_width=3 m).
        # Center the stair-access door in that west half: x_center = 0.75 m.
        # Door 0.9 m wide → distance_along_wall = 0.75 - 0.45 = 0.30.
        stair_door_dist = _CORE_WIDTH_M * 0.5 / 2.0 - 0.45
        # Lift occupies east 50 % (x in [1.5, 3.0]). Center = 2.25.
        # distance = 2.25 - 0.45 = 1.80.
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
            op, dr = _mdp(
                door_id=did, opening_id=opid, wall_id=wid,
                distance_along_wall=dist, width=w, height=h,
                floor_z=s_elev, swing=swing, handedness=hand,
                connects_room_ids=conn,
            )
            s_openings.append(op)
            all_doors.append(dr)

        # Combined floor slab spanning flat + core (single FLOOR per
        # storey so STAIR_RISE_MATCHES can pick it unambiguously). The
        # combined footprint is still a clean rectangle since flat and
        # core are contiguous (flat at x∈[0, plot_w], core at
        # x∈[plot_w, plot_w + 3.0]).
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

        # Build the Storey, sorting deterministically.
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
    # One ROOF slab for the same reason as the floor slabs — keep
    # exactly one FLOOR + one ROOF per storey.
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

    # Flat column grid
    if flat_column_grid_x is None or flat_column_grid_y is None:
        # Tower with stilt-only (habitable_floor_count=0, but we already
        # rejected that). This branch is defensive.
        raise RuntimeError(
            "tower has no habitable storeys — column grid uninitialised"
        )
    flat_x_dict: dict[str, float] = dict(zip(_FLAT_X_LABELS, flat_column_grid_x))
    flat_y_dict: dict[str, float] = dict(zip(_FLAT_Y_LABELS, flat_column_grid_y))

    # Core column grid (2x2 at corners of the core).
    core_x_dict: dict[str, float] = {
        "CW": core_x_min + _COLUMN_SIZE_M / 2.0,
        "CE": core_x_max - _COLUMN_SIZE_M / 2.0,
    }
    core_y_dict: dict[str, float] = {
        "1": buildable_y_min + _COLUMN_SIZE_M / 2.0,
        "4": buildable_y_max - _COLUMN_SIZE_M / 2.0,
    }

    flat_columns, flat_footings = make_rcc_grid_columns_and_footings(
        x_axes=flat_x_dict, y_axes=flat_y_dict,
        column_base_z=z_footing_top, column_top_z=z_column_top,
        footing_top_z=z_footing_top, footing_bottom_z=z_footing_bottom,
        host_storey_id=storey_meta[0][1],
    )
    core_columns, core_footings = make_rcc_grid_columns_and_footings(
        x_axes=core_x_dict, y_axes=core_y_dict,
        column_base_z=z_footing_top, column_top_z=z_column_top,
        footing_top_z=z_footing_top, footing_bottom_z=z_footing_bottom,
        host_storey_id=storey_meta[0][1],
    )
    # Re-id core columns + footings so flat/core ids don't collide.
    # (Flat uses col-A1, ..., col-C4; core also produces col-CW1, etc.,
    # which already don't collide thanks to distinct labels.)
    all_columns = sorted(flat_columns + core_columns, key=lambda c: c.id)
    all_footings = sorted(flat_footings + core_footings, key=lambda f: f.id)

    # ─── Beams: per-ceiling-level grid for flat + core ────────────
    # Beams host on the storey whose floor they support (= the upper
    # storey of each pair). For ceiling above the topmost storey
    # (supporting the roof slab), beams host on the topmost storey.
    flat_cols_by_label = {c.id.removeprefix("col-"): c for c in flat_columns}
    core_cols_by_label = {c.id.removeprefix("col-"): c for c in core_columns}

    all_beams: list = []
    for ci, (s_idx, s_id, s_elev, s_h, _is_hab) in enumerate(storey_meta):
        # Ceiling level above this storey:
        #   - For non-top storeys: the ceiling is the bottom of the
        #     next storey's floor slab.
        #   - For top storey: the ceiling is the bottom of the roof slab.
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

    # ─── Building, Site, Project ──────────────────────────────────
    building = Building(
        id="building-1",
        name=f"2BHK Pune Tower G+{habitable_floor_count}",
        occupancy_nbc_group="A-4",  # NBC: residential apartment
        envelope_polygon=combined_envelope,
        structural_system=structural_system,
        mep_systems=[],
        storeys=storeys,
        foundation=foundation,
        roof=roof,
        doors=sorted(all_doors, key=lambda d: d.id),
        windows=sorted(all_windows, key=lambda w: w.id),
    )
    # Slice 2B.3 — plot_polygon intentionally left empty (see
    # tier2_1bhk_pune_tower.py for the full rationale: tower's
    # combined_envelope exceeds plot_width_m due to the lift/stair core,
    # so tower-plot semantics need a follow-up slice).
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
        fixture_match=f"tier2-2bhk-pune-tower-g{habitable_floor_count}",
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
        name=f"2BHK Pune Tower Project (G+{habitable_floor_count})",
        site=site,
        metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


__all__ = ["build_2bhk_pune_tower"]
