"""
Multi-lift planning — Problem 9 of the mapper pipeline. DESIGN.md §6.10.

Computes how many lifts (separate pour stages) a wall needs given its system
+ application + height. Walls taller than the per-system max-lift-height get
split into multiple lifts, with vertical joints staggered between lifts via a
half-panel "running bond" offset (ASSUMPTION-A19).

Algorithm (single pure function):

  1. Look up max_lift_height from MAX_LIFT_HEIGHT_MM[(system, application)].
     If the exact (sys, app) tuple isn't in the table, fall back to a
     per-system default (see _FALLBACK_MAX_LIFT_PER_SYSTEM) with a warning.
  2. lifts_required = ceil(height_mm / max_lift_height_mm).
  3. Set running_bond_offset_mm = 150 (half-panel) for multi-lift walls,
     0 for single-lift walls.
  4. If height_mm > 6000mm, emit a warning that the wall exceeds Rulebook
     Card 1 bracing range (Structural Engineer review required).

Determinism: pure function. Same inputs ⇒ same MultiLiftResult.
"""

from __future__ import annotations

import math
from typing import Final

from .constants import (
    DEFAULT_RUNNING_BOND_OFFSET_MM,
    MAX_LIFT_HEIGHT_MM,
    SimpleApplication,
    System,
)
from .types import MultiLiftResult

# ──────────────────────────────────────────────────────────────────────────────
# Per-system fallback when (system, application) isn't explicitly tabulated.
#
# These follow Field Rule Book §4.2 / §10.5 conservative defaults:
#   K4-110: 3600mm (internal partition max).
#   K6-150, K6-180: 3000mm (external floor-to-ceiling typical).
#   K8-200, K8-250: 2400mm (shear-wall / basement conservative).
#   CUSTOM: 3000mm (residential default — caller should re-evaluate).
# ──────────────────────────────────────────────────────────────────────────────

_FALLBACK_MAX_LIFT_PER_SYSTEM: Final[dict[System, int]] = {
    "K4-110": 3600,
    "K6-150": 3000,
    "K6-180": 3000,
    "K8-200": 2400,
    "K8-250": 2400,
    "CUSTOM": 3000,
}

# Card 1 (Field Rule Book Appendix A) explicitly covers up to 6m wall height.
# Above this, Structural Engineer review is required.
_CARD_1_MAX_HEIGHT_MM: Final[int] = 6000


def plan_lifts(
    height_mm: int,
    system: System,
    application: SimpleApplication,
) -> MultiLiftResult:
    """Compute the lift count + running-bond offset for a wall.

    Args:
      height_mm:    Wall height in mm (typically 3000 for Vamshi residential).
      system:       The wall's Kalzen system (from system_selector).
      application:  The wall's coarse application category (from
                    orientation_inferrer). "external" / "internal" / "basement"
                    / "retaining".

    Returns:
      MultiLiftResult with lifts_required, max_lift_height_mm used in the
      computation, running_bond_offset_mm (150 for multi-lift, 0 for single),
      and warnings (e.g. fallback used, height > 6m).
    """
    warnings: list[str] = []

    # ── Step 1: max lift height lookup ────────────────────────────────
    key = (system, application)
    max_lift = MAX_LIFT_HEIGHT_MM.get(key)
    if max_lift is None:
        max_lift = _FALLBACK_MAX_LIFT_PER_SYSTEM.get(system, 3000)
        warnings.append(
            f"(system={system}, application={application}) not in MAX_LIFT_HEIGHT_MM table; "
            f"using per-system fallback {max_lift}mm"
        )

    # ── Step 2: lifts_required ────────────────────────────────────────
    if height_mm <= 0:
        warnings.append(f"height_mm={height_mm} ≤ 0 — using 1 lift as safe default")
        lifts = 1
    else:
        lifts = math.ceil(height_mm / max_lift)

    # ── Step 3: running bond offset ───────────────────────────────────
    offset = DEFAULT_RUNNING_BOND_OFFSET_MM if lifts >= 2 else 0

    # ── Step 4: above-Card-1 warning ──────────────────────────────────
    if height_mm > _CARD_1_MAX_HEIGHT_MM:
        warnings.append(
            f"height_mm={height_mm} > {_CARD_1_MAX_HEIGHT_MM}mm — exceeds Rulebook "
            f"Card 1 bracing range; Structural Engineer review required for "
            f"multi-lift bracing"
        )

    return MultiLiftResult(
        lifts_required=lifts,
        max_lift_height_mm=max_lift,
        running_bond_offset_mm=offset,
        warnings=tuple(warnings),
    )
