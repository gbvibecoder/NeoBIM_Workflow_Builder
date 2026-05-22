"""KOS title-block extractor (Week 5C-1, Phase 1).

Pulls project metadata (drawing number, revision, title, scale, level,
client, dates, names) out of a DXF in two complementary ways:

1. **Title-block region scan** — title blocks live in the bottom-right
   corner. We collect TEXT/MTEXT in the bottom-right 25% of the drawing
   extent, then match label keywords ("DRAWING NO", "SCALE", "REV", …) to
   their values by proximity (value is usually to the right of, or just
   below, its label).

2. **Filename fallback** — many CAD drawings have a sparse title block but a
   rich filename. We parse a "CODE[REV]-Title-Level-Part" pattern
   defensively; anything that doesn't match stays ``None``.

``source`` records where each value came from: ``title_block`` / ``filename``
/ ``mixed`` / ``none``. Filename never overwrites a value found in the title
block — it only fills gaps.
"""

from __future__ import annotations

import math
import os
import re
from typing import Any

import structlog

log = structlog.get_logger()

# Label → field. Order matters: more specific labels first so "DRAWING NO"
# wins over a bare "DRAWING".
_LABELS: list[tuple[str, str]] = [
    ("PROJECT NAME", "project_name"),
    ("PROJECT", "project_name"),
    ("DRAWING NUMBER", "drawing_number"),
    ("DRAWING NO", "drawing_number"),
    ("DWG NO", "drawing_number"),
    ("DRG NO", "drawing_number"),
    ("REVISION", "revision"),
    ("REV", "revision"),
    ("SCALE", "scale"),
    ("DRAWN BY", "drawn_by"),
    ("CHECKED BY", "checked_by"),
    ("CHK", "checked_by"),
    ("DATE", "date"),
    ("SHEET", "sheet"),
    ("SHT", "sheet"),
    ("LEVEL", "level"),
    ("STOREY", "level"),
    ("STORY", "level"),
    ("CLIENT", "client"),
    ("DRAWING TITLE", "drawing_title"),
    ("TITLE", "drawing_title"),
    ("DRAWN", "drawn_by"),
    ("BY", "drawn_by"),
    ("FLOOR", "level"),
]

_FIELDS = (
    "project_name", "drawing_number", "drawing_title", "revision", "scale",
    "date", "sheet", "level", "client", "drawn_by", "checked_by",
)

_SCALE_RE = re.compile(r"1\s*:\s*\d{1,5}")
_LEVEL_TOKENS = (
    "BASEMENT", "GROUND", "PODIUM", "MEZZANINE", "TYPICAL", "STILT", "ROOF",
    "FIRST", "SECOND", "THIRD", "FOURTH", "FLOOR", "TERRACE", "PARKING",
)


def _text_entities_with_pos(msp: Any) -> list[tuple[str, float, float]]:
    """All TEXT/MTEXT as (text, x, y). Best-effort on insert position."""
    out: list[tuple[str, float, float]] = []
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "TEXT":
                p = entity.dxf.insert
                out.append((str(entity.dxf.text).strip(), float(p.x), float(p.y)))
            elif etype == "MTEXT":
                p = entity.dxf.insert
                out.append((str(entity.text).strip(), float(p.x), float(p.y)))
        except Exception:  # noqa: BLE001
            continue
    return out


def _bottom_right_region(texts: list[tuple[str, float, float]]) -> list[tuple[str, float, float]]:
    """Texts in the bottom-right 25% of the text bounding box."""
    if not texts:
        return []
    xs = [t[1] for t in texts]
    ys = [t[2] for t in texts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w = max_x - min_x
    h = max_y - min_y
    if w <= 0 or h <= 0:
        return []
    x_thresh = min_x + 0.75 * w
    y_thresh = min_y + 0.25 * h
    return [t for t in texts if t[1] >= x_thresh and t[2] <= y_thresh]


def _match_value_for_label(
    label: str, label_text: str, label_pos: tuple[float, float],
    all_texts: list[tuple[str, float, float]], field: str,
) -> str | None:
    """Resolve a label's value.

    First: if the label entity carries an inline value ("SCALE 1:100",
    "REV: J"), strip the matched label keyword off the front and keep the
    remainder — we strip the *label*, not split on the first colon, so a
    scale like "1:100" survives intact. Otherwise find the nearest text to
    the right of, or just below, the label.
    """
    # Inline value: strip the matched label keyword from the front.
    up = label_text.upper()
    pos = up.find(label)
    if pos != -1:
        remainder = label_text[pos + len(label):].lstrip(": -\t").strip()
        if remainder:
            return _refine(remainder, field)

    lx, ly = label_pos
    # Spatial neighbour: prefer text to the right on the same row, else below.
    best: tuple[float, str] | None = None
    for (txt, x, y) in all_texts:
        if not txt or (x == lx and y == ly):
            continue
        if _is_label(txt):
            continue
        dx, dy = x - lx, ly - y
        # Right & roughly same row.
        if dx > 0 and abs(dy) < max(abs(dx), 1.0) * 0.6:
            dist = math.hypot(dx, dy)
            if best is None or dist < best[0]:
                best = (dist, txt)
        # Directly below.
        elif dy > 0 and abs(dx) < max(dy, 1.0) * 0.6:
            dist = math.hypot(dx, dy)
            if best is None or dist < best[0]:
                best = (dist, txt)
    if best:
        return _refine(best[1], field)
    return None


def _is_label(text: str) -> bool:
    up = text.upper()
    return any(up.startswith(lbl) for lbl, _ in _LABELS)


def _refine(value: str, field: str) -> str | None:
    """Field-specific cleanup of a raw matched value."""
    value = value.strip().strip(":").strip()
    if not value:
        return None
    if field == "scale":
        m = _SCALE_RE.search(value)
        return m.group(0).replace(" ", "") if m else value
    if field == "revision":
        # Revisions are short tokens; take the first.
        tok = value.split()[0] if value.split() else value
        return tok[:8]
    return value


def _parse_filename(filename: str) -> dict:
    """Defensive "CODE[REV]-Title-Level-Part.ext" parse.

    Example:
      "90VR-MR-AD-2501-CAD[J]-Concrete Setout Plan-Basement-Part.dxf"
      → drawing_number="90VR-MR-AD-2501-CAD", revision="J",
        drawing_title="Concrete Setout Plan", level="BASEMENT"
    Anything that doesn't match stays absent.
    """
    out: dict[str, str] = {}
    if not filename:
        return out
    stem = os.path.splitext(os.path.basename(filename))[0]

    m = re.match(r"^(?P<num>.+?)\[(?P<rev>[^\]]+)\](?P<rest>.*)$", stem)
    if m:
        num = m.group("num").rstrip("-").strip()
        # Trailing "-CAD" is a plot-style marker, not part of the number,
        # but the spec example keeps it ambiguous — strip a trailing -CAD.
        out["drawing_number"] = re.sub(r"-CAD$", "", num).strip() or num
        out["revision"] = m.group("rev").strip()
        rest = m.group("rest").lstrip("-").strip()
    else:
        # No revision bracket — treat the whole stem as a candidate number if
        # it looks code-like (has hyphens + digits), else as a title.
        if re.search(r"\d", stem) and "-" in stem:
            out["drawing_number"] = stem
        rest = stem

    if rest:
        parts = [p.strip() for p in rest.split("-") if p.strip()]
        # Drop a trailing "Part" marker.
        parts = [p for p in parts if p.upper() != "PART"]
        if parts:
            out["drawing_title"] = parts[0]
            for p in parts[1:]:
                if any(tok in p.upper() for tok in _LEVEL_TOKENS):
                    out["level"] = p.upper()
                    break
    return out


def extract_title_block(doc: Any, msp: Any, filename: str | None = None) -> dict:
    """Extract title-block metadata. See module docstring for strategy."""
    warnings: list[str] = []
    result: dict[str, Any] = {f: None for f in _FIELDS}

    try:
        all_texts = _text_entities_with_pos(msp)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"could not enumerate text entities: {exc}")
        all_texts = []

    region = _bottom_right_region(all_texts)
    scan_texts = region
    if not region and all_texts:
        warnings.append(
            "no text in bottom-right title-block region; scanning all text"
        )
        scan_texts = all_texts

    tb_found = 0
    raw_lines: list[str] = []
    for (txt, x, y) in scan_texts:
        raw_lines.append(txt)
        up = txt.upper()
        for label, field in _LABELS:
            if result[field] is not None:
                continue
            if up.startswith(label) or f" {label}" in up[:40]:
                value = _match_value_for_label(label, txt, (x, y), all_texts, field)
                if value:
                    result[field] = value
                    tb_found += 1
                break

    # A bare scale value ("1:100") may appear without a SCALE label.
    if result["scale"] is None:
        for (txt, _x, _y) in scan_texts:
            m = _SCALE_RE.search(txt)
            if m:
                result["scale"] = m.group(0).replace(" ", "")
                tb_found += 1
                break

    raw_text_block = "\n".join(raw_lines)

    # Filename fallback — fills gaps only, never overwrites.
    fn_found = 0
    if filename:
        fn = _parse_filename(filename)
        for field, val in fn.items():
            if result.get(field) is None and val:
                result[field] = val
                fn_found += 1

    if tb_found and fn_found:
        source = "mixed"
    elif tb_found:
        source = "title_block"
    elif fn_found:
        source = "filename"
    else:
        source = "none"
        warnings.append(
            "no title-block fields extracted from geometry or filename"
        )

    result["raw_text_block"] = raw_text_block
    result["source"] = source
    result["extraction_warnings"] = warnings
    return result
