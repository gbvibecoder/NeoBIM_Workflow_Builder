"""Build Tier5FormworkWallSegment per wall with all 22 fields populated.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation).

Output is sorted alphabetically by wall_id for determinism. Wastage is applied
per-wall here (matches PR 1 golden for P_INT_8).
"""
from __future__ import annotations

import logging
import math
from typing import Dict, Tuple

from app.services.kos_formwork_generator.component_counter import ComponentCounts
from app.services.kos_formwork_generator.constants import POUR_RATE_DEFAULTS_M_PER_HR
from app.services.kos_formwork_generator.corner_counter import CornerDetection
from app.services.kos_formwork_generator.exceptions import FormworkInputError
from app.services.kos_formwork_generator.types import (
    BracingScheme,
    FormworkContext,
    Tier5FormworkWallSegment,
)
from app.services.kos_panel_grid_mapper.types import WallSegment

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═════════════════════════════════════════════════════════════════════


def _apply_wastage_int(base: int, wastage_percent: float) -> int:
    """Apply wastage to integer count → ceil(base × (1+pct/100))."""
    return math.ceil(base * (1.0 + wastage_percent / 100.0))


def _apply_wastage_linear(base_m: float, wastage_percent: float) -> float:
    """Apply wastage to linear meters → round to 5 decimal places."""
    return round(base_m * (1.0 + wastage_percent / 100.0), 5)


def _resolve_pour_rate(
    wall: WallSegment, context: FormworkContext,
) -> float:
    """Resolve pour rate from context override or system default.

    Raises:
        FormworkInputError: if both context override is None AND system not in defaults.
    """
    if context.pour_rate_m_per_hr is not None:
        return float(context.pour_rate_m_per_hr)
    if wall.system in POUR_RATE_DEFAULTS_M_PER_HR:
        return float(POUR_RATE_DEFAULTS_M_PER_HR[wall.system])
    raise FormworkInputError(
        f"Cannot resolve pour rate: context.pour_rate_m_per_hr is None and "
        f"wall.system={wall.system!r} not in POUR_RATE_DEFAULTS_M_PER_HR keys "
        f"{sorted(POUR_RATE_DEFAULTS_M_PER_HR.keys())}.",
    )


def _bracing_scheme_applied_label(scheme: BracingScheme) -> str:
    """Format bracing_scheme_applied label per PR 1 golden convention.

    Example: 'K4-110_2.4_to_3.0m_1lift'
    """
    return f"{scheme.system}_{scheme.bracing_height_class}_{scheme.lifts}lift"


def _count_corner_clamps_for_wall(
    wall_id: str, corners: Tuple[CornerDetection, ...],
) -> int:
    """Count corner clamps attributed to this wall.

    Per DESIGN v2 doc 02 §11: each corner is attributed to the alphabetically-
    first wall in corner.wall_ids (matching tier6 emission).
    """
    return sum(1 for c in corners if c.wall_ids and c.wall_ids[0] == wall_id)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier5_walls(
    wall_components_map: Dict[str, Tuple[WallSegment, BracingScheme, ComponentCounts]],
    corners: Tuple[CornerDetection, ...],
    context: FormworkContext,
    wastage_percent: float,
) -> Tuple[Tier5FormworkWallSegment, ...]:
    """Build Tier 5 per-wall aggregate, sorted alphabetically by wall_id.

    Args:
        wall_components_map: dict of wall_id → (wall, scheme, base_counts).
        corners: detected corners (for corner clamp attribution).
        context: FormworkContext (for pour_rate_m_per_hr override).
        wastage_percent: e.g., 5.0.

    Returns:
        Tuple of Tier5FormworkWallSegment, sorted by wall_id.

    Raises:
        FormworkInputError: if pour rate can't be resolved for a wall's system.
    """
    logger.debug(
        "build_tier5_walls: %d wall(s), %d corner(s), wastage=%.2f%%",
        len(wall_components_map), len(corners), wastage_percent,
    )

    results: list = []
    sorted_wall_ids = sorted(wall_components_map.keys())

    for wall_id in sorted_wall_ids:
        wall, scheme, counts = wall_components_map[wall_id]

        # Apply wastage to all per-wall components
        total_props      = _apply_wastage_int(counts.total_props,      wastage_percent)
        total_walers     = _apply_wastage_int(counts.total_walers,     wastage_percent)
        total_kickers    = _apply_wastage_int(counts.total_kickers,    wastage_percent)
        total_diagonals  = _apply_wastage_int(counts.total_diagonals,  wastage_percent)
        total_raker_props = _apply_wastage_int(counts.total_raker_props, wastage_percent)
        total_base_plates = _apply_wastage_int(counts.total_base_plates, wastage_percent)
        total_prop_heads  = _apply_wastage_int(counts.total_prop_heads,  wastage_percent)
        joint_gasket_meters  = _apply_wastage_linear(counts.joint_gasket_meters,  wastage_percent)
        starter_track_meters = _apply_wastage_linear(counts.starter_track_meters, wastage_percent)

        # Corner clamps: counted from project-level corners list
        total_corner_clamps = _count_corner_clamps_for_wall(wall_id, corners)

        # Pour rate
        pour_rate = _resolve_pour_rate(wall, context)

        results.append(
            Tier5FormworkWallSegment(
                wall_id=wall_id,
                system=wall.system,
                application=wall.inferred_application,
                length_mm=float(wall.length_mm),
                height_mm=int(wall.height_mm),
                bracing_height_class=wall.bracing_height_class,
                is_custom_order=bool(getattr(wall, "is_custom_order", False)),
                bracing_scheme_applied=_bracing_scheme_applied_label(scheme),
                prop_sku=scheme.prop_sku,
                prop_spacing_m=float(scheme.prop_spacing_m),
                total_props=total_props,
                total_walers=total_walers,
                total_kickers=total_kickers,
                total_diagonals=total_diagonals,
                total_raker_props=total_raker_props,
                total_corner_clamps=total_corner_clamps,
                total_base_plates=total_base_plates,
                total_prop_heads=total_prop_heads,
                joint_gasket_meters=joint_gasket_meters,
                starter_track_meters=starter_track_meters,
                pour_rate_applied_m_per_hr=pour_rate,
                notes="",
            )
        )

    logger.debug("build_tier5_walls: emitted %d wall segment(s)", len(results))
    return tuple(results)
