"""PDF-side opening detection — Phase 5C-3 PR 3.

Three tier detectors run by the orchestrator (kos_opening_detector.py) for
PDF parses. Tier 1 (block reference) is DXF-only — PDFs have no block
semantics post-render.

  Tier 2 — Vector arc paths within a wall-axis tolerance. Reconstructed
           from PDF drawing items (bezier curves OR short line-segment
           sequences). Confidence ceiling 0.75 (vs DXF's 0.85) because
           arcs are reconstructed, not native: PyMuPDF's get_drawings()
           often returns a 90° arc as a single cubic bezier curve item.
  Tier 3 — Stroke breaks in 1.2pt black wall lines: END-junction pairs
           on collinear walls separated by a 600–2400mm axial gap. This
           is the workhorse tier for PDFs because text + arc signals are
           often missing.
  Tier 4 — Text annotation. PyMuPDF page.get_text("dict") returns text
           spans with bbox. Filter by the door/window regex, project the
           bbox centre onto nearest wall.

All detectors are pure functions: no `fitz` access at call time. Entities
are pre-extracted into ``raw_entities`` by ``extract_pdf_entities`` so the
tier functions are unit-testable with synthetic dicts.

Threshold values are pinned at the top of the file with inline citations.
PR 3 calibration sets the FINAL values; PR 2's DXF thresholds are NOT
reused here because PDF rendering jitter (≈ 150mm at typical 1:50 scale)
needs wider tolerances.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Iterable

from app.services.kos_annotation_library import (
    get_opening_entry,
    is_non_opening_label,
)
from app.services.kos_opening_detector import _OpeningCandidate
from app.services.kos_opening_dxf import (
    DEFAULT_DOOR_HEIGHT_MM,
    DEFAULT_DOOR_SILL_MM,
    DEFAULT_WINDOW_HEIGHT_MM,
    DEFAULT_WINDOW_SILL_MM,
)
from app.services.kos_opening_geometry import (
    arc_near_wall,
    gap_in_collinear_walls,
    parse_annotation_text,
    project_point_to_wall,
    text_near_wall,
)

log = logging.getLogger(__name__)


# ── thresholds (citations inline) ─────────────────────────────────────────────
#
# PDF tier ceilings per 5C-3 prompt §1.5: "Lower confidence ceilings
# (Tier 2 = 0.75, not 0.85 — arcs are reconstructed, not native)".


TIER2_PDF_SWING_ARC_CONFIDENCE: float = 0.75
TIER3_PDF_WALL_GAP_CONFIDENCE: float = 0.75
TIER4_PDF_ANNOTATION_CONFIDENCE: float = 0.70


# ── Tier 4 PDF — Team2 library-aware annotation detection (PR 4) ────────────
#
# PR 4 promoted Tier 4 to the PRIMARY PDF detection signal after the 90VR
# diagnostic showed Tier 3 (wall-gap) is unreliable on real customer setout
# plans. The values below are calibrated against the 21 Team2 opening labels
# in 90VR-MR-AD-2501[J]. Per-label confidence is the BASE × the library
# entry's confidence_modifier.

TIER4_BASE_CONFIDENCE: float = 0.70
"""Tier 4 base confidence; multiplied by AnnotationEntry.confidence_modifier
for the final per-detection confidence. Matches the prompt §1.5 baseline."""

TIER4_NEAREST_WALL_MAX_MM: float = 800.0
"""Maximum perpendicular distance (mm) from a Team2 label centre to the
nearest wall axis for the label to be attached. Architectural callouts in
90VR sit on leaders within ~500mm of the wall; 800mm absorbs PDF rendering
jitter at typical 1:50 scale. Wider than the DXF Tier 4 equivalent (800mm
DXF) because PDF callouts often float further from the wall."""

TIER4_TEAM2_LABEL_RE: re.Pattern[str] = re.compile(r"^(SD|DW1|DW2)$")
"""Whole-word match. ``re.fullmatch`` semantics — ``DW1A`` MUST NOT match
``DW1``; ``DW`` alone MUST NOT match. The labels here are kept in sync with
``TEAM2_OPENING_LIBRARY``'s ``label`` values (verified by a contract test)."""

TIER4_MIN_CONFIDENCE_AFTER_MODIFIER: float = 0.50
"""Per-prompt §2.3. After applying the library entry's confidence_modifier,
detections below this floor are dropped before the orchestrator sees them
(redundant with the orchestrator's own MIN_CONFIDENCE_THRESHOLD = 0.5, but
kept here for clarity at the source of the decision)."""

# Arc reconstruction band.
SWING_ARC_RADIUS_MIN_MM: float = 600.0
SWING_ARC_RADIUS_MAX_MM: float = 1500.0
SWING_ARC_BBOX_ASPECT_TOL: float = 0.30  # bbox aspect ratio: 1.0 ± 0.30

# Higher than the DXF equivalent (300mm). 5C-3 prompt §3 PR 3: "Higher
# ARC_TO_WALL_DISTANCE_MAX_MM = 500 (PDF rendering tolerance)".
ARC_TO_WALL_DISTANCE_MAX_PDF_MM: float = 500.0

# Tier 3 same band as DXF — wall geometry is the same regardless of source.
TIER3_COLLINEAR_PERP_TOL_MM: float = 50.0
TIER3_WORLD_CENTRE_DEDUPE_MM: float = 200.0

# Tier 4 annotation: PDF text is post-rendered so we allow more spatial slack
# than DXF (which used 800mm). PDF callouts often sit on a leader or above
# the room they reference.
ANNOTATION_PDF_DISTANCE_MAX_MM: float = 1000.0
ANNOTATION_PDF_MARGIN_MM: float = 800.0


# ── raw entity extraction ─────────────────────────────────────────────────────


def extract_pdf_entities(page: Any, pt_to_mm: float) -> dict:
    """Pull arc-like paths + text spans out of a PyMuPDF page.

    Returns a dict mirroring extract_dxf_entities' shape (minus inserts,
    which PDFs don't have):

      {
        "arcs":  [{center_x, center_y, radius_mm, start_deg, end_deg, handle}],
        "texts": [{text, x, y, handle}],
      }

    Arc reconstruction policy
    -------------------------
    PyMuPDF returns a drawing as a path with items: 'l' (line), 'c' (cubic
    bezier curve), 're' (filled rect). A 90° arc is typically a SINGLE 'c'
    item. We emit one arc record per drawing-path whose item set contains
    at least one curve and whose bounding box is roughly square (aspect
    ratio ≈ 1) with a half-side in the SWING_ARC_RADIUS band.

    For arcs drawn as polyline approximations (multiple 'l' items forming
    a curve), we additionally emit an arc record when the path contains
    ≥ 4 connected line segments whose endpoints span a square-ish bbox in
    the radius band. The arc center is the corner of the bbox CLOSEST to
    the path's first endpoint (typical "hinge" authoring convention).

    All coordinates emerge in millimetres (multiplied by pt_to_mm).
    """
    arcs: list[dict] = []
    texts: list[dict] = []

    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        drawings = []

    for d in drawings:
        try:
            arc = _drawing_to_arc(d, pt_to_mm)
            if arc is not None:
                arcs.append(arc)
        except Exception:  # noqa: BLE001
            continue

    # PyMuPDF text extraction via get_text("dict").
    try:
        td = page.get_text("dict")
    except Exception:  # noqa: BLE001
        td = {"blocks": []}

    for block in td.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = (span.get("text") or "").strip()
                if not t:
                    continue
                bbox = span.get("bbox") or (0.0, 0.0, 0.0, 0.0)
                x_mid = (bbox[0] + bbox[2]) / 2.0
                y_mid = (bbox[1] + bbox[3]) / 2.0
                texts.append({
                    "text": t,
                    "x": x_mid * pt_to_mm,
                    "y": y_mid * pt_to_mm,
                    "handle": "",
                })

    return {"arcs": arcs, "texts": texts}


def _drawing_to_arc(drawing: dict, pt_to_mm: float) -> dict | None:
    """Examine one PyMuPDF drawing path; return an arc record or None.

    Two patterns accepted:
      1. Path with ≥ 1 'c' (cubic bezier) item + roughly-square bbox.
      2. Path with ≥ 4 'l' items + roughly-square bbox (polyline arc).

    Bounding box in mm:
      bbox half-side gives the arc RADIUS.
      One of the bbox corners is the arc CENTER. We pick the corner
      closest to the path's first endpoint (typical hinge convention:
      the path starts AT the hinge with the door closed against the wall).
    """
    items = drawing.get("items") or []
    if not items:
        return None

    n_curves = sum(1 for it in items if it[0] == "c")
    n_lines = sum(1 for it in items if it[0] == "l")
    n_rects = sum(1 for it in items if it[0] == "re")

    # Reject obvious non-arcs.
    if n_rects > 0 and n_curves == 0 and n_lines == 0:
        return None
    if n_curves == 0 and n_lines < 4:
        return None
    # Reject extremely-long polylines that aren't arcs.
    if n_curves == 0 and n_lines > 64:
        return None

    # Collect every (x, y) point from the path's items.
    pts: list[tuple[float, float]] = []
    first_pt: tuple[float, float] | None = None
    for it in items:
        tag = it[0]
        if tag == "l":
            a, b = it[1], it[2]
            ax, ay = float(a.x), float(a.y)
            bx, by = float(b.x), float(b.y)
            if first_pt is None:
                first_pt = (ax, ay)
            pts.append((ax, ay))
            pts.append((bx, by))
        elif tag == "c":
            # Cubic bezier: item = ('c', p1, p2, p3, p4)
            # PyMuPDF orders these as (start, ctrl1, ctrl2, end).
            for q in it[1:5]:
                qx, qy = float(q.x), float(q.y)
                if first_pt is None:
                    first_pt = (qx, qy)
                pts.append((qx, qy))
        elif tag == "re":
            r = it[1]
            x0, y0, x1, y1 = float(r.x0), float(r.y0), float(r.x1), float(r.y1)
            pts.extend([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    if len(pts) < 2 or first_pt is None:
        return None

    min_x = min(p[0] for p in pts)
    max_x = max(p[0] for p in pts)
    min_y = min(p[1] for p in pts)
    max_y = max(p[1] for p in pts)
    w_pt = max_x - min_x
    h_pt = max_y - min_y
    if w_pt <= 0 or h_pt <= 0:
        return None

    # Aspect filter: arcs have roughly-square bboxes.
    aspect = max(w_pt, h_pt) / min(w_pt, h_pt) if min(w_pt, h_pt) > 0 else 999.0
    if abs(aspect - 1.0) > SWING_ARC_BBOX_ASPECT_TOL:
        return None

    # Radius = bbox half-side in mm.
    radius_pt = (w_pt + h_pt) / 4.0  # average half-side
    radius_mm = radius_pt * pt_to_mm
    if radius_mm < SWING_ARC_RADIUS_MIN_MM or radius_mm > SWING_ARC_RADIUS_MAX_MM:
        return None

    # Pick the bbox corner closest to first_pt — that's the arc CENTER
    # under the typical hinge-authoring convention.
    corners = [
        (min_x, min_y),
        (max_x, min_y),
        (min_x, max_y),
        (max_x, max_y),
    ]
    fpx, fpy = first_pt
    centre = min(corners, key=lambda c: (c[0] - fpx) ** 2 + (c[1] - fpy) ** 2)
    cx_mm = centre[0] * pt_to_mm
    cy_mm = centre[1] * pt_to_mm

    # Sweep is 90° by reconstruction convention (we don't have the original
    # arc parameters from PyMuPDF; the bezier approximation hides them).
    # start_angle is derived from the corner orientation so that the
    # direction-sign analysis in arc_near_wall still works.
    start_deg = _corner_start_angle(centre, corners)

    return {
        "center_x": cx_mm,
        "center_y": cy_mm,
        "radius_mm": radius_mm,
        "start_deg": start_deg,
        "end_deg": (start_deg + 90.0) % 360.0,
        "handle": "",
    }


def _corner_start_angle(
    centre: tuple[float, float],
    corners: list[tuple[float, float]],
) -> float:
    """Infer a plausible start_angle for a reconstructed 90° arc.

    The arc occupies the bbox corner OPPOSITE to its centre. The start
    direction (door-closed-against-wall) is along the bbox edge that lies
    on the wall axis. Without authoring metadata we can't disambiguate;
    we return 0° if the arc extends to the +x side, 180° otherwise.
    """
    other_x = max(c[0] for c in corners if c[0] != centre[0]) if any(
        c[0] != centre[0] for c in corners
    ) else centre[0]
    return 0.0 if other_x > centre[0] else 180.0


# ── tier 2 — swing arc ───────────────────────────────────────────────────────


def detect_tier2_swing_arc_pdf(
    walls: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Vector arc paths near a wall axis — PDF version.

    Same algorithm as the DXF tier 2, but:
      - Lower confidence ceiling (0.75 vs 0.85) since arcs are reconstructed.
      - Wider perp tolerance (500mm vs 300mm) to absorb PDF rendering jitter.
      - Arc records come from ``extract_pdf_entities`` which approximates
        centre + radius from path bounding box.
    """
    if not raw_entities or not walls:
        return []

    candidates: list[_OpeningCandidate] = []
    for arc in raw_entities.get("arcs") or []:
        radius = arc.get("radius_mm", 0.0)
        if radius < SWING_ARC_RADIUS_MIN_MM or radius > SWING_ARC_RADIUS_MAX_MM:
            continue
        centre = (arc["center_x"], arc["center_y"])
        match = arc_near_wall(
            centre,
            radius_mm=radius,
            walls=walls,
            perp_tol_mm=ARC_TO_WALL_DISTANCE_MAX_PDF_MM,
        )
        if match is None:
            continue
        wall_id, t_hinge = match
        wall = next((w for w in walls if w["id"] == wall_id), None)
        if wall is None:
            continue

        ax, ay = wall["start"]
        bx, by = wall["end"]
        length = float(wall["length_mm"])
        if length == 0:
            continue
        ux = (bx - ax) / length
        uy = (by - ay) / length

        start_rad = math.radians(arc.get("start_deg", 0.0))
        dir_x = math.cos(start_rad)
        dir_y = math.sin(start_rad)
        sign = dir_x * ux + dir_y * uy

        if sign >= 0:
            position_mm = t_hinge
        else:
            position_mm = max(0.0, t_hinge - radius)

        candidates.append(_OpeningCandidate(
            opening_type="door",
            parent_wall_id=wall_id,
            position_mm=position_mm,
            width_mm=radius,
            height_mm=DEFAULT_DOOR_HEIGHT_MM,
            sill_height_mm=DEFAULT_DOOR_SILL_MM,
            detection_tier=2,
            detection_method=f"pdf_swing_arc:r={radius:.0f}mm",
            confidence=TIER2_PDF_SWING_ARC_CONFIDENCE,
            source_entities=(arc.get("handle", "") or f"arc@{centre}",),
        ))
    return candidates


# ── tier 3 — wall gap ────────────────────────────────────────────────────────


def detect_tier3_wall_gap_pdf(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Wall-gap detection — PDF mirror of DXF tier 3.

    PDFs are the dominant source for this tier: the PDF parser's tier-1
    detector picks up 1.2pt black wall strokes, and gaps in those strokes
    (at jambs) read as collinear walls with END junctions at facing ends.
    Same algorithm as the DXF version (and same helper functions).
    """
    if not walls:
        return []
    _ = raw_entities

    junctions_supplied = junctions is not None and len(junctions) > 0
    end_points: list[tuple[float, float]] = []
    if junctions:
        for j in junctions:
            if j.get("type") != "END":
                continue
            pt = j.get("point")
            if pt is None or len(pt) < 2:
                continue
            end_points.append((float(pt[0]), float(pt[1])))

    def _is_end(point: tuple[float, float]) -> bool:
        if not junctions_supplied:
            return True
        for ex, ey in end_points:
            if abs(ex - point[0]) <= 20.0 and abs(ey - point[1]) <= 20.0:
                return True
        return False

    sorted_walls = sorted(walls, key=lambda w: w["id"])
    raw_gaps: list[tuple[str, float, float, tuple[float, float]]] = []

    for i in range(len(sorted_walls)):
        wa = sorted_walls[i]
        for j in range(i + 1, len(sorted_walls)):
            wb = sorted_walls[j]
            gap = gap_in_collinear_walls(
                wa,
                wb,
                perp_tol_mm=TIER3_COLLINEAR_PERP_TOL_MM,
            )
            if gap is None:
                continue
            centre, width = gap
            facing_a = _closest_endpoint(wa, centre)
            facing_b = _closest_endpoint(wb, centre)
            if not _is_end(facing_a) or not _is_end(facing_b):
                continue
            length_a = float(wa["length_mm"])
            if length_a == 0:
                continue
            t_facing = length_a if _dist2(facing_a, wa["end"]) < _dist2(facing_a, wa["start"]) else 0.0
            raw_gaps.append((wa["id"], t_facing, width, centre))

    if not raw_gaps:
        return []

    raw_gaps.sort(key=lambda g: (g[0], g[1]))
    survivors: list[tuple[str, float, float, tuple[float, float]]] = []
    for wid, position, width, centre in raw_gaps:
        merged = False
        for k, (s_wid, s_pos, s_width, s_centre) in enumerate(survivors):
            if (
                math.hypot(s_centre[0] - centre[0], s_centre[1] - centre[1])
                <= TIER3_WORLD_CENTRE_DEDUPE_MM
            ):
                if wid < s_wid:
                    survivors[k] = (wid, position, width, centre)
                merged = True
                break
        if not merged:
            survivors.append((wid, position, width, centre))

    candidates: list[_OpeningCandidate] = []
    for wid, position, width, _centre in survivors:
        candidates.append(_OpeningCandidate(
            opening_type="door",
            parent_wall_id=wid,
            position_mm=position,
            width_mm=width,
            height_mm=DEFAULT_DOOR_HEIGHT_MM,
            sill_height_mm=DEFAULT_DOOR_SILL_MM,
            detection_tier=3,
            detection_method=f"pdf_wall_gap:width={width:.0f}mm",
            confidence=TIER3_PDF_WALL_GAP_CONFIDENCE,
            source_entities=(wid,),
        ))
    return candidates


# ── tier 4 — annotation text ─────────────────────────────────────────────────


def detect_tier4_annotation_pdf(
    walls: list[dict],
    raw_entities: dict | None,
    firm: str = "team2",
) -> list[_OpeningCandidate]:
    """PDF text annotation — opening callouts via the per-firm library.

    PR 4 redesign: drops the generic ``D1 900x2100`` regex in favour of
    a per-firm allowlist lookup. The 90VR diagnostic showed real customer
    setout plans don't use the dimensioned-callout convention the regex
    expected; they use short opaque labels (``SD``, ``DW1``, ``DW2``)
    whose meaning lives in the architectural firm's drawing legend.

    Algorithm:
      1. For each PDF text span, strip whitespace and take an EXACT (whole-
         word) match against the firm's opening allowlist
         (``TIER4_TEAM2_LABEL_RE``).
      2. If ``is_non_opening_label`` returns True (drainage / wall-type /
         dimension marker), drop the span — this gives a hard guard
         against false positives even if the regex were to accidentally
         match.
      3. Look up the library entry to get default width / height / sill /
         opening_type / confidence_modifier.
      4. Project the span centre to the nearest wall axis within
         ``TIER4_NEAREST_WALL_MAX_MM``. Drop if no wall is close enough.
      5. Compute final confidence = ``TIER4_BASE_CONFIDENCE`` × modifier.
         Drop if below ``TIER4_MIN_CONFIDENCE_AFTER_MODIFIER``.
      6. Build an ``_OpeningCandidate`` with library-derived dimensions.

    ``firm`` defaults to ``"team2"`` because that is the v1 (and currently
    only) confirmed firm. Future expansion is one entry per firm in
    ``kos_annotation_library``.
    """
    if not raw_entities or not walls:
        return []

    candidates: list[_OpeningCandidate] = []

    for txt in raw_entities.get("texts") or []:
        raw_text = txt.get("text", "") or ""
        # Whole-word match. ``re.fullmatch`` semantics via the anchored RE.
        match = TIER4_TEAM2_LABEL_RE.match(raw_text.strip())
        if match is None:
            continue
        label = match.group(1)

        # Defensive: even if the regex matched, the explicit non-opening list
        # has the final word (e.g. if a firm ever has overlapping labels).
        if is_non_opening_label(label, firm=firm):
            continue

        entry = get_opening_entry(label, firm=firm)
        if entry is None:
            # Regex matched but no library entry — drop. This branch should
            # be unreachable given the regex is kept in sync with the
            # library, but the guard makes the assumption explicit.
            continue

        # Project the span centre onto the nearest wall axis.
        ip = (txt["x"], txt["y"])
        proj = text_near_wall(
            ip,
            walls=walls,
            perp_tol_mm=TIER4_NEAREST_WALL_MAX_MM,
            margin_mm=ANNOTATION_PDF_MARGIN_MM,
        )
        if proj is None:
            continue
        wall_id, t_clamped = proj

        width = entry.default_width_mm
        height = entry.default_height_mm
        sill = entry.default_sill_height_mm
        position_mm = max(0.0, t_clamped - width / 2.0)

        confidence = TIER4_BASE_CONFIDENCE * entry.confidence_modifier
        if confidence < TIER4_MIN_CONFIDENCE_AFTER_MODIFIER:
            continue

        candidates.append(_OpeningCandidate(
            opening_type=entry.opening_type,  # type: ignore[arg-type]
            parent_wall_id=wall_id,
            position_mm=position_mm,
            width_mm=width,
            height_mm=height,
            sill_height_mm=sill,
            detection_tier=4,
            detection_method=f"text_annotation:{label}:{firm}",
            confidence=confidence,
            source_entities=(
                txt.get("handle", "") or f"text@{ip[0]:.1f},{ip[1]:.1f}:{label}",
            ),
        ))
    return candidates


# ── helpers (private) ────────────────────────────────────────────────────────


def _closest_endpoint(
    wall: dict, point: tuple[float, float]
) -> tuple[float, float]:
    sx, sy = wall["start"]
    ex, ey = wall["end"]
    if _dist2((sx, sy), point) <= _dist2((ex, ey), point):
        return (sx, sy)
    return (ex, ey)


def _dist2(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy


def run_all_pdf_tiers(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """One-call entrypoint the orchestrator dispatches to for PDF parses."""
    out: list[_OpeningCandidate] = []
    out.extend(detect_tier2_swing_arc_pdf(walls, raw_entities))
    out.extend(detect_tier3_wall_gap_pdf(walls, junctions, raw_entities))
    out.extend(detect_tier4_annotation_pdf(walls, raw_entities))
    return out


__all__ = [
    "TIER2_PDF_SWING_ARC_CONFIDENCE",
    "TIER3_PDF_WALL_GAP_CONFIDENCE",
    "TIER4_PDF_ANNOTATION_CONFIDENCE",
    "TIER4_BASE_CONFIDENCE",
    "TIER4_NEAREST_WALL_MAX_MM",
    "TIER4_TEAM2_LABEL_RE",
    "TIER4_MIN_CONFIDENCE_AFTER_MODIFIER",
    "SWING_ARC_RADIUS_MIN_MM",
    "SWING_ARC_RADIUS_MAX_MM",
    "SWING_ARC_BBOX_ASPECT_TOL",
    "ARC_TO_WALL_DISTANCE_MAX_PDF_MM",
    "ANNOTATION_PDF_DISTANCE_MAX_MM",
    "ANNOTATION_PDF_MARGIN_MM",
    "TIER3_COLLINEAR_PERP_TOL_MM",
    "TIER3_WORLD_CENTRE_DEDUPE_MM",
    "extract_pdf_entities",
    "detect_tier2_swing_arc_pdf",
    "detect_tier3_wall_gap_pdf",
    "detect_tier4_annotation_pdf",
    "run_all_pdf_tiers",
]
