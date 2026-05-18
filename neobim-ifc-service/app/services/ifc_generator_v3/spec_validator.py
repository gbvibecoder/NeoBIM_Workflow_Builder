"""BriefSpec structural validator (Node 6).

Validates internal consistency BEFORE the builder touches the spec.
Pure Python, no LLM, no ifcopenshell.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple


class SpecValidationResult:
    __slots__ = ("ok", "errors", "warnings")

    def __init__(self) -> None:
        self.ok: bool = True
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)
        self.ok = False

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def to_dict(self) -> Dict[str, Any]:
        return {"ok": self.ok, "errors": self.errors, "warnings": self.warnings}


def validate_brief_spec(spec: Dict[str, Any]) -> SpecValidationResult:
    """Run all consistency checks on a BriefSpec dict."""
    r = SpecValidationResult()

    spaces = spec.get("spaces") or []
    elements = spec.get("elements") or []
    materials = spec.get("materials") or []
    openings = spec.get("openings") or []
    furniture = spec.get("furniture") or []
    lighting = spec.get("lighting") or {}
    gp = spec.get("global_parameters") or {}

    space_ids = {str(s.get("id", "")) for s in spaces}
    material_ids = {str(m.get("id", "")) for m in materials}

    # Collect wall element ids (from elements[] with type=wall)
    wall_ids = set()
    for el in elements:
        if str(el.get("type", "")) == "wall":
            wall_ids.add(str(el.get("id", "")))
    # Also include perimeter walls the builder will generate
    for sp in spaces:
        sp_id = str(sp.get("id", ""))
        poly = sp.get("polygon_world_m") or []
        for i in range(len(poly)):
            wall_ids.add(f"W-{sp_id}-perim-{i}")

    # 1. Openings host_wall_id references
    for op in openings:
        hwid = str(op.get("host_wall_id", ""))
        if hwid and hwid not in wall_ids:
            r.warn(f"opening {op.get('id')}: host_wall_id '{hwid}' not found in wall elements (builder may generate it)")

    # 2. Furniture anchor_space_id
    for f in furniture:
        asid = str(f.get("anchor_space_id", ""))
        if asid and asid not in space_ids:
            r.error(f"furniture {f.get('id')}: anchor_space_id '{asid}' not in spaces")

    # 3. Lighting zone anchor_space_id
    for zone in lighting.get("zones") or []:
        asid = str(zone.get("anchor_space_id", ""))
        if asid and asid not in space_ids:
            r.error(f"lighting zone: anchor_space_id '{asid}' not in spaces")

    # 4. Material references
    for el in elements:
        mid = str(el.get("material_id", ""))
        if mid and mid not in material_ids:
            r.warn(f"element {el.get('id')}: material_id '{mid}' not in materials (library may resolve)")

    # 5. Space polygons CCW check
    for sp in spaces:
        poly = sp.get("polygon_world_m")
        if poly and len(poly) >= 3:
            area = _shoelace_area(poly)
            if area < 0:
                r.warn(f"space {sp.get('id')}: polygon is clockwise (should be CCW)")
            elif abs(area) < 0.01:
                r.error(f"space {sp.get('id')}: polygon has near-zero area ({area:.4f})")

    # 6. Self-intersection check (simplified — check consecutive edge pairs)
    for sp in spaces:
        poly = sp.get("polygon_world_m")
        if poly and len(poly) >= 4:
            if _polygon_self_intersects(poly):
                r.error(f"space {sp.get('id')}: polygon is self-intersecting")

    # 7. Opening fit within wall
    ceiling_h = float(gp.get("ceiling_height_m", 3.0))
    for op in openings:
        sill = float(op.get("sill_m", 0))
        height = float(op.get("height_m", 2.1))
        if sill + height > ceiling_h + 0.01:
            r.error(f"opening {op.get('id')}: sill ({sill}) + height ({height}) > ceiling ({ceiling_h})")

    # 8. Furniture count
    for f in furniture:
        count = f.get("count", 1)
        if isinstance(count, (int, float)) and count < 1:
            r.error(f"furniture {f.get('id')}: count must be >= 1, got {count}")

    # 9. Ceiling height sanity
    ch = float(gp.get("ceiling_height_m", 3.0))
    if ch < 2.1:
        r.error(f"global_parameters.ceiling_height_m ({ch}) too low (min 2.1m)")
    elif ch > 6.0:
        r.warn(f"global_parameters.ceiling_height_m ({ch}) unusually high (>6m)")

    # 10. At least one space
    if not spaces:
        r.error("spec has no spaces defined")

    # 11. At least one material
    if not materials:
        r.error("spec has no materials defined")

    return r


# ── Overreach detection ─────────────────────────────────────────────────

_OVERREACH_KEYWORDS = [
    "reception", "plant", "planter", "pooja", "niche",
    "ceiling fan", "ac unit", "air conditioner", "balcony",
    "storage closet", "utility room", "water cooler", "vending",
    "fire extinguisher", "cctv", "security", "signage",
]


def detect_overreach(spec: Dict[str, Any], brief_text: str) -> List[str]:
    """Detect elements in the spec that are NOT mentioned in the brief.

    Returns a list of overreach keywords found in the spec but absent
    from the brief text. Used by the faithfulness eval harness.
    """
    brief_lower = brief_text.lower()
    spec_texts: List[str] = []

    for el in spec.get("elements") or []:
        spec_texts.append(str(el.get("description", "")).lower())
        spec_texts.append(str(el.get("object_type", "")).lower())
        spec_texts.append(str(el.get("type", "")).lower())
    for f in spec.get("furniture") or []:
        spec_texts.append(str(f.get("type", "")).lower())
        spec_texts.append(str(f.get("description", "")).lower())
    for zone in (spec.get("lighting") or {}).get("zones") or []:
        spec_texts.append(str(zone.get("fixture_type", "")).lower())
    for sp in spec.get("spaces") or []:
        spec_texts.append(str(sp.get("name", "")).lower())
        spec_texts.append(str(sp.get("occupancy_type", "")).lower())

    spec_blob = " ".join(spec_texts)
    overreaches: List[str] = []
    for kw in _OVERREACH_KEYWORDS:
        if kw in spec_blob and kw not in brief_lower:
            overreaches.append(kw)
    return overreaches


def _shoelace_area(poly: List[Any]) -> float:
    """Signed area via shoelace. Positive = CCW."""
    n = len(poly)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        try:
            x0, y0 = float(poly[i][0]), float(poly[i][1])
            x1, y1 = float(poly[j][0]), float(poly[j][1])
            area += x0 * y1 - x1 * y0
        except (TypeError, IndexError, ValueError):
            continue
    return area / 2.0


def _polygon_self_intersects(poly: List[Any]) -> bool:
    """Check for self-intersecting polygon edges (O(n^2) but n is small)."""
    n = len(poly)
    edges = []
    for i in range(n):
        j = (i + 1) % n
        try:
            edges.append((
                (float(poly[i][0]), float(poly[i][1])),
                (float(poly[j][0]), float(poly[j][1])),
            ))
        except (TypeError, IndexError, ValueError):
            continue

    for i in range(len(edges)):
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1:
                continue  # Skip adjacent edges that share a vertex
            if _segments_intersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1]):
                return True
    return False


def _segments_intersect(
    p1: Tuple[float, float], p2: Tuple[float, float],
    p3: Tuple[float, float], p4: Tuple[float, float],
) -> bool:
    """Check if segments (p1-p2) and (p3-p4) intersect (excluding endpoints)."""
    d1 = _cross(p3, p4, p1)
    d2 = _cross(p3, p4, p2)
    d3 = _cross(p1, p2, p3)
    d4 = _cross(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def _cross(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
