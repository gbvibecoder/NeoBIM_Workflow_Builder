"""Phase T2.2 — Layer-2 floor-unit builders for the 3BHK Pune duplex.

Two functions, one per architectural layout type, both returning a
`FloorUnit` (the Layer-2 dataclass defined in `_common.py`):

  * `build_3bhk_pune_gf_floor_unit` — store / utility / stair-foyer /
    pooja / kitchen / powder / living-dining / drawing (8 rooms,
    optional stair). Larger than 1BHK/2BHK GF: separate drawing room
    (Indian luxury convention) + dedicated pooja room + powder room.

  * `build_3bhk_pune_ff_floor_unit` — study / bedroom-2 /
    stair-landing / master-bath / common-bath / master-bedroom /
    bedroom-3 / balcony-front (8 rooms, no stair, balcony optional).
    3 bedrooms total (master + bedroom-2 + bedroom-3) with shared
    common-bath and en-suite master-bath. Mid-segment 3BHK Pune
    pattern.

Default plot 11.0 × 20.0m → buildable 8.0 × 12.5m (100.0 sqm) after
PMC bylaw setbacks for plots ≥ 250 sqm: front 4.5m, rear 3.0m, side
1.5m each. Larger than 1BHK/2BHK plots which use 0m side setback.

All habitable rooms hit NBC India 3BHK minimums on the default plot
(living 12.5 sqm — strict, vs 1BHK's relaxed 9.5; bedroom 9.5;
kitchen 5.0; bath 1.8; toilet 1.4). Drawing room (Indian luxury
convention) at 22.5 sqm; master-bedroom at luxury target ≥ 14 sqm.

Structural grid: 3 × 4 RCC column grid (12 columns) with 300×300mm
sections — same as 2BHK (the bay span 8.0/2 = 4.0m and 12.5/3 = 4.17m
stay within 300mm RCC's safe span). 1.5 × 1.5 × 0.6m pad footings.
Reuses `_common.make_rcc_grid_columns_and_footings` directly (same
column dims as 2BHK, only axes differ — and axes are runtime params).

Z-coordinate discipline mirrors 1BHK / 2BHK floor-units. ID
discipline: every node interpolates `name_prefix` so multiple copies
stack cleanly (e.g., "gf"/"ff" duplex; "flat-s0" tower).
"""

from __future__ import annotations

from app.domain.building_model import (
    Slab,
    Stair,
    Vec2,
)
from app.templates._2bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
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


# ─── Geometric constants ─────────────────────────────────────────────

# 3BHK Pune setbacks (PMC bylaws for plots ≥ 250 sqm).
_FRONT_SETBACK_M_DEFAULT: float = 4.5
_REAR_SETBACK_M_DEFAULT: float = 3.0
_SIDE_SETBACK_M_DEFAULT: float = 1.5  # mandatory on both sides
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150

# 3BHK structural sizing — same as 2BHK (300mm column, 1.5m pad).
_COLUMN_SIZE_M: float = 0.300

_MIN_BUILDABLE_WIDTH_M: float = 6.0
_MIN_BUILDABLE_DEPTH_M: float = 9.0

# Layout fractions (default plot 11.0 × 20.0, buildable 8.0 × 12.5).
# PV (vertical) fractions of buildable_width measured from
# buildable_x_min. PH (horizontal) fractions of buildable_depth
# measured from buildable_y_min (south).
#
# GF partition lines:
#   pv_x30 at world x=4.5 (3.0m from buildable_x_min=1.5)
#   pv_x50 at world x=6.5 (5.0m from buildable_x_min=1.5)
#   ph_y40 at world y=7.0 (4.0m from buildable_y_min=3.0)
#   ph_y65 at world y=9.5 (6.5m from buildable_y_min=3.0)
#   ph_y80 at world y=11.0 (8.0m from buildable_y_min=3.0)
_PV_GF_X30_FRAC: float = 3.0 / 8.0
_PV_GF_X50_FRAC: float = 5.0 / 8.0
_PH_GF_Y40_FRAC: float = 4.0 / 12.5
_PH_GF_Y65_FRAC: float = 6.5 / 12.5
_PH_GF_Y80_FRAC: float = 8.0 / 12.5

# FF partition lines:
#   pv_x35 at world x=5.0 (3.5m from buildable_x_min=1.5) — pushed
#       east from 3.0m so bedroom-3 has enough width to clear NBC 9.5
#       sqm with the 0.135m wall insets eating the polygon area.
#   pv_x40 at world x=5.5 (4.0m from buildable_x_min=1.5) — south band
#       study/bedroom-2 split (south of ph-y40 only)
#   pv_x50 at world x=6.5 (5.0m from buildable_x_min=1.5) — mid band
#       master-bath/common-bath split
#   ph_y40 at world y=7.0
#   ph_y65 at world y=9.5
#   ph_y80 at world y=11.0
#   ph_y115 at world y=14.5 (only when has_balcony=True)
_PV_FF_X35_FRAC: float = 3.5 / 8.0
_PV_FF_X40_FRAC: float = 4.0 / 8.0
_PV_FF_X50_FRAC: float = 5.0 / 8.0
_PH_FF_Y40_FRAC: float = 4.0 / 12.5
_PH_FF_Y65_FRAC: float = 6.5 / 12.5
_PH_FF_Y80_FRAC: float = 8.0 / 12.5
_PH_FF_Y115_FRAC: float = 11.5 / 12.5

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0


# ─── Buildable-region computation ────────────────────────────────────
#
# Phase 1 consolidated the byte-identical computation bodies into
# `_common.compute_buildable_bounds` / `_common.column_grid_axes`. The
# two functions below are thin same-signature adapters that inject this
# module's 3BHK config (larger minimum buildable area, 3BHK-flavoured
# error text) — call sites and importers stay unchanged.


def _buildable_bounds(
    plot_width_m: float,
    plot_length_m: float,
    front_setback_m: float,
    rear_setback_m: float,
    side_setback_m: float,
) -> tuple[float, float, float, float, float, float]:
    """3BHK buildable-region adapter over `_common.compute_buildable_bounds`.

    Larger minimum (6.0 × 9.0 m) than 1BHK/2BHK because 3BHK needs more
    rooms.
    """
    return compute_buildable_bounds(
        plot_width_m,
        plot_length_m,
        front_setback_m,
        rear_setback_m,
        side_setback_m,
        min_width=_MIN_BUILDABLE_WIDTH_M,
        min_depth=_MIN_BUILDABLE_DEPTH_M,
        error_label=" (3BHK)",
        error_tail=" m for 3BHK layout.",
    )


def _column_grid(
    buildable_x_min: float,
    buildable_x_max: float,
    buildable_y_min: float,
    buildable_y_max: float,
) -> tuple[list[float], list[float]]:
    """3BHK 3 × 4 RCC column grid (12 columns) — adapter over
    `_common.column_grid_axes`. Same 3×4 shape and 300 mm columns as
    the 2BHK grid.
    """
    return column_grid_axes(
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        column_size=_COLUMN_SIZE_M,
        y_axis_count=4,
    )


# ─── GF floor-unit (kitchen + drawing + living + service-zone side) ──


def build_3bhk_pune_gf_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 11.0,
    plot_length_m: float = 20.0,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = _SIDE_SETBACK_M_DEFAULT,
    door_to_stair_outside: bool = True,
    stair_id: str | None = None,
    has_stair: bool = True,
) -> FloorUnit:
    """Build the GF-style floor of a 3BHK Pune duplex.

    8 rooms: store, utility, stair-foyer, pooja, kitchen, powder,
    living-dining, drawing. The stair-foyer hosts the optional stair to
    the storey above. Main entry on NORTH wall (facing the road),
    opens into drawing room (Indian luxury convention).

    Layout (world coords, default plot):

        N=15.5  ┌────────────────────────────┐
                │  drawing       │ living-   │
                │  (5×4.5=22.5)  │ dining    │
                │                │ (3×6=18)  │
        y=11.0  ├────────┬───────┤           │
                │ stair  │ powder│           │
                │ foyer  │(2×1.5)│           │
                │(3×4=12)├───────┤           │
        y=9.5   │        │ pooja │ kitchen   │
                │        │       │           │
        y=7.0   ├────────┴───────┴───────────┤
                │       store       │utility│
                │      (5×4=20)     │ (3×4) │
        y=3.0   └───────────────────┴───────┘
                x=1.5   4.5  6.5    9.5
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
    z_slab_above_bottom = z_wall_top
    sill_habit = elevation + 0.9
    sill_bath = elevation + 1.8
    sill_kitchen = elevation + 1.2
    sill_stair = elevation + 1.5

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

    # ── Perimeter walls (CCW) ──
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
    x_pv30 = buildable_x_min + buildable_width * _PV_GF_X30_FRAC  # 4.5
    x_pv50 = buildable_x_min + buildable_width * _PV_GF_X50_FRAC  # 6.5
    y_p40 = buildable_y_min + buildable_depth * _PH_GF_Y40_FRAC   # 7.0
    y_p65 = buildable_y_min + buildable_depth * _PH_GF_Y65_FRAC   # 9.5
    y_p80 = buildable_y_min + buildable_depth * _PH_GF_Y80_FRAC   # 11.0

    # ── Partitions (6 segments) ──
    # ph-y40 is split at pv-x30 because stair-foyer (west zone) doesn't
    # extend across pv-x30 — its south boundary is ph-y40-w only, while
    # store extends to x_pv50 so its north uses ph-y40-e (extended).
    # ph-y65 single (only east of pv-x30 has a y=9.5 boundary).
    # ph-y80 single (drawing spans full west zone north of y=11.0).
    # pv-x30 single (y∈[7.0, 11.0]).
    # pv-x50 single (y∈[3.0, 15.5]) — multiple rooms reference each side.
    partitions = [
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y40-w",
            name=f"Partition Y4.0 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p40),
            end=Vec2(x=x_pv30, y=y_p40),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y40-e",
            name=f"Partition Y4.0 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p40),
            end=Vec2(x=buildable_x_max, y=y_p40),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y65",
            name=f"Partition Y6.5 - {name_prefix.upper()} (mid/north)",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p65),
            end=Vec2(x=buildable_x_max, y=y_p65),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y80",
            name=f"Partition Y8.0 - {name_prefix.upper()} (foyer/drawing)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p80),
            end=Vec2(x=x_pv50, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x30",
            name=f"Partition X3.0 - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p40),
            end=Vec2(x=x_pv30, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x50",
            name=f"Partition X5.0 - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv50, y=buildable_y_min),
            end=Vec2(x=x_pv50, y=buildable_y_max),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv30_w = x_pv30 - _HALF_INT_WALL
    x_pv30_e = x_pv30 + _HALF_INT_WALL
    x_pv50_w = x_pv50 - _HALF_INT_WALL
    x_pv50_e = x_pv50 + _HALF_INT_WALL
    y_p40_s = y_p40 - _HALF_INT_WALL
    y_p40_n = y_p40 + _HALF_INT_WALL
    y_p65_s = y_p65 - _HALF_INT_WALL
    y_p65_n = y_p65 + _HALF_INT_WALL
    y_p80_s = y_p80 - _HALF_INT_WALL
    y_p80_n = y_p80 + _HALF_INT_WALL

    rooms = [
        # Store (south-west service zone, 5m × 4m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-store",
            name="Store", usage="storage",
            xmin=x_w_inner, xmax=x_pv50_w, ymin=y_s_inner, ymax=y_p40_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x50", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y40-e", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Utility (south-east service zone, 3m × 4m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-utility",
            name="Utility & Wash", usage="utility",
            xmin=x_pv50_e, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p40_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y40-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x50", "right"),
        ),
        # Stair-foyer (west mid-band, 3m × 4m). Hosts optional stair.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-foyer",
            name="Stair & Foyer", usage="stair",
            xmin=x_w_inner, xmax=x_pv30_w, ymin=y_p40_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y40-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x30", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Pooja (center mid-band, 2m × 2.5m). Indian dedicated worship.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-pooja",
            name="Pooja Room", usage="pooja",
            xmin=x_pv30_e, xmax=x_pv50_w, ymin=y_p40_n, ymax=y_p65_s,
            south_wall=(f"wall-{name_prefix}-ph-y40-e", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x50", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y65", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x30", "right"),
        ),
        # Kitchen (east mid-band, 3m × 2.5m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_pv50_e, xmax=x_e_inner, ymin=y_p40_n, ymax=y_p65_s,
            south_wall=(f"wall-{name_prefix}-ph-y40-e", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y65", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x50", "right"),
        ),
        # Powder (center mid-high band, 2m × 1.5m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-powder",
            name="Powder Room", usage="toilet",
            xmin=x_pv30_e, xmax=x_pv50_w, ymin=y_p65_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y65", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x50", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x30", "right"),
        ),
        # Living-Dining (east, full y from y_p65 to north envelope; 3m × 6m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living-dining",
            xmin=x_pv50_e, xmax=x_e_inner, ymin=y_p65_n, ymax=y_n_inner,
            south_wall=(f"wall-{name_prefix}-ph-y65", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-N", "left"),
            west_wall=(f"wall-{name_prefix}-pv-x50", "right"),
        ),
        # Drawing Room (north band west, 5m × 4.5m). Luxury convention.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-drawing",
            name="Drawing Room", usage="drawing",
            xmin=x_w_inner, xmax=x_pv50_w, ymin=y_p80_n, ymax=y_n_inner,
            south_wall=(f"wall-{name_prefix}-ph-y80", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x50", "left"),
            north_wall=(f"wall-{name_prefix}-N", "left"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
    ]
    rooms.sort(key=lambda r: r.id)

    # ── Stair (optional) ──
    stairs: list[Stair] = []
    if has_stair:
        sid = stair_id if stair_id else f"stair-{name_prefix}-up"
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
                    x_w_inner, x_pv30_w, y_p40_n, y_p80_s
                ),
            )
        )

    # ── Doors ──
    outside_or_lobby = (
        "Outside" if door_to_stair_outside else TOWER_CORE_LOBBY_SENTINEL
    )
    openings: list = []
    doors: list = []
    windows: list = []

    door_specs = [
        # 1. Main entry — N wall, into drawing. Centered in drawing's
        #    east half (x∈[x_pv30, x_pv50]) so the west part of N wall
        #    keeps room for a window.
        (
            f"door-{name_prefix}-main-entry",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-N",
            buildable_x_max - (x_pv30 + x_pv50) / 2.0 - 0.5,
            1.0, 2.1, "inward", "right",
            [f"room-{name_prefix}-drawing", outside_or_lobby],
        ),
        # 2. drawing ↔ stair-foyer (ph-y80, west portion).
        (
            f"door-{name_prefix}-drawing-stair-foyer",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y80",
            (buildable_x_min + x_pv30) / 2.0 - 0.375 - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-drawing", f"room-{name_prefix}-stair-foyer"],
        ),
        # 3. drawing ↔ living-dining (pv-x50, north portion).
        (
            f"door-{name_prefix}-drawing-living",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-pv-x50",
            (y_p80 + buildable_y_max) / 2.0 - 0.5 - buildable_y_min,
            1.0, 2.1, "sliding", "right",
            [f"room-{name_prefix}-drawing", f"room-{name_prefix}-living-dining"],
        ),
        # 4. stair-foyer ↔ pooja (pv-x30, south portion).
        (
            f"door-{name_prefix}-foyer-pooja",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-pv-x30",
            (y_p40 + y_p65) / 2.0 - 0.35 - y_p40,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-stair-foyer", f"room-{name_prefix}-pooja"],
        ),
        # 5. stair-foyer ↔ powder (pv-x30, north portion).
        (
            f"door-{name_prefix}-foyer-powder",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-pv-x30",
            (y_p65 + y_p80) / 2.0 - 0.35 - y_p40,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-stair-foyer", f"room-{name_prefix}-powder"],
        ),
        # 6. stair-foyer ↔ store (ph-y40-w).
        (
            f"door-{name_prefix}-foyer-store",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-ph-y40-w",
            (x_pv30 - buildable_x_min) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-stair-foyer", f"room-{name_prefix}-store"],
        ),
        # 7. kitchen ↔ utility (ph-y40-e, east half).
        (
            f"door-{name_prefix}-kitchen-utility",
            f"opening-{name_prefix}-d07",
            f"wall-{name_prefix}-ph-y40-e",
            (x_pv50 + buildable_x_max) / 2.0 - 0.35 - x_pv30,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-utility"],
        ),
        # 8. kitchen ↔ living-dining (ph-y65, east half — kitchen's range).
        (
            f"door-{name_prefix}-kitchen-living",
            f"opening-{name_prefix}-d08",
            f"wall-{name_prefix}-ph-y65",
            (x_pv50 + buildable_x_max) / 2.0 - 0.4 - x_pv30,
            0.8, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-living-dining"],
        ),
    ]
    for did, opid, wid, dist, w, h, swing, hand, conn in door_specs:
        op, dr = make_door_pair(
            door_id=did, opening_id=opid, wall_id=wid,
            distance_along_wall=dist, width=w, height=h,
            floor_z=elevation, swing=swing, handedness=hand,
            connects_room_ids=conn,
        )
        openings.append(op)
        doors.append(dr)

    # ── Windows ──
    # All windows on perimeter walls. 8 windows total — one per
    # habitable room. Pooja and powder are interior (no perimeter
    # access); they rely on ventilation shafts (out of scope v1).
    window_specs = [
        # 1. drawing N (large picture) — west half of N wall (door is east).
        (
            f"window-{name_prefix}-drawing-north",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-N",
            buildable_x_max - (buildable_x_min + x_pv30) / 2.0 - 0.75,
            1.5, 1.5, sill_habit,
        ),
        # 2. drawing W.
        (
            f"window-{name_prefix}-drawing-west",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p80 + buildable_y_max) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 3. living-dining N — east half (drawing takes west half of N).
        (
            f"window-{name_prefix}-living-north",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-N",
            buildable_x_max - (x_pv50 + buildable_x_max) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 4. living-dining E.
        (
            f"window-{name_prefix}-living-east",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-E",
            (y_p65 + buildable_y_max) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 5. kitchen E — counter-height.
        (
            f"window-{name_prefix}-kitchen-east",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-E",
            (y_p40 + y_p65) / 2.0 - 0.5 - buildable_y_min,
            1.0, 1.2, sill_kitchen,
        ),
        # 6. utility S.
        (
            f"window-{name_prefix}-utility-south",
            f"opening-{name_prefix}-w06",
            f"wall-{name_prefix}-S",
            (x_pv50 + buildable_x_max) / 2.0 - 0.4 - buildable_x_min,
            0.8, 1.0, sill_kitchen,
        ),
        # 7. store S — west half (utility takes east half of S).
        (
            f"window-{name_prefix}-store-south",
            f"opening-{name_prefix}-w07",
            f"wall-{name_prefix}-S",
            (buildable_x_min + x_pv50) / 2.0 - 0.5 - buildable_x_min,
            1.0, 1.0, sill_kitchen,
        ),
        # 8. stair-foyer W — daylights the stair shaft.
        (
            f"window-{name_prefix}-stair-foyer-west",
            f"opening-{name_prefix}-w08",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p40 + y_p80) / 2.0 - 0.4,
            0.8, 1.2, sill_stair,
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


# ─── FF floor-unit (3 bedrooms + 2 baths + balcony) ──────────────────


def build_3bhk_pune_ff_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 11.0,
    plot_length_m: float = 20.0,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = _SIDE_SETBACK_M_DEFAULT,
    has_balcony: bool = True,
) -> FloorUnit:
    """Build the FF-style floor of a 3BHK Pune duplex.

    8 rooms: study, bedroom-2, stair-landing, master-bath, common-bath,
    master-bedroom, bedroom-3, balcony-front (when has_balcony=True).
    7 rooms when has_balcony=False — bedroom-3 + master-bedroom extend
    to the north envelope.

    Stair-landing positioned at x∈[1.5, 4.5], y∈[7.0, 11.0] — same
    location as the GF stair-foyer, so the stair physically connects.

    Layout (world coords, default plot with balcony):

        N=15.5  ┌──────────────────────────┐
                │     BALCONY (front)      │
        y=14.5  ├──────┬───────────────────┤
                │bdrm-3│   master-bedroom  │
                │ 3×3.5│    (5×5=25)       │
        y=11.0  │ =10.5│                   │
                ├──────┘                   │
                │                          │
                │stair-          ph-y95    │
                │landing├───┬──────────────┤
                │(3×4)  │mbat│ common-bath │
                │       │5sqm│ (3×2.5=7.5) │
        y=7.0   ├───────┴────┴─────────────┤
                │   study     │ bedroom-2  │
                │  (4×4=16)   │ (4×4=16)   │
        y=3.0   └─────────────┴────────────┘
                x=1.5  4.5 6.5            9.5
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

    # ── Perimeter walls — duplex FF uses brick walls (no railings). ──
    # T2.1 lesson: duplex FF balcony uses brick walls; only FLAT (tower)
    # uses railings. Keep the convention.
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
    x_pv30 = buildable_x_min + buildable_width * _PV_FF_X35_FRAC  # 5.0
    x_pv40 = buildable_x_min + buildable_width * _PV_FF_X40_FRAC  # 5.5
    x_pv50 = buildable_x_min + buildable_width * _PV_FF_X50_FRAC  # 6.5
    y_p40 = buildable_y_min + buildable_depth * _PH_FF_Y40_FRAC   # 7.0
    y_p65 = buildable_y_min + buildable_depth * _PH_FF_Y65_FRAC   # 9.5
    y_p80 = buildable_y_min + buildable_depth * _PH_FF_Y80_FRAC   # 11.0
    y_p115 = buildable_y_min + buildable_depth * _PH_FF_Y115_FRAC  # 14.5

    # When no balcony, master-bedroom + bedroom-3 extend to N envelope.
    # pv-x30-n and pv-x40 (only used in north band) extend accordingly.
    y_top_north = y_p115 if has_balcony else buildable_y_max

    partitions = [
        # ph-y40 (full width) — south band rooms below; mid band rooms
        # above. 5 rooms reference this single wall.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y40",
            name=f"Partition Y4.0 - {name_prefix.upper()} (south/mid)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p40),
            end=Vec2(x=buildable_x_max, y=y_p40),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y65 (east of pv-x30 only) — mid band baths above; mid band
        # baths/landing south of. master-bedroom north of.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y65",
            name=f"Partition Y6.5 - {name_prefix.upper()} (mid/master-bedroom)",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p65),
            end=Vec2(x=buildable_x_max, y=y_p65),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y80 (west of pv-x30 only) — splits stair-landing from
        # bedroom-3.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y80",
            name=f"Partition Y8.0 - {name_prefix.upper()} (landing/bedroom-3)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p80),
            end=Vec2(x=x_pv30, y=y_p80),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x30 (single y∈[7.0, y_top_north]) — splits stair-landing /
        # bedroom-3 (west) from master-bath / master-bedroom (east).
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x30",
            name=f"Partition X3.0 - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p40),
            end=Vec2(x=x_pv30, y=y_top_north),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x40 (south band, y∈[3.0, 7.0] only) — splits study /
        # bedroom-2.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x40",
            name=f"Partition X4.0 - {name_prefix.upper()} (study/bedroom-2)",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv40, y=buildable_y_min),
            end=Vec2(x=x_pv40, y=y_p40),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x50 (mid band only, y∈[7.0, 9.5]) — splits master-bath /
        # common-bath.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x50",
            name=f"Partition X5.0 - {name_prefix.upper()} (mbath/cbath)",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv50, y=y_p40),
            end=Vec2(x=x_pv50, y=y_p65),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    if has_balcony:
        partitions.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-ph-y115",
                name=f"Partition Y11.5 - {name_prefix.upper()} (under balcony)",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p115),
                end=Vec2(x=buildable_x_max, y=y_p115),
                base_z=z_wall_base, top_z=z_wall_top,
            )
        )
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv30_w = x_pv30 - _HALF_INT_WALL
    x_pv30_e = x_pv30 + _HALF_INT_WALL
    x_pv40_w = x_pv40 - _HALF_INT_WALL
    x_pv40_e = x_pv40 + _HALF_INT_WALL
    x_pv50_w = x_pv50 - _HALF_INT_WALL
    x_pv50_e = x_pv50 + _HALF_INT_WALL
    y_p40_s = y_p40 - _HALF_INT_WALL
    y_p40_n = y_p40 + _HALF_INT_WALL
    y_p65_s = y_p65 - _HALF_INT_WALL
    y_p65_n = y_p65 + _HALF_INT_WALL
    y_p80_s = y_p80 - _HALF_INT_WALL
    y_p80_n = y_p80 + _HALF_INT_WALL
    y_p115_s = y_p115 - _HALF_INT_WALL
    y_p115_n = y_p115 + _HALF_INT_WALL

    # When no balcony, bedroom-3 + master-bedroom extend to N envelope.
    if has_balcony:
        bedroom_3_north_inner = y_p115_s
        bedroom_3_north_wall = f"wall-{name_prefix}-ph-y115"
        bedroom_3_north_side = "right"
        master_bedroom_north_inner = y_p115_s
        master_bedroom_north_wall = f"wall-{name_prefix}-ph-y115"
        master_bedroom_north_side = "right"
    else:
        bedroom_3_north_inner = y_n_inner
        bedroom_3_north_wall = f"wall-{name_prefix}-N"
        bedroom_3_north_side = "left"
        master_bedroom_north_inner = y_n_inner
        master_bedroom_north_wall = f"wall-{name_prefix}-N"
        master_bedroom_north_side = "left"

    rooms = [
        # Study (south-west, 4m × 4m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-study",
            name="Study", usage="study",
            xmin=x_w_inner, xmax=x_pv40_w, ymin=y_s_inner, ymax=y_p40_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x40", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y40", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Bedroom-2 (south-east, 4m × 4m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-2",
            name="Bedroom 2", usage="bedroom",
            xmin=x_pv40_e, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p40_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y40", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x40", "right"),
        ),
        # Stair-landing (west mid+upper, x∈[1.5, 4.5], y∈[7.0, 11.0]).
        # Same x,y as GF stair-foyer for stair continuity.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-landing",
            name="Stair Landing", usage="stair",
            xmin=x_w_inner, xmax=x_pv30_w, ymin=y_p40_n, ymax=y_p80_s,
            south_wall=(f"wall-{name_prefix}-ph-y40", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x30", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y80", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Master-bath (mid west of pv-x50, 2m × 2.5m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bath",
            name="Master Bathroom", usage="bath",
            xmin=x_pv30_e, xmax=x_pv50_w, ymin=y_p40_n, ymax=y_p65_s,
            south_wall=(f"wall-{name_prefix}-ph-y40", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x50", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y65", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x30", "right"),
        ),
        # Common-bath (mid east of pv-x50, 3m × 2.5m).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-common-bath",
            name="Common Bathroom", usage="bath",
            xmin=x_pv50_e, xmax=x_e_inner, ymin=y_p40_n, ymax=y_p65_s,
            south_wall=(f"wall-{name_prefix}-ph-y40", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y65", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x50", "right"),
        ),
        # Master-bedroom (east, full y from y_p65 to north boundary;
        # 5m × 5m or 5m × 6m without balcony).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bedroom",
            name="Master Bedroom", usage="master-bedroom",
            xmin=x_pv30_e, xmax=x_e_inner,
            ymin=y_p65_n, ymax=master_bedroom_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y65", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(master_bedroom_north_wall, master_bedroom_north_side),
            west_wall=(f"wall-{name_prefix}-pv-x30", "right"),
        ),
        # Bedroom-3 (north-west, 3m × 3.5m or 3m × 4.5m without balcony).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-3",
            name="Bedroom 3", usage="bedroom",
            xmin=x_w_inner, xmax=x_pv30_w,
            ymin=y_p80_n, ymax=bedroom_3_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y80", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x30", "left"),
            north_wall=(bedroom_3_north_wall, bedroom_3_north_side),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
    ]
    if has_balcony:
        rooms.append(
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony-front",
                name="Front Balcony", usage="balcony",
                xmin=x_w_inner, xmax=x_e_inner,
                ymin=y_p115_n, ymax=y_n_inner,
                south_wall=(f"wall-{name_prefix}-ph-y115", "left"),
                east_wall=(f"wall-{name_prefix}-E", "left"),
                north_wall=(f"wall-{name_prefix}-N", "left"),
                west_wall=(f"wall-{name_prefix}-W", "left"),
            )
        )
    rooms.sort(key=lambda r: r.id)

    # ── Doors ──
    openings: list = []
    doors: list = []
    windows: list = []

    door_specs = [
        # 1. stair-landing ↔ bedroom-3 (ph-y80, west portion).
        (
            f"door-{name_prefix}-landing-bedroom-3",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-ph-y80",
            (buildable_x_min + x_pv30) / 2.0 - 0.375 - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-stair-landing",
                f"room-{name_prefix}-bedroom-3",
            ],
        ),
        # 2. stair-landing ↔ master-bedroom (pv-x30, north portion of mid).
        (
            f"door-{name_prefix}-landing-master",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-pv-x30",
            (y_p65 + y_p80) / 2.0 - 0.375 - y_p40,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-stair-landing",
                f"room-{name_prefix}-master-bedroom",
            ],
        ),
        # 3. stair-landing ↔ master-bath (pv-x30, south portion of mid).
        (
            f"door-{name_prefix}-landing-mbath",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-pv-x30",
            (y_p40 + y_p65) / 2.0 - 0.35 - y_p40,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-stair-landing",
                f"room-{name_prefix}-master-bath",
            ],
        ),
        # 4. bedroom-2 ↔ common-bath (ph-y40, east half).
        (
            f"door-{name_prefix}-bedroom-2-cbath",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-ph-y40",
            (x_pv50 + buildable_x_max) / 2.0 - 0.35 - buildable_x_min,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-bedroom-2",
                f"room-{name_prefix}-common-bath",
            ],
        ),
        # 5. study ↔ bedroom-2 (pv-x40 — door across south-band partition).
        (
            f"door-{name_prefix}-study-bedroom-2",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-pv-x40",
            (buildable_y_min + y_p40) / 2.0 - 0.375 - buildable_y_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-study",
                f"room-{name_prefix}-bedroom-2",
            ],
        ),
        # 6. master-bedroom ↔ common-bath (ph-y65, east of pv-x50).
        (
            f"door-{name_prefix}-master-cbath",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-ph-y65",
            (x_pv50 + buildable_x_max) / 2.0 - 0.35 - x_pv30,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-master-bedroom",
                f"room-{name_prefix}-common-bath",
            ],
        ),
    ]
    if has_balcony:
        # 7. master-bedroom ↔ balcony (ph-y115, east half).
        door_specs.append(
            (
                f"door-{name_prefix}-master-balcony",
                f"opening-{name_prefix}-d07",
                f"wall-{name_prefix}-ph-y115",
                (x_pv30 + buildable_x_max) / 2.0 - 0.75 - buildable_x_min,
                1.5, 2.1, "sliding", "right",
                [
                    f"room-{name_prefix}-master-bedroom",
                    f"room-{name_prefix}-balcony-front",
                ],
            )
        )
        # 8. bedroom-3 ↔ balcony (ph-y115, west half).
        door_specs.append(
            (
                f"door-{name_prefix}-bedroom-3-balcony",
                f"opening-{name_prefix}-d08",
                f"wall-{name_prefix}-ph-y115",
                (buildable_x_min + x_pv30) / 2.0 - 0.4 - buildable_x_min,
                0.8, 2.0, "sliding", "right",
                [
                    f"room-{name_prefix}-bedroom-3",
                    f"room-{name_prefix}-balcony-front",
                ],
            )
        )

    for did, opid, wid, dist, w, h, swing, hand, conn in door_specs:
        op, dr = make_door_pair(
            door_id=did, opening_id=opid, wall_id=wid,
            distance_along_wall=dist, width=w, height=h,
            floor_z=elevation, swing=swing, handedness=hand,
            connects_room_ids=conn,
        )
        openings.append(op)
        doors.append(dr)

    # ── Windows ──
    # When has_balcony=False, bedroom-3 + master-bedroom border N
    # perimeter — north-facing windows make sense. With balcony,
    # bedrooms get only east/west perimeter windows (north is interior).
    bedroom_3_north_y = y_p115 if has_balcony else buildable_y_max
    master_bedroom_north_y = y_p115 if has_balcony else buildable_y_max

    window_specs = [
        # 1. study S.
        (
            f"window-{name_prefix}-study-south",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-S",
            (buildable_x_min + x_pv40) / 2.0 - 0.6 - buildable_x_min,
            1.2, 1.5, sill_habit,
        ),
        # 2. study W.
        (
            f"window-{name_prefix}-study-west",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-W",
            buildable_y_max - (buildable_y_min + y_p40) / 2.0 - 0.5,
            1.0, 1.2, sill_habit,
        ),
        # 3. bedroom-2 S.
        (
            f"window-{name_prefix}-bedroom-2-south",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-S",
            (x_pv40 + buildable_x_max) / 2.0 - 0.6 - buildable_x_min,
            1.2, 1.5, sill_habit,
        ),
        # 4. bedroom-2 E.
        (
            f"window-{name_prefix}-bedroom-2-east",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-E",
            (buildable_y_min + y_p40) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 5. master-bedroom E (mid-band y range).
        (
            f"window-{name_prefix}-master-east",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-E",
            (y_p65 + master_bedroom_north_y) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 6. bedroom-3 W.
        (
            f"window-{name_prefix}-bedroom-3-west",
            f"opening-{name_prefix}-w06",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p80 + bedroom_3_north_y) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 7. common-bath E (small high-sill).
        (
            f"window-{name_prefix}-cbath-east",
            f"opening-{name_prefix}-w07",
            f"wall-{name_prefix}-E",
            (y_p40 + y_p65) / 2.0 - 0.3 - buildable_y_min,
            0.6, 0.6, sill_bath,
        ),
        # 8. stair-landing W.
        (
            f"window-{name_prefix}-landing-west",
            f"opening-{name_prefix}-w08",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p40 + y_p80) / 2.0 - 0.4,
            0.8, 1.2, sill_habit,
        ),
    ]
    if not has_balcony:
        # When no balcony, master-bedroom + bedroom-3 border N perimeter.
        # Add a north window on each so cross-ventilation is preserved.
        window_specs.append(
            (
                f"window-{name_prefix}-master-north",
                f"opening-{name_prefix}-w09",
                f"wall-{name_prefix}-N",
                buildable_x_max - (x_pv30 + buildable_x_max) / 2.0 - 0.6,
                1.2, 1.5, sill_habit,
            )
        )
        window_specs.append(
            (
                f"window-{name_prefix}-bedroom-3-north",
                f"opening-{name_prefix}-w10",
                f"wall-{name_prefix}-N",
                buildable_x_max - (buildable_x_min + x_pv30) / 2.0 - 0.5,
                1.0, 1.5, sill_habit,
            )
        )

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
    "build_3bhk_pune_gf_floor_unit",
    "build_3bhk_pune_ff_floor_unit",
]
