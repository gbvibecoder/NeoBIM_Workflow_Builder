"""Phase 2 / Fix 8 — IfcDistributionSystem replaces IfcSystem.

Pins:
  1. On a MEP-bearing fixture: IfcDistributionSystem count > 0.
  2. IfcSystem count is 0 — the bare class was REPLACED, not augmented.
  3. Every IfcDistributionSystem carries a non-null PredefinedType from
     the IFC4 enum.
  4. The HVAC/Plumbing/Electrical buckets get distinct PredefinedType
     values — VENTILATION / DOMESTICCOLDWATER / ELECTRICAL.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline


FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def model() -> ifcopenshell.file:
    raw = json.loads((FIXTURE_DIR / "multistorey_residential.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    req = ExportIFCRequest.model_validate(raw)
    ifc_bytes, _, _ = build_multi_discipline(req)["combined"]
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        return ifcopenshell.open(t.name)


def test_distribution_system_count_positive(model: ifcopenshell.file):
    n = len(list(model.by_type("IfcDistributionSystem")))
    assert n > 0, "expected at least one IfcDistributionSystem on residential fixture"


def test_bare_ifcsystem_count_zero(model: ifcopenshell.file):
    """Phase 1 used IfcSystem; Phase 2 replaces it with the more specific
    IfcDistributionSystem subclass. Assert the parent class is no longer
    instantiated bare — by_type returns subclasses too, so we filter to
    exact-class matches."""
    bare = [s for s in model.by_type("IfcSystem") if s.is_a() == "IfcSystem"]
    assert bare == [], (
        f"Found {len(bare)} bare IfcSystem entities — they should all be "
        f"IfcDistributionSystem now"
    )


def test_every_distribution_system_has_predefined_type(model: ifcopenshell.file):
    bad = [
        s for s in model.by_type("IfcDistributionSystem")
        if not getattr(s, "PredefinedType", None)
    ]
    assert not bad, f"{len(bad)} IfcDistributionSystem(s) without PredefinedType"


def test_predefined_types_match_expected_buckets(model: ifcopenshell.file):
    """multistorey_residential has HVAC + Plumbing + Electrical buckets
    populated → expect VENTILATION + DOMESTICCOLDWATER + ELECTRICAL."""
    by_name = {s.Name: s.PredefinedType for s in model.by_type("IfcDistributionSystem")}
    assert by_name.get("HVAC") == "VENTILATION"
    assert by_name.get("Plumbing") == "DOMESTICCOLDWATER"
    assert by_name.get("Electrical") == "ELECTRICAL"


def test_assigns_to_group_still_present(model: ifcopenshell.file):
    """The IfcRelAssignsToGroup pattern survives unchanged — Phase 2 only
    swapped the relating-group's class."""
    assert len(list(model.by_type("IfcRelAssignsToGroup"))) >= 3


def test_services_buildings_relationship_present(model: ifcopenshell.file):
    rels = list(model.by_type("IfcRelServicesBuildings"))
    assert len(rels) >= 3
    for rel in rels:
        assert rel.RelatingSystem.is_a("IfcDistributionSystem")
