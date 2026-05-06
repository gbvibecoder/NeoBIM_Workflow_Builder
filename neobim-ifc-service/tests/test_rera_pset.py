"""Phase 2 / Task 7 — Pset_ReraData attachment tests."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline
from app.services.rera_pset import (
    DEFAULT_SEISMIC_ZONE,
    DEFAULT_WIND_ZONE,
    PSET_NAME,
    ReraInputs,
    is_residential_building,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"


# ── Pure-function helpers ────────────────────────────────────────────


def test_is_residential_building_true_for_group_A_codes():
    assert is_residential_building("Residential Building")
    assert is_residential_building("Apartment Block")
    assert is_residential_building("Hotel")
    assert is_residential_building("Single-Family Residence")


def test_is_residential_building_false_for_others():
    assert not is_residential_building("Office Building")
    assert not is_residential_building("Hospital")
    assert not is_residential_building("Industrial Warehouse")
    assert not is_residential_building("L-Shape Office")


def test_rera_inputs_defaults():
    inp = ReraInputs.from_options(None, None, None)
    assert inp.project_id == ""
    assert inp.seismic_zone == DEFAULT_SEISMIC_ZONE
    assert inp.wind_zone == DEFAULT_WIND_ZONE


def test_rera_inputs_uses_provided_values():
    inp = ReraInputs.from_options("RERA-MH-2025-12345", "IV", 5)
    assert inp.project_id == "RERA-MH-2025-12345"
    assert inp.seismic_zone == "IV"
    assert inp.wind_zone == 5


# ── Integration via fixtures ─────────────────────────────────────────


def _build_combined(fixture: str, **opts) -> ifcopenshell.file:
    raw = json.loads((FIXTURE_DIR / f"{fixture}.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    raw["options"].update(opts)
    req = ExportIFCRequest.model_validate(raw)
    ifc_bytes, _, _ = build_multi_discipline(req)["combined"]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        return ifcopenshell.open(t.name)


def _rera_psets_in(model: ifcopenshell.file) -> list:
    return [ps for ps in model.by_type("IfcPropertySet") if ps.Name == PSET_NAME]


def test_residential_fixture_has_rera_pset_per_space():
    model = _build_combined("multistorey_residential")
    spaces = list(model.by_type("IfcSpace"))
    rera = _rera_psets_in(model)
    assert len(spaces) > 0
    assert len(rera) == len(spaces), (
        f"expected one Pset_ReraData per IfcSpace; got {len(rera)} for {len(spaces)} spaces"
    )


def test_non_residential_fixture_has_no_rera_pset():
    """non_rectangular is 'L-Shape Office' → Group E → no RERA."""
    model = _build_combined("non_rectangular")
    assert len(_rera_psets_in(model)) == 0


def test_rera_pset_carries_default_values_when_unspecified():
    model = _build_combined("multistorey_residential")
    rera = _rera_psets_in(model)
    assert rera, "fixture must have at least one RERA Pset"
    props = {p.Name: p.NominalValue.wrappedValue for p in rera[0].HasProperties}
    assert props["SeismicZone"] == DEFAULT_SEISMIC_ZONE
    assert props["WindZone"] == DEFAULT_WIND_ZONE
    assert props["ProjectIDNumber"] == ""
    assert props["OccupancyGroup"].startswith("A")  # residential


def test_rera_pset_uses_explicit_values_when_provided():
    model = _build_combined(
        "multistorey_residential",
        reraProjectId="RERA-MH-2025-99999",
        seismicZone="IV",
        windZone=5,
    )
    rera = _rera_psets_in(model)
    props = {p.Name: p.NominalValue.wrappedValue for p in rera[0].HasProperties}
    assert props["ProjectIDNumber"] == "RERA-MH-2025-99999"
    assert props["SeismicZone"] == "IV"
    assert props["WindZone"] == 5


def test_rera_area_calculations_follow_15_30_factor():
    """BuiltUp = Carpet × 1.15, SuperBuiltUp = Carpet × 1.30."""
    model = _build_combined("multistorey_residential")
    rera = _rera_psets_in(model)
    for ps in rera:
        props = {p.Name: p.NominalValue.wrappedValue for p in ps.HasProperties}
        carpet = props["CarpetAreaM2"]
        assert abs(props["BuiltUpAreaM2"] - carpet * 1.15) < 1e-3
        assert abs(props["SuperBuiltUpAreaM2"] - carpet * 1.30) < 1e-3


def test_simple_box_residential_now_has_rera_pset():
    """simple_box was changed in Phase 2 from 'Single-Storey Box' to
    'Single-Family Residence' → maps to A-2 → RERA applies."""
    model = _build_combined("simple_box")
    spaces = list(model.by_type("IfcSpace"))
    rera = _rera_psets_in(model)
    assert spaces and len(rera) == len(spaces)
