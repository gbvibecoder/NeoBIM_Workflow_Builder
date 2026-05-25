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

import math

from app.services.kos_drawing_geometry import ParserOpening

from .constants import (
    JUNCTION_TOLERANCE_MM,
    PARSER_OPENINGS_AVAILABLE,
)
from .types import (
    Opening,
    OpeningHandlerResult,
    ParserJunction,
    ParserWall,
    WallSegmentDraft,
)

# Minimum interior END count to trigger the openings_inferable flag.
# 2 = one opening (left jamb + right jamb); fewer = ambiguous wall end.
_MIN_INTERIOR_ENDS_FOR_INFERABLE: int = 2


def detect_openings(
    segment: WallSegmentDraft,
    junctions_in_segment: tuple[ParserJunction, ...],
    parser_openings: tuple[ParserOpening, ...] = (),
    walls_by_id: dict[str, "ParserWall"] | None = None,
) -> OpeningHandlerResult:
    """Detect openings (or inferability) for one wall segment.

    Args:
      segment:               The segment to scan (its plan_polyline
                             establishes the natural endpoints).
      junctions_in_segment:  Junctions whose `point` lies on the segment's
                             wall-chain.
      parser_openings:       PR-HOTFIX-2 — parser-emitted openings the
                             orchestrator filtered for this segment (i.e.
                             those whose ``parent_wall_id`` is in
                             ``segment.source_wall_ids``). Defaulted to
                             empty so legacy callers stay compatible.
      walls_by_id:           PR-HOTFIX-2 — full parser-wall lookup used by
                             the projection step (each parser wall's
                             ``start`` is projected onto the segment axis to
                             compute the wall's offset within the segment).
                             Required when ``parser_openings`` is non-empty.

    Returns:
      OpeningHandlerResult with the openings list (populated when
      ``PARSER_OPENINGS_AVAILABLE`` is True and openings were supplied) +
      the heuristic inferable flag + diagnostic count + warnings.
    """
    warnings: list[str] = []

    # ── Parser-openings path (PR-HOTFIX-2 wiring active) ──────────────
    if PARSER_OPENINGS_AVAILABLE:
        # When the flag is on, the orchestrator routes through here even
        # if the segment has zero openings (parser_openings = ()). Empty
        # is a legitimate state (P_INT_8 has 0 openings); we return an
        # empty list silently.
        if parser_openings:
            if walls_by_id is None:
                warnings.append(
                    f"segment {segment.id}: parser_openings supplied but "
                    f"walls_by_id is None — cannot project to segment "
                    f"coordinates. No openings emitted."
                )
                return OpeningHandlerResult(
                    openings=(),
                    openings_inferable=False,
                    interior_end_count=0,
                    warnings=tuple(warnings),
                )
            converted, conv_warnings = _project_parser_openings_to_segment(
                parser_openings, segment, walls_by_id,
            )
            warnings.extend(conv_warnings)
            return OpeningHandlerResult(
                openings=converted,
                openings_inferable=False,
                interior_end_count=0,
                warnings=tuple(warnings),
            )
        # No parser openings for this segment — return empty without warning.
        return OpeningHandlerResult(
            openings=(),
            openings_inferable=False,
            interior_end_count=0,
            warnings=(),
        )

    # ── Heuristic path: PARSER_OPENINGS_AVAILABLE = False ─────────────
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
# PR-HOTFIX-2 — parser → mapper opening conversion
# ──────────────────────────────────────────────────────────────────────────────


def _project_parser_openings_to_segment(
    parser_openings: tuple[ParserOpening, ...],
    segment: WallSegmentDraft,
    walls_by_id: dict[str, ParserWall],
) -> tuple[tuple[Opening, ...], list[str]]:
    """Convert wall-relative ParserOpenings into segment-relative Openings.

    Math: each parser opening lives on a single parser wall whose start +
    end are in absolute (drawing) coordinates. The mapper's segment is
    composed of multiple parser walls; its ``plan_polyline`` traces the
    segment centerline in the same absolute coordinates. To map an
    opening's wall-relative position onto the segment axis:

      1. Compute the segment's start point S = polyline[0] and the
         segment's unit direction D = (polyline[-1] - S) / |polyline[-1] - S|.
      2. For each opening, look up its parent wall W. Project W.start
         onto the segment axis: wall_offset = (W.start - S) · D.
      3. Determine the parent wall's direction sign relative to D
         (wux*Dx + wuy*Dy). If the wall is traced in the SAME direction
         as the segment, the opening sits at
         ``segment_position = wall_offset + opening.position_mm``.
         If the wall is REVERSED (the segmenter chained it head-to-tail),
         the opening is at
         ``segment_position = wall_offset - opening.position_mm - opening.width_mm``
         — i.e. the opening's left edge in segment coords lies that far
         BEFORE the wall's start projection.

    Returns ``(openings, warnings)`` with the openings sorted by
    ``position_mm`` ascending (deterministic). Returns empty + warnings
    if the segment polyline is degenerate.

    Notes / limitations:
      - Handles segment polylines with a SINGLE straight axis (one edge
        from polyline[0] to polyline[-1]). For multi-edge L-shaped
        polylines, the projection collapses onto the chord between first
        and last vertex; minor offset error for openings on the bend.
        90VR segments are predominantly straight; documented as a future
        refinement.
      - Openings whose projection lands outside [0, segment.length_mm]
        emit a soft warning (clamped to nearest endpoint, still emitted).
    """
    warnings: list[str] = []

    if not segment.plan_polyline or len(segment.plan_polyline) < 2:
        warnings.append(
            f"segment {segment.id}: polyline has < 2 points — cannot project "
            f"openings; no openings emitted."
        )
        return (), warnings

    seg_start = segment.plan_polyline[0]
    seg_end = segment.plan_polyline[-1]
    dx = seg_end[0] - seg_start[0]
    dy = seg_end[1] - seg_start[1]
    seg_len = math.hypot(dx, dy)
    if seg_len == 0:
        warnings.append(
            f"segment {segment.id}: zero-length polyline chord — cannot project "
            f"openings; no openings emitted."
        )
        return (), warnings
    ux, uy = dx / seg_len, dy / seg_len

    converted: list[Opening] = []
    for po in parser_openings:
        wall = walls_by_id.get(po.parent_wall_id)
        if wall is None:
            warnings.append(
                f"opening {po.id}: parent_wall_id={po.parent_wall_id!r} not in "
                f"walls_by_id — skipping (parser may have referenced a wall the "
                f"segmenter dropped)."
            )
            continue

        # Project wall.start onto segment axis.
        wx = wall.start[0] - seg_start[0]
        wy = wall.start[1] - seg_start[1]
        wall_offset = wx * ux + wy * uy

        # Determine wall direction relative to segment.
        wdx = wall.end[0] - wall.start[0]
        wdy = wall.end[1] - wall.start[1]
        wall_len = math.hypot(wdx, wdy)
        if wall_len == 0:
            warnings.append(
                f"opening {po.id}: parent wall {po.parent_wall_id} has zero length "
                f"— skipping."
            )
            continue
        wux, wuy = wdx / wall_len, wdy / wall_len
        sign = wux * ux + wuy * uy  # > 0 same direction, < 0 reversed

        if sign >= 0:
            segment_position = wall_offset + po.position_mm
        else:
            segment_position = wall_offset - po.position_mm - po.width_mm

        # Clamp + warn if outside [0, segment.length_mm].
        if segment_position < -1.0:
            warnings.append(
                f"opening {po.id}: projected segment_position={segment_position:.1f} "
                f"< 0; clamping to 0."
            )
            segment_position = 0.0
        elif segment_position + po.width_mm > segment.length_mm + 1.0:
            warnings.append(
                f"opening {po.id}: projected end={segment_position + po.width_mm:.1f} "
                f"> segment.length_mm={segment.length_mm:.1f}; opening extends past "
                f"segment end."
            )

        converted.append(Opening(
            position_mm=max(0.0, segment_position),
            width_mm=po.width_mm,
            height_mm=po.height_mm,
            sill_height_mm=po.sill_height_mm,
        ))

    # Sort deterministically by along-segment position.
    converted.sort(key=lambda o: o.position_mm)
    return tuple(converted), warnings


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
