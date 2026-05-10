"""Slice T2.0.4.B diagnostic — audit lift visual correctness.

Walks an exported tower IFC4 file and reports the current state of the
lift representation:

  1. How many IfcTransportElement entities exist (target: 1 per
     habitable + stilt + roof storey; current pre-fix: 0).
  2. For each "Lift Shaft" IfcSpace, list its bounding walls (walls
     overlapping the space's footprint on Z) — confirms the shaft's
     4-wall enclosure.
  3. For every IfcDoor whose Name encodes a connection to a lift
     shaft, report its OperationType — pre-fix this is one of
     `SINGLE_SWING_*` (a swing door); target is `SLIDING_TO_LEFT`
     (semantically a lift door).

Output goes to stdout; no IFC modifications. Optionally takes the
IFC path as positional arg; defaults to the 3BHK G+5 tower export.
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


def _bbox(shape) -> tuple | None:
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


def _bbox_overlap_xy(a: tuple, b: tuple) -> float:
    """XY-area overlap (m²) between two bboxes — 0 if disjoint."""
    ax0, ay0, _, ax1, ay1, _ = a
    bx0, by0, _, bx1, by1, _ = b
    ow = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    oh = max(0.0, min(ay1, by1) - max(ay0, by0))
    return ow * oh


def _bbox_distance_xy(a: tuple, b: tuple) -> float:
    ax0, ay0, _, ax1, ay1, _ = a
    bx0, by0, _, bx1, by1, _ = b
    dx = max(0.0, max(b[0] - a[3], a[0] - b[3]))
    dy = max(0.0, max(b[1] - a[4], a[1] - b[4]))
    return (dx * dx + dy * dy) ** 0.5


def main() -> int:
    ifc_path = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_IFC
    if not ifc_path.exists():
        print(f"ERROR: {ifc_path} not found.")
        return 1
    print(f"Loading {ifc_path} ({ifc_path.stat().st_size:,} bytes)")
    model = ifcopenshell.open(str(ifc_path))
    print(f"ifcopenshell version: {ifcopenshell.version}, schema: {model.schema}")

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    # ─── (1) IfcTransportElement inventory ───────────────────────────
    transport_elements = model.by_type("IfcTransportElement")
    print(f"\nIfcTransportElement: {len(transport_elements)} entity(ies)  "
          f"[target post-fix: ≥1 per tower storey]")
    for t in transport_elements:
        ptype = getattr(t, "PredefinedType", "?")
        print(f"  - {t.Name or t.GlobalId[:8]}  PredefinedType={ptype}")

    # ─── (2) Lift shaft IfcSpace inventory ───────────────────────────
    spaces = model.by_type("IfcSpace")
    lift_shafts = [s for s in spaces if s.Name and "Lift" in s.Name]
    print(f"\nLift-shaft IfcSpace: {len(lift_shafts)} entity(ies)")
    if not lift_shafts:
        print("  (no Lift-named spaces — non-tower template? exiting)")
        return 0

    walls = model.by_type("IfcWall")
    print(f"IfcWall total: {len(walls)} entity(ies)")

    # Pre-compute wall bboxes (single expensive pass).
    print("\nComputing world bbox for every IfcWall...", flush=True)
    wall_bboxes: list[tuple] = []
    for w in walls:
        bb = _world_bbox(w, settings)
        if bb is not None:
            wall_bboxes.append((w, bb))
    print(f"  resolved bbox for {len(wall_bboxes)}/{len(walls)} walls")

    print()
    print("=" * 78)
    print("Per-lift-shaft inventory")
    print("=" * 78)
    for shaft in lift_shafts:
        sbb = _world_bbox(shaft, settings)
        if sbb is None:
            print(f"\n[?] {shaft.Name}: NO GEOMETRY")
            continue
        x0, y0, z0, x1, y1, z1 = sbb
        print(f"\n[{shaft.Name}]")
        print(f"   bbox: ({x0:.3f}, {y0:.3f}, {z0:.3f}) → "
              f"({x1:.3f}, {y1:.3f}, {z1:.3f})  "
              f"size {x1-x0:.3f} × {y1-y0:.3f} × {z1-z0:.3f}")
        print(f"   center: ({(x0+x1)/2:.3f}, {(y0+y1)/2:.3f})")

        # Bounding walls: walls that overlap the shaft footprint AND
        # are on the same storey Z-band.
        bounding_walls = []
        for w, wbb in wall_bboxes:
            wx0, wy0, wz0, wx1, wy1, wz1 = wbb
            # Same storey check
            if wz1 < z0 - 0.05 or wz0 > z1 + 0.05:
                continue
            # XY proximity (within 1m)
            if _bbox_distance_xy(sbb, wbb) > 1.0:
                continue
            # XY overlap (≥ 0.05 m²) — wall sits inside or at boundary
            overlap = _bbox_overlap_xy(sbb, wbb)
            bounding_walls.append((w, wbb, overlap))

        print(f"   walls within 1m of shaft on this storey: {len(bounding_walls)}")
        for w, wbb, overlap in sorted(bounding_walls, key=lambda t: -t[2])[:8]:
            wname = w.Name or w.GlobalId[:8]
            wx0, wy0, _, wx1, wy1, _ = wbb
            print(f"     - {wname:50s}  bbox X[{wx0:.2f}..{wx1:.2f}] "
                  f"Y[{wy0:.2f}..{wy1:.2f}]  overlap={overlap:.3f}m²")

    # ─── (3) Doors and their OperationType ───────────────────────────
    print()
    print("=" * 78)
    print("Door operation-type audit")
    print("=" * 78)
    doors = model.by_type("IfcDoor")
    print(f"\nIfcDoor total: {len(doors)} entity(ies)")

    # Heuristic: door connects to a lift shaft if its name contains
    # 'lift', or — more reliably — if its placement is at the boundary
    # of a lift-shaft bbox. Use Name-based first since the templates
    # encode the connection in the door id.
    lift_doors_by_name = []
    other_doors_sample = []
    for d in doors:
        if d.Name and "lift" in d.Name.lower():
            lift_doors_by_name.append(d)
        elif len(other_doors_sample) < 3:
            other_doors_sample.append(d)

    print(f"\nDoors with 'lift' in name: {len(lift_doors_by_name)}")
    for d in lift_doors_by_name[:12]:
        op = getattr(d, "OperationType", "?")
        ptype = getattr(d, "PredefinedType", "?")
        print(f"  {d.Name:60s}  OperationType={op}  PredefinedType={ptype}")
    if len(lift_doors_by_name) > 12:
        print(f"  ... and {len(lift_doors_by_name) - 12} more (same shape expected)")

    print(f"\nDoor sample (non-lift, for comparison):")
    for d in other_doors_sample:
        op = getattr(d, "OperationType", "?")
        ptype = getattr(d, "PredefinedType", "?")
        print(f"  {d.Name:60s}  OperationType={op}  PredefinedType={ptype}")

    # ─── Summary: did the fix land? ──────────────────────────────────
    print()
    print("=" * 78)
    print("SUMMARY (pre-fix expectation)")
    print("=" * 78)
    print(f"  IfcTransportElement count: {len(transport_elements)}  "
          f"[want: ≥{len(lift_shafts)} (one per shaft)]")
    sliding_lift_doors = sum(
        1 for d in lift_doors_by_name
        if "SLIDING" in (getattr(d, "OperationType", "") or "")
    )
    print(f"  Lift doors with SLIDING OperationType: "
          f"{sliding_lift_doors}/{len(lift_doors_by_name)}  "
          f"[want: 100% of lobby↔lift / lift_hall↔lift doors]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
