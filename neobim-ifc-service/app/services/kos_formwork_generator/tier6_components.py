"""Build Tier6FormworkComponent instances with canonical order + sequential IDs.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation).

Component emission rules:
  - WALLS sorted alphabetically by wall_id.
  - Within each wall: categories emitted in CANONICAL_CATEGORY_ORDER.
  - Component IDs: C-0001, C-0002, ... GLOBAL sequential across all walls.
  - Components with quantity == 0 are SKIPPED.
  - Wastage applied per-wall here (per DESIGN v2; matches PR 1 golden for P_INT_8).

Source rule format (must match PR 1 golden byte-equally):
  prop:          "{scheme.frb_source} + FRB §2.1 {pct}% wastage"
  kicker:        "FRB §9.4 RULE BI-14 ({k_letter} {spacing_mm}mm) + FRB §2.1 {pct}% wastage"
  base_plate:    "FRB §9.1 RULE BI-5 (1 per prop, hard surface) + FRB §2.1 {pct}% wastage"
  prop_head:     "FRB §9.1 RULE BI-6 (1 per prop) + FRB §2.1 {pct}% wastage"
  starter_track: "FRB §2.1 item 4 (starter track per wall thickness) + {pct}% wastage"
                  (no "FRB §2.1" prefix on the wastage part)
  waler:         "FRB §9.2 RULE BI-11 + FRB §2.1 {pct}% wastage"
  diagonal:      "FRB §9.5 RULE BI-18 + FRB §2.1 {pct}% wastage"
  joint_gasket:  "FRB §6 RULE JE-6 (provisional formula) + {pct}% wastage"
  raker_prop:    "FRB §9.4 RULE BI-16 (K8 + basement/retaining) + FRB §2.1 {pct}% wastage"
  corner_clamp:  "{corner.frb_source} + FRB §2.1 {pct}% wastage"
"""
from __future__ import annotations

import logging
import math
from typing import Callable, Dict, Tuple

from app.services.kos_formwork_generator.component_counter import ComponentCounts
from app.services.kos_formwork_generator.corner_counter import CornerDetection
from app.services.kos_formwork_generator.exceptions import FormworkConfigError
from app.services.kos_formwork_generator.types import (
    BracingScheme,
    Tier6FormworkComponent,
)
from app.services.kos_panel_grid_mapper.types import WallSegment

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═════════════════════════════════════════════════════════════════════

#: Canonical category emission order (per DESIGN v2 doc 02 §15 + PR 1 types.py docstring).
CANONICAL_CATEGORY_ORDER: Tuple[str, ...] = (
    "props",
    "kickers",
    "base_plates",
    "prop_heads",
    "starter_tracks",
    "walers",
    "diagonal_braces",
    "corner_clamps",
    "joint_gaskets",
    "raker_props",
    "alignment_braces",
    "misc",
)

#: Map category → Tier6FormworkComponent.component_type Literal value.
_CATEGORY_TO_COMPONENT_TYPE: Dict[str, str] = {
    "props": "prop",
    "walers": "waler",
    "kickers": "kicker",
    "diagonal_braces": "diagonal_brace",
    "raker_props": "raker_prop",
    "corner_clamps": "corner_clamp",
    "base_plates": "base_plate",
    "prop_heads": "prop_head",
    "joint_gaskets": "joint_gasket",
    "starter_tracks": "starter_track",
}

#: Map category → unit ("nos" or "linear_m").
_CATEGORY_TO_UNIT: Dict[str, str] = {
    "props": "nos",
    "walers": "nos",
    "kickers": "nos",
    "diagonal_braces": "nos",
    "raker_props": "nos",
    "corner_clamps": "nos",
    "base_plates": "nos",
    "prop_heads": "nos",
    "joint_gaskets": "linear_m",
    "starter_tracks": "linear_m",
}


# ═════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═════════════════════════════════════════════════════════════════════


def _format_wastage_pct(wastage_percent: float) -> str:
    """Format wastage percentage for source_rule string (e.g., 5.0 → '5')."""
    return f"{wastage_percent:g}"


def _system_letter(system: str) -> str:
    """Extract system letter prefix (e.g., 'K4-110' → 'K4')."""
    return system.split("-")[0]


def _starter_track_sku(system: str) -> str:
    """Derive starter track SKU from wall system (e.g., 'K4-110' → 'KZ-TRACK-110')."""
    parts = system.split("-")
    if len(parts) < 2:
        raise FormworkConfigError(f"Cannot derive starter track SKU from system={system!r}")
    return f"KZ-TRACK-{parts[1]}"


def _waler_clamp_sku(system: str) -> str:
    """Derive waler clamp SKU from wall system (e.g., 'K4-110' → 'KZ-WC-110')."""
    parts = system.split("-")
    if len(parts) < 2:
        raise FormworkConfigError(f"Cannot derive waler clamp SKU from system={system!r}")
    return f"KZ-WC-{parts[1]}"


def _corner_clamp_sku(corner: CornerDetection) -> str:
    """Derive corner clamp SKU from CornerDetection (FRB §7.2)."""
    parts = corner.system_used.split("-")
    thickness = parts[1] if len(parts) >= 2 else corner.system_used
    if corner.corner_type == "90":
        return f"KZ-CC-90-{thickness}"
    if corner.corner_type == "135":
        return f"KZ-CC-135-{thickness}"
    if corner.corner_type == "T":
        return f"KZ-CC-T-{thickness}"
    raise FormworkConfigError(
        f"Unknown corner_type={corner.corner_type!r}"
    )


def _kicker_sku(system: str) -> str:
    """K4/K6 use timber (KZ-KICK-01); K8 uses steel angle (KZ-KICK-02). FRB §9.4 BI-14."""
    if system.startswith("K8"):
        return "KZ-KICK-02"
    return "KZ-KICK-01"


# Map: category → (wall, scheme) → SKU code
_CATEGORY_TO_SKU_FN: Dict[str, Callable] = {
    "props": lambda w, s: s.prop_sku,
    "kickers": lambda w, s: _kicker_sku(w.system),
    "base_plates": lambda w, s: "KZ-BP-01",
    "prop_heads": lambda w, s: "KZ-PH-01",
    "starter_tracks": lambda w, s: _starter_track_sku(w.system),
    "walers": lambda w, s: _waler_clamp_sku(w.system),
    "diagonal_braces": lambda w, s: "KZ-DB-01",
    "joint_gaskets": lambda w, s: "KZ-JG-01",
    "raker_props": lambda w, s: "KZ-RAKER-01",
}


def _source_rule(
    category: str,
    wall: WallSegment,
    scheme: BracingScheme,
    wastage_percent: float,
) -> str:
    """Build source_rule string matching PR 1 golden format EXACTLY."""
    pct = _format_wastage_pct(wastage_percent)

    if category == "props":
        return f"{scheme.frb_source} + FRB §2.1 {pct}% wastage"

    if category == "kickers":
        k_letter = _system_letter(wall.system)
        return (
            f"FRB §9.4 RULE BI-14 ({k_letter} {scheme.kicker_spacing_mm}mm) "
            f"+ FRB §2.1 {pct}% wastage"
        )

    if category == "base_plates":
        return f"FRB §9.1 RULE BI-5 (1 per prop, hard surface) + FRB §2.1 {pct}% wastage"

    if category == "prop_heads":
        return f"FRB §9.1 RULE BI-6 (1 per prop) + FRB §2.1 {pct}% wastage"

    if category == "starter_tracks":
        # NOTE: golden has NO "FRB §2.1" prefix before "wastage" for tracks.
        return f"FRB §2.1 item 4 (starter track per wall thickness) + {pct}% wastage"

    if category == "walers":
        return f"FRB §9.2 RULE BI-11 + FRB §2.1 {pct}% wastage"

    if category == "diagonal_braces":
        return f"FRB §9.5 RULE BI-18 + FRB §2.1 {pct}% wastage"

    if category == "joint_gaskets":
        return f"FRB §6 RULE JE-6 (provisional formula) + {pct}% wastage"

    if category == "raker_props":
        return (
            f"FRB §9.4 RULE BI-16 (K8 + basement/retaining) "
            f"+ FRB §2.1 {pct}% wastage"
        )

    raise FormworkConfigError(f"No source_rule defined for category={category!r}")


def _base_quantity_for_category(
    category: str, counts: ComponentCounts,
) -> float:
    """Return base (pre-wastage) quantity for a category from ComponentCounts."""
    if category == "props":
        return float(counts.total_props)
    if category == "kickers":
        return float(counts.total_kickers)
    if category == "base_plates":
        return float(counts.total_base_plates)
    if category == "prop_heads":
        return float(counts.total_prop_heads)
    if category == "starter_tracks":
        return counts.starter_track_meters
    if category == "walers":
        return float(counts.total_walers)
    if category == "diagonal_braces":
        return float(counts.total_diagonals)
    if category == "joint_gaskets":
        return counts.joint_gasket_meters
    if category == "raker_props":
        return float(counts.total_raker_props)
    # corner_clamps handled outside per-wall loop; alignment_braces/misc unused in PR 2
    return 0.0


def _apply_wastage(base: float, wastage_percent: float, unit: str) -> float:
    """Apply wastage to base quantity.

    Returns total = base × (1 + wastage_pct/100).
      - 'nos': ceil to integer (returned as float for Tier6 compatibility)
      - 'linear_m': round to 5 decimal places

    Raises:
        FormworkConfigError: on unknown unit.
    """
    multiplier = 1.0 + (wastage_percent / 100.0)
    raw_total = base * multiplier
    if unit == "nos":
        return float(math.ceil(raw_total))
    if unit == "linear_m":
        return round(raw_total, 5)
    raise FormworkConfigError(f"Unknown unit={unit!r} for wastage application")


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier6_components(
    wall_components_map: Dict[str, Tuple[WallSegment, BracingScheme, ComponentCounts]],
    corners: Tuple[CornerDetection, ...],
    wastage_percent: float,
) -> Tuple[Tuple[Tier6FormworkComponent, ...], Dict[str, float]]:
    """Build Tier 6 components in canonical order with sequential IDs.

    Args:
        wall_components_map: dict of wall_id → (wall, scheme, base_counts).
            Walls are processed in alphabetic wall_id order.
        corners: detected corners (sorted by clusters). Corner clamps are emitted
            ONCE per corner, attributed to the alphabetically-first wall_id involved.
        wastage_percent: e.g., 5.0 for 5% wastage.

    Returns:
        Tuple of (tier_6_components, base_quantities_by_sku):
          - tier_6_components: tuple of Tier6FormworkComponent in canonical order.
          - base_quantities_by_sku: dict {sku_code → sum of base quantities},
            consumed by build_tier4_skus to split total into base + wastage.

    Raises:
        FormworkConfigError: on internal SKU derivation errors.
    """
    logger.debug(
        "build_tier6_components: %d wall(s), %d corner(s), wastage=%.2f%%",
        len(wall_components_map), len(corners), wastage_percent,
    )

    components: list = []
    base_by_sku: Dict[str, float] = {}
    counter = 1

    # Process walls in alphabetic order
    sorted_wall_ids = sorted(wall_components_map.keys())

    for wall_id in sorted_wall_ids:
        wall, scheme, counts = wall_components_map[wall_id]

        # Iterate categories in canonical order
        for category in CANONICAL_CATEGORY_ORDER:
            # corner_clamps + alignment_braces + misc handled outside per-wall loop
            if category not in _CATEGORY_TO_SKU_FN:
                continue

            base_qty = _base_quantity_for_category(category, counts)
            if base_qty <= 0:
                continue  # Skip zero-quantity components

            unit = _CATEGORY_TO_UNIT[category]
            total_qty = _apply_wastage(base_qty, wastage_percent, unit)
            if total_qty <= 0:
                continue  # Defensive: wastage shouldn't produce zero from positive base

            sku_code = _CATEGORY_TO_SKU_FN[category](wall, scheme)
            component_type = _CATEGORY_TO_COMPONENT_TYPE[category]
            source_rule = _source_rule(category, wall, scheme, wastage_percent)

            components.append(
                Tier6FormworkComponent(
                    component_id=f"C-{counter:04d}",
                    wall_segment_id=wall_id,
                    component_type=component_type,
                    sku_code=sku_code,
                    quantity=total_qty,
                    unit=unit,
                    source_rule=source_rule,
                )
            )
            counter += 1

            # Track base quantity for Tier 4 base/wastage breakdown
            base_by_sku[sku_code] = base_by_sku.get(sku_code, 0.0) + base_qty

    # ─── Corner clamps (project-level; emitted after per-wall components) ───
    # Each corner emits ONE corner clamp component, attributed to the alphabetically-
    # first wall_id involved (DESIGN v2 doc 02 §11 Problem 11).
    # The corner clamp itself counts as 1 nos.
    pct = _format_wastage_pct(wastage_percent)
    for corner in corners:
        base_qty = 1.0  # one corner clamp per corner
        total_qty = _apply_wastage(base_qty, wastage_percent, "nos")
        sku_code = _corner_clamp_sku(corner)
        source_rule = f"{corner.frb_source} + FRB §2.1 {pct}% wastage"
        components.append(
            Tier6FormworkComponent(
                component_id=f"C-{counter:04d}",
                wall_segment_id=corner.wall_ids[0],
                component_type="corner_clamp",
                sku_code=sku_code,
                quantity=total_qty,
                unit="nos",
                source_rule=source_rule,
            )
        )
        counter += 1
        base_by_sku[sku_code] = base_by_sku.get(sku_code, 0.0) + base_qty

    logger.debug(
        "build_tier6_components: emitted %d components, %d unique SKUs",
        len(components), len(base_by_sku),
    )
    return tuple(components), base_by_sku
