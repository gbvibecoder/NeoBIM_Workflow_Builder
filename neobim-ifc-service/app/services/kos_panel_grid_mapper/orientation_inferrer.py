"""
Orientation (application) inference — DESIGN.md §6.4.

Maps a segment's metadata (is_closed_loop, endpoint junction types, title-block
level, ProjectContext.application_hint) to one of four SimpleApplication
categories: "external" | "internal" | "basement" | "retaining".

Uses a 7-step priority ladder. First match wins:

  1. ProjectContext.application_hint supplied → use it (confidence 1.0,
                                                       source "user_hint")
  2. Title-block level contains "BASEMENT"/"FOUNDATION" → "basement"
                                                          (confidence 0.85)
     Title-block level contains "RETAINING" → "retaining" (confidence 0.85)
  3. Segment is_closed_loop=True → "external" (confidence 0.95)
  4. Both endpoints are T_JOIN → "internal" (confidence 0.90)
  5. One T_JOIN + one END → "internal" (confidence 0.85)
  6. Both endpoints are END → "internal" (confidence 0.50, warning)
  7. Fallback (unusual pattern or missing endpoint info) → "internal"
                                                           (confidence 0.30)

Determinism: pure function, no random, no datetime.now().
"""

from __future__ import annotations

from typing import Optional

from .constants import Application, SimpleApplication
from .types import OrientationResult


def infer_application(
    is_closed_loop: bool,
    endpoint_junction_types: tuple[str, ...],
    title_block_level: Optional[str] = None,
    application_hint: Optional[Application] = None,
) -> OrientationResult:
    """Run the 7-priority application inference ladder (DESIGN §6.4).

    Args:
      is_closed_loop:           True iff the segment is part of the closed
                                external perimeter (Step 2 of segmenter).
      endpoint_junction_types:  Empty tuple for closed-loop segments; for open
                                chains, a 2-tuple (type_at_left, type_at_right)
                                where each is one of "END", "T_JOIN", "CORNER",
                                "X_JOIN".
      title_block_level:        ParserOutput.title_block.level — case-insensitive
                                substring scan for "BASEMENT" / "FOUNDATION" /
                                "RETAINING".
      application_hint:         ProjectContext.application_hint — when supplied,
                                wins over all geometry heuristics.

    Returns:
      OrientationResult with `application`, `confidence` (0.0-1.0), `source`
      ("user_hint" or "geometry_heuristic"), and any `warnings`.
    """
    # ── Priority 1: explicit user hint ────────────────────────────────
    if application_hint is not None:
        return OrientationResult(
            application=_application_to_simple(application_hint),
            confidence=1.0,
            source="user_hint",
            warnings=(),
        )

    # ── Priority 2: title-block level scan ────────────────────────────
    if title_block_level:
        tb_upper = title_block_level.upper()
        if "BASEMENT" in tb_upper or "FOUNDATION" in tb_upper:
            return OrientationResult(
                application="basement",
                confidence=0.85,
                source="geometry_heuristic",
                warnings=(
                    f"basement inferred from title_block.level={title_block_level!r}",
                ),
            )
        if "RETAINING" in tb_upper:
            return OrientationResult(
                application="retaining",
                confidence=0.85,
                source="geometry_heuristic",
                warnings=(
                    f"retaining inferred from title_block.level={title_block_level!r}",
                ),
            )

    # ── Priority 3: closed-loop perimeter = external ──────────────────
    if is_closed_loop:
        return OrientationResult(
            application="external",
            confidence=0.95,
            source="geometry_heuristic",
            warnings=(),
        )

    # ── Priority 4-7: open-chain endpoint patterns ────────────────────
    if len(endpoint_junction_types) == 2:
        j_left, j_right = endpoint_junction_types
        if j_left == "T_JOIN" and j_right == "T_JOIN":
            return OrientationResult(
                application="internal",
                confidence=0.90,
                source="geometry_heuristic",
                warnings=(),
            )
        if {j_left, j_right} == {"T_JOIN", "END"}:
            return OrientationResult(
                application="internal",
                confidence=0.85,
                source="geometry_heuristic",
                warnings=("one-end-free internal partition",),
            )
        if j_left == "END" and j_right == "END":
            return OrientationResult(
                application="internal",
                confidence=0.50,
                source="geometry_heuristic",
                warnings=("isolated wall (both ends free); default internal",),
            )
        # Unusual: CORNER on an open-chain endpoint, X_JOIN, or unrecognized.
        return OrientationResult(
            application="internal",
            confidence=0.30,
            source="geometry_heuristic",
            warnings=(
                f"unusual endpoint pattern {j_left}/{j_right}; defaulting to internal",
            ),
        )

    # ── Priority 7: fallback when endpoint info is missing ────────────
    return OrientationResult(
        application="internal",
        confidence=0.30,
        source="geometry_heuristic",
        warnings=("endpoint junctions missing; defaulting to internal",),
    )


def _application_to_simple(a: Application) -> SimpleApplication:
    """Map the 10 ProjectContext.application_hint values to the 4-value
    SimpleApplication used inside the mapper.

    Mapping (per DESIGN §3.4 + §6.4):
      "internal_partition"                             → "internal"
      "villa_external"        ┐
      "apartment_external_g3" │
      "apartment_external_g5" │
      "school_commercial_g3"  │── all external-flavoured → "external"
      "lift_shaft_g5"         │
      "shear_wall_g10"        ┘
      "basement_lt3m"         ┐
      "basement_gt3m"         ┴────────────────────── → "basement"
      "retaining"                                     → "retaining"
    """
    if a == "internal_partition":
        return "internal"
    if a.startswith("basement_"):
        return "basement"
    if a == "retaining":
        return "retaining"
    return "external"
