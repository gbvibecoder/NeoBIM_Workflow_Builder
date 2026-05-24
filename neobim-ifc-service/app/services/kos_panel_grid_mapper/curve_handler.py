"""
Curve detection — Problem 8 of the mapper pipeline. DESIGN.md §6.9.

The parser produces only straight line segments — curves get approximated
to short straights at parse time. This module detects when a sequence of
consecutive walls forms a curve cluster and decides whether straight panels
can follow it.

Algorithm (single pure function):

  1. Need ≥3 consecutive walls to declare a curve (less is just a corner or
     a straight).
  2. Compute the angle delta between each pair of consecutive walls in the
     sequence. Deltas are taken in [0, 90°] (modular sense — both 0° and
     180° are "same direction").
  3. A "curve pattern" requires every delta in [1°, 15°] (small consistent
     bends) AND total summed angle ≥ 30° (otherwise the walls are just
     slightly noisy straights).
  4. Estimate radius: arc_length / total_angle_in_radians, where arc_length
     is the sum of wall lengths.
  5. If radius < MIN_KALZEN_CURVE_RADIUS_MM (600mm — ASSUMPTION-A18) → flag
     for CUSTOM curved SKU. Else → approximate as straight panels (default).

Vamshi has zero curves (purely orthogonal residence plan) — this handler is
a no-op for the current dataset. The function exists so the orchestrator
pipeline is complete and so basement / villa plans with curved features
(circular columns, rounded corners) get correctly flagged in future runs.

Determinism: pure function. Same input list ⇒ same CurveResult.
"""

from __future__ import annotations

import math

from .constants import MIN_KALZEN_CURVE_RADIUS_MM
from .types import CurveResult, ParserWall

# Curve-pattern recognition thresholds (DESIGN §6.9):
#   Each Δangle in [DELTA_MIN_DEG, DELTA_MAX_DEG] to qualify as a "small bend".
#   Total summed angle ≥ MIN_TOTAL_ANGLE_DEG to qualify as a "curve" (vs noise).
DELTA_MIN_DEG: float = 1.0
DELTA_MAX_DEG: float = 15.0
MIN_TOTAL_ANGLE_DEG: float = 30.0


def detect_curve(walls_in_order: list[ParserWall]) -> CurveResult:
    """Decide whether a chain of walls forms a curve.

    Args:
      walls_in_order:  Walls in chain order (each wall continues from the
                       previous; typically the source_wall_ids of a single
                       WallSegmentDraft, in order).

    Returns:
      CurveResult with `has_curve`, estimated `curve_radius_mm`, the
      `decision` ("approximate" — use straight panels, vs "flag_custom" —
      needs custom curved SKU), and any warnings.
    """
    # ── Step 1: insufficient walls → no curve possible ────────────────
    if len(walls_in_order) < 3:
        return CurveResult(
            has_curve=False,
            curve_radius_mm=None,
            decision="approximate",
            warnings=(),
        )

    # ── Step 2: compute consecutive deltas (mod 180, folded to [0, 90]) ─
    deltas: list[float] = []
    for i in range(1, len(walls_in_order)):
        a1 = walls_in_order[i - 1].angle_degrees
        a2 = walls_in_order[i].angle_degrees
        deltas.append(_angle_delta(a1, a2))

    # ── Step 3: check curve pattern ───────────────────────────────────
    if not all(DELTA_MIN_DEG <= d <= DELTA_MAX_DEG for d in deltas):
        # Either too straight (all near-zero) or too sharp (some > 15°) — not a curve.
        return CurveResult(
            has_curve=False,
            curve_radius_mm=None,
            decision="approximate",
            warnings=(),
        )

    total_angle_deg = sum(deltas)
    if total_angle_deg < MIN_TOTAL_ANGLE_DEG:
        # Too gentle to be a curve — just slightly bent straights.
        return CurveResult(
            has_curve=False,
            curve_radius_mm=None,
            decision="approximate",
            warnings=(),
        )

    # ── Step 4: estimate radius ───────────────────────────────────────
    arc_length_mm = sum(w.length_mm for w in walls_in_order)
    radius_mm = arc_length_mm / math.radians(total_angle_deg)

    # ── Step 5: decide approximate vs flag_custom ─────────────────────
    if radius_mm < MIN_KALZEN_CURVE_RADIUS_MM:
        return CurveResult(
            has_curve=True,
            curve_radius_mm=radius_mm,
            decision="flag_custom",
            warnings=(
                f"curve detected with R={radius_mm:.0f}mm < "
                f"MIN_KALZEN_CURVE_RADIUS_MM={MIN_KALZEN_CURVE_RADIUS_MM:.0f}mm — "
                f"custom curved SKU required (ASSUMPTION-A18)",
            ),
        )
    return CurveResult(
        has_curve=True,
        curve_radius_mm=radius_mm,
        decision="approximate",
        warnings=(
            f"gentle curve detected (R={radius_mm:.0f}mm) — approximating with "
            f"straight panels",
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _angle_delta(a1: float, a2: float) -> float:
    """Return the unsigned angle difference between two parser angles, folded
    into [0, 90°].

    Parser angles are normalised to [0, 180), so |a1 - a2| ranges in [0, 180).
    We further fold values > 90° back to [0, 90°] because direction-of-travel
    flips at the 90° mark (a wall going 95° away from 0° is more
    "perpendicular" than parallel).
    """
    d = abs(a1 - a2) % 180.0
    if d > 90.0:
        d = 180.0 - d
    return d
