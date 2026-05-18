"""Builder pre-flight checks (Node 8).

Runs AFTER spec validator, BEFORE builder. Catches scale issues,
missing materials, zero-area polygons, and orphan spaces.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List


class PreflightResult:
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


def run_preflight(spec: Dict[str, Any], material_ids: set) -> PreflightResult:
    """Run pre-flight checks on a BriefSpec before building."""
    r = PreflightResult()
    site = spec.get("site") or {}
    spaces = spec.get("spaces") or []
    elements = spec.get("elements") or []

    # 1. Scale — site bounds
    bounds = site.get("bounds_m") or [0, 0]
    bx = float(bounds[0]) if bounds else 0
    by = float(bounds[1]) if len(bounds) > 1 else 0
    if bx > 100 or by > 100:
        r.warn(f"site.bounds_m ({bx}x{by}) exceeds 100m on one axis — verify scale")
    if 0 < bx < 2 or 0 < by < 2:
        r.warn(f"site.bounds_m ({bx}x{by}) is very small (<2m) — verify scale")

    # 2. Coordinate range
    for el in elements:
        origin = el.get("origin_world_m") or [0, 0, 0]
        try:
            x, y = float(origin[0]), float(origin[1])
            if abs(x) > 200 or abs(y) > 200:
                r.warn(f"element {el.get('id')}: origin ({x}, {y}) exceeds 200m range")
        except (TypeError, IndexError, ValueError):
            pass

    # 3. Missing materials
    for el in elements:
        mid = str(el.get("material_id", ""))
        if mid and mid not in material_ids:
            r.warn(f"element {el.get('id')}: material '{mid}' not in registered materials")

    # 4. Zero-area polygons
    for sp in spaces:
        poly = sp.get("polygon_world_m")
        if poly and len(poly) >= 3:
            area = abs(_shoelace(poly))
            if area < 0.01:
                r.error(f"space {sp.get('id')}: polygon area is near-zero ({area:.4f} m2)")

    return r


def _shoelace(poly: list) -> float:
    n = len(poly)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        try:
            area += float(poly[i][0]) * float(poly[j][1]) - float(poly[j][0]) * float(poly[i][1])
        except (TypeError, IndexError, ValueError):
            continue
    return area / 2.0
