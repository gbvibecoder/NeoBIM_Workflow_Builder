"""KOS Week 5C-2 — PDF drawing parser tests.

Synthetic mini-PDFs are built in-memory with ``fitz`` so the tests are hermetic
(no dependency on the real customer PDFs). The heavy real-PDF end-to-end run is
exercised by ``npm run kos:drawing-parse-test`` in Step 4, not here.
"""

from __future__ import annotations

import math
import os
import tempfile

import fitz
import pytest

from app.services.kos_drawing_classifier import classify_drawing
from app.services.kos_drawing_geometry import _enrich_thickness
from app.services.kos_pdf_parser import (
    PDF_PT_TO_PAPER_MM,
    _TIERS,
    _is_black,
    _merge_collinear,
    _scale_denominator,
    extract_title_block_pdf,
    parse_pdf_walls,
)


def _save_pdf(doc) -> str:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc.save(path)
    doc.close()
    return path


def _black_line(page, p1, p2, width=1.2, color=(0, 0, 0)):
    s = page.new_shape()
    s.draw_line(fitz.Point(*p1), fitz.Point(*p2))
    s.finish(color=color, width=width)
    s.commit()


# ── tier-1 wall detection ─────────────────────────────────────────────────


def test_pdf_tier1_detects_black_heavy_walls():
    doc = fitz.open()
    page = doc.new_page(width=600, height=400)
    # Two parallel black 1.2pt lines (200pt long, 10pt apart) → 2 walls.
    _black_line(page, (50, 100), (250, 100))
    _black_line(page, (50, 110), (250, 110))
    # A gray 0.48pt grid line that must NOT be picked up by tier-1.
    _black_line(page, (50, 250), (250, 250), width=0.48, color=(0.5, 0.5, 0.5))
    path = _save_pdf(doc)
    try:
        r = parse_pdf_walls(path, "x.pdf")
        assert r["detection_tier"] == 1
        assert len(r["walls"]) == 2
        assert all("black" in w["layer"] for w in r["walls"])
    finally:
        os.remove(path)


def test_pdf_stroke_filter_tier1_predicate():
    """Tier-1 = black AND width 1.2; gray and thin black are excluded."""
    pred = _TIERS[0][3]
    assert pred((0, 0, 0), 1.2) is True
    assert pred((0, 0, 0), 0.48) is False        # thin black excluded
    assert pred((0.5, 0.5, 0.5), 1.2) is False   # gray excluded
    assert _is_black((0, 0, 0)) and not _is_black((0.5, 0.5, 0.5))


# ── title block ───────────────────────────────────────────────────────────


def test_pdf_title_block_label_value_pairs():
    doc = fitz.open()
    page = doc.new_page(width=600, height=400)
    # Value sits in the column immediately right of its label, slightly ABOVE
    # (as in the real rotated title block — the Rev value is ~16pt above). The
    # vertical offset also keeps each label/value in a distinct text line so
    # fitz does not merge them into one span.
    page.insert_text(fitz.Point(500, 200), "Rev:", fontsize=8)
    page.insert_text(fitz.Point(520, 186), "J", fontsize=8)
    page.insert_text(fitz.Point(500, 260), "Scale:", fontsize=8)
    page.insert_text(fitz.Point(522, 246), "1 : 50", fontsize=8)
    page.insert_text(fitz.Point(500, 320), "Drw:", fontsize=8)
    page.insert_text(fitz.Point(520, 306), "LH", fontsize=8)
    try:
        tb = extract_title_block_pdf(page, None)
        assert tb["revision"] == "J"
        assert tb["scale"] == "1:50"
        assert tb["drawn_by"] == "LH"
    finally:
        doc.close()


# ── scale conversion + fallback ────────────────────────────────────────────


def test_pdf_scale_to_mm_conversion():
    assert _scale_denominator("1:50") == 50
    assert _scale_denominator("1:100") == 100
    assert _scale_denominator(None) is None
    assert _scale_denominator("oops") is None

    doc = fitz.open()
    page = doc.new_page(width=600, height=400)
    page.insert_text(fitz.Point(500, 300), "Scale:", fontsize=8)
    page.insert_text(fitz.Point(522, 286), "1 : 50", fontsize=8)  # above-right → own span
    _black_line(page, (50, 50), (150, 50))  # 100pt horizontal black 1.2
    path = _save_pdf(doc)
    try:
        r = parse_pdf_walls(path, "x.pdf")
        # pt→mm at 1:50 = 100/72 inch * 25.4 * 50
        assert abs(r["unit_multiplier_mm"] - PDF_PT_TO_PAPER_MM * 50) < 0.01
        assert len(r["walls"]) >= 1
        assert abs(r["walls"][0]["length_mm"] - 100 * PDF_PT_TO_PAPER_MM * 50) < 1.0
    finally:
        os.remove(path)


def test_pdf_missing_scale_defaults_1to100():
    doc = fitz.open()
    page = doc.new_page(width=600, height=400)
    _black_line(page, (50, 50), (150, 50))  # no title-block scale anywhere
    path = _save_pdf(doc)
    try:
        r = parse_pdf_walls(path, "x.pdf")
        assert abs(r["unit_multiplier_mm"] - PDF_PT_TO_PAPER_MM * 100) < 0.01
        assert any("assuming 1:100" in w for w in r["warnings"])
    finally:
        os.remove(path)


# ── collinear merge + thickness flip-invariance ────────────────────────────


def test_pdf_collinear_merge_reduces_fragments():
    segs = [((0, 0), (100, 0)), ((100, 0), (200, 0)), ((200, 0), (300, 0))]
    runs = _merge_collinear(segs, 0.0)
    assert len(runs) == 1
    (p, q) = runs[0]
    assert abs(math.hypot(q[0] - p[0], q[1] - p[1]) - 300) < 0.01


def test_pdf_yflip_invariance_thickness():
    """`_enrich_thickness` is flip-invariant: a parallel pair in PDF Y-down
    coords still yields thickness_mm."""
    walls = [
        {"id": "w0", "start": [0, 0], "end": [1000, 0], "length_mm": 1000,
         "thickness_mm": None, "angle_degrees": 0.0, "layer": "x",
         "detection_tier": 1, "confidence": 0.85},
        {"id": "w1", "start": [0, 200], "end": [1000, 200], "length_mm": 1000,
         "thickness_mm": None, "angle_degrees": 0.0, "layer": "x",
         "detection_tier": 1, "confidence": 0.85},
    ]
    _enrich_thickness(walls, None, [])
    assert all(w["thickness_mm"] is not None and abs(w["thickness_mm"] - 200) < 1
               for w in walls)


# ── classifier via title block (PDF path: no doc/msp) ──────────────────────


def test_pdf_classify_via_title_block():
    r = classify_drawing(None, None,
                         {"drawing_title": "Concrete Setout Plan", "level": "BASEMENT"})
    assert r["type"] == "FLOOR_PLAN"
    assert r["confidence"] >= 0.85
