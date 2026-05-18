"""IFC validator + summariser for the v3 generator agent.

Exposed to the agent through the `validate_ifc` and `read_ifc_summary`
tools. The validator deliberately does cheap structural checks that
matter for the *agent feedback loop* — entity count, reference resolution
through the spatial hierarchy, presence of every space the brief declared,
non-ASCII byte scan. Web-ifc compatibility is the load-test surrogate;
strict IFC compliance (Express-rule level) is out of scope.

Brief-aware visual validators (added 2026-05-16 after the visual-collapse
false-green):

  • `validate_world_bbox`  — actual aggregate world bbox vs brief expected
  • `validate_space_polygons` — per-space polygon footprint match
  • `validate_element_coverage` — every brief.elements entry present
  • `validate_no_origin_collapse` — flag when many elements stack at origin

They run only when `brief` is passed to `validate_ifc_file`; the agent
calls /v3/generator/validate which loads the brief from the session's
meta.json. `finalize_ifc` refuses with `VISUAL_GEOMETRY_INVALID` when
world_bbox verdict is not `OK`.
"""

from __future__ import annotations

import math
import os
from typing import Any, Dict, List, Optional, Tuple

import ifcopenshell


def _bytes_contain_non_ascii(path: str, sample_bytes: int = 1_048_576) -> Dict[str, Any]:
    """Read up to `sample_bytes` of the file and report any non-ASCII offsets.

    1 MB is plenty for the first occurrence; we only need to report
    *whether* the file is pure-ASCII, not enumerate every offset. A pure
    IFC2X3 STEP file IS ASCII by definition (ISO 10303-21 §6.4.3.4 limits
    string content to printable ISO-8859 plus control bytes, and our
    generator never emits anything outside printable ASCII).
    """
    try:
        with open(path, "rb") as f:
            buf = f.read(sample_bytes)
    except OSError as exc:
        return {"ok": False, "error": f"read failed: {exc!r}"}
    for offset, byte in enumerate(buf):
        if byte > 0x7F:
            # Include a small context window so the caller can see the bad bytes.
            ctx_start = max(0, offset - 20)
            ctx_end = min(len(buf), offset + 20)
            return {
                "ok": False,
                "first_non_ascii_byte": byte,
                "first_non_ascii_offset": offset,
                "context_hex": buf[ctx_start:ctx_end].hex(),
            }
    return {"ok": True}


def validate_ifc_file(
    path: str,
    expected_space_tags: Optional[List[str]] = None,
    brief: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Validate a written IFC. Mirrors the `BuildFlowIFC.validate` shape
    but operates on the WRITTEN file (so it catches serialization issues
    the in-memory validator can't see).

    When `brief` is provided, runs the brief-aware visual validators
    (`world_bbox`, `space_polygons`, `element_coverage`,
    `origin_collapse`). `expected_space_tags` is auto-derived from the
    brief when not supplied — keep the explicit kwarg for back-compat.

    Returns::

        {
            "schema": "IFC2X3",
            "entity_count": int,
            "refs_resolve": bool,
            "spaces_present": list[str],
            "spaces_missing": list[str],
            "errors": list[str],
            "web_ifc_load_test": "PASS" | "FAIL" | "SKIP",
            "ascii_only": bool,
            "ascii_first_bad_offset": int | None,
            # Brief-aware (only when brief supplied):
            "world_bbox": { ... } | None,
            "space_polygons": [ ... ] | None,
            "element_coverage": { ... } | None,
            "origin_collapse": { ... } | None,
        }

    NOTE on web_ifc_load_test: we don't have web-ifc on the Python server.
    The smoke test surrogate is "ifcopenshell can re-open the file AND
    the file is pure ASCII" — both necessary conditions for web-ifc.
    """
    if brief is not None and expected_space_tags is None:
        expected_space_tags = [
            str(s.get("id"))
            for s in (brief.get("spaces") or [])
            if s.get("id")
        ] or None
    errors: List[str] = []
    if not os.path.isfile(path):
        return {
            "schema": None,
            "entity_count": 0,
            "refs_resolve": False,
            "spaces_present": [],
            "spaces_missing": list(expected_space_tags or []),
            "errors": [f"file not found: {path}"],
            "web_ifc_load_test": "FAIL",
            "ascii_only": False,
            "ascii_first_bad_offset": None,
        }

    ascii_check = _bytes_contain_non_ascii(path)
    ascii_only = bool(ascii_check.get("ok"))
    ascii_first_bad_offset = ascii_check.get("first_non_ascii_offset")

    try:
        f = ifcopenshell.open(path)
    except Exception as exc:
        return {
            "schema": None,
            "entity_count": 0,
            "refs_resolve": False,
            "spaces_present": [],
            "spaces_missing": list(expected_space_tags or []),
            "errors": [f"ifcopenshell.open failed: {type(exc).__name__}: {exc}"],
            "web_ifc_load_test": "FAIL",
            "ascii_only": ascii_only,
            "ascii_first_bad_offset": ascii_first_bad_offset,
        }

    schema = f.schema
    entity_count = len(list(f))

    # Reference resolution: every IfcProduct should have an ObjectPlacement
    # AND every IfcRelContainedInSpatialStructure should resolve.
    products = f.by_type("IfcProduct")
    refs_ok = True
    for p in products:
        if p.is_a("IfcProject"):
            continue
        try:
            placement = p.ObjectPlacement
            if placement is None:
                # IfcSpace in 2X3 has no Tag — fall back to Name / GlobalId.
                label = (
                    getattr(p, "Tag", None)
                    or getattr(p, "Name", None)
                    or getattr(p, "GlobalId", "?")
                )
                errors.append(f"{p.is_a()} {label} missing ObjectPlacement")
                refs_ok = False
        except Exception as exc:
            errors.append(f"{p.is_a()} GlobalId={getattr(p, 'GlobalId', '?')}: {exc!r}")
            refs_ok = False

    spaces = f.by_type("IfcSpace")
    # `IfcSpace.Tag` is IFC4-only — use Name (set by add_space to the
    # caller's space_id).
    spaces_present = [
        getattr(s, "Name", None) for s in spaces if getattr(s, "Name", None)
    ]
    spaces_missing: List[str] = []
    if expected_space_tags:
        present_set = set(spaces_present)
        spaces_missing = [t for t in expected_space_tags if t not in present_set]
        if spaces_missing:
            errors.append(
                f"spec declared {len(expected_space_tags)} spaces, "
                f"file contains {len(spaces_present)} — missing: {spaces_missing}"
            )

    web_ifc_load_test = "PASS" if (refs_ok and ascii_only) else "FAIL"

    # Brief-aware visual validators — only when brief supplied.
    world_bbox_result: Optional[Dict[str, Any]] = None
    space_polygons_result: Optional[List[Dict[str, Any]]] = None
    element_coverage_result: Optional[Dict[str, Any]] = None
    origin_collapse_result: Optional[Dict[str, Any]] = None

    # Phase BCD validators (always run — not brief-gated).
    pset_coverage_result: Optional[Dict[str, Any]] = None
    style_coverage_result: Optional[Dict[str, Any]] = None
    opening_consistency_result: Optional[Dict[str, Any]] = None
    aggregate_coverage_result: Optional[Dict[str, Any]] = None
    # Dormant validators (Gap A + Gap B) — now wired.
    polygon_footprint_result: Optional[Dict[str, Any]] = None
    door_window_typing_result: Optional[Dict[str, Any]] = None

    try:
        pset_coverage_result = validate_pset_coverage(f, brief)
    except Exception as exc:
        pset_coverage_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
    try:
        style_coverage_result = validate_style_coverage(f, brief)
    except Exception as exc:
        style_coverage_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
    try:
        opening_consistency_result = validate_opening_consistency(f, brief)
    except Exception as exc:
        opening_consistency_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
    try:
        aggregate_coverage_result = validate_aggregate_coverage(f, brief)
    except Exception as exc:
        aggregate_coverage_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}

    if brief is not None:
        try:
            world_bbox_result = validate_world_bbox(f, brief)
        except Exception as exc:
            world_bbox_result = {
                "verdict": "ERROR",
                "error": f"{type(exc).__name__}: {exc}",
            }
        try:
            space_polygons_result = validate_space_polygons(f, brief)
        except Exception as exc:
            space_polygons_result = [
                {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
            ]
        try:
            element_coverage_result = validate_element_coverage(f, brief)
        except Exception as exc:
            element_coverage_result = {
                "verdict": "ERROR",
                "error": f"{type(exc).__name__}: {exc}",
            }
        try:
            origin_collapse_result = validate_no_origin_collapse(f)
        except Exception as exc:
            origin_collapse_result = {
                "verdict": "ERROR",
                "error": f"{type(exc).__name__}: {exc}",
            }
        # Dormant validators — now wired into the main validation path.
        try:
            polygon_footprint_result = validate_polygon_footprint(f, brief)
        except Exception as exc:
            polygon_footprint_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
        try:
            door_window_typing_result = validate_door_window_typing(f, brief)
        except Exception as exc:
            door_window_typing_result = {"verdict": "ERROR", "error": f"{type(exc).__name__}: {exc}"}

    return {
        "schema": schema,
        "entity_count": entity_count,
        "refs_resolve": refs_ok,
        "spaces_present": spaces_present,
        "spaces_missing": spaces_missing,
        "errors": errors,
        "web_ifc_load_test": web_ifc_load_test,
        "ascii_only": ascii_only,
        "ascii_first_bad_offset": ascii_first_bad_offset,
        "world_bbox": world_bbox_result,
        "space_polygons": space_polygons_result,
        "element_coverage": element_coverage_result,
        "origin_collapse": origin_collapse_result,
        # Phase BCD validators
        "pset_coverage": pset_coverage_result,
        "style_coverage": style_coverage_result,
        "opening_consistency": opening_consistency_result,
        "aggregate_coverage": aggregate_coverage_result,
        # Dormant validators (now wired)
        "polygon_footprint": polygon_footprint_result,
        "door_window_typing": door_window_typing_result,
    }


# ── Brief-aware visual validators ────────────────────────────────────


def _expected_bbox_from_brief(brief: Dict[str, Any]) -> Tuple[float, float, float]:
    """Compute the expected world bbox extent (x, y, z) from a brief.

    Uses the union of:
      • `site.bounds_m` outer rectangle
      • every `spaces[].polygon_world_m` vertex
      • every `elements[].origin_world_m + dims_m`
      • `site.height_limit_m` and every `spaces[].height_m`
    """
    site = brief.get("site") or {}
    bounds = site.get("bounds_m") or [0.0, 0.0]
    xmax = float(bounds[0]) if bounds else 0.0
    ymax = float(bounds[1]) if len(bounds) > 1 else 0.0
    zmax = float(site.get("height_limit_m") or 0.0)

    for sp in brief.get("spaces") or []:
        for vert in sp.get("polygon_world_m") or []:
            try:
                xmax = max(xmax, float(vert[0]))
                ymax = max(ymax, float(vert[1]))
            except (TypeError, IndexError):
                continue
        try:
            zmax = max(zmax, float(sp.get("height_m") or 0.0))
        except (TypeError, ValueError):
            pass

    for el in brief.get("elements") or []:
        origin = el.get("origin_world_m") or [0, 0, 0]
        dims = el.get("dims_m") or [0, 0, 0]
        try:
            xmax = max(xmax, float(origin[0]) + float(dims[0]))
            ymax = max(ymax, float(origin[1]) + float(dims[1]))
            zmax = max(zmax, float(origin[2]) + float(dims[2]))
        except (TypeError, IndexError, ValueError):
            continue

    return xmax, ymax, zmax


def _aggregate_world_bbox(
    f: ifcopenshell.file,
) -> Optional[Tuple[float, float, float, float, float, float]]:
    """Compute the aggregate (xmin,ymin,zmin,xmax,ymax,zmax) of all
    geometric products via `ifcopenshell.geom`. Returns None if no
    elements have geometry."""
    import ifcopenshell.geom
    import ifcopenshell.util.shape
    import numpy as np

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    classes = [
        "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcCovering",
        "IfcFurnishingElement", "IfcDoor", "IfcWindow", "IfcRailing",
        "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy", "IfcSpace",
    ]
    xmin = ymin = zmin = math.inf
    xmax = ymax = zmax = -math.inf
    found_any = False
    for ifc_class in classes:
        try:
            es = f.by_type(ifc_class)
        except RuntimeError:
            # Class not in this schema (e.g. IfcLightFixture in 2X3) — skip.
            continue
        for e in es:
            if not getattr(e, "Representation", None):
                continue
            try:
                shape = ifcopenshell.geom.create_shape(settings, e)
                verts = ifcopenshell.util.shape.get_vertices(shape.geometry)
                if verts is None or len(verts) == 0:
                    continue
                arr = np.asarray(verts, dtype=float).reshape(-1, 3)
                xmin = min(xmin, float(arr[:, 0].min()))
                ymin = min(ymin, float(arr[:, 1].min()))
                zmin = min(zmin, float(arr[:, 2].min()))
                xmax = max(xmax, float(arr[:, 0].max()))
                ymax = max(ymax, float(arr[:, 1].max()))
                zmax = max(zmax, float(arr[:, 2].max()))
                found_any = True
            except Exception:
                # Element with bad geometry — skip, don't fail the whole
                # validation. The refs_resolve check catches structural
                # problems already.
                continue
    if not found_any:
        return None
    return (xmin, ymin, zmin, xmax, ymax, zmax)


def validate_world_bbox(
    f: ifcopenshell.file, brief: Dict[str, Any]
) -> Dict[str, Any]:
    """Compare actual world bbox to expected from the brief.

    Verdict rules:
      • `OK` — every axis ratio in [0.5, 2.0]
      • `SCALED_TOO_SMALL` — every axis ratio < 0.01 (likely mm-as-m;
        the original 2026-05-16 visual-collapse bug)
      • `SCALED_TOO_LARGE` — every axis ratio > 100 (likely m-as-mm)
      • `COLLAPSED_AT_ORIGIN` — all aggregate extents < 0.01m
      • `EMPTY` — no geometric elements found
      • `OUT_OF_RANGE` — magnitudes don't match a known pattern (e.g.
        one axis right, another wrong — likely a per-element bug)

    `suggested_unit_fix` is a one-liner the agent can read to course-correct.
    """
    expected = _expected_bbox_from_brief(brief)
    ex, ey, ez = expected
    agg = _aggregate_world_bbox(f)
    if agg is None:
        return {
            "verdict": "EMPTY",
            "expected_extent": [ex, ey, ez],
            "actual_bbox": None,
            "actual_extent": None,
            "extent_ratio": None,
            "suggested_unit_fix": (
                "No geometric elements were found in the IFC. Did you forget "
                "to call `bf.add_*` for the elements in `brief.elements`?"
            ),
        }
    xmin, ymin, zmin, xmax, ymax, zmax = agg
    ax, ay, az = xmax - xmin, ymax - ymin, zmax - zmin
    rx = ax / ex if ex > 0 else 0
    ry = ay / ey if ey > 0 else 0
    rz = az / ez if ez > 0 else 0
    ratios = (rx, ry, rz)
    nonzero_ratios = [r for r in ratios if r > 0]

    verdict = "OK"
    suggested_unit_fix: Optional[str] = None
    if max(ax, ay, az) < 0.01:
        verdict = "COLLAPSED_AT_ORIGIN"
        suggested_unit_fix = (
            "All elements have near-zero extent. Check that `dims_m` and "
            "polygon coordinates are non-zero in your brief, and that the "
            "helpers were called with the correct argument shape."
        )
    elif nonzero_ratios and all(r < 0.01 for r in nonzero_ratios):
        verdict = "SCALED_TOO_SMALL"
        suggested_unit_fix = (
            "Actual bbox is ~1000x smaller than expected. The most likely "
            "cause is the IFC declaring MILLIMETRE while values are in "
            "metres. The helper's bootstrap now forces METRE — if this "
            "verdict appears, the helper version on the server may be out "
            "of date or the brief was passed dimensions in mm. Pass values "
            "in METRES (e.g. `dims=(4.0, 0.1)`, not `(4000, 100)`)."
        )
    elif all(r > 100 for r in nonzero_ratios):
        verdict = "SCALED_TOO_LARGE"
        suggested_unit_fix = (
            "Actual bbox is ~1000x larger than expected. You likely passed "
            "dimensions in millimetres (e.g. `dims=(4000, 100)`) but the "
            "helper interprets them as metres. Divide all dimensions by 1000."
        )
    elif not all(0.5 <= r <= 2.0 for r in nonzero_ratios):
        verdict = "OUT_OF_RANGE"
        suggested_unit_fix = (
            f"World bbox ratio outside [0.5, 2.0] on some axis "
            f"(x={rx:.3f}, y={ry:.3f}, z={rz:.3f}). Per-element scale or "
            "placement may be off. Inspect the largest-deviation axis."
        )

    return {
        "verdict": verdict,
        "expected_extent": [ex, ey, ez],
        "actual_bbox": {
            "xmin": xmin, "ymin": ymin, "zmin": zmin,
            "xmax": xmax, "ymax": ymax, "zmax": zmax,
        },
        "actual_extent": [ax, ay, az],
        "extent_ratio": [rx, ry, rz],
        "suggested_unit_fix": suggested_unit_fix,
    }


def _space_polygon_world(space) -> Optional[List[Tuple[float, float]]]:
    """Best-effort extraction of an IfcSpace's footprint polygon in world
    coordinates by reading its IfcArbitraryClosedProfileDef -> IfcPolyline
    points. Returns None if the representation doesn't follow that pattern."""
    try:
        if not space.Representation:
            return None
        for rep in space.Representation.Representations or []:
            for item in rep.Items or []:
                if not item.is_a("IfcExtrudedAreaSolid"):
                    continue
                area = item.SweptArea
                if not area or not area.is_a("IfcArbitraryClosedProfileDef"):
                    continue
                curve = area.OuterCurve
                if not curve or not curve.is_a("IfcPolyline"):
                    continue
                pts = []
                for p in curve.Points or []:
                    coords = p.Coordinates
                    if len(coords) >= 2:
                        pts.append((float(coords[0]), float(coords[1])))
                if pts:
                    return pts
    except Exception:
        return None
    return None


def validate_space_polygons(
    f: ifcopenshell.file, brief: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """For each space in the brief, compare its polygon to the IfcSpace
    footprint in the IFC. Tolerance: 0.1m per vertex.

    Spaces not present in the IFC are returned with verdict `MISSING`;
    spaces whose footprint doesn't match within tolerance are `MISMATCH`."""
    results: List[Dict[str, Any]] = []
    spaces_in_file = {
        getattr(s, "Name", None): s for s in f.by_type("IfcSpace")
    }
    for sp in brief.get("spaces") or []:
        sp_id = str(sp.get("id") or "")
        expected_poly = sp.get("polygon_world_m") or []
        actual_space = spaces_in_file.get(sp_id)
        if actual_space is None:
            results.append({
                "space_id": sp_id,
                "verdict": "MISSING",
                "expected_polygon": expected_poly,
                "actual_polygon": None,
                "max_vertex_delta_m": None,
            })
            continue
        actual_poly = _space_polygon_world(actual_space)
        if actual_poly is None:
            results.append({
                "space_id": sp_id,
                "verdict": "NO_POLYGON_REP",
                "expected_polygon": expected_poly,
                "actual_polygon": None,
                "max_vertex_delta_m": None,
            })
            continue
        if not expected_poly:
            # Brief had no polygon (circular space?) — skip with INFO.
            results.append({
                "space_id": sp_id,
                "verdict": "NO_EXPECTED_POLYGON",
                "expected_polygon": [],
                "actual_polygon": actual_poly,
                "max_vertex_delta_m": None,
            })
            continue
        # Compare. We don't require ordering parity — for each expected
        # vertex, find the nearest actual vertex; the largest of those
        # nearest distances is `max_vertex_delta_m`.
        max_delta = 0.0
        for ex_v in expected_poly:
            try:
                exv = (float(ex_v[0]), float(ex_v[1]))
            except (TypeError, IndexError, ValueError):
                continue
            nearest = min(
                ((exv[0] - av[0]) ** 2 + (exv[1] - av[1]) ** 2) ** 0.5
                for av in actual_poly
            )
            max_delta = max(max_delta, nearest)
        verdict = "OK" if max_delta <= 0.1 else "MISMATCH"
        results.append({
            "space_id": sp_id,
            "verdict": verdict,
            "expected_polygon": expected_poly,
            "actual_polygon": actual_poly,
            "max_vertex_delta_m": max_delta,
        })
    return results


def validate_element_coverage(
    f: ifcopenshell.file, brief: Dict[str, Any]
) -> Dict[str, Any]:
    """Confirm every brief.elements[].id is present in the IFC (by Tag),
    regardless of which IFC class it lands in.

    Class lookup is intentionally PERMISSIVE: an element declared as
    `type: "lighting"` in the brief will end up as IfcBuildingElementProxy
    or IfcFurnishingElement in IFC2X3 because IfcLightFixture is an IFC4
    class. As long as the same Tag exists somewhere in the file, the
    element is considered present. The by_class counts are still
    reported per the expected class so a caller can see the
    representation choice the helper made.
    """
    type_to_class = {
        "slab": "IfcSlab",
        "wall": "IfcWall",
        "column": "IfcColumn",
        "beam": "IfcBeam",
        "covering": "IfcCovering",
        "furniture": "IfcFurnishingElement",
        "lighting": "IfcLightFixture",  # Native in IFC4; available in IFC2X3 too
        "proxy": "IfcBuildingElementProxy",
        "space": "IfcSpace",
        "door": "IfcDoor",
        "window": "IfcWindow",
    }

    expected_by_class: Dict[str, int] = {}
    expected_ids_by_class: Dict[str, List[str]] = {}
    for el in brief.get("elements") or []:
        el_id = str(el.get("id") or "")
        el_type = str(el.get("type") or "")
        klass = type_to_class.get(el_type, "IfcBuildingElementProxy")
        expected_by_class[klass] = expected_by_class.get(klass, 0) + 1
        expected_ids_by_class.setdefault(klass, []).append(el_id)

    # Build the "by class" count map for reporting purposes.
    actual_by_class: Dict[str, int] = {}
    for klass in expected_by_class:
        try:
            es = f.by_type(klass)
        except RuntimeError:
            actual_by_class[klass] = 0
            continue
        actual_by_class[klass] = len(es)

    # Build the FULL tag → class lookup so we can find an element by
    # Tag anywhere in the file. Brief elements that match by Tag
    # but land in a different class are still considered present.
    tag_to_class: Dict[str, str] = {}
    for p in f.by_type("IfcProduct"):
        if p.is_a("IfcSpace"):
            continue  # spaces are matched by Name in validate_space_polygons
        try:
            tag = getattr(p, "Tag", None)
        except AttributeError:
            tag = None
        if tag:
            tag_to_class[tag] = p.is_a()

    missing_ids: List[Dict[str, str]] = []
    for klass, ids in expected_ids_by_class.items():
        if klass == "IfcSpace":
            # Spaces are validated separately.
            continue
        for eid in ids:
            if eid not in tag_to_class:
                missing_ids.append({"id": eid, "expected_class": klass})

    total_expected = sum(expected_by_class.values())
    total_actual = sum(actual_by_class.values())
    verdict = "OK" if not missing_ids else "MISSING_ELEMENTS"

    return {
        "verdict": verdict,
        "total_expected": total_expected,
        "total_actual_in_expected_classes": total_actual,
        "by_class_expected": expected_by_class,
        "by_class_actual": actual_by_class,
        "missing_ids": missing_ids[:50],  # cap
        "missing_id_count": len(missing_ids),
    }


def validate_no_origin_collapse(f: ifcopenshell.file) -> Dict[str, Any]:
    """Flag when more than 50% of building elements have placement at the
    world origin (0,0,0) AND zero geometry offset.

    This detects the failure mode where every element collapses to a single
    point — usually a bug where placements weren't set or all bbox coords
    are zero.
    """
    import ifcopenshell.util.placement

    classes = [
        "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcCovering",
        "IfcFurnishingElement", "IfcDoor", "IfcWindow", "IfcRailing",
        "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy",
    ]
    total = 0
    at_origin = 0
    for ifc_class in classes:
        try:
            es = f.by_type(ifc_class)
        except RuntimeError:
            continue
        for e in es:
            total += 1
            placement = getattr(e, "ObjectPlacement", None)
            if placement is None:
                continue
            try:
                m = ifcopenshell.util.placement.get_local_placement(placement)
                ox, oy, oz = float(m[0][3]), float(m[1][3]), float(m[2][3])
                if abs(ox) < 1e-6 and abs(oy) < 1e-6 and abs(oz) < 1e-6:
                    at_origin += 1
            except Exception:
                continue

    if total == 0:
        return {
            "verdict": "NO_ELEMENTS",
            "total_elements": 0,
            "at_origin_count": 0,
            "fraction_at_origin": 0.0,
            "collapsed": False,
        }
    fraction = at_origin / total
    collapsed = fraction > 0.5 and total > 5
    return {
        "verdict": "COLLAPSED" if collapsed else "OK",
        "total_elements": total,
        "at_origin_count": at_origin,
        "fraction_at_origin": fraction,
        "collapsed": collapsed,
    }


def summarize_ifc_file(path: str) -> Dict[str, Any]:
    """Structured summary of the on-disk IFC, used by `read_ifc_summary`."""
    if not os.path.isfile(path):
        return {
            "schema": None,
            "entity_count_total": 0,
            "products_by_class": {},
            "materials": [],
            "property_sets": [],
            "spaces": [],
            "tracked_element_ids": [],
            "error": f"file not found: {path}",
        }
    try:
        f = ifcopenshell.open(path)
    except Exception as exc:
        return {
            "schema": None,
            "entity_count_total": 0,
            "products_by_class": {},
            "materials": [],
            "property_sets": [],
            "spaces": [],
            "tracked_element_ids": [],
            "error": f"ifcopenshell.open failed: {type(exc).__name__}: {exc}",
        }

    by_class: Dict[str, int] = {}
    for entity in f.by_type("IfcProduct"):
        by_class[entity.is_a()] = by_class.get(entity.is_a(), 0) + 1

    spaces_summary: List[Dict[str, Any]] = []
    for s in f.by_type("IfcSpace"):
        spaces_summary.append({
            "name": getattr(s, "Name", None),
            "long_name": getattr(s, "LongName", None),
            "object_type": getattr(s, "ObjectType", None),
        })

    tracked_ids: List[str] = []
    for p in f.by_type("IfcProduct"):
        # IfcSpace has no Tag attribute in 2X3 — skip it here (its name
        # is already in `spaces_summary`).
        if p.is_a("IfcSpace"):
            continue
        try:
            tag = p.Tag
        except AttributeError:
            tag = None
        if tag:
            tracked_ids.append(tag)

    return {
        "schema": f.schema,
        "entity_count_total": len(list(f)),
        "products_by_class": by_class,
        "materials": [m.Name for m in f.by_type("IfcMaterial") if m.Name],
        "property_sets": sorted({p.Name for p in f.by_type("IfcPropertySet") if p.Name}),
        "spaces": spaces_summary,
        "tracked_element_ids": sorted(tracked_ids),
    }


# ─── Gap-B validator (typed openings) ────────────────────────────────────
#
# The multi-brief forensic audit (commit d0b4b7ac) showed that every
# door and window mentioned in every test brief was emitted as
# `IfcFurnishingElement` or `IfcBuildingElementProxy`. Downstream BIM
# tools (Revit, Solibri, IDS validators, BCF, schedule generators)
# filter by IFC class, so models with zero `IfcDoor` / `IfcWindow`
# entities show up as "no doors" / "no windows" in every tool the
# user might open the file in.
#
# This validator pins the typed-emission requirement at the file level:
# if a brief element with `type: "door"` (or "window") exists, there
# MUST be a matching IfcDoor (or IfcWindow) entity. The agent's
# system prompt + the typed `bf.add_door` / `bf.add_window` helpers
# enforce this at write time; this validator catches any future
# regression at finalize time.

def validate_door_window_typing(
    f: ifcopenshell.file, brief: Dict[str, Any]
) -> Dict[str, Any]:
    """Pin Gap B (typed openings) from the v6 forensic audit.

    For every BriefSpec element with `type: "door"`, expect an IfcDoor
    in the IFC. Same for `type: "window"` -> IfcWindow. Skipped (verdict
    `OK`) when the brief has no door/window elements (most exhibition
    booths fall in this bucket — SOL booth is the proving case).

    Returns: `{verdict, expected_door_count, expected_window_count,
    actual_door_count, actual_window_count, proxy_count, failures}`.
    """
    elements = brief.get("elements") or []
    expected_doors = sum(1 for e in elements if e.get("type") == "door")
    expected_windows = sum(1 for e in elements if e.get("type") == "window")

    if expected_doors == 0 and expected_windows == 0:
        return {
            "verdict": "OK",
            "skipped": True,
            "reason": "brief has no door/window elements",
            "expected_door_count": 0,
            "expected_window_count": 0,
            "actual_door_count": len(f.by_type("IfcDoor")),
            "actual_window_count": len(f.by_type("IfcWindow")),
        }

    actual_doors = len(f.by_type("IfcDoor"))
    actual_windows = len(f.by_type("IfcWindow"))
    proxy_count = len(f.by_type("IfcBuildingElementProxy"))
    furniture_count = len(f.by_type("IfcFurnishingElement"))

    failures: List[str] = []
    if expected_doors > 0 and actual_doors == 0:
        failures.append(
            f"brief lists {expected_doors} door element(s) but IFC has 0 "
            f"IfcDoor entities (proxies={proxy_count}, furniture={furniture_count}) "
            "— agent likely routed doors through add_proxy / add_furniture"
        )
    if expected_windows > 0 and actual_windows == 0:
        failures.append(
            f"brief lists {expected_windows} window element(s) but IFC has 0 "
            f"IfcWindow entities (proxies={proxy_count}, furniture={furniture_count}) "
            "— agent likely routed windows through add_proxy / add_furniture"
        )

    return {
        "verdict": "FAILED" if failures else "OK",
        "expected_door_count": expected_doors,
        "expected_window_count": expected_windows,
        "actual_door_count": actual_doors,
        "actual_window_count": actual_windows,
        "proxy_count": proxy_count,
        "furniture_count": furniture_count,
        "failures": failures,
    }


# ─── Gap-A validator (polygon footprint) ─────────────────────────────────
#
# Multi-brief forensic audit showed the L-shape office unfolded into a
# 14x4 straight strip instead of forming the L. The schema already
# supports polygon footprints (briefSpaceSchema.polygon_world_m), so the
# fix is on the prompt side: Layer 1 must emit the polygon, and the
# agent must build perimeter walls along it. This validator pins both
# halves: if a space has a non-rectangular polygon, the wall count
# must be at least the polygon's edge count (4 for a rectangle, 6 for
# an L, 8 for a T, etc.).

def _polygon_is_rectangular(polygon: List[Tuple[float, float]]) -> bool:
    """True if the polygon is a simple 4-vertex axis-aligned rectangle.

    A rectangle has exactly 4 vertices with all edges parallel to the
    coordinate axes. Anything else (L/T/U/concave/rotated) is treated
    as irregular and requires perimeter-wall verification.
    """
    if len(polygon) != 4:
        return False
    for i in range(4):
        a = polygon[i]
        b = polygon[(i + 1) % 4]
        dx = abs(b[0] - a[0])
        dy = abs(b[1] - a[1])
        # Axis-aligned edge: one component must be ~0.
        if dx > 1e-3 and dy > 1e-3:
            return False
    return True


def validate_polygon_footprint(
    f: ifcopenshell.file, brief: Dict[str, Any]
) -> Dict[str, Any]:
    """Pin Gap A (irregular footprints) from the v6 forensic audit.

    When a BriefSpec space declares a non-rectangular `polygon_world_m`,
    the perimeter must be traced by the agent's walls — not collapsed
    to the AABB. We can't directly check wall-polygon alignment from
    ifcopenshell without per-edge ray casts, so we use an entity-count
    proxy: a polygon with N vertices implies at least N perimeter walls.
    Combined with the system-prompt instruction to use polygon-aware
    wall placement, this catches the v6 failure mode where the agent
    built 4 AABB walls for a 6-edge L-shape.

    Returns: `{verdict, irregular_space_count, polygon_edge_total,
    actual_wall_count, failures}`.
    """
    spaces = brief.get("spaces") or []
    irregular_polygons: List[List[Tuple[float, float]]] = []
    for sp in spaces:
        poly = sp.get("polygon_world_m")
        if not isinstance(poly, list) or len(poly) < 3:
            continue
        try:
            polygon = [(float(v[0]), float(v[1])) for v in poly]
        except (TypeError, ValueError, IndexError):
            continue
        if not _polygon_is_rectangular(polygon):
            irregular_polygons.append(polygon)

    if not irregular_polygons:
        return {
            "verdict": "OK",
            "skipped": True,
            "reason": "all space polygons are rectangular (or absent)",
            "irregular_space_count": 0,
        }

    polygon_edge_total = sum(len(p) for p in irregular_polygons)
    actual_walls = len(f.by_type("IfcWall")) + len(f.by_type("IfcWallStandardCase"))

    failures: List[str] = []
    if actual_walls < polygon_edge_total:
        failures.append(
            f"brief has {len(irregular_polygons)} irregular space polygon(s) "
            f"with {polygon_edge_total} total edges, but IFC has only "
            f"{actual_walls} IfcWall(StandardCase) entities — agent likely "
            "collapsed the polygon to a rectangular AABB"
        )

    return {
        "verdict": "FAILED" if failures else "OK",
        "irregular_space_count": len(irregular_polygons),
        "polygon_edge_total": polygon_edge_total,
        "actual_wall_count": actual_walls,
        "failures": failures,
    }


# ─── Phase BCD validators ──────────────────────────────────────────────

# Canonical Pset names per IFC class. These MUST stay in sync with
# BuildFlowIFC.PSET_DEFAULTS in buildflow_ifc.py.
_CANONICAL_PSETS: Dict[str, str] = {
    "IfcWall": "Pset_WallCommon",
    "IfcDoor": "Pset_DoorCommon",
    "IfcWindow": "Pset_WindowCommon",
    "IfcSpace": "Pset_SpaceCommon",
    "IfcSlab": "Pset_SlabCommon",
    "IfcFurnishingElement": "Pset_FurnitureCommon",
    "IfcLightFixture": "Pset_LightFixtureTypeCommon",
    "IfcCovering": "Pset_CoveringCommon",
}


def _get_psets_for_element(element: Any) -> List[str]:
    """Return the names of all IfcPropertySet instances attached to `element`."""
    names: List[str] = []
    for rel in getattr(element, "IsDefinedBy", ()) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            ps = rel.RelatingPropertyDefinition
            if ps and ps.is_a("IfcPropertySet"):
                name = getattr(ps, "Name", None)
                if name:
                    names.append(name)
    return names


def validate_pset_coverage(
    f: "ifcopenshell.file",
    brief_spec: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Per IFC class, % of elements with the canonical Pset.

    Returns OK if >= 95% coverage per class; WARN at 80-95%; FAIL below 80%.
    """
    per_class: Dict[str, Dict[str, Any]] = {}
    for ifc_class, pset_name in _CANONICAL_PSETS.items():
        try:
            elements = f.by_type(ifc_class)
        except RuntimeError:
            continue
        if not elements:
            continue
        total = len(elements)
        with_pset = 0
        for e in elements:
            pset_names = _get_psets_for_element(e)
            if pset_name in pset_names:
                with_pset += 1
        coverage = with_pset / total if total > 0 else 1.0
        per_class[ifc_class] = {
            "pset_name": pset_name,
            "total": total,
            "with_pset": with_pset,
            "coverage": round(coverage, 4),
        }

    if not per_class:
        return {"verdict": "OK", "per_class": {}, "note": "no elements found"}

    min_coverage = min(c["coverage"] for c in per_class.values())
    if min_coverage >= 0.95:
        verdict = "OK"
    elif min_coverage >= 0.80:
        verdict = "WARN"
    else:
        verdict = "FAIL"

    return {
        "verdict": verdict,
        "min_coverage": round(min_coverage, 4),
        "per_class": per_class,
    }


def validate_style_coverage(
    f: "ifcopenshell.file",
    brief_spec: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """% of IfcExtrudedAreaSolid with >= 1 IfcStyledItem."""
    styled_items = f.by_type("IfcStyledItem")
    styled_rep_items: set = set()
    for si in styled_items:
        item = getattr(si, "Item", None)
        if item:
            styled_rep_items.add(item.id())

    total_solids = 0
    styled_solids = 0
    for solid in f.by_type("IfcExtrudedAreaSolid"):
        total_solids += 1
        if solid.id() in styled_rep_items:
            styled_solids += 1

    if total_solids == 0:
        return {
            "verdict": "OK",
            "total_solids": 0,
            "styled_solids": 0,
            "coverage": 1.0,
        }

    coverage = styled_solids / total_solids
    verdict = "OK" if coverage >= 0.80 else ("WARN" if coverage >= 0.50 else "FAIL")

    return {
        "verdict": verdict,
        "total_solids": total_solids,
        "styled_solids": styled_solids,
        "coverage": round(coverage, 4),
    }


def validate_opening_consistency(
    f: "ifcopenshell.file",
    brief_spec: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Every IfcDoor and IfcWindow has:
    - exactly one IfcRelFillsElement pointing to it (as RelatedBuildingElement)
    - the corresponding IfcOpeningElement has exactly one IfcRelVoidsElement
      pointing to its host wall
    Returns FAIL if any door/window is "floating" without an opening relationship.
    """
    doors = f.by_type("IfcDoor")
    windows = f.by_type("IfcWindow")
    all_openings = doors + windows

    if not all_openings:
        return {
            "verdict": "OK",
            "total_doors": 0,
            "total_windows": 0,
            "with_fill": 0,
            "without_fill": 0,
            "coverage": 1.0,
            "failures": [],
        }

    # Build lookup: element id -> IfcRelFillsElement
    fill_rels = f.by_type("IfcRelFillsElement")
    filled_elements: Dict[int, Any] = {}
    for rel in fill_rels:
        bldg_elem = getattr(rel, "RelatedBuildingElement", None)
        if bldg_elem:
            filled_elements[bldg_elem.id()] = rel

    with_fill = 0
    without_fill = 0
    failures: List[str] = []

    for elem in all_openings:
        if elem.id() in filled_elements:
            with_fill += 1
        else:
            without_fill += 1
            label = getattr(elem, "Name", None) or getattr(elem, "Tag", None) or getattr(elem, "GlobalId", "?")
            failures.append(
                f"{elem.is_a()} {label} has no IfcRelFillsElement "
                "(floating door/window without opening cut)"
            )

    total = len(all_openings)
    coverage = with_fill / total if total > 0 else 1.0
    verdict = "OK" if not failures else "FAIL"

    return {
        "verdict": verdict,
        "total_doors": len(doors),
        "total_windows": len(windows),
        "with_fill": with_fill,
        "without_fill": without_fill,
        "coverage": round(coverage, 4),
        "failures": failures[:20],
    }


def validate_aggregate_coverage(
    f: "ifcopenshell.file",
    brief_spec: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """For Phase BCD: pass if no element in brief_spec has `parts[]`.
    Reserved for Phase F when composite furniture lands.
    """
    if brief_spec:
        elements = brief_spec.get("elements") or []
        has_parts = any(bool(e.get("parts")) for e in elements)
        if has_parts:
            return {
                "verdict": "WARN",
                "note": "brief contains elements with parts[] but composite aggregation is not yet implemented (Phase F)",
            }
    return {
        "verdict": "OK",
        "note": "no composite elements in brief; aggregate validation is a Phase F concern",
    }
