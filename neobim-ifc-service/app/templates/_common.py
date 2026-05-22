"""Phase T1 — Reusable helpers for Tier-2 BuildingModel templates.

Pure-Python primitive constructors that other Tier-2 templates (this slice
authors `tier2_2bhk_pune.py`; later slices author tier2_3bhk_*, tier2_villa_*,
etc.) build on. Helpers are deliberately small and composable — each takes
explicit parameters, returns a frozen Pydantic node, and never reads global
state. No `random`, no `datetime.now()`, no fallback chains.

Wall-direction convention used by the helpers:

    External (perimeter) walls walked CCW around the building exterior.
        south:  west → east   (+x direction)
        east:   south → north (+y direction)
        north:  east → west   (-x direction)
        west:   north → south (-y direction)
    Internal partitions:
        horizontal: west → east (+x)
        vertical:   south → north (+y)

The room-side convention follows from this:

    External walls           — interior side is always "left".
    Horizontal partition     — room north of wall is "left", south is "right".
    Vertical partition       — room west of wall is "left", east is "right".

Helpers do not enforce the convention; the template author opts in by using
them. Anyone authoring an irregular wall layout outside the helpers is
responsible for `BoundaryEdge.side` correctness.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from app.domain.building_model import (
    Beam,
    BoundaryEdge,
    Column,
    Door,
    Footing,
    MaterialLayer,
    Opening,
    ProfileRef,
    Room,
    Slab,
    Stair,
    Vec2,
    Vec3,
    Wall,
    Window,
)


# ─── Material layer presets (Indian residential RCC) ─────────────────


def make_external_wall_layers() -> list[MaterialLayer]:
    """3-layer external wall: 10mm cement plaster + 230mm burnt-clay brick + 10mm plaster.

    Total thickness 0.250m. Used for the perimeter walls of every Tier-2
    template. The 'core' layer is the structural brick; the two 'finish'
    layers are the plaster coats. Ordering is exterior → interior.
    """
    return [
        MaterialLayer(
            material_name="Cement-Plaster-Exterior", thickness=0.010, function="finish"
        ),
        MaterialLayer(
            material_name="Burnt-Clay-Brick-230mm", thickness=0.230, function="core"
        ),
        MaterialLayer(
            material_name="Cement-Plaster-Interior", thickness=0.010, function="finish"
        ),
    ]


def make_internal_wall_layers() -> list[MaterialLayer]:
    """3-layer internal partition: 10mm plaster + 115mm half-brick + 10mm plaster.

    Total thickness 0.135m. Indian residential standard for non-load-bearing
    internal partitions.
    """
    return [
        MaterialLayer(material_name="Cement-Plaster", thickness=0.010, function="finish"),
        MaterialLayer(
            material_name="Burnt-Clay-Brick-115mm", thickness=0.115, function="core"
        ),
        MaterialLayer(material_name="Cement-Plaster", thickness=0.010, function="finish"),
    ]


def make_slab_layers() -> list[MaterialLayer]:
    """3-layer floor slab: 30mm tile/finish + 90mm RCC core + 30mm ceiling finish.

    Total thickness 0.150m. Layer ordering is top-of-slab → bottom-of-slab.
    """
    return [
        MaterialLayer(
            material_name="Vitrified-Tile-Floor", thickness=0.030, function="finish"
        ),
        MaterialLayer(material_name="M25-RCC", thickness=0.090, function="core"),
        MaterialLayer(
            material_name="Cement-Plaster-Ceiling",
            thickness=0.030,
            function="finish",
        ),
    ]


def make_roof_slab_layers() -> list[MaterialLayer]:
    """3-layer roof slab: 30mm waterproofing/finish + 90mm RCC core + 30mm ceiling finish."""
    return [
        MaterialLayer(
            material_name="APP-Membrane-Waterproofing",
            thickness=0.030,
            function="finish",
        ),
        MaterialLayer(material_name="M25-RCC", thickness=0.090, function="core"),
        MaterialLayer(
            material_name="Cement-Plaster-Ceiling",
            thickness=0.030,
            function="finish",
        ),
    ]


# ─── Polygon construction ────────────────────────────────────────────


def make_rectangular_polygon_ccw(
    xmin: float, xmax: float, ymin: float, ymax: float
) -> list[Vec2]:
    """Axis-aligned rectangle polygon in CCW order.

    Returns 4 Vec2s: (xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax).
    Signed area = (xmax - xmin) * (ymax - ymin) > 0 (CCW). Pre-conditions:
    xmax > xmin and ymax > ymin; FOOTPRINT_VALID will reject collapsed
    rectangles, but raising here gives a clearer error.
    """
    if not (xmax > xmin and ymax > ymin):
        raise ValueError(
            f"make_rectangular_polygon_ccw: degenerate rectangle "
            f"x=[{xmin}, {xmax}], y=[{ymin}, {ymax}] — "
            "xmax must be > xmin and ymax > ymin."
        )
    return [
        Vec2(x=xmin, y=ymin),
        Vec2(x=xmax, y=ymin),
        Vec2(x=xmax, y=ymax),
        Vec2(x=xmin, y=ymax),
    ]


# ─── Room construction ──────────────────────────────────────────────


def make_axis_aligned_room(
    *,
    room_id: str,
    name: str,
    usage: str,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    south_wall: tuple[str, Literal["left", "right"]],
    east_wall: tuple[str, Literal["left", "right"]],
    north_wall: tuple[str, Literal["left", "right"]],
    west_wall: tuple[str, Literal["left", "right"]],
) -> Room:
    """Build an axis-aligned rectangular Room.

    Parameters:
        xmin/xmax/ymin/ymax: footprint corners in world coordinates. These
            should be the inner-face coordinates of the bounding walls so
            footprint area matches the actual interior void.
        south/east/north/west_wall: (wall_id, side) for each side. The
            caller must supply the correct side per the wall-direction
            convention documented at the top of this module.

    The 4 bounding edges are emitted in CCW order (south → east → north →
    west) so the corner-resolution algorithm in `_i_room_bounded` walks
    consecutive edges that meet at room corners.
    """
    polygon = make_rectangular_polygon_ccw(xmin, xmax, ymin, ymax)
    bounding_edges = [
        BoundaryEdge(wall_id=south_wall[0], side=south_wall[1]),
        BoundaryEdge(wall_id=east_wall[0], side=east_wall[1]),
        BoundaryEdge(wall_id=north_wall[0], side=north_wall[1]),
        BoundaryEdge(wall_id=west_wall[0], side=west_wall[1]),
    ]
    return Room(
        id=room_id,
        name=name,
        usage=usage,
        footprint_polygon=polygon,
        bounding_edges=bounding_edges,
    )


# ─── Wall construction ──────────────────────────────────────────────


def make_external_wall(
    *,
    wall_id: str,
    name: str | None,
    host_storey_id: str,
    start: Vec2,
    end: Vec2,
    base_z: float,
    top_z: float,
) -> Wall:
    """External (perimeter) wall: 0.250m thick, solid, load-bearing, 3-layer composite.

    Caller is responsible for the CCW direction: walks should go S→E→N→W
    around the building exterior so that all room bounding_edges referencing
    these walls use side="left".
    """
    return Wall(
        id=wall_id,
        name=name,
        host_storey_ids=[host_storey_id],
        axis_points=[start, end],
        base_z=base_z,
        top_z=top_z,
        thickness=0.250,
        layers=make_external_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=True,
    )


def make_internal_wall(
    *,
    wall_id: str,
    name: str | None,
    host_storey_id: str,
    start: Vec2,
    end: Vec2,
    base_z: float,
    top_z: float,
) -> Wall:
    """Internal partition: 0.135m thick, solid, non-load-bearing, 3-layer composite.

    Caller follows the conventional direction: horizontal walls walk
    west→east (+x), vertical walls walk south→north (+y).
    """
    return Wall(
        id=wall_id,
        name=name,
        host_storey_ids=[host_storey_id],
        axis_points=[start, end],
        base_z=base_z,
        top_z=top_z,
        thickness=0.135,
        layers=make_internal_wall_layers(),
        type="solid",
        is_external=False,
        is_load_bearing=False,
    )


def _perimeter_walls(
    *,
    name_prefix: str,
    storey_id: str,
    base_z: float,
    top_z: float,
    sw: Vec2,
    se: Vec2,
    ne: Vec2,
    nw: Vec2,
) -> list:
    """4 external walls walked CCW (S → E → N → W) around the envelope.

    Phase 1 moved this here verbatim from `_2bhk_pune_floor_unit.py`,
    where it was the single shared definition imported by every other
    floor-unit module and the tower assemblers — a cross-cutting Layer-1
    helper that had simply been living in a feature module.
    """
    suffix = name_prefix.upper()
    return [
        make_external_wall(
            wall_id=f"wall-{name_prefix}-S",
            name=f"External Wall South - {suffix}",
            host_storey_id=storey_id,
            start=sw,
            end=se,
            base_z=base_z,
            top_z=top_z,
        ),
        make_external_wall(
            wall_id=f"wall-{name_prefix}-E",
            name=f"External Wall East - {suffix}",
            host_storey_id=storey_id,
            start=se,
            end=ne,
            base_z=base_z,
            top_z=top_z,
        ),
        make_external_wall(
            wall_id=f"wall-{name_prefix}-N",
            name=f"External Wall North - {suffix}",
            host_storey_id=storey_id,
            start=ne,
            end=nw,
            base_z=base_z,
            top_z=top_z,
        ),
        make_external_wall(
            wall_id=f"wall-{name_prefix}-W",
            name=f"External Wall West - {suffix}",
            host_storey_id=storey_id,
            start=nw,
            end=sw,
            base_z=base_z,
            top_z=top_z,
        ),
    ]


# ─── Opening / Door / Window construction ───────────────────────────


def make_door_pair(
    *,
    door_id: str,
    opening_id: str,
    wall_id: str,
    distance_along_wall: float,
    width: float,
    height: float,
    floor_z: float,
    swing: Literal["inward", "outward", "sliding", "folding", "revolving"],
    handedness: Literal["left", "right"],
    connects_room_ids: list[str],
) -> tuple[Opening, Door]:
    """One Opening (predefined_type=DOOR) + one Door referencing it.

    `floor_z` is the world-Z of the storey floor the door sits on. Sill_z
    of a door is the floor itself (sill_z = floor_z; door starts at floor).
    `connects_room_ids` is 1 element (+ "Outside") for exterior, 2 distinct
    room ids for interior — DOOR_CONNECTS_ROOMS enforces shape.
    """
    opening = Opening(
        id=opening_id,
        in_wall_id=wall_id,
        distance_along_wall=distance_along_wall,
        sill_z=floor_z,
        width=width,
        height=height,
        predefined_type="DOOR",
    )
    door = Door(
        id=door_id,
        in_opening_id=opening_id,
        connects_room_ids=connects_room_ids,
        swing=swing,
        handedness=handedness,
    )
    return opening, door


def make_window_pair(
    *,
    window_id: str,
    opening_id: str,
    wall_id: str,
    distance_along_wall: float,
    width: float,
    height: float,
    sill_z: float,
    glass_area: float | None = None,
    frame_material: str | None = None,
) -> tuple[Opening, Window]:
    """One Opening (predefined_type=WINDOW) + one Window referencing it.

    `sill_z` is absolute world Z (placement_resolver subtracts the wall
    base_z to get the local origin). For a 0.9m sill on the ground floor
    (floor_z=0), pass sill_z=0.9; on the first floor (floor_z=3.0), pass
    sill_z=3.9.
    """
    opening = Opening(
        id=opening_id,
        in_wall_id=wall_id,
        distance_along_wall=distance_along_wall,
        sill_z=sill_z,
        width=width,
        height=height,
        predefined_type="WINDOW",
    )
    window = Window(
        id=window_id,
        in_opening_id=opening_id,
        glass_area=glass_area,
        frame_material=frame_material,
    )
    return opening, window


# ─── Structural grid (columns, footings, beams) ─────────────────────


def make_rcc_column(
    *,
    column_id: str,
    host_storey_id: str,
    location: Vec2,
    base_z: float,
    top_z: float,
    width: float = 0.300,
    depth: float = 0.300,
) -> Column:
    """Vertical RCC column with rectangular profile width × depth.

    M25 RCC, load-bearing. `top_location=None` (vertical) keeps
    COLUMN_AXIS_VALID happy under StructuralSystem.allows_slanted=False.
    """
    return Column(
        id=column_id,
        host_storey_id=host_storey_id,
        location=location,
        top_location=None,
        profile=ProfileRef(
            name=f"C-{int(width * 1000)}x{int(depth * 1000)}",
            profile_type="rectangle",
            dimensions={"width": width, "depth": depth},
        ),
        material="M25-RCC",
        base_z=base_z,
        top_z=top_z,
        is_load_bearing=True,
    )


def make_isolated_pad_footing(
    *,
    footing_id: str,
    supports_column_id: str,
    location: Vec2,
    top_z: float,
    bottom_z: float,
    half_side: float = 0.75,
) -> Footing:
    """Isolated pad footing centred on a column.

    `half_side` is half the side length of the square pad (default
    1.5m × 1.5m pads, conservative for a 2-storey RCC residence on
    Pune medium-bearing soil).
    """
    cx, cy = location.x, location.y
    polygon = [
        Vec2(x=cx - half_side, y=cy - half_side),
        Vec2(x=cx + half_side, y=cy - half_side),
        Vec2(x=cx + half_side, y=cy + half_side),
        Vec2(x=cx - half_side, y=cy + half_side),
    ]
    return Footing(
        id=footing_id,
        supports_column_id=supports_column_id,
        location=location,
        top_z=top_z,
        bottom_z=bottom_z,
        footprint_polygon=polygon,
        material="M25-RCC",
    )


def make_rcc_beam(
    *,
    beam_id: str,
    host_storey_id: str,
    supported_by_column_ids: list[str],
    start: Vec3,
    end: Vec3,
    top_z: float,
    width: float = 0.230,
    depth: float = 0.450,
) -> Beam:
    """Horizontal RCC beam between two columns. Cross-section width × depth.

    `start`/`end` are the beam centerline endpoints. For a beam whose top
    sits at the bottom of a slab (top_z = slab.bottom_z), the centerline z
    is `top_z - depth/2`; the caller computes that and passes it via
    start.z/end.z.
    """
    return Beam(
        id=beam_id,
        host_storey_id=host_storey_id,
        supported_by_column_ids=supported_by_column_ids,
        has_moment_connection=False,
        moment_connection_target_id=None,
        profile=ProfileRef(
            name=f"B-{int(width * 1000)}x{int(depth * 1000)}",
            profile_type="rectangle",
            dimensions={"width": width, "depth": depth},
        ),
        material="M25-RCC",
        start_point=start,
        end_point=end,
        top_z=top_z,
    )


def make_rcc_grid_columns_and_footings(
    *,
    x_axes: dict[str, float],
    y_axes: dict[str, float],
    column_base_z: float,
    column_top_z: float,
    footing_top_z: float,
    footing_bottom_z: float,
    host_storey_id: str,
    column_width: float = 0.300,
    column_depth: float = 0.300,
    footing_half_side: float = 0.75,
) -> tuple[list[Column], list[Footing]]:
    """Build a rectangular grid of RCC columns + 1 isolated footing per column.

    Returns (columns, footings) sorted by id. Column ids: ``col-{x_label}{y_label}``
    (e.g. ``col-A1``); footing ids: ``ftg-{x_label}{y_label}``.

    `column_base_z` should equal `footing_top_z` so the placement resolver's
    footing-overrides-base_z behaviour is idempotent (no z drift between
    schema field and resolved placement).

    `column_width` / `column_depth` / `footing_half_side` default to the
    2BHK/3BHK sizing (0.300 m columns, 1.5 m pads). Phase 1 added them as
    parameters so the 1BHK fork (`make_1bhk_grid_columns_and_footings`,
    0.230 m columns, 1.2 m pads) can delegate here instead of duplicating
    the grid-construction loop. The defaults keep every pre-existing
    caller byte-identical.
    """
    if column_base_z != footing_top_z:
        raise ValueError(
            f"make_rcc_grid_columns_and_footings: column_base_z ({column_base_z}) "
            f"must equal footing_top_z ({footing_top_z}) so the placement "
            "resolver's footing override is idempotent."
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
                    width=column_width,
                    depth=column_depth,
                )
            )
            footings.append(
                make_isolated_pad_footing(
                    footing_id=ftg_id,
                    supports_column_id=col_id,
                    location=location,
                    top_z=footing_top_z,
                    bottom_z=footing_bottom_z,
                    half_side=footing_half_side,
                )
            )
    columns.sort(key=lambda c: c.id)
    footings.sort(key=lambda f: f.id)
    return columns, footings


def make_orthogonal_beam_grid(
    *,
    columns_by_label: dict[str, Column],
    x_labels_in_order: list[str],
    y_labels_in_order: list[str],
    beam_top_z: float,
    host_storey_id: str,
    level_label: str,
) -> list[Beam]:
    """Connect adjacent grid columns with horizontal RCC beams in X and Y.

    `columns_by_label` maps the grid label (e.g. ``"A1"``) to the Column
    instance at that intersection. Adjacent in X means same y label, adjacent
    x labels (e.g. A1↔B1). Adjacent in Y means same x label, adjacent y
    labels.

    Beam centerline z = `beam_top_z - depth/2` for default depth 0.450.
    Beam ids: ``bm-{level_label}-{startLabel}-{endLabel}``.
    """
    beams: list[Beam] = []
    centerline_z = beam_top_z - 0.450 / 2.0
    # X-direction beams: pair adjacent x labels at each y row.
    for y_lbl in y_labels_in_order:
        for i in range(len(x_labels_in_order) - 1):
            a_lbl = x_labels_in_order[i] + y_lbl
            b_lbl = x_labels_in_order[i + 1] + y_lbl
            ca = columns_by_label[a_lbl]
            cb = columns_by_label[b_lbl]
            beams.append(
                make_rcc_beam(
                    beam_id=f"bm-{level_label}-{a_lbl}-{b_lbl}",
                    host_storey_id=host_storey_id,
                    supported_by_column_ids=[ca.id, cb.id],
                    start=Vec3(x=ca.location.x, y=ca.location.y, z=centerline_z),
                    end=Vec3(x=cb.location.x, y=cb.location.y, z=centerline_z),
                    top_z=beam_top_z,
                )
            )
    # Y-direction beams: pair adjacent y labels at each x column.
    for x_lbl in x_labels_in_order:
        for i in range(len(y_labels_in_order) - 1):
            a_lbl = x_lbl + y_labels_in_order[i]
            b_lbl = x_lbl + y_labels_in_order[i + 1]
            ca = columns_by_label[a_lbl]
            cb = columns_by_label[b_lbl]
            beams.append(
                make_rcc_beam(
                    beam_id=f"bm-{level_label}-{a_lbl}-{b_lbl}",
                    host_storey_id=host_storey_id,
                    supported_by_column_ids=[ca.id, cb.id],
                    start=Vec3(x=ca.location.x, y=ca.location.y, z=centerline_z),
                    end=Vec3(x=cb.location.x, y=cb.location.y, z=centerline_z),
                    top_z=beam_top_z,
                )
            )
    beams.sort(key=lambda b: b.id)
    return beams


# ─── Layout-region helpers (buildable bounds + column-grid axes) ─────


def compute_buildable_bounds(
    plot_width_m: float,
    plot_length_m: float,
    front_setback_m: float,
    rear_setback_m: float,
    side_setback_m: float,
    *,
    min_width: float,
    min_depth: float,
    error_label: str = "",
    error_tail: str = ".",
) -> tuple[float, float, float, float, float, float]:
    """Compute (xmin, xmax, ymin, ymax, width, depth) for the buildable region.

    Phase 1 consolidated three byte-identical per-BHK copies — the
    `_1bhk` / `_2bhk` / `_3bhk` floor-unit modules each carried their own
    `_buildable_bounds`. The computation body was identical across all
    three; only the minimum buildable size and the ValueError message
    text varied, so both are now parameters and the body is shared
    verbatim.

    Raises ValueError if the buildable area is below `min_width × min_depth`.
    `error_label` / `error_tail` reproduce each caller's original message
    exactly (e.g. ``" (3BHK)"`` / ``" m for 3BHK layout."``).
    """
    buildable_x_min = side_setback_m
    buildable_x_max = plot_width_m - side_setback_m
    buildable_y_min = rear_setback_m
    buildable_y_max = plot_length_m - front_setback_m
    width = buildable_x_max - buildable_x_min
    depth = buildable_y_max - buildable_y_min
    if width < min_width or depth < min_depth:
        raise ValueError(
            f"_buildable_bounds{error_label}: plot ({plot_width_m:.2f} m × "
            f"{plot_length_m:.2f} m) with setbacks (front "
            f"{front_setback_m:.1f}, rear {rear_setback_m:.1f}, side "
            f"{side_setback_m:.1f}) yields buildable {width:.2f} × "
            f"{depth:.2f} m; need at least {min_width:.1f} × "
            f"{min_depth:.1f}{error_tail}"
        )
    return (
        buildable_x_min,
        buildable_x_max,
        buildable_y_min,
        buildable_y_max,
        width,
        depth,
    )


def column_grid_axes(
    buildable_x_min: float,
    buildable_x_max: float,
    buildable_y_min: float,
    buildable_y_max: float,
    *,
    column_size: float,
    y_axis_count: int,
) -> tuple[list[float], list[float]]:
    """Return (x_axes, y_axes) for a rectangular RCC column grid.

    Phase 1 consolidated the per-BHK `_column_grid` helpers. They were
    NOT identical-modulo-constants: 2BHK / 3BHK use a 3×4 grid, 1BHK a
    3×3 grid with a different X-middle and Y-axis formula. The
    `y_axis_count` switch selects the grid shape; each branch reproduces
    the corresponding original helper expression-for-expression, so the
    output stays byte-identical to the pre-consolidation code.

      * ``y_axis_count == 4`` — 2BHK / 3BHK: X-middle is the midpoint of
        the buildable edges; 4 Y axes equal-spaced via a y_step interp.
      * ``y_axis_count == 3`` — 1BHK: X-middle and Y-middle are the
        midpoint of the inset axes; 3 Y axes.
    """
    half_col = column_size / 2.0
    x_first = buildable_x_min + half_col
    x_last = buildable_x_max - half_col
    y_first = buildable_y_min + half_col
    y_last = buildable_y_max - half_col
    if y_axis_count == 4:
        x_axes = [
            x_first,
            (buildable_x_min + buildable_x_max) / 2.0,
            x_last,
        ]
        y_step = (y_last - y_first) / 3.0
        y_axes = [
            y_first,
            y_first + y_step,
            y_first + 2.0 * y_step,
            y_last,
        ]
    elif y_axis_count == 3:
        x_axes = [
            x_first,
            (x_first + x_last) / 2.0,
            x_last,
        ]
        y_axes = [
            y_first,
            (y_first + y_last) / 2.0,
            y_last,
        ]
    else:
        raise ValueError(
            f"column_grid_axes: y_axis_count must be 3 or 4; got {y_axis_count}"
        )
    return x_axes, y_axes


# ─── Slice T2.0 — Layer 2 / Layer 3 composition types ───────────────


@dataclass(frozen=True)
class FloorUnit:
    """One floor's worth of geometry, parameterized by Z-offset and storey index.

    Layer-2 output of the Tier-2 template architecture (Slice T2.0). The
    Layer-3 building assemblers (`build_*_house`, `build_*_duplex`,
    `build_*_tower`) stitch one or more `FloorUnit` instances into a
    complete `BuildingModel` by adding the foundation, structural
    columns/beams that span all floors, the roof slab on top, and the
    project metadata.

    Z-coordinates inside a FloorUnit are derived from `elevation` (the
    base Z of this floor's FLOOR slab top). All wall base/top, opening
    sill, and stair plan positions inside the unit are `elevation +
    offset`. The unit knows nothing about floors above or below — that
    coordination is the assembler's job.

    Frozen-ness: attribute reassignment is blocked. List contents remain
    technically mutable (Python lists), but the floor unit treats them
    as read-only by convention. Downstream assemblers must not mutate.
    """

    storey_id: str
    storey_index: int
    elevation: float
    floor_height: float
    rooms: list[Room]
    walls: list[Wall]
    slabs: list[Slab]
    openings: list[Opening]
    doors: list[Door]
    windows: list[Window]
    stairs: list[Stair]
    floor_footprint_polygon: list[Vec2]
    column_grid_x: list[float]
    column_grid_y: list[float]

    def __post_init__(self) -> None:
        if self.storey_index < 0:
            raise ValueError(
                f"FloorUnit('{self.storey_id}'): storey_index must be >= 0; "
                f"got {self.storey_index}"
            )
        if self.floor_height <= 0:
            raise ValueError(
                f"FloorUnit('{self.storey_id}'): floor_height must be > 0; "
                f"got {self.floor_height}"
            )
        if len(self.floor_footprint_polygon) < 3:
            raise ValueError(
                f"FloorUnit('{self.storey_id}'): floor_footprint_polygon must "
                f"have >= 3 vertices; got {len(self.floor_footprint_polygon)}"
            )


@dataclass(frozen=True)
class TowerCore:
    """Shared vertical circulation for a tower (lifts + fire stairs + lobby).

    Layer-3 tower assembler combines a `TowerCore` with N `FloorUnit`s.
    The callable fields take per-floor parameters (storey index, base/top
    Z) and return BuildingModel nodes for that floor. This keeps the
    core's geometry computation co-located with the rest of the core
    while letting the assembler control floor index / elevation.

    Callable signatures (Phase E1 widened from the original spec to carry
    `storey_id` and `top_z` so the same TowerCore handles variable floor
    heights — e.g., a 2.7 m stilt + 3.0 m habitable storeys):

        core_walls_per_floor(storey_idx, storey_id, base_z, top_z)
            → list[Wall]   (walls hosted on this storey)

        core_rooms_per_floor(storey_idx, storey_id)
            → list[Room]   (rooms on this storey; Z lives at the storey level)

        stair_per_floor(storey_idx_lower, storey_id_lower,
                        slab_below_top_z, slab_above_bottom_z)
            → Stair        (one stair per floor pair, hosted on lower)

    Why callables (not pre-instantiated lists)? A tower may have any
    number of floors; constructing every node up-front would force the
    `TowerCore` author to know how many floors there will be. Callables
    let the assembler instantiate per-floor lazily.
    """

    core_walls_per_floor: Callable[[int, str, float, float], list[Wall]]
    core_rooms_per_floor: Callable[[int, str], list[Room]]
    stair_per_floor: Callable[[int, str, float, float], Stair]
    core_footprint_polygon: list[Vec2]
    core_x_offset: float
    core_y_offset: float

    def __post_init__(self) -> None:
        if len(self.core_footprint_polygon) < 3:
            raise ValueError(
                f"TowerCore.core_footprint_polygon must have >= 3 vertices; "
                f"got {len(self.core_footprint_polygon)}"
            )


__all__ = [
    "FloorUnit",
    "TowerCore",
    "make_external_wall_layers",
    "make_internal_wall_layers",
    "make_slab_layers",
    "make_roof_slab_layers",
    "make_rectangular_polygon_ccw",
    "make_axis_aligned_room",
    "make_external_wall",
    "make_internal_wall",
    "_perimeter_walls",
    "make_door_pair",
    "make_window_pair",
    "make_rcc_column",
    "make_isolated_pad_footing",
    "make_rcc_beam",
    "make_rcc_grid_columns_and_footings",
    "make_orthogonal_beam_grid",
    "compute_buildable_bounds",
    "column_grid_axes",
]
