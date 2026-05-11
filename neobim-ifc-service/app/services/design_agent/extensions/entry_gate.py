"""Slice 2B.3 — Entry gate extension.

Adds a main entry gate to the front (north) compound wall: a 3.0m-wide
sliding gate flanked by two 300×300mm brick piers. The gate cuts a
DOOR-type opening in the north compound wall segment (Opening with
predefined_type="DOOR"), and the gate door itself is an IfcDoor with
predefined_type="GATE" (the new ``Door.predefined_type`` field added
in Slice 2B.3 Phase A.1).

Auto-add compound wall
----------------------
Per decisions doc §1.2 + canonical ordering, the orchestrator runs
compound_wall first, so by the time entry_gate fires the wall is
usually already there. But if a user requests *only* a gate (no
compound wall in the plan), this function auto-adds the compound
wall first — the gate is geometrically meaningless without a wall to
cut a hole in.

Detection of the existing compound wall: ID prefix scan
(``ext-compound-N-*`` on the ground storey). If present, no
auto-add. If absent, ``add_compound_wall`` is called and the
returned BuildingModel is the input to the gate logic.

Pier modelling
--------------
Brick piers are modelled as :class:`Column` entities with a
``rectangle`` profile (300×300mm) and material
``"Burnt-Clay-Brick-230mm"``. They sit on either side of the gate
opening, on the plot's north boundary line, hosted on the ground
storey at z=[0, gate_height_m].

Failure modes
-------------
- ``ExtensionRequiresPlotError`` — empty Site.plot_polygon (towers).
- ``NBCViolationError`` — gate width < 2.7m (PMC bylaw minimum for
  vehicle access).
- ``PlotBoundaryViolationError`` — gate width exceeds north compound
  wall length (extremely small plot — defensive guard).
"""

from __future__ import annotations

from app.domain.building_model import (
    BuildingModel,
    Column,
    Door,
    Opening,
    ProfileRef,
    Vec2,
)

from ._common import (
    NBCViolationError,
    PlotBoundaryViolationError,
    collect_existing_ids,
    commit_to_storey,
    get_ground_storey,
    make_unique_id,
    require_plot_polygon,
)
from .compound_wall import add_compound_wall

EXTENSION_TYPE = "entry_gate"

DEFAULT_GATE_WIDTH_M: float = 3.0
DEFAULT_GATE_HEIGHT_M: float = 1.8
DEFAULT_PIER_SIZE_M: float = 0.3
NBC_MIN_GATE_WIDTH_M: float = 2.7  # PMC bylaw vehicle-access minimum


def _find_north_compound_wall(bm: BuildingModel):
    """Return the north compound wall on the ground storey, or None."""
    ground = get_ground_storey(bm)
    for w in ground.walls:
        if w.id.startswith("ext-compound-N-"):
            return w
    return None


def add_entry_gate(
    bm: BuildingModel,
    *,
    gate_width_m: float = DEFAULT_GATE_WIDTH_M,
    gate_height_m: float = DEFAULT_GATE_HEIGHT_M,
) -> BuildingModel:
    """Add an entry gate to the BuildingModel.

    Auto-adds compound wall if not already present.

    Parameters
    ----------
    bm
        Source BuildingModel. Must have a non-empty Site.plot_polygon.
    gate_width_m
        Gate clear-opening width. Default 3.0m. Must be ≥ 2.7m
        (NBC_MIN_GATE_WIDTH_M, PMC vehicle-access minimum).
    gate_height_m
        Gate clear-opening height. Default 1.8m (matches default
        compound wall height; gate spans the full wall).

    Returns
    -------
    BuildingModel
        Re-validated under all 13 invariants. Adds:
          * compound wall (if not already present)
          * 1 Opening on the north compound wall (predefined_type="DOOR")
          * 1 Door (predefined_type="GATE", swing="sliding")
          * 2 Columns (brick piers flanking the gate)

    Raises
    ------
    ExtensionRequiresPlotError, NBCViolationError, PlotBoundaryViolationError
    """
    plot = require_plot_polygon(bm, EXTENSION_TYPE)

    # NBC minimum gate width.
    if gate_width_m < NBC_MIN_GATE_WIDTH_M:
        raise NBCViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"gate_width_m={gate_width_m:.2f}m is below the NBC India / "
                f"PMC minimum {NBC_MIN_GATE_WIDTH_M:.2f}m for vehicle access"
            ),
        )

    # Auto-add compound wall if not present.
    north_wall = _find_north_compound_wall(bm)
    if north_wall is None:
        bm = add_compound_wall(bm, height_m=gate_height_m)
        north_wall = _find_north_compound_wall(bm)
        # Defensive — should be present after add_compound_wall.
        assert north_wall is not None, "compound wall add failed silently"

    # North wall axis runs from NE (x_max, y_max) to NW (x_min, y_max).
    # Gate is centered along this wall.
    ne, nw = north_wall.axis_points
    north_wall_length = abs(ne.x - nw.x)
    if gate_width_m > north_wall_length:
        raise PlotBoundaryViolationError(
            extension_type=EXTENSION_TYPE,
            reason=(
                f"gate_width_m={gate_width_m:.2f}m exceeds north compound "
                f"wall length {north_wall_length:.2f}m"
            ),
        )

    # distance_along_wall is from start (NE) along the polyline. Gate
    # centered means start at (north_wall_length - gate_width_m) / 2.
    gate_start_dist = (north_wall_length - gate_width_m) / 2.0

    # Pier locations: at the gate's two edges, on the north plot line.
    # NE → NW direction is -x, so left pier (closer to NE) is at
    # x = ne.x - gate_start_dist; right pier at x = ne.x - (gate_start_dist + gate_width_m).
    pier_left_x = ne.x - gate_start_dist
    pier_right_x = pier_left_x - gate_width_m
    pier_y = ne.y  # on the north plot line

    ground = get_ground_storey(bm)
    existing_ids = collect_existing_ids(bm)

    pier_profile = ProfileRef(
        name="Brick-Pier-300x300",
        profile_type="rectangle",
        dimensions={"width": DEFAULT_PIER_SIZE_M, "height": DEFAULT_PIER_SIZE_M},
    )

    pier_left = Column(
        id=make_unique_id("ext-eg-pier-L", existing_ids),
        host_storey_id=ground.id,
        location=Vec2(x=pier_left_x, y=pier_y),
        profile=pier_profile,
        material="Burnt-Clay-Brick-230mm",
        base_z=0.0,
        top_z=gate_height_m,
        is_load_bearing=False,
    )
    pier_right = Column(
        id=make_unique_id("ext-eg-pier-R", existing_ids),
        host_storey_id=ground.id,
        location=Vec2(x=pier_right_x, y=pier_y),
        profile=pier_profile,
        material="Burnt-Clay-Brick-230mm",
        base_z=0.0,
        top_z=gate_height_m,
        is_load_bearing=False,
    )

    # Opening cut into the north compound wall.
    opening = Opening(
        id=make_unique_id("ext-eg-opening", existing_ids),
        in_wall_id=north_wall.id,
        distance_along_wall=gate_start_dist,
        sill_z=0.0,
        width=gate_width_m,
        height=gate_height_m,
        predefined_type="DOOR",
    )

    # The actual gate as an IfcDoor with PredefinedType="GATE".
    gate_door = Door(
        id=make_unique_id("ext-eg-gate", existing_ids),
        in_opening_id=opening.id,
        connects_room_ids=["Outside"],
        swing="sliding",
        handedness="left",
        predefined_type="GATE",
    )

    return commit_to_storey(
        bm,
        storey_index=0,
        openings=[opening],
        doors=[gate_door],
        columns=[pier_left, pier_right],
    )


__all__ = [
    "add_entry_gate",
    "DEFAULT_GATE_WIDTH_M",
    "DEFAULT_GATE_HEIGHT_M",
    "DEFAULT_PIER_SIZE_M",
    "NBC_MIN_GATE_WIDTH_M",
]
