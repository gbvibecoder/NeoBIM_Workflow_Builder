"""Furniture compositor (Node 15).

Multi-part furniture using IfcRelAggregates. Each composite type has a
catalogue of parts with relative offsets and dimensions.

Usage:
    from furniture_compositor import compose_furniture
    parent_id = compose_furniture(bf, "workstation", (5.0, 3.0, 0.0), 0.0, "mat-laminate-white")
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import ifcopenshell
import ifcopenshell.guid


# ── Part definition ─────────────────────────────────────────────────────

class Part:
    __slots__ = ("suffix", "rel_origin", "dims", "depth", "mat_hint", "obj_type")

    def __init__(
        self,
        suffix: str,
        rel_origin: Tuple[float, float, float],
        dims: Tuple[float, float],
        depth: float,
        mat_hint: str = "",
        obj_type: str = "",
    ):
        self.suffix = suffix
        self.rel_origin = rel_origin
        self.dims = dims
        self.depth = depth
        self.mat_hint = mat_hint
        self.obj_type = obj_type


# ── Composite catalogue ─────────────────────────────────────────────────

def _workstation() -> List[Part]:
    return [
        Part("desk-top", (0, 0, 0.72), (1.2, 0.6), 0.03, "laminate", "Desk Top"),
        Part("desk-left-leg", (0.02, 0.05, 0), (0.04, 0.5), 0.72, "steel", "Desk Leg"),
        Part("desk-right-leg", (1.14, 0.05, 0), (0.04, 0.5), 0.72, "steel", "Desk Leg"),
        Part("pedestal", (0.05, 0.05, 0), (0.4, 0.5), 0.65, "steel", "Pedestal"),
        Part("monitor-stand", (0.45, 0.35, 0.75), (0.3, 0.05), 0.35, "steel", "Monitor Arm"),
        Part("monitor", (0.3, 0.38, 1.0), (0.55, 0.03), 0.35, "plastic-black", "Monitor"),
        Part("keyboard", (0.3, 0.1, 0.73), (0.44, 0.15), 0.02, "plastic-black", "Keyboard"),
        Part("mouse", (0.8, 0.15, 0.73), (0.06, 0.1), 0.03, "plastic-black", "Mouse"),
        Part("chair-base", (0.5, -0.3, 0), (0.5, 0.5), 0.05, "plastic-black", "Chair Base"),
        Part("chair-column", (0.72, -0.08, 0.05), (0.06, 0.06), 0.35, "chrome", "Chair Column"),
        Part("chair-seat", (0.5, -0.3, 0.42), (0.45, 0.45), 0.05, "fabric", "Chair Seat"),
        Part("chair-back", (0.5, -0.5, 0.47), (0.45, 0.04), 0.45, "fabric", "Chair Back"),
    ]


def _meeting_chair() -> List[Part]:
    return [
        Part("seat", (0, 0, 0.42), (0.45, 0.45), 0.05, "fabric", "Chair Seat"),
        Part("back", (0, -0.2, 0.47), (0.45, 0.04), 0.40, "fabric", "Chair Back"),
        Part("leg-fl", (0.03, 0.03, 0), (0.03, 0.03), 0.42, "chrome", "Leg"),
        Part("leg-fr", (0.39, 0.03, 0), (0.03, 0.03), 0.42, "chrome", "Leg"),
        Part("leg-bl", (0.03, 0.39, 0), (0.03, 0.03), 0.42, "chrome", "Leg"),
        Part("leg-br", (0.39, 0.39, 0), (0.03, 0.03), 0.42, "chrome", "Leg"),
    ]


def _bed_master() -> List[Part]:
    return [
        Part("frame", (0, 0, 0.15), (2.0, 1.6), 0.20, "wood", "Bed Frame"),
        Part("headboard", (0, 1.55, 0.15), (2.0, 0.05), 0.90, "wood", "Headboard"),
        Part("mattress", (0.05, 0.05, 0.35), (1.9, 1.5), 0.20, "fabric", "Mattress"),
        Part("pillow-l", (0.15, 1.2, 0.55), (0.6, 0.4), 0.12, "fabric", "Pillow"),
        Part("pillow-r", (1.25, 1.2, 0.55), (0.6, 0.4), 0.12, "fabric", "Pillow"),
        Part("nightstand-l", (-0.5, 0.8, 0), (0.45, 0.4), 0.55, "wood", "Nightstand"),
        Part("nightstand-r", (2.05, 0.8, 0), (0.45, 0.4), 0.55, "wood", "Nightstand"),
        Part("lamp-l", (-0.35, 0.9, 0.55), (0.15, 0.15), 0.35, "brass", "Bedside Lamp"),
        Part("lamp-r", (2.2, 0.9, 0.55), (0.15, 0.15), 0.35, "brass", "Bedside Lamp"),
    ]


def _wardrobe() -> List[Part]:
    return [
        Part("body", (0, 0, 0), (1.2, 0.55), 2.0, "wood", "Wardrobe Body"),
        Part("door-l", (0, 0, 0), (0.6, 0.02), 2.0, "laminate", "Wardrobe Door"),
        Part("door-r", (0.6, 0, 0), (0.6, 0.02), 2.0, "laminate", "Wardrobe Door"),
        Part("handle-l", (0.55, -0.03, 1.0), (0.02, 0.03), 0.10, "steel", "Handle"),
        Part("handle-r", (0.63, -0.03, 1.0), (0.02, 0.03), 0.10, "steel", "Handle"),
        Part("shelf-1", (0.02, 0.02, 0.5), (1.16, 0.51), 0.02, "wood", "Shelf"),
        Part("shelf-2", (0.02, 0.02, 1.0), (1.16, 0.51), 0.02, "wood", "Shelf"),
        Part("shelf-3", (0.02, 0.02, 1.5), (1.16, 0.51), 0.02, "wood", "Shelf"),
    ]


def _kitchen_counter() -> List[Part]:
    return [
        Part("base-1", (0, 0, 0), (0.6, 0.6), 0.85, "wood", "Base Cabinet"),
        Part("base-2", (0.62, 0, 0), (0.6, 0.6), 0.85, "wood", "Base Cabinet"),
        Part("base-3", (1.24, 0, 0), (0.6, 0.6), 0.85, "wood", "Base Cabinet"),
        Part("base-4", (1.86, 0, 0), (0.6, 0.6), 0.85, "wood", "Base Cabinet"),
        Part("counter-top", (0, 0, 0.85), (2.5, 0.65), 0.04, "granite", "Counter Top"),
        Part("splash", (0, 0.6, 0.85), (2.5, 0.02), 0.55, "tile", "Splash Back"),
        Part("upper-1", (0, 0.05, 1.4), (0.6, 0.35), 0.7, "wood", "Upper Cabinet"),
        Part("upper-2", (0.62, 0.05, 1.4), (0.6, 0.35), 0.7, "wood", "Upper Cabinet"),
        Part("upper-3", (1.24, 0.05, 1.4), (0.6, 0.35), 0.7, "wood", "Upper Cabinet"),
        Part("sink", (1.0, 0.1, 0.82), (0.5, 0.4), 0.20, "steel", "Sink"),
        Part("tap", (1.2, 0.5, 0.89), (0.04, 0.04), 0.25, "chrome", "Tap"),
    ]


def _treadmill() -> List[Part]:
    return [
        Part("base", (0, 0, 0), (1.8, 0.7), 0.15, "plastic-black", "Treadmill Base"),
        Part("belt", (0.2, 0.1, 0.15), (1.4, 0.5), 0.02, "rubber", "Belt"),
        Part("console", (0.1, 0.05, 1.0), (0.5, 0.15), 0.35, "plastic-black", "Console"),
        Part("rail-l", (0.05, 0.15, 0.15), (0.04, 0.04), 0.9, "steel", "Handrail"),
        Part("rail-r", (1.71, 0.15, 0.15), (0.04, 0.04), 0.9, "steel", "Handrail"),
    ]


def _weight_rack() -> List[Part]:
    return [
        Part("frame", (0, 0, 0), (1.2, 0.5), 1.5, "steel", "Rack Frame"),
        Part("shelf-1", (0.02, 0.02, 0.15), (1.16, 0.46), 0.03, "steel", "Shelf"),
        Part("shelf-2", (0.02, 0.02, 0.55), (1.16, 0.46), 0.03, "steel", "Shelf"),
        Part("shelf-3", (0.02, 0.02, 0.95), (1.16, 0.46), 0.03, "steel", "Shelf"),
        Part("db-pair-1", (0.1, 0.1, 0.18), (0.15, 0.3), 0.15, "iron", "Dumbbell 5kg"),
        Part("db-pair-2", (0.35, 0.1, 0.18), (0.17, 0.3), 0.17, "iron", "Dumbbell 10kg"),
        Part("db-pair-3", (0.6, 0.1, 0.18), (0.19, 0.3), 0.19, "iron", "Dumbbell 15kg"),
        Part("db-pair-4", (0.1, 0.1, 0.58), (0.20, 0.3), 0.20, "iron", "Dumbbell 20kg"),
        Part("db-pair-5", (0.35, 0.1, 0.58), (0.22, 0.3), 0.22, "iron", "Dumbbell 25kg"),
        Part("db-pair-6", (0.6, 0.1, 0.58), (0.24, 0.3), 0.24, "iron", "Dumbbell 30kg"),
    ]


def _display_booth() -> List[Part]:
    return [
        Part("back-wall", (0, 2.8, 0), (3.0, 0.08), 2.5, "laminate", "Back Wall"),
        Part("side-l", (0, 0, 0), (0.08, 2.8), 2.5, "laminate", "Side Wall"),
        Part("side-r", (2.92, 0, 0), (0.08, 2.8), 2.5, "laminate", "Side Wall"),
        Part("counter", (0.5, 0.1, 0), (2.0, 0.6), 1.0, "laminate", "Info Counter"),
        Part("monitor-l", (0.4, 2.6, 1.2), (0.6, 0.04), 0.4, "plastic-black", "Monitor"),
        Part("monitor-r", (2.0, 2.6, 1.2), (0.6, 0.04), 0.4, "plastic-black", "Monitor"),
    ]


def _retail_rack() -> List[Part]:
    return [
        Part("base", (0, 0, 0), (1.0, 0.4), 0.05, "steel", "Rack Base"),
        Part("back", (0, 0.38, 0.05), (1.0, 0.02), 1.75, "steel", "Back Panel"),
        Part("side-l", (0, 0, 0.05), (0.02, 0.4), 1.75, "steel", "Side Panel"),
        Part("side-r", (0.98, 0, 0.05), (0.02, 0.4), 1.75, "steel", "Side Panel"),
        Part("shelf-1", (0.02, 0.02, 0.35), (0.96, 0.36), 0.02, "steel", "Shelf"),
        Part("shelf-2", (0.02, 0.02, 0.75), (0.96, 0.36), 0.02, "steel", "Shelf"),
        Part("shelf-3", (0.02, 0.02, 1.15), (0.96, 0.36), 0.02, "steel", "Shelf"),
        Part("shelf-4", (0.02, 0.02, 1.55), (0.96, 0.36), 0.02, "steel", "Shelf"),
    ]


def _restaurant_table_4() -> List[Part]:
    return [
        Part("table-top", (0, 0, 0.72), (0.8, 0.8), 0.04, "wood", "Table Top"),
        Part("table-pedestal", (0.3, 0.3, 0), (0.2, 0.2), 0.72, "steel", "Table Pedestal"),
        Part("chair-1-seat", (-0.55, 0.18, 0.42), (0.42, 0.42), 0.04, "fabric", "Chair Seat"),
        Part("chair-1-back", (-0.55, -0.02, 0.46), (0.42, 0.03), 0.38, "fabric", "Chair Back"),
        Part("chair-1-leg1", (-0.52, 0.20, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-1-leg2", (-0.16, 0.20, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-1-leg3", (-0.52, 0.55, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-1-leg4", (-0.16, 0.55, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-2-seat", (1.0, 0.18, 0.42), (0.42, 0.42), 0.04, "fabric", "Chair Seat"),
        Part("chair-2-back", (1.0, 0.57, 0.46), (0.42, 0.03), 0.38, "fabric", "Chair Back"),
        Part("chair-2-leg1", (1.03, 0.20, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-2-leg2", (1.39, 0.20, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-2-leg3", (1.03, 0.55, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-2-leg4", (1.39, 0.55, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-3-seat", (0.18, -0.55, 0.42), (0.42, 0.42), 0.04, "fabric", "Chair Seat"),
        Part("chair-3-back", (-0.02, -0.55, 0.46), (0.03, 0.42), 0.38, "fabric", "Chair Back"),
        Part("chair-3-leg1", (0.20, -0.52, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-3-leg2", (0.55, -0.52, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-3-leg3", (0.20, -0.16, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-3-leg4", (0.55, -0.16, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-4-seat", (0.18, 1.0, 0.42), (0.42, 0.42), 0.04, "fabric", "Chair Seat"),
        Part("chair-4-back", (0.57, 1.0, 0.46), (0.03, 0.42), 0.38, "fabric", "Chair Back"),
        Part("chair-4-leg1", (0.20, 1.03, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-4-leg2", (0.55, 1.03, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-4-leg3", (0.20, 1.39, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
        Part("chair-4-leg4", (0.55, 1.39, 0), (0.03, 0.03), 0.42, "steel", "Chair Leg"),
    ]


def _student_desk() -> List[Part]:
    return [
        Part("top", (0, 0, 0.72), (0.6, 0.45), 0.025, "plywood", "Desk Top"),
        Part("leg-l", (0.02, 0.02, 0), (0.03, 0.41), 0.72, "steel", "Desk Leg"),
        Part("leg-r", (0.55, 0.02, 0), (0.03, 0.41), 0.72, "steel", "Desk Leg"),
        Part("shelf", (0.05, 0.05, 0.35), (0.50, 0.35), 0.02, "plywood", "Book Shelf"),
    ]


# ── Registry ────────────────────────────────────────────────────────────

COMPOSITE_CATALOGUE: Dict[str, Any] = {
    "workstation": _workstation,
    "meeting_chair": _meeting_chair,
    "bed_master": _bed_master,
    "wardrobe": _wardrobe,
    "kitchen_counter": _kitchen_counter,
    "treadmill": _treadmill,
    "weight_rack": _weight_rack,
    "display_booth": _display_booth,
    "retail_rack": _retail_rack,
    "restaurant_table_4": _restaurant_table_4,
    "student_desk": _student_desk,
}


# ── Material hint resolver ──────────────────────────────────────────────

_HINT_TO_MAT: Dict[str, str] = {
    "laminate": "mat-laminate-white",
    "steel": "mat-steel-ms",
    "chrome": "mat-chrome",
    "wood": "mat-wood-teak",
    "plywood": "mat-plywood",
    "fabric": "mat-fabric-grey",
    "plastic-black": "mat-plastic-black",
    "rubber": "mat-rubber-gym",
    "iron": "mat-iron-cast",
    "brass": "mat-pendant-brass",
    "granite": "mat-stone-granite-black",
    "tile": "mat-tile-ceramic-white",
}


def _resolve_part_material(hint: str, fallback: str, bf: Any) -> str:
    """Resolve a part's material hint to a registered material id."""
    mat_id = _HINT_TO_MAT.get(hint, fallback)
    if mat_id in bf._materials_by_id:
        return mat_id
    # Fallback to first available
    if bf._materials_by_id:
        return next(iter(bf._materials_by_id.keys()))
    return fallback


# ── Public API ──────────────────────────────────────────────────────────

def compose_furniture(
    bf: Any,
    composite_type: str,
    origin: Tuple[float, float, float],
    rotation_rad: float = 0.0,
    default_material: str = "mat-laminate-white",
    parent_id: Optional[str] = None,
    contained_in_space_id: Optional[str] = None,
) -> Optional[str]:
    """Emit a composite furniture piece.

    Creates a parent IfcFurnishingElement (bounding box) and child
    elements for each part, linked via IfcRelAggregates.

    Returns the parent element id, or None if the composite type is
    not in the catalogue.
    """
    factory = COMPOSITE_CATALOGUE.get(composite_type)
    if not factory:
        return None

    parts = factory()
    pid = parent_id or f"COMP-{composite_type}-{id(origin)}"

    # Compute bounding box from parts
    max_x = max(p.rel_origin[0] + p.dims[0] for p in parts) if parts else 1.0
    max_y = max(p.rel_origin[1] + p.dims[1] for p in parts) if parts else 1.0
    max_z = max(p.rel_origin[2] + p.depth for p in parts) if parts else 1.0

    # Create parent element (the bounding box)
    try:
        parent = bf.add_furniture(
            pid, origin,
            dims=(max_x, max_y),
            depth=max_z,
            material=default_material,
            object_type=composite_type.replace("_", " ").title(),
            description=f"Composite: {composite_type} ({len(parts)} parts)",
            tag=pid,
            contained_in_space_id=contained_in_space_id,
        )
    except Exception:
        return None

    # Create child parts
    child_elements = []
    cos_r = math.cos(rotation_rad)
    sin_r = math.sin(rotation_rad)

    for part in parts:
        child_id = f"{pid}-{part.suffix}"
        # Rotate part relative origin
        rx = part.rel_origin[0] * cos_r - part.rel_origin[1] * sin_r
        ry = part.rel_origin[0] * sin_r + part.rel_origin[1] * cos_r
        child_origin = (
            origin[0] + rx,
            origin[1] + ry,
            origin[2] + part.rel_origin[2],
        )
        mat = _resolve_part_material(part.mat_hint, default_material, bf)
        try:
            child = bf.add_furniture(
                child_id, child_origin,
                dims=part.dims,
                depth=part.depth,
                material=mat,
                object_type=part.obj_type,
                description=f"Part of {composite_type}",
                tag=child_id,
                contained_in_space_id=contained_in_space_id,
            )
            child_elements.append(child)
        except Exception:
            continue

    # Link children to parent via IfcRelAggregates
    if child_elements:
        try:
            owner_history = bf._ifc.by_type("IfcOwnerHistory")
            oh = owner_history[0] if owner_history else None
            bf._ifc.create_entity(
                "IfcRelAggregates",
                GlobalId=ifcopenshell.guid.new(),
                OwnerHistory=oh,
                Name=f"Aggregates {pid}",
                RelatingObject=parent,
                RelatedObjects=child_elements,
            )
        except Exception:
            pass

    return pid
