"""Slice T2.0.1 visual-bug diagnostic — inspect the G+5 tower IFC.

Walks the actual IFC4 file (NOT the BuildingModel) to verify whether
the parapet-wall + balcony fixes landed in the IFC bytes, OR whether
the geometry-resolver / Phase 1 IFC builder silently overrode them.

For each storey, dumps:
  * Every IfcSpace's GlobalId / Name / bounding box (z range tells us
    if the space's geometry got the parapet treatment or full-height).
  * Every IfcWall whose name suggests it's on the north strip (E-n,
    W-n, balcony N) — base z, top z, computed extrusion depth.
  * The IfcStairFlight's geometry kind (extruded? mesh? bounded?).

Output goes to stdout; the script makes NO modifications.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent.parent
sys.path.insert(0, str(_SCRIPT_DIR.parent))

import ifcopenshell  # noqa: E402
import ifcopenshell.geom  # noqa: E402

IFC_PATH = _REPO_ROOT / "temp_folder" / "tier2_2bhk_pune_tower_g5.ifc"


def _bbox(shape) -> tuple:
    """Return (min_x, min_y, min_z, max_x, max_y, max_z) of a shape geometry."""
    verts = shape.geometry.verts
    if not verts:
        return None
    xs = verts[0::3]
    ys = verts[1::3]
    zs = verts[2::3]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def _shape_for(model, entity, settings):
    try:
        return ifcopenshell.geom.create_shape(settings, entity)
    except Exception as exc:
        return f"<no shape: {type(exc).__name__}: {exc}>"


def main() -> int:
    if not IFC_PATH.exists():
        print(f"ERROR: {IFC_PATH} not found. Run the tower export first.")
        return 1
    print(f"Loading {IFC_PATH} ({IFC_PATH.stat().st_size:,} bytes)")
    model = ifcopenshell.open(str(IFC_PATH))
    print(f"ifcopenshell version: {ifcopenshell.version}, schema: {model.schema}")

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    # ─── Map storey id (int from name) to IfcBuildingStorey ─────
    storeys = model.by_type("IfcBuildingStorey")
    print(f"\nStoreys ({len(storeys)}):")
    storey_by_id: dict[str, object] = {}
    for s in sorted(storeys, key=lambda x: x.Elevation):
        print(f"  {s.Name}: elevation={s.Elevation}, GlobalId={s.GlobalId[:8]}")
        storey_by_id[s.Name] = s

    # ─── IfcSpaces grouped by storey ─────────────────────────
    print()
    print("=" * 78)
    print("IfcSpace inventory — grouped by storey, with rendered bbox")
    print("=" * 78)
    spaces = model.by_type("IfcSpace")
    spaces_by_storey: dict[str, list] = defaultdict(list)
    # Map IfcSpace → owning IfcBuildingStorey by walking IfcRelAggregates.
    storey_of: dict[int, object] = {}
    for rel in model.by_type("IfcRelAggregates"):
        if rel.RelatingObject.is_a("IfcBuildingStorey"):
            for child in rel.RelatedObjects:
                storey_of[child.id()] = rel.RelatingObject
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        if rel.RelatingStructure.is_a("IfcBuildingStorey"):
            for child in rel.RelatedElements:
                storey_of[child.id()] = rel.RelatingStructure
    for sp in spaces:
        storey = storey_of.get(sp.id())
        storey_name = storey.Name if storey else "(unattached)"
        spaces_by_storey[storey_name].append(sp)

    for storey_name in sorted(
        spaces_by_storey, key=lambda n: storey_by_id[n].Elevation if n in storey_by_id else -1
    ):
        st = storey_by_id.get(storey_name)
        elev = st.Elevation if st else None
        print(f"\n  Storey {storey_name} (elev={elev}):")
        for sp in sorted(spaces_by_storey[storey_name], key=lambda x: x.Name or ""):
            shape = _shape_for(model, sp, settings)
            bbox = _bbox(shape) if not isinstance(shape, str) else None
            if bbox:
                bbox_str = (
                    f"x[{bbox[0]:.2f},{bbox[3]:.2f}] "
                    f"y[{bbox[1]:.2f},{bbox[4]:.2f}] "
                    f"z[{bbox[2]:.2f},{bbox[5]:.2f}] "
                    f"h={bbox[5]-bbox[2]:.2f}m"
                )
            else:
                bbox_str = str(shape)[:40]
            print(f"    {sp.Name}: {bbox_str}")

    # ─── Walls on the "north strip" — i.e., parapet walls ─────
    print()
    print("=" * 78)
    print("Walls whose name indicates parapet (E-n, W-n, balcony N)")
    print("=" * 78)
    walls = model.by_type("IfcWall")
    parapet_keywords = ("Parapet", "-E-n", "-W-n")
    for w in walls:
        if not any(kw in (w.Name or "") for kw in parapet_keywords) and not (
            (w.Name or "").endswith(" - FLAT-S1")
            or (w.Name or "").startswith("External Wall North - FLAT-S")
        ):
            continue
        storey = storey_of.get(w.id())
        storey_name = storey.Name if storey else "(unattached)"
        # Read placement z (= base of the wall).
        placement = w.ObjectPlacement
        base_z = None
        if placement:
            try:
                base_z = placement.RelativePlacement.Location.Coordinates[2]
                # Walk up the placement chain to get absolute z.
                parent = placement.PlacementRelTo
                while parent is not None:
                    base_z += parent.RelativePlacement.Location.Coordinates[2]
                    parent = parent.PlacementRelTo
            except Exception:
                base_z = "?"
        # Read extrusion depth from representation.
        depth = None
        try:
            for rep in w.Representation.Representations:
                for item in rep.Items:
                    if item.is_a("IfcExtrudedAreaSolid"):
                        depth = item.Depth
                        break
                if depth is not None:
                    break
        except Exception:
            depth = "?"
        shape = _shape_for(model, w, settings)
        bbox = _bbox(shape) if not isinstance(shape, str) else None
        bbox_str = (
            f"world_z[{bbox[2]:.2f},{bbox[5]:.2f}] h={bbox[5]-bbox[2]:.2f}m"
            if bbox else "(no bbox)"
        )
        print(f"  {storey_name}: {w.Name!r}")
        print(f"    base_z={base_z}, extrusion_depth={depth}, {bbox_str}")

    # ─── Stair geometry kind ──────────────────────────────────
    print()
    print("=" * 78)
    print("IfcStairFlight geometry kind (stepped vs block?)")
    print("=" * 78)
    stairs = model.by_type("IfcStairFlight")
    for st in sorted(stairs, key=lambda x: x.Name or "")[:3]:
        print(f"\n  {st.Name}: NumberOfRisers={st.NumberOfRisers}, "
              f"RiserHeight={st.RiserHeight}, TreadLength={st.TreadLength}")
        # Look at the representation items.
        for rep in st.Representation.Representations:
            for item in rep.Items:
                cls = item.is_a()
                if item.is_a("IfcExtrudedAreaSolid"):
                    profile = item.SweptArea
                    profile_cls = profile.is_a()
                    print(f"    geom: IfcExtrudedAreaSolid(Depth={item.Depth}, "
                          f"SweptArea={profile_cls})")
                    if profile.is_a("IfcArbitraryClosedProfileDef"):
                        n_pts = len(profile.OuterCurve.Points)
                        first_pts = profile.OuterCurve.Points[:6]
                        coords = [pt.Coordinates for pt in first_pts]
                        print(f"      polyline: {n_pts} points, first 6: {coords}")
                else:
                    print(f"    geom: {cls}")
        shape = _shape_for(model, st, settings)
        bbox = _bbox(shape) if not isinstance(shape, str) else None
        if bbox:
            print(f"    rendered bbox: x[{bbox[0]:.2f},{bbox[3]:.2f}] "
                  f"y[{bbox[1]:.2f},{bbox[4]:.2f}] "
                  f"z[{bbox[2]:.2f},{bbox[5]:.2f}]")

    print()
    print("=" * 78)
    print("INSPECTION COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
