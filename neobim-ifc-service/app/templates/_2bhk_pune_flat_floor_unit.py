"""Slice T2.0 Phase E0 — Single-floor 2BHK FLAT floor unit.

Layer-2 builder for a complete 2BHK flat on ONE storey. Unlike the duplex
GF/FF units (which each contain HALF a 2BHK), this unit packs all the
rooms a Pune compact 2BHK flat needs into a single floor:

  living-dining (south band, full width)
  kitchen (mid band, west of pv-x35)
  bedroom-2 (mid band, east of pv-x35)
  common-bath (upper-mid band, west of pv-x35, north of y=7.5)
  master-bedroom (upper band, east of pv-x35)
  master-bath (upper band, west of pv-x35, north of y=8.5)
  balcony (north strip, full width — has_balcony toggle)

Entry door is on the EAST perimeter wall (so the tower assembler can wire
it directly to the side-core lobby that sits east of the flat). For
non-tower use (e.g., a ground-floor flat in a small apartment block) the
east-wall entry still works architecturally.

Key differences from the GF / FF floor units:

  * One self-contained 2BHK (vs each unit being HALF a duplex).
  * Entry on east wall (vs north on the duplex GF main entry).
  * No stair (the tower's vertical circulation lives in the side-core,
    not in the flat). This unit therefore has no `has_stair` parameter.
  * `has_balcony` toggle works the same as on FF: True (default) emits
    a north-strip balcony room + the master-bedroom-to-balcony sliding
    door + the y=11.0 partition wall. False omits all three and lets
    the master-bath/master-bedroom extend to the north envelope edge.

Per-floor element counts (default plot 7.32 × 15.24, has_balcony=True):
  walls=12, rooms=7, slabs=1, openings=15, doors=8, windows=7.
With has_balcony=False: walls=11, rooms=6, doors=7 (no balcony door),
windows=7 (balcony has no windows anyway).

Both density profiles satisfy the per-storey rule "≥ GF unit's per-floor
counts" for the default-True case; the opt-in False case is documented
as a layout variant.
"""

from __future__ import annotations

from app.domain.building_model import (
    MaterialLayer,
    Slab,
    Vec2,
    Wall,
)
from app.templates._2bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    _buildable_bounds,
    _column_grid,
)
from app.templates._common import (
    FloorUnit,
    _perimeter_walls,
    make_axis_aligned_room,
    make_door_pair,
    make_external_wall,
    make_internal_wall,
    make_rectangular_polygon_ccw,
    make_slab_layers,
    make_window_pair,
)


# ─── Geometric constants (mirrored from the duplex floor-unit module) ─

_FRONT_SETBACK_M_DEFAULT: float = 3.0
_REAR_SETBACK_M_DEFAULT: float = 1.5
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150

# Layout fractions for the FLAT layout (default plot 7.32 × 10.74 buildable).
# Vertical-partition fraction is of buildable_width; horizontal fractions
# are of buildable_depth measured from buildable_y_min (south).
_PV_FLAT_X35_FRAC: float = 3.5 / 7.32          # main W/E divider
_PH_FLAT_Y45_FRAC: float = (4.5 - 1.5) / 10.74  # above living-dining
_PH_FLAT_Y75_FRAC: float = (7.5 - 1.5) / 10.74  # above kitchen + bedroom-2
_PH_FLAT_Y85_FRAC: float = (8.5 - 1.5) / 10.74  # above common-bath (west only)
_PH_FLAT_Y110_FRAC: float = (11.0 - 1.5) / 10.74  # above main rooms / under balcony

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0

# Slice T2.0.1.2 — Balcony railings (replaces parapet walls).
# Modern Indian apartments (post-2010) use metal or glass guard-rails on
# balconies, not brick parapets. Default railing material is "MS Steel"
# (mild-steel infill panels, common in mid-segment Pune). Railings are
# emitted as Wall(type="railing") nodes that the IFC builder dispatches
# to `app/services/railing_builder.py` → IfcRailing entities.
_BALCONY_RAILING_HEIGHT_M: float = 1.1   # NBC India guard-rail min 0.9; 1.1 standard
_BALCONY_RAILING_THICKNESS_M: float = 0.050  # 50 mm metal panel
_BALCONY_RAILING_MATERIAL: str = "MS-Steel"
_HALF_BALCONY_RAILING: float = _BALCONY_RAILING_THICKNESS_M / 2.0


def build_2bhk_pune_flat_floor_unit(
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
    has_balcony: bool = True,
) -> FloorUnit:
    """Build a single-floor 2BHK Pune FLAT.

    Used by the tower assembler (one flat per habitable floor). Returns
    a `FloorUnit` ready for stitching by the Layer-3 building assembler.

    Z-coordinate discipline: every wall, opening, sill Z is `elevation +
    offset`. ID discipline: every wall / room / opening / door / window /
    slab interpolates `name_prefix` so multiple copies stack uniquely
    in a tower.

    The main entry door is on the EAST perimeter wall, connecting
    living-dining to "Outside" (when door_to_stair_outside=True) or to
    `TOWER_CORE_LOBBY_SENTINEL` (when False — tower assembler then
    substitutes the actual lobby room id).
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
    x_pv35 = buildable_x_min + buildable_width * _PV_FLAT_X35_FRAC
    y_p45 = buildable_y_min + buildable_depth * _PH_FLAT_Y45_FRAC
    y_p75 = buildable_y_min + buildable_depth * _PH_FLAT_Y75_FRAC
    y_p85 = buildable_y_min + buildable_depth * _PH_FLAT_Y85_FRAC
    y_p110 = buildable_y_min + buildable_depth * _PH_FLAT_Y110_FRAC

    # ── Perimeter walls ──
    # Slice T2.0.1 fix for visual bug 1: when has_balcony=True, the
    # perimeter walls bordering the balcony zone (E-north, N, W-north)
    # are emitted at parapet height instead of full storey height. From
    # the IFC viewer: balcony reads as an open-air space with railings,
    # not as a fully-walled room. E and W are split at y=y_p110; the
    # south portions stay full-height (bordering bedrooms / baths).
    sw = Vec2(x=buildable_x_min, y=buildable_y_min)
    se = Vec2(x=buildable_x_max, y=buildable_y_min)
    ne = Vec2(x=buildable_x_max, y=buildable_y_max)
    nw = Vec2(x=buildable_x_min, y=buildable_y_max)
    z_railing_top = elevation + _BALCONY_RAILING_HEIGHT_M

    def _railing(wall_id: str, name: str, start: Vec2, end: Vec2) -> Wall:
        """Inline factory: thin Wall(type="railing") for balcony guard-rails.

        IFC builder dispatches Wall(type="railing") to the IfcRailing
        builder. Single-material layer (MS Steel) sums to wall.thickness.
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
        # Slice T2.0.1.2: 3 walls (S/E-s/W-s, full perimeter brick) +
        # 3 railings (E-n/N/W-n, modern MS-steel guard-rails at 1.1m).
        # Total: 6 perimeter elements (matches pre-railing wall count).
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
                start=se, end=Vec2(x=buildable_x_max, y=y_p110),
                base_z=z_wall_base, top_z=z_wall_top,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-E-n",
                name=f"Balcony Railing East - {suffix}",
                start=Vec2(x=buildable_x_max, y=y_p110), end=ne,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-N",
                name=f"Balcony Railing North - {suffix}",
                start=ne, end=nw,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-W-n",
                name=f"Balcony Railing West - {suffix}",
                start=nw, end=Vec2(x=buildable_x_min, y=y_p110),
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-W-s",
                name=f"External Wall West South - {suffix}",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p110), end=sw,
                base_z=z_wall_base, top_z=z_wall_top,
            ),
        ]
    else:
        # No balcony: 4 standard CCW perimeter walls at full height.
        perimeter = _perimeter_walls(
            name_prefix=name_prefix,
            storey_id=storey_id,
            base_z=z_wall_base,
            top_z=z_wall_top,
            sw=sw, se=se, ne=ne, nw=nw,
        )

    # When has_balcony=False, master-bath / master-bedroom extend to
    # the north envelope; the y=11.0 partition is omitted, and pv-x35-n
    # extends to the envelope rather than stopping at y=11.0.
    y_pv35_n_top = y_p110 if has_balcony else buildable_y_max

    partitions = [
        # ph-y45 split at x_pv35 (above living-dining)
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y45-w",
            name=f"Partition Y4.5 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p45),
            end=Vec2(x=x_pv35, y=y_p45),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y45-e",
            name=f"Partition Y4.5 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p45),
            end=Vec2(x=buildable_x_max, y=y_p45),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y75 split at x_pv35 (above kitchen / bedroom-2)
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y75-w",
            name=f"Partition Y7.5 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p75),
            end=Vec2(x=x_pv35, y=y_p75),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y75-e",
            name=f"Partition Y7.5 East - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p75),
            end=Vec2(x=buildable_x_max, y=y_p75),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y85-w (west only — separates common-bath from master-bath)
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y85-w",
            name=f"Partition Y8.5 West - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p85),
            end=Vec2(x=x_pv35, y=y_p85),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x35 split at y_p75 (the only place we can split it without
        # forcing master-bedroom to reference two collinear segments)
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35-s",
            name=f"Partition X3.5 South - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p45),
            end=Vec2(x=x_pv35, y=y_p75),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35-n",
            name=f"Partition X3.5 North - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p75),
            end=Vec2(x=x_pv35, y=y_pv35_n_top),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    if has_balcony:
        # ph-y110 — full-width single wall (NOT split, otherwise balcony
        # would have to reference 2 collinear segments).
        partitions.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-ph-y110",
                name=f"Partition Y11.0 - {name_prefix.upper()} (under balcony)",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p110),
                end=Vec2(x=buildable_x_max, y=y_p110),
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
    y_p45_s = y_p45 - _HALF_INT_WALL
    y_p45_n = y_p45 + _HALF_INT_WALL
    y_p75_s = y_p75 - _HALF_INT_WALL
    y_p75_n = y_p75 + _HALF_INT_WALL
    y_p85_s = y_p85 - _HALF_INT_WALL
    y_p85_n = y_p85 + _HALF_INT_WALL
    y_p110_s = y_p110 - _HALF_INT_WALL
    y_p110_n = y_p110 + _HALF_INT_WALL

    # When no balcony, master-bath/master-bedroom extend to the north
    # envelope wall; their north boundary is the perimeter wall (offset
    # by half external thickness).
    master_north_inner = y_p110_s if has_balcony else y_n_inner
    master_north_wall = (
        f"wall-{name_prefix}-ph-y110" if has_balcony else f"wall-{name_prefix}-N"
    )
    # If balcony exists, master-bath / master-bedroom border ph-y110 (room
    # is south of ph-y110 → "right" side per the convention). If no
    # balcony, they border the north perimeter (room interior on the
    # left of the CCW-walked external wall).
    master_north_side: str = "right" if has_balcony else "left"

    # Slice T2.0.1: when has_balcony=True, E and W are split at y=y_p110.
    # Rooms south of the partition use the *-s segments; balcony uses *-n.
    e_wall_south = f"wall-{name_prefix}-E-s" if has_balcony else f"wall-{name_prefix}-E"
    w_wall_south = f"wall-{name_prefix}-W-s" if has_balcony else f"wall-{name_prefix}-W"
    e_wall_north_parapet = f"wall-{name_prefix}-E-n"   # only used when has_balcony=True
    w_wall_north_parapet = f"wall-{name_prefix}-W-n"   # only used when has_balcony=True

    rooms = [
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living",
            xmin=x_w_inner, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p45_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y45-w", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p45_n, ymax=y_p75_s,
            south_wall=(f"wall-{name_prefix}-ph-y45-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-s", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y75-w", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-2",
            name="Bedroom 2", usage="bedroom",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p45_n, ymax=y_p75_s,
            south_wall=(f"wall-{name_prefix}-ph-y45-e", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y75-e", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35-s", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-common-bath",
            name="Common Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p75_n, ymax=y_p85_s,
            south_wall=(f"wall-{name_prefix}-ph-y75-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-n", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y85-w", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bedroom",
            name="Master Bedroom", usage="bedroom",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p75_n, ymax=master_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y75-e", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(master_north_wall, master_north_side),
            west_wall=(f"wall-{name_prefix}-pv-x35-n", "right"),
        ),
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bath",
            name="Master Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p85_n, ymax=master_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y85-w", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35-n", "left"),
            north_wall=(master_north_wall, master_north_side),
            west_wall=(w_wall_south, "left"),
        ),
    ]
    if has_balcony:
        # Slice T2.0.1.2 — balcony's E / N / W are railings (50 mm thick),
        # not full-thickness external walls. Use the thin half-thickness
        # offset (0.025 m) for the balcony's footprint-polygon corners
        # so they match what the ROOM_BOUNDED corner-resolver computes
        # from the railing offset axes.
        balcony_x_w = buildable_x_min + _HALF_BALCONY_RAILING
        balcony_x_e = buildable_x_max - _HALF_BALCONY_RAILING
        balcony_y_n = buildable_y_max - _HALF_BALCONY_RAILING
        rooms.append(
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony",
                name="Balcony", usage="balcony",
                xmin=balcony_x_w, xmax=balcony_x_e,
                ymin=y_p110_n, ymax=balcony_y_n,
                south_wall=(f"wall-{name_prefix}-ph-y110", "left"),
                east_wall=(e_wall_north_parapet, "left"),
                north_wall=(f"wall-{name_prefix}-N", "left"),
                west_wall=(w_wall_north_parapet, "left"),
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

    # Slice T2.0.1: when has_balcony=True, the W-s perimeter wall starts
    # at y=y_p110 (north end of W-s axis), not at y=buildable_y_max. So
    # window distance formulas on W reference w_wall_start_y instead of
    # buildable_y_max.
    w_wall_start_y = y_p110 if has_balcony else buildable_y_max

    # Door specs: (id, opening_id, wall_id, distance, w, h, swing, hand, connects)
    door_specs = [
        # 1. Main entry — east wall, opens into living-dining. Place door
        #    centred in the living-dining y range. E-s starts at south
        #    so the distance formula is the same regardless of has_balcony.
        (
            f"door-{name_prefix}-main-entry",
            f"opening-{name_prefix}-d01",
            e_wall_south,
            (y_s_inner + y_p45_s) / 2.0 - buildable_y_min - 0.5,
            1.0, 2.1, "inward", "right",
            [f"room-{name_prefix}-living-dining", outside_or_lobby],
        ),
        # 2. living-dining ↔ kitchen (ph-y45-w, len = x_pv35).
        (
            f"door-{name_prefix}-living-kitchen",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y45-w",
            (x_pv35 - 0.75) / 2.0,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-living-dining", f"room-{name_prefix}-kitchen"],
        ),
        # 3. living-dining ↔ bedroom-2 (ph-y45-e).
        (
            f"door-{name_prefix}-living-bedroom2",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y45-e",
            (buildable_x_max - x_pv35) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-living-dining", f"room-{name_prefix}-bedroom-2"],
        ),
        # 4. kitchen ↔ common-bath (ph-y75-w, len = x_pv35) — utility access.
        (
            f"door-{name_prefix}-kitchen-cbath",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-ph-y75-w",
            (x_pv35 - 0.7) / 2.0,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-kitchen", f"room-{name_prefix}-common-bath"],
        ),
        # 5. bedroom-2 ↔ master-bedroom (ph-y75-e).
        (
            f"door-{name_prefix}-bedroom2-master",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-ph-y75-e",
            (buildable_x_max - x_pv35) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [f"room-{name_prefix}-bedroom-2", f"room-{name_prefix}-master-bedroom"],
        ),
        # 6. common-bath ↔ master-bath (ph-y85-w). Bath inter-access (NOT
        #    typical IRL but functional given layout).
        (
            f"door-{name_prefix}-cbath-mbath",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-ph-y85-w",
            (x_pv35 - 0.7) / 2.0,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-common-bath", f"room-{name_prefix}-master-bath"],
        ),
        # 7. master-bedroom ↔ master-bath (pv-x35-n). Place near south end
        #    so it's adjacent to master-bedroom entry from bedroom-2.
        (
            f"door-{name_prefix}-master-mbath",
            f"opening-{name_prefix}-d07",
            f"wall-{name_prefix}-pv-x35-n",
            (y_p85 + y_pv35_n_top) / 2.0 - y_p75 - 0.35,
            0.7, 2.0, "inward", "right",
            [f"room-{name_prefix}-master-bedroom", f"room-{name_prefix}-master-bath"],
        ),
    ]
    if has_balcony:
        # 8. master-bedroom ↔ balcony — sliding glass door on ph-y110
        #    (positioned in the east half so it lands inside master-bedroom).
        door_specs.append(
            (
                f"door-{name_prefix}-master-balcony",
                f"opening-{name_prefix}-d08",
                f"wall-{name_prefix}-ph-y110",
                (x_pv35 + buildable_x_max) / 2.0 - 0.75,
                1.5, 2.1, "sliding", "right",
                [f"room-{name_prefix}-master-bedroom", f"room-{name_prefix}-balcony"],
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
    # w_wall_south) — when has_balcony=True these are E-s / W-s; when
    # False they're the unsplit E / W. The W distance formulas use
    # w_wall_start_y because W-s starts at y=y_p110 (not y=buildable_y_max).
    window_specs = [
        # 1. living-dining south — large picture window on south facade.
        (
            f"window-{name_prefix}-living-south",
            f"opening-{name_prefix}-w01",
            f"wall-{name_prefix}-S",
            buildable_x_max / 2.0 - 0.75,
            1.5, 1.5, sill_habit,
        ),
        # 2. living-dining west.
        (
            f"window-{name_prefix}-living-west",
            f"opening-{name_prefix}-w02",
            w_wall_south,
            w_wall_start_y - (y_s_inner + y_p45_s) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 3. kitchen west — counter window.
        (
            f"window-{name_prefix}-kitchen-west",
            f"opening-{name_prefix}-w03",
            w_wall_south,
            w_wall_start_y - (y_p45 + y_p75) / 2.0 - 0.5,
            1.0, 1.2, sill_kitchen,
        ),
        # 4. bedroom-2 east.
        (
            f"window-{name_prefix}-bedroom2-east",
            f"opening-{name_prefix}-w04",
            e_wall_south,
            (y_p45 + y_p75) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 5. master-bedroom east.
        (
            f"window-{name_prefix}-master-east",
            f"opening-{name_prefix}-w05",
            e_wall_south,
            (y_p75 + y_pv35_n_top) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
        # 6. master-bath west — small high-sill privacy window.
        (
            f"window-{name_prefix}-mbath-west",
            f"opening-{name_prefix}-w06",
            w_wall_south,
            w_wall_start_y - (y_p85 + y_pv35_n_top) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        # 7. common-bath west — small high-sill privacy window.
        (
            f"window-{name_prefix}-cbath-west",
            f"opening-{name_prefix}-w07",
            w_wall_south,
            w_wall_start_y - (y_p75 + y_p85) / 2.0 - 0.3,
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
        stairs=[],  # FLAT never has a stair — tower core handles vertical
        floor_footprint_polygon=envelope_polygon,
        column_grid_x=x_axes,
        column_grid_y=y_axes,
    )


__all__ = ["build_2bhk_pune_flat_floor_unit"]
