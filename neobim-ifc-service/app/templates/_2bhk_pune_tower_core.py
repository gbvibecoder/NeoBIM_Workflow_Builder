"""Slice T2.0.3 — Side-core generator for the 2BHK Pune tower.

Two-zone layout (industry-standard apartment tower core):

    +─────────────────────+
    |    STAIR  | LIFT    |   North zone (~5.24 m deep). Split EW into
    |    (west) | (east)  |   stair (~1.5 m) + lift (~1.5 m). Both
    |   1.5 m   | 1.5 m   |   open SOUTH onto the lobby via doors on
    +───────────+─────────+   the lobby/north partition.
    |                     |   ──── ph-lobby-north (full width)
    |       LOBBY         |   South zone (3.5 m deep, full 3 m wide).
    |                     |   The flat's main entry door enters here
    +─────────────────────+   (via the flat's east wall = lobby's west).

Per-storey rooms (3, was 4 in the previous 3-band layout):

  * LOBBY   — south zone, 3.0 × 3.5 m. User entry from the flat's east
              wall + access doors to stair + lift.
  * STAIR   — NW sub-zone, 1.5 × 5.24 m. Fire-rated enclosure with one
              door on its south face (into the lobby).
  * LIFT    — NE sub-zone, 1.5 × 5.24 m. Lift shaft with one door on
              its south face (into the lobby). Cabin-as-separate-room
              dropped in Slice T2.0.3 (cabin block is a Phase 9 visual
              detail; the LOD-300 IfcSpace already represents the shaft).

Per-storey walls (5 with flat adjacent / 6 stilt):

  * Perimeter S, E, N (always)
  * Perimeter W (only when no flat adjacent — stilt floors)
  * `ph-lobby-north`: full-width horizontal partition between lobby and
    the stair+lift compartments.
  * `pv-stair-lift`: vertical partition in the north zone only,
    separating stair (west) from lift (east).

Per-storey doors (2, emitted by the tower assembler — NOT by this
generator):

  * lobby ↔ stair: door on `ph-lobby-north`, west half.
  * lobby ↔ lift:  door on `ph-lobby-north`, east half.

Stair-pair geometry continues to be one Stair per floor pair (hosted on
the lower storey), with riser_count chosen so riser_height ≈ 0.150 m
at any structural rise. tread_depth = 0.140 m so total_run fits
within the core's east-west width (T2.0.1.1 fix).
"""

from __future__ import annotations

from typing import Callable, Optional

from app.domain.building_model import (
    Room,
    Stair,
    Vec2,
    Wall,
)
from app.templates._common import (
    TowerCore,
    make_axis_aligned_room,
    make_external_wall,
    make_internal_wall,
    make_rectangular_polygon_ccw,
)


# ─── Side-core geometric defaults ───────────────────────────────────

_CORE_WIDTH_M_DEFAULT: float = 3.0           # east-west width of the core
_CORE_LOBBY_DEPTH_M: float = 3.5             # south band, full width
_CORE_STAIR_FRACTION: float = 0.5            # stair takes west 50% of core
                                             # (= 1.5 m wide on a 3 m core)

_INTERNAL_WALL_THICKNESS_M: float = 0.135
_EXTERNAL_WALL_THICKNESS_M: float = 0.250
_HALF_INT_WALL: float = _INTERNAL_WALL_THICKNESS_M / 2.0
_HALF_EXT_WALL: float = _EXTERNAL_WALL_THICKNESS_M / 2.0

_STAIR_TARGET_RISER_HEIGHT_M: float = 0.150
_STAIR_TREAD_DEPTH_M: float = 0.140

# Minimum core depth: lobby 3.5 + stair zone 4.5 (stair shaft min) = 8.0 m.
_MIN_CORE_DEPTH_M: float = 8.0


def make_2bhk_pune_tower_core(
    *,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    front_setback_m: float = 3.0,
    rear_setback_m: float = 1.5,
    side_setback_m: float = 0.0,
    core_width_m: float = _CORE_WIDTH_M_DEFAULT,
    name_prefix: str = "core",
    flat_east_wall_id_per_storey: Optional[Callable[[int], Optional[str]]] = None,
) -> TowerCore:
    """Build a 2-zone side-core `TowerCore` for the 2BHK Pune tower.

    Returns a `TowerCore` whose three callables generate per-floor walls
    (5-6 each) / rooms (3 each: lobby, stair, lift) / stairs (1 per
    floor pair) on demand.
    """
    if flat_east_wall_id_per_storey is None:
        flat_east_wall_id_per_storey = lambda idx: None  # noqa: E731

    buildable_x_min = side_setback_m
    buildable_x_max = plot_width_m - side_setback_m
    buildable_y_min = rear_setback_m
    buildable_y_max = plot_length_m - front_setback_m
    buildable_depth = buildable_y_max - buildable_y_min

    core_x_min = buildable_x_max
    core_x_max = core_x_min + core_width_m
    # Vertical partition between stair (west) and lift (east) in the
    # north zone. Default = 50/50 split → 1.5 m + 1.5 m on a 3 m core.
    core_x_mid = core_x_min + core_width_m * _CORE_STAIR_FRACTION

    if buildable_depth < _MIN_CORE_DEPTH_M:
        raise ValueError(
            f"make_2bhk_pune_tower_core: buildable depth "
            f"{buildable_depth:.2f} m < minimum {_MIN_CORE_DEPTH_M:.1f} m "
            "needed for lobby (3.5 m) + stair/lift north zone (≥ 4.5 m)."
        )

    # Y partition between south lobby and north stair/lift zones.
    y_lobby_top = buildable_y_min + _CORE_LOBBY_DEPTH_M

    core_footprint = make_rectangular_polygon_ccw(
        core_x_min, core_x_max, buildable_y_min, buildable_y_max
    )

    # Stair plan polygon — confined to the WEST sub-zone of the north
    # zone (1.5 m wide × ~5.24 m long on default plot).
    stair_plan = make_rectangular_polygon_ccw(
        core_x_min + _HALF_INT_WALL,
        core_x_mid - _HALF_INT_WALL,
        y_lobby_top + _HALF_INT_WALL,
        buildable_y_max - _HALF_EXT_WALL,
    )

    sw = Vec2(x=core_x_min, y=buildable_y_min)
    se = Vec2(x=core_x_max, y=buildable_y_min)
    ne = Vec2(x=core_x_max, y=buildable_y_max)
    nw = Vec2(x=core_x_min, y=buildable_y_max)

    # ─── Walls callable ──────────────────────────────────────────
    def core_walls(
        storey_idx: int, storey_id: str, base_z: float, top_z: float
    ) -> list[Wall]:
        flat_east_id = flat_east_wall_id_per_storey(storey_idx)
        suffix = name_prefix.upper()
        walls: list[Wall] = [
            make_external_wall(
                wall_id=f"wall-{name_prefix}-s{storey_idx}-S",
                name=f"Core South - {suffix} s{storey_idx}",
                host_storey_id=storey_id,
                start=sw, end=se,
                base_z=base_z, top_z=top_z,
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-s{storey_idx}-E",
                name=f"Core East - {suffix} s{storey_idx}",
                host_storey_id=storey_id,
                start=se, end=ne,
                base_z=base_z, top_z=top_z,
            ),
            make_external_wall(
                wall_id=f"wall-{name_prefix}-s{storey_idx}-N",
                name=f"Core North - {suffix} s{storey_idx}",
                host_storey_id=storey_id,
                start=ne, end=nw,
                base_z=base_z, top_z=top_z,
            ),
        ]
        if flat_east_id is None:
            # Stilt floor or non-habitable: emit own west wall.
            walls.append(
                make_external_wall(
                    wall_id=f"wall-{name_prefix}-s{storey_idx}-W",
                    name=f"Core West - {suffix} s{storey_idx}",
                    host_storey_id=storey_id,
                    start=nw, end=sw,
                    base_z=base_z, top_z=top_z,
                )
            )
        # Lobby/north partition (full width). Lobby south, stair+lift north.
        walls.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-s{storey_idx}-ph-lobby-north",
                name=f"Core Lobby/North Partition - s{storey_idx}",
                host_storey_id=storey_id,
                start=Vec2(x=core_x_min, y=y_lobby_top),
                end=Vec2(x=core_x_max, y=y_lobby_top),
                base_z=base_z, top_z=top_z,
            )
        )
        # Stair/lift partition (north zone only).
        walls.append(
            make_internal_wall(
                wall_id=f"wall-{name_prefix}-s{storey_idx}-pv-stair-lift",
                name=f"Core Stair/Lift Partition - s{storey_idx}",
                host_storey_id=storey_id,
                start=Vec2(x=core_x_mid, y=y_lobby_top),
                end=Vec2(x=core_x_mid, y=buildable_y_max),
                base_z=base_z, top_z=top_z,
            )
        )
        walls.sort(key=lambda w: w.id)
        return walls

    # ─── Rooms callable ──────────────────────────────────────────
    def core_rooms(storey_idx: int, storey_id: str) -> list[Room]:
        flat_east_id = flat_east_wall_id_per_storey(storey_idx)
        west_wall_id = (
            flat_east_id if flat_east_id is not None
            else f"wall-{name_prefix}-s{storey_idx}-W"
        )
        west_side: str = "right" if flat_east_id is not None else "left"

        # Inner-face coords. Lobby's west = flat-E (or core-W) — full
        # external wall, half_ext offset. Stair's west = same. Lift's
        # west = pv-stair-lift (interior partition), half_int offset.
        x_lobby_w = (
            buildable_x_max + _HALF_EXT_WALL  # flat-E axis sits at plot_w
            if flat_east_id is not None
            else core_x_min + _HALF_EXT_WALL
        )
        x_lobby_e = core_x_max - _HALF_EXT_WALL
        x_stair_w = x_lobby_w  # same — both border flat-E (or core-W)
        x_stair_e = core_x_mid - _HALF_INT_WALL
        x_lift_w = core_x_mid + _HALF_INT_WALL
        x_lift_e = x_lobby_e
        y_s_inner = buildable_y_min + _HALF_EXT_WALL
        y_n_inner = buildable_y_max - _HALF_EXT_WALL
        y_lobby_n = y_lobby_top - _HALF_INT_WALL  # lobby's north (south of partition)
        y_stair_lift_s = y_lobby_top + _HALF_INT_WALL  # stair/lift's south

        return sorted(
            [
                make_axis_aligned_room(
                    room_id=f"room-{name_prefix}-s{storey_idx}-lobby",
                    name=f"Core Lobby - s{storey_idx}",
                    usage="lobby",
                    xmin=x_lobby_w, xmax=x_lobby_e,
                    ymin=y_s_inner, ymax=y_lobby_n,
                    south_wall=(f"wall-{name_prefix}-s{storey_idx}-S", "left"),
                    east_wall=(f"wall-{name_prefix}-s{storey_idx}-E", "left"),
                    north_wall=(
                        f"wall-{name_prefix}-s{storey_idx}-ph-lobby-north",
                        "right",
                    ),
                    west_wall=(west_wall_id, west_side),
                ),
                make_axis_aligned_room(
                    room_id=f"room-{name_prefix}-s{storey_idx}-stair",
                    name=f"Core Stair Shaft - s{storey_idx}",
                    usage="stair",
                    xmin=x_stair_w, xmax=x_stair_e,
                    ymin=y_stair_lift_s, ymax=y_n_inner,
                    south_wall=(
                        f"wall-{name_prefix}-s{storey_idx}-ph-lobby-north",
                        "left",
                    ),
                    east_wall=(
                        f"wall-{name_prefix}-s{storey_idx}-pv-stair-lift",
                        "left",
                    ),
                    north_wall=(f"wall-{name_prefix}-s{storey_idx}-N", "left"),
                    west_wall=(west_wall_id, west_side),
                ),
                make_axis_aligned_room(
                    room_id=f"room-{name_prefix}-s{storey_idx}-lift",
                    name=f"Core Lift Shaft - s{storey_idx}",
                    usage="lift",
                    xmin=x_lift_w, xmax=x_lift_e,
                    ymin=y_stair_lift_s, ymax=y_n_inner,
                    south_wall=(
                        f"wall-{name_prefix}-s{storey_idx}-ph-lobby-north",
                        "left",
                    ),
                    east_wall=(f"wall-{name_prefix}-s{storey_idx}-E", "left"),
                    north_wall=(f"wall-{name_prefix}-s{storey_idx}-N", "left"),
                    west_wall=(
                        f"wall-{name_prefix}-s{storey_idx}-pv-stair-lift",
                        "right",
                    ),
                ),
            ],
            key=lambda r: r.id,
        )

    # ─── Stair-per-pair callable (unchanged from T2.0.1.1) ────────
    def stair_per_floor(
        storey_idx_lower: int,
        storey_id_lower: str,
        slab_below_top_z: float,
        slab_above_bottom_z: float,
    ) -> Stair:
        rise = slab_above_bottom_z - slab_below_top_z
        riser_count = max(1, round(rise / _STAIR_TARGET_RISER_HEIGHT_M))
        riser_height = rise / riser_count
        return Stair(
            id=f"stair-{name_prefix}-s{storey_idx_lower}-up",
            host_storey_id=storey_id_lower,
            riser_count=riser_count,
            riser_height=riser_height,
            tread_depth=_STAIR_TREAD_DEPTH_M,
            flight_count=2,
            landing_count=1,
            plan_polygon=stair_plan,
        )

    return TowerCore(
        core_walls_per_floor=core_walls,
        core_rooms_per_floor=core_rooms,
        stair_per_floor=stair_per_floor,
        core_footprint_polygon=core_footprint,
        core_x_offset=core_x_min,
        core_y_offset=buildable_y_min,
    )


__all__ = ["make_2bhk_pune_tower_core"]
