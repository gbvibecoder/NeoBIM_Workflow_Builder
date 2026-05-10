"""Slice T2.0.4.A diagnostic — measure stair-flight clearance to shaft walls.

Walks an exported IFC4 tower file, finds every IfcStairFlight + every
nearby IfcWall, and computes per-axis clearance between their world-
space bounding boxes. Surfaces collisions (clearance < 100 mm) so the
fix in stair_builder.py can be verified to address the right walls.

Output goes to stdout; the script makes NO modifications. Optionally
takes a single positional arg for the IFC path; defaults to the 3BHK
G+5 tower export Govind already inspected.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent.parent
sys.path.insert(0, str(_SCRIPT_DIR.parent))

import ifcopenshell  # noqa: E402
import ifcopenshell.geom  # noqa: E402


_DEFAULT_IFC = _REPO_ROOT / "temp_folder" / "tier2_3bhk_pune_tower_g5.ifc"
_COLLISION_THRESHOLD_MM: int = 100  # walls within 100 mm flagged as collisions
_NEIGHBOUR_RADIUS_M: float = 5.0  # only walls within 5 m of a flight reported


def _bbox(shape) -> tuple[float, float, float, float, float, float] | None:
    verts = shape.geometry.verts
    if not verts:
        return None
    xs = verts[0::3]
    ys = verts[1::3]
    zs = verts[2::3]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def _world_bbox(entity, settings) -> tuple | None:
    try:
        shape = ifcopenshell.geom.create_shape(settings, entity)
    except Exception:
        return None
    return _bbox(shape)


def _bbox_separation(a: tuple, b: tuple) -> tuple[float, float, float, float]:
    """Return (gap_x, gap_y, gap_z, gap_min) between two bboxes.

    Gap is positive when boxes don't overlap on that axis (the shortest
    distance between them on that axis); zero when they touch; negative
    when they overlap (penetration depth).
    """
    a_xmin, a_ymin, a_zmin, a_xmax, a_ymax, a_zmax = a
    b_xmin, b_ymin, b_zmin, b_xmax, b_ymax, b_zmax = b

    def axis_gap(amin, amax, bmin, bmax):
        if amax < bmin:
            return bmin - amax
        if bmax < amin:
            return amin - bmax
        return -(min(amax, bmax) - max(amin, bmin))  # negative = overlap

    gx = axis_gap(a_xmin, a_xmax, b_xmin, b_xmax)
    gy = axis_gap(a_ymin, a_ymax, b_ymin, b_ymax)
    gz = axis_gap(a_zmin, a_zmax, b_zmin, b_zmax)

    # Minimum lateral clearance — relevant for floor-plan collisions.
    # Two boxes that overlap on Z (same storey) but are spaced laterally
    # have a horizontal gap that's the max of (gx, gy); we want the
    # MIN positive lateral component to flag tight clearance.
    horiz = max(gx, gy)  # if horiz > 0, boxes are separated laterally
    return gx, gy, gz, horiz


def _bbox_distance_xy(a: tuple, b: tuple) -> float:
    """2-D (XY-plane) Euclidean distance between two bboxes — 0 when
    they overlap or touch laterally. Used for the "is this wall near
    the flight at all?" filter."""
    a_xmin, a_ymin, _, a_xmax, a_ymax, _ = a
    b_xmin, b_ymin, _, b_xmax, b_ymax, _ = b
    dx = max(0.0, max(b_xmin - a_xmax, a_xmin - b_xmax))
    dy = max(0.0, max(b_ymin - a_ymax, a_ymin - b_ymax))
    return (dx * dx + dy * dy) ** 0.5


def main() -> int:
    ifc_path = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_IFC
    if not ifc_path.exists():
        print(f"ERROR: {ifc_path} not found.")
        print("Run the tower export script first, e.g.:")
        print(f"  python -m scripts.export_3bhk_pune_to_ifc")
        return 1

    print(f"Loading {ifc_path} ({ifc_path.stat().st_size:,} bytes)")
    model = ifcopenshell.open(str(ifc_path))
    print(f"ifcopenshell version: {ifcopenshell.version}, schema: {model.schema}")

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    flights = model.by_type("IfcStairFlight")
    walls = model.by_type("IfcWall")
    print(f"\nIfcStairFlight: {len(flights)} entity(ies)")
    print(f"IfcWall:        {len(walls)} entity(ies)")
    print(f"Collision threshold: {_COLLISION_THRESHOLD_MM} mm")
    print(f"Neighbour radius:    {_NEIGHBOUR_RADIUS_M} m")

    if not flights:
        print("\nNo stair flights found in IFC. Diagnostic aborted.")
        return 1

    # Pre-compute bboxes for all walls (one expensive pass).
    print("\nComputing world bbox for every IfcWall...", flush=True)
    wall_bboxes: list[tuple] = []
    skipped = 0
    for w in walls:
        bb = _world_bbox(w, settings)
        if bb is None:
            skipped += 1
            continue
        wall_bboxes.append((w, bb))
    print(f"  resolved bbox for {len(wall_bboxes)}/{len(walls)} walls "
          f"(skipped {skipped})")

    # Per stair flight: find walls within neighbour radius; flag tight ones.
    total_collisions = 0
    print()
    print("=" * 78)
    print("Per-flight clearance report")
    print("=" * 78)
    for i, flight in enumerate(flights):
        bb = _world_bbox(flight, settings)
        if bb is None:
            print(f"\n[{i}] {flight.Name or flight.GlobalId}: NO GEOMETRY")
            continue
        x0, y0, z0, x1, y1, z1 = bb
        print(f"\n[{i}] {flight.Name or flight.GlobalId}")
        print(f"     bbox: ({x0:.3f}, {y0:.3f}, {z0:.3f}) → "
              f"({x1:.3f}, {y1:.3f}, {z1:.3f})  size "
              f"{x1-x0:.3f} × {y1-y0:.3f} × {z1-z0:.3f}")

        nearby: list[tuple[object, tuple, float, float, float, float]] = []
        for w, wbb in wall_bboxes:
            d_xy = _bbox_distance_xy(bb, wbb)
            if d_xy > _NEIGHBOUR_RADIUS_M:
                continue
            gx, gy, gz, gh = _bbox_separation(bb, wbb)
            # Skip walls that don't overlap the flight in Z (i.e. on a
            # different storey) — gz > 0.5m means the wall sits well
            # above or below the flight's vertical span.
            if gz > 0.5:
                continue
            nearby.append((w, wbb, gx, gy, gz, gh))

        nearby.sort(key=lambda t: t[5])  # sort by horizontal gap
        if not nearby:
            print("     no walls within neighbour radius — flight is isolated")
            continue

        for w, wbb, gx, gy, gz, gh in nearby[:6]:
            wx0, wy0, wz0, wx1, wy1, wz1 = wbb
            tag = "✗ COLLISION" if gh * 1000 < _COLLISION_THRESHOLD_MM else "  ok"
            wall_name = w.Name or w.GlobalId[:8]
            print(f"     {tag}: {wall_name:30s}  "
                  f"gap_x={gx*1000:+8.1f}mm  gap_y={gy*1000:+8.1f}mm  "
                  f"horiz={gh*1000:+8.1f}mm")
            if gh * 1000 < _COLLISION_THRESHOLD_MM:
                total_collisions += 1

    print()
    print("=" * 78)
    print(f"SUMMARY: {total_collisions} (flight, wall) pair(s) below "
          f"{_COLLISION_THRESHOLD_MM} mm clearance")
    print("=" * 78)
    return 0 if total_collisions == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
