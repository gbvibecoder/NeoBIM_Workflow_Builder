"""
T-junction handler — Problem 6 of the mapper pipeline. DESIGN.md §6.7.

For each T_JOIN junction (parser type == "T_JOIN", 3 walls meet, two collinear =
"through pair", one perpendicular = "ending"), this module decides:
  - Which incident wall is the ENDING wall (the perpendicular one)
  - Which incident wall(s) form the THROUGH pair (collinear pair)
  - The SKU code for the ending segment's terminator panel (PC{thickness}-{cut_length})

For K6-150 / K8-200 / K8-250: Rulebook §7.2 supplies KZ-CC-T-{thickness}.
For K4-110 / K6-180: no KZ-CC-T fab — fall back to PC{thickness}-2998 per
Vamshi P_INT_7 convention (it shows PC110 at the T-abutment). A warning flags
the fallback so the BOQ aggregator knows it's a Vamshi-derived SKU, not a
strict rulebook reference.

Algorithm (3 steps):

  1. Identify the through pair: among the 3 incident walls, find the 2 whose
     angles are collinear (within ANGLE_COLLINEAR_TOL_DEG = 3°). The third
     is the ENDING wall.
  2. SKU naming: panel_sku = PC{ending_sku_thickness}-{cut_length}. If the
     ending segment's system has no KZ-CC-T SKU (K4-110 / K6-180), emit a
     warning explaining the Vamshi-pattern fallback.
  3. Return TJunctionHandlerResult with the ending segment + side + SKU.

Determinism: pure function. Same inputs ⇒ same TJunctionHandlerResult.
"""

from __future__ import annotations

from typing import Literal, Optional

from .constants import (
    ANGLE_COLLINEAR_TOL_DEG,
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_WIDTH_MM,
    System,
)
from .types import ParserJunction, ParserWall, TJunctionHandlerResult

# Systems for which Rulebook §7.2 ships a KZ-CC-T-{thickness} fabricated SKU.
# Anything else falls back to PC{thickness}-2998 (Vamshi P_INT_7 convention).
_SYSTEMS_WITH_KZ_CC_T: frozenset[System] = frozenset({"K6-150", "K8-200", "K8-250"})


def handle_t_junction(
    junction: ParserJunction,
    incident_walls: tuple[ParserWall, ParserWall, ParserWall],
    wall_to_segment_id: dict[str, str],
    ending_segment_corner_side: dict[str, Literal["left", "right"]],
    segment_sku_thicknesses: dict[str, int],
    segment_systems: dict[str, System],
) -> TJunctionHandlerResult:
    """Process one T_JOIN junction.

    Args:
      junction:                       The T_JOIN junction (must have type == "T_JOIN").
      incident_walls:                 The 3 walls meeting at this junction.
      wall_to_segment_id:             Lookup: parser wall id → segment id.
      ending_segment_corner_side:     For each segment id incident here, which
                                      side of its polyline ("left"/"right") the
                                      junction sits on. (Only the ENDING segment's
                                      entry is used; others may be present and ignored.)
      segment_sku_thicknesses:        Lookup: segment id → SKU thickness (110/155/180/200/250).
      segment_systems:                Lookup: segment id → System enum value.

    Returns:
      TJunctionHandlerResult with the ending segment id + side + PC panel SKU.
    """
    warnings: list[str] = []

    if junction.type != "T_JOIN":
        warnings.append(
            f"handle_t_junction called on junction.type={junction.type!r} "
            f"(expected 'T_JOIN') — processing anyway"
        )
    if len(incident_walls) != 3:
        warnings.append(
            f"T_JOIN expects 3 incident walls, got {len(incident_walls)} — "
            f"processing the first 3"
        )

    # ── Step 1: identify ending vs through walls (collinearity check) ─
    ending_wall, through_walls = _identify_ending_and_through(incident_walls, warnings)

    # ── Look up segment info ──────────────────────────────────────────
    ending_segment_id = wall_to_segment_id.get(ending_wall.id, ending_wall.id)
    through_segment_ids = [
        wall_to_segment_id.get(w.id, w.id) for w in through_walls
    ]
    # The two through walls usually belong to the same segment (parser splits
    # the through wall at the T-point but the segmenter merges collinear runs).
    # If they're in different segments, expose the first as the canonical.
    through_segment_id: Optional[str] = (
        through_segment_ids[0] if through_segment_ids else None
    )

    # Ending segment's SKU thickness + system.
    ending_thickness = segment_sku_thicknesses.get(ending_segment_id, 110)
    ending_system = segment_systems.get(ending_segment_id, "K4-110")

    # ── Step 2: SKU naming with K4-110 / K6-180 fallback warning ──────
    if ending_system not in _SYSTEMS_WITH_KZ_CC_T:
        warnings.append(
            f"ending segment {ending_segment_id} uses system {ending_system}: "
            f"no KZ-CC-T-{ending_thickness} fabricated SKU in Rulebook §7.2 — "
            f"falling back to PC{ending_thickness}-{STANDARD_PANEL_CUT_LENGTH_MM} "
            f"per Vamshi P_INT_7 convention"
        )

    panel_sku = f"PC{ending_thickness}-{STANDARD_PANEL_CUT_LENGTH_MM}"

    # ── Step 3: pick the ending segment's corner side at this junction ─
    ending_side: Literal["left", "right"] = ending_segment_corner_side.get(
        ending_segment_id, "left"
    )
    if ending_segment_id not in ending_segment_corner_side:
        warnings.append(
            f"ending_segment_corner_side missing entry for {ending_segment_id}; "
            f"defaulting to 'left'"
        )

    return TJunctionHandlerResult(
        junction_point=tuple(junction.point),
        ending_segment_id=ending_segment_id,
        ending_corner_side=ending_side,
        through_segment_id=through_segment_id,
        sku_thickness_mm=ending_thickness,
        panel_sku=panel_sku,
        width_mm=STANDARD_PANEL_WIDTH_MM,
        cut_length_mm=STANDARD_PANEL_CUT_LENGTH_MM,
        warnings=tuple(warnings),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _identify_ending_and_through(
    incident_walls: tuple[ParserWall, ParserWall, ParserWall],
    warnings: list[str],
) -> tuple[ParserWall, list[ParserWall]]:
    """Find the ending wall (perpendicular to the through pair) and the 2
    through walls (collinear with each other) among 3 incident walls.

    If no clean collinear pair exists (degenerate T_JOIN), pick the longest
    wall as ending and the other two as the through pair, with a warning.
    """
    if len(incident_walls) < 3:
        # Degenerate — assume the first is ending.
        return incident_walls[0], list(incident_walls[1:])

    # Try each pair-ending split.
    pairs = [(0, 1, 2), (0, 2, 1), (1, 2, 0)]   # (through_idx_a, through_idx_b, ending_idx)
    for ai, bi, ei in pairs:
        a, b = incident_walls[ai], incident_walls[bi]
        if _is_collinear(a.angle_degrees, b.angle_degrees):
            return incident_walls[ei], [a, b]

    # Fallback: no collinear pair found. Pick longest as ending.
    warnings.append(
        "T_JOIN has no clean collinear pair; treating longest wall as ending"
    )
    sorted_walls = sorted(incident_walls, key=lambda w: w.length_mm, reverse=True)
    return sorted_walls[0], sorted_walls[1:]


def _is_collinear(angle_a: float, angle_b: float) -> bool:
    """Two parser angles (in [0, 180)) are collinear within
    ANGLE_COLLINEAR_TOL_DEG, modular sense."""
    delta = abs(angle_a - angle_b) % 180.0
    return delta < ANGLE_COLLINEAR_TOL_DEG or delta > (180.0 - ANGLE_COLLINEAR_TOL_DEG)
