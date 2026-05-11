"""Slice 2B.3 — Shared helpers for the five extension primitives.

The 5 extensions (compound_wall, entry_gate, car_porch, servant_quarter,
mumty) share a compositional pattern:

    extension_fn(bm: BuildingModel, **params) -> BuildingModel

  1. Read existing entities to pre-compute non-collision IDs.
  2. Compute new geometry in template-space (plot at origin).
  3. Validate against plot polygon + NBC area minimums where
     applicable.
  4. Cascade ``model_copy`` through the frozen-graph to add the new
     entities, then re-build via ``BuildingModel.build`` to re-run
     the 13 invariants.

This module provides the cross-cutting helpers; each per-extension
module owns the geometry math.

Errors
------
All extension failures raise :class:`ExtensionError` (or a sub-class)
carrying ``extension_type``, ``reason``, and an optional ``node_id``.
The orchestrator (transforms_extensions.apply_extensions) catches
these per-extension and rolls them into ``ExtensionFailed.failed_extensions``
without breaking the rest of the plan.

NBC area lookup
---------------
:data:`NBC_MIN_AREA_SQM` mirrors :data:`NBC_MIN_AREAS_SQM` from
``app/services/design_agent/reference_data/nbc_india_minimums.py``
(the canonical source — every value is cited to a section of NBC
India 2016 / CPWD / IPHS in that file). This module keeps a local
mirror so the extensions code path does not import the design-agent
stages layer. The Phase A.4 drift-detection test
``test_nbc_lookup_matches_authoritative_source`` enforces value-by-
value equality so an update to either copy without the other will
fail loudly. (Slice 2B.3 Phase A.4 lesson — first found in dev when
my hand-typed mirror drifted from the authoritative table in 24 of
~30 entries.)
"""

from __future__ import annotations

from typing import Optional

from shapely.geometry import Point, Polygon

from app.domain.building_model import (
    Beam,
    BoundaryEdge,
    Building,
    BuildingModel,
    Column,
    Door,
    MaterialLayer,
    Opening,
    ProfileRef,
    Room,
    Site,
    Slab,
    Stair,
    Storey,
    Vec2,
    Wall,
    Window,
    _signed_area,
)


# ─── Errors ──────────────────────────────────────────────────────────


class ExtensionError(RuntimeError):
    """Base class for extension application failures.

    Carries enough detail to route a per-extension failure into the
    orchestrator's ``failed_extensions`` list with a precise reason
    string for the user-facing refusal envelope (senior-engineer
    "specific errors" rule).
    """

    def __init__(
        self,
        extension_type: str,
        reason: str,
        node_id: Optional[str] = None,
    ) -> None:
        suffix = f" (node={node_id})" if node_id else ""
        super().__init__(f"[{extension_type}] {reason}{suffix}")
        self.extension_type = extension_type
        self.reason = reason
        self.node_id = node_id


class PlotBoundaryViolationError(ExtensionError):
    """Extension geometry escapes the plot polygon.

    Raised when an extension would place a wall, slab, room, or
    column outside ``Site.plot_polygon`` (1mm tolerance).  The
    orchestrator surfaces this as a ``ship_as_is`` refusal: the
    template + adapter run normally; the offending extension is
    skipped.
    """


class NBCViolationError(ExtensionError):
    """Extension produces a Room whose area falls below the NBC India
    2016 Part 4 minimum for its ``usage``."""


class ExtensionRequiresPlotError(ExtensionError):
    """Extension needs a non-empty ``Site.plot_polygon``.

    Tower templates (1bhk / 2bhk / 3bhk) leave plot_polygon empty
    because their combined_envelope already exceeds plot_width_m due
    to the lift/stair core overhang. In Slice 2B.3 v1 only mumty
    (which sits on the roof) is allowed on towers; the other four
    extensions raise this error.
    """


class ExtensionIDCollisionError(ExtensionError):
    """ID generation exhausted its candidate space — should never
    happen in normal use; a defensive guard."""


# ─── NBC area minimums (Slice 2B.3 §2.1) ─────────────────────────────


# Mirror of the authoritative table in
# ``app/services/design_agent/reference_data/nbc_india_minimums.py``.
# Drift between the two copies is detected by the Phase A.4 test
# ``test_nbc_lookup_matches_authoritative_source``. Update both
# locations atomically when adjusting any value — and prefer updating
# the reference_data file first, since its per-line citations carry
# the NBC / CPWD / IPHS source references.
#
# Vastu zone is NOT in the authoritative table because it's a
# placement marker rather than a sized space (reference_data sets it
# to 1.0 in the dict; we mirror that). Don't omit any key.
NBC_MIN_AREA_SQM: dict[str, float] = {
    # === Residential (NBC India 2016 Part 4 §3) ===
    "living": 9.5,
    "dining": 5.0,
    "kitchen": 5.0,
    "bedroom": 7.5,
    "master_bedroom": 9.5,
    "study": 5.5,
    "store": 1.0,
    "utility": 1.0,
    "bathroom": 1.8,
    "powder_room": 1.1,
    "balcony": 1.4,
    "corridor": 1.5,
    "lobby": 2.5,
    "stairs_landing": 1.2,
    "pooja_room": 1.0,
    "puja": 1.0,
    "vastu_zone": 1.0,
    # === Commercial (CPWD DSR 2024 + IS 14660) ===
    "office": 5.0,
    "meeting_room": 9.0,
    "reception": 6.0,
    "pantry": 4.0,
    # === Institutional (NBC Part 4 §6 + IPHS) ===
    "ward": 7.5,
    "consultation": 9.0,
    "operation_theatre": 36.0,
    "icu": 12.0,
    # === Educational (NBC Part 4 §7 + AICTE) ===
    "classroom": 24.0,
    "library": 25.0,
    "auditorium": 50.0,
    # === Mercantile (CPWD + commercial practice) ===
    "shop": 9.0,
    "showroom": 18.0,
    "stock_room": 4.0,
    # === Industrial / Storage (NBC Part 4 §8) ===
    "warehouse_floor": 50.0,
    "loading_bay": 12.0,
    # === Outdoor sentinel ===
    "external": 1.4,
}


def nbc_min_area_for(usage: str) -> float:
    """Return the NBC minimum carpet area for a room ``usage``.

    Unknown usages return 0.0 — never raise. The slice prompt's
    "no fabricated values" rule applies: a usage we don't know means
    we don't enforce a minimum, and the extension's caller is
    responsible for sizing the room sensibly. Phase A.4 has a test
    that every ``RoomUsage`` literal accepted by templates has a
    non-zero entry in this table where NBC has one.
    """
    return NBC_MIN_AREA_SQM.get(usage, 0.0)


# ─── Polygon helpers ─────────────────────────────────────────────────


def make_ccw_rectangle(
    x_min: float, y_min: float, x_max: float, y_max: float
) -> list[Vec2]:
    """CCW rectangle from (x_min,y_min) bottom-left to (x_max,y_max)
    top-right. Raises ValueError if dimensions are non-positive — a
    fail-loud guard against silent zero-area polygons that would
    later trip FOOTPRINT_VALID."""
    if x_max <= x_min or y_max <= y_min:
        raise ValueError(
            f"make_ccw_rectangle requires x_max>x_min and y_max>y_min; "
            f"got ({x_min},{y_min})..({x_max},{y_max})"
        )
    return [
        Vec2(x=x_min, y=y_min),
        Vec2(x=x_max, y=y_min),
        Vec2(x=x_max, y=y_max),
        Vec2(x=x_min, y=y_max),
    ]


def polygon_inside_plot(
    polygon: list[Vec2],
    plot_polygon: list[Vec2],
    tolerance: float = 0.001,
) -> bool:
    """Every vertex of ``polygon`` lies inside (or within
    ``tolerance`` of) the plot polygon. Empty plot or empty polygon
    return True (no constraint to enforce)."""
    if not plot_polygon or not polygon:
        return True
    shp_plot = Polygon([(v.x, v.y) for v in plot_polygon]).buffer(tolerance)
    return all(shp_plot.contains(Point(v.x, v.y)) for v in polygon)


def polygon_area(polygon: list[Vec2]) -> float:
    """Absolute area via shoelace; returns 0.0 for fewer than 3
    points (consistent with ``_signed_area`` behaviour)."""
    return abs(_signed_area(polygon))


# ─── ID generation ───────────────────────────────────────────────────


def collect_existing_ids(bm: BuildingModel) -> set[str]:
    """Walk the BuildingModel and collect every node ID for collision
    avoidance. Used by ``make_unique_id`` to ensure new extension IDs
    do not clash with template IDs.

    Touches every entity-bearing node so a future entity type added
    to BuildingModel must be added here too — that's the explicit
    layering cost of the no-back-reference frozen-graph design.
    """
    ids: set[str] = set()
    site = bm.project.site
    ids.add(site.id)
    bld = site.building
    ids.add(bld.id)
    for storey in bld.storeys:
        ids.add(storey.id)
        for w in storey.walls:
            ids.add(w.id)
        for r in storey.rooms:
            ids.add(r.id)
        for s in storey.slabs:
            ids.add(s.id)
        for o in storey.openings:
            ids.add(o.id)
        for st in storey.stairs:
            ids.add(st.id)
    for c in bld.structural_system.columns:
        ids.add(c.id)
    for b in bld.structural_system.beams:
        ids.add(b.id)
    if bld.foundation:
        for f in bld.foundation.footings:
            ids.add(f.id)
    for d in bld.doors:
        ids.add(d.id)
    for w in bld.windows:
        ids.add(w.id)
    for ms in bld.mep_systems:
        ids.add(ms.id)
    return ids


def make_unique_id(prefix: str, existing_ids: set[str]) -> str:
    """Generate ``{prefix}-{n}`` where n is the smallest int making
    the result unique against ``existing_ids``. Mutates
    ``existing_ids`` to add the new id (so subsequent calls do not
    return the same suffix)."""
    n = 1
    while f"{prefix}-{n}" in existing_ids and n < 10_000:
        n += 1
    if n >= 10_000:
        raise ExtensionIDCollisionError(
            extension_type="<id-gen>",
            reason=f"prefix '{prefix}' has 10k collisions; ID space exhausted",
        )
    new_id = f"{prefix}-{n}"
    existing_ids.add(new_id)
    return new_id


# ─── Extension-specific layer / wall makers ──────────────────────────


def make_compound_wall_layers() -> list[MaterialLayer]:
    """Single 230mm burnt-clay-brick layer for compound walls.

    Slice 2B.3 spec: compound wall is 230mm thick, no exterior plaster
    (boundary walls in Indian residential practice are often raw brick
    or finished only on the inside). Distinct from
    ``make_external_wall_layers`` which is the 250mm 3-layer
    composite (10mm plaster + 230mm brick + 10mm plaster) used for
    building envelope walls.
    """
    return [
        MaterialLayer(
            material_name="Burnt-Clay-Brick-230mm",
            thickness=0.230,
            function="core",
        ),
    ]


def make_compound_wall(
    *,
    wall_id: str,
    name: str,
    host_storey_id: str,
    start: Vec2,
    end: Vec2,
    base_z: float = 0.0,
    top_z: float = 1.8,
) -> Wall:
    """Build a single compound wall segment.

    Defaults match the Slice 2B.3 spec: 1.8m height (Indian residential
    boundary-wall standard, NBC compliant ≤ 2.0m PMC bylaw), 230mm
    thickness (single-layer brick).

    The ``axis_points`` run from ``start`` to ``end``; the wall's
    physical thickness extends 115mm to either side perpendicular to
    that direction. For compound walls placed exactly on the plot
    edge, half the thickness sits outside the plot polygon — this is
    geometrically correct (compound walls straddle the legal property
    line in practice) and does NOT trigger PLOT_POLYGON_VALID
    because that invariant only checks ``Building.envelope_polygon``
    vertices, not wall thickness extents.
    """
    return Wall(
        id=wall_id,
        name=name,
        host_storey_ids=[host_storey_id],
        axis_points=[start, end],
        base_z=base_z,
        top_z=top_z,
        thickness=0.230,
        layers=make_compound_wall_layers(),
        type="solid",
        is_external=True,
        is_load_bearing=False,
    )


# ─── Frozen-graph append ─────────────────────────────────────────────


def get_ground_storey(bm: BuildingModel) -> Storey:
    """Return the index=0 storey, raising ExtensionError if absent.

    Every Tier-2 template has a ground storey at index=0; failure
    here means the BuildingModel was constructed by a non-template
    path (e.g. a unit-test fixture) and most extensions are not
    applicable to it.
    """
    for storey in bm.project.site.building.storeys:
        if storey.index == 0:
            return storey
    raise ExtensionError(
        extension_type="<no-storey>",
        reason="BuildingModel has no storey at index=0",
    )


def get_top_storey(bm: BuildingModel) -> Storey:
    """Return the highest-index storey (the storey whose roof is the
    building's outer roof). Mumty extension targets this storey."""
    storeys = list(bm.project.site.building.storeys)
    if not storeys:
        raise ExtensionError(
            extension_type="<no-storey>",
            reason="BuildingModel has no storeys",
        )
    return max(storeys, key=lambda s: s.index)


def commit_to_storey(
    bm: BuildingModel,
    storey_index: Optional[int] = None,
    *,
    walls: Optional[list[Wall]] = None,
    rooms: Optional[list[Room]] = None,
    slabs: Optional[list[Slab]] = None,
    openings: Optional[list[Opening]] = None,
    stairs: Optional[list[Stair]] = None,
    doors: Optional[list[Door]] = None,
    windows: Optional[list[Window]] = None,
    columns: Optional[list[Column]] = None,
    beams: Optional[list[Beam]] = None,
    new_storey: Optional[Storey] = None,
    new_storey_walls: Optional[list[Wall]] = None,
    new_storey_rooms: Optional[list[Room]] = None,
    new_storey_slabs: Optional[list[Slab]] = None,
    new_storey_openings: Optional[list[Opening]] = None,
    new_storey_stairs: Optional[list[Stair]] = None,
    replace_slab_ids: Optional[dict[str, Slab]] = None,
) -> BuildingModel:
    """Append entities to the BuildingModel and re-build under the 13
    invariants.

    Routing per parameter:

      * ``walls`` / ``rooms`` / ``slabs`` / ``openings`` / ``stairs``
        → appended to ``storeys[storey_index]``  (when ``storey_index``
        is provided).
      * ``doors`` / ``windows`` → appended to ``building.doors`` /
        ``building.windows``.
      * ``columns`` / ``beams`` → appended to
        ``building.structural_system``.
      * ``new_storey`` → appended as a brand-new storey to the
        building. ``new_storey_*`` lists are appended onto that storey
        before it lands on the building (so its rooms / walls / slabs /
        stairs land in one go without a second commit).
      * ``replace_slab_ids`` (storey-targeted) — named existing slabs
        on ``storey_index`` are REPLACED with the supplied values.
        That's how mumty cuts an opening into the existing roof slab.

    Either ``storey_index`` or ``new_storey`` (or both) must be
    provided when storey-level entities are passed; otherwise
    raises :class:`ExtensionError`.

    The returned BuildingModel is a brand-new root (model_copy cascades
    from leaf to root, then ``.build`` rebuilds from a fresh dict). No
    shared frozen-graph references with the input.
    """
    walls = walls or []
    rooms = rooms or []
    slabs = slabs or []
    openings = openings or []
    stairs = stairs or []
    doors = doors or []
    windows = windows or []
    columns = columns or []
    beams = beams or []
    new_storey_walls = new_storey_walls or []
    new_storey_rooms = new_storey_rooms or []
    new_storey_slabs = new_storey_slabs or []
    new_storey_openings = new_storey_openings or []
    new_storey_stairs = new_storey_stairs or []
    replace_slab_ids = replace_slab_ids or {}

    has_existing_storey_targets = bool(
        walls or rooms or slabs or openings or stairs or replace_slab_ids
    )
    if has_existing_storey_targets and storey_index is None:
        raise ExtensionError(
            extension_type="<commit>",
            reason=(
                "storey-level entities passed without storey_index; "
                "specify the target storey for walls/rooms/slabs/"
                "openings/stairs/replace_slab_ids."
            ),
        )

    bld = bm.project.site.building
    new_storeys: list[Storey] = []
    found_target = storey_index is None
    for storey in bld.storeys:
        if storey.index == storey_index:
            found_target = True
            # Apply slab replacements first, then append.
            new_slabs_existing: list[Slab] = []
            for s in storey.slabs:
                new_slabs_existing.append(replace_slab_ids.get(s.id, s))
            new_storeys.append(
                storey.model_copy(
                    update={
                        "walls": list(storey.walls) + walls,
                        "rooms": list(storey.rooms) + rooms,
                        "slabs": new_slabs_existing + slabs,
                        "openings": list(storey.openings) + openings,
                        "stairs": list(storey.stairs) + stairs,
                    }
                )
            )
        else:
            new_storeys.append(storey)
    if not found_target:
        raise ExtensionError(
            extension_type="<commit>",
            reason=f"no storey at index={storey_index} in BuildingModel",
        )
    if new_storey is not None:
        # Pack the new-storey entities onto the storey itself so the
        # whole batch lands in a single .build() pass.
        packed = new_storey.model_copy(
            update={
                "walls": list(new_storey.walls) + new_storey_walls,
                "rooms": list(new_storey.rooms) + new_storey_rooms,
                "slabs": list(new_storey.slabs) + new_storey_slabs,
                "openings": list(new_storey.openings) + new_storey_openings,
                "stairs": list(new_storey.stairs) + new_storey_stairs,
            }
        )
        new_storeys.append(packed)

    # Structural system update (columns, beams).
    new_struct_sys = bld.structural_system.model_copy(
        update={
            "columns": list(bld.structural_system.columns) + columns,
            "beams": list(bld.structural_system.beams) + beams,
        }
    )

    new_bld = bld.model_copy(
        update={
            "storeys": new_storeys,
            "structural_system": new_struct_sys,
            "doors": list(bld.doors) + doors,
            "windows": list(bld.windows) + windows,
        }
    )
    new_site = bm.project.site.model_copy(update={"building": new_bld})
    new_project = bm.project.model_copy(update={"site": new_site})
    return BuildingModel.build(
        {"project": new_project.model_dump(mode="python")}
    )


# ─── Validation helpers (called by extensions before commit) ─────────


def require_plot_polygon(
    bm: BuildingModel, extension_type: str
) -> list[Vec2]:
    """Return the plot polygon, or raise ExtensionRequiresPlotError if
    empty. Used by compound_wall, entry_gate, car_porch, and
    servant_quarter to refuse on towers (which have empty
    plot_polygon per the deferred-tower-plot decision)."""
    plot = list(bm.project.site.plot_polygon)
    if not plot:
        raise ExtensionRequiresPlotError(
            extension_type=extension_type,
            reason=(
                "Site.plot_polygon is empty — extension requires a "
                "defined plot boundary. Tower templates intentionally "
                "skip plot_polygon (deferred to a future tower-plot "
                "semantics slice); only mumty applies to towers in v1."
            ),
        )
    return plot


__all__ = [
    "ExtensionError",
    "PlotBoundaryViolationError",
    "NBCViolationError",
    "ExtensionRequiresPlotError",
    "ExtensionIDCollisionError",
    "NBC_MIN_AREA_SQM",
    "nbc_min_area_for",
    "make_ccw_rectangle",
    "polygon_inside_plot",
    "polygon_area",
    "collect_existing_ids",
    "make_unique_id",
    "make_compound_wall_layers",
    "make_compound_wall",
    "get_ground_storey",
    "get_top_storey",
    "commit_to_storey",
    "require_plot_polygon",
]
