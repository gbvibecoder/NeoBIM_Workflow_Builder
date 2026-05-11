"""Slice 2B.3 — Mumty extension.

Adds a stair-access room on the building's roof. The mumty is the
small enclosure at the top of the staircase that provides covered
access to the terrace from the topmost floor. NBC-required for
roof-occupiable buildings; in Indian residential practice it's
universal (without it, the roof is unreachable except via ladder).

The ONLY extension that:
  * Adds a new storey to the BuildingModel (index = top + 1).
  * MODIFIES an existing slab (cuts an opening in the top storey's
    roof slab via the ``replace_slab_ids`` channel) so the stair
    can pass through.
  * Works on tower templates (no plot_polygon required — mumty sits
    on the roof, not in the setback). Per the option (i) decision,
    mumty is the only Slice 2B.3 v1 extension that supports towers.

Geometry
--------
Default 2.0m × 2.5m × 2.4m (W × D × H). Centered horizontally on the
plot/envelope, placed at the rear half of the roof (envelope_y_min +
1.0m to envelope_y_min + 3.5m for typical templates).

Mumty storey timing of slabs and walls:

    storey N (top building):  z=[ ..., top_z_of_storey_N ]
    existing roof slab:        z=[top_z - 0.15, top_z]   (predefined_type="ROOF")
    mumty FLOOR slab:          z=[top_z, top_z + 0.15]   (predefined_type="FLOOR")
    mumty walls:               z=[top_z + 0.15, top_z + 2.25]
    mumty ROOF slab:           z=[top_z + 2.25, top_z + 2.40]

The stair's structural rise = mumty_floor_slab.bottom_z -
top_storey_floor_slab.top_z = top_z - 0.0 (for ground-only) or
top_z - prev_floor_top_z (for multi-storey).

Stair details
-------------
Stair plan polygon is a 1.0m × 2.5m rectangle centered under the
mumty footprint, hosted on the top building storey. The riser
arithmetic adapts to the structural rise: 16 risers @
(rise / 16) m each, which keeps riser_height in the 0.150-0.200m
range NBC-compliant for typical 3.0m floor-to-floor.

Roof slab opening
-----------------
Existing roof slab on top storey gets a polygon added to its
``openings_polygons`` list — same polygon as the stair plan, so the
stair flight passes cleanly through the slab into the mumty.

Failure modes
-------------
- ``ExtensionError`` — no envelope polygon on the building (shouldn't
  happen for templates).
- ``ExtensionError`` — top storey lacks a FLOOR slab (STAIR_RISE_MATCHES
  would fail; mumty checks early).
- ``PlotBoundaryViolationError`` — mumty doesn't fit within the building
  envelope (defensive — default 2×2.5m fits within all templates).
"""

from __future__ import annotations

from app.domain.building_model import (
    BoundaryEdge,
    BuildingModel,
    Door,
    Opening,
    Room,
    Slab,
    Stair,
    Storey,
    Vec2,
    Wall,
)

from ._common import (
    ExtensionError,
    PlotBoundaryViolationError,
    collect_existing_ids,
    commit_to_storey,
    get_top_storey,
    make_ccw_rectangle,
    make_unique_id,
)
from app.templates._common import make_external_wall_layers

EXTENSION_TYPE = "mumty"

DEFAULT_MUMTY_WIDTH_M: float = 2.0
DEFAULT_MUMTY_DEPTH_M: float = 2.5
DEFAULT_STOREY_HEIGHT_M: float = 2.4
DEFAULT_FLOOR_SLAB_THICKNESS_M: float = 0.150
DEFAULT_ROOF_SLAB_THICKNESS_M: float = 0.150
DEFAULT_STAIR_WIDTH_M: float = 1.0
DEFAULT_STAIR_DEPTH_M: float = 2.5
DEFAULT_RISER_COUNT: int = 16


def _find_floor_slab(storey: Storey) -> Slab:
    """Find the FLOOR slab on a storey, or raise."""
    for s in storey.slabs:
        if s.predefined_type == "FLOOR":
            return s
    raise ExtensionError(
        extension_type=EXTENSION_TYPE,
        reason=(
            f"storey '{storey.id}' has no FLOOR slab; cannot anchor "
            "stair rise. STAIR_RISE_MATCHES requires a FLOOR slab on "
            "both the host and target storey."
        ),
    )


def _find_roof_slab(storey: Storey) -> Slab:
    """Find the ROOF slab on a storey, or raise."""
    for s in storey.slabs:
        if s.predefined_type == "ROOF":
            return s
    raise ExtensionError(
        extension_type=EXTENSION_TYPE,
        reason=(
            f"storey '{storey.id}' has no ROOF slab; mumty cannot cut "
            "an opening if there is no roof slab to modify."
        ),
    )


def add_mumty(
    bm: BuildingModel,
    *,
    mumty_width_m: float = DEFAULT_MUMTY_WIDTH_M,
    mumty_depth_m: float = DEFAULT_MUMTY_DEPTH_M,
    storey_height_m: float = DEFAULT_STOREY_HEIGHT_M,
) -> BuildingModel:
    """Add a stair-access mumty on the building roof.

    Returns
    -------
    BuildingModel
        Re-validated under all 13 invariants. Adds:
          * 1 new mumty Storey (index = top + 1).
          * 1 mumty FLOOR Slab (on the new storey).
          * 4 mumty Walls (on the new storey).
          * 1 mumty ROOF Slab (on the new storey).
          * 1 mumty Room (usage="stairs_landing").
          * 1 Opening + Door (mumty exit to roof terrace).
          * 1 Stair (top storey → mumty storey).
        Also REPLACES the existing top-storey ROOF slab with one whose
        ``openings_polygons`` includes the stair shaft.

    Raises
    ------
    ExtensionError, PlotBoundaryViolationError
    """
    top = get_top_storey(bm)
    envelope = bm.project.site.building.envelope_polygon
    if not envelope:
        raise ExtensionError(
            extension_type=EXTENSION_TYPE,
            reason="Building.envelope_polygon is empty; cannot place mumty.",
        )

    top_floor_slab = _find_floor_slab(top)
    top_roof_slab = _find_roof_slab(top)

    # Mumty floor sits at the top of the existing roof slab. The new
    # mumty storey starts at z=top_storey.elevation + top_storey.actual_height
    # (standard storey continuity).
    mumty_storey_z = top.elevation + top.actual_height
    mumty_storey_index = top.index + 1
    mumty_floor_top_z = mumty_storey_z + DEFAULT_FLOOR_SLAB_THICKNESS_M
    mumty_walls_top_z = mumty_storey_z + storey_height_m - DEFAULT_ROOF_SLAB_THICKNESS_M
    mumty_roof_top_z = mumty_storey_z + storey_height_m

    # Position: centered horizontally, placed at rear half of envelope.
    env_xs, env_ys = [v.x for v in envelope], [v.y for v in envelope]
    env_x_min, env_x_max = min(env_xs), max(env_xs)
    env_y_min, env_y_max = min(env_ys), max(env_ys)
    env_cx = (env_x_min + env_x_max) / 2.0

    mumty_x_min = env_cx - mumty_width_m / 2.0
    mumty_x_max = env_cx + mumty_width_m / 2.0
    mumty_y_min = env_y_min + 1.0
    mumty_y_max = mumty_y_min + mumty_depth_m

    # Defensive plot-fit check (fits in envelope).
    if (
        mumty_x_min < env_x_min - 0.001
        or mumty_x_max > env_x_max + 0.001
        or mumty_y_max > env_y_max + 0.001
    ):
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"mumty {mumty_width_m}×{mumty_depth_m}m at "
                f"({mumty_x_min:.2f},{mumty_y_min:.2f})-"
                f"({mumty_x_max:.2f},{mumty_y_max:.2f}) does not fit "
                f"within building envelope "
                f"({env_x_min:.2f},{env_y_min:.2f})-"
                f"({env_x_max:.2f},{env_y_max:.2f})"
            ),
        )

    # Stair plan polygon: 1.0×2.5m centered under the mumty footprint.
    stair_x_min = env_cx - DEFAULT_STAIR_WIDTH_M / 2.0
    stair_x_max = env_cx + DEFAULT_STAIR_WIDTH_M / 2.0
    stair_y_min = mumty_y_min
    stair_y_max = mumty_y_min + DEFAULT_STAIR_DEPTH_M
    stair_polygon = make_ccw_rectangle(
        stair_x_min, stair_y_min, stair_x_max, stair_y_max
    )

    existing_ids = collect_existing_ids(bm)

    # Build the new mumty storey shell (no entities yet — those are
    # passed as new_storey_* lists below).
    mumty_storey = Storey(
        id=make_unique_id("ext-mu-storey", existing_ids),
        name="Mumty",
        elevation=mumty_storey_z,
        actual_height=storey_height_m,
        index=mumty_storey_index,
    )

    # Mumty FLOOR slab: covers mumty bbox, hosted on new storey.
    mumty_floor_slab = Slab(
        id=make_unique_id("ext-mu-floor", existing_ids),
        host_storey_id=mumty_storey.id,
        footprint_polygon=make_ccw_rectangle(
            mumty_x_min, mumty_y_min, mumty_x_max, mumty_y_max
        ),
        bottom_z=mumty_storey_z,
        top_z=mumty_floor_top_z,
        predefined_type="FLOOR",
    )

    # 4 mumty walls (CCW: south, east, north, west). Walls hosted on
    # the new mumty storey.
    sw = Vec2(x=mumty_x_min, y=mumty_y_min)
    se = Vec2(x=mumty_x_max, y=mumty_y_min)
    ne = Vec2(x=mumty_x_max, y=mumty_y_max)
    nw = Vec2(x=mumty_x_min, y=mumty_y_max)
    base_z = mumty_floor_top_z
    top_z = mumty_walls_top_z

    def _mk_wall(wid: str, name: str, start: Vec2, end: Vec2) -> Wall:
        return Wall(
            id=wid,
            name=name,
            host_storey_ids=[mumty_storey.id],
            axis_points=[start, end],
            base_z=base_z,
            top_z=top_z,
            thickness=0.250,
            layers=make_external_wall_layers(),
            type="solid",
            is_external=True,
            is_load_bearing=True,
        )

    wall_S = _mk_wall(
        make_unique_id("ext-mu-wall-S", existing_ids), "Mumty South", sw, se
    )
    wall_E = _mk_wall(
        make_unique_id("ext-mu-wall-E", existing_ids), "Mumty East", se, ne
    )
    wall_N = _mk_wall(
        make_unique_id("ext-mu-wall-N", existing_ids), "Mumty North", ne, nw
    )
    wall_W = _mk_wall(
        make_unique_id("ext-mu-wall-W", existing_ids), "Mumty West", nw, sw
    )

    # Mumty ROOF slab covering mumty interior.
    mumty_roof_slab = Slab(
        id=make_unique_id("ext-mu-roof", existing_ids),
        host_storey_id=mumty_storey.id,
        footprint_polygon=make_ccw_rectangle(
            mumty_x_min, mumty_y_min, mumty_x_max, mumty_y_max
        ),
        bottom_z=mumty_walls_top_z,
        top_z=mumty_roof_top_z,
        predefined_type="ROOF",
    )

    # Mumty room (usage="stairs_landing", footprint = mumty rectangle).
    mumty_room_id = make_unique_id("ext-mu-room", existing_ids)
    mumty_room = Room(
        id=mumty_room_id,
        name="Mumty (Roof Access)",
        usage="stairs_landing",
        footprint_polygon=make_ccw_rectangle(
            mumty_x_min, mumty_y_min, mumty_x_max, mumty_y_max
        ),
        bounding_edges=[
            BoundaryEdge(wall_id=wall_S.id, side="left"),
            BoundaryEdge(wall_id=wall_E.id, side="left"),
            BoundaryEdge(wall_id=wall_N.id, side="left"),
            BoundaryEdge(wall_id=wall_W.id, side="left"),
        ],
    )

    # Door from mumty interior to "Outside" (= roof terrace). Place
    # in NORTH wall (axis NE→NW, direction -X). Centered.
    mumty_door_width = 1.0
    door_opening = Opening(
        id=make_unique_id("ext-mu-opening-door", existing_ids),
        in_wall_id=wall_N.id,
        distance_along_wall=(mumty_width_m - mumty_door_width) / 2.0,
        sill_z=mumty_floor_top_z,
        width=mumty_door_width,
        height=2.1,
        predefined_type="DOOR",
    )
    mumty_door = Door(
        id=make_unique_id("ext-mu-door", existing_ids),
        in_opening_id=door_opening.id,
        connects_room_ids=["Outside", mumty_room_id],
        swing="outward",  # opens onto the terrace
        handedness="left",
        predefined_type="DOOR",
    )

    # Stair from top storey FLOOR slab to mumty FLOOR slab. Rise
    # exactly matches mumty_floor_slab.bottom_z - top_floor_slab.top_z.
    structural_rise = mumty_floor_slab.bottom_z - top_floor_slab.top_z
    riser_height = structural_rise / DEFAULT_RISER_COUNT
    if riser_height <= 0:
        raise ExtensionError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"computed structural rise {structural_rise:.4f}m is "
                "non-positive; mumty placement is below the host floor"
            ),
        )
    stair = Stair(
        id=make_unique_id("ext-mu-stair", existing_ids),
        host_storey_id=top.id,
        riser_count=DEFAULT_RISER_COUNT,
        riser_height=riser_height,
        tread_depth=0.250,
        flight_count=2,
        landing_count=1,
        plan_polygon=stair_polygon,
    )

    # Roof slab cut: replace top_roof_slab with a copy that has the
    # stair opening polygon added to its openings_polygons.
    new_top_roof_slab = top_roof_slab.model_copy(
        update={
            "openings_polygons": list(top_roof_slab.openings_polygons)
            + [stair_polygon],
        }
    )

    return commit_to_storey(
        bm,
        storey_index=top.index,  # for the slab replacement
        stairs=[stair],
        replace_slab_ids={top_roof_slab.id: new_top_roof_slab},
        # Mumty entities all land on the new storey in one go.
        new_storey=mumty_storey,
        new_storey_walls=[wall_S, wall_E, wall_N, wall_W],
        new_storey_rooms=[mumty_room],
        new_storey_slabs=[mumty_floor_slab, mumty_roof_slab],
        new_storey_openings=[door_opening],
        doors=[mumty_door],
    )


__all__ = [
    "add_mumty",
    "DEFAULT_MUMTY_WIDTH_M",
    "DEFAULT_MUMTY_DEPTH_M",
    "DEFAULT_STOREY_HEIGHT_M",
    "DEFAULT_RISER_COUNT",
]
