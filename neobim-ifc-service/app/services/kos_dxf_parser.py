"""KOS drawing parser — DXF wall + inventory extractor (Week 5C-1, Phase 1).

Vector-only parsing of customer DXF drawings via ``ezdxf``. NO vision API,
NO Anthropic SDK — this module is pure geometry. It answers one question:
*can ezdxf give us usable walls + dimensions on real customer drawings?*

The parser is deliberately defensive:

* ``ezdxf.readfile`` is tried first; on a corrupt/odd-version file it falls
  back to ``ezdxf.recover.read`` before erroring.
* Every per-entity access is wrapped in try/except — one exotic entity must
  never abort the whole parse. Bad entities are counted + warned, then skipped.
* ``$INSUNITS`` may be 0 (unknown). We assume millimetres but flag it loudly
  in ``warnings`` so a wrong-units result is never silent.

Wall detection is a 4-tier strategy run in order; the first tier that yields
walls wins (``detection_tier`` on each wall records which one fired):

  Tier 1 — wall-layer name match (``.*WALL.*`` / MUR / PARED / WAND)   conf 0.85
  Tier 2 — thick lines + parallel-partner double-line detection         conf 0.65
  Tier 3 — shared edges of closed room polygons                         conf 0.50
  Tier 4 — all LINE + LWPOLYLINE, unfiltered (last resort)              conf 0.30

This module exposes :func:`parse_dxf_walls` (the orchestrator) and the small
:func:`detect_units` helper, which the debug renderer reuses so its overlay
shares the same millimetre coordinate space.
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

import structlog

from app.services.kos_drawing_geometry import (
    WALL_THICKNESS_MAX_MM,
    WALL_THICKNESS_MIN_MM,
    _angle_deg,
    _detect_junctions,
    _enrich_thickness,
    _seg_to_wall,
)
from app.services.kos_opening_detector import detect_openings
from app.services.kos_opening_dxf import extract_dxf_entities

log = structlog.get_logger()

PARSER_VERSION = "0.1.0"
PHASE = "5C-1"

# Tier-1 (wall-layer) candidates shorter than this (mm) are dropped. Stricter
# than the global floor: on real wall layers the sub-200mm population is hatch
# / pattern / annotation fragments, not structural walls. (Defended in
# temp_folder/phase-5c1-tuning/DIAGNOSIS.md §C.4 against measured filter impact.)
TIER1_MIN_WALL_LENGTH_MM = 200.0

# DXF lineweight is encoded in 1/100 mm. 50 => 0.5 mm; 100 => 1.0 mm.
THICK_LINE_LW = 50
VERY_THICK_LINE_LW = 100

# Performance guards — these files run 4-7 MB. Pairwise tiers blow up O(n²)
# without a cap, so we bound the candidate set and warn when we hit the cap.
TIER2_MAX_CANDIDATES = 4000
TIER3_MAX_POLYGONS = 6000

# NOTE: MIN_WALL_LENGTH_MM, JUNCTION_TOLERANCE_MM, WALL_THICKNESS_MIN/MAX_MM and
# the THICKNESS_* constants, plus _length/_angle_deg/_seg_to_wall/_perp_distance/
# _projected_overlap/_enrich_thickness/_detect_junctions, moved to
# kos_drawing_geometry (shared with the PDF parser, Week 5C-2). The names this
# module still references are re-imported above; behaviour is unchanged.

# Wall-layer name patterns (case-insensitive). Covers EN / FR / ES / DE.
_WALL_LAYER_RE = re.compile(r"^(.*WALL.*|.*MUR.*|.*PARED.*|.*WAND.*)$", re.IGNORECASE)

# Wall-family layers that are actually annotation / hidden-line / pattern
# sub-layers and must NOT count as walls. Tuned for AECOM-style AIA/ISO-13567
# naming (e.g. A-WALL-HDLN, A-WALL-IDEN, A-WALL-PATT). NOTE: this exclusion set
# will need revisiting for Kalzen-authored layer conventions (future work).
_WALL_LAYER_EXCLUDE_RE = re.compile(
    r"(HDLN|IDEN|PATT|HATCH|NOTE|DIMS?|ANNO|TEXT|KEYN|TTLB)", re.IGNORECASE
)


def _is_wall_layer(layer: str) -> bool:
    """Tier-1 wall-layer test: in the wall family AND not an annotation/
    hidden-line/pattern sub-layer."""
    return bool(_WALL_LAYER_RE.match(layer)) and not _WALL_LAYER_EXCLUDE_RE.search(layer)

# $INSUNITS → (unit_name, mm_multiplier). Source: DXF spec.
_INSUNITS_MAP: dict[int, tuple[str, float]] = {
    0: ("unitless", 1.0),     # unknown — assume mm, flag in warnings
    1: ("inches", 25.4),
    2: ("feet", 304.8),
    4: ("mm", 1.0),
    5: ("cm", 10.0),
    6: ("m", 1000.0),
    8: ("microinches", 0.0000254),
    9: ("mils", 0.0254),
    10: ("yards", 914.4),
    13: ("microns", 0.001),
    14: ("decimeters", 100.0),
}


# ── DXF open + units ──────────────────────────────────────────────────────


def open_dxf(dxf_path: str) -> tuple[Any, Any, list[str]]:
    """Open a DXF, returning ``(doc, msp, warnings)``.

    Tries ``ezdxf.readfile`` first; on failure falls back to
    ``ezdxf.recover.read`` (handles slightly-corrupt / odd-version files).
    Raises the original exception only if recovery also fails.
    """
    import ezdxf  # lazy — keeps app boot alive if the dep isn't built yet
    from ezdxf import recover

    warnings: list[str] = []
    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as exc:  # noqa: BLE001 — try recovery before giving up
        log.warning("dxf_readfile_failed_trying_recover", error=str(exc))
        warnings.append(
            f"ezdxf.readfile failed ({type(exc).__name__}: {exc}); "
            "used ezdxf.recover.read fallback"
        )
        doc, auditor = recover.read(dxf_path)
        if auditor.has_errors:
            warnings.append(
                f"recover.read reported {len(auditor.errors)} structural "
                "error(s); parse results may be partial"
            )
    msp = doc.modelspace()
    return doc, msp, warnings


def detect_units(doc: Any) -> tuple[str, float, list[str]]:
    """Resolve drawing units → ``(unit_name, mm_multiplier, warnings)``.

    Reads ``$INSUNITS`` from the header. 0/unknown assumes millimetres but
    appends a loud warning so a wrong-units result is never silent.
    """
    warnings: list[str] = []
    insunits = 0
    try:
        insunits = int(doc.header.get("$INSUNITS", 0))
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"could not read $INSUNITS ({exc}); assuming mm")

    if insunits == 0:
        warnings.append(
            "$INSUNITS is 0 (unspecified) — assuming millimetres. All "
            "lengths may be wrong if the drawing is authored in another unit."
        )
        return "unitless (assumed mm)", 1.0, warnings

    if insunits not in _INSUNITS_MAP:
        warnings.append(
            f"$INSUNITS={insunits} is uncommon and unmapped — assuming mm."
        )
        return f"insunits_{insunits} (assumed mm)", 1.0, warnings

    name, mult = _INSUNITS_MAP[insunits]
    return name, mult, warnings


# ── small geometry helpers ──────────────────────────────────────────────
# _length, _angle_deg and _seg_to_wall now live in kos_drawing_geometry
# (shared with the PDF parser); _angle_deg + _seg_to_wall are imported above.


def _polyline_segments(points: list) -> list[tuple[float, float, float, float]]:
    """Consecutive vertex pairs of a polyline as (ax, ay, bx, by) tuples."""
    segs: list[tuple[float, float, float, float]] = []
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        segs.append((a[0], a[1], b[0], b[1]))
    return segs


def _effective_lineweight(entity: Any, doc: Any) -> int:
    """Resolve an entity's lineweight, following BYLAYER (-1) to the layer.

    Returns the 1/100 mm value, or 0 when it can't be determined. Special
    sentinels (-2 BYBLOCK, -3 DEFAULT) collapse to 0 (treated as thin).
    """
    try:
        lw = entity.dxf.get("lineweight", -1)
    except Exception:  # noqa: BLE001
        lw = -1
    if lw is None:
        lw = -1
    if lw == -1:  # BYLAYER — look it up on the layer record
        try:
            layer = doc.layers.get(entity.dxf.layer)
            lw = layer.dxf.get("lineweight", 0) or 0
        except Exception:  # noqa: BLE001
            lw = 0
    return max(int(lw), 0)


# ── entity inventory + bounds ───────────────────────────────────────────


_TRACKED_TYPES = (
    "LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC",
    "TEXT", "MTEXT", "DIMENSION", "INSERT", "HATCH",
)


def _inventory(msp: Any, doc: Any) -> tuple[dict, dict, dict, int, list[str]]:
    """Single defensive pass over modelspace.

    Returns ``(entities_by_type, layers_index, bounds, bad_count, warnings)``.
    Each entity touch is isolated so a single throwing entity is skipped, not
    fatal.
    """
    entities_by_type: dict[str, list] = {t: [] for t in _TRACKED_TYPES}
    layers_index: dict[str, dict] = {}
    warnings: list[str] = []
    bad = 0

    # Seed the layer index from the layer table (count filled during the pass).
    try:
        for layer in doc.layers:
            try:
                layers_index[layer.dxf.name] = {
                    "count": 0,
                    "color": int(getattr(layer.dxf, "color", 0) or 0),
                    "lineweight": float(getattr(layer.dxf, "lineweight", -1) or -1),
                }
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"could not enumerate layer table: {exc}")

    min_x = min_y = math.inf
    max_x = max_y = -math.inf

    def _track_pt(x: float, y: float) -> None:
        nonlocal min_x, min_y, max_x, max_y
        if x < min_x:
            min_x = x
        if y < min_y:
            min_y = y
        if x > max_x:
            max_x = x
        if y > max_y:
            max_y = y

    for entity in msp:
        try:
            etype = entity.dxftype()
            layer_name = getattr(entity.dxf, "layer", "0")
            rec = layers_index.setdefault(
                layer_name, {"count": 0, "color": None, "lineweight": None}
            )
            rec["count"] += 1

            if etype in entities_by_type:
                entities_by_type[etype].append(entity)

            # Extend bounds only from geometric entities.
            if etype == "LINE":
                _track_pt(entity.dxf.start.x, entity.dxf.start.y)
                _track_pt(entity.dxf.end.x, entity.dxf.end.y)
            elif etype == "LWPOLYLINE":
                for p in entity.get_points("xy"):
                    _track_pt(p[0], p[1])
            elif etype == "POLYLINE":
                for v in entity.vertices:
                    loc = v.dxf.location
                    _track_pt(loc.x, loc.y)
            elif etype in ("CIRCLE", "ARC"):
                c = entity.dxf.center
                r = entity.dxf.radius
                _track_pt(c.x - r, c.y - r)
                _track_pt(c.x + r, c.y + r)
        except Exception as exc:  # noqa: BLE001 — never let one entity kill the pass
            bad += 1
            if bad <= 5:  # avoid flooding warnings on systematically-bad files
                warnings.append(
                    f"skipped malformed entity ({type(exc).__name__}: {exc})"
                )

    if bad > 5:
        warnings.append(f"... and {bad - 5} more malformed entities skipped")

    if min_x is math.inf:  # no geometric entities at all
        bounds = {"min_x": 0.0, "min_y": 0.0, "max_x": 0.0, "max_y": 0.0}
        warnings.append("no geometric entities found — drawing bounds are empty")
    else:
        bounds = {
            "min_x": round(min_x, 3),
            "min_y": round(min_y, 3),
            "max_x": round(max_x, 3),
            "max_y": round(max_y, 3),
        }

    return entities_by_type, layers_index, bounds, bad, warnings


# ── wall detection tiers ────────────────────────────────────────────────


def _tier1_wall_layers(ebt: dict, mult: float) -> list[dict]:
    """LINE + LWPOLYLINE on any layer whose name matches the wall regex."""
    walls: list[dict] = []
    idx = 0
    for line in ebt["LINE"]:
        try:
            layer = line.dxf.layer
            if not _is_wall_layer(layer):
                continue
            s, e = line.dxf.start, line.dxf.end
            w = _seg_to_wall(idx, s.x, s.y, e.x, e.y, mult, layer, 1, 0.85, None)
            if w and w["length_mm"] >= TIER1_MIN_WALL_LENGTH_MM:
                walls.append(w)
                idx += 1
        except Exception:  # noqa: BLE001
            continue
    for pl in ebt["LWPOLYLINE"]:
        try:
            layer = pl.dxf.layer
            if not _is_wall_layer(layer):
                continue
            pts = pl.get_points("xy")
            if pl.closed and len(pts) > 2:
                pts = list(pts) + [pts[0]]
            for (ax, ay, bx, by) in _polyline_segments(list(pts)):
                w = _seg_to_wall(idx, ax, ay, bx, by, mult, layer, 1, 0.85, None)
                if w and w["length_mm"] >= TIER1_MIN_WALL_LENGTH_MM:
                    walls.append(w)
                    idx += 1
        except Exception:  # noqa: BLE001
            continue
    return walls


def _tier2_thick_double_lines(ebt: dict, doc: Any, mult: float, warnings: list[str]) -> list[dict]:
    """Thick LINEs; pair parallel partners to read off a wall thickness."""
    from shapely.geometry import LineString

    candidates: list[tuple[Any, float, float, float, float, int]] = []
    for line in ebt["LINE"]:
        try:
            lw = _effective_lineweight(line, doc)
            if lw < THICK_LINE_LW:
                continue
            s, e = line.dxf.start, line.dxf.end
            candidates.append((line, s.x * mult, s.y * mult, e.x * mult, e.y * mult, lw))
        except Exception:  # noqa: BLE001
            continue

    if len(candidates) > TIER2_MAX_CANDIDATES:
        warnings.append(
            f"tier-2: {len(candidates)} thick lines exceeds cap "
            f"{TIER2_MAX_CANDIDATES}; skipping parallel-pairing, keeping thick "
            "lines with null thickness"
        )
        capped = True
        pair_set = candidates[:TIER2_MAX_CANDIDATES]
    else:
        capped = False
        pair_set = candidates

    walls: list[dict] = []
    matched: set[int] = set()
    idx = 0

    if not capped:
        geoms = [LineString([(c[1], c[2]), (c[3], c[4])]) for c in pair_set]
        angles = [_angle_deg(c[1], c[2], c[3], c[4]) for c in pair_set]
        for i in range(len(pair_set)):
            if i in matched:
                continue
            best_j = -1
            best_dist = math.inf
            for j in range(i + 1, len(pair_set)):
                if j in matched:
                    continue
                # Parallel within ~3°.
                if abs(angles[i] - angles[j]) > 3.0 and abs(angles[i] - angles[j]) < 177.0:
                    continue
                try:
                    d = geoms[i].distance(geoms[j])
                except Exception:  # noqa: BLE001
                    continue
                if WALL_THICKNESS_MIN_MM <= d <= WALL_THICKNESS_MAX_MM and d < best_dist:
                    # Require overlapping projection (segments side-by-side, not
                    # end-to-end): centroids must be reasonably close.
                    if geoms[i].centroid.distance(geoms[j].centroid) < geoms[i].length:
                        best_dist = d
                        best_j = j
            if best_j >= 0:
                matched.add(i)
                matched.add(best_j)
                c = pair_set[i]
                # Wall axis = the thick line itself; thickness = gap to partner.
                w = _seg_to_wall(
                    idx, c[1] / mult, c[2] / mult, c[3] / mult, c[4] / mult,
                    mult, c[0].dxf.layer, 2, 0.65, best_dist,
                )
                if w:
                    walls.append(w)
                    idx += 1

    # Unpaired but very-thick lines → walls with null thickness.
    for k, c in enumerate(pair_set):
        if k in matched:
            continue
        if c[5] >= VERY_THICK_LINE_LW or capped:
            w = _seg_to_wall(
                idx, c[1] / mult, c[2] / mult, c[3] / mult, c[4] / mult,
                mult, c[0].dxf.layer, 2, 0.65, None,
            )
            if w:
                walls.append(w)
                idx += 1
    return walls


def _tier3_polygon_shared_edges(ebt: dict, mult: float, warnings: list[str]) -> list[dict]:
    """Shared edges of closed room polygons → walls.

    Edges are hashed by their rounded, orientation-independent endpoints.
    An edge shared by ≥2 polygons is a partition wall (high priority); if
    none are shared we fall back to all room-polygon edges.
    """
    from shapely.geometry import Polygon

    # Area band in mm²: 1 m² .. 10000 m².
    area_min = 1.0e6
    area_max = 1.0e10

    polys: list[list[tuple[float, float]]] = []
    for pl in ebt["LWPOLYLINE"]:
        try:
            if not pl.closed:
                continue
            pts = [(p[0] * mult, p[1] * mult) for p in pl.get_points("xy")]
            if len(pts) < 3:
                continue
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            area = poly.area
            if area_min <= area <= area_max:
                polys.append(pts)
        except Exception:  # noqa: BLE001
            continue
        if len(polys) >= TIER3_MAX_POLYGONS:
            warnings.append(
                f"tier-3: hit polygon cap {TIER3_MAX_POLYGONS}; remaining "
                "closed polygons ignored"
            )
            break

    if not polys:
        return []

    def _key(ax, ay, bx, by):
        a = (round(ax, 0), round(ay, 0))
        b = (round(bx, 0), round(by, 0))
        return (a, b) if a <= b else (b, a)

    counts: dict[tuple, tuple[float, float, float, float]] = {}
    occur: dict[tuple, int] = {}
    for pts in polys:
        ring = pts + [pts[0]]
        for i in range(len(ring) - 1):
            ax, ay = ring[i]
            bx, by = ring[i + 1]
            k = _key(ax, ay, bx, by)
            occur[k] = occur.get(k, 0) + 1
            counts.setdefault(k, (ax, ay, bx, by))

    shared = [k for k, n in occur.items() if n >= 2]
    use_keys = shared if shared else list(counts.keys())
    if not shared:
        warnings.append(
            "tier-3: no shared edges between room polygons (rooms likely "
            "offset by wall thickness); falling back to all polygon edges"
        )

    walls: list[dict] = []
    idx = 0
    for k in use_keys:
        ax, ay, bx, by = counts[k]
        w = _seg_to_wall(
            idx, ax / mult, ay / mult, bx / mult, by / mult,
            mult, "(polygon-edge)", 3, 0.50, None,
        )
        if w:
            walls.append(w)
            idx += 1
    return walls


def _tier4_all_lines(ebt: dict, mult: float) -> list[dict]:
    """Last resort: every LINE + LWPOLYLINE segment, unfiltered."""
    walls: list[dict] = []
    idx = 0
    for line in ebt["LINE"]:
        try:
            s, e = line.dxf.start, line.dxf.end
            w = _seg_to_wall(idx, s.x, s.y, e.x, e.y, mult, line.dxf.layer, 4, 0.30, None)
            if w:
                walls.append(w)
                idx += 1
        except Exception:  # noqa: BLE001
            continue
    for pl in ebt["LWPOLYLINE"]:
        try:
            pts = pl.get_points("xy")
            if pl.closed and len(pts) > 2:
                pts = list(pts) + [pts[0]]
            for (ax, ay, bx, by) in _polyline_segments(list(pts)):
                w = _seg_to_wall(idx, ax, ay, bx, by, mult, pl.dxf.layer, 4, 0.30, None)
                if w:
                    walls.append(w)
                    idx += 1
        except Exception:  # noqa: BLE001
            continue
    return walls


# ── thickness enrichment + junctions now live in kos_drawing_geometry ───────
# _perp_distance, _projected_overlap, _enrich_thickness and _detect_junctions
# moved there (shared with the PDF parser); _enrich_thickness and
# _detect_junctions are imported at the top of this module.


def _detect_walls(ebt: dict, doc: Any, mult: float, warnings: list[str],
                  msp: Any) -> tuple[list[dict], int]:
    """Run the 4 tiers in order (first tier yielding walls wins), then enrich
    thickness on the winning set. Tier order/semantics are unchanged; the
    single-return structure gives the enrichment pass one place to run."""
    walls = _tier1_wall_layers(ebt, mult)
    tier = 1
    if not walls:
        walls = _tier2_thick_double_lines(ebt, doc, mult, warnings)
        tier = 2
    if not walls:
        walls = _tier3_polygon_shared_edges(ebt, mult, warnings)
        tier = 3
    if not walls:
        walls = _tier4_all_lines(ebt, mult)
        tier = 4
    _enrich_thickness(walls, msp, warnings)
    return walls, tier


# ── orchestrator ────────────────────────────────────────────────────────


def parse_dxf_walls(dxf_path: str, filename: str | None = None) -> dict:
    """Parse a DXF: walls, inventory, bounds, units, junctions, confidence.

    Returns a dict carrying the parse payload plus ``_doc`` / ``_msp`` so the
    route can reuse the opened document for classification + title block
    extraction without re-reading the file. The route strips those private
    keys before serialising the HTTP response.

    On a fatal open error returns ``{"error": ..., "message": ...}`` (no
    ``_doc``); the caller turns that into a 500.
    """
    started = time.monotonic()
    warnings: list[str] = []

    try:
        doc, msp, open_warnings = open_dxf(dxf_path)
        warnings.extend(open_warnings)
    except Exception as exc:  # noqa: BLE001
        log.error("dxf_open_failed", filename=filename, error=str(exc), exc_info=True)
        return {
            "error": "dxf_open_failed",
            "message": f"Could not open DXF ({type(exc).__name__}: {exc})",
        }

    unit_name, mult, unit_warnings = detect_units(doc)
    warnings.extend(unit_warnings)

    ebt, layers_index, bounds, bad_count, inv_warnings = _inventory(msp, doc)
    warnings.extend(inv_warnings)

    walls, tier = _detect_walls(ebt, doc, mult, warnings, msp)
    junctions = _detect_junctions(walls, warnings)

    # ── Phase 5C-3: opening (door/window) extraction ────────────────────────
    # Extract raw INSERT / ARC / TEXT / MTEXT entities into a pure-dict bag
    # (already in mm via ``mult``) and run the multi-tier detector. We
    # default the classification to "FLOOR_PLAN" here — the router applies a
    # downstream gate that re-runs the orchestrator with the actual
    # classification, blanking openings for non-floor-plan drawings. The
    # parser's responsibility is to make the entity bag + openings tuple
    # available; per-classification policy lives at the router edge.
    try:
        raw_entities = extract_dxf_entities(msp, mult)
    except Exception as exc:  # noqa: BLE001 — never let detection abort a parse
        warnings.append(
            f"opening entity extraction failed ({type(exc).__name__}: {exc})"
        )
        raw_entities = {"inserts": [], "arcs": [], "texts": []}

    try:
        openings, opening_warnings = detect_openings(
            walls=walls,
            junctions=junctions,
            raw_entities=raw_entities,
            source_type="dxf",
            classification="FLOOR_PLAN",
        )
        warnings.extend(opening_warnings)
    except Exception as exc:  # noqa: BLE001
        warnings.append(
            f"opening detection failed ({type(exc).__name__}: {exc})"
        )
        openings = ()

    # Confidence: base on tier, penalise missing thickness + missing dims.
    tier_conf = {1: 0.85, 2: 0.65, 3: 0.50, 4: 0.30}[tier]
    any_thickness = any(w["thickness_mm"] is not None for w in walls)
    has_dims = len(ebt["DIMENSION"]) > 0
    overall = tier_conf
    if not any_thickness:
        overall -= 0.1
    if not has_dims:
        overall -= 0.1
    overall = max(0.0, min(1.0, overall))

    counts = {t: len(ebt[t]) for t in _TRACKED_TYPES}
    total_entities = sum(counts.values()) + bad_count
    duration_ms = int((time.monotonic() - started) * 1000)

    walls_field_conf = tier_conf - (0.0 if any_thickness else 0.1)
    walls_field_conf = max(0.0, min(1.0, walls_field_conf))

    return {
        "_doc": doc,
        "_msp": msp,
        "walls": walls,
        "junctions": junctions,
        "openings": openings,
        "raw_opening_entities": raw_entities,
        "detection_tier": tier,
        "overall_confidence": round(overall, 2),
        "walls_field_confidence": round(walls_field_conf, 2),
        "units_detected": unit_name,
        "unit_multiplier_mm": mult,
        "drawing_bounds": bounds,
        "layers_index": layers_index,
        "layers_found": sorted(layers_index.keys()),
        "entity_counts": counts,
        "total_entities": total_entities,
        "has_dimensions": has_dims,
        "any_thickness": any_thickness,
        "warnings": warnings,
        "duration_ms": duration_ms,
        "parser_version": PARSER_VERSION,
        "phase": PHASE,
    }
