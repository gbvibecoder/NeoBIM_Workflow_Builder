"""
Corner handler — Problem 5 of the mapper pipeline. DESIGN.md §6.6.

For each CORNER junction (parser type == "CORNER"), this module decides:
  - Which of the two incident segments OWNS the corner panel (R1 ownership rule)
  - The corner angle (90° or 135°)
  - The SKU code for the corner panel (CP{thickness}-{cut_length})

The R1 INTEGRATED ownership rule: each segment owns the corner at its OWN
plan_polyline[0] — i.e. its LEFT corner in the clockwise perimeter walk.
This produces exactly one CP panel per external segment (matching Vamshi's
1-CP-per-segment pattern exactly: 4 externals → 4 CP total).

Algorithm (5 steps):

  1. Determine ownership: if seg_a's corner_side is "left" → seg_a owns;
     elif seg_b's corner_side is "left" → seg_b owns; else (both "right"
     or both "left" — degenerate) → alphabetical tiebreak with warning.
  2. Compute corner angle from the two walls' angle_degrees fields:
        delta = |angle_a − angle_b| mod 180, folded to [0, 90].
        85° ≤ delta ≤ 95°  → 90° corner.
        40° ≤ delta ≤ 50°  → 135° corner.
        else               → unusual (defaults to 90° + warning).
  3. SKU thickness: use the OWNER's sku_thickness_mm. If owner and other
     segments differ in thickness, use the owner's + emit a warning.
  4. SKU naming: `CP{sku_thickness}-{cut_length}` (Vamshi convention).
     Per Rulebook §7.2: KZ-CC-90-{thickness} for all 5 thicknesses;
     KZ-CC-135-{thickness} for 150/155 + 200 only. For 135° corners on
     K4-110 / K6-180 / K8-250 → fall back to 90° + tapered cut + warning.
  5. Return CornerHandlerResult.

Determinism: pure function. Same inputs ⇒ same CornerHandlerResult.
"""

from __future__ import annotations

from typing import Literal

from .constants import (
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_WIDTH_MM,
)
from .types import CornerHandlerResult, ParserJunction, ParserWall

# Angle classification windows per DESIGN §6.6.
_CORNER_90_TOL_DEG: float = 5.0
_CORNER_135_TOL_DEG: float = 5.0
_CORNER_135_DELTA: float = 45.0   # delta value (after fold to [0, 90]) for 135° corner

# 135° corner SKU is only fabricated for 150/155 and 200 per Rulebook §7.2.
_THICKNESSES_WITH_KZ_CC_135: frozenset[int] = frozenset({150, 155, 200})


def handle_corner(
    junction: ParserJunction,
    seg_a_id: str,
    seg_a_corner_side: Literal["left", "right"],
    seg_a_wall: ParserWall,
    seg_a_sku_thickness: int,
    seg_b_id: str,
    seg_b_corner_side: Literal["left", "right"],
    seg_b_wall: ParserWall,
    seg_b_sku_thickness: int,
) -> CornerHandlerResult:
    """Process one CORNER junction.

    Args:
      junction:                The corner junction (must have type == "CORNER").
      seg_a_id / seg_b_id:     The two segments meeting at this corner.
      seg_a/b_corner_side:     Where the corner sits on each segment's polyline —
                               "left" if it's at polyline[0], "right" if at
                               polyline[-1]. The R1 ownership rule uses these.
      seg_a/b_wall:            The wall in each segment touching the corner
                               (for angle computation).
      seg_a/b_sku_thickness:   The SKU thickness for each segment's system
                               (typically from system_selector). Used for
                               the SKU code.

    Returns:
      CornerHandlerResult with owner, angle, SKU info, and warnings.
    """
    warnings: list[str] = []

    # Defensive: validate junction type.
    if junction.type != "CORNER":
        warnings.append(
            f"handle_corner called on junction.type={junction.type!r} "
            f"(expected 'CORNER') — processing anyway"
        )

    # ── Step 1: R1 ownership rule (clockwise-walk LEFT owns) ──────────
    owner_id, owner_side, other_id, other_side = _decide_owner(
        seg_a_id, seg_a_corner_side, seg_b_id, seg_b_corner_side, warnings
    )

    # ── Step 2: angle classification ──────────────────────────────────
    corner_angle = _classify_corner_angle(
        seg_a_wall.angle_degrees, seg_b_wall.angle_degrees, warnings
    )

    # ── Step 3: SKU thickness (owner's, with mismatch warning) ────────
    if seg_a_sku_thickness != seg_b_sku_thickness:
        warnings.append(
            f"mismatched SKU thicknesses at corner: {seg_a_id}={seg_a_sku_thickness}mm "
            f"vs {seg_b_id}={seg_b_sku_thickness}mm — using owner ({owner_id}) thickness"
        )
    sku_thickness = (
        seg_a_sku_thickness if owner_id == seg_a_id else seg_b_sku_thickness
    )

    # ── Step 4: SKU code (Vamshi naming convention CP{thickness}-{cut_length}) ─
    if corner_angle == 135 and sku_thickness not in _THICKNESSES_WITH_KZ_CC_135:
        warnings.append(
            f"135° corner requested for thickness {sku_thickness}mm but Rulebook "
            f"§7.2 KZ-CC-135 only fabricated for 150/155 and 200 — "
            f"falling back to 90° corner + tapered cut"
        )
        corner_angle = 90    # downgrade to 90° per fallback policy

    panel_sku = f"CP{sku_thickness}-{STANDARD_PANEL_CUT_LENGTH_MM}"

    # ── Step 5: assemble result ───────────────────────────────────────
    return CornerHandlerResult(
        junction_point=tuple(junction.point),  # ensure tuple type
        owner_segment_id=owner_id,
        owner_corner_side=owner_side,
        other_segment_id=other_id,
        other_corner_side=other_side,
        corner_angle_deg=corner_angle,
        sku_thickness_mm=sku_thickness,
        panel_sku=panel_sku,
        width_mm=STANDARD_PANEL_WIDTH_MM,
        cut_length_mm=STANDARD_PANEL_CUT_LENGTH_MM,
        warnings=tuple(warnings),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _decide_owner(
    seg_a_id: str,
    seg_a_corner_side: Literal["left", "right"],
    seg_b_id: str,
    seg_b_corner_side: Literal["left", "right"],
    warnings: list[str],
) -> tuple[str, Literal["left", "right"], str, Literal["left", "right"]]:
    """R1 ownership rule: each segment owns its LEFT corner.

    Returns (owner_id, owner_side, other_id, other_side).

    Cases:
      - seg_a is "left" of the corner → seg_a owns. (other is seg_b on whatever side it's on.)
      - seg_b is "left" → seg_b owns.
      - Both are "left" or both are "right" (degenerate) → alphabetical
        tiebreak (lower id wins) + warning.
    """
    a_is_left = seg_a_corner_side == "left"
    b_is_left = seg_b_corner_side == "left"

    if a_is_left and not b_is_left:
        return seg_a_id, "left", seg_b_id, seg_b_corner_side
    if b_is_left and not a_is_left:
        return seg_b_id, "left", seg_a_id, seg_a_corner_side
    # Degenerate — both have same side. Use alphabetical tiebreak for determinism.
    warnings.append(
        f"R1 ownership ambiguous: both {seg_a_id} (side={seg_a_corner_side}) and "
        f"{seg_b_id} (side={seg_b_corner_side}) have the same corner-side at this "
        f"junction; using alphabetical tiebreak (lower id wins)"
    )
    if seg_a_id <= seg_b_id:
        return seg_a_id, seg_a_corner_side, seg_b_id, seg_b_corner_side
    return seg_b_id, seg_b_corner_side, seg_a_id, seg_a_corner_side


def _classify_corner_angle(
    angle_a: float, angle_b: float, warnings: list[str]
) -> int:
    """Compute the corner angle (90 or 135) from two wall angles.

    Parser angles are in [0, 180). Take their modular delta and fold to [0, 90].
    A 90° corner shows delta ≈ 90°; a 135° corner shows delta ≈ 45°.
    """
    delta = abs(angle_a - angle_b) % 180.0
    if delta > 90.0:
        delta = 180.0 - delta

    if (90.0 - _CORNER_90_TOL_DEG) <= delta <= (90.0 + _CORNER_90_TOL_DEG):
        return 90
    if (
        (_CORNER_135_DELTA - _CORNER_135_TOL_DEG)
        <= delta
        <= (_CORNER_135_DELTA + _CORNER_135_TOL_DEG)
    ):
        return 135

    warnings.append(
        f"unusual corner angle (delta={delta:.1f}°): expected ~90° or ~45° "
        f"(for 135° corner) — defaulting to 90° classification"
    )
    return 90    # safe default
