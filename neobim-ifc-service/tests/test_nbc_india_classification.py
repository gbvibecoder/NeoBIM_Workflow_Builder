"""Phase 2 / Task 6 — NBC India classification tests."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.classification import (
    NBC_NAME,
    NBC_OCCUPANCY_GROUPS,
    nbc_group_for_building_type,
)
from app.services.ifc_builder import build_multi_discipline


FIXTURE_DIR = Path(__file__).parent / "fixtures"


# ── Pure-function mapping tests ──────────────────────────────────────


@pytest.mark.parametrize(
    "building_type,expected",
    [
        ("Residential Building", "A"),
        ("Apartment Block", "A-4"),
        ("Five-Star Hotel", "A-5"),
        ("College Campus", "B"),
        ("Hospital", "C"),
        ("Office Building", "E"),
        ("Single-Family Residence", "A-2"),  # from "house" or "residence" hit
        # `warehouse` is checked before `industrial` to avoid the
        # `warehouse` → `house` substring trap (NBC pattern order).
        # "Industrial Warehouse" therefore maps to H (Storage), which is
        # a defensible NBC interpretation — a warehouse used for
        # industrial storage IS Group H per NBC 2016 Part 4 § 4.5.
        ("Industrial Warehouse", "H"),
        ("Mall", "F"),
        ("Storage Facility", "H"),
    ],
)
def test_nbc_group_mapping(building_type: str, expected: str):
    assert nbc_group_for_building_type(building_type) == expected


def test_nbc_default_for_empty_or_unknown():
    assert nbc_group_for_building_type("") == "E"
    assert nbc_group_for_building_type("Spaceship") == "E"


def test_nbc_occupancy_table_has_all_documented_codes():
    """The IS NBC 2016 Part 4 table 1 has 8 group letters A–H plus I.
    Ensures the in-code table can't drift below the spec by accident."""
    required = {"A", "B", "C", "D", "E", "F", "G", "H", "I"}
    assert required.issubset(NBC_OCCUPANCY_GROUPS.keys())


# ── Integration via fixtures ─────────────────────────────────────────


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


@pytest.mark.parametrize(
    "fixture,expected_name",
    [
        ("simple_box", NBC_NAME),
        ("multistorey_residential", NBC_NAME),
        ("non_rectangular", NBC_NAME),
    ],
)
def test_each_fixture_carries_nbc_classification(fixture: str, expected_name: str):
    model = _build_combined(fixture)
    classifications = list(model.by_type("IfcClassification"))
    names = {c.Name for c in classifications}
    assert expected_name in names, (
        f"{fixture}: missing NBC classification; found {names}"
    )


def test_each_fixture_has_two_classifications_omniclass_plus_nbc():
    """Both classification systems must coexist."""
    for fixture in ("simple_box", "multistorey_residential", "non_rectangular"):
        model = _build_combined(fixture)
        names = {c.Name for c in model.by_type("IfcClassification")}
        assert "OmniClass Construction Classification System" in names
        assert NBC_NAME in names


def test_residential_fixture_classified_as_group_a():
    """multistorey_residential has buildingType='Residential Building'
    → maps to Group A (Residential)."""
    model = _build_combined("multistorey_residential")
    nbc_refs = [
        ref for ref in model.by_type("IfcClassificationReference")
        if (ref.ReferencedSource and ref.ReferencedSource.Name == NBC_NAME)
    ]
    assert nbc_refs, "no NBC classification references"
    code = nbc_refs[0].Identification
    assert code.startswith("Group A"), f"expected Group A, got {code!r}"


def test_non_residential_fixture_classified_as_group_e():
    """non_rectangular is 'L-Shape Office' → Group E (Business)."""
    model = _build_combined("non_rectangular")
    nbc_refs = [
        ref for ref in model.by_type("IfcClassificationReference")
        if (ref.ReferencedSource and ref.ReferencedSource.Name == NBC_NAME)
    ]
    assert nbc_refs
    assert nbc_refs[0].Identification == "Group E"


def test_nbc_classification_is_attached_to_ifcbuilding():
    """NBC is building-level, not element-level (unlike OmniClass)."""
    model = _build_combined("multistorey_residential")
    for rel in model.by_type("IfcRelAssociatesClassification"):
        cls_ref = rel.RelatingClassification
        if not cls_ref or not cls_ref.ReferencedSource:
            continue
        if cls_ref.ReferencedSource.Name != NBC_NAME:
            continue
        # Targets must be IfcBuilding
        targets = [obj.is_a() for obj in (rel.RelatedObjects or [])]
        assert all(t == "IfcBuilding" for t in targets), (
            f"NBC rel attaches non-buildings: {targets}"
        )
