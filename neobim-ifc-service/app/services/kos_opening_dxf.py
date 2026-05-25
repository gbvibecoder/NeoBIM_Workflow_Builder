"""DXF-side opening detection — Phase 5C-3 PR 2.

Four tier detectors run by the orchestrator (kos_opening_detector.py) for
DXF parses:

  Tier 1 — INSERT entities whose block name or layer matches the door/window
           regex. Confidence 0.95. DXF only — PDFs have no block semantics.
  Tier 2 — ARC entities with a 90°±15° sweep within 300mm of a wall axis.
           Confidence 0.85. Door swing arcs have their centre at one jamb.
  Tier 3 — END-junction pairs on collinear walls with a 600–2400mm axial gap.
           Confidence 0.75. The parser splits walls at opening jambs; Tier 3
           reads those splits back.
  Tier 4 — TEXT / MTEXT entities matching the "D1 900x2100" annotation regex
           within 800mm of a wall. Confidence 0.70.

Every detector is a pure function:
  - No DXF document access (entities are pre-extracted into raw_entities by
    ``extract_dxf_entities``).
  - No mutation of input args.
  - No randomness; same inputs ⇒ same outputs.

Threshold values are pinned in the THRESHOLDS block at the top of the file.
Each threshold has an inline citation. Pinning tests in
test_kos_opening_dxf.py guard against silent drift.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Iterable

from app.services.kos_opening_detector import _OpeningCandidate
from app.services.kos_opening_geometry import (
    NEAR_WALL_DEFAULT_PERP_TOL_MM,
    arc_near_wall,
    gap_in_collinear_walls,
    parse_annotation_text,
    point_lies_on_wall,
    project_point_to_wall,
    text_near_wall,
)

log = logging.getLogger(__name__)


# ── thresholds (citations inline) ─────────────────────────────────────────────
#
# Source of truth for the numeric initial values is the 5C-3 prompt §3 PR 2
# threshold table. Anything not listed there is calibrated against the Vamshi
# fixture set in tests/fixtures/openings/.


# Block-name match. Case-insensitive, matches anywhere in the name so
# "INTERIOR_DOOR_900X2100" qualifies. 5C-3 prompt §3 PR 2.
BLOCK_NAME_REGEX = re.compile(r"(?i)(door|dr|window|win|wnd|opening|opng)")

# Pulled out so the synthesizer + tests can reference it. The \b word-boundary
# anchor prevents false positives like "door_SWING" registering as a window
# because of the embedded "win" — \b requires a non-word char (or string
# boundary) immediately before the "win" match.
BLOCK_WINDOW_HINT_REGEX = re.compile(r"(?i)\b(window|win|wnd)")

# Extract a leading width number from "door900" / "DR_1200" / etc.
# 3–4 digit run, 600..2400 mm range checked by caller.
BLOCK_WIDTH_NUMBER_REGEX = re.compile(r"(\d{3,4})")

# Layer-name match. 5C-3 prompt §3 PR 2 — anchored to start so e.g.
# "OPENING-FRAME" matches but "A-WALL-OPENING" does not (annotation noise).
LAYER_NAME_REGEX = re.compile(r"(?i)^(a-)?(door|window|opng|opening)")

# Swing-arc geometry filter.
SWING_ARC_RADIUS_MIN_MM: float = 600.0
SWING_ARC_RADIUS_MAX_MM: float = 1500.0
SWING_ARC_SWEEP_TARGET_DEG: float = 90.0
SWING_ARC_SWEEP_TOL_DEG: float = 15.0           # accept 75°..105°
ARC_TO_WALL_DISTANCE_MAX_MM: float = 300.0

# Tier 4 text annotation perp tolerance + along-axis margin past wall ends.
# 800mm is the prompt-spec maximum text-to-wall distance.
ANNOTATION_TEXT_DISTANCE_MAX_MM: float = 800.0
ANNOTATION_TEXT_MARGIN_MM: float = 500.0

# Per-tier base confidence. Higher tiers win during dedupe (orchestrator sorts
# by -confidence). 5C-3 prompt §1.5 confidence table.
TIER1_BLOCK_CONFIDENCE: float = 0.95
TIER2_SWING_ARC_CONFIDENCE: float = 0.85
TIER3_WALL_GAP_CONFIDENCE: float = 0.75
TIER4_ANNOTATION_CONFIDENCE: float = 0.70

# Tier 3 collinear-perp tolerance. TIGHTER than POINT_ON_WALL_PERP_TOL_MM
# (250mm) so that walls offset by full thickness (typically 200mm) are NOT
# classed as collinear — otherwise the parallel companion of a wall would
# trigger phantom gap detections. Calibrated against the Vamshi synthesizer
# which builds 200mm-thick walls.
TIER3_COLLINEAR_PERP_TOL_MM: float = 50.0

# Tier 3 world-centre dedupe. Two gap candidates whose centres (in world
# coordinates, not wall-relative) are within this distance are the SAME
# physical opening detected from different wall pairs. Without this, the
# top-axis pair AND the bottom-axis pair of a double-line wall each emit one
# candidate per opening → phantom duplicates that the orchestrator's
# parent_wall_id-keyed dedupe can't collapse.
TIER3_WORLD_CENTRE_DEDUPE_MM: float = 200.0

# Default opening dimensions when an upstream signal supplies only one axis.
# A swing arc gives us width (= radius) but not height; an annotation gives
# both. Heights below match the Vamshi door/window standard.
DEFAULT_DOOR_HEIGHT_MM: float = 2100.0
DEFAULT_DOOR_WIDTH_MM: float = 900.0
DEFAULT_DOOR_SILL_MM: float = 0.0

DEFAULT_WINDOW_HEIGHT_MM: float = 1500.0
DEFAULT_WINDOW_WIDTH_MM: float = 1200.0
DEFAULT_WINDOW_SILL_MM: float = 900.0


# ── raw entity extraction ─────────────────────────────────────────────────────


def extract_dxf_entities(msp: Any, mult: float) -> dict:
    """Pull INSERT / ARC / TEXT / MTEXT entities into a pure-dict bag.

    Called by the DXF parser AFTER the existing _inventory pass (which works
    on raw ezdxf entities). Decoupling extraction from detection means the
    detector tier functions don't need ezdxf imported. Coordinates are
    multiplied by the unit-multiplier so the bag is already in millimetres.

    Every per-entity touch is defensive — one malformed entity must not
    abort the whole pass.

    Returns:
      {
        "inserts": [{block_name, layer, x, y, rotation_deg, handle}, ...],
        "arcs":    [{center_x, center_y, radius_mm, start_deg, end_deg, layer, handle}, ...],
        "texts":   [{text, x, y, layer, handle}, ...],
      }
    """
    inserts: list[dict] = []
    arcs: list[dict] = []
    texts: list[dict] = []

    for entity in msp:
        try:
            etype = entity.dxftype()
        except Exception:  # noqa: BLE001
            continue

        try:
            if etype == "INSERT":
                # Effective name: handles anonymous + named blocks.
                try:
                    block_name = str(entity.dxf.name)
                except Exception:  # noqa: BLE001
                    block_name = ""
                ins = entity.dxf.insert
                inserts.append({
                    "block_name": block_name,
                    "layer": str(getattr(entity.dxf, "layer", "0")),
                    "x": float(ins.x) * mult,
                    "y": float(ins.y) * mult,
                    "rotation_deg": float(getattr(entity.dxf, "rotation", 0.0) or 0.0),
                    "handle": str(getattr(entity.dxf, "handle", "")),
                })
            elif etype == "ARC":
                c = entity.dxf.center
                arcs.append({
                    "center_x": float(c.x) * mult,
                    "center_y": float(c.y) * mult,
                    "radius_mm": float(entity.dxf.radius) * mult,
                    "start_deg": float(entity.dxf.start_angle),
                    "end_deg": float(entity.dxf.end_angle),
                    "layer": str(getattr(entity.dxf, "layer", "0")),
                    "handle": str(getattr(entity.dxf, "handle", "")),
                })
            elif etype == "TEXT":
                txt = str(getattr(entity.dxf, "text", "") or "")
                ip = entity.dxf.insert
                texts.append({
                    "text": txt,
                    "x": float(ip.x) * mult,
                    "y": float(ip.y) * mult,
                    "layer": str(getattr(entity.dxf, "layer", "0")),
                    "handle": str(getattr(entity.dxf, "handle", "")),
                })
            elif etype == "MTEXT":
                # plain_text() unwraps formatting codes; fall back to .text.
                try:
                    txt = str(entity.plain_text())
                except Exception:  # noqa: BLE001
                    txt = str(getattr(entity, "text", "") or "")
                try:
                    ip = entity.dxf.insert
                    x, y = float(ip.x), float(ip.y)
                except Exception:  # noqa: BLE001
                    continue
                texts.append({
                    "text": txt,
                    "x": x * mult,
                    "y": y * mult,
                    "layer": str(getattr(entity.dxf, "layer", "0")),
                    "handle": str(getattr(entity.dxf, "handle", "")),
                })
        except Exception:  # noqa: BLE001
            continue

    return {"inserts": inserts, "arcs": arcs, "texts": texts}


# ── tier 1 — block reference ─────────────────────────────────────────────────


def detect_tier1_block_reference(
    walls: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Tier 1: INSERT entities with door/window block names or layers.

    For each qualifying insert:
      - Project the insert point onto walls; pick the closest wall whose
        extent (with 0mm margin) contains the projection.
      - Width: parse a 3–4 digit number from the block name (e.g. "door900");
        else default by type (900mm for doors, 1200mm for windows).
      - Type: "window" if the block name matches BLOCK_WINDOW_HINT_REGEX
        (window/win/wnd); else "door".
      - Position: along-wall projection of the insert anchor (= opening
        start by Vamshi authoring convention; the dedupe step handles
        slight offsets vs the centre-anchored alternative).
    """
    if not raw_entities or not walls:
        return []

    candidates: list[_OpeningCandidate] = []
    inserts = raw_entities.get("inserts") or []

    for ins in inserts:
        block_name = ins.get("block_name", "") or ""
        layer = ins.get("layer", "") or ""

        block_match = BLOCK_NAME_REGEX.search(block_name)
        layer_match = LAYER_NAME_REGEX.search(layer)
        if not block_match and not layer_match:
            continue

        # Project onto nearest wall whose extent contains the insert.
        ip = (ins["x"], ins["y"])
        best_wall_id: str | None = None
        best_perp = math.inf
        best_t = 0.0
        for w in walls:
            projected = project_point_to_wall(w, ip)
            if projected is None:
                continue
            t, perp = projected
            length = float(w["length_mm"])
            if t < 0 or t > length:
                continue
            if perp > NEAR_WALL_DEFAULT_PERP_TOL_MM:
                continue
            if perp < best_perp:
                best_perp = perp
                best_wall_id = w["id"]
                best_t = t

        if best_wall_id is None:
            continue

        # Type from block name (window hint), else door.
        is_window = bool(
            BLOCK_WINDOW_HINT_REGEX.search(block_name)
            or BLOCK_WINDOW_HINT_REGEX.search(layer)
        )
        opening_type = "window" if is_window else "door"

        # Width: extract from block name; else use defaults.
        width_match = BLOCK_WIDTH_NUMBER_REGEX.search(block_name)
        if width_match:
            width_mm = float(width_match.group(1))
            # Sanity-check the extracted width — keep it in the standard
            # opening band.
            if width_mm < 300 or width_mm > 3000:
                width_mm = (
                    DEFAULT_WINDOW_WIDTH_MM if is_window else DEFAULT_DOOR_WIDTH_MM
                )
        else:
            width_mm = (
                DEFAULT_WINDOW_WIDTH_MM if is_window else DEFAULT_DOOR_WIDTH_MM
            )

        height_mm = (
            DEFAULT_WINDOW_HEIGHT_MM if is_window else DEFAULT_DOOR_HEIGHT_MM
        )
        sill_mm = (
            DEFAULT_WINDOW_SILL_MM if is_window else DEFAULT_DOOR_SILL_MM
        )

        # Detection method records the matched signal — helps audit which
        # rule fired in PR reports.
        if block_match:
            method = f"block_name:{block_name[:40]}"
        else:
            method = f"layer_match:{layer[:40]}"

        candidates.append(_OpeningCandidate(
            opening_type=opening_type,  # type: ignore[arg-type]
            parent_wall_id=best_wall_id,
            position_mm=best_t,
            width_mm=width_mm,
            height_mm=height_mm,
            sill_height_mm=sill_mm,
            detection_tier=1,
            detection_method=method,
            confidence=TIER1_BLOCK_CONFIDENCE,
            source_entities=(ins.get("handle", "") or f"insert@{ip}",),
        ))

    return candidates


# ── tier 2 — swing arc ───────────────────────────────────────────────────────


def detect_tier2_swing_arc_dxf(
    walls: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Tier 2: ARC entities with 90°±15° sweep near a wall axis.

    Door swing arcs:
      - Sweep typically 90° (door opens from closed-against-wall to fully open).
      - Radius = door width (the door panel rotates about the hinge).
      - Centre = hinge point, on one jamb of the opening.

    Algorithm:
      1. Filter arcs by sweep ∈ [target − tol, target + tol].
      2. Filter by radius ∈ [SWING_ARC_RADIUS_MIN, SWING_ARC_RADIUS_MAX].
      3. Project centre onto nearest wall axis (within ARC_TO_WALL_DISTANCE_MAX).
      4. Determine swing direction along wall:
           direction unit vector from start_angle → dot wall direction →
           positive = opening extends in +t from hinge; negative = in -t.
      5. Emit (parent_wall_id, position_mm = hinge ± 0 or − radius, width = radius).
    """
    if not raw_entities or not walls:
        return []

    candidates: list[_OpeningCandidate] = []
    arcs = raw_entities.get("arcs") or []

    for arc in arcs:
        # Compute sweep, normalised into [0, 360).
        sweep = (arc["end_deg"] - arc["start_deg"]) % 360.0
        if abs(sweep - SWING_ARC_SWEEP_TARGET_DEG) > SWING_ARC_SWEEP_TOL_DEG:
            continue

        radius = arc["radius_mm"]
        if radius < SWING_ARC_RADIUS_MIN_MM or radius > SWING_ARC_RADIUS_MAX_MM:
            continue

        centre = (arc["center_x"], arc["center_y"])
        match = arc_near_wall(
            centre,
            radius_mm=radius,
            walls=walls,
            perp_tol_mm=ARC_TO_WALL_DISTANCE_MAX_MM,
        )
        if match is None:
            continue
        wall_id, t_hinge = match

        # Find the wall to compute axis direction.
        wall = next((w for w in walls if w["id"] == wall_id), None)
        if wall is None:
            continue

        # Wall axis unit direction.
        ax, ay = wall["start"]
        bx, by = wall["end"]
        length = float(wall["length_mm"])
        if length == 0:
            continue
        ux = (bx - ax) / length
        uy = (by - ay) / length

        # Door-closed direction from start_angle (the arc's start position).
        start_rad = math.radians(arc["start_deg"])
        dir_x = math.cos(start_rad)
        dir_y = math.sin(start_rad)
        sign = dir_x * ux + dir_y * uy

        # Opening occupies (hinge, hinge + radius) if sign > 0, otherwise
        # (hinge − radius, hinge). Clamp to wall extent to keep position_mm
        # ≥ 0 (the detector still emits if width clamps to 0; downstream
        # filter drops zero-width via the orchestrator confidence path).
        if sign >= 0:
            position_mm = t_hinge
        else:
            position_mm = max(0.0, t_hinge - radius)

        candidates.append(_OpeningCandidate(
            opening_type="door",  # geometry alone can't distinguish window
            parent_wall_id=wall_id,
            position_mm=position_mm,
            width_mm=radius,
            height_mm=DEFAULT_DOOR_HEIGHT_MM,
            sill_height_mm=DEFAULT_DOOR_SILL_MM,
            detection_tier=2,
            detection_method=f"swing_arc:r={radius:.0f}mm,sweep={sweep:.0f}°",
            confidence=TIER2_SWING_ARC_CONFIDENCE,
            source_entities=(arc.get("handle", "") or f"arc@{centre}",),
        ))

    return candidates


# ── tier 3 — wall gap ────────────────────────────────────────────────────────


def detect_tier3_wall_gap_dxf(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Tier 3: END-junction pairs on collinear walls separated by 600–2400mm.

    The parser splits a wall at each opening jamb (the gap appears as two
    distinct wall segments with END junctions at their facing endpoints).
    This tier reads those splits back as openings.

    Steps:
      1. Build a fast lookup of END-junction points (snapped to grid).
      2. For every ordered pair (i, j) with i.id < j.id, call
         gap_in_collinear_walls with a TIGHT perp tolerance
         (TIER3_COLLINEAR_PERP_TOL_MM = 50mm) so that the parallel
         companion of a double-line wall does NOT qualify as "collinear with
         a gap".
      3. Require BOTH facing endpoints to be END junctions (rejects valid
         corners and adjacent-room boundaries that happen to be parallel).
      4. Dedupe candidates by WORLD-CENTRE proximity (the same physical
         opening picked up from the top + bottom axis of a thick wall).
      5. Emit one candidate per dedup'd gap, attributed to the lower-id wall
         with position_mm = the gap's start (= along-wall position of the
         END endpoint that faces the gap).
    """
    if not walls:
        return []
    _ = raw_entities  # tier 3 doesn't need the raw entity bag

    # ── step 1: end-junction lookup ────────────────────────────────────────
    # A None-or-empty junction list signals "caller did not compute junctions"
    # and we fall back to a geometric-only check. But a non-empty junction
    # list that simply has no END entries is AUTHORITATIVE: the caller
    # computed junctions and found no ends ⇒ no opening. Without this
    # distinction, walls connected at CORNER junctions on either side of a
    # parallel gap (different rooms with no opening between them) would
    # phantom as Tier 3 detections.
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
        # ~ 20mm grid (matches JUNCTION_TOLERANCE_MM in kos_drawing_geometry).
        if not junctions_supplied:
            return True
        for ex, ey in end_points:
            if abs(ex - point[0]) <= 20.0 and abs(ey - point[1]) <= 20.0:
                return True
        return False

    # ── step 2: pairwise gap scan ──────────────────────────────────────────
    # Sort by id for deterministic iteration; the helper returns world
    # coords so we can dedupe at the next step.
    sorted_walls = sorted(walls, key=lambda w: w["id"])
    raw_gaps: list[tuple[str, float, float, tuple[float, float], float]] = []

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

            # Step 3: facing endpoints must be END junctions on both walls.
            # The facing endpoint of wa is whichever of (start_a, end_a) is
            # closer to the gap centre; same for wb.
            facing_a = _closest_endpoint(wa, centre)
            facing_b = _closest_endpoint(wb, centre)
            if not _is_end(facing_a) or not _is_end(facing_b):
                continue

            # Position_mm on wa: distance from wa["start"] to facing endpoint.
            ax, ay = wa["start"]
            bx, by = wa["end"]
            length_a = float(wa["length_mm"])
            if length_a == 0:
                continue
            t_start = 0.0
            t_end = length_a
            t_facing = t_end if _dist2(facing_a, wa["end"]) < _dist2(facing_a, wa["start"]) else t_start

            raw_gaps.append((wa["id"], t_facing, width, centre, length_a))

    if not raw_gaps:
        return []

    # ── step 4: world-centre dedupe ────────────────────────────────────────
    # Cluster gap candidates by world centre proximity. Lowest-id wall wins
    # within each cluster.
    raw_gaps.sort(key=lambda g: (g[0], g[1]))  # by (wall id, position) for stability
    survivors: list[tuple[str, float, float, tuple[float, float]]] = []
    for wid, position, width, centre, _length in raw_gaps:
        merged = False
        for k, (s_wid, s_pos, s_width, s_centre) in enumerate(survivors):
            if (
                math.hypot(s_centre[0] - centre[0], s_centre[1] - centre[1])
                <= TIER3_WORLD_CENTRE_DEDUPE_MM
            ):
                # Keep the lower-id wall's attribution; ignore the duplicate.
                if wid < s_wid:
                    survivors[k] = (wid, position, width, centre)
                merged = True
                break
        if not merged:
            survivors.append((wid, position, width, centre))

    # ── step 5: emit candidates ────────────────────────────────────────────
    candidates: list[_OpeningCandidate] = []
    for wid, position, width, _centre in survivors:
        candidates.append(_OpeningCandidate(
            opening_type="door",  # geometry alone can't distinguish window
            parent_wall_id=wid,
            position_mm=position,
            width_mm=width,
            height_mm=DEFAULT_DOOR_HEIGHT_MM,
            sill_height_mm=DEFAULT_DOOR_SILL_MM,
            detection_tier=3,
            detection_method=f"wall_gap:width={width:.0f}mm",
            confidence=TIER3_WALL_GAP_CONFIDENCE,
            source_entities=(wid,),
        ))
    return candidates


# ── tier 4 — annotation text ─────────────────────────────────────────────────


def detect_tier4_annotation_dxf(
    walls: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """Tier 4: TEXT / MTEXT entities matching the "D1 900x2100" regex
    placed within 800mm of a wall axis.

    Annotations carry width + height + door/window kind. Position comes from
    the annotation's insertion point projected onto the nearest wall.
    """
    if not raw_entities or not walls:
        return []

    candidates: list[_OpeningCandidate] = []
    for txt in raw_entities.get("texts") or []:
        parsed = parse_annotation_text(txt.get("text", "") or "")
        if parsed is None:
            continue
        opening_type, width, height = parsed
        # Range-check width/height to keep "FOOTING 200x200" type noise out.
        if width < 600 or width > 2400:
            continue
        if height < 600 or height > 3500:
            continue

        ip = (txt["x"], txt["y"])
        match = text_near_wall(
            ip,
            walls=walls,
            perp_tol_mm=ANNOTATION_TEXT_DISTANCE_MAX_MM,
            margin_mm=ANNOTATION_TEXT_MARGIN_MM,
        )
        if match is None:
            continue
        wall_id, t_clamped = match

        # Annotations typically point at the opening CENTRE — back off by
        # half-width so position_mm lines up with the opening start. Clamp
        # to wall extent (position_mm ≥ 0 by orchestrator contract).
        position_mm = max(0.0, t_clamped - width / 2.0)

        sill = DEFAULT_WINDOW_SILL_MM if opening_type == "window" else DEFAULT_DOOR_SILL_MM

        candidates.append(_OpeningCandidate(
            opening_type=opening_type,  # type: ignore[arg-type]
            parent_wall_id=wall_id,
            position_mm=position_mm,
            width_mm=width,
            height_mm=height,
            sill_height_mm=sill,
            detection_tier=4,
            detection_method=f"annotation:{txt.get('text', '')[:40]}",
            confidence=TIER4_ANNOTATION_CONFIDENCE,
            source_entities=(txt.get("handle", "") or f"text@{ip}",),
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


# ── dispatcher (called by orchestrator) ──────────────────────────────────────


def run_all_dxf_tiers(
    walls: list[dict],
    junctions: list[dict],
    raw_entities: dict | None,
) -> list[_OpeningCandidate]:
    """One-call entrypoint the orchestrator dispatches to for DXF parses.

    Runs Tiers 1, 2, 3, 4 in order, concatenates candidates. The
    orchestrator handles dedupe / confidence-filter / sort / id-assignment.
    """
    out: list[_OpeningCandidate] = []
    out.extend(detect_tier1_block_reference(walls, raw_entities))
    out.extend(detect_tier2_swing_arc_dxf(walls, raw_entities))
    out.extend(detect_tier3_wall_gap_dxf(walls, junctions, raw_entities))
    out.extend(detect_tier4_annotation_dxf(walls, raw_entities))
    return out


__all__ = [
    "BLOCK_NAME_REGEX",
    "BLOCK_WIDTH_NUMBER_REGEX",
    "BLOCK_WINDOW_HINT_REGEX",
    "LAYER_NAME_REGEX",
    "SWING_ARC_RADIUS_MIN_MM",
    "SWING_ARC_RADIUS_MAX_MM",
    "SWING_ARC_SWEEP_TARGET_DEG",
    "SWING_ARC_SWEEP_TOL_DEG",
    "ARC_TO_WALL_DISTANCE_MAX_MM",
    "ANNOTATION_TEXT_DISTANCE_MAX_MM",
    "ANNOTATION_TEXT_MARGIN_MM",
    "TIER1_BLOCK_CONFIDENCE",
    "TIER2_SWING_ARC_CONFIDENCE",
    "TIER3_WALL_GAP_CONFIDENCE",
    "TIER4_ANNOTATION_CONFIDENCE",
    "TIER3_COLLINEAR_PERP_TOL_MM",
    "TIER3_WORLD_CENTRE_DEDUPE_MM",
    "DEFAULT_DOOR_HEIGHT_MM",
    "DEFAULT_DOOR_WIDTH_MM",
    "DEFAULT_DOOR_SILL_MM",
    "DEFAULT_WINDOW_HEIGHT_MM",
    "DEFAULT_WINDOW_WIDTH_MM",
    "DEFAULT_WINDOW_SILL_MM",
    "extract_dxf_entities",
    "detect_tier1_block_reference",
    "detect_tier2_swing_arc_dxf",
    "detect_tier3_wall_gap_dxf",
    "detect_tier4_annotation_dxf",
    "run_all_dxf_tiers",
]
