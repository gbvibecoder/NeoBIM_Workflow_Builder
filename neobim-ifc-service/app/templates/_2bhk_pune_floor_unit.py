"""Phase T2.0 — Layer 2 floor-unit builders for the 2BHK Pune template.

Two functions, one per architectural layout type, both returning a
`FloorUnit` (the Layer-2 dataclass defined in `_common.py`):

  * `build_2bhk_pune_gf_floor_unit` — kitchen / living-dining / pooja /
    powder / utility / store / stair-foyer (7 rooms, optional stair down,
    no balcony). Mirrors the current duplex's GROUND floor.

  * `build_2bhk_pune_ff_floor_unit` — common-bath / bedroom-2 / study /
    master-bath / master-bedroom / stair-landing / balcony-w / balcony-e
    (8 rooms, no stair, balcony optional). Mirrors the current duplex's
    FIRST floor.

Both functions take parameters (`storey_id`, `name_prefix`, `floor_slab_id`,
`elevation`, `floor_height`, plot dimensions, `door_to_stair_outside`)
that let Layer-3 assemblers stitch them into different building types:

  * `build_2bhk_pune_duplex` — calls gf once at z=0, ff once at z=3.
  * `build_2bhk_pune_house` (single-storey bungalow) — calls gf once at z=0
    with `has_stair=False` (well, the gf function always emits stair when
    invoked; the bungalow assembler will skip the stair if not needed).
  * `build_2bhk_pune_tower` — TBD (Phase E); may stack gf+ff per flat or
    introduce a new single-flat layout.

Z-coordinate discipline: every wall, opening, sill Z is `elevation + offset`
(or `elevation - offset`). No literal `0.000` or `3.000` Z values in this
module. ID discipline: every wall, room, opening, door, window, slab, stair
ID interpolates `name_prefix` into a documented pattern.

Backward-compat naming for the duplex assembler (Phase C):
  * Duplex GF passes name_prefix="gf", floor_slab_id="slab-ground",
    storey_id="storey-ground", stair_id="stair-gf-to-ff".
  * Duplex FF passes name_prefix="ff", floor_slab_id="slab-first",
    storey_id="storey-first".
"""

from __future__ import annotations

from typing import Literal

from app.domain.building_model import (
    Slab,
    Stair,
    Vec2,
)
from app.templates._common import (
    FloorUnit,
    _perimeter_walls,
    column_grid_axes,
    compute_buildable_bounds,
    make_axis_aligned_room,
    make_door_pair,
    make_internal_wall,
    make_rectangular_polygon_ccw,
    make_slab_layers,
    make_window_pair,
)


# ─── Geometric constants (mirrored from tier2_2bhk_pune.py for Phase B;
# Phase C will dedupe by importing from a shared location or removing
# the duplicates from the template) ─────────────────────────────────

_FRONT_SETBACK_M_DEFAULT: float = 3.0
_REAR_SETBACK_M_DEFAULT: float = 1.5
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150
_COLUMN_SIZE_M: float = 0.300

_MIN_BUILDABLE_WIDTH_M: float = 4.0
_MIN_BUILDABLE_DEPTH_M: float = 5.0

# Layout fractions (default plot 7.32 × 15.24, buildable 7.32 × 10.74).
_PV_X25_FRAC: float = 2.5 / 7.32
_PV_X55_FRAC: float = 5.5 / 7.32
_PH_GF_Y50_FRAC: float = (5.0 - 1.5) / 10.74
_PH_GF_Y80_FRAC: float = (8.0 - 1.5) / 10.74
_PH_FF_Y40_FRAC: float = (4.0 - 1.5) / 10.74
_PH_FF_Y60_FRAC: float = (6.0 - 1.5) / 10.74
_PH_FF_Y80_FRAC: float = (8.0 - 1.5) / 10.74
_PH_FF_Y105_FRAC: float = (10.5 - 1.5) / 10.74

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0

# Sentinel that the tower assembler substitutes with the actual lobby
# room id when `door_to_stair_outside=False`.
TOWER_CORE_LOBBY_SENTINEL: str = "<<TOWER_CORE_LOBBY>>"


# ─── Buildable-region computation (shared) ───────────────────────────
#
# Phase 1 consolidated the byte-identical computation bodies of
# `_buildable_bounds` / `_column_grid` into `_common.compute_buildable_bounds`
# / `_common.column_grid_axes`, and moved the shared `_perimeter_walls`
# there too. What remains here are thin same-signature adapters that
# inject this module's 2BHK config — so every call site and every
# importer (the FLAT floor-unit modules) keeps working unchanged.


def _buildable_bounds(
    plot_width_m: float,
    plot_length_m: float,
    front_setback_m: float,
    rear_setback_m: float,
    side_setback_m: float,
) -> tuple[float, float, float, float, float, float]:
    """2BHK buildable-region adapter over `_common.compute_buildable_bounds`."""
    return compute_buildable_bounds(
        plot_width_m,
        plot_length_m,
        front_setback_m,
        rear_setback_m,
        side_setback_m,
        min_width=_MIN_BUILDABLE_WIDTH_M,
        min_depth=_MIN_BUILDABLE_DEPTH_M,
        error_label="",
        error_tail=".",
    )


def _column_grid(
    buildable_x_min: float,
    buildable_x_max: float,
    buildable_y_min: float,
    buildable_y_max: float,
) -> tuple[list[float], list[float]]:
    """3 × 4 RCC column grid — adapter over `_common.column_grid_axes`."""
    return column_grid_axes(
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        column_size=_COLUMN_SIZE_M,
        y_axis_count=4,
    )


# ─── GF-style floor unit (kitchen / living / pooja / etc.) ─────────────


def build_2bhk_pune_gf_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = 0.0,
    door_to_stair_outside: bool = True,
    stair_id: str | None = None,
    has_stair: bool = True,
) -> FloorUnit:
    """Build the GF-style floor of a 2BHK Pune duplex.

    7 rooms: powder, utility, store, pooja, kitchen, stair-foyer,
    living-dining. The stair-foyer hosts the optional stair to the
    storey above (when `has_stair=True`). The main entry door connects
    stair-foyer to either "Outside" (`door_to_stair_outside=True`) or
    the tower-core lobby sentinel (False).

    All Z-coordinates derive from `elevation` (the Z of this floor's
    FLOOR slab top). All node IDs interpolate `name_prefix` so multiple
    copies stack cleanly.
    """
    (
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        buildable_width,
        buildable_depth,
    ) = _buildable_bounds(
        plot_width_m, plot_length_m, front_setback_m, rear_setback_m, side_setback_m
    )

    # ── Z-coordinates ──
    z_floor_top = elevation
    z_floor_bottom = elevation - _SLAB_THICKNESS_M
    z_wall_base = elevation
    z_wall_top = elevation + floor_height - _SLAB_THICKNESS_M
    z_slab_above_bottom = z_wall_top  # floor slab of next storey starts here
    sill_habit = elevation + 0.9
    sill_bath = elevation + 1.8
    sill_kitchen = elevation + 1.2
    sill_stair = elevation + 1.5

    # ── Floor slab (this storey's floor) ──
    envelope_polygon = make_rectangular_polygon_ccw(
        buildable_x_min, buildable_x_max, buildable_y_min, buildable_y_max
    )
    floor_slab = Slab(
        id=floor_slab_id,
        host_storey_id=storey_id,
        footprint_polygon=envelope_polygon,
        top_z=z_floor_top,
        bottom_z=z_floor_bottom,
        layers=make_slab_layers(),
        predefined_type="FLOOR",
    )

    # ── Perimeter walls ──
    sw = Vec2(x=buildable_x_min, y=buildable_y_min)
    se = Vec2(x=buildable_x_max, y=buildable_y_min)
    ne = Vec2(x=buildable_x_max, y=buildable_y_max)
    nw = Vec2(x=buildable_x_min, y=buildable_y_max)
    perimeter = _perimeter_walls(
        name_prefix=name_prefix,
        storey_id=storey_id,
        base_z=z_wall_base,
        top_z=z_wall_top,
        sw=sw, se=se, ne=ne, nw=nw,
    )

    # ── Partition wall axes (scale with plot) ──
    x_pv25 = buildable_x_min + buildable_width * _PV_X25_FRAC
    x_pv55 = buildable_x_min + buildable_width * _PV_X55_FRAC
    y_p50 = buildable_y_min + buildable_depth * _PH_GF_Y50_FRAC
    y_p80 = buildable_y_min + buildable_depth * _PH_GF_Y80_FRAC

    # ── Partitions (8 segments) ──
    partitions = [
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-s",
            name=f"Partition X2.5 South - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=buildable_y_min),
            end=Vec2(x=x_pv25, y=y_p50),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-m",
            name=f"Partition X2.5 Mid - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p50),
            end=Vec2(x=x_pv25, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-n",
            name=f"Partition X2.5 North - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p80),
            end=Vec2(x=x_pv25, y=buildable_y_max),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x55-s",
            name=f"Partition X5.5 South - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv55, y=buildable_y_min),
            end=Vec2(x=x_pv55, y=y_p50),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y50-w",
            name=f"Partition Y5.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p50),
            end=Vec2(x=x_pv25, y=y_p50),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y50-e",
            name=f"Partition Y5.0 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p50),
            end=Vec2(x=buildable_x_max, y=y_p50),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y80-w",
            name=f"Partition Y8.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p80),
            end=Vec2(x=x_pv25, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y80-e",
            name=f"Partition Y8.0 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p80),
            end=Vec2(x=buildable_x_max, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv25_w = x_pv25 - _HALF_INT_WALL
    x_pv25_e = x_pv25 + _HALF_INT_WALL
    x_pv55_w = x_pv55 - _HALF_INT_WALL
    x_pv55_e = x_pv55 + _HALF_INT_WALL
    y_p50_s = y_p50 - _HALF_INT_WALL
    y_p50_n = y_p50 + _HALF_INT_WALL
    y_p80_s = y_p80 - _HALF_INT_WALL
    y_p80_n = y_p80 + _HALF_INT_WALL

    rooms = [
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-powder",
            name="Powder Room", usage="toilet",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_s_inner, ymax=y_p50_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y50-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-utility",
            name="Utility & Wash", usage="utility",
            xmin=x_pv25_e, xmax=x_pv55_w, ymin=y_s_inner, ymax=y_p50_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x55-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y50-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x25-s", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-store",
            name="Store", usage="storage",
            xmin=x_pv55_e, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p50_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y50-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x55-s", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-pooja",
            name="Pooja Room", usage="pooja",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p50_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y50-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-m", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_pv25_e, xmax=x_e_inner, ymin=y_p50_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y50-e", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x25-m", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-foyer",
            name="Stair & Foyer", usage="stair",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p80_n, ymax=y_n_inner,
            south_wall=(f"wall-{name_prefix}-ph-y80-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-n", "left"),
            north_wall=(f"wall-{name_prefix}-N", "left"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living",
            xmin=x_pv25_e, xmax=x_e_inner, ymin=y_p80_n, ymax=y_n_inner,
            south_wall=(f"wall-{name_prefix}-ph-y80-e", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-N", "left"),
            west_wall=(f"wall-{name_prefix}-pv-x25-n", "right"),
        ),
    ]
    rooms.sort(key=lambda r: r.id)

    # ── Stair (optional) ──
    stairs: list[Stair] = []
    if has_stair:
        sid = stair_id if stair_id else f"stair-{name_prefix}-up"
        # Riser_height computed from the structural rise so STAIR_RISE_MATCHES
        # holds at any floor_height. Default 3.0 m → 19 × 0.150 = 2.85 m.
        structural_rise = z_slab_above_bottom - z_floor_top
        riser_count = 19
        riser_height = structural_rise / riser_count
        stairs.append(
            Stair(
                id=sid,
                host_storey_id=storey_id,
                riser_count=riser_count,
                riser_height=riser_height,
                tread_depth=0.250,
                flight_count=2,
                landing_count=1,
                plan_polygon=make_rectangular_polygon_ccw(
                    x_w_inner, x_pv25_w, y_p80_n, y_n_inner
                ),
            )
        )

    # ── Openings + doors + windows ──
    outside_or_lobby = (
        "Outside" if door_to_stair_outside else TOWER_CORE_LOBBY_SENTINEL
    )
    openings: list = []
    doors: list = []
    windows: list = []

    # Interior doors
    for did, opid, wid, dist, w, h, swing, hand, conn in [
        (
            f"door-{name_prefix}-sf-pooja",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-ph-y80-w",
            1.0, 0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-stair-foyer", f"room-{name_prefix}-pooja"],
        ),
        (
            f"door-{name_prefix}-sf-living",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-pv-x25-n",
            0.5, 0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-stair-foyer", f"room-{name_prefix}-living-dining"],
        ),
        (
            f"door-{name_prefix}-kitchen-living",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y80-e",
            1.0, 0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-living-dining"],
        ),
        (
            f"door-{name_prefix}-kitchen-utility",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-ph-y50-e",
            0.5, 0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-utility"],
        ),
        (
            f"door-{name_prefix}-powder-utility",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-pv-x25-s",
            1.0, 0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-powder", f"room-{name_prefix}-utility"],
        ),
        (
            f"door-{name_prefix}-store-utility",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-pv-x55-s",
            1.0, 0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-store", f"room-{name_prefix}-utility"],
        ),
    ]:
        op, dr = make_door_pair(
            door_id=did, opening_id=opid, wall_id=wid,
            distance_along_wall=dist, width=w, height=h,
            floor_z=elevation, swing=swing, handedness=hand,
            connects_room_ids=conn,
        )
        openings.append(op)
        doors.append(dr)

    # Main entry door (stair-foyer ↔ Outside or sentinel)
    op, dr = make_door_pair(
        door_id=f"door-{name_prefix}-main-entry",
        opening_id=f"opening-{name_prefix}-d07",
        wall_id=f"wall-{name_prefix}-N",
        distance_along_wall=buildable_x_max - 1.5,
        width=1.0, height=2.1,
        floor_z=elevation, swing="inward", handedness="right",
        connects_room_ids=[f"room-{name_prefix}-stair-foyer", outside_or_lobby],
    )
    openings.append(op)
    doors.append(dr)

    # Windows
    window_specs = [
        (
            f"window-{name_prefix}-living-east",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-E",
            (y_p80 + buildable_y_max) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        (
            f"window-{name_prefix}-living-north",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-N",
            (buildable_x_max - x_pv25) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        (
            f"window-{name_prefix}-kitchen-east",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-E",
            (y_p50 + y_p80) / 2.0 - 0.5 - buildable_y_min,
            1.0, 1.2, sill_kitchen,
        ),
        (
            f"window-{name_prefix}-stair-west",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-W",
            (buildable_y_max - y_p80) / 2.0 - 0.4,
            0.8, 1.5, sill_stair,
        ),
        (
            f"window-{name_prefix}-powder-south",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-S",
            0.7, 0.6, 0.6, sill_bath,
        ),
        (
            f"window-{name_prefix}-utility-south",
            f"opening-{name_prefix}-w06",
            f"wall-{name_prefix}-S",
            (x_pv25 + x_pv55) / 2.0 - 0.4,
            0.8, 1.0, sill_stair,
        ),
    ]
    for wid_, opid, wallid, dist, w, h, sill in window_specs:
        op, wn = make_window_pair(
            window_id=wid_, opening_id=opid, wall_id=wallid,
            distance_along_wall=dist, width=w, height=h,
            sill_z=sill, frame_material="Aluminum",
        )
        openings.append(op)
        windows.append(wn)

    openings.sort(key=lambda o: o.id)
    doors.sort(key=lambda d: d.id)
    windows.sort(key=lambda w: w.id)

    x_axes, y_axes = _column_grid(
        buildable_x_min, buildable_x_max, buildable_y_min, buildable_y_max
    )

    return FloorUnit(
        storey_id=storey_id,
        storey_index=storey_index,
        elevation=elevation,
        floor_height=floor_height,
        rooms=rooms,
        walls=walls,
        slabs=[floor_slab],
        openings=openings,
        doors=doors,
        windows=windows,
        stairs=stairs,
        floor_footprint_polygon=envelope_polygon,
        column_grid_x=x_axes,
        column_grid_y=y_axes,
    )


# ─── FF-style floor unit (bedrooms / baths / balcony) ──────────────────


def build_2bhk_pune_ff_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = 0.0,
    has_balcony: bool = True,
) -> FloorUnit:
    """Build the FF-style floor of a 2BHK Pune duplex.

    8 rooms: common-bath, bedroom-2, study, master-bath, master-bedroom,
    stair-landing, balcony-w, balcony-e (when has_balcony=True).

    No stair on this floor — the building's stair is in the GF unit.
    No exterior doors — circulation comes through the stair-landing
    from below.
    """
    (
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        buildable_width,
        buildable_depth,
    ) = _buildable_bounds(
        plot_width_m, plot_length_m, front_setback_m, rear_setback_m, side_setback_m
    )

    # ── Z-coordinates ──
    z_floor_top = elevation
    z_floor_bottom = elevation - _SLAB_THICKNESS_M
    z_wall_base = elevation
    z_wall_top = elevation + floor_height - _SLAB_THICKNESS_M
    sill_habit = elevation + 0.9
    sill_bath = elevation + 1.8

    # ── Floor slab ──
    envelope_polygon = make_rectangular_polygon_ccw(
        buildable_x_min, buildable_x_max, buildable_y_min, buildable_y_max
    )
    floor_slab = Slab(
        id=floor_slab_id,
        host_storey_id=storey_id,
        footprint_polygon=envelope_polygon,
        top_z=z_floor_top,
        bottom_z=z_floor_bottom,
        layers=make_slab_layers(),
        predefined_type="FLOOR",
    )

    # ── Perimeter walls ──
    sw = Vec2(x=buildable_x_min, y=buildable_y_min)
    se = Vec2(x=buildable_x_max, y=buildable_y_min)
    ne = Vec2(x=buildable_x_max, y=buildable_y_max)
    nw = Vec2(x=buildable_x_min, y=buildable_y_max)
    perimeter = _perimeter_walls(
        name_prefix=name_prefix,
        storey_id=storey_id,
        base_z=z_wall_base,
        top_z=z_wall_top,
        sw=sw, se=se, ne=ne, nw=nw,
    )

    # ── Partition wall axes ──
    x_pv25 = buildable_x_min + buildable_width * _PV_X25_FRAC
    y_p40 = buildable_y_min + buildable_depth * _PH_FF_Y40_FRAC
    y_p60 = buildable_y_min + buildable_depth * _PH_FF_Y60_FRAC
    y_p80 = buildable_y_min + buildable_depth * _PH_FF_Y80_FRAC
    y_p105 = buildable_y_min + buildable_depth * _PH_FF_Y105_FRAC

    # ── Partitions (9 segments) ──
    partitions = [
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-s",
            name=f"Partition X2.5 South - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=buildable_y_min),
            end=Vec2(x=x_pv25, y=y_p60),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-m",
            name=f"Partition X2.5 Mid - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p60),
            end=Vec2(x=x_pv25, y=y_p105),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x25-n",
            name=f"Partition X2.5 North - {name_prefix.upper()} (balcony divider)",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p105),
            end=Vec2(x=x_pv25, y=buildable_y_max),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y40-w",
            name=f"Partition Y4.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p40),
            end=Vec2(x=x_pv25, y=y_p40),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y60-w",
            name=f"Partition Y6.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p60),
            end=Vec2(x=x_pv25, y=y_p60),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y60-e",
            name=f"Partition Y6.0 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p60),
            end=Vec2(x=buildable_x_max, y=y_p60),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y80-w",
            name=f"Partition Y8.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p80),
            end=Vec2(x=x_pv25, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y105-w",
            name=f"Partition Y10.5 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p105),
            end=Vec2(x=x_pv25, y=y_p105),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y105-e",
            name=f"Partition Y10.5 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv25, y=y_p105),
            end=Vec2(x=buildable_x_max, y=y_p105),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv25_w = x_pv25 - _HALF_INT_WALL
    x_pv25_e = x_pv25 + _HALF_INT_WALL
    y_p40_s = y_p40 - _HALF_INT_WALL
    y_p40_n = y_p40 + _HALF_INT_WALL
    y_p60_s = y_p60 - _HALF_INT_WALL
    y_p60_n = y_p60 + _HALF_INT_WALL
    y_p80_s = y_p80 - _HALF_INT_WALL
    y_p80_n = y_p80 + _HALF_INT_WALL
    y_p105_s = y_p105 - _HALF_INT_WALL
    y_p105_n = y_p105 + _HALF_INT_WALL

    rooms = [
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-common-bath",
            name="Common Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_s_inner, ymax=y_p40_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y40-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-2",
            name="Bedroom 2", usage="bedroom",
            xmin=x_pv25_e, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p60_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y60-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x25-s", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-study",
            name="Study", usage="study",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p40_n, ymax=y_p60_s,
            south_wall=(f"wall-{name_prefix}-ph-y40-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y60-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bath",
            name="Master Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p60_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y60-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-m", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bedroom",
            name="Master Bedroom", usage="bedroom",
            xmin=x_pv25_e, xmax=x_e_inner, ymin=y_p60_n, ymax=y_p105_s,
            south_wall=(f"wall-{name_prefix}-ph-y60-e", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y105-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x25-m", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-landing",
            name="Stair Landing", usage="stair",
            xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p80_n, ymax=y_p105_s,
            south_wall=(f"wall-{name_prefix}-ph-y80-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x25-m", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y105-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
    ]
    if has_balcony:
        rooms.extend([
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony-w",
                name="West Balcony", usage="balcony",
                xmin=x_w_inner, xmax=x_pv25_w, ymin=y_p105_n, ymax=y_n_inner,
                south_wall=(f"wall-{name_prefix}-ph-y105-w", "left"),
                east_wall=(f"wall-{name_prefix}-pv-x25-n", "left"),
                north_wall=(f"wall-{name_prefix}-N", "left"),
                west_wall=(f"wall-{name_prefix}-W", "left"),
            ),
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony-e",
                name="Master Balcony", usage="balcony",
                xmin=x_pv25_e, xmax=x_e_inner, ymin=y_p105_n, ymax=y_n_inner,
                south_wall=(f"wall-{name_prefix}-ph-y105-e", "left"),
                east_wall=(f"wall-{name_prefix}-E", "left"),
                north_wall=(f"wall-{name_prefix}-N", "left"),
                west_wall=(f"wall-{name_prefix}-pv-x25-n", "right"),
            ),
        ])
    rooms.sort(key=lambda r: r.id)

    # ── Openings + doors + windows ──
    openings: list = []
    doors: list = []
    windows: list = []

    # Interior doors (8 doors when has_balcony=True; 6 when False)
    door_specs = [
        (
            f"door-{name_prefix}-landing-master",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-pv-x25-m",
            (y_p80 + y_p105) / 2.0 - 0.375 - y_p60, 0.75, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-stair-landing", f"room-{name_prefix}-master-bedroom"],
        ),
        (
            f"door-{name_prefix}-landing-mbath",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y80-w",
            x_pv25 / 2.0 - 0.35, 0.7, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-stair-landing", f"room-{name_prefix}-master-bath"],
        ),
        (
            f"door-{name_prefix}-cbath-bedroom2",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-pv-x25-s",
            (y_p40 - buildable_y_min) / 2.0 - 0.35, 0.7, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-common-bath", f"room-{name_prefix}-bedroom-2"],
        ),
        (
            f"door-{name_prefix}-study-bedroom2",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-pv-x25-s",
            (y_p40 + y_p60) / 2.0 - 0.375 - buildable_y_min, 0.75, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-study", f"room-{name_prefix}-bedroom-2"],
        ),
        (
            f"door-{name_prefix}-bedroom2-master",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-ph-y60-e",
            0.5, 0.75, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-bedroom-2", f"room-{name_prefix}-master-bedroom"],
        ),
        (
            f"door-{name_prefix}-mbath-master",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-pv-x25-m",
            0.5, 0.7, 2.0,
            "inward", "right",
            [f"room-{name_prefix}-master-bath", f"room-{name_prefix}-master-bedroom"],
        ),
    ]
    if has_balcony:
        door_specs.extend([
            (
                f"door-{name_prefix}-master-balcony",
                f"opening-{name_prefix}-d07",
                f"wall-{name_prefix}-ph-y105-e",
                (buildable_x_max - x_pv25) / 2.0 - 0.75, 1.5, 2.1,
                "sliding", "right",
                [f"room-{name_prefix}-master-bedroom", f"room-{name_prefix}-balcony-e"],
            ),
            (
                f"door-{name_prefix}-landing-balconyw",
                f"opening-{name_prefix}-d08",
                f"wall-{name_prefix}-ph-y105-w",
                x_pv25 / 2.0 - 0.375, 0.75, 2.0,
                "inward", "right",
                [f"room-{name_prefix}-stair-landing", f"room-{name_prefix}-balcony-w"],
            ),
        ])

    for did, opid, wid, dist, w, h, swing, hand, conn in door_specs:
        op, dr = make_door_pair(
            door_id=did, opening_id=opid, wall_id=wid,
            distance_along_wall=dist, width=w, height=h,
            floor_z=elevation, swing=swing, handedness=hand,
            connects_room_ids=conn,
        )
        openings.append(op)
        doors.append(dr)

    # Windows
    window_specs = [
        (
            f"window-{name_prefix}-bedroom2-east",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-E",
            (y_p60 - buildable_y_min) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        (
            f"window-{name_prefix}-bedroom2-south",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-S",
            (x_pv25 + buildable_x_max) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        (
            f"window-{name_prefix}-master-east",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-E",
            (y_p60 + y_p105) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        (
            f"window-{name_prefix}-study-west",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p40 + y_p60) / 2.0 - 0.5,
            1.0, 1.2, sill_habit,
        ),
        (
            f"window-{name_prefix}-mbath-west",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p60 + y_p80) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        (
            f"window-{name_prefix}-cbath-south",
            f"opening-{name_prefix}-w06",
            f"wall-{name_prefix}-S",
            x_pv25 / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
    ]
    for wid_, opid, wallid, dist, w, h, sill in window_specs:
        op, wn = make_window_pair(
            window_id=wid_, opening_id=opid, wall_id=wallid,
            distance_along_wall=dist, width=w, height=h,
            sill_z=sill, frame_material="Aluminum",
        )
        openings.append(op)
        windows.append(wn)

    openings.sort(key=lambda o: o.id)
    doors.sort(key=lambda d: d.id)
    windows.sort(key=lambda w: w.id)

    x_axes, y_axes = _column_grid(
        buildable_x_min, buildable_x_max, buildable_y_min, buildable_y_max
    )

    return FloorUnit(
        storey_id=storey_id,
        storey_index=storey_index,
        elevation=elevation,
        floor_height=floor_height,
        rooms=rooms,
        walls=walls,
        slabs=[floor_slab],
        openings=openings,
        doors=doors,
        windows=windows,
        stairs=[],
        floor_footprint_polygon=envelope_polygon,
        column_grid_x=x_axes,
        column_grid_y=y_axes,
    )


__all__ = [
    "TOWER_CORE_LOBBY_SENTINEL",
    "build_2bhk_pune_gf_floor_unit",
    "build_2bhk_pune_ff_floor_unit",
]
