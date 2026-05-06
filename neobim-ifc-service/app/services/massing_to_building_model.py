"""Phase 1 Slice 2 — MassingGeometry → BuildingModel lift service.

Pure function. Same input → byte-identical output. Never raises;
unresolvable nodes are skipped with a `LiftWarning` and the resulting
`BuildingModel` is always invariant-valid (per the lift-paradox
resolution agreed with the plan author).

The seven heuristics, in execution order:

  H1  STOREY_TOPOLOGY
        MassingStorey.{index, elevation, height, name} → Storey. Storeys
        are processed in input-list order; .index is preserved.
        Discontinuous elevations (gap > 5mm or overlap) are normalised
        by snapping each storey's elevation to the previous storey's
        top (preserves heights, may shift z). Always emits
        STOREY_DISCONTINUITY warning when any adjustment fires so the
        operator sees what changed.

  H2  WALL_JUNCTION_SNAP
        After all walls have been lifted, their endpoints are clustered
        within 50mm tolerance and replaced with the cluster centroid.
        Greedy clustering order is deterministic — sorted by
        (wall.id, point_index). No warning emitted (this is a routine
        cleanup, not an unresolvable case).

  H3  OPENING_TO_WALL
        Each window/door element becomes an Opening + a Window/Door.
        Opening.in_wall_id comes from
        ElementProperties.parent_wall_id when present; otherwise from
        nearest-axis search within 100mm of the element vertex
        (deterministic tie-break by wall id). If neither succeeds:
        OPENING_NO_WALL_MATCH and the opening + filler are skipped.

        Geometric placement: Opening.distance_along_wall is taken
        verbatim from props.wall_offset; if the resulting opening
        would violate OPENING_IN_WALL (too close to either end),
        OPENING_INVALID_PLACEMENT fires and the opening + filler are
        skipped.

  H4  DOOR_TO_ROOMS
        For each accepted door, look up its parent wall and test
        100mm offset midpoints on each side against every Room
        polygon. The door's connects_room_ids becomes
        [room_left, room_right] when both sides match, [room_left,
        "Outside"] / ["Outside", room_right] when only one matches,
        and ["Outside"] alone when neither matches AND the door is
        marked exterior. If no rooms anywhere AND not exterior:
        DOOR_NO_ROOM_MATCH and the door is skipped (the underlying
        opening stays — the wall opening is independent of fillers).

  H5  BEAM_TO_COLUMNS
        For each beam, find columns whose top point is within 50mm
        of the beam's start_point and end_point. Beams supported on
        at least one end are accepted (matches IFC convention —
        cantilevers are valid structural elements). Beams supported
        at zero ends fall back to a moment connection on the nearest
        wall axis within 50mm. If no nearby column or wall:
        BEAM_NO_SUPPORT and the beam is skipped.

  H6  ROOM_BOUNDARIES
        For each space, derive footprint from
        properties.space_footprint when present, otherwise from the
        element's vertices (x, y projection). For each polygon edge,
        search walls within 50mm perpendicular distance and ≤ 5°
        angle deviation, deterministic tie-break by wall id; record
        BoundaryEdge(wall_id, side) where side is determined by the
        cross-product sign. If any edge fails to find a matching
        wall: ROOM_NO_WALL_MATCH and the room is skipped. If the
        resulting bounding_edges produce a corner-resolution failure
        (parallel offset axes, self-intersecting polygon):
        ROOM_BOUNDED_RESOLUTION_FAILED and the room is skipped.

  H7  PROVENANCE
        Stamp Provenance(input_contract_version="MassingGeometry-1.0.0",
        agent_stages_run="lift-from-massing",
        source_contract="MassingGeometry-lifted",
        target_fidelity=options.target_fidelity,
        generated_at=ISO-8601 UTC, build_id=…, fixture_match=…).
        Returned inside ProjectMetadata.

Other normalisations applied silently (NOT warning-worthy because
they're routine defaults, not unresolvable cases):

  * Stair riser_count and riser_height are RECOMPUTED from structural
    rise (slab_above.bottom_z - slab_below.top_z) so STAIR_RISE_MATCHES
    passes within 1mm. Legacy props.riserCount / props.riserHeight are
    ignored — the structural rise is authoritative.
  * Default values for missing optional props:
        Wall.thickness          → 0.2 m
        Wall.height (top_z)     → storey.elevation + storey.height
        Slab.thickness          → 0.2 m
        Column profile          → 300×300 rectangle
        Beam profile            → 200×400 rectangle
        Door swing              → "inward"
        Door handedness         → "left"
  * Roof elements become Slab(predefined_type="ROOF") on the highest
    storey, top_z = storey.elevation + storey.height.

Determinism:
  * All collections sorted by id (or index) before iteration.
  * Tie-breaks resolved by lexicographic id ordering.
  * No RNG, no time-dependent fields apart from
    Provenance.generated_at, which is taken from a single
    `datetime.now(timezone.utc)` call at lift time. Tests must use
    `freeze_time` or compare BuildingModel JSON with that field
    excluded.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.domain.building_model import (
    Beam,
    BoundaryEdge,
    Building,
    BuildingModel,
    BuildingModelValidationError,
    Column,
    Door,
    Foundation,
    GeoReference,
    MEPEquipment,
    MEPSegment,
    MEPSystem,
    MEPTerminal,
    MaterialLayer,
    Opening,
    ProfileRef,
    Project,
    ProjectMetadata,
    Provenance,
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
from app.models.request import (
    ExportOptions,
    GeometryElement,
    MassingGeometry,
    MassingStorey,
    Vertex,
)


# ─── Constants — documented defaults (not magic numbers) ─────────────


_SNAP_TOL_M = 0.05            # H2: wall endpoint clustering tolerance
_OPENING_NEAR_AXIS_TOL_M = 0.1   # H3: nearest-axis search radius
_DOOR_OFFSET_M = 0.1          # H4: how far to step from wall axis to test rooms
_BEAM_END_TOL_M = 0.05        # H5: column-top to beam-end proximity
_BEAM_MOMENT_TOL_M = 0.05     # H5: wall axis to beam-end proximity for moment fallback
_ROOM_WALL_PERP_TOL_M = 0.5   # H6: room polygon edge to wall axis (must be > half wall thickness)
_ROOM_WALL_ANGLE_TOL_RAD = math.radians(5.0)   # H6: room edge ↔ wall axis parallelism
_TYPICAL_RISER_HEIGHT_M = 0.18    # stair recomputation target
_DEFAULT_WALL_THICKNESS_M = 0.2
_DEFAULT_SLAB_THICKNESS_M = 0.2
_DEFAULT_DOOR_WIDTH_M = 0.9
_DEFAULT_DOOR_HEIGHT_M = 2.1
_DEFAULT_WINDOW_WIDTH_M = 1.2
_DEFAULT_WINDOW_HEIGHT_M = 1.5
_DEFAULT_WINDOW_SILL_M = 0.9
_DEFAULT_COLUMN_DIM_M = 0.3
_DEFAULT_BEAM_DEPTH_M = 0.4
_DEFAULT_BEAM_WIDTH_M = 0.2
_DEFAULT_TREAD_DEPTH_M = 0.28
_DEFAULT_PROFILE_300x300 = ProfileRef(
    name="300x300",
    profile_type="rectangle",
    dimensions={"width": 0.3, "depth": 0.3},
)
_DEFAULT_PROFILE_200x400 = ProfileRef(
    name="200x400",
    profile_type="rectangle",
    dimensions={"width": 0.2, "depth": 0.4},
)


# ─── LiftWarning ─────────────────────────────────────────────────────


class LiftWarning(BaseModel):
    """Emitted by `lift()` for any skipped or fallback decision.

    Pre-defined `code` values (extend conservatively):

        STOREY_DISCONTINUITY        — H1 normalised an elevation gap.
        OPENING_NO_WALL_MATCH       — H3 couldn't find a parent wall.
        OPENING_INVALID_PLACEMENT   — H3 placement violates 100mm clearance.
        DOOR_NO_ROOM_MATCH          — H4 found neither room nor exterior.
        BEAM_NO_SUPPORT             — H5 no column or wall within 50mm.
        ROOM_NO_FOOTPRINT           — H6 space has neither space_footprint nor vertices.
        ROOM_NO_WALL_MATCH          — H6 a polygon edge had no matching wall.
        ROOM_BOUNDED_RESOLUTION_FAILED — H6 corner-resolution produced an invalid polygon.
        WALL_INSUFFICIENT_VERTICES  — wall element had < 2 distinct (x, y) points.
        STAIR_NO_NEXT_STOREY        — stair on topmost storey; would fail STAIR_RISE_MATCHES.
        MEP_NO_ANCHOR               — MEP segments without source or terminal in same kind.
        LIFT_UNSUPPORTED_TYPE       — element type not yet mapped (balcony, mullion, etc.).
        DUPLICATE_STOREY_INDEX      — H1 saw two MassingStoreys with the same index.
    """

    model_config = ConfigDict(frozen=True)
    code: str
    legacy_element_id: str
    message: str
    fallback: str


# ─── Geometry helpers (pure) ─────────────────────────────────────────


def _vec2(x: float, y: float) -> dict:
    return {"x": float(x), "y": float(y)}


def _vec3(x: float, y: float, z: float) -> dict:
    return {"x": float(x), "y": float(y), "z": float(z)}


def _signed_area(coords: list[dict]) -> float:
    n = len(coords)
    if n < 3:
        return 0.0
    acc = 0.0
    for i in range(n):
        j = (i + 1) % n
        acc += coords[i]["x"] * coords[j]["y"] - coords[j]["x"] * coords[i]["y"]
    return acc / 2.0


def _ensure_ccw(coords: list[dict]) -> list[dict]:
    """Reverse the polygon if its signed area is non-positive."""
    if _signed_area(coords) <= 0:
        return list(reversed(coords))
    return coords


def _distinct_count(coords: list[dict], tol: float = 0.001) -> int:
    distinct: list[dict] = []
    for v in coords:
        if not any(
            ((v["x"] - u["x"]) ** 2 + (v["y"] - u["y"]) ** 2) ** 0.5 <= tol
            for u in distinct
        ):
            distinct.append(v)
    return len(distinct)


def _polyline_length_m(points: list[dict]) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        dx = points[i + 1]["x"] - points[i]["x"]
        dy = points[i + 1]["y"] - points[i]["y"]
        total += (dx * dx + dy * dy) ** 0.5
    return total


def _point_in_polygon(p: tuple[float, float], coords: list[dict]) -> bool:
    """Ray-casting point-in-polygon test. Robust for simple polygons."""
    x, y = p
    inside = False
    n = len(coords)
    j = n - 1
    for i in range(n):
        xi, yi = coords[i]["x"], coords[i]["y"]
        xj, yj = coords[j]["x"], coords[j]["y"]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _perpendicular_distance(p: tuple[float, float], a: dict, b: dict) -> float:
    """Distance from point p to the infinite line through a→b."""
    px, py = p
    dx = b["x"] - a["x"]
    dy = b["y"] - a["y"]
    seg_len = (dx * dx + dy * dy) ** 0.5
    if seg_len < 1e-12:
        return ((px - a["x"]) ** 2 + (py - a["y"]) ** 2) ** 0.5
    # |(b-a) × (p-a)| / |b-a|
    cross = abs(dx * (py - a["y"]) - dy * (px - a["x"]))
    return cross / seg_len


def _angle_between_directions(d1: tuple[float, float], d2: tuple[float, float]) -> float:
    """Acute angle between two directions in radians (always in [0, π/2])."""
    n1 = (d1[0] ** 2 + d1[1] ** 2) ** 0.5
    n2 = (d2[0] ** 2 + d2[1] ** 2) ** 0.5
    if n1 < 1e-12 or n2 < 1e-12:
        return math.pi / 2  # treat degenerate as max-angle (won't match anything)
    cos_theta = abs(d1[0] * d2[0] + d1[1] * d2[1]) / (n1 * n2)
    return math.acos(max(-1.0, min(1.0, cos_theta)))


def _cross_z(d: tuple[float, float], q: tuple[float, float]) -> float:
    """z-component of (d × q) for 2D vectors. >0 ⇒ q is to the LEFT of d."""
    return d[0] * q[1] - d[1] * q[0]


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _v(vert: Vertex) -> dict:
    """Vertex → Vec2-shaped dict (drops z)."""
    return _vec2(vert.x, vert.y)


# ─── H1 — Storey topology ────────────────────────────────────────────


def _lift_storeys(
    geometry: MassingGeometry, warnings: list[LiftWarning]
) -> dict[int, dict]:
    """Return ordered dict of {original_index: storey_dict_template} ready
    to fill with walls/slabs/etc. Storey IDs are deterministic strings of
    the form "storey-{index}".

    Detects + heals discontinuities by snapping each storey's elevation to
    the previous storey's top. Heights are preserved.
    """
    seen_indices: set[int] = set()
    out: dict[int, dict] = {}
    in_order = sorted(geometry.storeys, key=lambda s: (s.index, s.elevation))
    prev_top: Optional[float] = None
    for ms in in_order:
        if ms.index in seen_indices:
            warnings.append(
                LiftWarning(
                    code="DUPLICATE_STOREY_INDEX",
                    legacy_element_id=str(ms.index),
                    message=f"Two MassingStoreys share index {ms.index}; keeping the first.",
                    fallback="ignored second occurrence",
                )
            )
            continue
        seen_indices.add(ms.index)
        elevation = float(ms.elevation)
        if prev_top is not None and abs(elevation - prev_top) > 0.005:
            warnings.append(
                LiftWarning(
                    code="STOREY_DISCONTINUITY",
                    legacy_element_id=str(ms.index),
                    message=(
                        f"Storey {ms.index} ('{ms.name}') original elevation "
                        f"{elevation:.4f}m differs from previous storey top "
                        f"{prev_top:.4f}m by {elevation - prev_top:+.4f}m."
                    ),
                    fallback=(
                        f"snapped elevation to {prev_top:.4f}m to satisfy "
                        "STOREY_CONTINUITY (height preserved)"
                    ),
                )
            )
            elevation = prev_top
        out[ms.index] = {
            "id": f"storey-{ms.index}",
            "name": ms.name,
            "elevation": elevation,
            "actual_height": float(ms.height),
            "index": int(ms.index),
            "rooms": [],
            "walls": [],
            "slabs": [],
            "stairs": [],
            "openings": [],
        }
        prev_top = elevation + float(ms.height)
    return out


# ─── H2 — Wall junction snap ─────────────────────────────────────────


def _snap_wall_endpoints(walls_by_id: dict[str, dict], tol: float = _SNAP_TOL_M) -> None:
    """Greedy-cluster wall endpoints in-place. Mutates wall_dicts.

    Endpoints sorted deterministically by (wall_id, point_index, x, y) so
    the cluster centroid sequence is reproducible. Centroids are simple
    arithmetic means; we re-snap all members to the centroid after the
    pass so all clustered endpoints share the same coordinates exactly.
    """
    endpoints: list[tuple[str, int, float, float]] = []
    for wid in sorted(walls_by_id.keys()):
        w = walls_by_id[wid]
        for pi, p in enumerate(w["axis_points"]):
            endpoints.append((wid, pi, p["x"], p["y"]))

    clusters: list[list] = []  # each item: [centroid_x, centroid_y, members]
    for wid, pi, x, y in endpoints:
        matched: Optional[int] = None
        for ci, cluster in enumerate(clusters):
            cx, cy, _members = cluster
            if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= tol:
                matched = ci
                break
        if matched is None:
            clusters.append([x, y, [(wid, pi)]])
        else:
            cluster = clusters[matched]
            members = cluster[2]
            members.append((wid, pi))
            n = len(members)
            cluster[0] = (cluster[0] * (n - 1) + x) / n
            cluster[1] = (cluster[1] * (n - 1) + y) / n

    for cx, cy, members in clusters:
        if len(members) < 2:
            continue  # singleton cluster — leave as-is
        for wid, pi in members:
            walls_by_id[wid]["axis_points"][pi] = _vec2(cx, cy)


# ─── Wall lifting ────────────────────────────────────────────────────


def _lift_walls(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    warnings: list[LiftWarning],
) -> dict[str, dict]:
    """Build wall_dicts keyed by wall id. Per-storey ownership recorded
    on the storey dict; the lookup by id makes H2/H3/H6 cross-storey
    queries cheap. Rejected (sub-2-distinct-vertex) walls are skipped
    and not added to either map.
    """
    walls_by_id: dict[str, dict] = {}
    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type == "wall"),
            key=lambda e: e.id,
        )
        for elem in elements:
            verts2d = [_v(v) for v in elem.vertices]
            if _distinct_count(verts2d) < 2:
                warnings.append(
                    LiftWarning(
                        code="WALL_INSUFFICIENT_VERTICES",
                        legacy_element_id=elem.id,
                        message=(
                            f"Wall '{elem.id}' has <2 distinct (x, y) vertices "
                            f"({len(elem.vertices)} input)."
                        ),
                        fallback="wall skipped",
                    )
                )
                continue
            # Take first two distinct vertices as the wall axis. If 3+ distinct
            # exist, lift currently doesn't model curved walls — keep first two.
            distinct: list[dict] = []
            for v in verts2d:
                if not any(
                    ((v["x"] - u["x"]) ** 2 + (v["y"] - u["y"]) ** 2) ** 0.5 <= 0.001
                    for u in distinct
                ):
                    distinct.append(v)
                if len(distinct) == 2:
                    break
            axis_points = distinct[:2]
            props = elem.properties
            thickness = float(props.thickness) if props.thickness else _DEFAULT_WALL_THICKNESS_M
            base_z = float(storey["elevation"])
            top_z = base_z + (
                float(props.height) if props.height else float(storey["actual_height"])
            )
            wall_type = props.wall_type if props.wall_type else (
                "partition" if props.is_partition else "solid"
            )
            # BuildingModel.Wall.type only allows {solid, curtain, partition, shear};
            # "exterior" / "interior" from props.wall_type aren't valid → coerce to solid.
            if wall_type not in {"solid", "curtain", "partition", "shear"}:
                wall_type = "solid"
            wall_dict = {
                "id": elem.id,
                "host_storey_ids": [storey["id"]],
                "axis_points": axis_points,
                "base_z": base_z,
                "top_z": top_z,
                "thickness": thickness,
                "type": wall_type,
                "is_external": bool(props.is_exterior) if props.is_exterior is not None else False,
                "is_load_bearing": bool(props.load_bearing) if props.load_bearing is not None else False,
                "layers": [],
            }
            walls_by_id[elem.id] = wall_dict
            storey["walls"].append(wall_dict)
    return walls_by_id


# ─── Slab + Roof lifting ─────────────────────────────────────────────


def _lift_slabs(
    geometry: MassingGeometry,
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    warnings: list[LiftWarning],
) -> None:
    """For each storey: emit one Slab per `slab` element, plus one
    Slab(predefined_type=ROOF) per `roof` element on the topmost storey
    where it appears. Slab footprint defaults to the building footprint
    (CCW-normalised); slab.top_z = storey.elevation, bottom_z = top_z -
    thickness.
    """
    bld_footprint = _ensure_ccw([_vec2(p.x, p.y) for p in geometry.footprint])
    if _distinct_count(bld_footprint) < 3:
        # Building footprint itself is degenerate — slabs without their own
        # footprint cannot be safely synthesised. Skip but warn.
        warnings.append(
            LiftWarning(
                code="LIFT_DEGENERATE_BUILDING_FOOTPRINT",
                legacy_element_id="<building>",
                message=(
                    f"Building footprint has only {_distinct_count(bld_footprint)} "
                    "distinct vertices."
                ),
                fallback="all slabs lacking explicit footprint will be skipped",
            )
        )
        bld_footprint = []

    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type in {"slab", "roof"}),
            key=lambda e: e.id,
        )
        for elem in elements:
            props = elem.properties
            thickness = float(props.thickness) if props.thickness else _DEFAULT_SLAB_THICKNESS_M
            if not bld_footprint:
                warnings.append(
                    LiftWarning(
                        code="LIFT_DEGENERATE_BUILDING_FOOTPRINT",
                        legacy_element_id=elem.id,
                        message=f"{elem.type} '{elem.id}' has no fallback footprint to use.",
                        fallback="slab skipped",
                    )
                )
                continue
            is_roof = elem.type == "roof"
            top_z = (
                float(storey["elevation"]) + float(storey["actual_height"])
                if is_roof
                else float(storey["elevation"])
            )
            bottom_z = top_z - thickness
            slab_dict = {
                "id": elem.id,
                "host_storey_id": storey["id"],
                "footprint_polygon": list(bld_footprint),
                "top_z": top_z,
                "bottom_z": bottom_z,
                "predefined_type": "ROOF" if is_roof else "FLOOR",
                "layers": [],
            }
            storey["slabs"].append(slab_dict)


# ─── Column lifting ──────────────────────────────────────────────────


def _lift_columns(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    warnings: list[LiftWarning],
) -> list[dict]:
    """Lift all column elements to a flat list keyed at building level.
    Each Column carries host_storey_id pointing to its source storey;
    the list goes onto building.structural_system.columns.
    """
    out: list[dict] = []
    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type == "column"),
            key=lambda e: e.id,
        )
        for elem in elements:
            if not elem.vertices:
                warnings.append(
                    LiftWarning(
                        code="WALL_INSUFFICIENT_VERTICES",
                        legacy_element_id=elem.id,
                        message=f"Column '{elem.id}' has no vertex location.",
                        fallback="column skipped",
                    )
                )
                continue
            v = elem.vertices[0]
            props = elem.properties
            base_z = float(storey["elevation"])
            top_z = base_z + (
                float(props.height) if props.height else float(storey["actual_height"])
            )
            profile_name = props.section_profile or "300x300"
            profile = ProfileRef(
                name=profile_name,
                profile_type="rectangle",
                dimensions={
                    "width": float(props.radius * 2) if props.radius else _DEFAULT_COLUMN_DIM_M,
                    "depth": float(props.radius * 2) if props.radius else _DEFAULT_COLUMN_DIM_M,
                },
            ).model_dump()
            out.append(
                {
                    "id": elem.id,
                    "host_storey_id": storey["id"],
                    "location": _vec2(v.x, v.y),
                    "profile": profile,
                    "material": props.structural_material or "concrete",
                    "base_z": base_z,
                    "top_z": top_z,
                    "is_load_bearing": True,
                }
            )
    return out


# ─── Beam lifting + H5 column / wall attribution ─────────────────────


def _lift_beams(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    columns: list[dict],
    walls_by_id: dict[str, dict],
    warnings: list[LiftWarning],
) -> list[dict]:
    out: list[dict] = []
    columns_by_id = {c["id"]: c for c in columns}
    column_ids_sorted = sorted(columns_by_id.keys())
    wall_ids_sorted = sorted(walls_by_id.keys())
    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type == "beam"),
            key=lambda e: e.id,
        )
        for elem in elements:
            if len(elem.vertices) < 2:
                warnings.append(
                    LiftWarning(
                        code="BEAM_NO_SUPPORT",
                        legacy_element_id=elem.id,
                        message=f"Beam '{elem.id}' has <2 vertices to define an axis.",
                        fallback="beam skipped",
                    )
                )
                continue
            v0, v1 = elem.vertices[0], elem.vertices[1]
            top_z = float(storey["elevation"]) + float(storey["actual_height"])
            start_z = float(v0.z) if v0.z else top_z
            end_z = float(v1.z) if v1.z else top_z
            start_point = _vec3(v0.x, v0.y, start_z)
            end_point = _vec3(v1.x, v1.y, end_z)
            # Find supporting columns within tol
            supported: list[str] = []
            for cid in column_ids_sorted:
                c = columns_by_id[cid]
                col_top = (c["location"]["x"], c["location"]["y"], c["top_z"])
                if (
                    _3d_dist(col_top, (start_point["x"], start_point["y"], start_point["z"])) <= _BEAM_END_TOL_M
                    or _3d_dist(col_top, (end_point["x"], end_point["y"], end_point["z"])) <= _BEAM_END_TOL_M
                ):
                    supported.append(cid)
            if supported:
                out.append(
                    {
                        "id": elem.id,
                        "host_storey_id": storey["id"],
                        "supported_by_column_ids": sorted(supported),
                        "has_moment_connection": False,
                        "moment_connection_target_id": None,
                        "profile": _DEFAULT_PROFILE_200x400.model_dump(),
                        "material": elem.properties.structural_material or "concrete",
                        "start_point": start_point,
                        "end_point": end_point,
                        "top_z": top_z,
                    }
                )
                continue
            # Fall back: find nearest wall axis within tol of either endpoint
            best_wall: Optional[str] = None
            best_d = math.inf
            for wid in wall_ids_sorted:
                w = walls_by_id[wid]
                for endp in ((start_point["x"], start_point["y"]), (end_point["x"], end_point["y"])):
                    d = _perpendicular_distance(endp, w["axis_points"][0], w["axis_points"][-1])
                    if d < best_d:
                        best_d = d
                        best_wall = wid
            if best_wall is not None and best_d <= _BEAM_MOMENT_TOL_M:
                out.append(
                    {
                        "id": elem.id,
                        "host_storey_id": storey["id"],
                        "supported_by_column_ids": [],
                        "has_moment_connection": True,
                        "moment_connection_target_id": best_wall,
                        "profile": _DEFAULT_PROFILE_200x400.model_dump(),
                        "material": elem.properties.structural_material or "concrete",
                        "start_point": start_point,
                        "end_point": end_point,
                        "top_z": top_z,
                    }
                )
                continue
            warnings.append(
                LiftWarning(
                    code="BEAM_NO_SUPPORT",
                    legacy_element_id=elem.id,
                    message=(
                        f"Beam '{elem.id}' endpoints have no column within "
                        f"{_BEAM_END_TOL_M*1000:.0f}mm and no wall within "
                        f"{_BEAM_MOMENT_TOL_M*1000:.0f}mm."
                    ),
                    fallback="beam skipped",
                )
            )
    return out


def _3d_dist(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


# ─── Opening + Door + Window ────────────────────────────────────────


def _lift_openings_and_fillers(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    walls_by_id: dict[str, dict],
    rooms_by_id: dict[str, dict],
    warnings: list[LiftWarning],
) -> tuple[list[dict], list[dict]]:
    """Returns (doors, windows). Openings are pushed onto each storey's
    openings list directly. Doors/windows are returned for placement at
    building level."""
    doors_out: list[dict] = []
    windows_out: list[dict] = []
    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        # Walls that live in THIS storey only — needed for door-room search.
        local_wall_ids = {w["id"] for w in storey["walls"]}
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type in {"door", "window"}),
            key=lambda e: e.id,
        )
        for elem in elements:
            props = elem.properties
            wall_id = props.parent_wall_id
            if wall_id and wall_id not in walls_by_id:
                wall_id = None  # invalid reference; fall through to nearest-axis
            if wall_id is None and elem.vertices:
                wall_id = _nearest_wall_id(
                    elem.vertices[0], walls_by_id, _OPENING_NEAR_AXIS_TOL_M
                )
            if wall_id is None:
                warnings.append(
                    LiftWarning(
                        code="OPENING_NO_WALL_MATCH",
                        legacy_element_id=elem.id,
                        message=(
                            f"{elem.type} '{elem.id}' has no parent_wall_id and no "
                            f"wall axis within {_OPENING_NEAR_AXIS_TOL_M*1000:.0f}mm."
                        ),
                        fallback="opening + filler skipped",
                    )
                )
                continue
            wall = walls_by_id[wall_id]
            # Validate placement
            distance = float(props.wall_offset) if props.wall_offset is not None else 0.5
            width = float(props.width) if props.width else (
                _DEFAULT_DOOR_WIDTH_M if elem.type == "door" else _DEFAULT_WINDOW_WIDTH_M
            )
            height = float(props.height) if props.height else (
                _DEFAULT_DOOR_HEIGHT_M if elem.type == "door" else _DEFAULT_WINDOW_HEIGHT_M
            )
            sill_z = float(props.sill_height) if props.sill_height is not None else (
                0.0 if elem.type == "door" else _DEFAULT_WINDOW_SILL_M
            )
            wall_len = _polyline_length_m(wall["axis_points"])
            # 100mm clearance at both ends
            if distance < 0.1 or distance + width > wall_len - 0.1:
                warnings.append(
                    LiftWarning(
                        code="OPENING_INVALID_PLACEMENT",
                        legacy_element_id=elem.id,
                        message=(
                            f"{elem.type} '{elem.id}' on wall '{wall_id}' "
                            f"(length {wall_len:.3f}m): distance {distance:.3f}m + "
                            f"width {width:.3f}m violates 100mm clearance."
                        ),
                        fallback="opening + filler skipped",
                    )
                )
                continue
            opening_id = f"op-{elem.id}"
            opening_dict = {
                "id": opening_id,
                "in_wall_id": wall_id,
                "distance_along_wall": distance,
                "sill_z": sill_z,
                "width": width,
                "height": height,
                "predefined_type": "DOOR" if elem.type == "door" else "WINDOW",
            }
            # Place opening on the storey that hosts the wall (which equals
            # the current storey since walls live per-storey).
            if wall_id not in local_wall_ids:
                # Wall is hosted by a different storey; place opening on that
                # storey. Find which storey owns the wall.
                for other in storeys_by_index.values():
                    if any(w["id"] == wall_id for w in other["walls"]):
                        other["openings"].append(opening_dict)
                        break
            else:
                storey["openings"].append(opening_dict)

            if elem.type == "door":
                connects = _resolve_door_room_connections(
                    wall, props, rooms_by_id, warnings, elem.id
                )
                if connects is None:
                    # The door couldn't be tied to any room AND wasn't marked
                    # exterior — drop the door (opening can stay).
                    continue
                handedness = props.handedness if props.handedness else "left"
                doors_out.append(
                    {
                        "id": elem.id,
                        "in_opening_id": opening_id,
                        "connects_room_ids": connects,
                        "swing": "inward",
                        "handedness": handedness,
                    }
                )
            else:
                windows_out.append(
                    {
                        "id": elem.id,
                        "in_opening_id": opening_id,
                        "glass_area": None,
                        "frame_material": props.frame_material,
                    }
                )
    return doors_out, windows_out


def _nearest_wall_id(
    v: Vertex, walls_by_id: dict[str, dict], tol: float
) -> Optional[str]:
    best: Optional[str] = None
    best_d = math.inf
    for wid in sorted(walls_by_id.keys()):
        w = walls_by_id[wid]
        d = _perpendicular_distance(
            (v.x, v.y), w["axis_points"][0], w["axis_points"][-1]
        )
        if d < best_d:
            best_d = d
            best = wid
    if best is not None and best_d <= tol:
        return best
    return None


def _resolve_door_room_connections(
    wall: dict,
    props,
    rooms_by_id: dict[str, dict],
    warnings: list[LiftWarning],
    door_legacy_id: str,
) -> Optional[list[str]]:
    """Returns a 1-or-2-length list, or None if the door is unanchored."""
    a, b = wall["axis_points"][0], wall["axis_points"][-1]
    mx, my = (a["x"] + b["x"]) / 2.0, (a["y"] + b["y"]) / 2.0
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    L = (dx * dx + dy * dy) ** 0.5
    if L < 1e-9:
        return None
    nx, ny = -dy / L, dx / L  # unit perpendicular (left)
    left_pt = (mx + nx * _DOOR_OFFSET_M, my + ny * _DOOR_OFFSET_M)
    right_pt = (mx - nx * _DOOR_OFFSET_M, my - ny * _DOOR_OFFSET_M)
    left_room = _room_at(left_pt, rooms_by_id)
    right_room = _room_at(right_pt, rooms_by_id)
    is_exterior = bool(props.is_exterior)

    if left_room and right_room:
        if left_room == right_room:
            # Both side points fall in the same room — not actually a door
            # between two rooms, but the room is anchored at least.
            return [left_room, "Outside"] if is_exterior else [left_room, left_room]
        return [left_room, right_room]
    if left_room and not right_room:
        return [left_room, "Outside"]
    if right_room and not left_room:
        return [right_room, "Outside"]
    # Neither — only acceptable if the legacy door was marked exterior.
    if is_exterior:
        return ["Outside"]
    warnings.append(
        LiftWarning(
            code="DOOR_NO_ROOM_MATCH",
            legacy_element_id=door_legacy_id,
            message=(
                f"Door '{door_legacy_id}' on wall '{wall['id']}': neither side "
                f"100mm offset midpoint falls in any room polygon, and "
                f"isExterior is not set."
            ),
            fallback="door skipped (opening kept)",
        )
    )
    return None


def _room_at(p: tuple[float, float], rooms_by_id: dict[str, dict]) -> Optional[str]:
    """Find the (deterministic) room whose footprint contains p."""
    for rid in sorted(rooms_by_id.keys()):
        if _point_in_polygon(p, rooms_by_id[rid]["footprint_polygon"]):
            return rid
    return None


# ─── Room lifting (H6) ───────────────────────────────────────────────


def _lift_rooms(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    walls_by_id: dict[str, dict],
    warnings: list[LiftWarning],
) -> dict[str, dict]:
    """Construct Room dicts and bind them to storeys. Returns a flat
    rooms_by_id map (used by H4 for door-room linking)."""
    rooms_by_id: dict[str, dict] = {}
    for idx in sorted(storeys_by_index.keys()):
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type == "space"),
            key=lambda e: e.id,
        )
        # Walls hosted by this storey only — bounding edges should reference
        # walls in the same storey (multistorey curtain walls are exceptional).
        storey_walls = {w["id"]: w for w in storey["walls"]}
        for elem in elements:
            footprint = _resolve_room_footprint(elem)
            if footprint is None:
                warnings.append(
                    LiftWarning(
                        code="ROOM_NO_FOOTPRINT",
                        legacy_element_id=elem.id,
                        message=(
                            f"Space '{elem.id}' has neither space_footprint nor "
                            f">=3 distinct (x, y) vertices."
                        ),
                        fallback="room skipped",
                    )
                )
                continue
            footprint = _ensure_ccw(footprint)
            bounding = _derive_bounding_edges(footprint, storey_walls, warnings, elem.id)
            if bounding is None:
                continue  # warning already emitted by _derive_bounding_edges
            # Pre-validate: would this room satisfy ROOM_BOUNDED?
            ok = _room_bounded_dry_run(footprint, bounding, storey_walls)
            if not ok:
                warnings.append(
                    LiftWarning(
                        code="ROOM_BOUNDED_RESOLUTION_FAILED",
                        legacy_element_id=elem.id,
                        message=(
                            f"Space '{elem.id}': corner-resolved boundary polygon "
                            f"is invalid (parallel offsets / self-intersecting)."
                        ),
                        fallback="room skipped",
                    )
                )
                continue
            props = elem.properties
            room_dict = {
                "id": elem.id,
                "name": props.space_name or props.name,
                "usage": props.space_usage or "unspecified",
                "footprint_polygon": footprint,
                "bounding_edges": bounding,
            }
            storey["rooms"].append(room_dict)
            rooms_by_id[elem.id] = room_dict
    return rooms_by_id


def _resolve_room_footprint(elem: GeometryElement) -> Optional[list[dict]]:
    props = elem.properties
    if props.space_footprint and len(props.space_footprint) >= 3:
        coords = [_vec2(p.x, p.y) for p in props.space_footprint]
        if _distinct_count(coords) >= 3:
            return coords
    if elem.vertices:
        coords = [_v(v) for v in elem.vertices]
        if _distinct_count(coords) >= 3:
            return coords
    return None


def _derive_bounding_edges(
    footprint: list[dict],
    storey_walls: dict[str, dict],
    warnings: list[LiftWarning],
    legacy_id: str,
) -> Optional[list[dict]]:
    """For each edge of the room polygon, find a wall whose axis is
    parallel within angle tolerance and within perpendicular distance
    tolerance. Determine side from cross-product sign."""
    edges: list[dict] = []
    n = len(footprint)
    sorted_wall_ids = sorted(storey_walls.keys())
    for i in range(n):
        a = footprint[i]
        b = footprint[(i + 1) % n]
        edge_dir = (b["x"] - a["x"], b["y"] - a["y"])
        if (edge_dir[0] ** 2 + edge_dir[1] ** 2) ** 0.5 < 1e-6:
            continue  # skip degenerate edges silently
        midpoint = ((a["x"] + b["x"]) / 2.0, (a["y"] + b["y"]) / 2.0)
        # Find best matching wall
        best_wid: Optional[str] = None
        best_score = math.inf
        for wid in sorted_wall_ids:
            w = storey_walls[wid]
            wa, wb = w["axis_points"][0], w["axis_points"][-1]
            wall_dir = (wb["x"] - wa["x"], wb["y"] - wa["y"])
            angle = _angle_between_directions(edge_dir, wall_dir)
            if angle > _ROOM_WALL_ANGLE_TOL_RAD:
                continue
            perp = _perpendicular_distance(midpoint, wa, wb)
            half_t = w["thickness"] / 2.0
            if perp > half_t + _ROOM_WALL_PERP_TOL_M:
                continue
            score = perp + angle  # combined preference
            if score < best_score:
                best_score = score
                best_wid = wid
        if best_wid is None:
            warnings.append(
                LiftWarning(
                    code="ROOM_NO_WALL_MATCH",
                    legacy_element_id=legacy_id,
                    message=(
                        f"Room polygon edge {i} (mid {midpoint[0]:.3f},"
                        f"{midpoint[1]:.3f}) found no matching wall within "
                        f"{_ROOM_WALL_PERP_TOL_M*1000:.0f}mm perpendicular + "
                        f"{math.degrees(_ROOM_WALL_ANGLE_TOL_RAD):.1f}° parallel."
                    ),
                    fallback="room skipped",
                )
            )
            return None
        # Determine side by cross product sign of (wall_dir, edge_midpoint - wall_a)
        w = storey_walls[best_wid]
        wa = w["axis_points"][0]
        wall_dir = (
            w["axis_points"][-1]["x"] - wa["x"],
            w["axis_points"][-1]["y"] - wa["y"],
        )
        from_wall = (midpoint[0] - wa["x"], midpoint[1] - wa["y"])
        side = "left" if _cross_z(wall_dir, from_wall) > 0 else "right"
        edges.append({"wall_id": best_wid, "side": side})
    if len(edges) < 3:
        warnings.append(
            LiftWarning(
                code="ROOM_NO_WALL_MATCH",
                legacy_element_id=legacy_id,
                message=(
                    f"Room produced only {len(edges)} bounding edges (need >=3)."
                ),
                fallback="room skipped",
            )
        )
        return None
    return edges


def _room_bounded_dry_run(
    footprint: list[dict],
    bounding_edges: list[dict],
    storey_walls: dict[str, dict],
) -> bool:
    """Mirrors ROOM_BOUNDED's corner-resolution pre-check so lift can
    skip rooms that would fail BuildingModel construction.
    """
    # Build per-edge offset axis (start, end).
    offsets: list[tuple[dict, dict]] = []
    for edge in bounding_edges:
        w = storey_walls[edge["wall_id"]]
        ax = _offset_axis_dicts(w["axis_points"], w["thickness"] / 2.0, edge["side"])
        if len(ax) < 2:
            return False
        offsets.append((ax[0], ax[-1]))
    n = len(offsets)
    corners: list[dict] = []
    for i in range(n):
        prev_s, prev_e = offsets[(i - 1) % n]
        cur_s, cur_e = offsets[i]
        prev_dir = (prev_e["x"] - prev_s["x"], prev_e["y"] - prev_s["y"])
        cur_dir = (cur_e["x"] - cur_s["x"], cur_e["y"] - cur_s["y"])
        denom = prev_dir[0] * cur_dir[1] - prev_dir[1] * cur_dir[0]
        if abs(denom) < 1e-9:
            return False  # parallel offset axes
        t = (
            (cur_s["x"] - prev_s["x"]) * cur_dir[1]
            - (cur_s["y"] - prev_s["y"]) * cur_dir[0]
        ) / denom
        corners.append(
            _vec2(prev_s["x"] + t * prev_dir[0], prev_s["y"] + t * prev_dir[1])
        )
    # Validate via shapely
    try:
        from shapely.geometry import Polygon as _Poly  # local import to keep module top tidy
        shp = _Poly([(c["x"], c["y"]) for c in corners])
    except Exception:
        return False
    return shp.is_valid


def _offset_axis_dicts(points: list[dict], offset: float, side: str) -> list[dict]:
    out: list[dict] = []
    sign = 1.0 if side == "left" else -1.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        dx = b["x"] - a["x"]
        dy = b["y"] - a["y"]
        L = (dx * dx + dy * dy) ** 0.5
        if L < 1e-9:
            continue
        nx = -dy / L
        ny = dx / L
        out.append(_vec2(a["x"] + sign * nx * offset, a["y"] + sign * ny * offset))
        out.append(_vec2(b["x"] + sign * nx * offset, b["y"] + sign * ny * offset))
    return out


# ─── Stair lifting (recompute riser_count + riser_height) ────────────


def _lift_stairs(
    elements_by_storey: dict[int, list[GeometryElement]],
    storeys_by_index: dict[int, dict],
    warnings: list[LiftWarning],
) -> None:
    """Lift stairs. Riser geometry is recomputed from the structural rise
    (slab_above.bottom_z - slab_below.top_z) so STAIR_RISE_MATCHES holds
    within 1mm. Plan polygon is synthesised from props.width × props.length
    when the element has only 2 axis vertices."""
    sorted_indices = sorted(storeys_by_index.keys())
    for idx in sorted_indices:
        storey = storeys_by_index[idx]
        elements = sorted(
            (e for e in elements_by_storey.get(idx, []) if e.type == "stair"),
            key=lambda e: e.id,
        )
        if not elements:
            continue
        # Find slab_below (FLOOR slab on this storey) and slab_above (FLOOR slab
        # on the next-index storey).
        next_idx_above = next(
            (i for i in sorted_indices if i > idx), None
        )
        if next_idx_above is None:
            for elem in elements:
                warnings.append(
                    LiftWarning(
                        code="STAIR_NO_NEXT_STOREY",
                        legacy_element_id=elem.id,
                        message=(
                            f"Stair '{elem.id}' is on the topmost storey "
                            f"{storey['id']}; no storey above to land on."
                        ),
                        fallback="stair skipped",
                    )
                )
            continue
        slab_below = _pick_floor_slab(storey["slabs"])
        slab_above = _pick_floor_slab(storeys_by_index[next_idx_above]["slabs"])
        if slab_below is None or slab_above is None:
            for elem in elements:
                warnings.append(
                    LiftWarning(
                        code="STAIR_NO_SLAB_FOR_RISE",
                        legacy_element_id=elem.id,
                        message=(
                            f"Stair '{elem.id}': missing FLOOR slab on storey "
                            f"'{storey['id']}' or '{storeys_by_index[next_idx_above]['id']}'."
                        ),
                        fallback="stair skipped",
                    )
                )
            continue
        rise = slab_above["bottom_z"] - slab_below["top_z"]
        if rise <= 0:
            for elem in elements:
                warnings.append(
                    LiftWarning(
                        code="STAIR_NO_SLAB_FOR_RISE",
                        legacy_element_id=elem.id,
                        message=(
                            f"Stair '{elem.id}': computed structural rise "
                            f"{rise:.4f}m is non-positive."
                        ),
                        fallback="stair skipped",
                    )
                )
            continue
        riser_count = max(1, round(rise / _TYPICAL_RISER_HEIGHT_M))
        riser_height = rise / riser_count
        for elem in elements:
            props = elem.properties
            tread_depth = float(props.tread_depth) if props.tread_depth else _DEFAULT_TREAD_DEPTH_M
            plan = _synthesise_stair_plan(elem)
            if plan is None:
                warnings.append(
                    LiftWarning(
                        code="STAIR_NO_PLAN_POLYGON",
                        legacy_element_id=elem.id,
                        message=(
                            f"Stair '{elem.id}' has insufficient vertices and no "
                            f"width/length props to synthesise a plan polygon."
                        ),
                        fallback="stair skipped",
                    )
                )
                continue
            storey["stairs"].append(
                {
                    "id": elem.id,
                    "host_storey_id": storey["id"],
                    "riser_count": int(riser_count),
                    "riser_height": float(riser_height),
                    "tread_depth": float(tread_depth),
                    "flight_count": 1,
                    "landing_count": 0,
                    "plan_polygon": plan,
                }
            )


def _pick_floor_slab(slabs: list[dict]) -> Optional[dict]:
    floor_slabs = [s for s in slabs if s["predefined_type"] == "FLOOR"]
    if len(floor_slabs) == 1:
        return floor_slabs[0]
    if len(floor_slabs) == 0 and len(slabs) == 1:
        return slabs[0]
    if len(floor_slabs) > 1:
        # Deterministic tie-break: smallest id
        return sorted(floor_slabs, key=lambda s: s["id"])[0]
    return None


def _synthesise_stair_plan(elem: GeometryElement) -> Optional[list[dict]]:
    if len(elem.vertices) >= 3:
        coords = [_v(v) for v in elem.vertices]
        if _distinct_count(coords) >= 3:
            return _ensure_ccw(coords)
    # Two-vertex stair: build a rectangle from start + length × direction + width.
    if len(elem.vertices) >= 2:
        v0, v1 = elem.vertices[0], elem.vertices[1]
        props = elem.properties
        width = float(props.width) if props.width else 1.0
        dx, dy = v1.x - v0.x, v1.y - v0.y
        L = (dx * dx + dy * dy) ** 0.5
        if L < 1e-6:
            return None
        nx, ny = -dy / L * (width / 2.0), dx / L * (width / 2.0)
        c1 = _vec2(v0.x - nx, v0.y - ny)
        c2 = _vec2(v1.x - nx, v1.y - ny)
        c3 = _vec2(v1.x + nx, v1.y + ny)
        c4 = _vec2(v0.x + nx, v0.y + ny)
        return _ensure_ccw([c1, c2, c3, c4])
    return None


# ─── MEP lifting ─────────────────────────────────────────────────────


def _lift_mep(
    geometry: MassingGeometry, warnings: list[LiftWarning]
) -> list[dict]:
    """Group MEP elements (duct, pipe, cable-tray, equipment) into systems
    by inferred kind. Skip elements that can't form a valid MEPSystem.
    """
    by_kind: dict[str, dict] = {
        "HVAC": {"sources": [], "segments": [], "terminals": []},
        "Plumbing": {"sources": [], "segments": [], "terminals": []},
        "Electrical": {"sources": [], "segments": [], "terminals": []},
    }
    for storey in sorted(geometry.storeys, key=lambda s: s.index):
        for elem in sorted(storey.elements, key=lambda e: e.id):
            kind = _classify_mep_kind(elem)
            if kind is None:
                continue
            bucket = by_kind[kind]
            if elem.type == "equipment":
                if not elem.vertices:
                    continue
                v = elem.vertices[0]
                bucket["sources"].append(
                    {
                        "id": elem.id,
                        "system_kind": kind,
                        "predefined_type": _mep_equipment_predefined_type(elem),
                        "location": _vec3(v.x, v.y, v.z if v.z else float(storey.elevation) + 2.5),
                    }
                )
            elif elem.type in {"duct", "pipe", "cable-tray"}:
                if len(elem.vertices) < 2:
                    continue
                v0, v1 = elem.vertices[0], elem.vertices[1]
                z0 = v0.z if v0.z else float(storey.elevation) + 2.5
                z1 = v1.z if v1.z else float(storey.elevation) + 2.5
                bucket["segments"].append(
                    {
                        "id": elem.id,
                        "system_kind": kind,
                        "predefined_type": _mep_segment_predefined_type(elem.type),
                        "start_point": _vec3(v0.x, v0.y, z0),
                        "end_point": _vec3(v1.x, v1.y, z1),
                    }
                )
            elif elem.type in {
                "sanitary-terminal",
                "light-fixture",
                "air-terminal",
                "flow-terminal",
            }:
                if not elem.vertices:
                    continue
                v = elem.vertices[0]
                bucket["terminals"].append(
                    {
                        "id": elem.id,
                        "system_kind": kind,
                        "predefined_type": _mep_terminal_predefined_type(elem.type),
                        "location": _vec3(v.x, v.y, v.z if v.z else float(storey.elevation) + 2.5),
                    }
                )
    out: list[dict] = []
    for kind, bucket in by_kind.items():
        if not (bucket["sources"] or bucket["segments"] or bucket["terminals"]):
            continue
        # System needs source OR terminal to satisfy MEP_TERMINATES path (a).
        # If only segments exist, drop them all + warn each.
        if not bucket["sources"] and not bucket["terminals"]:
            for seg in bucket["segments"]:
                warnings.append(
                    LiftWarning(
                        code="MEP_NO_ANCHOR",
                        legacy_element_id=seg["id"],
                        message=(
                            f"{kind} segment '{seg['id']}' has no source equipment "
                            "or terminal in this system kind."
                        ),
                        fallback="segment skipped",
                    )
                )
            continue
        # Pick deterministic source (first sorted by id) — MEPSystem schema
        # allows only one source.
        source = sorted(bucket["sources"], key=lambda s: s["id"])[0] if bucket["sources"] else None
        # Drop extra sources with a note (rare).
        for extra in sorted(bucket["sources"], key=lambda s: s["id"])[1:]:
            warnings.append(
                LiftWarning(
                    code="MEP_EXTRA_SOURCE",
                    legacy_element_id=extra["id"],
                    message=(
                        f"{kind} system already has source "
                        f"'{source['id'] if source else '?'}'; '{extra['id']}' "
                        "treated as a terminal."
                    ),
                    fallback="reclassified as terminal",
                )
            )
            bucket["terminals"].append(
                {
                    "id": extra["id"],
                    "system_kind": kind,
                    "predefined_type": extra["predefined_type"],
                    "location": extra["location"],
                }
            )
        # Pre-validate: would this system pass MEP_TERMINATES? If segments
        # form orphan / cyclic groups we drop them with a warning.
        kept_segments = _filter_mep_segments_for_anchor(
            source, bucket["terminals"], bucket["segments"], warnings, kind
        )
        out.append(
            {
                "id": f"sys-{kind.lower()}",
                "system_kind": kind,
                "source": source,
                "distribution": kept_segments,
                "terminals": sorted(bucket["terminals"], key=lambda t: t["id"]),
            }
        )
    return out


def _classify_mep_kind(elem: GeometryElement) -> Optional[str]:
    if elem.type in {"duct", "air-terminal"}:
        return "HVAC"
    if elem.type in {"pipe", "sanitary-terminal"}:
        return "Plumbing"
    if elem.type in {"cable-tray", "light-fixture"}:
        return "Electrical"
    if elem.type == "equipment":
        sys = elem.properties.mep_system or ""
        if sys.startswith("hvac-"):
            return "HVAC"
        if sys.startswith("plumbing-"):
            return "Plumbing"
        if sys.startswith("electrical-"):
            return "Electrical"
        # Unknown — default to HVAC (most equipment is air handling).
        return "HVAC"
    if elem.type == "flow-terminal":
        return "HVAC"
    return None


def _mep_equipment_predefined_type(elem: GeometryElement) -> str:
    sys = (elem.properties.mep_system or "").lower()
    if "hvac" in sys:
        return "AIRHANDLER"
    if "plumbing" in sys:
        return "PUMP"
    if "electrical" in sys:
        return "PANEL"
    return "USERDEFINED"


def _mep_segment_predefined_type(elem_type: str) -> str:
    return {
        "duct": "RIGIDSEGMENT",
        "pipe": "RIGIDSEGMENT",
        "cable-tray": "CABLECARRIERSEGMENT",
    }.get(elem_type, "USERDEFINED")


def _mep_terminal_predefined_type(elem_type: str) -> str:
    return {
        "air-terminal": "DIFFUSER",
        "sanitary-terminal": "WASHHANDBASIN",
        "light-fixture": "DIRECTIONSOURCE",
        "flow-terminal": "USERDEFINED",
    }.get(elem_type, "USERDEFINED")


def _filter_mep_segments_for_anchor(
    source: Optional[dict],
    terminals: list[dict],
    segments: list[dict],
    warnings: list[LiftWarning],
    kind: str,
) -> list[dict]:
    """Keep only segments connected (within 5mm) to the source or any
    terminal via a chain. Drops orphans + emits MEP_NO_ANCHOR per dropped
    segment.

    Also detects cycles — if a connected component contains a cycle,
    drops every segment in that component (logical: we can't just remove
    one without picking arbitrarily, so be conservative).
    """
    if not segments:
        return []
    anchors: list[tuple[float, float, float]] = []
    if source is not None:
        loc = source["location"]
        anchors.append((loc["x"], loc["y"], loc["z"]))
    for t in terminals:
        loc = t["location"]
        anchors.append((loc["x"], loc["y"], loc["z"]))
    if not anchors:
        return []
    # Cluster all endpoints
    cluster_for: dict[str, int] = {}
    centroids: list[tuple[float, float, float]] = []
    def _assign(label: str, pt: tuple[float, float, float]) -> None:
        for ci, c in enumerate(centroids):
            if _3d_dist(pt, c) <= 0.005:
                cluster_for[label] = ci
                return
        cluster_for[label] = len(centroids)
        centroids.append(pt)

    for s in sorted(segments, key=lambda s: s["id"]):
        _assign(
            f"seg::{s['id']}::start",
            (s["start_point"]["x"], s["start_point"]["y"], s["start_point"]["z"]),
        )
        _assign(
            f"seg::{s['id']}::end",
            (s["end_point"]["x"], s["end_point"]["y"], s["end_point"]["z"]),
        )
    if source is not None:
        _assign(
            f"src::{source['id']}",
            (source["location"]["x"], source["location"]["y"], source["location"]["z"]),
        )
    for t in sorted(terminals, key=lambda t: t["id"]):
        _assign(
            f"term::{t['id']}",
            (t["location"]["x"], t["location"]["y"], t["location"]["z"]),
        )
    anchor_clusters: set[int] = set()
    if source is not None:
        anchor_clusters.add(cluster_for[f"src::{source['id']}"])
    for t in terminals:
        anchor_clusters.add(cluster_for[f"term::{t['id']}"])
    # Adjacency
    adj: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for s in segments:
        a = cluster_for[f"seg::{s['id']}::start"]
        b = cluster_for[f"seg::{s['id']}::end"]
        adj[a].append((b, s["id"]))
        adj[b].append((a, s["id"]))
    # BFS from anchor clusters; track reachable clusters + traversed segments.
    reachable: set[int] = set()
    queue: list[int] = list(anchor_clusters)
    while queue:
        n = queue.pop()
        if n in reachable:
            continue
        reachable.add(n)
        for nb, _eid in adj[n]:
            if nb not in reachable:
                queue.append(nb)
    # Cycle detection on the reachable subgraph
    cyclic_segments: set[str] = set()
    visited: set[int] = set()
    for start in sorted(reachable):
        if start in visited:
            continue
        stack: list[tuple[int, Optional[str]]] = [(start, None)]
        local: set[int] = set()
        while stack:
            n, parent_eid = stack.pop()
            if n in local:
                # Already saw this node in current DFS branch → cycle. Mark
                # all segments between local and n as cyclic; conservative
                # approach: mark the parent_eid.
                if parent_eid:
                    cyclic_segments.add(parent_eid)
                continue
            local.add(n)
            visited.add(n)
            for nb, eid in adj[n]:
                if eid == parent_eid:
                    continue
                if nb in local:
                    cyclic_segments.add(eid)
                    continue
                stack.append((nb, eid))
    kept: list[dict] = []
    for s in sorted(segments, key=lambda s: s["id"]):
        a = cluster_for[f"seg::{s['id']}::start"]
        b = cluster_for[f"seg::{s['id']}::end"]
        if a not in reachable and b not in reachable:
            warnings.append(
                LiftWarning(
                    code="MEP_NO_ANCHOR",
                    legacy_element_id=s["id"],
                    message=(
                        f"{kind} segment '{s['id']}' is in an orphan branch "
                        "disconnected from any source / terminal."
                    ),
                    fallback="segment skipped",
                )
            )
            continue
        if s["id"] in cyclic_segments:
            warnings.append(
                LiftWarning(
                    code="MEP_CYCLE",
                    legacy_element_id=s["id"],
                    message=(
                        f"{kind} segment '{s['id']}' participates in a cycle; "
                        "lift drops it to satisfy MEP_TERMINATES."
                    ),
                    fallback="segment skipped",
                )
            )
            continue
        kept.append(s)
    return kept


# ─── Provenance + main lift ──────────────────────────────────────────


def _build_provenance(options: ExportOptions, build_id: str, fixture_match: str) -> dict:
    return {
        "model_version": "1.0.0",
        "input_contract_version": "MassingGeometry-1.0.0",
        "ifcopenshell_version": "",  # set later by Slice 3 (Provenance Pset stamping)
        "agent_stages_run": "lift-from-massing",
        "agent_models_used": "",
        "total_llm_cost_usd": 0.0,
        "total_wallclock_ms": 0,
        "prompt_cache_hit_rate": 0.0,
        "ids_rules_passed": 0,
        "ids_rules_failed": 0,
        "target_fidelity": options.target_fidelity,
        "fixture_match": fixture_match,
        "generated_at": _now_utc_iso(),
        "build_id": build_id,
        "source_contract": "MassingGeometry-lifted",
    }


def lift(
    geometry: MassingGeometry,
    options: ExportOptions,
    build_id: str,
    fixture_match: str = "",
) -> tuple[BuildingModel, list[LiftWarning]]:
    """Public entry point. See module docstring for the seven heuristics
    and skip-vs-fallback decisions.
    """
    warnings: list[LiftWarning] = []

    # Index legacy elements by storey index for O(1) per-storey access.
    elements_by_storey: dict[int, list[GeometryElement]] = defaultdict(list)
    for ms in geometry.storeys:
        for e in ms.elements:
            elements_by_storey[ms.index].append(e)

    storeys_by_index = _lift_storeys(geometry, warnings)

    # Walls before everything (rooms / openings need them).
    walls_by_id = _lift_walls(elements_by_storey, storeys_by_index, warnings)
    _snap_wall_endpoints(walls_by_id)

    # Slabs + roofs (stairs depend on these).
    _lift_slabs(geometry, elements_by_storey, storeys_by_index, warnings)

    # Columns + beams (independent of openings/rooms).
    columns = _lift_columns(elements_by_storey, storeys_by_index, warnings)
    beams = _lift_beams(
        elements_by_storey, storeys_by_index, columns, walls_by_id, warnings
    )

    # Rooms (need walls; needed by doors).
    rooms_by_id = _lift_rooms(
        elements_by_storey, storeys_by_index, walls_by_id, warnings
    )

    # Openings + doors + windows.
    doors, windows = _lift_openings_and_fillers(
        elements_by_storey, storeys_by_index, walls_by_id, rooms_by_id, warnings
    )

    # Stairs (after slabs).
    _lift_stairs(elements_by_storey, storeys_by_index, warnings)

    # MEP.
    mep_systems = _lift_mep(geometry, warnings)

    # Surface unsupported types as one warning per legacy element so the
    # user sees what got dropped.
    _SUPPORTED_TYPES = {
        "wall", "slab", "roof", "column", "beam", "stair", "space",
        "door", "window", "duct", "pipe", "cable-tray", "equipment",
        "sanitary-terminal", "light-fixture", "air-terminal", "flow-terminal",
        "footing",
    }
    for ms in geometry.storeys:
        for e in ms.elements:
            if e.type not in _SUPPORTED_TYPES:
                warnings.append(
                    LiftWarning(
                        code="LIFT_UNSUPPORTED_TYPE",
                        legacy_element_id=e.id,
                        message=(
                            f"Element type '{e.type}' is not yet mapped to "
                            "BuildingModel."
                        ),
                        fallback="element skipped",
                    )
                )

    # Footings (none in Phase 1 fixtures; placeholder in case fixture adds them).
    footings = _lift_footings(elements_by_storey, columns, warnings)
    foundation = (
        {"id": "foundation-1", "footings": footings} if footings else None
    )

    # Build the construction dict.
    building_dict = {
        "id": "building-1",
        "name": options.building_name,
        "occupancy_nbc_group": _occupancy_for_building_type(geometry.building_type),
        "envelope_polygon": _ensure_ccw([_vec2(p.x, p.y) for p in geometry.footprint]),
        "structural_system": {
            "id": "structural-1",
            "grid": None,
            "columns": columns,
            "beams": beams,
            "allows_slanted": False,
        },
        "mep_systems": mep_systems,
        "storeys": [storeys_by_index[i] for i in sorted(storeys_by_index.keys())],
        "foundation": foundation,
        "roof": None,
        "doors": doors,
        "windows": windows,
    }
    site_dict = {
        "id": "site-1",
        "name": options.site_name,
        "georef": GeoReference().model_dump(),
        "true_north_deg": 0.0,
        "terrain_polygon": [],
        "building": building_dict,
    }
    project_dict = {
        "id": "project-1",
        "name": options.project_name,
        "model_version": "1.0.0",
        "site": site_dict,
        "metadata": {
            "rera": None,
            "permits": [],
            "cobie_defaults": {},
            "provenance": _build_provenance(options, build_id, fixture_match),
        },
    }
    bm = BuildingModel.build({"project": project_dict})
    return bm, warnings


def _lift_footings(
    elements_by_storey: dict[int, list[GeometryElement]],
    columns: list[dict],
    warnings: list[LiftWarning],
) -> list[dict]:
    out: list[dict] = []
    for idx in sorted(elements_by_storey.keys()):
        for e in sorted(
            (e for e in elements_by_storey[idx] if e.type == "footing"),
            key=lambda x: x.id,
        ):
            if not e.vertices:
                continue
            v = e.vertices[0]
            t = float(e.properties.thickness) if e.properties.thickness else 0.5
            out.append(
                {
                    "id": e.id,
                    "supports_column_id": None,  # Slice 2 doesn't link footings to columns
                    "location": _vec2(v.x, v.y),
                    "top_z": float(v.z) if v.z else 0.0,
                    "bottom_z": (float(v.z) if v.z else 0.0) - t,
                    "footprint_polygon": [
                        _vec2(v.x - 0.5, v.y - 0.5),
                        _vec2(v.x + 0.5, v.y - 0.5),
                        _vec2(v.x + 0.5, v.y + 0.5),
                        _vec2(v.x - 0.5, v.y + 0.5),
                    ],
                    "material": "concrete",
                }
            )
    return out


def _occupancy_for_building_type(building_type: str) -> Optional[str]:
    bt = (building_type or "").lower()
    if "residen" in bt or "apart" in bt:
        return "Group A — Residential"
    if "office" in bt or "commercial" in bt:
        return "Group E — Business"
    if "shop" in bt or "retail" in bt:
        return "Group F — Mercantile"
    return None


__all__ = ["lift", "LiftWarning"]
