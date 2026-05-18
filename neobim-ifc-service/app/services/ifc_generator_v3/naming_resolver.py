"""Naming resolver (Node 10).

After the builder finishes, walk every IfcElement and assign a
human-readable Name following a compass-direction + index convention.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional


def apply_naming_convention(bf: Any, brief_spec: Dict[str, Any]) -> None:
    """Rename every tracked element in the BuildFlowIFC instance to a
    human-readable convention.

    Convention per class:
      IfcWall      -> "Wall-S-01", "Wall-E-02" (compass from centroid)
      IfcDoor      -> "Door-Entry-01", "Door-Bedroom1-01"
      IfcWindow    -> "Window-South-01"
      IfcFurnishing-> "Workstation-01", "Bed-Master-01"
      IfcLightFixture -> "LEDPanel-OpenOffice-01"
      IfcSlab      -> "Slab-Floor-01", "Slab-Roof-01"
    """
    # Build centroid from all spaces for compass calculation
    all_x, all_y = [], []
    for sp in (brief_spec.get("spaces") or []):
        for pt in (sp.get("polygon_world_m") or []):
            try:
                all_x.append(float(pt[0]))
                all_y.append(float(pt[1]))
            except (TypeError, IndexError, ValueError):
                pass
    cx = sum(all_x) / len(all_x) if all_x else 0.0
    cy = sum(all_y) / len(all_y) if all_y else 0.0

    # Build space lookup for anchor names
    space_names: Dict[str, str] = {}
    for sp in (brief_spec.get("spaces") or []):
        sid = str(sp.get("id", ""))
        space_names[sid] = str(sp.get("name", sid)).replace(" ", "")

    # Counter per class prefix
    counters: Dict[str, int] = {}

    def _next_idx(prefix: str) -> str:
        counters[prefix] = counters.get(prefix, 0) + 1
        return f"{counters[prefix]:02d}"

    for elem_id, elem in bf._elements_by_id.items():
        ifc_class = elem.is_a()
        old_name = getattr(elem, "Name", "") or elem_id
        # Save original name in Description if useful
        desc = getattr(elem, "Description", "") or ""
        if old_name and old_name != elem_id and not desc:
            try:
                elem.Description = old_name
            except Exception:
                pass

        new_name = old_name  # fallback

        if ifc_class == "IfcWall":
            direction = _compass_direction(elem, cx, cy, bf)
            new_name = f"Wall-{direction}-{_next_idx('Wall-' + direction)}"

        elif ifc_class == "IfcDoor":
            space = _find_anchor_space(elem_id, brief_spec)
            label = space_names.get(space, "Entry") if space else "Entry"
            new_name = f"Door-{label}-{_next_idx('Door-' + label)}"

        elif ifc_class == "IfcWindow":
            direction = _compass_direction(elem, cx, cy, bf)
            new_name = f"Window-{direction}-{_next_idx('Window-' + direction)}"

        elif ifc_class == "IfcSlab":
            if "roof" in old_name.lower() or "roof" in desc.lower():
                new_name = f"Slab-Roof-{_next_idx('Slab-Roof')}"
            else:
                new_name = f"Slab-Floor-{_next_idx('Slab-Floor')}"

        elif ifc_class == "IfcFurnishingElement":
            obj_type = getattr(elem, "ObjectType", "") or ""
            if obj_type:
                label = obj_type.replace(" ", "")[:20]
            else:
                label = "Furniture"
            space = _find_anchor_space(elem_id, brief_spec)
            space_label = space_names.get(space, "") if space else ""
            prefix = f"{label}-{space_label}" if space_label else label
            new_name = f"{prefix}-{_next_idx(prefix)}"

        elif ifc_class == "IfcLightFixture":
            obj_type = getattr(elem, "ObjectType", "") or "Light"
            label = obj_type.replace(" ", "")[:15]
            space = _find_anchor_space(elem_id, brief_spec)
            space_label = space_names.get(space, "") if space else ""
            prefix = f"{label}-{space_label}" if space_label else label
            new_name = f"{prefix}-{_next_idx(prefix)}"

        elif ifc_class in ("IfcColumn", "IfcBeam", "IfcCovering"):
            new_name = f"{ifc_class[3:]}-{_next_idx(ifc_class[3:])}"

        try:
            elem.Name = new_name
        except Exception:
            pass


def _compass_direction(elem: Any, cx: float, cy: float, bf: Any) -> str:
    """Determine compass direction of an element relative to building centroid."""
    try:
        placement = elem.ObjectPlacement
        if placement and placement.RelativePlacement:
            loc = placement.RelativePlacement.Location
            if loc:
                coords = loc.Coordinates
                ex, ey = float(coords[0]), float(coords[1])
                angle = math.atan2(ey - cy, ex - cx)
                deg = math.degrees(angle) % 360
                if deg < 45 or deg >= 315:
                    return "E"
                elif deg < 135:
                    return "N"
                elif deg < 225:
                    return "W"
                else:
                    return "S"
    except Exception:
        pass
    return "X"


def _find_anchor_space(elem_id: str, brief_spec: Dict[str, Any]) -> Optional[str]:
    """Look up the contained_in_space_id for an element or furniture."""
    for el in (brief_spec.get("elements") or []):
        if str(el.get("id", "")) == elem_id:
            return el.get("contained_in_space_id")
    for f in (brief_spec.get("furniture") or []):
        fid = str(f.get("id", ""))
        if fid == elem_id or elem_id.startswith(fid + "-"):
            return f.get("anchor_space_id")
    for zone in (brief_spec.get("lighting", {}).get("zones") or []):
        if elem_id.startswith("LT-"):
            return zone.get("anchor_space_id")
    return None
