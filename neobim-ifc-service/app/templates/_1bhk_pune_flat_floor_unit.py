"""Phase T2.1 Phase B — Single-floor 1BHK FLAT floor unit.

Layer-2 builder for a complete 1BHK flat on ONE storey. Used by the
1BHK tower assembler (Phase E) — one FLAT FloorUnit per habitable
floor, glued onto the side-core's east edge.

Layout (default plot 7.32 × 12.20m, has_balcony=True):

    N (y=9.70)  ┌────────────────────────────────┐
                │           BALCONY              │  railings on E/N/W
    y=8.70      ├──────────────────┬─────────────┤
                │                  │             │
                │   BATH (5.1)     │             │
                │                  │             │
    y=7.00      ├──────────────────┤  BEDROOM    │
                │                  │  (18.14)    │
                │   KITCHEN (7.5)  │             │
                │                  │             │
    y=4.50      ├──────────────────┴─────────────┤
                │                                │
                │     LIVING-DINING (21.96)      │   ← main entry east
                │                                │
    y=1.50      └────────────────────────────────┘
                x=0.0   x=3.0                   x=7.32

Differences from the 2BHK FLAT (`_2bhk_pune_flat_floor_unit.py`):

  * 5 rooms (vs 7 in 2BHK FLAT). 1 bedroom + 1 bath + balcony, no
    second bedroom or master-bath split.
  * Bath is en-suite from bedroom (door on pv-x30) — no separate
    common-bath accessed from living. Reflects the typical Pune
    1BHK pattern where the single bath serves the bedroom.
  * Vertical partition at x=3.0 (1BHK) vs x=3.5 (2BHK) — 1BHK is
    narrower and the kitchen+bath strip is correspondingly tighter.
  * 3-axis Y partition (ph-y45 / ph-y70-w / ph-y87) vs 2BHK FLAT's
    4-axis (ph-y45 / ph-y75 / ph-y85 / ph-y110).

Per-floor element counts (default plot, has_balcony=True):

    walls=10, rooms=5, slabs=1, openings=10, doors=5, windows=5

With has_balcony=False:

    walls=7, rooms=4, slabs=1, openings=10, doors=4, windows=6

Modern balcony railings (Slice T2.0.1.2 pattern carried forward):
the E-n / N / W-n perimeter segments are emitted as Wall(type="railing")
nodes — 1.1m MS-Steel guard-rails, 50mm thick. The IFC builder
dispatches these to IfcRailing entities.

Entry door: on the EAST perimeter wall (E-s when has_balcony=True;
E without). The tower assembler wires this door to the side-core
lobby that sits east of the flat by substituting the
`TOWER_CORE_LOBBY_SENTINEL` value in `connects_room_ids`.
"""

from __future__ import annotations

from app.domain.building_model import (
    MaterialLayer,
    Slab,
    Vec2,
    Wall,
)
from app.templates._1bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    _buildable_bounds,
    _column_grid,
)
from app.templates._2bhk_pune_floor_unit import _perimeter_walls
from app.templates._common import (
    FloorUnit,
    make_axis_aligned_room,
    make_door_pair,
    make_external_wall,
    make_internal_wall,
    make_rectangular_polygon_ccw,
    make_slab_layers,
    make_window_pair,
)


# ─── Geometric constants ─────────────────────────────────────────────

_FRONT_SETBACK_M_DEFAULT: float = 2.5
_REAR_SETBACK_M_DEFAULT: float = 1.5
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150

# Layout fractions (default plot 7.32 × 12.20, buildable 7.32 × 8.20).
# PV (vertical) fractions of buildable_width; PH (horizontal) fractions
# of buildable_depth measured from buildable_y_min (south).
_PV_FLAT_X30_FRAC: float = 3.0 / 7.32          # bath/kitchen vs bedroom
_PH_FLAT_Y45_FRAC: float = (4.5 - 1.5) / 8.20  # living-dining vs mid band
_PH_FLAT_Y70_FRAC: float = (7.0 - 1.5) / 8.20  # kitchen vs bath (west only)
_PH_FLAT_Y87_FRAC: float = (8.7 - 1.5) / 8.20  # bedroom vs balcony

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0

# Modern Indian apartment balcony railings (post-2010 mid-segment
# Pune). NBC India §15 guard-rail minimum is 0.9m; 1.1m is the
# standard-issue mid-rise residential height. MS Steel = mild steel
# panel infill.
_BALCONY_RAILING_HEIGHT_M: float = 1.1
_BALCONY_RAILING_THICKNESS_M: float = 0.050
_BALCONY_RAILING_MATERIAL: str = "MS-Steel"
_HALF_BALCONY_RAILING: float = _BALCONY_RAILING_THICKNESS_M / 2.0


def build_1bhk_pune_flat_floor_unit(
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
    has_balcony: bool = True,
) -> FloorUnit:
    """Build a single-floor 1BHK Pune FLAT.

    Returns a `FloorUnit` ready for stitching by the Layer-3 building
    assembler. The tower assembler (Phase E) calls this once per
    habitable storey, passing `door_to_stair_outside=False` so the main
    entry's `connects_room_ids` carries the tower-core lobby sentinel
    (substituted by the assembler with the actual lobby Room id).

    Z-coordinate discipline: every wall, opening, sill Z is `elevation +
    offset`. ID discipline: every node interpolates `name_prefix` so
    multiple copies stack uniquely in a tower.
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
    z_railing_top = elevation + _BALCONY_RAILING_HEIGHT_M
    sill_habit = elevation + 0.9
    sill_kitchen = elevation + 1.2
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

    # ── Partition wall axes (scale with plot) ──
    x_pv30 = buildable_x_min + buildable_width * _PV_FLAT_X30_FRAC
    y_p45 = buildable_y_min + buildable_depth * _PH_FLAT_Y45_FRAC
    y_p70 = buildable_y_min + buildable_depth * _PH_FLAT_Y70_FRAC
    y_p87 = buildable_y_min + buildable_depth * _PH_FLAT_Y87_FRAC

    # ── Perimeter walls ──
    # When has_balcony=True, E and W are split at y=y_p87 into a south
    # full-height brick segment + a north railing segment (1.1m MS-Steel
    # guard-rail). N becomes a railing too. South stays full brick.
    # When has_balcony=False, perimeter is the standard CCW S/E/N/W.
    sw = Vec2(x=buildable_x_min, y=buildable_y_min)
    se = Vec2(x=buildable_x_max, y=buildable_y_min)
    ne = Vec2(x=buildable_x_max, y=buildable_y_max)
    nw = Vec2(x=buildable_x_min, y=buildable_y_max)

    def _railing(wall_id: str, name: str, start: Vec2, end: Vec2) -> Wall:
        """Inline factory: thin Wall(type='railing') for balcony guard-rails.

        IFC builder dispatches Wall(type='railing') to IfcRailing entities
        with PredefinedType=GUARDRAIL. Single MaterialLayer (MS-Steel)
        sums to wall.thickness so the layer-validity invariants pass.
        """
        return Wall(
            id=wall_id,
            name=name,
            host_storey_ids=[storey_id],
            axis_points=[start, end],
            base_z=z_wall_base,
            top_z=z_railing_top,
            thickness=_BALCONY_RAILING_THICKNESS_M,
            layers=[
                MaterialLayer(
                    material_name=_BALCONY_RAILING_MATERIAL,
                    thickness=_BALCONY_RAILING_THICKNESS_M,
                    function="core",
                ),
            ],
            type="railing",
            is_external=True,
            is_load_bearing=False,
        )

    if has_balcony:
        suffix = name_prefix.upper()
        perimeter = [
            make_external_wall(
                wall_id=f"wall-{name_prefix}-S",
                name=f"External Wall South - {suffix}",
                host_storey_id=storey_id,
                start=sw, end=se,
                base_z=z_wall_base, top_z=z_wall_top,
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-E-s",
                name=f"External Wall East South - {suffix}",
                host_storey_id=storey_id,
                start=se, end=Vec2(x=buildable_x_max, y=y_p87),
                base_z=z_wall_base, top_z=z_wall_top,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-E-n",
                name=f"Balcony Railing East - {suffix}",
                start=Vec2(x=buildable_x_max, y=y_p87), end=ne,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-N",
                name=f"Balcony Railing North - {suffix}",
                start=ne, end=nw,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-W-n",
                name=f"Balcony Railing West - {suffix}",
                start=nw, end=Vec2(x=buildable_x_min, y=y_p87),
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-W-s",
                name=f"External Wall West South - {suffix}",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p87), end=sw,
                base_z=z_wall_base, top_z=z_wall_top,
            ),
        ]
    else:
        perimeter = _perimeter_walls(
            name_prefix=name_prefix,
            storey_id=storey_id,
            base_z=z_wall_base, top_z=z_wall_top,
            sw=sw, se=se, ne=ne, nw=nw,
        )

    # When has_balcony=False, pv-x30 extends to the N envelope (no
    # ph-y87 stop); ph-y87 is omitted entirely.
    y_pv30_top = y_p87 if has_balcony else buildable_y_max

    partitions = [
        # ph-y45 (full width — splits living-dining from mid band).
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y45",
            name=f"Partition Y4.5 - {name_prefix.upper()} (living/mid)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p45),
            end=Vec2(x=buildable_x_max, y=y_p45),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x30 (single segment from y_p45 to y_pv30_top — splits
        # kitchen+bath west zone from bedroom east zone).
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x30",
            name=f"Partition X3.0 - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv30, y=y_p45),
            end=Vec2(x=x_pv30, y=y_pv30_top),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y70-w (west zone only — splits kitchen from bath).
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y70-w",
            name=f"Partition Y7.0 West - {name_prefix.upper()} (kitchen/bath)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p70),
            end=Vec2(x=x_pv30, y=y_p70),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    if has_balcony:
        # ph-y87 (full width — splits bath/bedroom from balcony). NOT
        # split at pv-x30: the balcony spans full width as one Room,
        # so it must reference ONE wall per side.
        partitions.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-ph-y87",
                name=f"Partition Y8.7 - {name_prefix.upper()} (under balcony)",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p87),
                end=Vec2(x=buildable_x_max, y=y_p87),
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
    y_p45_s = y_p45 - _HALF_INT_WALL
    y_p45_n = y_p45 + _HALF_INT_WALL
    y_p70_s = y_p70 - _HALF_INT_WALL
    y_p70_n = y_p70 + _HALF_INT_WALL
    y_p87_n = y_p87 + _HALF_INT_WALL

    # When no balcony, bath + bedroom extend to N envelope (perimeter).
    # When balcony, they border ph-y87 (interior partition).
    if has_balcony:
        bath_north_inner = y_p87 - _HALF_INT_WALL
        bath_north_wall = f"wall-{name_prefix}-ph-y87"
        bath_north_side = "right"
        bedroom_north_inner = y_p87 - _HALF_INT_WALL
        bedroom_north_wall = f"wall-{name_prefix}-ph-y87"
        bedroom_north_side = "right"
    else:
        bath_north_inner = y_n_inner
        bath_north_wall = f"wall-{name_prefix}-N"
        bath_north_side = "left"
        bedroom_north_inner = y_n_inner
        bedroom_north_wall = f"wall-{name_prefix}-N"
        bedroom_north_side = "left"

    # When has_balcony=True, E and W are split at y=y_p87. Rooms south
    # of the partition use the *-s segments; balcony uses *-n (railings).
    e_wall_south = f"wall-{name_prefix}-E-s" if has_balcony else f"wall-{name_prefix}-E"
    w_wall_south = f"wall-{name_prefix}-W-s" if has_balcony else f"wall-{name_prefix}-W"
    e_wall_north_railing = f"wall-{name_prefix}-E-n"  # only when has_balcony=True
    w_wall_north_railing = f"wall-{name_prefix}-W-n"  # only when has_balcony=True

    rooms = [
        # Living-Dining (south band, full plot width).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living",
            xmin=x_w_inner, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p45_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y45", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        # Kitchen (mid-west south).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_w_inner, xmax=x_pv30_w, ymin=y_p45_n, ymax=y_p70_s,
            south_wall=(f"wall-{name_prefix}-ph-y45", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x30", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y70-w", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        # Bath (mid-west north). Extends to N envelope when no balcony.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bath",
            name="Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv30_w,
            ymin=y_p70_n, ymax=bath_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y70-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x30", "left"),
            north_wall=(bath_north_wall, bath_north_side),
            west_wall=(w_wall_south, "left"),
        ),
        # Bedroom (mid+upper east, full y span from y_p45 to north
        # boundary). Extends to N envelope when no balcony.
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom",
            name="Bedroom", usage="bedroom",
            xmin=x_pv30_e, xmax=x_e_inner,
            ymin=y_p45_n, ymax=bedroom_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y45", "right"),
            east_wall=(e_wall_south, "left"),
            north_wall=(bedroom_north_wall, bedroom_north_side),
            west_wall=(f"wall-{name_prefix}-pv-x30", "right"),
        ),
    ]
    if has_balcony:
        # Balcony: railings on E/N/W. Use the half-railing offset (0.025m)
        # for footprint corners on those edges so the room's polygon
        # matches what the ROOM_BOUNDED corner-resolver computes from
        # the railing's thinner axis offset.
        balcony_x_w = buildable_x_min + _HALF_BALCONY_RAILING
        balcony_x_e = buildable_x_max - _HALF_BALCONY_RAILING
        balcony_y_n = buildable_y_max - _HALF_BALCONY_RAILING
        rooms.append(
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony",
                name="Balcony", usage="balcony",
                xmin=balcony_x_w, xmax=balcony_x_e,
                ymin=y_p87_n, ymax=balcony_y_n,
                south_wall=(f"wall-{name_prefix}-ph-y87", "left"),
                east_wall=(e_wall_north_railing, "left"),
                north_wall=(f"wall-{name_prefix}-N", "left"),
                west_wall=(w_wall_north_railing, "left"),
            )
        )
    rooms.sort(key=lambda r: r.id)

    # ── Doors ──
    outside_or_lobby = (
        "Outside" if door_to_stair_outside else TOWER_CORE_LOBBY_SENTINEL
    )
    openings: list = []
    doors: list = []
    windows: list = []

    door_specs = [
        # 1. Main entry — east wall (E-s when has_balcony=True; E
        #    without). CCW E goes south→north; distance grows from se.
        #    Door centered in living-dining y range [y_min, y_p45].
        (
            f"door-{name_prefix}-main-entry",
            f"opening-{name_prefix}-d01",
            e_wall_south,
            (y_p45 - buildable_y_min) / 2.0 - 0.5,
            1.0, 2.1, "inward", "right",
            [f"room-{name_prefix}-living-dining", outside_or_lobby],
        ),
        # 2. living-dining ↔ kitchen on ph-y45, west half.
        (
            f"door-{name_prefix}-living-kitchen",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y45",
            (x_pv30 - buildable_x_min) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-living-dining",
                f"room-{name_prefix}-kitchen",
            ],
        ),
        # 3. living-dining ↔ bedroom on ph-y45, east half.
        (
            f"door-{name_prefix}-living-bedroom",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y45",
            x_pv30 + (buildable_x_max - x_pv30) / 2.0 - 0.375
            - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-living-dining",
                f"room-{name_prefix}-bedroom",
            ],
        ),
        # 4. bath ↔ bedroom on pv-x30 (en-suite). pv-x30 walked S→N
        #    from y=y_p45. Bath shares east edge with bedroom in
        #    y∈[y_p70, y_pv30_top].
        (
            f"door-{name_prefix}-bath-bedroom",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-pv-x30",
            (y_p70 + y_pv30_top) / 2.0 - y_p45 - 0.35,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-bath",
                f"room-{name_prefix}-bedroom",
            ],
        ),
    ]
    if has_balcony:
        # 5. bedroom ↔ balcony — sliding glass on ph-y87, centered in
        #    bedroom's east-half x range.
        door_specs.append(
            (
                f"door-{name_prefix}-bedroom-balcony",
                f"opening-{name_prefix}-d05",
                f"wall-{name_prefix}-ph-y87",
                x_pv30 + (buildable_x_max - x_pv30) / 2.0 - 0.75
                - buildable_x_min,
                1.5, 2.1, "sliding", "right",
                [
                    f"room-{name_prefix}-bedroom",
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
    # E and W windows reference the south-segment walls (e_wall_south /
    # w_wall_south) — when has_balcony=True these are E-s / W-s with
    # axes starting at y=y_p87 (W-s walked N→S). When has_balcony=False
    # they're the unsplit E / W with axes spanning the full plot length.
    w_wall_start_y = y_p87 if has_balcony else buildable_y_max
    bedroom_north_y = y_p87 if has_balcony else buildable_y_max
    bath_north_y = y_p87 if has_balcony else buildable_y_max

    window_specs = [
        # 1. living-dining south — large picture window, centered on the
        #    south facade.
        (
            f"window-{name_prefix}-living-south",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-S",
            (buildable_x_max - buildable_x_min) / 2.0 - 0.75,
            1.5, 1.5, sill_habit,
        ),
        # 2. living-dining west.
        (
            f"window-{name_prefix}-living-west",
            f"opening-{name_prefix}-w02",
            w_wall_south,
            w_wall_start_y - (buildable_y_min + y_p45) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 3. kitchen west — counter window.
        (
            f"window-{name_prefix}-kitchen-west",
            f"opening-{name_prefix}-w03",
            w_wall_south,
            w_wall_start_y - (y_p45 + y_p70) / 2.0 - 0.5,
            1.0, 1.2, sill_kitchen,
        ),
        # 4. bath west — small high-sill privacy window.
        (
            f"window-{name_prefix}-bath-west",
            f"opening-{name_prefix}-w04",
            w_wall_south,
            w_wall_start_y - (y_p70 + bath_north_y) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        # 5. bedroom east. Bedroom y range [y_p45, bedroom_north_y].
        (
            f"window-{name_prefix}-bedroom-east",
            f"opening-{name_prefix}-w05",
            e_wall_south,
            (y_p45 + bedroom_north_y) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
    ]
    if not has_balcony:
        # Bedroom borders N perimeter when no balcony. Add a north
        # window centered in bedroom's east-half x range so the room
        # retains cross-ventilation (mirrors the 1BHK FF logic).
        window_specs.append(
            (
                f"window-{name_prefix}-bedroom-north",
                f"opening-{name_prefix}-w06",
                f"wall-{name_prefix}-N",
                (buildable_x_max - x_pv30) / 2.0 - 0.75,
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


__all__ = ["build_1bhk_pune_flat_floor_unit"]
