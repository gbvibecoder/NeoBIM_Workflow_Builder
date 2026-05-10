"""Slice 2B.2 — Pure-math BuildingModel adapter (mirror + rotate).

The adapter v1 turns a matched BuildingModel into a transformed
BuildingModel before IFC export, so a north-facing template can
serve a south-facing brief, an east-facing plot, or a mirrored
layout — without editing template source code, without invoking the
LLM for any geometry decision, and without weakening the 12 Phase-1
invariants that gate every BuildingModel construction.

What this module is
-------------------
The pure-math half of slice 2B.2. Six transforms total:

    * mirror across X-axis         (flip east↔west)
    * mirror across Y-axis         (flip north↔south)
    * rotate 90° / 180° / 270° clockwise around the plot centre
    * combined mirror + rotate     (canonical order: mirror first,
                                    rotate second; the two operations
                                    do NOT commute)

The single public entry point is :func:`apply_adaptations(bm, plan)`.
Given a :class:`BuildingModel` and an :class:`AdaptationPlan` it
returns a new (frozen) BuildingModel produced by walking every
geometric node, applying the transform, and re-running the 12
invariants via :meth:`BuildingModel.build`. A no-op plan
(``mirror_axis=None`` and ``rotation=NONE``) short-circuits and
returns the input unchanged.

What this module is NOT
-----------------------
* Not the planner. The planner LLM (sister module
  :mod:`app.services.design_agent.stages.adaptation_planner`) emits
  the :class:`AdaptationPlan`; this module consumes it.
* Not an IFC writer. The transformed BuildingModel still flows
  through :func:`scripts.export_2bhk_pune_to_ifc.build_ifc_from_building_model`
  (or its lifted service-level twin) for the IFC bytes.
* Not a validator. Re-running :meth:`BuildingModel.build` is the
  validator — and is the most important property of this module:
  any transform that produces an invalid model fails LOUD with the
  structured ``rule_id`` / ``hint`` envelope, not silently.

Spec corrections vs slice prompt
--------------------------------
The slice prompt's pseudocode treats every transform as a per-point
coordinate flip. That is correct only for individual ``Vec2`` /
``Vec3`` values. Three additional rules are required for a transform
that survives Pydantic re-validation:

1. **CCW winding under mirror.** ``FOOTPRINT_VALID`` enforces
   ``signed_area > 0`` (counterclockwise) on every footprint polygon.
   Mirror inverts orientation: a CCW polygon becomes CW after every
   vertex's coordinate is flipped. The fix is to reverse the vertex
   list when (and only when) the plan includes a mirror. Rotation
   preserves orientation, so polygons under pure rotation stay CCW
   without further intervention.

2. **BoundaryEdge.side flip under mirror.** ``ROOM_BOUNDED`` resolves
   each room's polygon by intersecting offset axes computed from
   ``wall.thickness/2`` perpendicular to ``wall.axis_points`` on the
   stored ``side``. Mirror inverts chirality — the room sits on the
   opposite side of the mirrored wall direction. Without flipping
   ``side``, the resolved polygon falls on the wrong side of every
   wall and the invariant fires for every room. Proved with a
   horizontal-wall-mirror-X case and a vertical-wall-mirror-Y case;
   both require the flip to land on the same physical room.

3. **Door.handedness flip under mirror.** Same chirality argument:
   left-hung becomes right-hung in the mirrored building. Sliding
   doors carry a stored ``handedness`` for schema completeness even
   though the IFC builder ignores it; we still flip for consistency
   so two equivalent (rotation-free) mirrored buildings have
   byte-identical schema.

Rotation preserves both side and handedness — rotation is an
orientation-preserving rigid motion.

Plot centre
-----------
All transforms anchor at the bounding-box centre of
``building.envelope_polygon``. For all twelve current templates the
envelope is a rectangle from (0, 0) to (plot_width, plot_length), so
the centre is exactly ``(plot_width / 2, plot_length / 2)``. The
bbox-centre rule generalises cleanly to non-rectangular envelopes
(L-shape / U-shape) once those land in v3.

Vertical axis untouched
-----------------------
Storey elevations, slab top/bottom Z, wall base/top Z, beam Vec3 z,
column base/top z, opening sill_z — every Z stays the same under
every transform. Mirror across X / Y is a 2D operation; rotation by
90/180/270 around the plot centre rotates X-Y only. Storey continuity,
wall hosting, stair rise, FOOTPRINT_VALID — all Z-dependent
invariants pass through untouched.
"""

from __future__ import annotations

import math
from typing import Iterable, Literal, Optional

from app.domain.building_model import (
    Beam,
    Building,
    BuildingModel,
    Column,
    Door,
    Foundation,
    Footing,
    Grid,
    GridAxis,
    MEPEquipment,
    MEPSegment,
    MEPSystem,
    MEPTerminal,
    Opening,
    Project,
    Room,
    Site,
    Slab,
    Stair,
    Storey,
    StructuralSystem,
    Vec2,
    Vec3,
    Wall,
    Window,
)
from app.services.design_agent.types import (
    AdaptationPlan,
    TransformAxis,
    TransformRotation,
)


# ─── Errors ──────────────────────────────────────────────────────────


class AdaptationApplyError(RuntimeError):
    """Raised when a transformed BuildingModel fails to re-validate.

    Carries ``plan_repr`` (a short string of the failed plan) and
    ``original_error`` (the underlying
    :class:`BuildingModelValidationError`). The route handler in
    Phase C catches this and downgrades to ``ship_as_is`` so the
    user still receives the matcher's default IFC instead of an HTTP
    5xx — that's the v1 refusal contract.

    Code paths must surface enough detail to diagnose which transform
    + which template combination failed (per the senior-engineer
    "errors must be specific" rule).
    """

    def __init__(self, plan_repr: str, original_error: Exception) -> None:
        super().__init__(
            f"apply_adaptations failed for plan={plan_repr}: "
            f"{type(original_error).__name__}: {original_error}"
        )
        self.plan_repr = plan_repr
        self.original_error = original_error


# ─── Plot-centre helper ──────────────────────────────────────────────


def _plot_center_xy(envelope_polygon: list[Vec2]) -> tuple[float, float]:
    """Bounding-box centre of the building envelope, used as the
    transform anchor.

    For every Tier-2 template currently shipped this is the rectangle
    centre, equal to ``(plot_width / 2, plot_length / 2)``. For
    non-rectangular envelopes (deferred to v3) the bbox centre still
    yields a stable anchor that keeps every transformed vertex inside
    the original plot envelope's bbox — which is the property the
    site-boundary tests will key on.

    Raises ``ValueError`` when the polygon is empty: an empty
    envelope is a Phase-1 contract violation surfaced loudly rather
    than silently anchoring at the origin.
    """
    if not envelope_polygon:
        raise ValueError(
            "Cannot derive plot centre: building.envelope_polygon is empty. "
            "Templates must populate envelope_polygon for adaptation to work."
        )
    xs = [p.x for p in envelope_polygon]
    ys = [p.y for p in envelope_polygon]
    return (
        (min(xs) + max(xs)) / 2.0,
        (min(ys) + max(ys)) / 2.0,
    )


# ─── Scalar helpers ──────────────────────────────────────────────────


def _flip_lr(value: Literal["left", "right"]) -> Literal["left", "right"]:
    """Flip left↔right. Used for both ``BoundaryEdge.side`` and
    ``Door.handedness`` when the plan includes a mirror.

    Defined as its own helper so a future field that uses the same
    discriminator (e.g. swing-handedness on stairs) can pick it up
    consistently.
    """
    return "right" if value == "left" else "left"


def _mirror_xy(
    x: float, y: float, axis: TransformAxis, cx: float, cy: float
) -> tuple[float, float]:
    """Reflect the point ``(x, y)`` around the plot-centre line.

    ``TransformAxis.X`` flips east↔west: every point's x-coordinate
    is reflected around the plot's x-centre (``cx``), y is preserved.

    ``TransformAxis.Y`` flips north↔south: every point's y-coordinate
    is reflected around ``cy``, x is preserved.
    """
    if axis == TransformAxis.X:
        return (2.0 * cx - x, y)
    if axis == TransformAxis.Y:
        return (x, 2.0 * cy - y)
    # Defensive — TransformAxis is closed; if we get here, an enum
    # member was added without updating this function.
    raise ValueError(f"Unknown TransformAxis: {axis!r}")  # pragma: no cover


def _rotate_xy(
    x: float, y: float, rotation: TransformRotation, cx: float, cy: float
) -> tuple[float, float]:
    """Rotate the point ``(x, y)`` clockwise by ``rotation`` around
    the plot centre ``(cx, cy)``.

    Discrete-angle implementation (no trig) for byte-exactness:
    floating-point sin / cos at 90° drift by ~1e-16 from clean
    integer-relation results, which would propagate into every
    transformed coordinate and break "mirror is involution" /
    "rotation is periodic" property tests on the order of 1e-13.
    By writing the four cases explicitly we keep round-trip equality
    to machine precision.
    """
    dx = x - cx
    dy = y - cy
    if rotation == TransformRotation.NONE:
        return (x, y)
    if rotation == TransformRotation.CW_90:
        # 90° CW: (dx, dy) -> (dy, -dx).
        return (cx + dy, cy - dx)
    if rotation == TransformRotation.CW_180:
        # 180°: (dx, dy) -> (-dx, -dy). Equivalent to mirror_X ∘ mirror_Y.
        return (cx - dx, cy - dy)
    if rotation == TransformRotation.CW_270:
        # 270° CW (= 90° CCW): (dx, dy) -> (-dy, dx).
        return (cx - dy, cy + dx)
    raise ValueError(f"Unknown TransformRotation: {rotation!r}")  # pragma: no cover


def _xform_xy(
    x: float, y: float, plan: AdaptationPlan, cx: float, cy: float
) -> tuple[float, float]:
    """Apply the full plan to a 2D point in canonical order: mirror
    first, then rotate. Used for both Vec2 and the (x, y) projection
    of Vec3 values.
    """
    if plan.mirror_axis is not None:
        x, y = _mirror_xy(x, y, plan.mirror_axis, cx, cy)
    return _rotate_xy(x, y, plan.rotation, cx, cy)


def _xform_vec2(p: Vec2, plan: AdaptationPlan, cx: float, cy: float) -> Vec2:
    nx, ny = _xform_xy(p.x, p.y, plan, cx, cy)
    return Vec2(x=nx, y=ny)


def _xform_vec3(p: Vec3, plan: AdaptationPlan, cx: float, cy: float) -> Vec3:
    """Vec3 transform — x and y rotate / mirror, z stays put.

    Spec corollary: every Z-dependent invariant (storey continuity,
    wall base, slab top/bottom, stair rise) passes through untouched.
    """
    nx, ny = _xform_xy(p.x, p.y, plan, cx, cy)
    return Vec3(x=nx, y=ny, z=p.z)


def _xform_polygon(
    coords: Iterable[Vec2], plan: AdaptationPlan, cx: float, cy: float
) -> list[Vec2]:
    """Apply the plan to every vertex, then reverse the list iff a
    mirror is part of the plan.

    Mirror inverts orientation (CCW -> CW); the reversal restores CCW
    so ``FOOTPRINT_VALID`` accepts the result. Rotation preserves
    orientation, so a rotation-only plan keeps the original order.
    """
    out = [_xform_vec2(p, plan, cx, cy) for p in coords]
    if plan.mirror_axis is not None:
        out.reverse()
    return out


# ─── Per-entity transformers ─────────────────────────────────────────


def _xform_wall(wall: Wall, plan: AdaptationPlan, cx: float, cy: float) -> Wall:
    """Transform a wall's axis points in place; everything else
    (host_storey_ids, base_z / top_z, thickness, layers, type, flags)
    stays put.

    Why no axis-points reversal under mirror: the wall's
    ``axis_points`` list is NOT a polygon — it's an ordered polyline
    whose endpoint order defines the wall's direction. Reversing it
    would flip the direction at the schema level, which would break
    the relationship with ``Opening.distance_along_wall``. Instead,
    we transform each point in place; the wall's direction reverses
    or stays put depending on its orientation relative to the mirror
    axis, but the opening's relative position along the wall is
    preserved by the same transform applied to its underlying
    coordinates — verified empirically with both ⊥ and ∥ wall cases.
    """
    new_axis = [_xform_vec2(p, plan, cx, cy) for p in wall.axis_points]
    return wall.model_copy(update={"axis_points": new_axis})


def _xform_room(room: Room, plan: AdaptationPlan, cx: float, cy: float) -> Room:
    """Transform a room's footprint polygon AND flip every
    BoundaryEdge.side iff the plan includes a mirror.

    See module docstring for the chirality argument behind the side
    flip — without it, ``ROOM_BOUNDED`` fails on every room because
    the offset-axis intersection lands on the wrong side of the
    mirrored wall.
    """
    new_footprint = _xform_polygon(room.footprint_polygon, plan, cx, cy)
    if plan.mirror_axis is not None:
        new_edges = [
            edge.model_copy(update={"side": _flip_lr(edge.side)})
            for edge in room.bounding_edges
        ]
    else:
        new_edges = list(room.bounding_edges)
    return room.model_copy(
        update={
            "footprint_polygon": new_footprint,
            "bounding_edges": new_edges,
        }
    )


def _xform_slab(slab: Slab, plan: AdaptationPlan, cx: float, cy: float) -> Slab:
    """Transform a slab's footprint polygon plus every opening
    polygon (slab cut-outs for stairwells, lift shafts).

    Each opening polygon is winding-sensitive in the same way as the
    outer footprint: mirror reverses, rotation preserves.
    """
    new_footprint = _xform_polygon(slab.footprint_polygon, plan, cx, cy)
    new_openings = [
        _xform_polygon(op, plan, cx, cy) for op in slab.openings_polygons
    ]
    return slab.model_copy(
        update={
            "footprint_polygon": new_footprint,
            "openings_polygons": new_openings,
        }
    )


def _xform_opening(opening: Opening) -> Opening:
    """Openings carry no world coordinates of their own — they live
    on a wall via ``in_wall_id`` + ``distance_along_wall``. Both fields
    survive every transform unchanged: ``in_wall_id`` is a string id
    and ``distance_along_wall`` is preserved by the same in-place
    coordinate transform applied to the parent wall (see _xform_wall
    docstring).

    This function returns the input opening unchanged. It exists as a
    schema-level marker so a future field on Opening that DOES need
    transforming has an obvious home.
    """
    return opening


def _xform_door(door: Door, plan: AdaptationPlan) -> Door:
    """Flip ``handedness`` iff the plan includes a mirror; everything
    else (in_opening_id, connects_room_ids, swing) stays put.
    """
    if plan.mirror_axis is None:
        return door
    return door.model_copy(update={"handedness": _flip_lr(door.handedness)})


def _xform_window(window: Window) -> Window:
    """Windows have no world coordinates either — they ride on an
    opening via ``in_opening_id``. Returns the input unchanged.
    """
    return window


def _xform_column(
    column: Column, plan: AdaptationPlan, cx: float, cy: float
) -> Column:
    """Transform location and (optional) top_location.

    ``grid_intersection`` is a ``(x_label, y_label)`` tuple of strings;
    under rotate 90 / 270 the role of x and y axes swaps, so the
    semantic-correct treatment is to swap the two label slots. Under
    mirror or rotate 180 the labels stay put because the role of x
    and y axes is preserved.
    """
    new_location = _xform_vec2(column.location, plan, cx, cy)
    new_top: Optional[Vec2] = (
        _xform_vec2(column.top_location, plan, cx, cy)
        if column.top_location is not None
        else None
    )
    new_grid_intersection: Optional[tuple[str, str]] = column.grid_intersection
    if column.grid_intersection is not None and plan.rotation in (
        TransformRotation.CW_90,
        TransformRotation.CW_270,
    ):
        x_lbl, y_lbl = column.grid_intersection
        new_grid_intersection = (y_lbl, x_lbl)
    return column.model_copy(
        update={
            "location": new_location,
            "top_location": new_top,
            "grid_intersection": new_grid_intersection,
        }
    )


def _xform_beam(beam: Beam, plan: AdaptationPlan, cx: float, cy: float) -> Beam:
    """Beams use Vec3 endpoints — x,y rotate / mirror, z stays."""
    return beam.model_copy(
        update={
            "start_point": _xform_vec3(beam.start_point, plan, cx, cy),
            "end_point": _xform_vec3(beam.end_point, plan, cx, cy),
        }
    )


def _xform_footing(
    footing: Footing, plan: AdaptationPlan, cx: float, cy: float
) -> Footing:
    """Transform the footing's location pin AND its footprint polygon
    (the footing is a small CCW square under each column in current
    templates; needs the same winding-aware handling as slabs)."""
    new_location = _xform_vec2(footing.location, plan, cx, cy)
    new_footprint = _xform_polygon(footing.footprint_polygon, plan, cx, cy)
    return footing.model_copy(
        update={"location": new_location, "footprint_polygon": new_footprint}
    )


def _xform_stair(stair: Stair, plan: AdaptationPlan, cx: float, cy: float) -> Stair:
    """Transform the stair's plan polygon. Riser count / height /
    tread depth / flight count / landing count are all scalar
    invariants of the stair geometry independent of building
    orientation — they do not change.

    Risk note from the slice prompt's risk register: "stair direction
    reversed after rotation". The stair's plan polygon is a closed
    CCW shape; rotation rotates it as a unit, mirror reverses its
    winding (handled by ``_xform_polygon``). The stair still goes
    from host storey to host storey + 1 (vertical Z untouched), so
    STAIR_RISE_MATCHES still passes. The visual "up direction" of the
    stair flight in the IFC reflects the new plan polygon's winding —
    which is what we want for a rotated / mirrored building.
    """
    new_plan = _xform_polygon(stair.plan_polygon, plan, cx, cy)
    return stair.model_copy(update={"plan_polygon": new_plan})


def _xform_storey(
    storey: Storey, plan: AdaptationPlan, cx: float, cy: float
) -> Storey:
    """Transform every wall / slab / room / stair / opening on the
    storey. Storey elevation and actual_height are scalar Z values
    untouched by horizontal transforms.
    """
    return storey.model_copy(
        update={
            "rooms": [_xform_room(r, plan, cx, cy) for r in storey.rooms],
            "walls": [_xform_wall(w, plan, cx, cy) for w in storey.walls],
            "slabs": [_xform_slab(s, plan, cx, cy) for s in storey.slabs],
            "stairs": [_xform_stair(s, plan, cx, cy) for s in storey.stairs],
            "openings": [_xform_opening(o) for o in storey.openings],
        }
    )


def _xform_grid(
    grid: Optional[Grid], plan: AdaptationPlan, cx: float, cy: float
) -> Optional[Grid]:
    """Transform a structural grid.

    No template currently populates ``StructuralSystem.grid`` (verified
    on all twelve Tier-2 builders), so this is forward-compatibility
    code that v2 / v3 templates can lean on without re-engineering the
    adapter. Math:

    * **Mirror X** (x → 2cx - x): each x-axis (vertical line at
      x = a) moves to x = 2cx - a. Y-axes (horizontal lines at y = b)
      stay put.
    * **Mirror Y** (y → 2cy - y): symmetric — y-axes shift, x-axes
      stay.
    * **Rotate 90° / 270°**: x-axes ↔ y-axes (vertical lines become
      horizontal and vice versa). Position ``a`` on an x-axis (at
      x = a) becomes a y-axis at y = cy ± (a - cx) depending on
      rotation direction.
    * **Rotate 180°**: x-axes flip x-position around cx, y-axes flip
      y-position around cy.
    """
    if grid is None:
        return None

    def _xform_x_axes(axes: list[GridAxis]) -> list[GridAxis]:
        out: list[GridAxis] = []
        for ax in axes:
            x = ax.position
            if plan.mirror_axis == TransformAxis.X:
                x = 2.0 * cx - x
            # rotate
            if plan.rotation == TransformRotation.CW_180:
                x = 2.0 * cx - x
            # 90/270 swap handled by caller via x↔y consolidation
            out.append(GridAxis(label=ax.label, position=x))
        return out

    def _xform_y_axes(axes: list[GridAxis]) -> list[GridAxis]:
        out: list[GridAxis] = []
        for ax in axes:
            y = ax.position
            if plan.mirror_axis == TransformAxis.Y:
                y = 2.0 * cy - y
            if plan.rotation == TransformRotation.CW_180:
                y = 2.0 * cy - y
            out.append(GridAxis(label=ax.label, position=y))
        return out

    new_x = _xform_x_axes(list(grid.x_axes))
    new_y = _xform_y_axes(list(grid.y_axes))

    if plan.rotation in (TransformRotation.CW_90, TransformRotation.CW_270):
        # Swap the two pools entirely — what was a vertical line at
        # x = a becomes a horizontal line at y = (cy + cx - a) for
        # CW 90, or y = (cy - cx + a) for CW 270. Compute the new
        # positions then swap the lists.
        promoted_y = []
        for ax in new_x:
            a = ax.position
            new_pos = (cy + cx - a) if plan.rotation == TransformRotation.CW_90 else (cy - cx + a)
            promoted_y.append(GridAxis(label=ax.label, position=new_pos))
        promoted_x = []
        for ax in new_y:
            b = ax.position
            new_pos = (cx + b - cy) if plan.rotation == TransformRotation.CW_90 else (cx - b + cy)
            promoted_x.append(GridAxis(label=ax.label, position=new_pos))
        new_x, new_y = promoted_x, promoted_y

    return grid.model_copy(update={"x_axes": new_x, "y_axes": new_y})


def _xform_structural_system(
    ss: StructuralSystem, plan: AdaptationPlan, cx: float, cy: float
) -> StructuralSystem:
    return ss.model_copy(
        update={
            "grid": _xform_grid(ss.grid, plan, cx, cy),
            "columns": [_xform_column(c, plan, cx, cy) for c in ss.columns],
            "beams": [_xform_beam(b, plan, cx, cy) for b in ss.beams],
        }
    )


def _xform_foundation(
    foundation: Optional[Foundation], plan: AdaptationPlan, cx: float, cy: float
) -> Optional[Foundation]:
    if foundation is None:
        return None
    return foundation.model_copy(
        update={
            "footings": [
                _xform_footing(f, plan, cx, cy) for f in foundation.footings
            ]
        }
    )


def _xform_mep_equipment(
    eq: MEPEquipment, plan: AdaptationPlan, cx: float, cy: float
) -> MEPEquipment:
    return eq.model_copy(
        update={"location": _xform_vec3(eq.location, plan, cx, cy)}
    )


def _xform_mep_segment(
    seg: MEPSegment, plan: AdaptationPlan, cx: float, cy: float
) -> MEPSegment:
    return seg.model_copy(
        update={
            "start_point": _xform_vec3(seg.start_point, plan, cx, cy),
            "end_point": _xform_vec3(seg.end_point, plan, cx, cy),
        }
    )


def _xform_mep_terminal(
    term: MEPTerminal, plan: AdaptationPlan, cx: float, cy: float
) -> MEPTerminal:
    return term.model_copy(
        update={"location": _xform_vec3(term.location, plan, cx, cy)}
    )


def _xform_mep_system(
    sys: MEPSystem, plan: AdaptationPlan, cx: float, cy: float
) -> MEPSystem:
    return sys.model_copy(
        update={
            "source": (
                _xform_mep_equipment(sys.source, plan, cx, cy)
                if sys.source is not None
                else None
            ),
            "distribution": [
                _xform_mep_segment(s, plan, cx, cy) for s in sys.distribution
            ],
            "terminals": [
                _xform_mep_terminal(t, plan, cx, cy) for t in sys.terminals
            ],
        }
    )


def _xform_building(
    building: Building, plan: AdaptationPlan, cx: float, cy: float
) -> Building:
    return building.model_copy(
        update={
            "envelope_polygon": _xform_polygon(
                building.envelope_polygon, plan, cx, cy
            ),
            "structural_system": _xform_structural_system(
                building.structural_system, plan, cx, cy
            ),
            "mep_systems": [
                _xform_mep_system(s, plan, cx, cy) for s in building.mep_systems
            ],
            "storeys": [
                _xform_storey(s, plan, cx, cy) for s in building.storeys
            ],
            "foundation": _xform_foundation(building.foundation, plan, cx, cy),
            "doors": [_xform_door(d, plan) for d in building.doors],
            "windows": [_xform_window(w) for w in building.windows],
        }
    )


def _xform_site(site: Site, plan: AdaptationPlan) -> Site:
    """Transform a site.

    ``true_north_deg`` is intentionally NOT touched — per slice 2B.2
    spec resolution, rotation re-authors the building's facing in
    project space rather than rotating the project's coordinate frame.
    Project north stays the +Y convention.

    ``terrain_polygon`` IS transformed (winding-aware) because it
    lives in project XY and represents site topography that should
    follow the building rotation in the simple non-georeferenced
    development case.
    """
    cx, cy = _plot_center_xy(site.building.envelope_polygon)
    new_terrain = (
        _xform_polygon(site.terrain_polygon, plan, cx, cy)
        if site.terrain_polygon
        else list(site.terrain_polygon)
    )
    return site.model_copy(
        update={
            "terrain_polygon": new_terrain,
            "building": _xform_building(site.building, plan, cx, cy),
        }
    )


# ─── Public API ──────────────────────────────────────────────────────


def apply_adaptations(
    building_model: BuildingModel, plan: AdaptationPlan
) -> BuildingModel:
    """Apply ``plan`` to ``building_model``; return the transformed
    BuildingModel after re-running the 12 Phase-1 invariants.

    A no-op plan (``mirror_axis=None`` and ``rotation=NONE``) returns
    the input model unchanged — same Python object — so the no-op
    path is byte-identical to slice 2B.1's output and pays no
    re-validation cost.

    Any non-no-op plan walks the entire BuildingModel graph, applies
    the canonical-order transform (mirror first, rotate second), and
    re-builds via :meth:`BuildingModel.build`. The 12 invariants
    then re-validate the transformed graph; any violation surfaces
    as an :class:`AdaptationApplyError` carrying the original
    ``BuildingModelValidationError`` for forensic detail.

    The returned object is a brand-new BuildingModel — pydantic
    ``model_copy`` is used pervasively but the root re-builds from a
    fresh dict, so no shared frozen-graph references.
    """
    if plan.is_noop:
        return building_model

    plan_repr = (
        f"mirror={plan.mirror_axis.value if plan.mirror_axis else 'none'}"
        f"+rot={plan.rotation.value}"
    )

    try:
        new_site = _xform_site(building_model.project.site, plan)
        new_project = building_model.project.model_copy(
            update={"site": new_site}
        )
        return BuildingModel.build(
            {"project": new_project.model_dump(mode="python")}
        )
    except Exception as exc:  # noqa: BLE001 — re-raise as specific error
        raise AdaptationApplyError(plan_repr, exc) from exc


__all__ = [
    "AdaptationApplyError",
    "apply_adaptations",
]
