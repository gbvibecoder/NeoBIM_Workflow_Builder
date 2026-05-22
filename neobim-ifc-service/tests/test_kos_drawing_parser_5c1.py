"""KOS Week 5C-1 — DXF drawing parser tests.

Synthetic DXFs are built in-memory with ezdxf so the tests are hermetic
(no dependency on the real customer files). The route-rejection tests mount
ONLY the KOS drawing router on a bare FastAPI app, deliberately avoiding
``app.main`` so they don't drag in ifcopenshell — they exercise validation
that happens before any DXF is opened.
"""

from __future__ import annotations

import os
import tempfile

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.kos_drawing_parser import router
from app.services.kos_drawing_classifier import classify_drawing
from app.services.kos_dxf_parser import parse_dxf_walls
from app.services.kos_title_block_extractor import extract_title_block


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


def test_route_rejects_pdf(client: TestClient):
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("test.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf")},
        data={"format": "dxf"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] in ("invalid_extension", "unsupported_format")


def test_route_rejects_unsupported_format(client: TestClient):
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("drawing.dxf", b"0 SECTION", "application/octet-stream")},
        data={"format": "pdf"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "unsupported_format"


def test_route_rejects_oversized(client: TestClient):
    oversized = b"0" * (51 * 1024 * 1024)  # 51 MB > 50 MB cap
    resp = client.post(
        "/kos/parse-drawing",
        files={"file": ("big.dxf", oversized, "application/octet-stream")},
        data={"format": "dxf"},
    )
    assert resp.status_code == 413
    assert resp.json()["error"] == "file_too_large"
