"""Forensic dump of an IFC file — identifies common visual bugs.

Reports per file:
  1. Declared LENGTHUNIT (METRE / MILLI.METRE / etc.)
  2. Number of IfcSpace + their world bounding boxes
  3. Number of IfcBuildingElement* + per-element world bbox
  4. Aggregate world bounding box across all geometric products
  5. Whether placements form a sane site→building→storey→space hierarchy
  6. Count of elements at world-origin (0,0,0)
  7. Top 10 largest + smallest element bboxes (by max extent)
  8. Material assignment counts per element class

Writes a structured JSON dump to `forensics/<name>-inspect.json` and prints a
human report to stdout.

Usage:
    python3 scripts/forensics/ifc-inspect.py forensics/<brief>.ifc
    python3 scripts/forensics/ifc-inspect.py forensics/*.ifc
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.placement
import ifcopenshell.util.shape
import numpy as np


def _length_unit(f) -> Dict[str, Any]:
    """Read the LENGTHUNIT declaration from the IfcUnitAssignment."""
    for ua in f.by_type("IfcUnitAssignment"):
        for u in ua.Units or []:
            if u.is_a("IfcSIUnit") and u.UnitType == "LENGTHUNIT":
                return {
                    "kind": "SI",
                    "prefix": u.Prefix,
                    "name": u.Name,
                    "label": f".{u.Prefix or ''}.{u.Name}." if u.Prefix else f".{u.Name}.",
                }
            if u.is_a("IfcConversionBasedUnit") and u.UnitType == "LENGTHUNIT":
                return {"kind": "ConversionBased", "name": u.Name}
    return {"kind": "UNKNOWN", "name": None}


def _world_bbox_of(element, settings) -> Optional[Dict[str, float]]:
    """Compute world bbox of a single product using ifcopenshell.geom."""
    try:
        if not element.Representation:
            return None
        shape = ifcopenshell.geom.create_shape(settings, element)
        # vertices is a flat list of doubles in world coords (Y-up triangulated mesh).
        verts = ifcopenshell.util.shape.get_vertices(shape.geometry)
        if verts is None or len(verts) == 0:
            return None
        arr = np.asarray(verts, dtype=float).reshape(-1, 3)
        xmin, ymin, zmin = arr.min(axis=0).tolist()
        xmax, ymax, zmax = arr.max(axis=0).tolist()
        return {
            "xmin": xmin, "ymin": ymin, "zmin": zmin,
            "xmax": xmax, "ymax": ymax, "zmax": zmax,
            "xext": xmax - xmin,
            "yext": ymax - ymin,
            "zext": zmax - zmin,
        }
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


def _placement_world(element) -> Optional[List[List[float]]]:
    """Return the 4x4 world matrix of the element's local placement, or None."""
    try:
        if not getattr(element, "ObjectPlacement", None):
            return None
        m = ifcopenshell.util.placement.get_local_placement(element.ObjectPlacement)
        return [[float(v) for v in row] for row in m]
    except Exception:
        return None


def inspect(path: Path) -> Dict[str, Any]:
    f = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    # USE_WORLD_COORDS makes vertex output be world-transformed.
    settings.set(settings.USE_WORLD_COORDS, True)
    # SEW_SHELLS is unnecessary here; keep defaults.

    out: Dict[str, Any] = {
        "file": path.name,
        "schema": f.schema,
        "entity_count_total": len(list(f)),
        "length_unit": _length_unit(f),
    }

    # Spatial hierarchy
    sites = f.by_type("IfcSite")
    buildings = f.by_type("IfcBuilding")
    storeys = f.by_type("IfcBuildingStorey")
    spaces = f.by_type("IfcSpace")
    out["spatial"] = {
        "site_count": len(sites),
        "building_count": len(buildings),
        "storey_count": len(storeys),
        "space_count": len(spaces),
    }

    # Element classes counts
    by_class: Dict[str, int] = {}
    for p in f.by_type("IfcProduct"):
        by_class[p.is_a()] = by_class.get(p.is_a(), 0) + 1
    out["products_by_class"] = by_class

    # World bboxes per IfcSpace
    space_bboxes: List[Dict[str, Any]] = []
    for s in spaces:
        bbox = _world_bbox_of(s, settings)
        space_bboxes.append({
            "name": s.Name,
            "long_name": s.LongName,
            "world_bbox": bbox,
        })
    out["spaces"] = space_bboxes

    # World bboxes per non-spatial element
    element_classes_of_interest = [
        "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcCovering",
        "IfcFurnishingElement", "IfcLightFixture", "IfcDoor", "IfcWindow",
        "IfcRailing", "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy",
    ]
    elements: List[Dict[str, Any]] = []
    placement_at_origin = 0
    for ifc_class in element_classes_of_interest:
        try:
            es = f.by_type(ifc_class)
        except RuntimeError:
            # Entity class doesn't exist in this schema — skip silently.
            continue
        for e in es:
            placement_matrix = _placement_world(e)
            placement_origin = None
            if placement_matrix is not None:
                placement_origin = [
                    placement_matrix[0][3],
                    placement_matrix[1][3],
                    placement_matrix[2][3],
                ]
                if (
                    abs(placement_origin[0]) < 1e-6
                    and abs(placement_origin[1]) < 1e-6
                    and abs(placement_origin[2]) < 1e-6
                ):
                    placement_at_origin += 1

            bbox = _world_bbox_of(e, settings)
            elements.append({
                "ifc_class": ifc_class,
                "name": getattr(e, "Name", None),
                "tag": getattr(e, "Tag", None),
                "placement_origin": placement_origin,
                "world_bbox": bbox,
            })

    out["elements"] = elements
    out["placement_at_origin_count"] = placement_at_origin
    out["element_total"] = len(elements)

    # Aggregate world bbox across all geometric products
    valid_bboxes = [
        e["world_bbox"] for e in elements
        if isinstance(e.get("world_bbox"), dict) and "xmin" in e["world_bbox"]
    ]
    if valid_bboxes:
        xmin = min(b["xmin"] for b in valid_bboxes)
        ymin = min(b["ymin"] for b in valid_bboxes)
        zmin = min(b["zmin"] for b in valid_bboxes)
        xmax = max(b["xmax"] for b in valid_bboxes)
        ymax = max(b["ymax"] for b in valid_bboxes)
        zmax = max(b["zmax"] for b in valid_bboxes)
        out["aggregate_world_bbox"] = {
            "xmin": xmin, "ymin": ymin, "zmin": zmin,
            "xmax": xmax, "ymax": ymax, "zmax": zmax,
            "xext": xmax - xmin,
            "yext": ymax - ymin,
            "zext": zmax - zmin,
        }
    else:
        out["aggregate_world_bbox"] = None

    # Top 10 largest + smallest by max axial extent
    def _max_extent(e):
        b = e.get("world_bbox")
        if not isinstance(b, dict) or "xext" not in b:
            return -1
        return max(b["xext"], b["yext"], b["zext"])

    elements_sorted = [e for e in elements if _max_extent(e) >= 0]
    elements_sorted.sort(key=_max_extent, reverse=True)
    out["top_10_largest"] = [
        {
            "ifc_class": e["ifc_class"], "tag": e["tag"], "name": e["name"],
            "xext": e["world_bbox"]["xext"],
            "yext": e["world_bbox"]["yext"],
            "zext": e["world_bbox"]["zext"],
        }
        for e in elements_sorted[:10]
    ]
    out["top_10_smallest"] = [
        {
            "ifc_class": e["ifc_class"], "tag": e["tag"], "name": e["name"],
            "xext": e["world_bbox"]["xext"],
            "yext": e["world_bbox"]["yext"],
            "zext": e["world_bbox"]["zext"],
        }
        for e in elements_sorted[-10:][::-1]
    ]

    # Material assignment counts per class
    mat_assignments: Dict[str, int] = {}
    for rel in f.by_type("IfcRelAssociatesMaterial"):
        for prod in rel.RelatedObjects or []:
            cls = prod.is_a()
            mat_assignments[cls] = mat_assignments.get(cls, 0) + 1
    out["material_assignment_counts"] = mat_assignments

    # ── v7 acceptance-criteria fields (added 2026-05-17) ────────────────
    #
    # Named counts for the three classes the v7 backend surgery (commit
    # a4c980df) targeted. Surfaced as top-level fields so the multi-brief
    # accuracy report can read them with one .get() per class — no more
    # regex over names or digging into products_by_class.
    out["ifc_door_count"] = by_class.get("IfcDoor", 0)
    out["ifc_window_count"] = by_class.get("IfcWindow", 0)
    out["ifc_building_element_proxy_count"] = by_class.get(
        "IfcBuildingElementProxy", 0,
    )
    out["ifc_wall_count"] = (
        by_class.get("IfcWall", 0) + by_class.get("IfcWallStandardCase", 0)
    )

    # Perimeter wall count — walls that lie along the AABB perimeter
    # (within 0.5 m of an outer edge). Distinguishes interior partitions
    # from the building shell. For a rectangular brief this should be 4;
    # for an L-shape this should be 6.
    perimeter_walls = 0
    agg = out.get("aggregate_world_bbox")
    if agg and isinstance(agg, dict):
        xmin, xmax = agg["xmin"], agg["xmax"]
        ymin, ymax = agg["ymin"], agg["ymax"]
        tol = 0.5  # 50 cm tolerance from the AABB edge
        for e in elements:
            if e["ifc_class"] not in ("IfcWall", "IfcWallStandardCase"):
                continue
            b = e.get("world_bbox")
            if not isinstance(b, dict) or "xmin" not in b:
                continue
            cx = (b["xmin"] + b["xmax"]) / 2.0
            cy = (b["ymin"] + b["ymax"]) / 2.0
            if (
                abs(cx - xmin) < tol
                or abs(cx - xmax) < tol
                or abs(cy - ymin) < tol
                or abs(cy - ymax) < tol
            ):
                perimeter_walls += 1
    out["perimeter_wall_count"] = perimeter_walls

    # Polygon-vs-AABB detection: if a sibling `<stem>-briefspec.json`
    # exists next to the IFC file (the convention from
    # `scripts/forensics/run-brief-direct.ts`), read its
    # `spaces[*].polygon_world_m`, classify each as rectangular vs
    # irregular, and report whether the IFC's wall count is consistent
    # with the polygon's edge count.
    out["polygon_check"] = _polygon_check_from_sibling_briefspec(path, perimeter_walls)

    return out


def _polygon_check_from_sibling_briefspec(
    ifc_path: Path, perimeter_walls: int,
) -> Dict[str, Any]:
    """Read `<stem>-briefspec.json` if present and compare polygon edges
    to perimeter-wall count. Returns a structured verdict.

    The convention: `run-brief-direct.ts` writes `<label>.ifc` and
    `<label>-briefspec.json` to the same directory, where the label
    matches `ifc_path.stem`.
    """
    sibling = ifc_path.parent / f"{ifc_path.stem}-briefspec.json"
    if not sibling.exists():
        return {"status": "no_briefspec_sibling"}
    try:
        spec = json.loads(sibling.read_text())
    except Exception as e:
        return {"status": "briefspec_parse_error", "error": str(e)}

    spaces = spec.get("spaces") or []
    polygon_total_edges = 0
    irregular_count = 0
    rect_count = 0
    for sp in spaces:
        poly = sp.get("polygon_world_m")
        if not isinstance(poly, list) or len(poly) < 3:
            continue
        # Detect axis-aligned 4-vertex rectangle
        is_rect = len(poly) == 4 and all(
            abs(poly[i][0] - poly[(i + 1) % 4][0]) < 1e-3
            or abs(poly[i][1] - poly[(i + 1) % 4][1]) < 1e-3
            for i in range(4)
        )
        if is_rect:
            rect_count += 1
            polygon_total_edges += 4
        else:
            irregular_count += 1
            polygon_total_edges += len(poly)

    if irregular_count == 0:
        # Rectangular brief — perimeter wall count should be at least 4.
        return {
            "status": "rectangular",
            "rectangular_spaces": rect_count,
            "irregular_spaces": 0,
            "polygon_total_edges": polygon_total_edges,
            "perimeter_walls": perimeter_walls,
            "verdict": "OK" if perimeter_walls >= 4 else "FEW_PERIMETER_WALLS",
        }

    # Irregular brief — perimeter walls should be >= polygon's edge count.
    verdict = "OK" if perimeter_walls >= polygon_total_edges else "AABB_UNFOLDING"
    return {
        "status": "irregular",
        "rectangular_spaces": rect_count,
        "irregular_spaces": irregular_count,
        "polygon_total_edges": polygon_total_edges,
        "perimeter_walls": perimeter_walls,
        "verdict": verdict,
        "failure_explanation": (
            f"polygon has {polygon_total_edges} edges but IFC has only "
            f"{perimeter_walls} perimeter walls — likely AABB unfolding"
            if verdict == "AABB_UNFOLDING"
            else None
        ),
    }


def print_report(d: Dict[str, Any]) -> None:
    print(f"\n{'=' * 72}")
    print(f"FILE: {d['file']}")
    print(f"{'=' * 72}")
    print(f"Schema: {d['schema']}  Total entities: {d['entity_count_total']}")
    lu = d["length_unit"]
    print(f"Length unit: {lu.get('label') or lu.get('name')}  (kind={lu['kind']})")
    if lu.get("label") == ".MILLI.METRE." or (lu.get("prefix") == "MILLI" and lu.get("name") == "METRE"):
        print(" 🚨 LENGTH UNIT IS MILLIMETRE — viewers will treat metre-valued coords as millimetres.")

    sp = d["spatial"]
    print(
        f"Spatial: site={sp['site_count']} building={sp['building_count']} "
        f"storey={sp['storey_count']} space={sp['space_count']}"
    )

    pbc = d["products_by_class"]
    top_classes = sorted(pbc.items(), key=lambda x: -x[1])[:12]
    print("Top product classes:")
    for cls, n in top_classes:
        print(f"  {cls}: {n}")

    agg = d.get("aggregate_world_bbox")
    if agg:
        print(
            f"Aggregate world bbox: "
            f"X=[{agg['xmin']:.4f}, {agg['xmax']:.4f}] ({agg['xext']:.4f})  "
            f"Y=[{agg['ymin']:.4f}, {agg['ymax']:.4f}] ({agg['yext']:.4f})  "
            f"Z=[{agg['zmin']:.4f}, {agg['zmax']:.4f}] ({agg['zext']:.4f})"
        )
    else:
        print("Aggregate world bbox: NO GEOMETRIC ELEMENTS")

    print(
        f"Elements: total={d['element_total']}  "
        f"placement_at_origin_count={d['placement_at_origin_count']}"
    )

    if d.get("top_10_largest"):
        print("Top 10 by extent:")
        for e in d["top_10_largest"][:5]:
            print(
                f"  {e['ifc_class']:30s} tag={e['tag']:20s} "
                f"x={e['xext']:.4f} y={e['yext']:.4f} z={e['zext']:.4f}"
            )

    print("\nSpaces:")
    for s in d["spaces"][:8]:
        b = s["world_bbox"]
        if isinstance(b, dict) and "xext" in b:
            print(
                f"  {s['name']!r} long={s['long_name']!r} "
                f"x={b['xext']:.4f} y={b['yext']:.4f} z={b['zext']:.4f}"
            )
        else:
            print(f"  {s['name']!r} long={s['long_name']!r} bbox=ERROR {b}")

    # v7 acceptance-criteria summary
    print("\nv7 acceptance:")
    print(
        f"  IfcDoor={d.get('ifc_door_count', 0)} "
        f"IfcWindow={d.get('ifc_window_count', 0)} "
        f"IfcBuildingElementProxy={d.get('ifc_building_element_proxy_count', 0)} "
        f"IfcWall={d.get('ifc_wall_count', 0)} "
        f"perimeter_walls={d.get('perimeter_wall_count', 0)}"
    )
    pc = d.get("polygon_check") or {}
    if pc.get("status") == "irregular":
        verdict = pc.get("verdict", "?")
        marker = "✓" if verdict == "OK" else "✗"
        print(
            f"  {marker} polygon_check: {verdict} — "
            f"irregular_spaces={pc.get('irregular_spaces', 0)}, "
            f"polygon_edges={pc.get('polygon_total_edges', 0)}, "
            f"perimeter_walls={pc.get('perimeter_walls', 0)}"
        )
        if pc.get("failure_explanation"):
            print(f"    {pc['failure_explanation']}")
    elif pc.get("status") == "rectangular":
        print(
            f"  polygon_check: rectangular (all {pc.get('rectangular_spaces', 0)} "
            f"spaces are 4-vertex axis-aligned)"
        )
    elif pc.get("status") == "no_briefspec_sibling":
        print(f"  polygon_check: no sibling briefspec.json — skipping")
    else:
        print(f"  polygon_check: {pc}")


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: ifc-inspect.py [--out-dir <dir>] <file.ifc> [more.ifc ...]",
            file=sys.stderr,
        )
        return 2

    args = list(argv[1:])
    out_dir: Optional[Path] = None
    if args and args[0] == "--out-dir":
        if len(args) < 2:
            print("--out-dir requires a path", file=sys.stderr)
            return 2
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        args = args[2:]

    for path_str in args:
        path = Path(path_str)
        d = inspect(path)
        print_report(d)
        # Default: write inspect.json next to the source IFC. Falls back
        # to --out-dir if explicitly passed.
        target_dir = out_dir if out_dir is not None else path.parent
        target_dir.mkdir(parents=True, exist_ok=True)
        out_file = target_dir / f"{path.stem}-inspect.json"
        out_file.write_text(json.dumps(d, indent=2))
        print(f"  -> wrote {out_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
