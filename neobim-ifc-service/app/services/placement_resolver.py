"""Phase 1 Slice 4 — Pass 1 RESOLVE: placement computation.

Walks a `BuildingModel` in the spec'd 11-step dependency order and
computes a `ResolvedPlacement` for every node. Pass 1 is read-only —
no IFC entities are created here. Pass 2 (the IFC builders) consumes
the resolved placements + geometries and emits IFC entities.

Why two passes? Without it, every builder has to inline placement math
that depends on neighboring elements — slabs need storey context,
walls need slab tops, columns need footing tops, doors need parent
opening / wall placement. The legacy (Phase 0) approach inlined all of
this with `or 1.0` / `or storey_elevation` fallback chains, which is
exactly the source of the "guess-becomes-bug" failure mode the Phase 1
roadmap is fixing.

The 11-step order from the Phase 1 spec (strict — do not reorder):

    1. Project, Site, Building          (origin = world zero)
    2. Foundation footings              (origin from Footing.location + top_z)
    3. Slabs (all storeys including roof) (origin = first footprint vertex + top_z)
    4. Columns                          (base_z from supporting footing if any, else col.base_z)
    5. Walls                            (base_z from slab below FLOOR.top_z if any, else wall.base_z)
    6. Openings                         (placement relative to host wall)
    7. Doors / Windows                  (placement relative to host opening)
    8. Spaces (rooms)                   (origin = first footprint vertex + slab_below.top_z)
    9. Stairs                           (origin = first plan vertex + slab_below.top_z)
   10. Beams                            (start_point promoted; supported slab dictates top_z)
   11. MEP                              (per-node placement at source / segment / terminal location)

Cycle detection: if any node's resolution depends on a node not yet
resolved (and not earlier in the order), `BuildingModelResolutionError`
is raised. The system fails loud — there is no iterative solver. A
cycle means the BuildingModel schema is wrong and the lift service
needs fixing, not the resolver.

`ResolvedPlacement` is the canonical world-space anchor for IFC
emission. It is consumed by every builder in Slices 4–5 to produce
`IfcLocalPlacement` + `IfcAxis2Placement3D`. Builders **do not**
recompute origin or axes from raw vertices — they consume what's
here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.domain.building_model import (
    BuildingModel,
    BuildingModelResolutionError,
    Slab,
    Storey,
    Vec3,
    Wall,
)


@dataclass(frozen=True)
class ResolvedPlacement:
    """Canonical world-space placement of a `BuildingModel` node.

    Attributes:
        node_id: id of the source BuildingModel node.
        origin: world coordinates of the local origin.
        local_x_axis: primary local direction (e.g. wall length direction).
        local_z_axis: local up (typically (0, 0, 1)).
        relative_to_node_id: parent in the IFC placement hierarchy.
            None for root (Project). Set to the host storey id for
            walls/slabs/columns/etc.; the parent opening id for doors
            and windows; the host wall id for openings.
    """

    node_id: str
    origin: Vec3
    local_x_axis: Vec3
    local_z_axis: Vec3
    relative_to_node_id: Optional[str] = None


_X_AXIS = Vec3(x=1.0, y=0.0, z=0.0)
_Z_AXIS = Vec3(x=0.0, y=0.0, z=1.0)


def resolve_placements(model: BuildingModel) -> dict[str, ResolvedPlacement]:
    """Run Pass 1 RESOLVE over the entire BuildingModel. Returns a map
    of node-id → ResolvedPlacement covering every spatial node that the
    builders need to position. The map is populated in the strict 11-step
    order documented at the top of this module; downstream consumers can
    rely on the order for sanity assertions.
    """
    out: dict[str, ResolvedPlacement] = {}
    project = model.project
    site = project.site
    building = site.building

    # Step 1 — Project, Site, Building.
    out[project.id] = ResolvedPlacement(
        node_id=project.id,
        origin=Vec3(x=0.0, y=0.0, z=0.0),
        local_x_axis=_X_AXIS,
        local_z_axis=_Z_AXIS,
        relative_to_node_id=None,
    )
    out[site.id] = ResolvedPlacement(
        node_id=site.id,
        origin=Vec3(x=0.0, y=0.0, z=0.0),
        local_x_axis=_X_AXIS,
        local_z_axis=_Z_AXIS,
        relative_to_node_id=project.id,
    )
    out[building.id] = ResolvedPlacement(
        node_id=building.id,
        origin=Vec3(x=0.0, y=0.0, z=0.0),
        local_x_axis=_X_AXIS,
        local_z_axis=_Z_AXIS,
        relative_to_node_id=site.id,
    )
    # Storeys themselves (every storey gets a placement at its elevation
    # so the builders can attach IfcBuildingStorey via existing helpers).
    for storey in building.storeys:
        out[storey.id] = ResolvedPlacement(
            node_id=storey.id,
            origin=Vec3(x=0.0, y=0.0, z=storey.elevation),
            local_x_axis=_X_AXIS,
            local_z_axis=_Z_AXIS,
            relative_to_node_id=building.id,
        )

    # Step 2 — Foundation footings.
    if building.foundation:
        for footing in sorted(building.foundation.footings, key=lambda f: f.id):
            out[footing.id] = ResolvedPlacement(
                node_id=footing.id,
                origin=Vec3(
                    x=footing.location.x, y=footing.location.y, z=footing.top_z
                ),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=building.id,
            )

    # Step 3 — Slabs (all storeys, including roof slabs that lift emitted
    # with predefined_type=ROOF).
    for storey in building.storeys:
        for slab in sorted(storey.slabs, key=lambda s: s.id):
            v0 = slab.footprint_polygon[0]
            out[slab.id] = ResolvedPlacement(
                node_id=slab.id,
                origin=Vec3(x=v0.x, y=v0.y, z=slab.top_z),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=storey.id,
            )

    storeys_by_id: dict[str, Storey] = {s.id: s for s in building.storeys}
    storeys_by_index: dict[int, Storey] = {s.index: s for s in building.storeys}

    # Helper: locate the canonical FLOOR slab on a storey for "slab below"
    # and "slab above" lookups. Mirrors STAIR_RISE_MATCHES's tiebreak.
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

    # Step 4 — Columns. Spec says base_z = supporting footing.top_z when one
    # exists; otherwise use the column's own base_z (which lift sets from
    # storey.elevation). Same model for top_z — supported slab if known,
    # else column.top_z.
    footings_by_supports: dict[str, str] = {}
    if building.foundation:
        for f in building.foundation.footings:
            if f.supports_column_id:
                footings_by_supports[f.supports_column_id] = f.id
    for col in sorted(building.structural_system.columns, key=lambda c: c.id):
        footing_id = footings_by_supports.get(col.id)
        if footing_id is not None:
            base_z = next(
                f.top_z
                for f in building.foundation.footings  # type: ignore[union-attr]
                if f.id == footing_id
            )
        else:
            base_z = col.base_z
        out[col.id] = ResolvedPlacement(
            node_id=col.id,
            origin=Vec3(x=col.location.x, y=col.location.y, z=base_z),
            local_x_axis=_X_AXIS,
            local_z_axis=_Z_AXIS,
            relative_to_node_id=col.host_storey_id,
        )

    # Step 5 — Walls. base_z = lowest host storey's FLOOR slab.top_z when
    # found, else wall.base_z. Local x axis points along the polyline
    # (axis_points[0] → axis_points[-1]).
    for storey in building.storeys:
        for wall in sorted(storey.walls, key=lambda w: w.id):
            host_storeys = [storeys_by_id[sid] for sid in wall.host_storey_ids]
            lowest = min(host_storeys, key=lambda s: s.elevation)
            slab_below = _floor_slab_on(lowest)
            base_z = slab_below.top_z if slab_below is not None else wall.base_z
            a = wall.axis_points[0]
            b = wall.axis_points[-1]
            dx = b.x - a.x
            dy = b.y - a.y
            length = (dx * dx + dy * dy) ** 0.5
            if length < 1e-9:
                # Degenerate axis — invariant FOOTPRINT_VALID / OPENING_IN_WALL
                # would already have rejected this, but defend anyway.
                raise BuildingModelResolutionError(
                    f"Wall '{wall.id}' has zero-length axis after BuildingModel "
                    "construction; resolver cannot derive a local x-axis."
                )
            x_axis = Vec3(x=dx / length, y=dy / length, z=0.0)
            out[wall.id] = ResolvedPlacement(
                node_id=wall.id,
                origin=Vec3(x=a.x, y=a.y, z=base_z),
                local_x_axis=x_axis,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=lowest.id,
            )

    # Step 6 — Openings. Placement is relative to host wall: local origin
    # = (distance_along_wall, 0, sill_z - wall.base_z). Anchored to wall.
    for storey in building.storeys:
        for opening in sorted(storey.openings, key=lambda o: o.id):
            host_wall_placement = out.get(opening.in_wall_id)
            if host_wall_placement is None:
                # Invariant OPENING_IN_WALL would already have caught this.
                raise BuildingModelResolutionError(
                    f"Opening '{opening.id}': host wall "
                    f"'{opening.in_wall_id}' has no resolved placement "
                    "(should have been resolved in step 5)."
                )
            out[opening.id] = ResolvedPlacement(
                node_id=opening.id,
                origin=Vec3(
                    x=opening.distance_along_wall,
                    y=0.0,
                    z=opening.sill_z - host_wall_placement.origin.z,
                ),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=opening.in_wall_id,
            )

    # Step 7 — Doors / Windows. Placement is relative to parent opening
    # (the same local origin — fillers sit at the opening origin).
    openings_by_id = {o.id: o for storey in building.storeys for o in storey.openings}
    for door in sorted(building.doors, key=lambda d: d.id):
        if door.in_opening_id not in openings_by_id:
            raise BuildingModelResolutionError(
                f"Door '{door.id}': parent opening '{door.in_opening_id}' "
                "has no resolved placement."
            )
        out[door.id] = ResolvedPlacement(
            node_id=door.id,
            origin=Vec3(x=0.0, y=0.0, z=0.0),
            local_x_axis=_X_AXIS,
            local_z_axis=_Z_AXIS,
            relative_to_node_id=door.in_opening_id,
        )
    for window in sorted(building.windows, key=lambda w: w.id):
        if window.in_opening_id not in openings_by_id:
            raise BuildingModelResolutionError(
                f"Window '{window.id}': parent opening "
                f"'{window.in_opening_id}' has no resolved placement."
            )
        out[window.id] = ResolvedPlacement(
            node_id=window.id,
            origin=Vec3(x=0.0, y=0.0, z=0.0),
            local_x_axis=_X_AXIS,
            local_z_axis=_Z_AXIS,
            relative_to_node_id=window.in_opening_id,
        )

    # Step 8 — Spaces (rooms). Origin at first footprint vertex, z = slab
    # below top.
    for storey in building.storeys:
        slab_below = _floor_slab_on(storey)
        floor_z = slab_below.top_z if slab_below is not None else storey.elevation
        for room in sorted(storey.rooms, key=lambda r: r.id):
            v0 = room.footprint_polygon[0]
            out[room.id] = ResolvedPlacement(
                node_id=room.id,
                origin=Vec3(x=v0.x, y=v0.y, z=floor_z),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=storey.id,
            )

    # Step 9 — Stairs. STAIR_RISE_MATCHES has already validated the rise;
    # placement is at the host storey's slab top.
    for storey in building.storeys:
        slab_below = _floor_slab_on(storey)
        floor_z = slab_below.top_z if slab_below is not None else storey.elevation
        for stair in sorted(storey.stairs, key=lambda s: s.id):
            v0 = stair.plan_polygon[0]
            out[stair.id] = ResolvedPlacement(
                node_id=stair.id,
                origin=Vec3(x=v0.x, y=v0.y, z=floor_z),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=storey.id,
            )

    # Step 10 — Beams. start_point sets origin; axis derived from
    # (start_point → end_point). Top_z used by geometry, not placement.
    for beam in sorted(building.structural_system.beams, key=lambda b: b.id):
        s = beam.start_point
        e = beam.end_point
        dx = e.x - s.x
        dy = e.y - s.y
        dz = e.z - s.z
        length = (dx * dx + dy * dy + dz * dz) ** 0.5
        if length < 1e-9:
            raise BuildingModelResolutionError(
                f"Beam '{beam.id}' has zero-length axis (start_point == end_point)."
            )
        x_axis = Vec3(x=dx / length, y=dy / length, z=dz / length)
        out[beam.id] = ResolvedPlacement(
            node_id=beam.id,
            origin=Vec3(x=s.x, y=s.y, z=s.z),
            local_x_axis=x_axis,
            local_z_axis=_Z_AXIS,
            relative_to_node_id=beam.host_storey_id,
        )

    # Step 11 — MEP nodes (source equipment, segments, terminals).
    for sys in sorted(building.mep_systems, key=lambda s: s.id):
        if sys.source is not None:
            loc = sys.source.location
            out[sys.source.id] = ResolvedPlacement(
                node_id=sys.source.id,
                origin=Vec3(x=loc.x, y=loc.y, z=loc.z),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=building.id,
            )
        for seg in sorted(sys.distribution, key=lambda x: x.id):
            s = seg.start_point
            e = seg.end_point
            dx = e.x - s.x
            dy = e.y - s.y
            dz = e.z - s.z
            length = (dx * dx + dy * dy + dz * dz) ** 0.5
            if length < 1e-9:
                # Zero-length segment — skip placement (the segment is
                # invalid; legacy MEP_TERMINATES would also fail). Don't
                # raise here because MEP isn't strictly checked by
                # MEP_TERMINATES for zero-length, but the resolver should
                # be defensive.
                raise BuildingModelResolutionError(
                    f"MEP segment '{seg.id}' has zero-length axis."
                )
            x_axis = Vec3(x=dx / length, y=dy / length, z=dz / length)
            out[seg.id] = ResolvedPlacement(
                node_id=seg.id,
                origin=Vec3(x=s.x, y=s.y, z=s.z),
                local_x_axis=x_axis,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=building.id,
            )
        for term in sorted(sys.terminals, key=lambda t: t.id):
            loc = term.location
            out[term.id] = ResolvedPlacement(
                node_id=term.id,
                origin=Vec3(x=loc.x, y=loc.y, z=loc.z),
                local_x_axis=_X_AXIS,
                local_z_axis=_Z_AXIS,
                relative_to_node_id=building.id,
            )

    return out


__all__ = ["ResolvedPlacement", "resolve_placements"]
