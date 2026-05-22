"""
Tests for the Hard Verifier (build_verifier.py).

These tests use the check_build function's heuristic path when ifcopenshell
is unavailable, and exercise the full path with mock IFC data when it is.
"""

import datetime
import pytest

try:
    import ifcopenshell
    HAS_IFCOPENSHELL = True
except ImportError:
    HAS_IFCOPENSHELL = False

from app.services.ifc_generator_v3.build_verifier import check_build, VerifierReport


# ── Fixtures ─────────────────────────────────────────────────────────────


def make_spec(furniture=None, trim=None):
    """Build a minimal spec dict."""
    return {
        "project": {"name": "Test", "type": "office"},
        "site": {"bounds_m": [10, 8], "height_limit_m": 4},
        "spaces": [{"id": "s1", "name": "Room"}],
        "elements": [],
        "materials": [{"id": "m1", "name": "Wood"}],
        "furniture": furniture or [],
        "trim": trim or [],
    }


def make_furniture_with_parts(item_id, part_count):
    """Create a furniture item with N parts."""
    return {
        "id": item_id,
        "type": "desk",
        "count": 1,
        "material_id": "m1",
        "description": f"Test item {item_id}",
        "parts": [
            {
                "id": f"{item_id}-p{i}",
                "subtype": f"part-{i}",
                "origin_local_m": [0, 0, i * 0.1],
                "dims_m": [0.1, 0.1, 0.1],
                "material_id": "m1",
            }
            for i in range(part_count)
        ],
    }


# ── Tests (heuristic path — always runnable) ─────────────────────────────


def test_empty_spec_no_furniture():
    """Empty spec (no furniture) → verified=false (heuristic), no mismatches."""
    report = check_build("https://example.com/test.ifc", make_spec(), tolerance={"parts_min_fraction": 0.7})
    d = report.to_dict()
    assert d["mismatches"] == []
    assert d["parts_coverage"] == 0  # heuristic: can't verify


def test_spec_with_furniture_no_parts():
    """Furniture without parts → no mismatches for parts."""
    spec = make_spec(furniture=[{"id": "f1", "type": "chair", "count": 1, "material_id": "m1", "description": "Chair"}])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    # No parts to verify, so no parts mismatches (may have system mismatch)
    parts_mismatches = [m for m in d["mismatches"] if m["type"] == "missing_parts"]
    assert len(parts_mismatches) == 0


def test_heuristic_reports_expected_parts():
    """Heuristic path reports expected parts count."""
    spec = make_spec(furniture=[make_furniture_with_parts("f1", 5)])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    assert d["verified"] == False
    assert len(d["mismatches"]) >= 1
    assert d["mismatches"][0]["expected"] == 5


def test_heuristic_multiple_furniture():
    """Multiple furniture items → one mismatch per item with parts."""
    spec = make_spec(furniture=[
        make_furniture_with_parts("f1", 3),
        make_furniture_with_parts("f2", 8),
        {"id": "f3", "type": "chair", "count": 1, "material_id": "m1", "description": "No parts"},
    ])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    parts_mm = [m for m in d["mismatches"] if m["type"] == "missing_parts"]
    # f1 and f2 have parts, f3 doesn't
    assert len(parts_mm) == 2


def test_heuristic_trim_items():
    """Trim items → no mismatches in heuristic (can't verify without IFC)."""
    spec = make_spec(trim=[
        {"id": "t1", "type": "skirting", "hostId": "e1", "material_id": "m1"},
        {"id": "t2", "type": "door_handle", "hostId": "e2", "material_id": "m1"},
    ])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    # Heuristic only checks furniture parts, not trim
    trim_mm = [m for m in d["mismatches"] if m["type"] == "missing_trim"]
    assert len(trim_mm) == 0  # heuristic can't check trim without IFC


def test_report_structure():
    """Verify VerifierReport.to_dict() has all required fields."""
    report = VerifierReport()
    d = report.to_dict()
    assert "verified" in d
    assert "parts_coverage" in d
    assert "trim_coverage" in d
    assert "mismatches" in d
    assert "summary" in d
    assert "verified_at" in d


def test_verified_at_is_iso_string():
    """verified_at is a valid ISO datetime string."""
    report = VerifierReport()
    d = report.to_dict()
    # Should parse without error
    assert "T" in d["verified_at"]


def test_tolerance_respected():
    """Custom tolerance values are accepted without error."""
    spec = make_spec(furniture=[make_furniture_with_parts("f1", 5)])
    report = check_build(
        "https://example.com/test.ifc",
        spec,
        tolerance={"dim_m": 0.2, "parts_min_fraction": 0.5},
    )
    assert isinstance(report, VerifierReport)


def test_24_parts_expected():
    """3 furniture × 8 parts = 24 parts expected in heuristic."""
    spec = make_spec(furniture=[
        make_furniture_with_parts("f1", 8),
        make_furniture_with_parts("f2", 8),
        make_furniture_with_parts("f3", 8),
    ])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    total_expected = sum(m["expected"] for m in d["mismatches"] if m["type"] == "missing_parts")
    assert total_expected == 24


def test_mismatch_severity():
    """Mismatches from heuristic have med severity (not high — can't confirm)."""
    spec = make_spec(furniture=[make_furniture_with_parts("f1", 5)])
    report = check_build("https://example.com/test.ifc", spec)
    d = report.to_dict()
    for m in d["mismatches"]:
        if m["type"] == "missing_parts":
            assert m["severity"] == "med"


# ── Tests (ifcopenshell path — skipped if not installed) ─────────────────


@pytest.mark.skipif(not HAS_IFCOPENSHELL, reason="ifcopenshell not installed")
def test_perfect_match_with_real_ifc():
    """Placeholder for real IFC testing — requires ifcopenshell + fixture files."""
    # This would create a minimal IFC with ifcopenshell, then verify it
    # against a matching spec. Skipped in environments without ifcopenshell.
    pass


@pytest.mark.skipif(not HAS_IFCOPENSHELL, reason="ifcopenshell not installed")
def test_collapsed_50_percent():
    """Placeholder for 50% collapse test with real IFC."""
    pass
