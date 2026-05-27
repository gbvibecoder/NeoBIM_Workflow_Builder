"""Per-wall component counting (BEFORE wastage).

Reference: 5F-DESIGN v2 doc 02 §5-§11 (Problems 3-9).

Public API:
  find_bracing_scheme(system, height_mm)  → BracingScheme
  count_components(wall, scheme)          → ComponentCounts

ComponentCounts contains BASE counts. Wastage is applied LATER by
tier6_components and tier5_walls builders (per DESIGN v2 doc 02 §13
Problem 12: 'wastage is a presentation-layer multiplier, not a counting
step').
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Tuple

from app.services.kos_formwork_generator.constants import POUR_RATE_DEFAULTS_M_PER_HR
from app.services.kos_formwork_generator.exceptions import (
    FormworkInputError,
    FormworkInvariantError,
)
from app.services.kos_formwork_generator.lookup_tables import BRACING_LOOKUP_TABLE
from app.services.kos_formwork_generator.types import BracingScheme
from app.services.kos_panel_grid_mapper.types import WallSegment

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC TYPES
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ComponentCounts:
    """Per-wall component counts BEFORE wastage.

    All counts are PER-WALL totals (both sides combined where applicable).
    Wastage is applied LATER by tier6/tier5 builders.

    Note: corner_clamps are NOT in this dataclass. They're determined at the
    project level by corner_counter (one corner involves multiple walls).
    tier5_walls.py attributes corner clamps to walls via CornerDetection.wall_ids.

    Fields (11):
        total_props:       both sides, integer
        total_walers:      waler CLAMPS (not waler runs), both sides
        total_kickers:     both sides
        total_diagonals:   both sides
        total_raker_props: both sides (or one side per FRB §9.4 BI-16 — see DESIGN v2)
        total_base_plates: 1:1 with props
        total_prop_heads:  1:1 with props
        joint_gasket_meters: linear_m, both sides combined
        starter_track_meters: linear_m, single run (NOT × 2)
        props_per_side:    audit reporting (Tier5 may reference)
        kickers_per_side:  audit reporting
    """

    total_props: int
    total_walers: int
    total_kickers: int
    total_diagonals: int
    total_raker_props: int
    total_base_plates: int
    total_prop_heads: int
    joint_gasket_meters: float
    starter_track_meters: float
    props_per_side: int
    kickers_per_side: int


# ═════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═════════════════════════════════════════════════════════════════════


def _height_in_scheme_range(height_m: float, scheme: BracingScheme) -> bool:
    """Return True if height_m falls in the scheme's range.

    Convention: open lower bound, inclusive upper bound — i.e.,
        scheme.height_range_min_m < height_m <= scheme.height_range_max_m

    EXCEPTION: the lowest range per system (min_m=0.0) is INCLUSIVE on both ends
    so that height==0 doesn't fall outside any range. Practically, this means
    [0.0, 2.4] for "≤2.4m" rows.
    """
    if scheme.height_range_min_m == 0.0:
        return 0.0 <= height_m <= scheme.height_range_max_m
    return scheme.height_range_min_m < height_m <= scheme.height_range_max_m


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def find_bracing_scheme(
    system: str,
    height_mm: int,
    lookup_table: Tuple[BracingScheme, ...] = BRACING_LOOKUP_TABLE,
) -> BracingScheme:
    """Find the bracing scheme matching (system, height_mm) per FRB Appendix A Card 1.

    Args:
        system: e.g., 'K4-110'.
        height_mm: wall height in millimeters.
        lookup_table: override for testing; default is BRACING_LOOKUP_TABLE.

    Returns:
        The unique matching BracingScheme.

    Raises:
        FormworkInputError: if no scheme matches (height out of range, or unknown system).
    """
    logger.debug("find_bracing_scheme: system=%s height_mm=%d", system, height_mm)

    if height_mm <= 0:
        raise FormworkInputError(
            f"height_mm must be positive; got {height_mm}",
        )

    height_m = height_mm / 1000.0
    matches = [
        s for s in lookup_table
        if s.system == system and _height_in_scheme_range(height_m, s)
    ]

    if not matches:
        raise FormworkInputError(
            f"No bracing scheme found for system={system!r} height_mm={height_mm} "
            f"(height_m={height_m:.3f}). "
            f"Check FRB Appendix A Card 1 max height for this system.",
            hint="K4 max is 3.6m; K6 max is 5.0m; K8 max is 6.0m.",
        )

    if len(matches) > 1:
        # Should be impossible if BRACING_LOOKUP_TABLE is non-overlapping per system.
        raise FormworkInvariantError(
            f"Multiple bracing schemes match system={system!r} height_mm={height_mm}: "
            f"{[m.frb_source for m in matches]}. Lookup table integrity violated.",
            invariant_id="F-LOOKUP-NON-OVERLAP",
        )

    scheme = matches[0]
    logger.debug("find_bracing_scheme: matched %s", scheme.frb_source)
    return scheme


def count_components(
    wall: WallSegment,
    scheme: BracingScheme,
) -> ComponentCounts:
    """Count per-wall components by applying bracing scheme.

    Args:
        wall: a standard (non-custom-order) WallSegment from mapper.
        scheme: the BracingScheme matching (wall.system, wall.height_mm).

    Returns:
        ComponentCounts with BASE counts (no wastage applied).

    Raises:
        FormworkInputError: if wall.is_custom_order=True, or wall.system != scheme.system,
                             or wall height out of scheme range.
        FormworkInvariantError: if computed counts violate sanity (e.g., negative).
    """
    logger.debug(
        "count_components: wall_id=%s system=%s L=%dmm H=%dmm",
        wall.id, wall.system, wall.length_mm, wall.height_mm,
    )

    # Input validation
    if getattr(wall, "is_custom_order", False):
        raise FormworkInputError(
            f"Wall {wall.id!r} is_custom_order=True; cannot count standard components. "
            f"Custom walls are routed to custom_quotes by PR 4.",
        )
    if wall.system != scheme.system:
        raise FormworkInputError(
            f"Wall {wall.id!r} system={wall.system!r} does not match scheme system={scheme.system!r}.",
        )
    height_m = wall.height_mm / 1000.0
    if not _height_in_scheme_range(height_m, scheme):
        raise FormworkInputError(
            f"Wall {wall.id!r} height {wall.height_mm}mm outside scheme range "
            f"({scheme.height_range_min_m}-{scheme.height_range_max_m}m) for {scheme.frb_source}.",
        )

    length_m = wall.length_mm / 1000.0

    # ─── PROPS (FRB §9.1) ───
    # Formula: max(2, floor(L / spacing) + 1) per side; both sides.
    props_per_side = max(2, math.floor(length_m / scheme.prop_spacing_m) + 1)
    total_props = props_per_side * 2

    # ─── KICKERS (FRB §9.4 RULE BI-14) ───
    kicker_spacing_m = scheme.kicker_spacing_mm / 1000.0
    kickers_per_side = math.ceil(length_m / kicker_spacing_m)
    total_kickers = kickers_per_side * 2

    # ─── WALERS (FRB §9.2 RULE BI-11) — clamps at every prop location per waler level ───
    total_walers = scheme.waler_count * props_per_side * 2

    # ─── DIAGONAL BRACES (FRB §9.5 RULE BI-18) ───
    if scheme.has_diagonal:
        # Per DESIGN v2 §6 Problem 4: floor((props_per_side - 1) / 2) × 2 sides.
        # Rationale: one diagonal per adjacent prop pair, both sides.
        total_diagonals = max(0, math.floor((props_per_side - 1) / 2)) * 2
    else:
        total_diagonals = 0

    # ─── RAKER PROPS (FRB §9.4 RULE BI-16) — K8 + basement/retaining only ───
    application = getattr(wall, "inferred_application", "external")
    total_raker_props = 0
    if wall.system in ("K8-200", "K8-250") and application in ("basement", "retaining"):
        # 1.2m c/c on the soil/earth side. Per DESIGN v2 §9 Problem 7: both sides
        # for symmetric counting (provisional).
        raker_spacing_m = 1.2
        total_raker_props = math.ceil(length_m / raker_spacing_m) * 2

    # ─── BASE PLATES (FRB §9.1 RULE BI-5) — 1:1 with props ───
    total_base_plates = total_props

    # ─── PROP HEADS (FRB §9.1 RULE BI-6) — 1:1 with props ───
    total_prop_heads = total_props

    # ─── JOINT GASKETS (FRB §6 RULE JE-6) — K8 + basement/retaining only ───
    # Provisional formula per DESIGN v2 Decision 13:
    #   (panel_count - 1) × wall_height_m × 2 (both sides)
    # Pending Karthik confirmation (see pending_karthik item 1).
    joint_gasket_meters = 0.0
    apply_gasket = (
        wall.system in ("K8-200", "K8-250")
        or application in ("basement", "retaining")
    )
    if apply_gasket:
        panel_count = len(wall.panels) if wall.panels else 0
        if panel_count >= 2:
            joint_gasket_meters = (panel_count - 1) * height_m * 2

    # ─── STARTER TRACKS (FRB §2.1 item 4) — single run along base ───
    starter_track_meters = length_m

    # ─── Sanity invariants ───
    if total_props < 0 or total_kickers < 0 or total_walers < 0:
        raise FormworkInvariantError(
            f"Negative component count for wall {wall.id!r}",
            invariant_id="F-COMPONENT-NON-NEGATIVE",
        )

    counts = ComponentCounts(
        total_props=total_props,
        total_walers=total_walers,
        total_kickers=total_kickers,
        total_diagonals=total_diagonals,
        total_raker_props=total_raker_props,
        total_base_plates=total_base_plates,
        total_prop_heads=total_prop_heads,
        joint_gasket_meters=joint_gasket_meters,
        starter_track_meters=starter_track_meters,
        props_per_side=props_per_side,
        kickers_per_side=kickers_per_side,
    )

    logger.debug(
        "count_components: wall=%s props=%d kickers=%d walers=%d diag=%d raker=%d "
        "BP=%d PH=%d gasket=%.5fm track=%.5fm",
        wall.id, total_props, total_kickers, total_walers, total_diagonals,
        total_raker_props, total_base_plates, total_prop_heads,
        joint_gasket_meters, starter_track_meters,
    )
    return counts
