"""Slice 2B.3 — Car porch extension.

Adds a covered parking structure in the front (north) setback area.
The porch is an OPEN structure (no walls): 4 RCC corner columns
supporting a flat RCC roof slab. The user parks their car under it.

Geometry
--------
Default 6.0m × 3.0m × 2.7m (W × D × H), centered along the plot's
north edge with the porch outer face flush with the plot front
boundary (porches commonly extend right up to the property line in
Indian residential practice). The 1.5m NBC approach-clearance is
maintained between porch inner face and the building's front wall.

Open structure: no Room
-----------------------
ROOM_BOUNDED requires every Room to have ≥3 bounding edges (i.e.
≥3 surrounding walls). The car porch has zero walls, so it cannot
be modeled as a Room. From an IFC perspective the porch IS the slab
+ columns; an enclosed IfcSpace would be inappropriate. The slice
prompt's mention of "1 Room with usage='parking'" is dropped in v1
in favour of architectural correctness.

Failure modes
-------------
- ``ExtensionRequiresPlotError`` — empty Site.plot_polygon (towers).
- ``PlotBoundaryViolationError`` — porch_depth + 1.5m NBC clearance
  exceeds front setback (1BHK / 2BHK templates with 2.5m front
  setback fail at default 3.0m porch depth; user can override via
  ``porch_depth_m=1.0`` to fit smaller plots).
- ``PlotBoundaryViolationError`` — porch_width exceeds plot width.
"""

from __future__ import annotations

from app.domain.building_model import (
    BuildingModel,
    Column,
    ProfileRef,
    Slab,
    Vec2,
)

from ._common import (
    ExtensionError,
    PlotBoundaryViolationError,
    collect_existing_ids,
    commit_to_storey,
    get_ground_storey,
    make_ccw_rectangle,
    make_unique_id,
    require_plot_polygon,
)

EXTENSION_TYPE = "car_porch"

DEFAULT_PORCH_WIDTH_M: float = 6.0
DEFAULT_PORCH_DEPTH_M: float = 3.0
DEFAULT_PORCH_HEIGHT_M: float = 2.7
DEFAULT_COLUMN_SIZE_M: float = 0.230  # RCC 230×230 (single brick equivalent)
DEFAULT_SLAB_THICKNESS_M: float = 0.150
NBC_FRONT_CLEARANCE_M: float = 1.5  # NBC India minimum approach clearance


def add_car_porch(
    bm: BuildingModel,
    *,
    porch_width_m: float = DEFAULT_PORCH_WIDTH_M,
    porch_depth_m: float = DEFAULT_PORCH_DEPTH_M,
    porch_height_m: float = DEFAULT_PORCH_HEIGHT_M,
) -> BuildingModel:
    """Add a covered car porch to the front setback.

    Returns
    -------
    BuildingModel
        Re-validated under all 13 invariants. Adds:
          * 4 RCC Columns (230×230 corners)
          * 1 RCC roof Slab (predefined_type="ROOF")

    Raises
    ------
    ExtensionRequiresPlotError, PlotBoundaryViolationError
    """
    plot = require_plot_polygon(bm, EXTENSION_TYPE)
    plot_xs, plot_ys = [v.x for v in plot], [v.y for v in plot]
    plot_x_min, plot_x_max = min(plot_xs), max(plot_xs)
    plot_y_min, plot_y_max = min(plot_ys), max(plot_ys)

    envelope = bm.project.site.building.envelope_polygon
    if not envelope:
        raise ExtensionError(
            extension_type=EXTENSION_TYPE,
            reason=(
                "Building.envelope_polygon is empty; cannot derive front "
                "setback. Templates must populate envelope_polygon."
            ),
        )
    env_y_max = max(v.y for v in envelope)

    # NBC clearance: front setback minus porch depth ≥ 1.5m.
    # Equivalent to: porch_depth + clearance ≤ plot_y_max - env_y_max.
    front_setback = plot_y_max - env_y_max
    if porch_depth_m + NBC_FRONT_CLEARANCE_M > front_setback + 0.001:
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"porch_depth_m={porch_depth_m:.2f}m + NBC clearance "
                f"{NBC_FRONT_CLEARANCE_M:.2f}m exceeds available front "
                f"setback {front_setback:.2f}m (plot_y_max={plot_y_max:.2f} - "
                f"envelope_y_max={env_y_max:.2f}). Reduce porch_depth_m or "
                f"choose a template with a deeper front setback."
            ),
        )

    # Porch placement: outer edge at plot_y_max (flush with property
    # line), centered in x.
    porch_y_max = plot_y_max
    porch_y_min = plot_y_max - porch_depth_m
    porch_cx = (plot_x_min + plot_x_max) / 2.0
    porch_x_min = porch_cx - porch_width_m / 2.0
    porch_x_max = porch_cx + porch_width_m / 2.0

    # Plot-fit guard for x.
    if porch_x_min < plot_x_min - 0.001 or porch_x_max > plot_x_max + 0.001:
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"porch_width_m={porch_width_m:.2f}m exceeds plot width "
                f"{plot_x_max - plot_x_min:.2f}m"
            ),
        )

    ground = get_ground_storey(bm)
    existing_ids = collect_existing_ids(bm)

    # 4 corner columns. Each column's centerline sits inset by
    # column_size/2 from the porch corner so the 230×230 footprint is
    # entirely within the porch envelope.
    cs = DEFAULT_COLUMN_SIZE_M
    corners_xy = [
        (porch_x_min + cs / 2.0, porch_y_min + cs / 2.0, "SW"),
        (porch_x_max - cs / 2.0, porch_y_min + cs / 2.0, "SE"),
        (porch_x_max - cs / 2.0, porch_y_max - cs / 2.0, "NE"),
        (porch_x_min + cs / 2.0, porch_y_max - cs / 2.0, "NW"),
    ]
    porch_profile = ProfileRef(
        name="RCC-Column-230x230",
        profile_type="rectangle",
        dimensions={"width": cs, "height": cs},
    )
    columns = [
        Column(
            id=make_unique_id(f"ext-cp-col-{tag}", existing_ids),
            host_storey_id=ground.id,
            location=Vec2(x=cx, y=cy),
            profile=porch_profile,
            material="RCC-M25",
            base_z=0.0,
            top_z=porch_height_m,
            is_load_bearing=True,
        )
        for cx, cy, tag in corners_xy
    ]

    # Roof slab covering the porch.
    porch_polygon = make_ccw_rectangle(
        porch_x_min, porch_y_min, porch_x_max, porch_y_max
    )
    porch_slab = Slab(
        id=make_unique_id("ext-cp-roof", existing_ids),
        host_storey_id=ground.id,
        footprint_polygon=porch_polygon,
        bottom_z=porch_height_m,
        top_z=porch_height_m + DEFAULT_SLAB_THICKNESS_M,
        predefined_type="ROOF",
    )

    return commit_to_storey(
        bm,
        storey_index=0,
        slabs=[porch_slab],
        columns=columns,
    )


__all__ = [
    "add_car_porch",
    "DEFAULT_PORCH_WIDTH_M",
    "DEFAULT_PORCH_DEPTH_M",
    "DEFAULT_PORCH_HEIGHT_M",
    "DEFAULT_COLUMN_SIZE_M",
    "DEFAULT_SLAB_THICKNESS_M",
    "NBC_FRONT_CLEARANCE_M",
]
