"""KOS Week 5C-1 — DXF drawing parser tests.

Synthetic DXFs are built in-memory with ezdxf so the tests are hermetic
(no dependency on the real customer files). The route-rejection tests mount
ONLY the KOS drawing router on a bare FastAPI app, deliberately avoiding
``app.main`` so they don't drag in ifcopenshell — they exercise validation
that happens before any DXF is opened.
"""

from __future__ import annotations

import os
import re
import tempfile

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.kos_drawing_parser import router
from app.services.kos_drawing_classifier import classify_drawing
from app.services.kos_dxf_parser import parse_dxf_walls
from app.services.kos_title_block_extractor import _valid_drawn_by, extract_title_block


# ── helpers ─────────────────────────────────────────────────────────────


def _save(doc) -> str:
    fd, path = tempfile.mkstemp(suffix=".dxf")
    os.close(fd)
    doc.saveas(path)
    return path


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── classifier ──────────────────────────────────────────────────────────


def test_classify_floor_plan_synthetic():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    # Closed room polygon (20 m²) + a couple of interior lines + plan text.
    msp.add_lwpolyline([(0, 0), (5000, 0), (5000, 4000), (0, 4000)], close=True)
    msp.add_line((2500, 0), (2500, 4000))
    msp.add_line((0, 2000), (5000, 2000))
    msp.add_text("GROUND FLOOR PLAN").set_placement((1000, 2000))

    result = classify_drawing(doc, msp)
    assert result["type"] == "FLOOR_PLAN"
    assert result["confidence"] >= 0.7
    assert result["signals_matched"]


def test_classify_detail_synthetic():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    # Dense geometry inside a ~100x90 mm footprint → high density.
    for i in range(30):
        msp.add_line((0, i * 3), (100, i * 3))
    # Heavy dimensioning.
    for i in range(6):
        try:
            dim = msp.add_linear_dim(base=(0, -5 * (i + 1)), p1=(0, 0), p2=(100, 0))
            dim.render()
        except Exception:
            msp.add_linear_dim(base=(0, -5 * (i + 1)), p1=(0, 0), p2=(100, 0))

    result = classify_drawing(doc, msp)
    assert result["type"] == "DETAIL"


# ── DXF wall parser ─────────────────────────────────────────────────────


def test_dxf_parser_with_wall_layer():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # millimetres → coords are already in mm
    doc.layers.add("A-WALL")
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 0), (0, 4000), dxfattribs={"layer": "A-WALL"})
    msp.add_line((5000, 0), (5000, 4000), dxfattribs={"layer": "A-WALL"})
    # A non-wall line that must NOT be picked up by tier 1.
    msp.add_line((100, 100), (200, 100), dxfattribs={"layer": "FURNITURE"})
    path = _save(doc)
    try:
        result = parse_dxf_walls(path, "wall_test.dxf")
        assert result["detection_tier"] == 1
        assert len(result["walls"]) == 3
        assert all(w["detection_tier"] == 1 for w in result["walls"])
        assert all(w["layer"] == "A-WALL" for w in result["walls"])
        # 5000mm horizontal wall → length 5000, angle ~0.
        horiz = [w for w in result["walls"] if abs(w["angle_degrees"]) < 1]
        assert any(abs(w["length_mm"] - 5000) < 1 for w in horiz)
    finally:
        os.remove(path)


def test_dxf_parser_fallback_no_wall_layer():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0))   # plain thin lines on layer "0"
    msp.add_line((0, 0), (0, 4000))
    path = _save(doc)
    try:
        result = parse_dxf_walls(path, "fallback_test.dxf")
        assert result["detection_tier"] == 4
        assert len(result["walls"]) >= 2
        assert result["overall_confidence"] <= 0.3
    finally:
        os.remove(path)


# ── title block ─────────────────────────────────────────────────────────


def test_title_block_filename_fallback():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()  # intentionally no title-block text
    fn = "90VR-MR-AD-2501-CAD[J]-Concrete Setout Plan-Basement-Part.dxf"

    result = extract_title_block(doc, msp, fn)
    assert result["revision"] == "J"
    assert "90VR-MR-AD-2501" in (result["drawing_number"] or "")
    assert result["level"] == "BASEMENT"
    assert result["drawing_title"] == "Concrete Setout Plan"
    assert result["source"] == "filename"


def test_title_block_region_scan():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    # Establish extent so the bottom-right region is well-defined.
    msp.add_lwpolyline([(0, 0), (10000, 0), (10000, 8000), (0, 8000)], close=True)
    # Title-block text in the bottom-right quadrant, label + value inline.
    msp.add_text("SCALE 1:100").set_placement((9000, 500))
    msp.add_text("REV: C").set_placement((9000, 300))

    result = extract_title_block(doc, msp, None)
    assert result["scale"] == "1:100"
    assert result["revision"] == "C"
    assert result["source"] in ("title_block", "mixed")


# ── route validation ─────────────────────────────────────────────────────


# NOTE (5C-2): PDF is now a SUPPORTED format, so the old "reject PDF" tests are
# repurposed to assert rejection of genuinely-unsupported extensions. The route
# infers format from the filename extension; only .dxf / .pdf are accepted.


def test_route_rejects_png_extension(client: TestClient):
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("logo.png", b"\x89PNG\r\n\x1a\n fake png", "image/png")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_extension"


def test_route_rejects_txt_extension(client: TestClient):
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_extension"


def test_route_rejects_oversized(client: TestClient):
    oversized = b"0" * (51 * 1024 * 1024)  # 51 MB > 50 MB cap
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("big.dxf", oversized, "application/octet-stream")},
        data={"format": "dxf"},
    )
    assert resp.status_code == 413
    assert resp.json()["error"] == "file_too_large"


# ── Phase 5C-1 tuning — new tests (PROPOSAL §E) ───────────────────────────


def test_classify_title_block_plan_beats_body_section():
    """Title-block plan title wins even when the body carries 'SECTION A-A'."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (5000, 0), (5000, 4000), (0, 4000)], close=True)
    msp.add_text("SECTION A-A").set_placement((1000, 1000))
    tb = {"drawing_title": "Concrete Setout Plan", "level": "BASEMENT"}

    result = classify_drawing(doc, msp, tb)
    assert result["type"] == "FLOOR_PLAN"
    assert result["confidence"] >= 0.85


def test_classify_title_block_optional_backcompat():
    """classify_drawing still works with no title_block arg (back-compat)."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (5000, 0), (5000, 4000), (0, 4000)], close=True)
    msp.add_text("GROUND FLOOR PLAN").set_placement((1000, 2000))

    result = classify_drawing(doc, msp)  # 2-arg call
    assert result["type"] == "FLOOR_PLAN"


def test_tier1_excludes_hdln_iden_layers():
    """A-WALL-HDLN / A-WALL-IDEN annotation sub-layers are not walls."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    for ly in ("A-WALL", "A-WALL-HDLN", "A-WALL-IDEN"):
        doc.layers.add(ly)
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 500), (5000, 500), dxfattribs={"layer": "A-WALL-HDLN"})
    msp.add_line((0, 1000), (5000, 1000), dxfattribs={"layer": "A-WALL-IDEN"})
    path = _save(doc)
    try:
        result = parse_dxf_walls(path, "excl.dxf")
        assert result["detection_tier"] == 1
        assert len(result["walls"]) == 1
        assert all(w["layer"] == "A-WALL" for w in result["walls"])
    finally:
        os.remove(path)


def test_tier1_drops_sub_threshold_walls():
    """Tier-1 candidates shorter than 200mm are dropped as noise."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    doc.layers.add("A-WALL")
    msp = doc.modelspace()
    msp.add_line((0, 0), (150, 0), dxfattribs={"layer": "A-WALL"})    # 150mm → dropped
    msp.add_line((0, 0), (0, 5000), dxfattribs={"layer": "A-WALL"})   # 5000mm → kept
    path = _save(doc)
    try:
        result = parse_dxf_walls(path, "lenfloor.dxf")
        assert result["detection_tier"] == 1
        assert len(result["walls"]) == 1
        assert result["walls"][0]["length_mm"] >= 200
    finally:
        os.remove(path)


def test_thickness_enrichment_parallel_pair():
    """A 200mm-offset overlapping parallel pair → thickness_mm ≈ 200 on both."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    doc.layers.add("A-WALL")
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_line((0, 200), (5000, 200), dxfattribs={"layer": "A-WALL"})
    path = _save(doc)
    try:
        result = parse_dxf_walls(path, "thick.dxf")
        assert result["detection_tier"] == 1
        assert len(result["walls"]) == 2
        thicks = [w["thickness_mm"] for w in result["walls"]]
        assert all(t is not None and abs(t - 200) < 1 for t in thicks)
        assert result["any_thickness"] is True
    finally:
        os.remove(path)


def test_title_block_reviewed_not_revision_iewed():
    """'REVIEWED' must never yield revision='IEWED' (word-boundary + validator)."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10000, 0), (10000, 8000), (0, 8000)], close=True)
    msp.add_text("REVIEWED BY OTHERS").set_placement((5000, 4000))

    result = extract_title_block(doc, msp, None)
    assert result["revision"] != "IEWED"
    assert result["revision"] is None or re.fullmatch(r"[A-Z]", result["revision"])


def test_title_block_bare_ratio_not_scale_in_fallback():
    """A bare body ratio '1:17' in scan-all mode must not become the scale."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10000, 0), (10000, 8000), (0, 8000)], close=True)
    msp.add_text("1:17").set_placement((5000, 4000))
    msp.add_text("BONDEK SLAB").set_placement((5000, 3000))

    result = extract_title_block(doc, msp, None)
    assert result["scale"] is None


def test_title_block_drawn_by_rejects_section_header():
    """'HYDRAULICS AND' is a section header, not a drawn-by signature."""
    assert _valid_drawn_by("HYDRAULICS AND") is None
    assert _valid_drawn_by("J. Smith") == "J. Smith"
