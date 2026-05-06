"""Phase 2 / Fix 11 — IS-808 steel profile lookup tests."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline
from app.services.steel_profiles import (
    IS_808_LOOKUP,
    ISection,
    get_is_section,
    is_steel_material,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"


# ── Pure-function tests ──────────────────────────────────────────────


def test_lookup_table_pins_ismb300_dimensions():
    """IS-808 dimensions are spec-published; if this drifts, every IFC
    the service emits with ISMB300 carries wrong dimensions. Hard pin
    so accidental edits trip the test instead of shipping."""
    s = IS_808_LOOKUP["ISMB300"]
    assert s.depth_mm == 300
    assert s.flange_width_mm == 140
    assert s.flange_thickness_mm == 12.4
    assert s.web_thickness_mm == 7.5


def test_lookup_table_covers_three_series():
    """ISMB / ISLB / ISJB families all present."""
    designations = set(IS_808_LOOKUP.keys())
    assert any(d.startswith("ISMB") for d in designations)
    assert any(d.startswith("ISLB") for d in designations)
    assert any(d.startswith("ISJB") for d in designations)


@pytest.mark.parametrize("name", ["ISMB300", "ismb300", " ISMB300 "])
def test_get_is_section_case_insensitive_and_trims(name: str):
    s = get_is_section(name)
    assert s is not None and s.designation == "ISMB300"


def test_get_is_section_returns_none_for_unknown():
    assert get_is_section("W12x26") is None  # US section
    assert get_is_section("UB406x140x39") is None  # UK section
    assert get_is_section("") is None
    assert get_is_section(None) is None


def test_as_metres_converts_correctly():
    s = ISection("ISTEST", 200, 100, 10, 5)
    m = s.as_metres()
    assert m["depth"] == 0.200
    assert m["flange_width"] == 0.100
    assert m["flange_thickness"] == 0.010
    assert m["web_thickness"] == 0.005


def test_is_steel_material_handles_variants():
    assert is_steel_material("steel")
    assert is_steel_material("STEEL")
    assert is_steel_material(" Steel ")
    assert not is_steel_material("concrete")
    assert not is_steel_material(None)
    assert not is_steel_material("")


# ── Integration tests via fixture ────────────────────────────────────


def _build_combined(fixture: str) -> ifcopenshell.file:
    raw = json.loads((FIXTURE_DIR / f"{fixture}.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    req = ExportIFCRequest.model_validate(raw)
    ifc_bytes, _, _ = build_multi_discipline(req)["combined"]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        return ifcopenshell.open(t.name)


def test_steel_column_emits_ishape_profile_with_ismb300_dimensions():
    """non_rectangular has col0-1 with structuralMaterial=steel,
    sectionProfile=ISMB300. Verify the emitted column carries
    IfcIShapeProfileDef with the IS-808 spec dimensions."""
    model = _build_combined("non_rectangular")
    profiles = list(model.by_type("IfcIShapeProfileDef"))
    matching = [p for p in profiles if p.ProfileName == "ISMB300"]
    assert len(matching) >= 1, (
        f"expected at least one ISMB300 profile; found {[p.ProfileName for p in profiles]}"
    )
    p = matching[0]
    # Compare in metres (IFC stores SI units)
    assert abs(p.OverallDepth - 0.300) < 1e-6
    assert abs(p.OverallWidth - 0.140) < 1e-6
    assert abs(p.FlangeThickness - 0.0124) < 1e-6
    assert abs(p.WebThickness - 0.0075) < 1e-6


def test_non_steel_column_keeps_circular_fallback():
    """col0-2 in non_rectangular has no structuralMaterial / sectionProfile —
    must still emit IfcCircleProfileDef per the pre-Phase-2 fallback."""
    model = _build_combined("non_rectangular")
    circles = list(model.by_type("IfcCircleProfileDef"))
    assert len(circles) >= 1, "fallback IfcCircleProfileDef missing"


def test_steel_section_carries_into_type_dedup():
    """An IfcColumnType created off the steel ISMB300 column has its
    section_profile in the dedup signature — meaning a second steel
    column with a different sectionProfile would get its own type."""
    model = _build_combined("non_rectangular")
    column_types = list(model.by_type("IfcColumnType"))
    # non_rectangular has 1 steel + 1 concrete column per storey × 2 storeys
    # → at least 2 distinct types (steel+ISMB300 vs concrete+blank)
    assert len(column_types) >= 2, (
        f"expected ≥ 2 IfcColumnTypes (steel vs concrete); got {len(column_types)}"
    )


def test_simple_box_no_steel_no_ishape_profiles():
    """simple_box has no steel elements — no IfcIShapeProfileDef should
    be emitted (no beams either, so the generic fallback is also absent)."""
    model = _build_combined("simple_box")
    assert len(list(model.by_type("IfcIShapeProfileDef"))) == 0
