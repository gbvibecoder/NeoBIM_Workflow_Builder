"""Slice 2B.3 — Servant quarter extension.

Adds a small attached structure in the rear setback area: bedroom +
bath, single storey, walls + roof + 2 doors + 2 windows. The
slice prompt's original 2.5×3.0m bedroom (= 7.5 sqm) was bumped to
4.75×2.0m (= 9.5 sqm) per the Option (a) decision in
PHASE_2B_3_DECISIONS.md §2.2. Authoritative NBC India 2016 Part 4 §3.4
sets the "bedroom" minimum at 7.5 sqm — so the original 2.5×3.0 would
have cleared NBC — but the depth (3.0m) exceeds the 3BHK rear setback
(3.0m) minus the 1.0m approach clearance = 2.0m. The 4.75×2.0
reshaping is driven by the plot-fit constraint; the resulting 9.5 sqm
happens to match the "master_bedroom" NBC minimum, which is a clean
architectural result.

Layout
------
The servant building is a 6.25m × 2.0m rectangle, rear-aligned (one
long side flush with the plot's rear edge y=0), centered along the
plot's x-axis. Internal partition divides it into:

    bedroom: x ∈ [x_offset, x_offset + 4.75],  y ∈ [0, 2.0]   (9.5 sqm)
    bath:    x ∈ [x_offset + 4.75, x_offset + 6.25], y ∈ [0, 2.0]   (3.0 sqm)

Why bedroom 4.75 × 2.0 and not 2.5 × 3.8 (slice prompt's original):
  * 3BHK Pune House rear setback is 3.0m. A 3.8m-deep bedroom would
    push past the 1.0m NBC clearance into the building footprint.
  * Re-orienting to a wider, shallower 4.75×2.0 keeps bedroom_depth
    = 2.0m and leaves 1.0m clearance to the building rear wall —
    NBC compliant, fits cleanly.

Walls (5 total) — outer perimeter walks CCW:
    south (y=0):  SW → SE
    east (x=x_offset+6.25):  SE → NE
    north (y=2.0):  NE → NW (CCW = -X direction)
    west (x=x_offset):  NW → SW (CCW = -Y direction)
    partition (x=x_offset+4.75):  S → N

Failure modes
-------------
- ``ExtensionRequiresPlotError`` — towers (empty plot_polygon).
- ``PlotBoundaryViolationError`` — rear setback insufficient
  (1BHK / 2BHK have 1.5m rear setback; 2.0m servant + 1.0m clearance
  needs 3.0m — only 3BHK family fits at default size).
- ``PlotBoundaryViolationError`` — servant width exceeds plot width.
"""

from __future__ import annotations

from app.domain.building_model import (
    BoundaryEdge,
    BuildingModel,
    Door,
    Opening,
    Room,
    Slab,
    Vec2,
    Wall,
    Window,
)

from ._common import (
    ExtensionError,
    NBCViolationError,
    PlotBoundaryViolationError,
    collect_existing_ids,
    commit_to_storey,
    get_ground_storey,
    make_ccw_rectangle,
    make_compound_wall_layers,
    make_unique_id,
    nbc_min_area_for,
    polygon_area,
    require_plot_polygon,
)
from app.templates._common import (
    make_external_wall_layers,
    make_internal_wall_layers,
)

EXTENSION_TYPE = "servant_quarter"

DEFAULT_BEDROOM_WIDTH_M: float = 4.75
DEFAULT_BEDROOM_DEPTH_M: float = 2.0  # NBC-clear at 3.0m rear setback
DEFAULT_BATH_WIDTH_M: float = 1.5
DEFAULT_WALL_HEIGHT_M: float = 2.85
DEFAULT_SLAB_THICKNESS_M: float = 0.150
NBC_REAR_CLEARANCE_M: float = 1.0


def add_servant_quarter(
    bm: BuildingModel,
    *,
    bedroom_width_m: float = DEFAULT_BEDROOM_WIDTH_M,
    bedroom_depth_m: float = DEFAULT_BEDROOM_DEPTH_M,
    bath_width_m: float = DEFAULT_BATH_WIDTH_M,
    wall_height_m: float = DEFAULT_WALL_HEIGHT_M,
) -> BuildingModel:
    """Add a servant quarter (bedroom + bath) at the rear of the plot.

    Returns
    -------
    BuildingModel
        Re-validated under all 13 invariants. Adds:
          * 4 outer Walls (250mm external) + 1 partition Wall (135mm)
          * 1 RCC ROOF Slab covering the servant footprint
          * 2 Rooms (bedroom + bath) with full bounding edges
          * 2 Openings (entry from outside; bedroom-to-bath internal)
          * 2 Doors (entry + internal)
          * 2 Openings (one window per room) + 2 Windows

    Raises
    ------
    ExtensionRequiresPlotError, PlotBoundaryViolationError, NBCViolationError
    """
    plot = require_plot_polygon(bm, EXTENSION_TYPE)
    plot_xs, plot_ys = [v.x for v in plot], [v.y for v in plot]
    plot_x_min, plot_x_max = min(plot_xs), max(plot_xs)
    plot_y_min, _plot_y_max = min(plot_ys), max(plot_ys)

    envelope = bm.project.site.building.envelope_polygon
    if not envelope:
        raise ExtensionError(
            extension_type=EXTENSION_TYPE,
            reason="Building.envelope_polygon is empty",
        )
    env_y_min = min(v.y for v in envelope)

    # Rear setback (south side): plot y=0 to envelope y_min.
    rear_setback = env_y_min - plot_y_min
    if bedroom_depth_m + NBC_REAR_CLEARANCE_M > rear_setback + 0.001:
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"servant depth {bedroom_depth_m:.2f}m + NBC rear clearance "
                f"{NBC_REAR_CLEARANCE_M:.2f}m exceeds available rear setback "
                f"{rear_setback:.2f}m. Only 3BHK templates have rear "
                f"setback ≥ 3.0m and fit the default servant quarter size."
            ),
        )

    total_width = bedroom_width_m + bath_width_m
    if total_width > plot_x_max - plot_x_min:
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"servant total width {total_width:.2f}m exceeds plot width "
                f"{plot_x_max - plot_x_min:.2f}m"
            ),
        )

    # Centered on plot, rear-aligned.
    x_off = plot_x_min + (plot_x_max - plot_x_min - total_width) / 2.0
    y_min = plot_y_min  # rear edge of plot
    y_max = plot_y_min + bedroom_depth_m

    bedroom_x_min = x_off
    bedroom_x_max = x_off + bedroom_width_m
    bath_x_min = bedroom_x_max
    bath_x_max = x_off + total_width

    # NBC area checks (defense in depth — caller-supplied dims may be
    # custom; we still verify NBC compliance).
    bedroom_area = bedroom_width_m * bedroom_depth_m
    bath_area = bath_width_m * bedroom_depth_m
    if bedroom_area < nbc_min_area_for("bedroom") - 0.001:
        raise NBCViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"servant bedroom area {bedroom_area:.2f} sqm below NBC "
                f"bedroom minimum {nbc_min_area_for('bedroom'):.2f} sqm"
            ),
        )
    if bath_area < nbc_min_area_for("bathroom") - 0.001:
        raise NBCViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"servant bath area {bath_area:.2f} sqm below NBC "
                f"bathroom minimum {nbc_min_area_for('bathroom'):.2f} sqm"
            ),
        )

    ground = get_ground_storey(bm)
    existing_ids = collect_existing_ids(bm)

    # Corner points (CCW outer perimeter).
    sw = Vec2(x=x_off, y=y_min)
    se = Vec2(x=bath_x_max, y=y_min)
    ne = Vec2(x=bath_x_max, y=y_max)
    nw = Vec2(x=x_off, y=y_max)
    # Partition endpoints.
    p_s = Vec2(x=bedroom_x_max, y=y_min)
    p_n = Vec2(x=bedroom_x_max, y=y_max)

    # 5 walls.
    wall_south = Wall(
        id=make_unique_id("ext-sq-wall-S", existing_ids),
        name="Servant Quarter (South)",
        host_storey_ids=[ground.id],
        axis_points=[sw, se],
        base_z=0.0,
        top_z=wall_height_m,
        thickness=0.250,
        layers=make_external_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=True,
    )
    wall_east = Wall(
        id=make_unique_id("ext-sq-wall-E", existing_ids),
        name="Servant Quarter (East)",
        host_storey_ids=[ground.id],
        axis_points=[se, ne],
        base_z=0.0,
        top_z=wall_height_m,
        thickness=0.250,
        layers=make_external_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=True,
    )
    wall_north = Wall(
        id=make_unique_id("ext-sq-wall-N", existing_ids),
        name="Servant Quarter (North)",
        host_storey_ids=[ground.id],
        axis_points=[ne, nw],
        base_z=0.0,
        top_z=wall_height_m,
        thickness=0.250,
        layers=make_external_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=True,
    )
    wall_west = Wall(
        id=make_unique_id("ext-sq-wall-W", existing_ids),
        name="Servant Quarter (West)",
        host_storey_ids=[ground.id],
        axis_points=[nw, sw],
        base_z=0.0,
        top_z=wall_height_m,
        thickness=0.250,
        layers=make_external_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=True,
    )
    wall_partition = Wall(
        id=make_unique_id("ext-sq-wall-P", existing_ids),
        name="Servant Quarter (Partition)",
        host_storey_ids=[ground.id],
        axis_points=[p_s, p_n],
        base_z=0.0,
        top_z=wall_height_m,
        thickness=0.135,
        layers=make_internal_wall_layers(),
        type="solid",
        is_external=False,
        is_load_bearing=False,
    )

    # Bedroom: CCW perimeter = south → partition (left) → north → west.
    bedroom_id = make_unique_id("ext-sq-bedroom", existing_ids)
    bedroom_footprint = make_ccw_rectangle(
        bedroom_x_min, y_min, bedroom_x_max, y_max
    )
    bedroom = Room(
        id=bedroom_id,
        name="Servant Bedroom",
        usage="bedroom",
        footprint_polygon=bedroom_footprint,
        bounding_edges=[
            BoundaryEdge(wall_id=wall_south.id, side="left"),
            BoundaryEdge(wall_id=wall_partition.id, side="left"),
            BoundaryEdge(wall_id=wall_north.id, side="left"),
            BoundaryEdge(wall_id=wall_west.id, side="left"),
        ],
    )

    # Bath: CCW perimeter = south → east → north → partition (right).
    bath_id = make_unique_id("ext-sq-bath", existing_ids)
    bath_footprint = make_ccw_rectangle(
        bath_x_min, y_min, bath_x_max, y_max
    )
    bath = Room(
        id=bath_id,
        name="Servant Bath",
        usage="bathroom",
        footprint_polygon=bath_footprint,
        bounding_edges=[
            BoundaryEdge(wall_id=wall_south.id, side="left"),
            BoundaryEdge(wall_id=wall_east.id, side="left"),
            BoundaryEdge(wall_id=wall_north.id, side="left"),
            BoundaryEdge(wall_id=wall_partition.id, side="right"),
        ],
    )

    # Roof slab covering the entire servant footprint.
    roof_polygon = make_ccw_rectangle(x_off, y_min, bath_x_max, y_max)
    roof_slab = Slab(
        id=make_unique_id("ext-sq-roof", existing_ids),
        host_storey_id=ground.id,
        footprint_polygon=roof_polygon,
        bottom_z=wall_height_m,
        top_z=wall_height_m + DEFAULT_SLAB_THICKNESS_M,
        predefined_type="ROOF",
    )

    # Entry door: in NORTH wall (y=y_max), bedroom side. Door faces
    # the building, which is the natural servant entry approach.
    # North wall axis runs from NE to NW (direction -X). Distance from
    # NE start: place door over the bedroom portion, centered.
    north_wall_length = bath_x_max - x_off
    bedroom_north_dist_start = bath_width_m  # NE → NW: distance bath_width_m to reach partition
    bedroom_north_dist_center = bedroom_north_dist_start + bedroom_width_m / 2.0
    entry_door_width = 0.8
    entry_opening = Opening(
        id=make_unique_id("ext-sq-opening-entry", existing_ids),
        in_wall_id=wall_north.id,
        distance_along_wall=bedroom_north_dist_center - entry_door_width / 2.0,
        sill_z=0.0,
        width=entry_door_width,
        height=2.0,
        predefined_type="DOOR",
    )
    entry_door = Door(
        id=make_unique_id("ext-sq-door-entry", existing_ids),
        in_opening_id=entry_opening.id,
        connects_room_ids=["Outside", bedroom_id],
        swing="inward",
        handedness="left",
        predefined_type="DOOR",
    )

    # Internal door: in partition (axis south→north). Centered.
    int_door_width = 0.7
    int_opening = Opening(
        id=make_unique_id("ext-sq-opening-int", existing_ids),
        in_wall_id=wall_partition.id,
        distance_along_wall=(bedroom_depth_m - int_door_width) / 2.0,
        sill_z=0.0,
        width=int_door_width,
        height=2.0,
        predefined_type="DOOR",
    )
    int_door = Door(
        id=make_unique_id("ext-sq-door-int", existing_ids),
        in_opening_id=int_opening.id,
        connects_room_ids=[bedroom_id, bath_id],
        swing="inward",
        handedness="left",
        predefined_type="DOOR",
    )

    # Windows: one in bedroom (south wall), one in bath (south wall).
    # South wall axis runs SW → SE (direction +X), length = total_width.
    bedroom_win_opening = Opening(
        id=make_unique_id("ext-sq-opening-win-br", existing_ids),
        in_wall_id=wall_south.id,
        distance_along_wall=bedroom_width_m / 2.0 - 0.5,
        sill_z=0.9,
        width=1.0,
        height=1.2,
        predefined_type="WINDOW",
    )
    bedroom_window = Window(
        id=make_unique_id("ext-sq-window-br", existing_ids),
        in_opening_id=bedroom_win_opening.id,
    )
    bath_win_opening = Opening(
        id=make_unique_id("ext-sq-opening-win-ba", existing_ids),
        in_wall_id=wall_south.id,
        distance_along_wall=bedroom_width_m + bath_width_m / 2.0 - 0.2,
        sill_z=1.5,
        width=0.4,
        height=0.6,
        predefined_type="WINDOW",
    )
    bath_window = Window(
        id=make_unique_id("ext-sq-window-ba", existing_ids),
        in_opening_id=bath_win_opening.id,
    )

    return commit_to_storey(
        bm,
        storey_index=0,
        walls=[
            wall_south,
            wall_east,
            wall_north,
            wall_west,
            wall_partition,
        ],
        rooms=[bedroom, bath],
        slabs=[roof_slab],
        openings=[
            entry_opening,
            int_opening,
            bedroom_win_opening,
            bath_win_opening,
        ],
        doors=[entry_door, int_door],
        windows=[bedroom_window, bath_window],
    )


__all__ = [
    "add_servant_quarter",
    "DEFAULT_BEDROOM_WIDTH_M",
    "DEFAULT_BEDROOM_DEPTH_M",
    "DEFAULT_BATH_WIDTH_M",
    "DEFAULT_WALL_HEIGHT_M",
    "NBC_REAR_CLEARANCE_M",
]
