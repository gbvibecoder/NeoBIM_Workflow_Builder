"""Slice 2B.3 — Compound wall extension.

Adds a perimeter brick wall around the legal plot boundary. The
simplest of the five extensions: no rooms, no doors, no windows, no
NBC validation needed (compound walls don't enclose habitable space).
A 1.8m-tall, 230mm-thick boundary wall is the Indian residential
standard (NBC ≤ 2.0m PMC bylaw).

Geometry
--------
Four wall segments laid CCW around the plot perimeter, each spanning
one edge of the (rectangular) plot polygon:

    south:  y=y_min, x: x_min  → x_max
    east:   x=x_max, y: y_min  → y_max
    north:  y=y_max, x: x_max  → x_min   (CCW direction)
    west:   x=x_min, y: y_max  → y_min   (CCW direction)

Each segment is a single Wall entity with axis_points = [start, end]
(2-vertex polyline). Wall thickness 230mm extends to either side of
the axis; for compound walls placed exactly on the plot edge, half
the thickness sits outside the plot polygon. This is geometrically
correct (boundary walls straddle the legal property line in
practice) and PLOT_POLYGON_VALID does NOT enforce thickness fit
(it checks envelope-polygon vertex containment only).

Wall segments are hosted on the ground storey (index=0) so they sit
at z=[0, 1.8]m alongside the building.

Pipeline position
-----------------
Compound wall runs FIRST in the canonical extension order
(compound_wall → entry_gate → car_porch → servant_quarter → mumty)
because entry_gate cuts an opening into the north compound wall
segment — the gate extension fails fast if the wall isn't there yet.

Failure modes
-------------
- ``ExtensionRequiresPlotError`` — empty Site.plot_polygon (tower
  templates).  v1: tower compound walls are deferred (real-world
  rationale: tower compound walls belong to the developer/society
  site, not the individual tower).
- ``PlotBoundaryViolationError`` — should never fire in v1 because
  the wall axis sits ON the plot boundary by construction; the guard
  exists for forward-compatibility with non-rectangular plots.

The compound wall idempotently overwrites — a second compound_wall
call after the first does NOT add 4 more walls because every Wall
.id is namespaced (``ext-compound-{S,E,N,W}-1``) and would clash via
DUPLICATE_WALL_ID. Callers must guard against double-application;
the orchestrator does this naturally because each extension appears
at most once in an ExtensionPlan.
"""

from __future__ import annotations

from app.domain.building_model import BuildingModel, Vec2

from ._common import (
    collect_existing_ids,
    commit_to_storey,
    get_ground_storey,
    make_compound_wall,
    make_unique_id,
    require_plot_polygon,
)

EXTENSION_TYPE = "compound_wall"

# Default heights — exposed as kwargs so the planner can override
# (e.g., 1.5m if the user explicitly asks for "low compound wall").
DEFAULT_HEIGHT_M: float = 1.8
DEFAULT_BASE_Z_M: float = 0.0


def add_compound_wall(
    bm: BuildingModel,
    *,
    height_m: float = DEFAULT_HEIGHT_M,
    base_z_m: float = DEFAULT_BASE_Z_M,
) -> BuildingModel:
    """Add a 4-segment perimeter compound wall to the BuildingModel.

    Parameters
    ----------
    bm
        Source BuildingModel.  Must have a non-empty
        ``Site.plot_polygon`` (raises ``ExtensionRequiresPlotError``
        otherwise — tower v1 deferral path).
    height_m
        Top-of-wall elevation above ``base_z_m``.  Default 1.8m
        (NBC compliant; PMC bylaw ≤ 2.0m).  Caller is responsible
        for keeping this within the host storey's height envelope
        (WALL_BASE_VALID enforces that against ground storey
        actual_height).
    base_z_m
        Bottom-of-wall elevation.  Default 0.0m (compound wall sits
        at ground level alongside the building's plinth).

    Returns
    -------
    BuildingModel
        New BuildingModel with 4 additional Wall entities on the
        ground storey, re-validated under all 13 invariants.

    Raises
    ------
    ExtensionRequiresPlotError
        ``Site.plot_polygon`` is empty (tower templates).
    """
    plot = require_plot_polygon(bm, EXTENSION_TYPE)
    ground = get_ground_storey(bm)

    # The plot is rectangular by construction in v1 (every backfilled
    # template emits a rectangle). Pull its bbox for segment endpoints.
    xs = [v.x for v in plot]
    ys = [v.y for v in plot]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    existing_ids = collect_existing_ids(bm)

    sw = Vec2(x=x_min, y=y_min)
    se = Vec2(x=x_max, y=y_min)
    ne = Vec2(x=x_max, y=y_max)
    nw = Vec2(x=x_min, y=y_max)

    walls = [
        make_compound_wall(
            wall_id=make_unique_id("ext-compound-S", existing_ids),
            name="Compound Wall (South)",
            host_storey_id=ground.id,
            start=sw,
            end=se,
            base_z=base_z_m,
            top_z=base_z_m + height_m,
        ),
        make_compound_wall(
            wall_id=make_unique_id("ext-compound-E", existing_ids),
            name="Compound Wall (East)",
            host_storey_id=ground.id,
            start=se,
            end=ne,
            base_z=base_z_m,
            top_z=base_z_m + height_m,
        ),
        make_compound_wall(
            wall_id=make_unique_id("ext-compound-N", existing_ids),
            name="Compound Wall (North)",
            host_storey_id=ground.id,
            start=ne,
            end=nw,
            base_z=base_z_m,
            top_z=base_z_m + height_m,
        ),
        make_compound_wall(
            wall_id=make_unique_id("ext-compound-W", existing_ids),
            name="Compound Wall (West)",
            host_storey_id=ground.id,
            start=nw,
            end=sw,
            base_z=base_z_m,
            top_z=base_z_m + height_m,
        ),
    ]

    return commit_to_storey(bm, storey_index=0, walls=walls)


__all__ = ["add_compound_wall", "DEFAULT_HEIGHT_M", "DEFAULT_BASE_Z_M"]
