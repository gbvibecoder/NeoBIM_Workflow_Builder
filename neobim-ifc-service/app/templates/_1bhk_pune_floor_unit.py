"""Phase T2.1 — Layer-2 floor-unit builders for the 1BHK Pune duplex.

Two functions, one per architectural layout type, both returning a
`FloorUnit` (the Layer-2 dataclass defined in `_common.py`):

  * `build_1bhk_pune_gf_floor_unit` — powder / utility / kitchen /
    stair-foyer / living-dining (5 rooms, optional stair). Mirrors
    the "kitchen-side" role of the 2BHK GF unit, scaled down to a
    1BHK footprint.

  * `build_1bhk_pune_ff_floor_unit` — study / master-bath /
    stair-landing / master-bedroom / balcony (5 rooms with balcony,
    4 without). Mirrors the "bedroom-side" role of the 2BHK FF unit,
    with a single bedroom + en-suite bath instead of two.

Default plot 7.32 × 12.20m (89.3 sqm gross). Buildable 7.32 × 8.20m
(60.0 sqm) after PMC-bylaw setbacks: front 2.5m, rear 1.5m, side 0.0m.
The 2.5m front setback is relaxed from 2BHK's 3.0m for plots ≤ 7.5m
wide (PMC bylaws permit).

All rooms hit NBC India minimums on the default plot:

  * habitable (living, bedroom, study): 9.5 sqm min
  * kitchen: 5.0 sqm min
  * bath: 1.8 sqm min
  * toilet: 1.4 sqm min

Structural grid: 3 × 3 RCC column grid (9 columns) with 230×230mm
sections — smaller than 2BHK's 3 × 4 grid + 300mm columns,
appropriate for the smaller building footprint and 2-storey load.
The 3-X-axis layout keeps clear bay spans within the ~5m practical
limit for 230mm RCC. Footings are 1.2 × 1.2m × 0.5m pads (smaller
than 2BHK's 1.5 × 1.5 × 0.6m pads).

Z-coordinate discipline mirrors `_2bhk_pune_floor_unit.py`: every
wall, opening, sill Z is `elevation + offset`. ID discipline mirrors
2BHK: every node interpolates `name_prefix` so multiple copies stack
cleanly under unique IDs (e.g., "gf"/"ff" for the duplex,
"flat-s0" for the tower; the FLAT layout lives in
`_1bhk_pune_flat_floor_unit.py`).

Backward-compat naming for the duplex assembler:
  * Duplex GF passes name_prefix="gf", floor_slab_id="slab-ground",
    storey_id="storey-ground", stair_id="stair-gf-to-ff".
  * Duplex FF passes name_prefix="ff", floor_slab_id="slab-first",
    storey_id="storey-first".
"""

from __future__ import annotations

from app.domain.building_model import (
    Column,
    Footing,
    Slab,
    Stair,
    Vec2,
)
from app.templates._2bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    _perimeter_walls,
)
from app.templates._common import (
    FloorUnit,
    make_axis_aligned_room,
    make_door_pair,
    make_external_wall,
    make_internal_wall,
    make_isolated_pad_footing,
    make_rcc_column,
    make_rectangular_polygon_ccw,
    make_slab_layers,
    make_window_pair,
)


# ─── Geometric constants ─────────────────────────────────────────────

# 1BHK Pune relaxes front setback to 2.5m (PMC bylaws for plots ≤ 7.5m).
_FRONT_SETBACK_M_DEFAULT: float = 2.5
_REAR_SETBACK_M_DEFAULT: float = 1.5
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150

# 1BHK column / footing sizing — smaller than 2BHK because the smaller
# footprint, 2-storey RCC load, and 3-X-axis bay layout (max ~3.55m
# clear span) all stay well within 230mm RCC's structural envelope.
_COLUMN_SIZE_M: float = 0.230
_HALF_COL: float = _COLUMN_SIZE_M / 2.0
_FOOTING_HALF_SIDE_M: float = 0.6  # 1.2 × 1.2m pad

_MIN_BUILDABLE_WIDTH_M: float = 4.0
_MIN_BUILDABLE_DEPTH_M: float = 5.0

# Layout fractions (default plot 7.32 × 12.20, buildable 7.32 × 8.20).
# PV (vertical-partition) fractions are of buildable_width measured
# from buildable_x_min. PH (horizontal-partition) fractions are of
# buildable_depth measured from buildable_y_min (south).
#
# GF partition lines:
#   pv_x35: x=3.5  splits west zone (powder + kitchen) from east zone
#                  (utility + stair-foyer)
#   ph_y25: y=2.5  splits south service band (powder + utility) from
#                  mid band (kitchen + stair-foyer)
#   ph_y55: y=5.5  splits mid band from north living-dining
_PV_GF_X35_FRAC: float = 3.5 / 7.32
_PH_GF_Y25_FRAC: float = (2.5 - 1.5) / 8.20
_PH_GF_Y55_FRAC: float = (5.5 - 1.5) / 8.20

# FF partition lines:
#   pv_x35: x=3.5  splits master-bath from stair-landing in mid band
#   ph_y25: y=2.5  splits south study band from mid band
#   ph_y55: y=5.5  splits mid band from master-bedroom
#   ph_y85: y=8.5  splits master-bedroom from balcony (when has_balcony)
_PV_FF_X35_FRAC: float = 3.5 / 7.32
_PH_FF_Y25_FRAC: float = (2.5 - 1.5) / 8.20
_PH_FF_Y55_FRAC: float = (5.5 - 1.5) / 8.20
_PH_FF_Y85_FRAC: float = (8.5 - 1.5) / 8.20

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0


# ─── Buildable-region computation ────────────────────────────────────


def _buildable_bounds(
    plot_width_m: float,
    plot_length_m: float,
    front_setback_m: float,
    rear_setback_m: float,
    side_setback_m: float,
) -> tuple[float, float, float, float, float, float]:
    """Compute (xmin, xmax, ymin, ymax, width, depth) for the buildable region.

    Raises ValueError if the buildable area is below the layout's minimum
    (4.0 × 5.0m). The error includes the offending dimensions so callers
    get a clear diagnostic before the code reaches degenerate-geometry
    territory in the invariant checks.
    """
    buildable_x_min = side_setback_m
    buildable_x_max = plot_width_m - side_setback_m
    buildable_y_min = rear_setback_m
    buildable_y_max = plot_length_m - front_setback_m
    width = buildable_x_max - buildable_x_min
    depth = buildable_y_max - buildable_y_min
    if width < _MIN_BUILDABLE_WIDTH_M or depth < _MIN_BUILDABLE_DEPTH_M:
        raise ValueError(
            f"_buildable_bounds (1BHK): plot ({plot_width_m:.2f} m × "
            f"{plot_length_m:.2f} m) with setbacks (front "
            f"{front_setback_m:.1f}, rear {rear_setback_m:.1f}, side "
            f"{side_setback_m:.1f}) yields buildable {width:.2f} × "
            f"{depth:.2f} m; need at least {_MIN_BUILDABLE_WIDTH_M:.1f} × "
            f"{_MIN_BUILDABLE_DEPTH_M:.1f} m."
        )
    return (
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        width,
        depth,
    )


def _column_grid(
    buildable_x_min: float,
    buildable_x_max: float,
    buildable_y_min: float,
    buildable_y_max: float,
) -> tuple[list[float], list[float]]:
    """Return (x_axes, y_axes) for the 1BHK 3 × 3 RCC column grid (9 columns).

    Outer axes are inset by `_HALF_COL` from the buildable edges so the
    column body sits fully inside the buildable rectangle. Middle axis
    is the midpoint of the inset range. Equal-spaced bays in both
    directions on the default plot.
    """
    x_first = buildable_x_min + _HALF_COL
    x_last = buildable_x_max - _HALF_COL
    x_axes = [
        x_first,
        (x_first + x_last) / 2.0,
        x_last,
    ]
    y_first = buildable_y_min + _HALF_COL
    y_last = buildable_y_max - _HALF_COL
    y_axes = [
        y_first,
        (y_first + y_last) / 2.0,
        y_last,
    ]
    return x_axes, y_axes


# ─── 1BHK structural grid (230mm columns, 1.2m pads) ─────────────────


def make_1bhk_grid_columns_and_footings(
    *,
    x_axes: dict[str, float],
    y_axes: dict[str, float],
    column_base_z: float,
    column_top_z: float,
    footing_top_z: float,
    footing_bottom_z: float,
    host_storey_id: str,
) -> tuple[list[Column], list[Footing]]:
    """1BHK column + footing grid: 230×230mm columns, 1.2 × 1.2m pads.

    Mirrors `app.templates._common.make_rcc_grid_columns_and_footings`
    but threads through the 1BHK column / footing dimensions explicitly
    (the common helper uses 2BHK defaults of 300mm + 1.5m). Returns
    (columns, footings) sorted by id; column ids `col-{x_label}{y_label}`,
    footing ids `ftg-{x_label}{y_label}`.
    """
    if column_base_z != footing_top_z:
        raise ValueError(
            f"make_1bhk_grid_columns_and_footings: column_base_z "
            f"({column_base_z}) must equal footing_top_z "
            f"({footing_top_z}) so the placement resolver's footing "
            f"override is idempotent."
        )
    columns: list[Column] = []
    footings: list[Footing] = []
    for x_label, x_pos in x_axes.items():
        for y_label, y_pos in y_axes.items():
            location = Vec2(x=x_pos, y=y_pos)
            col_id = f"col-{x_label}{y_label}"
            ftg_id = f"ftg-{x_label}{y_label}"
            columns.append(
                make_rcc_column(
                    column_id=col_id,
                    host_storey_id=host_storey_id,
                    location=location,
                    base_z=column_base_z,
                    top_z=column_top_z,
                    width=_COLUMN_SIZE_M,
                    depth=_COLUMN_SIZE_M,
                )
            )
            footings.append(
                make_isolated_pad_footing(
                    footing_id=ftg_id,
                    supports_column_id=col_id,
                    location=location,
                    top_z=footing_top_z,
                    bottom_z=footing_bottom_z,
                    half_side=_FOOTING_HALF_SIDE_M,
                )
            )
    columns.sort(key=lambda c: c.id)
    footings.sort(key=lambda f: f.id)
    return columns, footings


# ─── GF floor-unit (kitchen-side of 1BHK duplex) ─────────────────────


def build_1bhk_pune_gf_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 7.32,
    plot_length_m: float = 12.20,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = 0.0,
    door_to_stair_outside: bool = True,
    stair_id: str | None = None,
    has_stair: bool = True,
) -> FloorUnit:
    """Build the GF-style floor of a 1BHK Pune duplex.

    5 rooms: powder, utility, kitchen, stair-foyer, living-dining. The
    stair-foyer hosts the optional stair to the storey above (when
    `has_stair=True`). The main entry door is on the NORTH wall and
    connects living-dining to "Outside" (`door_to_stair_outside=True`)
    or to the tower-core lobby sentinel (False).

    All Z-coordinates derive from `elevation`. All node IDs interpolate
    `name_prefix` so multiple copies stack cleanly.
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

    # ── Perimeter walls (CCW S→E→N→W) ──
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
    x_pv35 = buildable_x_min + buildable_width * _PV_GF_X35_FRAC
    y_p25 = buildable_y_min + buildable_depth * _PH_GF_Y25_FRAC
    y_p55 = buildable_y_min + buildable_depth * _PH_GF_Y55_FRAC

    # ── Partitions (5 segments) ──
    # Strategy:
    #   * ph-y25 split at pv-x35 (powder/kitchen reference -w; utility/
    #     stair-foyer reference -e). Without the split, each room would
    #     have to reference half of a longer wall — not supported by
    #     the make_axis_aligned_room CCW convention.
    #   * ph-y55 stays as ONE wall: living-dining is single full-width
    #     room above y=5.5; both kitchen and stair-foyer share its
    #     "right" side; living-dining shares its "left" side.
    #   * pv-x35 split at y_p25: powder references -s, kitchen references
    #     -n (same reasoning as ph-y25).
    partitions = [
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y25-w",
            name=f"Partition Y2.5 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p25),
            end=Vec2(x=x_pv35, y=y_p25),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y25-e",
            name=f"Partition Y2.5 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p25),
            end=Vec2(x=buildable_x_max, y=y_p25),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y55",
            name=f"Partition Y5.5 - {name_prefix.upper()} (mid/living)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p55),
            end=Vec2(x=buildable_x_max, y=y_p55),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35-s",
            name=f"Partition X3.5 South - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=buildable_y_min),
            end=Vec2(x=x_pv35, y=y_p25),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35-n",
            name=f"Partition X3.5 North - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p25),
            end=Vec2(x=x_pv35, y=y_p55),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv35_w = x_pv35 - _HALF_INT_WALL
    x_pv35_e = x_pv35 + _HALF_INT_WALL
    y_p25_s = y_p25 - _HALF_INT_WALL
    y_p25_n = y_p25 + _HALF_INT_WALL
    y_p55_s = y_p55 - _HALF_INT_WALL
    y_p55_n = y_p55 + _HALF_INT_WALL

    rooms = [
        # Powder (south-west service zone)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-powder",
            name="Powder Room", usage="toilet",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_s_inner, ymax=y_p25_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y25-w", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Utility & Wash (south-east service zone)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-utility",
            name="Utility & Wash", usage="utility",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p25_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y25-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35-s", "right"),
        ),
        # Kitchen (mid-west)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p25_n, ymax=y_p55_s,
            south_wall=(f"wall-{name_prefix}-ph-y25-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-n", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y55", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Stair & Foyer (mid-east, hosts optional stair)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-foyer",
            name="Stair & Foyer", usage="stair",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p25_n, ymax=y_p55_s,
            south_wall=(f"wall-{name_prefix}-ph-y25-e", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y55", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35-n", "right"),
        ),
        # Living-Dining (north band, full plot width)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living",
            xmin=x_w_inner, xmax=x_e_inner, ymin=y_p55_n, ymax=y_n_inner,
            south_wall=(f"wall-{name_prefix}-ph-y55", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-N", "left"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
    ]
    rooms.sort(key=lambda r: r.id)

    # ── Stair (optional) ──
    # Riser height computed from the structural rise so STAIR_RISE_MATCHES
    # holds at any floor_height. Default 3.0m → 19 × 0.150m = 2.85m.
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
                    x_pv35_e, x_e_inner, y_p25_n, y_p55_s
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

    # Door specs. Distance conventions per CCW wall direction:
    #   South: walked W→E, distance from west end (x - buildable_x_min)
    #   East:  walked S→N, distance from south end (y - buildable_y_min)
    #   North: walked E→W, distance from east end (buildable_x_max - x)
    #   West:  walked N→S, distance from north end (buildable_y_max - y)
    #   Horizontal partition: walked W→E, distance from start of segment
    #   Vertical partition:   walked S→N, distance from start of segment
    door_specs = [
        # 1. Main entry — N wall, into living-dining. Centered on the
        #    full plot width so it visually anchors the building.
        (
            f"door-{name_prefix}-main-entry",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-N",
            (buildable_x_max - buildable_x_min) / 2.0 - 0.5,
            1.0, 2.1, "inward", "right",
            [f"room-{name_prefix}-living-dining", outside_or_lobby],
        ),
        # 2. living-dining ↔ kitchen (ph-y55, west half).
        (
            f"door-{name_prefix}-living-kitchen",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y55",
            (x_pv35 - buildable_x_min) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-living-dining", f"room-{name_prefix}-kitchen"],
        ),
        # 3. living-dining ↔ stair-foyer (ph-y55, east half).
        (
            f"door-{name_prefix}-living-stair-foyer",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y55",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.375
            - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-living-dining",
                f"room-{name_prefix}-stair-foyer",
            ],
        ),
        # 4. kitchen ↔ stair-foyer (pv-x35-n). pv-x35-n axis runs
        #    y=y_p25 → y=y_p55; distance is from y=y_p25.
        (
            f"door-{name_prefix}-kitchen-stair-foyer",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-pv-x35-n",
            (y_p55 - y_p25) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-stair-foyer"],
        ),
        # 5. powder ↔ kitchen (ph-y25-w). Single segment x∈[0, x_pv35];
        #    door near west end so it doesn't conflict with the NE-corner
        #    kitchen counter run.
        (
            f"door-{name_prefix}-powder-kitchen",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-ph-y25-w",
            (x_pv35 - buildable_x_min) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-powder", f"room-{name_prefix}-kitchen"],
        ),
        # 6. utility ↔ stair-foyer (ph-y25-e). Single segment
        #    x∈[x_pv35, buildable_x_max].
        (
            f"door-{name_prefix}-utility-stair-foyer",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-ph-y25-e",
            (buildable_x_max - x_pv35) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-utility",
                f"room-{name_prefix}-stair-foyer",
            ],
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

    # Window specs. Living-dining gets two windows (large north + east);
    # kitchen + stair-foyer + powder + utility each get one perimeter
    # window for daylight + ventilation per NBC India §15.2.4.
    window_specs = [
        # 1. living-dining north (large picture window). Place in west
        #    half so it doesn't clash with the centered main-entry door.
        (
            f"window-{name_prefix}-living-north",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-N",
            (buildable_x_max - buildable_x_min) / 2.0 + 1.5 - 0.75,
            1.5, 1.5, sill_habit,
        ),
        # 2. living-dining east. CCW E goes south→north; living-dining
        #    occupies y ∈ [y_p55, buildable_y_max].
        (
            f"window-{name_prefix}-living-east",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-E",
            (y_p55 + buildable_y_max) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 3. kitchen west (counter-height).
        (
            f"window-{name_prefix}-kitchen-west",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p25 + y_p55) / 2.0 - 0.5,
            1.0, 1.2, sill_kitchen,
        ),
        # 4. stair-foyer east — daylights the stair shaft.
        (
            f"window-{name_prefix}-stair-foyer-east",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-E",
            (y_p25 + y_p55) / 2.0 - 0.4 - buildable_y_min,
            0.8, 1.2, sill_stair,
        ),
        # 5. powder south (small high-sill privacy).
        (
            f"window-{name_prefix}-powder-south",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-S",
            (x_pv35 - buildable_x_min) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        # 6. utility south.
        (
            f"window-{name_prefix}-utility-south",
            f"opening-{name_prefix}-w06",
            f"wall-{name_prefix}-S",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.4
            - buildable_x_min,
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


# ─── FF floor-unit (bedroom-side of 1BHK duplex) ─────────────────────


def build_1bhk_pune_ff_floor_unit(
    *,
    storey_id: str,
    storey_index: int,
    name_prefix: str,
    floor_slab_id: str,
    elevation: float,
    floor_height: float = 3.0,
    plot_width_m: float = 7.32,
    plot_length_m: float = 12.20,
    front_setback_m: float = _FRONT_SETBACK_M_DEFAULT,
    rear_setback_m: float = _REAR_SETBACK_M_DEFAULT,
    side_setback_m: float = 0.0,
    has_balcony: bool = True,
) -> FloorUnit:
    """Build the FF-style floor of a 1BHK Pune duplex.

    5 rooms (with balcony) / 4 rooms (without):

      study (south band, full width)
      master-bath (mid-west, en-suite)
      stair-landing (mid-east, where the GF stair arrives)
      master-bedroom (north band)
      balcony (north strip — when has_balcony=True)

    No stair on this floor — the building's stair is in the GF unit.
    No exterior doors — circulation comes through the stair-landing
    from below.

    `has_balcony=True` (default) emits a north-strip balcony with E/N/W
    perimeter walls in the balcony zone realised as `Wall(type="railing")`
    nodes (1.1m MS-Steel guard-rails). `has_balcony=False` extends
    master-bedroom to the north envelope and omits the y=8.5 partition
    + the bedroom-balcony sliding door.
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

    # ── Partition wall axes ──
    x_pv35 = buildable_x_min + buildable_width * _PV_FF_X35_FRAC
    y_p25 = buildable_y_min + buildable_depth * _PH_FF_Y25_FRAC
    y_p55 = buildable_y_min + buildable_depth * _PH_FF_Y55_FRAC
    y_p85 = buildable_y_min + buildable_depth * _PH_FF_Y85_FRAC

    # ── Perimeter walls ──
    # FF doesn't host a balcony with railings on the duplex (railings
    # belong to the FLAT layout used in the tower). FF's balcony, when
    # has_balcony=True, has a partition (ph-y85) inside the building
    # but the balcony's E/N/W perimeter remains FULL-HEIGHT external
    # walls. This matches the duplex visual style: a small brick-walled
    # balcony alcove at the north end of the upper floor. (Modern
    # railings on apartment-tower flats are handled in the FLAT unit.)
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

    # ── Partitions ──
    # ph-y25 (full width): study south of, master-bath + stair-landing
    #   north of. Two rooms share the "left" side of ph-y25 — same
    #   pattern as 2BHK FLAT's ph-y110.
    # pv-x35-m (single segment y∈[y_p25, y_p55]): splits master-bath
    #   from stair-landing.
    # ph-y55 (full width): mid-band rooms south of, master-bedroom
    #   north of.
    # ph-y85 (full width, has_balcony only): bedroom south of, balcony
    #   north of.
    partitions = [
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y25",
            name=f"Partition Y2.5 - {name_prefix.upper()} (study/mid)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p25),
            end=Vec2(x=buildable_x_max, y=y_p25),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35-m",
            name=f"Partition X3.5 Mid - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p25),
            end=Vec2(x=x_pv35, y=y_p55),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y55",
            name=f"Partition Y5.5 - {name_prefix.upper()} (mid/bedroom)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p55),
            end=Vec2(x=buildable_x_max, y=y_p55),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    if has_balcony:
        partitions.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-ph-y85",
                name=f"Partition Y8.5 - {name_prefix.upper()} (bedroom/balcony)",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p85),
                end=Vec2(x=buildable_x_max, y=y_p85),
                base_z=z_wall_base, top_z=z_wall_top,
            )
        )
    walls = sorted(perimeter + partitions, key=lambda w: w.id)

    # ── Room boundary insets ──
    x_w_inner = buildable_x_min + _HALF_EXT_WALL
    x_e_inner = buildable_x_max - _HALF_EXT_WALL
    y_s_inner = buildable_y_min + _HALF_EXT_WALL
    y_n_inner = buildable_y_max - _HALF_EXT_WALL
    x_pv35_w = x_pv35 - _HALF_INT_WALL
    x_pv35_e = x_pv35 + _HALF_INT_WALL
    y_p25_n = y_p25 + _HALF_INT_WALL
    y_p55_s = y_p55 - _HALF_INT_WALL
    y_p55_n = y_p55 + _HALF_INT_WALL
    y_p85_s = y_p85 - _HALF_INT_WALL
    y_p85_n = y_p85 + _HALF_INT_WALL

    # When no balcony, master-bedroom extends to north envelope. Its
    # north boundary is the perimeter wall (offset by half external
    # thickness). With balcony, north boundary is ph-y85 (interior).
    bedroom_north_inner = (
        y_p85 - _HALF_INT_WALL if has_balcony else y_n_inner
    )
    bedroom_north_wall = (
        f"wall-{name_prefix}-ph-y85" if has_balcony else f"wall-{name_prefix}-N"
    )
    # If has_balcony, bedroom is south of ph-y85 → "right" per convention.
    # If no balcony, bedroom borders the N perimeter (external wall, room
    # interior on "left").
    bedroom_north_side: str = "right" if has_balcony else "left"

    rooms = [
        # Study (south band, full width)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-study",
            name="Study", usage="study",
            xmin=x_w_inner, xmax=x_e_inner,
            ymin=y_s_inner, ymax=y_p25 - _HALF_INT_WALL,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y25", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Master Bathroom (mid-west, en-suite)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bath",
            name="Master Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p25_n, ymax=y_p55_s,
            south_wall=(f"wall-{name_prefix}-ph-y25", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-m", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y55", "right"),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
        # Stair Landing (mid-east, hosts vertical circulation arrival)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-stair-landing",
            name="Stair Landing", usage="stair",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p25_n, ymax=y_p55_s,
            south_wall=(f"wall-{name_prefix}-ph-y25", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y55", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35-m", "right"),
        ),
        # Master Bedroom (north band)
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bedroom",
            name="Master Bedroom", usage="bedroom",
            xmin=x_w_inner, xmax=x_e_inner,
            ymin=y_p55_n, ymax=bedroom_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y55", "left"),
            east_wall=(f"wall-{name_prefix}-E", "left"),
            north_wall=(bedroom_north_wall, bedroom_north_side),
            west_wall=(f"wall-{name_prefix}-W", "left"),
        ),
    ]
    if has_balcony:
        rooms.append(
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony",
                name="Balcony", usage="balcony",
                xmin=x_w_inner, xmax=x_e_inner,
                ymin=y_p85_n, ymax=y_n_inner,
                south_wall=(f"wall-{name_prefix}-ph-y85", "left"),
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
        # 1. master-bedroom ↔ stair-landing (ph-y55, east half).
        (
            f"door-{name_prefix}-bedroom-landing",
            f"opening-{name_prefix}-d01",
            f"wall-{name_prefix}-ph-y55",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.375
            - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-master-bedroom",
                f"room-{name_prefix}-stair-landing",
            ],
        ),
        # 2. master-bedroom ↔ master-bath (ph-y55, west half — en-suite).
        (
            f"door-{name_prefix}-bedroom-mbath",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y55",
            (x_pv35 - buildable_x_min) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-master-bedroom",
                f"room-{name_prefix}-master-bath",
            ],
        ),
        # 3. study ↔ stair-landing (ph-y25, east half).
        (
            f"door-{name_prefix}-study-landing",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y25",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.375
            - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-study",
                f"room-{name_prefix}-stair-landing",
            ],
        ),
    ]
    if has_balcony:
        # 4. master-bedroom ↔ balcony — sliding glass door on ph-y85,
        #    centered on the building.
        door_specs.append(
            (
                f"door-{name_prefix}-bedroom-balcony",
                f"opening-{name_prefix}-d04",
                f"wall-{name_prefix}-ph-y85",
                (buildable_x_max - buildable_x_min) / 2.0 - 0.75,
                1.5, 2.1, "sliding", "right",
                [
                    f"room-{name_prefix}-master-bedroom",
                    f"room-{name_prefix}-balcony",
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
    # Master bedroom gets east + west windows on perimeter (north is
    # interior partition when has_balcony; with no balcony, add a north
    # window). Master bath gets a small west privacy window. Study gets
    # a south window. Stair-landing gets an east window.
    bedroom_y_top = y_p85 if has_balcony else buildable_y_max
    window_specs = [
        # 1. master-bedroom east. CCW E goes south→north; bedroom
        #    occupies y ∈ [y_p55, bedroom_y_top].
        (
            f"window-{name_prefix}-master-east",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-E",
            (y_p55 + bedroom_y_top) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 2. master-bedroom west.
        (
            f"window-{name_prefix}-master-west",
            f"opening-{name_prefix}-w02",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p55 + bedroom_y_top) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 3. master-bath west — small high-sill privacy.
        (
            f"window-{name_prefix}-mbath-west",
            f"opening-{name_prefix}-w03",
            f"wall-{name_prefix}-W",
            buildable_y_max - (y_p25 + y_p55) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        # 4. study south.
        (
            f"window-{name_prefix}-study-south",
            f"opening-{name_prefix}-w04",
            f"wall-{name_prefix}-S",
            (buildable_x_max - buildable_x_min) / 2.0 - 0.6,
            1.2, 1.2, sill_habit,
        ),
        # 5. stair-landing east.
        (
            f"window-{name_prefix}-landing-east",
            f"opening-{name_prefix}-w05",
            f"wall-{name_prefix}-E",
            (y_p25 + y_p55) / 2.0 - 0.4 - buildable_y_min,
            0.8, 1.2, sill_habit,
        ),
    ]
    if not has_balcony:
        # Without balcony the bedroom borders the N perimeter — add a
        # north window so the room has cross-ventilation matching the
        # has_balcony case (where bedroom→balcony→outside provides air).
        window_specs.append(
            (
                f"window-{name_prefix}-master-north",
                f"opening-{name_prefix}-w06",
                f"wall-{name_prefix}-N",
                (buildable_x_max - buildable_x_min) / 2.0 - 0.75,
                1.5, 1.5, sill_habit,
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
    "build_1bhk_pune_gf_floor_unit",
    "build_1bhk_pune_ff_floor_unit",
    "make_1bhk_grid_columns_and_footings",
]
