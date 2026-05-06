"""Phase 1 Slice 3 — Pset_BuildFlow_Provenance stamping tests.

Builds a minimal IfcProject programmatically, stamps Provenance, and
verifies:
    * The Pset exists on the project (via IfcRelDefinesByProperties).
    * All 15 properties are present with the spec'd names.
    * Property types match Python types (str→IfcLabel, float→IfcReal,
      int→IfcInteger).
    * Re-stamping is idempotent — second call updates the existing Pset
      in place, never creates a duplicate.
    * IfcOpenShellVersion is sourced from `ifcopenshell.version` at
      stamp time, NOT from `provenance.ifcopenshell_version`.
    * Round-trip: write to bytes, re-parse, Pset still present with all
      values.

Slice 3 is intentionally standalone — no integration with the build
pipeline yet. These tests don't run the full IFC build; they construct
the minimal IfcProject + IfcUnitAssignment that pset.add_pset needs.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import ifcopenshell
import ifcopenshell.api as api
import pytest

from app.domain.building_model import Provenance
from app.services.provenance import PSET_NAME, stamp_provenance


# ─── Fixtures ────────────────────────────────────────────────────────


def _make_minimal_ifc():
    """Returns (ifc_file, project_entity). Smallest valid IFC4 with a project."""
    f = ifcopenshell.file(schema="IFC4")
    project = api.run("root.create_entity", f, ifc_class="IfcProject", name="Test Project")
    api.run("unit.assign_unit", f, length={"is_metric": True, "raw": "METRE"})
    return f, project


def _make_provenance(**overrides) -> Provenance:
    base = {
        "model_version": "1.0.0",
        "input_contract_version": "MassingGeometry-1.0.0",
        "agent_stages_run": "lift-from-massing",
        "agent_models_used": "",
        "total_llm_cost_usd": 0.0,
        "total_wallclock_ms": 0,
        "prompt_cache_hit_rate": 0.0,
        "ids_rules_passed": 0,
        "ids_rules_failed": 0,
        "target_fidelity": "design-development",
        "fixture_match": "simple_box",
        "generated_at": "2026-05-06T12:00:00Z",
        "build_id": "build-test-1",
        "source_contract": "MassingGeometry-lifted",
    }
    base.update(overrides)
    return Provenance(**base)


def _get_psets(project_entity) -> list:
    return [
        rel.RelatingPropertyDefinition
        for rel in (project_entity.IsDefinedBy or [])
        if rel.is_a("IfcRelDefinesByProperties")
        and rel.RelatingPropertyDefinition.is_a("IfcPropertySet")
    ]


def _get_pset_props(pset) -> dict:
    """Return {prop_name: (ifc_type, python_value)} for the pset."""
    out = {}
    for p in pset.HasProperties:
        wrap = p.NominalValue
        out[p.Name] = (wrap.is_a(), wrap.wrappedValue)
    return out


# ─── Basic happy path ────────────────────────────────────────────────


def test_stamp_creates_pset_on_project():
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(), project)
    psets = _get_psets(project)
    assert len(psets) == 1
    assert psets[0].Name == PSET_NAME


def test_pset_has_all_15_properties():
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(), project)
    pset = _get_psets(project)[0]
    expected_names = {
        "ModelVersion",
        "InputContractVersion",
        "IfcOpenShellVersion",
        "AgentStagesRun",
        "AgentModelsUsed",
        "TotalLLMCostUSD",
        "TotalWallclockMs",
        "PromptCacheHitRate",
        "IdsRulesPassed",
        "IdsRulesFailed",
        "TargetFidelity",
        "FixtureMatch",
        "GeneratedAt",
        "BuildId",
        "SourceContract",
    }
    actual = {p.Name for p in pset.HasProperties}
    assert actual == expected_names, f"Missing: {expected_names - actual}; Extra: {actual - expected_names}"
    assert len(pset.HasProperties) == 15


# ─── Property types ──────────────────────────────────────────────────


def test_string_properties_emit_as_ifc_label():
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(), project)
    pset = _get_psets(project)[0]
    props = _get_pset_props(pset)
    string_props = (
        "ModelVersion",
        "InputContractVersion",
        "IfcOpenShellVersion",
        "AgentStagesRun",
        "AgentModelsUsed",
        "TargetFidelity",
        "FixtureMatch",
        "GeneratedAt",
        "BuildId",
        "SourceContract",
    )
    for name in string_props:
        ifc_type, val = props[name]
        assert ifc_type in {"IfcLabel", "IfcText", "IfcIdentifier"}, (
            f"{name} stored as {ifc_type}, expected a string-ish IFC type"
        )
        assert isinstance(val, str)


def test_float_properties_emit_as_ifc_real():
    f, project = _make_minimal_ifc()
    stamp_provenance(
        f,
        _make_provenance(total_llm_cost_usd=1.25, prompt_cache_hit_rate=0.93),
        project,
    )
    props = _get_pset_props(_get_psets(project)[0])
    assert props["TotalLLMCostUSD"][0] == "IfcReal"
    assert props["TotalLLMCostUSD"][1] == 1.25
    assert props["PromptCacheHitRate"][0] == "IfcReal"
    assert props["PromptCacheHitRate"][1] == 0.93


def test_int_properties_emit_as_ifc_integer():
    f, project = _make_minimal_ifc()
    stamp_provenance(
        f,
        _make_provenance(total_wallclock_ms=4321, ids_rules_passed=72, ids_rules_failed=2),
        project,
    )
    props = _get_pset_props(_get_psets(project)[0])
    assert props["TotalWallclockMs"] == ("IfcInteger", 4321)
    assert props["IdsRulesPassed"] == ("IfcInteger", 72)
    assert props["IdsRulesFailed"] == ("IfcInteger", 2)


# ─── IfcOpenShellVersion is sourced from the module, not Provenance ──


def test_ifcopenshell_version_sourced_from_module_not_provenance():
    """`provenance.ifcopenshell_version` is the empty default; the stamper
    must populate `IfcOpenShellVersion` from `ifcopenshell.version` at
    stamp time. This is critical because the lift service produces
    Provenance before any IFC is built — only the stamper knows which
    ifcopenshell binary is producing the file."""
    f, project = _make_minimal_ifc()
    # Provenance has empty ifcopenshell_version (default)
    prov = _make_provenance()
    assert prov.ifcopenshell_version == "", "Sanity: Provenance default should be empty"
    stamp_provenance(f, prov, project)
    props = _get_pset_props(_get_psets(project)[0])
    stamped_version = props["IfcOpenShellVersion"][1]
    assert stamped_version == ifcopenshell.version
    assert stamped_version != ""  # confirms NOT sourced from the empty Provenance default


def test_ifcopenshell_version_overrides_provenance_value():
    """Even if Provenance carries a (stale / wrong) ifcopenshell_version,
    the stamper uses the live one. Defensive against accidental misuse."""
    f, project = _make_minimal_ifc()
    prov = _make_provenance()
    # Try to pollute via model_copy (Provenance doesn't accept ifcopenshell_version
    # as a public override path, but we can craft a copy with the field set).
    prov_with_stale = prov.model_copy(update={"ifcopenshell_version": "SHOULD_BE_IGNORED"})
    stamp_provenance(f, prov_with_stale, project)
    props = _get_pset_props(_get_psets(project)[0])
    assert props["IfcOpenShellVersion"][1] == ifcopenshell.version
    assert props["IfcOpenShellVersion"][1] != "SHOULD_BE_IGNORED"


# ─── Idempotence ─────────────────────────────────────────────────────


def test_stamp_twice_does_not_create_duplicate_pset():
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(), project)
    stamp_provenance(f, _make_provenance(), project)
    psets = _get_psets(project)
    assert len(psets) == 1, f"Expected 1 pset after double stamp, got {len(psets)}"


def test_stamp_twice_updates_values_in_place():
    """Mirrors the Slice 6 pattern: stamp once with zero IDS counts after
    BUILD, stamp again with real counts after VALIDATE-IFC."""
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(ids_rules_passed=0, ids_rules_failed=0), project)
    stamp_provenance(f, _make_provenance(ids_rules_passed=72, ids_rules_failed=2), project)
    pset = _get_psets(project)[0]
    props = _get_pset_props(pset)
    assert props["IdsRulesPassed"] == ("IfcInteger", 72)
    assert props["IdsRulesFailed"] == ("IfcInteger", 2)


def test_re_stamp_changes_build_id_and_target_fidelity():
    f, project = _make_minimal_ifc()
    stamp_provenance(f, _make_provenance(build_id="b1", target_fidelity="concept"), project)
    stamp_provenance(f, _make_provenance(build_id="b2", target_fidelity="tender-ready"), project)
    pset = _get_psets(project)[0]
    props = _get_pset_props(pset)
    assert props["BuildId"][1] == "b2"
    assert props["TargetFidelity"][1] == "tender-ready"
    assert len(_get_psets(project)) == 1


# ─── Defensive guards ────────────────────────────────────────────────


def test_raises_on_none_project():
    f, _project = _make_minimal_ifc()
    with pytest.raises(ValueError, match="project_entity is None"):
        stamp_provenance(f, _make_provenance(), None)


def test_raises_when_entity_is_not_an_ifc_project():
    f, project = _make_minimal_ifc()
    site = api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    with pytest.raises(ValueError, match="expected IfcProject, got IfcSite"):
        stamp_provenance(f, _make_provenance(), site)


# ─── Multi-project safety ────────────────────────────────────────────


def test_pset_attached_only_to_target_project():
    """If the file (theoretically) carries multiple IfcProjects, only the
    explicit target gets the Pset. Real IFC files have exactly one
    IfcProject, but the API shouldn't depend on that."""
    f, project_a = _make_minimal_ifc()
    project_b = api.run("root.create_entity", f, ifc_class="IfcProject", name="B")
    stamp_provenance(f, _make_provenance(build_id="A"), project_a)
    assert len(_get_psets(project_a)) == 1
    assert len(_get_psets(project_b)) == 0


# ─── Round-trip ──────────────────────────────────────────────────────


def test_pset_round_trips_through_serialization():
    """Write → bytes → read; verify the Pset survives serialization."""
    f, project = _make_minimal_ifc()
    stamp_provenance(
        f,
        _make_provenance(
            build_id="round-trip-1",
            ids_rules_passed=42,
            ids_rules_failed=0,
            total_llm_cost_usd=0.123,
        ),
        project,
    )
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=True) as tmp:
        f.write(tmp.name)
        # Re-open
        f2 = ifcopenshell.open(tmp.name)
    project2 = f2.by_type("IfcProject")[0]
    psets = _get_psets(project2)
    assert len(psets) == 1
    assert psets[0].Name == PSET_NAME
    props = _get_pset_props(psets[0])
    assert props["BuildId"][1] == "round-trip-1"
    assert props["IdsRulesPassed"] == ("IfcInteger", 42)
    assert props["IdsRulesFailed"] == ("IfcInteger", 0)
    assert props["TotalLLMCostUSD"] == ("IfcReal", 0.123)
    assert props["IfcOpenShellVersion"][1] == ifcopenshell.version


# ─── Per-fixture provenance (uses lift to produce real Provenance) ──


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_stamp_with_real_lift_provenance(fixture: str):
    """End-to-end: lift a Phase 0 fixture, take its Provenance, stamp into
    a fresh IfcProject, verify the fixture_match round-trips."""
    import json
    from app.models.request import ExportOptions, MassingGeometry
    from app.services.massing_to_building_model import lift

    fixtures_dir = Path(__file__).parent / "fixtures"
    with open(fixtures_dir / f"{fixture}.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _w = lift(geom, ExportOptions(), build_id=f"build-{fixture}", fixture_match=fixture)

    f, project = _make_minimal_ifc()
    stamp_provenance(f, bm.project.metadata.provenance, project)
    pset = _get_psets(project)[0]
    props = _get_pset_props(pset)
    assert props["FixtureMatch"][1] == fixture
    assert props["BuildId"][1] == f"build-{fixture}"
    assert props["SourceContract"][1] == "MassingGeometry-lifted"
    assert props["InputContractVersion"][1] == "MassingGeometry-1.0.0"
    assert props["AgentStagesRun"][1] == "lift-from-massing"
    assert props["TargetFidelity"][1] == "design-development"
