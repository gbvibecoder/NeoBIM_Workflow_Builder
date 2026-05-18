"""Site context emitter (Node 16).

Adds surrounding context to every IFC: site polygon, ground plane,
north arrow indicator, and Pset_SiteCommon.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple


def add_site_context(bf: Any, building_polygon: List[Tuple[float, float]]) -> None:
    """Add site context around the building footprint.

    - IfcSite polygon = 5x the building footprint (centered)
    - Ground plane covering = IfcCovering outside building
    - North arrow marker = small triangular element pointing +Y
    - Pset_SiteCommon on the IfcSite
    """
    if not building_polygon or len(building_polygon) < 3:
        return

    # Compute building bbox
    xs = [float(p[0]) for p in building_polygon]
    ys = [float(p[1]) for p in building_polygon]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    bw = max_x - min_x
    bh = max_y - min_y
    bcx = (min_x + max_x) / 2.0
    bcy = (min_y + max_y) / 2.0

    # Site bounds = 3x building in each direction from center
    margin = max(bw, bh) * 1.5
    site_min_x = bcx - margin
    site_min_y = bcy - margin
    site_max_x = bcx + margin
    site_max_y = bcy + margin
    site_w = site_max_x - site_min_x
    site_h = site_max_y - site_min_y

    # Ground plane covering
    ground_mat = _find_ground_material(bf)
    if site_w > 0.1 and site_h > 0.1:
        try:
            bf.add_covering(
                "SITE-ground",
                origin=(site_min_x, site_min_y, -0.02),
                dims=(site_w, site_h),
                depth=0.02,
                material=ground_mat,
                predefined_type="FLOORING",
                description="Site ground plane",
                tag="SITE-ground",
            )
        except Exception:
            pass

    # North arrow — small triangular marker at site edge
    arrow_x = bcx
    arrow_y = site_max_y - 1.0
    try:
        bf.add_proxy(
            "SITE-north-arrow",
            origin=(arrow_x - 0.15, arrow_y, 0.0),
            dims=(0.3, 0.3),
            depth=0.5,
            material=ground_mat,
            object_type="North Arrow Indicator",
            composition="ELEMENT",
            description="North direction indicator (+Y)",
            tag="SITE-north-arrow",
        )
    except Exception:
        pass

    # Pset_SiteCommon on IfcSite
    try:
        import ifcopenshell.api
        site = bf._site
        pset = ifcopenshell.api.run(
            "pset.add_pset", bf._ifc, product=site, name="Pset_SiteCommon",
        )
        ifcopenshell.api.run("pset.edit_pset", bf._ifc, pset=pset, properties={
            "BuildableArea": round(abs(_polygon_area(building_polygon)), 2),
            "TotalArea": round(site_w * site_h, 2),
            "BuildingHeightLimit": float(bf._brief.get("site", {}).get("height_limit_m", 15.0)),
        })
    except Exception:
        pass


def _find_ground_material(bf: Any) -> str:
    """Find a ground/site material from the registered materials."""
    for mid in bf._materials_by_id:
        if "site" in mid.lower() or "ground" in mid.lower() or "grass" in mid.lower() or "soil" in mid.lower():
            return mid
    # Fallback to first material
    if bf._materials_by_id:
        return next(iter(bf._materials_by_id.keys()))
    return "mat-site-ground"


def _polygon_area(poly: List[Tuple[float, float]]) -> float:
    n = len(poly)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1]
    return area / 2.0
