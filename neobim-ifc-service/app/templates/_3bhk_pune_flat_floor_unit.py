"""Phase T2.2 Phase B — Single-floor 3BHK FLAT floor unit.

Layer-2 builder for a complete 3BHK flat on ONE storey. Used by the
3BHK tower assembler (Phase E) — one FLAT FloorUnit per habitable
floor, glued onto the side-core's east edge.

Layout (default plot 11.0 × 20.0, has_balcony=True):

    N=15.5  ┌──────────────────────────────┐ ← railings on E-n / N / W-n
            │       BALCONY (front)        │
    y=14.0  ├───────────┬──────────────────┤
            │ bedroom-3 │   master-bedroom │
            │  3.5×3.5  │    4.5×3.5       │
            │  ≈11.13   │    ≈14.49 LUX ✓  │
    y=10.5  ├───────────┼──────────────────┤
            │ master-bath  │  common-bath  │
            │  3.5×1.5     │   4.5×1.5     │
    y=9.0   ├───────────┬──────────────────┤
            │ bedroom-2 │      kitchen     │
            │  3.5×3.2  │      4.5×3.2     │
    y=5.8   ├───────────┴──────────────────┤
            │       LIVING-DINING          │  ← E entry on E-s
            │       8 × 2.8 = ≈21          │
    y=3.0   └──────────────────────────────┘
            x=1.5     5.0                 9.5

8 rooms with balcony, 7 without (bedrooms extend to N envelope, no
balcony Room, no ph-y140, gain north windows for cross-ventilation).

Mid-segment 3BHK Pune trade-off (documented in PHASE_T2_2_SUMMARY):
circulation goes through baths to reach bedroom-3 and master-bedroom
(via master-bath / common-bath respectively). Realistic for compact
100 sqm 3BHK plans on the market. A v2 layout on a 12.0×20.0+ plot
would add a passage room.

Master-bedroom 14.49 sqm (post-wall-insets) ≥ luxury target 14.0 sqm.
All other rooms ≥ NBC India minimums (living-dining 12.5, bedroom 9.5,
kitchen 5.0, bath 1.8).

Modern balcony railings (T2.0.1.2 pattern carried forward): N + E-n +
W-n perimeter segments emit as `Wall(type="railing")` at 1.1m height,
50mm MS-Steel. IFC builder dispatches to IfcRailing.

Entry on EAST wall (E-s when has_balcony=True; E without). Tower
assembler wires the door to the side-core lobby by substituting the
`TOWER_CORE_LOBBY_SENTINEL` value in `connects_room_ids`.
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
    _perimeter_walls,
)
from app.templates._3bhk_pune_floor_unit import (
    _buildable_bounds,
    _column_grid,
)
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

_FRONT_SETBACK_M_DEFAULT: float = 4.5
_REAR_SETBACK_M_DEFAULT: float = 3.0
_SIDE_SETBACK_M_DEFAULT: float = 1.5
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_INTERNAL_WALL_THICKNESS_M: float = 0.135
_SLAB_THICKNESS_M: float = 0.150

# Layout fractions (default plot 11.0 × 20.0, buildable 8.0 × 12.5).
# PV (vertical) of buildable_width; PH (horizontal) of buildable_depth
# from buildable_y_min (south).
_PV_FLAT_X35_FRAC: float = 3.5 / 8.0          # bedroom-3/bath west vs east
_PH_FLAT_Y58_FRAC: float = 2.8 / 12.5         # living-dining vs mid band
_PH_FLAT_Y90_FRAC: float = 6.0 / 12.5         # bedroom-2/kitchen vs baths
_PH_FLAT_Y105_FRAC: float = 7.5 / 12.5        # baths vs bedrooms
_PH_FLAT_Y140_FRAC: float = 11.0 / 12.5       # bedrooms vs balcony

_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0

# Modern balcony railings (NBC India §15 guard-rail, residential).
_BALCONY_RAILING_HEIGHT_M: float = 1.1
_BALCONY_RAILING_THICKNESS_M: float = 0.050
_BALCONY_RAILING_MATERIAL: str = "MS-Steel"
_HALF_BALCONY_RAILING: float = _BALCONY_RAILING_THICKNESS_M / 2.0


def build_3bhk_pune_flat_floor_unit(
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
    has_balcony: bool = True,
) -> FloorUnit:
    """Build a single-floor 3BHK Pune FLAT.

    Returns a `FloorUnit` ready for the Layer-3 tower assembler. The
    tower passes `door_to_stair_outside=False` so the main entry's
    `connects_room_ids` carries the tower-core lobby sentinel
    (substituted by the assembler with the actual lobby Room id).
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
    x_pv35 = buildable_x_min + buildable_width * _PV_FLAT_X35_FRAC
    y_p58 = buildable_y_min + buildable_depth * _PH_FLAT_Y58_FRAC
    y_p90 = buildable_y_min + buildable_depth * _PH_FLAT_Y90_FRAC
    y_p105 = buildable_y_min + buildable_depth * _PH_FLAT_Y105_FRAC
    y_p140 = buildable_y_min + buildable_depth * _PH_FLAT_Y140_FRAC

    # ── Perimeter walls — split E/W when has_balcony=True ──
    sw = Vec2(x=buildable_x_min, y=buildable_y_min)
    se = Vec2(x=buildable_x_max, y=buildable_y_min)
    ne = Vec2(x=buildable_x_max, y=buildable_y_max)
    nw = Vec2(x=buildable_x_min, y=buildable_y_max)

    def _railing(wall_id: str, name: str, start: Vec2, end: Vec2) -> Wall:
        """Inline factory: thin Wall(type='railing') for balcony guard-rails."""
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
                start=se, end=Vec2(x=buildable_x_max, y=y_p140),
                base_z=z_wall_base, top_z=z_wall_top,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-E-n",
                name=f"Balcony Railing East - {suffix}",
                start=Vec2(x=buildable_x_max, y=y_p140), end=ne,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-N",
                name=f"Balcony Railing North - {suffix}",
                start=ne, end=nw,
            ),
            _railing(
                wall_id=f"wall-{name_prefix}-W-n",
                name=f"Balcony Railing West - {suffix}",
                start=nw, end=Vec2(x=buildable_x_min, y=y_p140),
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-W-s",
                name=f"External Wall West South - {suffix}",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p140), end=sw,
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

    # ── Partitions ──
    # When no balcony, pv-x35 extends to the N envelope; ph-y140 omitted.
    y_pv35_top = y_p140 if has_balcony else buildable_y_max

    partitions = [
        # ph-y58 (full width) — living-dining south, mid band rooms north.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y58",
            name=f"Partition Y5.8 - {name_prefix.upper()} (living/mid)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p58),
            end=Vec2(x=buildable_x_max, y=y_p58),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y90 (full width) — bedroom-2/kitchen south, baths north.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y90",
            name=f"Partition Y9.0 - {name_prefix.upper()} (mid/baths)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p90),
            end=Vec2(x=buildable_x_max, y=y_p90),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # ph-y105 (full width) — baths south, bedrooms north.
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-ph-y105",
            name=f"Partition Y10.5 - {name_prefix.upper()} (baths/bedrooms)",
            host_storey_id=storey_id,
            start=Vec2(x=buildable_x_min, y=y_p105),
            end=Vec2(x=buildable_x_max, y=y_p105),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
        # pv-x35 (single segment y∈[y_p58, y_pv35_top]).
        make_internal_wall(
            wall_id=f"wall-{name_prefix}-pv-x35",
            name=f"Partition X3.5 - {name_prefix.upper()}",
            host_storey_id=storey_id,
            start=Vec2(x=x_pv35, y=y_p58),
            end=Vec2(x=x_pv35, y=y_pv35_top),
            base_z=z_wall_base, top_z=z_wall_top,
        ),
    ]
    if has_balcony:
        partitions.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-ph-y140",
                name=f"Partition Y14.0 - {name_prefix.upper()} (under balcony)",
                host_storey_id=storey_id,
                start=Vec2(x=buildable_x_min, y=y_p140),
                end=Vec2(x=buildable_x_max, y=y_p140),
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
    y_p58_s = y_p58 - _HALF_INT_WALL
    y_p58_n = y_p58 + _HALF_INT_WALL
    y_p90_s = y_p90 - _HALF_INT_WALL
    y_p90_n = y_p90 + _HALF_INT_WALL
    y_p105_s = y_p105 - _HALF_INT_WALL
    y_p105_n = y_p105 + _HALF_INT_WALL
    y_p140_n = y_p140 + _HALF_INT_WALL

    # When no balcony, bedroom-3 + master-bedroom extend to N envelope.
    if has_balcony:
        bedroom_3_north_inner = y_p140 - _HALF_INT_WALL
        bedroom_3_north_wall = f"wall-{name_prefix}-ph-y140"
        bedroom_3_north_side = "right"
        master_bedroom_north_inner = y_p140 - _HALF_INT_WALL
        master_bedroom_north_wall = f"wall-{name_prefix}-ph-y140"
        master_bedroom_north_side = "right"
    else:
        bedroom_3_north_inner = y_n_inner
        bedroom_3_north_wall = f"wall-{name_prefix}-N"
        bedroom_3_north_side = "left"
        master_bedroom_north_inner = y_n_inner
        master_bedroom_north_wall = f"wall-{name_prefix}-N"
        master_bedroom_north_side = "left"

    # E/W perimeter segments — *-s for solid south, *-n for railing north.
    e_wall_south = f"wall-{name_prefix}-E-s" if has_balcony else f"wall-{name_prefix}-E"
    w_wall_south = f"wall-{name_prefix}-W-s" if has_balcony else f"wall-{name_prefix}-W"
    e_wall_north_railing = f"wall-{name_prefix}-E-n"
    w_wall_north_railing = f"wall-{name_prefix}-W-n"

    rooms = [
        # Living-Dining (south band, full plot width, ≈21 sqm post-insets).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-living-dining",
            name="Living + Dining", usage="living-dining",
            xmin=x_w_inner, xmax=x_e_inner, ymin=y_s_inner, ymax=y_p58_s,
            south_wall=(f"wall-{name_prefix}-S", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y58", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        # Bedroom-2 (mid west, ≈10.14 sqm).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-2",
            name="Bedroom 2", usage="bedroom",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p58_n, ymax=y_p90_s,
            south_wall=(f"wall-{name_prefix}-ph-y58", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y90", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        # Kitchen (mid east, ≈12.34 sqm).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-kitchen",
            name="Kitchen", usage="kitchen",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p58_n, ymax=y_p90_s,
            south_wall=(f"wall-{name_prefix}-ph-y58", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y90", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35", "right"),
        ),
        # Master-Bath (mid-upper west, ≈4.51 sqm — en-suite from bedroom-2).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bath",
            name="Master Bathroom", usage="bath",
            xmin=x_w_inner, xmax=x_pv35_w, ymin=y_p90_n, ymax=y_p105_s,
            south_wall=(f"wall-{name_prefix}-ph-y90", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35", "left"),
            north_wall=(f"wall-{name_prefix}-ph-y105", "right"),
            west_wall=(w_wall_south, "left"),
        ),
        # Common-Bath (mid-upper east, ≈5.88 sqm).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-common-bath",
            name="Common Bathroom", usage="bath",
            xmin=x_pv35_e, xmax=x_e_inner, ymin=y_p90_n, ymax=y_p105_s,
            south_wall=(f"wall-{name_prefix}-ph-y90", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(f"wall-{name_prefix}-ph-y105", "right"),
            west_wall=(f"wall-{name_prefix}-pv-x35", "right"),
        ),
        # Bedroom-3 (north west, ≈11.13 sqm — extends to envelope when no balcony).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-bedroom-3",
            name="Bedroom 3", usage="bedroom",
            xmin=x_w_inner, xmax=x_pv35_w,
            ymin=y_p105_n, ymax=bedroom_3_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y105", "left"),
            east_wall=(f"wall-{name_prefix}-pv-x35", "left"),
            north_wall=(bedroom_3_north_wall, bedroom_3_north_side),
            west_wall=(w_wall_south, "left"),
        ),
        # Master-Bedroom (north east, ≈14.49 sqm luxury target).
        make_axis_aligned_room(
            room_id=f"room-{name_prefix}-master-bedroom",
            name="Master Bedroom", usage="master-bedroom",
            xmin=x_pv35_e, xmax=x_e_inner,
            ymin=y_p105_n, ymax=master_bedroom_north_inner,
            south_wall=(f"wall-{name_prefix}-ph-y105", "left"),
            east_wall=(e_wall_south, "left"),
            north_wall=(master_bedroom_north_wall, master_bedroom_north_side),
            west_wall=(f"wall-{name_prefix}-pv-x35", "right"),
        ),
    ]
    if has_balcony:
        # Balcony — railings on E/N/W. Use half-railing offset (0.025m)
        # for footprint corners on those edges so the polygon matches
        # what ROOM_BOUNDED computes from the railing's thinner axes.
        balcony_x_w = buildable_x_min + _HALF_BALCONY_RAILING
        balcony_x_e = buildable_x_max - _HALF_BALCONY_RAILING
        balcony_y_n = buildable_y_max - _HALF_BALCONY_RAILING
        rooms.append(
            make_axis_aligned_room(
                room_id=f"room-{name_prefix}-balcony-front",
                name="Front Balcony", usage="balcony",
                xmin=balcony_x_w, xmax=balcony_x_e,
                ymin=y_p140_n, ymax=balcony_y_n,
                south_wall=(f"wall-{name_prefix}-ph-y140", "left"),
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
        # 1. Main entry — east wall (E-s when has_balcony=True; E without).
        #    Centered in living-dining y range [y_min, y_p58].
        (
            f"door-{name_prefix}-main-entry",
            f"opening-{name_prefix}-d01",
            e_wall_south,
            (y_p58 - buildable_y_min) / 2.0 - 0.5,
            1.0, 2.1, "inward", "right",
            [f"room-{name_prefix}-living-dining", outside_or_lobby],
        ),
        # 2. living-dining ↔ bedroom-2 (ph-y58, west half).
        (
            f"door-{name_prefix}-living-bedroom-2",
            f"opening-{name_prefix}-d02",
            f"wall-{name_prefix}-ph-y58",
            (x_pv35 - buildable_x_min) / 2.0 - 0.375,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-living-dining",
                f"room-{name_prefix}-bedroom-2",
            ],
        ),
        # 3. living-dining ↔ kitchen (ph-y58, east half).
        (
            f"door-{name_prefix}-living-kitchen",
            f"opening-{name_prefix}-d03",
            f"wall-{name_prefix}-ph-y58",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.375
            - buildable_x_min,
            0.75, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-living-dining",
                f"room-{name_prefix}-kitchen",
            ],
        ),
        # 4. bedroom-2 ↔ master-bath (ph-y90, west half — en-suite).
        (
            f"door-{name_prefix}-bedroom-2-mbath",
            f"opening-{name_prefix}-d04",
            f"wall-{name_prefix}-ph-y90",
            (x_pv35 - buildable_x_min) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-bedroom-2",
                f"room-{name_prefix}-master-bath",
            ],
        ),
        # 5. kitchen ↔ common-bath (ph-y90, east half).
        (
            f"door-{name_prefix}-kitchen-cbath",
            f"opening-{name_prefix}-d05",
            f"wall-{name_prefix}-ph-y90",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.35
            - buildable_x_min,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-kitchen",
                f"room-{name_prefix}-common-bath",
            ],
        ),
        # 6. master-bath ↔ bedroom-3 (ph-y105, west half).
        (
            f"door-{name_prefix}-mbath-bedroom-3",
            f"opening-{name_prefix}-d06",
            f"wall-{name_prefix}-ph-y105",
            (x_pv35 - buildable_x_min) / 2.0 - 0.35,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-master-bath",
                f"room-{name_prefix}-bedroom-3",
            ],
        ),
        # 7. common-bath ↔ master-bedroom (ph-y105, east half).
        (
            f"door-{name_prefix}-cbath-master",
            f"opening-{name_prefix}-d07",
            f"wall-{name_prefix}-ph-y105",
            x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.35
            - buildable_x_min,
            0.7, 2.0, "inward", "right",
            [
                f"room-{name_prefix}-common-bath",
                f"room-{name_prefix}-master-bedroom",
            ],
        ),
    ]
    if has_balcony:
        # 8. bedroom-3 ↔ balcony — sliding glass on ph-y140, west half.
        door_specs.append(
            (
                f"door-{name_prefix}-bedroom-3-balcony",
                f"opening-{name_prefix}-d08",
                f"wall-{name_prefix}-ph-y140",
                (x_pv35 - buildable_x_min) / 2.0 - 0.75,
                1.5, 2.1, "sliding", "right",
                [
                    f"room-{name_prefix}-bedroom-3",
                    f"room-{name_prefix}-balcony-front",
                ],
            )
        )
        # 9. master-bedroom ↔ balcony — sliding glass on ph-y140, east half.
        door_specs.append(
            (
                f"door-{name_prefix}-master-balcony",
                f"opening-{name_prefix}-d09",
                f"wall-{name_prefix}-ph-y140",
                x_pv35 + (buildable_x_max - x_pv35) / 2.0 - 0.75
                - buildable_x_min,
                1.5, 2.1, "sliding", "right",
                [
                    f"room-{name_prefix}-master-bedroom",
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
    w_wall_start_y = y_p140 if has_balcony else buildable_y_max
    bedroom_3_north_y = y_p140 if has_balcony else buildable_y_max
    master_bedroom_north_y = y_p140 if has_balcony else buildable_y_max

    window_specs = [
        # 1. living-dining south — large picture window.
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
            w_wall_start_y - (buildable_y_min + y_p58) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 3. kitchen east — counter-height.
        (
            f"window-{name_prefix}-kitchen-east",
            f"opening-{name_prefix}-w03",
            e_wall_south,
            (y_p58 + y_p90) / 2.0 - 0.5 - buildable_y_min,
            1.0, 1.2, sill_kitchen,
        ),
        # 4. bedroom-2 west.
        (
            f"window-{name_prefix}-bedroom-2-west",
            f"opening-{name_prefix}-w04",
            w_wall_south,
            w_wall_start_y - (y_p58 + y_p90) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 5. master-bath west — small high-sill privacy.
        (
            f"window-{name_prefix}-mbath-west",
            f"opening-{name_prefix}-w05",
            w_wall_south,
            w_wall_start_y - (y_p90 + y_p105) / 2.0 - 0.3,
            0.6, 0.6, sill_bath,
        ),
        # 6. common-bath east — small high-sill privacy.
        (
            f"window-{name_prefix}-cbath-east",
            f"opening-{name_prefix}-w06",
            e_wall_south,
            (y_p90 + y_p105) / 2.0 - 0.3 - buildable_y_min,
            0.6, 0.6, sill_bath,
        ),
        # 7. bedroom-3 west.
        (
            f"window-{name_prefix}-bedroom-3-west",
            f"opening-{name_prefix}-w07",
            w_wall_south,
            w_wall_start_y - (y_p105 + bedroom_3_north_y) / 2.0 - 0.6,
            1.2, 1.5, sill_habit,
        ),
        # 8. master-bedroom east.
        (
            f"window-{name_prefix}-master-east",
            f"opening-{name_prefix}-w08",
            e_wall_south,
            (y_p105 + master_bedroom_north_y) / 2.0 - 0.6 - buildable_y_min,
            1.2, 1.5, sill_habit,
        ),
    ]
    if not has_balcony:
        # Without balcony, bedroom-3 + master-bedroom border N perimeter.
        # Add north windows so cross-ventilation is preserved.
        window_specs.append(
            (
                f"window-{name_prefix}-bedroom-3-north",
                f"opening-{name_prefix}-w09",
                f"wall-{name_prefix}-N",
                buildable_x_max - (buildable_x_min + x_pv35) / 2.0 - 0.5,
                1.0, 1.5, sill_habit,
            )
        )
        window_specs.append(
            (
                f"window-{name_prefix}-master-north",
                f"opening-{name_prefix}-w10",
                f"wall-{name_prefix}-N",
                buildable_x_max - (x_pv35 + buildable_x_max) / 2.0 - 0.5,
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


__all__ = ["build_3bhk_pune_flat_floor_unit"]
