"""Phase 1 Slice 4 — Pass 1 RESOLVE: geometry computation.

Companion to `placement_resolver.py`. Walks the BuildingModel, consumes
the placements produced by Pass 1's first phase, and emits a
`ResolvedGeometry` per node carrying the geometric primitives the IFC
builders will instantiate (rectangle profile dimensions, extrusion
depth, polygon footprint, etc.).

Pass 2 EMIT consumes both `ResolvedPlacement` and `ResolvedGeometry`
and never inspects raw vertices or computes geometry coordinates from
node fields itself. That's the architectural property that lets Slice 5
delete every `or 1.0` / `or props.length` fallback chain inside the
builders.

Geometry shape per node type:

    Wall            SweptSolid   rect(length × thickness) × (top_z − base_z) along Z
    Slab            SweptSolid   polygon(footprint) × thickness along −Z (top down)
    Column          SweptSolid   rect(profile dim) × (top_z − base_z) along Z
    Beam            SweptSolid   rect(profile dim) × axis-length along beam axis
    Footing         SweptSolid   polygon(footprint) × thickness along −Z
    Opening         SweptSolid   rect(width × wall_thickness+buffer) × height
    Room (Space)    SweptSolid   polygon(footprint) × ceiling_height
    Stair           SweptSolid   polygon(plan) × total_rise
    Door / Window   parametric — no IfcExtrudedAreaSolid; emit via IfcDoor/IfcWindow
                    parametric attributes. Resolver sets profile_x_dim/profile_y_dim
                    so the builder has the leaf width / height available without
                    re-reading the BuildingModel.
    MEP segment     SweptSolid   circle / rect × axis length  (rebuilt in Slice 5)
    MEP equipment / terminal   BoundingBox   reference box for placement-only rendering
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from app.domain.building_model import (
    BuildingModel,
    Slab,
    Storey,
    Vec2,
    Vec3,
)
from app.services.placement_resolver import ResolvedPlacement


@dataclass(frozen=True)
class ResolvedGeometry:
    """Canonical geometric primitive for a `BuildingModel` node.

    Builders consume the fields keyed by `representation_type`:

      * `"SweptSolid"` (extrusion):
          - `profile_type` ∈ {"rectangle", "circle", "polygon"}
          - rectangle:  `profile_x_dim`, `profile_y_dim`
          - circle:     `profile_x_dim` (= radius)
          - polygon:    `profile_polygon` (CCW Vec2 list)
          - `extrusion_depth`
          - `extrusion_direction`
      * `"Curve3D"` (axis polylines, MEP centrelines):
          - `polyline`
      * `"BoundingBox"` (placement-only nodes, e.g. MEP equipment):
          - `bbox_x`, `bbox_y`, `bbox_z`

    Other fields are `None` / empty when not used.
    """

    node_id: str
    representation_type: Literal["SweptSolid", "Curve3D", "BoundingBox", "Parametric"]
    profile_type: Optional[Literal["rectangle", "circle", "polygon"]] = None
    profile_x_dim: Optional[float] = None
    profile_y_dim: Optional[float] = None
    profile_polygon: list[Vec2] = field(default_factory=list)
    extrusion_depth: Optional[float] = None
    extrusion_direction: Optional[Vec3] = None
    polyline: list[Vec3] = field(default_factory=list)
    bbox_x: Optional[float] = None
    bbox_y: Optional[float] = None
    bbox_z: Optional[float] = None


_UP = Vec3(x=0.0, y=0.0, z=1.0)
_DOWN = Vec3(x=0.0, y=0.0, z=-1.0)


def _polyline_length_2d(points: list[Vec2]) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        dx = points[i + 1].x - points[i].x
        dy = points[i + 1].y - points[i].y
        total += (dx * dx + dy * dy) ** 0.5
    return total


def resolve_geometries(
    model: BuildingModel,
    placements: dict[str, ResolvedPlacement],
) -> dict[str, ResolvedGeometry]:
    """Compute `ResolvedGeometry` for every node in the model.

    Requires the placements map produced by `resolve_placements` so we
    can derive consistent `extrusion_depth` values (top_z − base_z is
    the resolved base, not the raw schema field).
    """
    out: dict[str, ResolvedGeometry] = {}
    bld = model.project.site.building

    storeys_by_id: dict[str, Storey] = {s.id: s for s in bld.storeys}
    storeys_by_index: dict[int, Storey] = {s.index: s for s in bld.storeys}

    def _floor_slab_on(storey: Storey) -> Optional[Slab]:
        floor_slabs = sorted(
            (s for s in storey.slabs if s.predefined_type == "FLOOR"),
            key=lambda s: s.id,
        )
        if floor_slabs:
            return floor_slabs[0]
        if len(storey.slabs) == 1:
            return storey.slabs[0]
        return None

    walls_by_id = {w.id: w for s in bld.storeys for w in s.walls}

    # ─── Slabs ──────────────────────────────────────────────────────
    for storey in bld.storeys:
        for slab in storey.slabs:
            thickness = slab.top_z - slab.bottom_z
            out[slab.id] = ResolvedGeometry(
                node_id=slab.id,
                representation_type="SweptSolid",
                profile_type="polygon",
                profile_polygon=list(slab.footprint_polygon),
                extrusion_depth=thickness,
                extrusion_direction=_DOWN,
            )

    # ─── Footings ───────────────────────────────────────────────────
    if bld.foundation:
        for footing in bld.foundation.footings:
            thickness = footing.top_z - footing.bottom_z
            out[footing.id] = ResolvedGeometry(
                node_id=footing.id,
                representation_type="SweptSolid",
                profile_type="polygon",
                profile_polygon=list(footing.footprint_polygon),
                extrusion_depth=thickness,
                extrusion_direction=_DOWN,
            )

    # ─── Columns ────────────────────────────────────────────────────
    footings_by_supports = {}
    if bld.foundation:
        for f in bld.foundation.footings:
            if f.supports_column_id:
                footings_by_supports[f.supports_column_id] = f

    for col in bld.structural_system.columns:
        # Recompute resolved base/top from the placement (which already
        # resolved footing override).
        col_placement = placements[col.id]
        base_z = col_placement.origin.z
        top_z = col.top_z  # placement doesn't carry top; column.top_z is authoritative
        depth = top_z - base_z
        if depth <= 0:
            depth = max(0.001, top_z - base_z)
        # Profile: ProfileRef dimensions; default rectangle
        dims = col.profile.dimensions
        if col.profile.profile_type == "circle":
            radius = float(dims.get("radius", 0.15))
            out[col.id] = ResolvedGeometry(
                node_id=col.id,
                representation_type="SweptSolid",
                profile_type="circle",
                profile_x_dim=radius,
                extrusion_depth=depth,
                extrusion_direction=_UP,
            )
        else:
            x_dim = float(dims.get("width", dims.get("x_dim", 0.3)))
            y_dim = float(dims.get("depth", dims.get("y_dim", 0.3)))
            out[col.id] = ResolvedGeometry(
                node_id=col.id,
                representation_type="SweptSolid",
                profile_type="rectangle",
                profile_x_dim=x_dim,
                profile_y_dim=y_dim,
                extrusion_depth=depth,
                extrusion_direction=_UP,
            )

    # ─── Walls ──────────────────────────────────────────────────────
    for storey in bld.storeys:
        for wall in storey.walls:
            placement = placements[wall.id]
            base_z = placement.origin.z
            # top_z computed using same logic as placement_resolver step 5:
            host_storeys = [storeys_by_id[sid] for sid in wall.host_storey_ids]
            highest = max(host_storeys, key=lambda s: s.elevation)
            next_storey = storeys_by_index.get(highest.index + 1)
            if next_storey is not None:
                slab_above = _floor_slab_on(next_storey)
                top_z = slab_above.bottom_z if slab_above is not None else wall.top_z
            else:
                top_z = wall.top_z
            depth = top_z - base_z
            length = _polyline_length_2d(list(wall.axis_points))
            out[wall.id] = ResolvedGeometry(
                node_id=wall.id,
                representation_type="SweptSolid",
                profile_type="rectangle",
                profile_x_dim=length,
                profile_y_dim=wall.thickness,
                extrusion_depth=depth,
                extrusion_direction=_UP,
            )

    # ─── Openings ───────────────────────────────────────────────────
    # Profile = rect(width × wall_thickness + 1.0 buffer), extrusion = height.
    # The buffer ensures the cut goes fully through the wall thickness.
    for storey in bld.storeys:
        for opening in storey.openings:
            wall = walls_by_id.get(opening.in_wall_id)
            wall_thickness = wall.thickness if wall is not None else 0.5
            out[opening.id] = ResolvedGeometry(
                node_id=opening.id,
                representation_type="SweptSolid",
                profile_type="rectangle",
                profile_x_dim=opening.width,
                profile_y_dim=wall_thickness + 1.0,
                extrusion_depth=opening.height,
                extrusion_direction=_UP,
            )

    # ─── Doors / Windows: parametric (no extrusion in resolver) ─────
    for door in bld.doors:
        out[door.id] = ResolvedGeometry(
            node_id=door.id,
            representation_type="Parametric",
            # Builder reads these instead of the BuildingModel field directly:
            profile_x_dim=None,  # door width comes from opening
            profile_y_dim=None,
        )
    for window in bld.windows:
        out[window.id] = ResolvedGeometry(
            node_id=window.id,
            representation_type="Parametric",
        )

    # ─── Spaces / Rooms ────────────────────────────────────────────
    for storey in bld.storeys:
        slab_below = _floor_slab_on(storey)
        floor_z = slab_below.top_z if slab_below is not None else storey.elevation
        # Ceiling = slab_above.bottom_z if exists, else storey top.
        next_storey = storeys_by_index.get(storey.index + 1)
        if next_storey is not None:
            slab_above = _floor_slab_on(next_storey)
            ceiling_z = (
                slab_above.bottom_z
                if slab_above is not None
                else storey.elevation + storey.actual_height
            )
        else:
            ceiling_z = storey.elevation + storey.actual_height
        height = max(0.1, ceiling_z - floor_z)
        for room in storey.rooms:
            out[room.id] = ResolvedGeometry(
                node_id=room.id,
                representation_type="SweptSolid",
                profile_type="polygon",
                profile_polygon=list(room.footprint_polygon),
                extrusion_depth=height,
                extrusion_direction=_UP,
            )

    # ─── Stairs ─────────────────────────────────────────────────────
    # Resolved geometry for stairs is plan polygon × total rise.
    for storey in bld.storeys:
        for stair in storey.stairs:
            rise = stair.riser_count * stair.riser_height
            out[stair.id] = ResolvedGeometry(
                node_id=stair.id,
                representation_type="SweptSolid",
                profile_type="polygon",
                profile_polygon=list(stair.plan_polygon),
                extrusion_depth=rise,
                extrusion_direction=_UP,
            )

    # ─── Beams ──────────────────────────────────────────────────────
    for beam in bld.structural_system.beams:
        s = beam.start_point
        e = beam.end_point
        dx = e.x - s.x
        dy = e.y - s.y
        dz = e.z - s.z
        length = (dx * dx + dy * dy + dz * dz) ** 0.5
        dims = beam.profile.dimensions
        x_dim = float(dims.get("width", 0.2))
        y_dim = float(dims.get("depth", 0.4))
        out[beam.id] = ResolvedGeometry(
            node_id=beam.id,
            representation_type="SweptSolid",
            profile_type="rectangle",
            profile_x_dim=x_dim,
            profile_y_dim=y_dim,
            extrusion_depth=length,
            extrusion_direction=Vec3(
                x=dx / length, y=dy / length, z=dz / length
            ) if length > 0 else _UP,
        )

    # ─── MEP ────────────────────────────────────────────────────────
    for sys in bld.mep_systems:
        if sys.source is not None:
            # Bounding-box reference for placement-only render.
            out[sys.source.id] = ResolvedGeometry(
                node_id=sys.source.id,
                representation_type="BoundingBox",
                bbox_x=0.6, bbox_y=0.6, bbox_z=0.6,
            )
        for seg in sys.distribution:
            s = seg.start_point
            e = seg.end_point
            length = ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 + (e.z - s.z) ** 2) ** 0.5
            radius = 0.1 if seg.predefined_type in {"PIPESEGMENT", "RIGIDSEGMENT"} else 0.15
            out[seg.id] = ResolvedGeometry(
                node_id=seg.id,
                representation_type="SweptSolid",
                profile_type="circle",
                profile_x_dim=radius,
                extrusion_depth=length,
                extrusion_direction=Vec3(
                    x=(e.x - s.x) / length if length > 0 else 0.0,
                    y=(e.y - s.y) / length if length > 0 else 0.0,
                    z=(e.z - s.z) / length if length > 0 else 1.0,
                ),
            )
        for term in sys.terminals:
            out[term.id] = ResolvedGeometry(
                node_id=term.id,
                representation_type="BoundingBox",
                bbox_x=0.3, bbox_y=0.3, bbox_z=0.3,
            )

    return out


__all__ = ["ResolvedGeometry", "resolve_geometries"]
