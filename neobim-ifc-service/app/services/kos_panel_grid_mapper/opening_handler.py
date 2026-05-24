"""
Opening handler — Problem 7 of the mapper pipeline. DESIGN.md §6.8.

Today's path (PARSER_OPENINGS_AVAILABLE = False, see constants.py):
  - The parser does NOT emit Opening objects (it splits walls at opening
    jambs but doesn't tag the gap as an opening).
  - This handler runs a heuristic detection: it counts END junctions that
    sit IN THE INTERIOR of a segment (not at the two endpoints — those are
    the segment's natural terminations). Each pair of interior END
    junctions typically marks the left and right jambs of one opening.
  - If ≥ 2 interior END junctions are found, set `openings_inferable = True`
    and emit a warning so the user knows to re-export with opening
    annotations.
  - Always returns `openings = ()` today (no layout produced).

Future path (PARSER_OPENINGS_AVAILABLE = True, post parser slice 5C-3):
  - The orchestrator will pass actual Opening objects from the parser.
  - This handler will compute the V (jamb) + HB (header/sill) frame panels
    per opening per DESIGN §6.8 layout spec.
  - Scaffolded in `layout_opening_frame` (private) for future activation.

Determinism: pure function. Same inputs ⇒ same OpeningHandlerResult.
"""

from __future__ import annotations

from .constants import (
    JUNCTION_TOLERANCE_MM,
    PARSER_OPENINGS_AVAILABLE,
)
from .types import (
    Opening,
    OpeningHandlerResult,
    ParserJunction,
    WallSegmentDraft,
)

# Minimum interior END count to trigger the openings_inferable flag.
# 2 = one opening (left jamb + right jamb); fewer = ambiguous wall end.
_MIN_INTERIOR_ENDS_FOR_INFERABLE: int = 2


def detect_openings(
    segment: WallSegmentDraft,
    junctions_in_segment: tuple[ParserJunction, ...],
) -> OpeningHandlerResult:
    """Detect openings (or inferability) for one wall segment.

    Args:
      segment:                   The segment to scan (its plan_polyline
                                 establishes the natural endpoints).
      junctions_in_segment:      Junctions whose `point` lies on the
                                 segment's wall-chain (the caller filters
                                 these from the full ParserOutput.junctions).

    Returns:
      OpeningHandlerResult with the heuristic flag + diagnostic count +
      warnings. Today `openings` is always empty.
    """
    warnings: list[str] = []

    # ── Future path: actual opening extraction ────────────────────────
    if PARSER_OPENINGS_AVAILABLE:    # pragma: no cover (False today; future-hook)
        # When the parser slice 5C-3 lands, the orchestrator will pass an
        # additional `openings_from_parser` parameter and this handler will
        # build the full frame layout per DESIGN §6.8 (see layout_opening_frame
        # below for the scaffolded implementation).
        warnings.append(
            "PARSER_OPENINGS_AVAILABLE = True but detect_openings() called "
            "without opening data — caller should use the future overload"
        )
        return OpeningHandlerResult(
            openings=(),
            openings_inferable=False,
            interior_end_count=0,
            warnings=tuple(warnings),
        )

    # ── Today's path: heuristic detection only ────────────────────────
    interior_ends = _count_interior_end_junctions(segment, junctions_in_segment)

    inferable = interior_ends >= _MIN_INTERIOR_ENDS_FOR_INFERABLE
    if inferable:
        warnings.append(
            f"segment {segment.id}: {interior_ends} interior END junction(s) detected "
            f"— suggests opening(s) but parser does not extract Opening objects "
            f"today (PARSER_OPENINGS_AVAILABLE = False). Re-export drawing with "
            f"opening annotations, or supply them via a future ProjectContext "
            f"openings_override field. Mapper proceeds with all-solid layout for "
            f"this segment — BOQ may over-count panels in opening regions."
        )

    return OpeningHandlerResult(
        openings=(),
        openings_inferable=inferable,
        interior_end_count=interior_ends,
        warnings=tuple(warnings),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Future scaffold — opening-frame layout when PARSER_OPENINGS_AVAILABLE = True
# ──────────────────────────────────────────────────────────────────────────────


def layout_opening_frame(
    opening: Opening,
    thickness_mm: int,
    base_v_label_index: int,
    base_hb_label_index: int,
) -> tuple[dict, ...]:    # pragma: no cover (future scaffold)
    """Compute the V (jamb) + HB (header/sill) frame components for one opening.

    NOT CALLED TODAY (PARSER_OPENINGS_AVAILABLE = False). Scaffolded so the
    orchestrator's switch to opening-aware mode in a future slice is a
    1-line change rather than a new module.

    Per DESIGN §6.8 + §4.5 label mapping:
      - 2 vertical CTC jambs (V{n}, V{n+1}) at the opening's left + right edges
      - 1 horizontal CTC header band (HB{m}) above the opening
      - 1 horizontal CTC sill band (HB{m+1}) for windows (sill_height > 0); none for doors
      - Adjacent AP panels may need ±150mm slide to clear the jambs

    Returns a tuple of dicts (rather than dataclass instances) so the future
    orchestrator can populate Panel fields after computing
    area/weight/skin/rib/price via area_weight_calculator.
    """
    frame: list[dict] = []

    # Left jamb (CTC vertical, full opening height + 100mm overlap)
    frame.append({
        "type": "CTC",
        "thickness_mm": thickness_mm,
        "width_mm": 300,
        "cut_length_mm": int(opening.height_mm) + 100,
        "orientation": "vertical",
        "position_mm": opening.position_mm,
        "label_kind": "V",
        "label_index": base_v_label_index,
    })

    # Right jamb (CTC vertical)
    frame.append({
        "type": "CTC",
        "thickness_mm": thickness_mm,
        "width_mm": 300,
        "cut_length_mm": int(opening.height_mm) + 100,
        "orientation": "vertical",
        "position_mm": opening.position_mm + opening.width_mm - 300,
        "label_kind": "V",
        "label_index": base_v_label_index + 1,
    })

    # Header band (CTC horizontal, spanning the opening width)
    frame.append({
        "type": "CTC",
        "thickness_mm": thickness_mm,
        "width_mm": 300,
        "cut_length_mm": int(opening.width_mm),
        "orientation": "horizontal",
        "position_mm": opening.position_mm,
        "label_kind": "HB",
        "label_index": base_hb_label_index,
    })

    # Sill (windows only — sill_height > 0)
    if opening.sill_height_mm > 0:
        frame.append({
            "type": "CTC",
            "thickness_mm": thickness_mm,
            "width_mm": 300,
            "cut_length_mm": int(opening.width_mm),
            "orientation": "horizontal",
            "position_mm": opening.position_mm,
            "label_kind": "HB",
            "label_index": base_hb_label_index + 1,
        })

    return tuple(frame)


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _count_interior_end_junctions(
    segment: WallSegmentDraft,
    junctions_in_segment: tuple[ParserJunction, ...],
) -> int:
    """Count END junctions in the segment whose point is NOT at the segment's
    two natural endpoints (polyline[0] or polyline[-1]).

    Interior END junctions almost always indicate opening jambs (the parser
    splits the wall at each jamb but leaves the gap unannotated). A pair of
    them = one opening.

    For closed-loop segments (no natural endpoints), all END junctions are
    "interior". For open-chain segments, the polyline's first + last points
    are the natural ends.
    """
    if not segment.plan_polyline:
        # Degenerate — no polyline. Treat all ENDs as interior.
        return sum(1 for j in junctions_in_segment if j.type == "END")

    endpoint_quantized = {
        _quantize_point(p) for p in (segment.plan_polyline[0], segment.plan_polyline[-1])
    }

    interior = 0
    for j in junctions_in_segment:
        if j.type != "END":
            continue
        if _quantize_point(j.point) in endpoint_quantized:
            continue
        interior += 1
    return interior


def _quantize_point(point: tuple[float, float]) -> tuple[int, int]:
    """Snap a point onto the JUNCTION_TOLERANCE_MM grid (mirrors parser
    kos_drawing_geometry.JUNCTION_TOLERANCE_MM)."""
    cell = JUNCTION_TOLERANCE_MM
    return (round(point[0] / cell), round(point[1] / cell))
