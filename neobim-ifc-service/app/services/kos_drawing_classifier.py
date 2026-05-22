"""KOS drawing classifier (Week 5C-1, Phase 1).

Lightweight, vector-only drawing-type detector. Given a parsed ezdxf
``doc`` + ``msp`` (and optionally the extracted ``title_block``) it walks a
first-match-wins decision tree:

  0. FLOOR_PLAN  — title-block drawing title names a plan/setout/layout/floor
                   drawing (AUTHORITATIVE; skips the body-text scan)
  1. TITLE_SHEET — mostly text, almost no geometry (a pure metadata sheet)
  2. SECTION     — STRONG "SECTION A-A" / "SECTION 1-1" callout text
  3. ELEVATION   — level markers (FFL / +0.000 / GL / GROUND LEVEL) with a
                   vertically-dominant extent
  4. FLOOR_PLAN  — plan keywords (PLAN / SETOUT / BASEMENT / LAYOUT…) with
                   closed room polygons present, or a title-block storey level
  5. DETAIL      — dense geometry in a small footprint + heavy dimensioning
  6. SECTION     — bare "SECTION" keyword tiebreaker (nothing stronger matched)
  7. UNKNOWN     — nothing matched

A plan drawing routinely contains section-cut markers; that is why a bare
"SECTION" keyword is a last-resort tiebreaker (step 6), never a step-2 winner,
and why the title-block plan title (step 0) dominates everything.

Confidence scales with how many independent signals fired for the chosen
type. NO vision, NO LLM — pure heuristics.
"""

from __future__ import annotations

import math
import re
from typing import Any

import structlog

log = structlog.get_logger()

# How many TEXT/MTEXT entities to sample for keyword scanning. Drawings can
# carry tens of thousands of text entities; the title/type keywords we look
# for appear early and often, so a generous sample is plenty and bounds cost.
_TEXT_SAMPLE_LIMIT = 4000

_SECTION_TOKENS = ("SECTION A-A", "SECTION 1-1", "SECTION B-B", "SECTION")
_ELEVATION_TOKENS = ("FFL", "+0.000", " GL ", "GROUND LEVEL", "ELEVATION")
_PLAN_TOKENS = ("PLAN", "FLOOR", "SETOUT", "BASEMENT", "GROUND FLOOR", "LAYOUT")

# Title-block drawing-title keywords that mark a plan/setout/layout drawing —
# the authoritative FLOOR_PLAN signal (Section A, Step 0).
_PLAN_TITLE_RE = re.compile(r"(plan|setout|layout|floor)", re.IGNORECASE)

# Title-block level values that name a building storey — a positive FLOOR_PLAN hint.
_LEVEL_FLOOR_TOKENS = (
    "BASEMENT", "GROUND", "LEVEL", "FLOOR", "PODIUM", "STILT", "ROOF",
    "MEZZANINE", "TERRACE", "GF", "LG", "B1", "B2", "L1", "L2",
)


def _collect_text(msp: Any) -> str:
    """Uppercased concatenation of a sample of TEXT/MTEXT content."""
    chunks: list[str] = []
    seen = 0
    for entity in msp:
        if seen >= _TEXT_SAMPLE_LIMIT:
            break
        try:
            etype = entity.dxftype()
            if etype == "TEXT":
                chunks.append(str(entity.dxf.text))
                seen += 1
            elif etype == "MTEXT":
                # .text is the plain (formatting-stripped) string in ezdxf.
                chunks.append(str(entity.text))
                seen += 1
        except Exception:  # noqa: BLE001
            continue
    return ("\n".join(chunks)).upper()


def _counts(msp: Any) -> dict[str, int]:
    counts = {
        "TEXT": 0, "MTEXT": 0, "LINE": 0, "LWPOLYLINE": 0, "POLYLINE": 0,
        "DIMENSION": 0, "CIRCLE": 0, "ARC": 0, "CLOSED_POLY": 0, "TOTAL": 0,
    }
    for entity in msp:
        try:
            etype = entity.dxftype()
            counts["TOTAL"] += 1
            if etype in counts:
                counts[etype] += 1
            if etype == "LWPOLYLINE" and getattr(entity, "closed", False):
                counts["CLOSED_POLY"] += 1
        except Exception:  # noqa: BLE001
            continue
    return counts


def _bounds_aspect(msp: Any) -> tuple[float, float]:
    """Return (width, height) of the geometric extent; (0, 0) if empty."""
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "LINE":
                for p in (entity.dxf.start, entity.dxf.end):
                    min_x, min_y = min(min_x, p.x), min(min_y, p.y)
                    max_x, max_y = max(max_x, p.x), max(max_y, p.y)
            elif etype == "LWPOLYLINE":
                for p in entity.get_points("xy"):
                    min_x, min_y = min(min_x, p[0]), min(min_y, p[1])
                    max_x, max_y = max(max_x, p[0]), max(max_y, p[1])
        except Exception:  # noqa: BLE001
            continue
    if min_x is math.inf:
        return 0.0, 0.0
    return max_x - min_x, max_y - min_y


def classify_drawing(doc: Any, msp: Any, title_block: dict | None = None) -> dict:
    """Classify the drawing type. See module docstring for the decision tree.

    ``title_block`` (optional) is the extracted title-block metadata. When it
    names a plan/setout/layout drawing it is the dominant, authoritative signal
    and short-circuits the body-text scan (Step 0) — a plan drawing routinely
    contains section-cut markers, which must never flip its classification.
    """
    # Step 0 — title-block PLAN signal dominates; body scan is skipped entirely.
    tb = title_block or {}
    drawing_title = tb.get("drawing_title")
    level = tb.get("level")
    plan_title = bool(drawing_title) and bool(_PLAN_TITLE_RE.search(str(drawing_title)))
    plan_level = bool(level) and any(
        tok in str(level).upper() for tok in _LEVEL_FLOOR_TOKENS
    )
    if plan_title:
        signals = [f"title_block:drawing_title={drawing_title!r}"]
        if plan_level:
            signals.append(f"title_block:level={level!r}")
        conf = 0.9 if plan_level else 0.85
        return _result(
            "FLOOR_PLAN", conf, signals,
            "Title-block drawing title names a plan/setout/layout/floor "
            "drawing — authoritative signal; body section markers ignored.",
        )

    try:
        counts = _counts(msp)
        text = _collect_text(msp)
        width, height = _bounds_aspect(msp)
    except Exception as exc:  # noqa: BLE001
        log.warning("classify_inventory_failed", error=str(exc))
        return {
            "type": "UNKNOWN",
            "confidence": 0.0,
            "signals_matched": [],
            "reasoning": f"inventory failed: {type(exc).__name__}: {exc}",
        }

    total = max(counts["TOTAL"], 1)
    text_count = counts["TEXT"] + counts["MTEXT"]
    geom_count = counts["LINE"] + counts["LWPOLYLINE"] + counts["POLYLINE"]
    text_ratio = text_count / total
    geom_ratio = geom_count / total

    # 1 — TITLE_SHEET: text-dominated, almost no geometry.
    if text_ratio > 0.5 and geom_ratio < 0.2:
        signals = [
            f"text_ratio={text_ratio:.2f} (>0.5)",
            f"geom_ratio={geom_ratio:.2f} (<0.2)",
        ]
        return _result("TITLE_SHEET", 0.8, signals,
                       "Text entities dominate with negligible geometry — "
                       "reads as a pure metadata / title sheet.")

    # 2 — SECTION (STRONG callouts only). Bare "SECTION" is demoted to a
    # last-resort tiebreaker (step 6) so it can never outrank a real plan.
    section_hits = [t for t in _SECTION_TOKENS if t in text]
    strong_section = [h for h in section_hits if h != "SECTION"]
    if strong_section:
        return _result("SECTION", 0.8, [f"text:{h}" for h in strong_section],
                       "Lettered/numbered section callout present "
                       "(SECTION A-A / 1-1 / B-B).")

    # 3 — ELEVATION: level markers + vertically-dominant extent.
    elev_hits = [t.strip() for t in _ELEVATION_TOKENS if t in text]
    vertical_dominant = height > width * 1.1 if width > 0 else False
    if elev_hits and vertical_dominant:
        signals = [f"text:{h}" for h in elev_hits] + ["extent_vertically_dominant"]
        conf = 0.7 if len(elev_hits) >= 2 else 0.55
        return _result("ELEVATION", conf, signals,
                       "Level markers (FFL/GL/+0.000) with a taller-than-wide "
                       "extent — reads as an elevation.")
    if len(elev_hits) >= 2:
        # Level markers but no clear vertical dominance — weaker elevation call.
        return _result("ELEVATION", 0.45, [f"text:{h}" for h in elev_hits],
                       "Multiple level markers present but extent is not "
                       "clearly vertical; low-confidence elevation.")

    # 4 — FLOOR_PLAN: plan keywords + closed room polygons.
    plan_hits = [t for t in _PLAN_TOKENS if t in text]
    has_rooms = counts["CLOSED_POLY"] > 0
    if plan_hits and has_rooms:
        signals = [f"text:{h}" for h in plan_hits] + [
            f"closed_polygons={counts['CLOSED_POLY']}"
        ]
        conf = 0.9 if len(plan_hits) >= 2 else 0.75
        return _result("FLOOR_PLAN", conf, signals,
                       "Plan keywords plus closed polygons forming rooms — "
                       "high-confidence floor plan.")
    if plan_hits:
        signals = [f"text:{h}" for h in plan_hits]
        conf = 0.55
        if plan_level:  # title-block storey corroborates the body keyword
            conf = 0.70
            signals.append(f"title_block:level={level!r}")
        return _result("FLOOR_PLAN", conf, signals,
                       "Plan keywords present but no closed room polygons "
                       "detected; medium-confidence floor plan.")
    if plan_level:
        return _result("FLOOR_PLAN", 0.70, [f"title_block:level={level!r}"],
                       "Title-block level names a building storey — "
                       "floor-plan hint with no body plan keyword.")

    # 5 — DETAIL: dense geometry in a small footprint + heavy dimensioning.
    area_m2 = (width * height) / 1.0e6 if width > 0 and height > 0 else 0.0
    density = geom_count / area_m2 if area_m2 > 0 else 0.0
    heavy_dims = counts["DIMENSION"] >= 5 or (
        text_count >= 5 and counts["DIMENSION"] >= 1
    )
    if density > 50 and heavy_dims:
        signals = [
            f"geom_density={density:.1f}/m²",
            f"dimensions={counts['DIMENSION']}",
        ]
        return _result("DETAIL", 0.6, signals,
                       "Dense geometry in a small footprint with heavy "
                       "dimensioning — reads as a construction detail.")

    # 6 — bare "SECTION" tiebreaker (only when nothing stronger matched).
    if "SECTION" in section_hits:
        return _result("SECTION", 0.45, ["text:SECTION"],
                       "Bare 'SECTION' keyword present with no stronger signal "
                       "— low-confidence section call.")

    # 7 — UNKNOWN.
    return _result("UNKNOWN", 0.0, [],
                   "No decision-tree branch matched: "
                   f"text_ratio={text_ratio:.2f}, geom_ratio={geom_ratio:.2f}, "
                   f"closed_polys={counts['CLOSED_POLY']}, dims={counts['DIMENSION']}.")


def _result(dtype: str, confidence: float, signals: list[str], reasoning: str) -> dict:
    return {
        "type": dtype,
        "confidence": round(confidence, 2),
        "signals_matched": signals,
        "reasoning": reasoning,
    }
