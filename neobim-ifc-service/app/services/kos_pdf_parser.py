"""KOS drawing parser — PDF wall + title-block extractor (Week 5C-2).

Vector-only parsing of customer PDF drawings via PyMuPDF (``fitz``). Mirrors
the DXF parser's output schema exactly (same JSON keys/types) so the route and
all downstream consumers are format-agnostic; only the internals differ.

Why a separate tier-1 from the DXF parser: the source PDFs are FLATTENED CAD
exports — ``page.get_ocgs()`` returns 0, so there are NO layers. The DXF
isolated walls with a layer regex (A-WALL*, excluding S-FNDN/S-COLS/S-STRS);
that information is gone here. Walls are instead the **black + 1.2pt** stroke
class, collinear-merged and length-filtered (see ``PDF_TIER1_WALL_RUN_MIN_MM``).
The shared geometry (``_seg_to_wall``/``_enrich_thickness``/``_detect_junctions``)
and the title-block validators are reused, not duplicated.
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

import structlog

from app.services.kos_drawing_geometry import (
    _detect_junctions,
    _enrich_thickness,
    _seg_to_wall,
)
from app.services.kos_title_block_extractor import (
    _FIELDS,
    _parse_filename,
    _refine,
)

log = structlog.get_logger()

PARSER_VERSION = "0.2.0"
PHASE = "5C-2"

# A PDF user-space unit is 1/72 inch by definition → this many mm on paper.
PDF_PT_TO_PAPER_MM = 25.4 / 72.0  # ≈ 0.352778

# Minimum length (mm, real-world) of a merged black-1.2pt run to count as a wall.
#
# WHY 350mm and WHY here: the source PDFs are FLATTENED CAD exports — get_ocgs()
# returns 0, so there are NO layers. In the DXF, walls were isolated by the
# A-WALL* layer regex, which EXCLUDED S-FNDN/S-COLS/S-STRS/grid. That layer
# information is gone in the PDF: the black-1.2pt lineweight that draws walls
# ALSO draws foundations, columns, stairs, slab edges and the chord-decomposed
# ramp. Lineweight alone therefore over-selects (raw black-1.2 >=200mm = 532/472
# segments vs the band's 250/200 ceiling). A collinear-merge + this length floor
# recovers the wall-count band: at 350mm, MR=139 (band 80-250) and TC=121 (band
# 60-200), stable up to 600mm (not a knife-edge), with 84-93% thickness.
#
# 350mm is empirically tuned on the two customer drawings but principled: it sits
# above jamb returns / column faces / short structural ticks and below any real
# wall run between corners/openings. A different drafter could shift it — this is
# the single tunable knob, isolated here on purpose. True wall-vs-structural-
# element separation is a semantic problem (5C-3 vision), not a vector one.
PDF_TIER1_WALL_RUN_MIN_MM = 350.0

# Collinear-merge tolerances (mm). gap=0 → only union overlapping/touching
# runs on the same supporting line (validated; larger gaps inflate the count).
_MERGE_GAP_MM = 0.0
_MERGE_ANGLE_BUCKET = 0.5   # group supporting lines by 0.5° angle buckets
_MERGE_RHO_BUCKET = 1.0     # ... and 1mm perpendicular-offset buckets

# Default scale assumed when the title block carries no readable scale.
_DEFAULT_SCALE_DENOM = 100

# Title-block labels → fields (firm template; text is rotated 90°, value sits in
# the column immediately right of the label). Only fields in _FIELDS are mapped.
_PDF_LABELS: list[tuple[str, str]] = [
    ("Drawing #:", "drawing_number"),
    ("Rev:", "revision"),
    ("Scale:", "scale"),
    ("Drw:", "drawn_by"),
    ("Ckd:", "checked_by"),
    ("Title:", "drawing_title"),
    ("Project:", "project_name"),
]


# ── open + scale ────────────────────────────────────────────────────────


def open_pdf(pdf_path: str) -> tuple[Any, Any, list[str]]:
    """Open a PDF, returning ``(doc, page0, warnings)``."""
    import fitz  # lazy — keeps app boot alive if the dep isn't built yet

    warnings: list[str] = []
    doc = fitz.open(pdf_path)
    if doc.page_count == 0:
        raise ValueError("PDF has no pages")
    if doc.page_count > 1:
        warnings.append(f"PDF has {doc.page_count} pages; parsing page 1 only")
    return doc, doc[0], warnings


def _scale_denominator(scale: str | None) -> int | None:
    """`'1:50'` → 50 (validators already normalised the string)."""
    if not scale:
        return None
    m = re.match(r"^1:(\d+)$", scale.strip())
    return int(m.group(1)) if m else None


# ── geometry collection + collinear merge ───────────────────────────────


def _is_black(col) -> bool:
    return col is not None and tuple(round(c, 2) for c in col) == (0.0, 0.0, 0.0)


def _path_segments(item) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Decompose one get_drawings() item into (p, q) endpoint pairs (pt)."""
    op = item[0]
    if op == "l":
        a, b = item[1], item[2]
        return [((a.x, a.y), (b.x, b.y))]
    if op == "re":
        r = item[1]
        c = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
        return [(c[i], c[(i + 1) % 4]) for i in range(4)]
    return []  # curves ('c') and others are not wall candidates


def _collect_segments(page: Any, pred, pt_to_mm: float) -> list[tuple]:
    """All wall-candidate segments (mm) whose stroke matches ``pred(color, width)``."""
    out: list[tuple] = []
    for d in page.get_drawings():
        col = d.get("color")
        w = round(d.get("width") or 0.0, 2)
        if not pred(col, w):
            continue
        for it in d["items"]:
            for (a, b) in _path_segments(it):
                out.append(((a[0] * pt_to_mm, a[1] * pt_to_mm),
                            (b[0] * pt_to_mm, b[1] * pt_to_mm)))
    return out


def _merge_collinear(segs: list[tuple], gap: float = _MERGE_GAP_MM) -> list[tuple]:
    """Union collinear, overlapping/touching segments into runs.

    Group by supporting line (angle bucket + signed perpendicular offset from
    origin), project endpoints onto the line direction, then union intervals
    within ``gap``. Returns merged run endpoints in the input units (mm).
    """
    groups: dict[tuple[int, int], list[tuple]] = {}
    for (a, b) in segs:
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L == 0:
            continue
        ang = math.degrees(math.atan2(dy, dx)) % 180.0
        ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        nx, ny = -uy, ux
        rho = a[0] * nx + a[1] * ny
        key = (round(ang / _MERGE_ANGLE_BUCKET), round(rho / _MERGE_RHO_BUCKET))
        groups.setdefault(key, []).append((a, b, ux, uy, rho, nx, ny))

    runs: list[tuple] = []
    for items in groups.values():
        ux, uy, rho, nx, ny = items[0][2], items[0][3], items[0][4], items[0][5], items[0][6]
        ivals = sorted(
            (min(a[0] * ux + a[1] * uy, b[0] * ux + b[1] * uy),
             max(a[0] * ux + a[1] * uy, b[0] * ux + b[1] * uy))
            for (a, b, *_rest) in items
        )
        cs, ce = ivals[0]

        def _emit(s: float, e: float) -> None:
            runs.append(((s * ux + rho * nx, s * uy + rho * ny),
                         (e * ux + rho * nx, e * uy + rho * ny)))

        for s, e in ivals[1:]:
            if s <= ce + gap:
                ce = max(ce, e)
            else:
                _emit(cs, ce)
                cs, ce = s, e
        _emit(cs, ce)
    return runs


# ── wall detection (tier cascade; first non-empty wins) ──────────────────

_TIERS = (
    (1, 0.85, "PDF:black@1.2pt", lambda col, w: _is_black(col) and w == 1.2),
    (2, 0.65, "PDF:black@{0.48,1.2}", lambda col, w: _is_black(col) and w in (0.48, 1.2)),
    (3, 0.40, "PDF:any-stroke", lambda col, w: col is not None),
)


def _detect_pdf_walls(page: Any, pt_to_mm: float, warnings: list[str]
                      ) -> tuple[list[dict], int, float]:
    """Run the tier cascade; first tier yielding ≥1 wall wins."""
    for tier, conf, layer, pred in _TIERS:
        segs = _collect_segments(page, pred, pt_to_mm)
        runs = _merge_collinear(segs)
        walls: list[dict] = []
        idx = 0
        for (p, q) in runs:
            w = _seg_to_wall(idx, p[0], p[1], q[0], q[1], 1.0, layer, tier, conf, None)
            if w and w["length_mm"] >= PDF_TIER1_WALL_RUN_MIN_MM:
                walls.append(w)
                idx += 1
        if walls:
            return walls, tier, conf
    return [], 3, 0.40


# ── inventory ─────────────────────────────────────────────────────────────


def _inventory_pdf(page: Any, pt_to_mm: float) -> tuple[dict, dict, list[str]]:
    """Entity counts (mapped to the DXF tracked-type keys so the response
    assembly is uniform), page bounds in mm, and synthetic layer identifiers."""
    n_l = n_re = n_c = n_fill = 0
    classes: set[str] = set()
    for d in page.get_drawings():
        col = d.get("color")
        w = round(d.get("width") or 0.0, 2)
        if d.get("fill") is not None:
            n_fill += 1
        if col is not None:
            cls = "black" if _is_black(col) else (
                "gray" if tuple(round(c, 2) for c in col) == (0.5, 0.5, 0.5) else "other")
            classes.add(f"PDF:{cls}@{w}")
        for it in d["items"]:
            if it[0] == "l":
                n_l += 1
            elif it[0] == "re":
                n_re += 1
            elif it[0] == "c":
                n_c += 1

    td = page.get_text("dict")
    n_text = sum(len(ln["spans"]) for b in td["blocks"] if b["type"] == 0 for ln in b["lines"])
    n_img = sum(1 for b in td["blocks"] if b["type"] == 1)

    counts = {
        "LINE": n_l, "LWPOLYLINE": n_re, "POLYLINE": 0, "CIRCLE": 0, "ARC": n_c,
        "TEXT": n_text, "MTEXT": 0, "DIMENSION": 0, "INSERT": n_img, "HATCH": n_fill,
    }
    r = page.rect
    bounds = {
        "min_x": 0.0, "min_y": 0.0,
        "max_x": round(r.width * pt_to_mm, 3), "max_y": round(r.height * pt_to_mm, 3),
    }
    return counts, bounds, sorted(classes)


# ── title block ───────────────────────────────────────────────────────────


def extract_title_block_pdf(page: Any, filename: str | None = None) -> dict:
    """Position-based title-block extraction. Same return shape as the DXF
    ``extract_title_block``. Reuses the shared validators via ``_refine``."""
    warnings: list[str] = []
    result: dict[str, Any] = {f: None for f in _FIELDS}

    spans: list[tuple] = []
    try:
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for ln in b["lines"]:
                for sp in ln["spans"]:
                    t = sp["text"].strip()
                    if t:
                        x0, y0, x1, y1 = sp["bbox"]
                        spans.append((t, x0, y0, x1, y1))
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"could not enumerate text spans: {exc}")

    # Pairing (text is rotated 90°): the value is the span in the column
    # IMMEDIATELY right of the label (smallest x-gap), on roughly the same row.
    # x-gap is primary, not y-gap: long rotated values (the drawing number) have
    # tall bboxes whose mid-y misleads, and stray short spans can sit close in y.
    # The y-window allows a value slightly ABOVE the label (Rev's value is ~16pt
    # above its label), with the y-overlap broadened accordingly.
    tb_found = 0
    for label, field in _PDF_LABELS:
        if result.get(field) is not None:
            continue
        lab = next((s for s in spans if s[0] == label), None)
        if lab is None:
            continue
        _, lx0, ly0, lx1, ly1 = lab
        lab_my = (ly0 + ly1) / 2.0
        ylo, yhi = ly0 - 30.0, ly1 + 10.0
        best_val: str | None = None
        best_key = (math.inf, math.inf)
        for (t, x0, y0, x1, y1) in spans:
            if t.endswith(":") or t == label:        # never pick a label as a value
                continue
            if not (lx1 - 2.0 <= x0 <= lx1 + 40.0):  # column immediately right
                continue
            if y1 < ylo or y0 > yhi:                 # roughly same row (value may sit above)
                continue
            key = (round(x0 - lx1, 1), abs((y0 + y1) / 2.0 - lab_my))
            if key < best_key:
                best_key, best_val = key, t
        if best_val is not None:
            v = _refine(best_val, field)
            if v:
                result[field] = v
                tb_found += 1

    # Filename fallback — fills gaps only (gives drawing_number/revision/level).
    fn_found = 0
    if filename:
        for k, val in _parse_filename(filename).items():
            if result.get(k) is None and val:
                result[k] = val
                fn_found += 1

    if tb_found and fn_found:
        source = "mixed"
    elif tb_found:
        source = "title_block"
    elif fn_found:
        source = "filename"
    else:
        source = "none"
        warnings.append("no title-block fields extracted from text or filename")

    result["raw_text_block"] = "\n".join(s[0] for s in spans[:200])
    result["source"] = source
    result["extraction_warnings"] = warnings
    return result


# ── orchestrator ────────────────────────────────────────────────────────


def parse_pdf_walls(pdf_path: str, filename: str | None = None) -> dict:
    """Parse a PDF: walls, inventory, bounds, scale, junctions, title block,
    confidence. Output schema mirrors ``parse_dxf_walls`` plus private
    ``_pdf_doc`` / ``_page`` / ``title_block`` keys for the route."""
    started = time.monotonic()
    warnings: list[str] = []

    try:
        doc, page, open_w = open_pdf(pdf_path)
        warnings.extend(open_w)
    except Exception as exc:  # noqa: BLE001
        log.error("pdf_open_failed", filename=filename, error=str(exc), exc_info=True)
        return {
            "error": "pdf_open_failed",
            "message": f"Could not open PDF ({type(exc).__name__}: {exc})",
        }

    title_block = extract_title_block_pdf(page, filename)
    denom = _scale_denominator(title_block.get("scale"))
    if denom is None:
        denom = _DEFAULT_SCALE_DENOM
        warnings.append(
            f"no drawing scale in title block; assuming 1:{_DEFAULT_SCALE_DENOM} — "
            "all lengths/thicknesses may be wrong if the true scale differs"
        )
    pt_to_mm = PDF_PT_TO_PAPER_MM * denom

    counts, bounds, layers_found = _inventory_pdf(page, pt_to_mm)
    walls, tier, tier_conf = _detect_pdf_walls(page, pt_to_mm, warnings)
    _enrich_thickness(walls, None, warnings)
    junctions = _detect_junctions(walls, warnings)

    any_thickness = any(w["thickness_mm"] is not None for w in walls)
    has_dims = counts["DIMENSION"] > 0  # flattened PDFs carry no DIMENSION entities
    overall = tier_conf - (0.0 if any_thickness else 0.1) - (0.0 if has_dims else 0.1)
    overall = max(0.0, min(1.0, overall))
    walls_field_conf = max(0.0, min(1.0, tier_conf - (0.0 if any_thickness else 0.1)))

    total_entities = sum(counts.values())
    duration_ms = int((time.monotonic() - started) * 1000)

    return {
        "_pdf_doc": doc,
        "_page": page,
        "title_block": title_block,
        "walls": walls,
        "junctions": junctions,
        "detection_tier": tier,
        "overall_confidence": round(overall, 2),
        "walls_field_confidence": round(walls_field_conf, 2),
        "units_detected": f"pdf 1:{denom} (pt→mm ×{pt_to_mm:.4f})",
        "unit_multiplier_mm": round(pt_to_mm, 4),
        "drawing_bounds": bounds,
        "layers_index": {},
        "layers_found": layers_found,
        "entity_counts": counts,
        "total_entities": total_entities,
        "has_dimensions": has_dims,
        "any_thickness": any_thickness,
        "warnings": warnings,
        "duration_ms": duration_ms,
        "parser_version": PARSER_VERSION,
        "phase": PHASE,
    }
