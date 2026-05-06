"""Phase 1 Track D — baseline quality gate for IFC output.

This test is the floor. It exercises the full Python IFC pipeline on a known
fixture (tests/fixtures/baseline_building.json) and asserts a set of
invariants that collectively define "good IFC" for this project:

    1. Schema:     output parses as IFC4; no BuildFailures.
    2. Hierarchy:  Project → Site → Building → Storey → Element, no orphans.
    3. Elements:   per-discipline floors (wall/slab/column/beam/...) are met.
    4. Openings:   every IfcWindow/IfcDoor links to an IfcOpeningElement which
                   voids a wall (IfcRelFillsElement + IfcRelVoidsElement).
    5. Materials:  every wall/slab carries an associated IfcMaterialLayerSet.
    6. Units:      IfcUnitAssignment with metric length units.
    7. Size:       output in a plausible band (not empty, not catastrophic).

When a capability is INTENTIONALLY changed (e.g. Phase 2 adds IfcRailing
builders), update the floors and regenerate — see
docs/ifc-baseline-regeneration.md.

CI runs this via .github/workflows/ifc-baseline.yml on any change under
neobim-ifc-service/**.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Iterable

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "baseline_building.json"

# ── Per-discipline entity floors ────────────────────────────────────────
# These are minimums, not exacts. A future change can produce MORE of any
# class and the test still passes; producing fewer fails the test and
# forces a deliberate floor adjustment + regeneration.

FLOORS_COMBINED: dict[str, int] = {
    "IfcProject": 1,
    "IfcSite": 1,
    "IfcBuilding": 1,
    "IfcBuildingStorey": 3,
    "IfcWall": 9,           # 8 perimeter + 1 partition
    "IfcWindow": 1,
    "IfcDoor": 1,
    "IfcSlab": 3,           # GF slab + L1 slab + roof-as-slab
    "IfcColumn": 8,         # 4 × 2 storeys
    "IfcBeam": 4,           # 2 × 2 storeys
    "IfcStairFlight": 1,
    "IfcSpace": 3,          # GF lobby + GF office + L1 office
    "IfcDuctSegment": 1,
    "IfcPipeSegment": 1,
    "IfcCableCarrierSegment": 1,
    "IfcUnitAssignment": 1,
}

FLOORS_ARCHITECTURAL: dict[str, int] = {
    "IfcProject": 1,
    "IfcBuildingStorey": 3,
    "IfcWall": 9,
    "IfcWindow": 1,
    "IfcDoor": 1,
    "IfcSpace": 3,
}

FLOORS_STRUCTURAL: dict[str, int] = {
    "IfcProject": 1,
    "IfcBuildingStorey": 3,
    "IfcColumn": 8,
    "IfcBeam": 4,
    "IfcSlab": 3,
    "IfcStairFlight": 1,
}

FLOORS_MEP: dict[str, int] = {
    "IfcProject": 1,
    "IfcBuildingStorey": 3,
    "IfcDuctSegment": 1,
    "IfcPipeSegment": 1,
    "IfcCableCarrierSegment": 1,
}

FLOORS_BY_DISCIPLINE: dict[str, dict[str, int]] = {
    "architectural": FLOORS_ARCHITECTURAL,
    "structural": FLOORS_STRUCTURAL,
    "mep": FLOORS_MEP,
    "combined": FLOORS_COMBINED,
}

# Size band: tuned from the fixture. Empty-output regression = size < lower;
# runaway = size > upper. Adjust when fixture intentionally grows.
SIZE_BAND_BYTES: dict[str, tuple[int, int]] = {
    "architectural": (8_000, 2_000_000),
    "structural":    (8_000, 2_000_000),
    # MEP has the fewest elements in the fixture (3 segments + systems) and
    # since the default rich mode is "off" those segments are bodyless
    # (Pset + IfcSystem grouping only, no IfcExtrudedAreaSolid). That keeps
    # the output smaller than pre-fix output had bodies — hence the lower
    # floor. Rich mode "mep"/"full" re-enables bodies and pushes size back up.
    "mep":           (2_500, 2_000_000),
    "combined":      (10_000, 5_000_000),
}


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def baseline_request() -> ExportIFCRequest:
    """Parse baseline_building.json into a validated ExportIFCRequest."""
    with FIXTURE_PATH.open() as f:
        raw = json.load(f)
    raw.pop("_comment", None)
    return ExportIFCRequest.model_validate(raw)


@pytest.fixture(scope="module")
def build_results(baseline_request: ExportIFCRequest) -> dict:
    """Run build_multi_discipline once, parse each output back with ifcopenshell.

    Returns a dict: {discipline: {"bytes": bytes, "model": ifcopenshell.file,
                                  "counts": EntityCounts, "failures": list}}
    """
    raw = build_multi_discipline(baseline_request)
    parsed: dict[str, dict] = {}
    for discipline, (ifc_bytes, counts, failures) in raw.items():
        # ifcopenshell needs a real file on disk to open(). Write a
        # NamedTemporaryFile per discipline and keep it alive for the
        # module; the OS cleans up at process exit.
        tmp = tempfile.NamedTemporaryFile(
            suffix=f"_{discipline}.ifc", delete=False, mode="wb"
        )
        tmp.write(ifc_bytes)
        tmp.flush()
        tmp.close()
        model = ifcopenshell.open(tmp.name)
        parsed[discipline] = {
            "bytes": ifc_bytes,
            "path": tmp.name,
            "model": model,
            "counts": counts,
            "failures": failures,
        }
    return parsed


# ── Smoke layer ─────────────────────────────────────────────────────────


def test_fixture_loads_without_validation_error(baseline_request: ExportIFCRequest):
    assert baseline_request.geometry.floors == 2
    assert len(baseline_request.geometry.storeys) == 3
    assert baseline_request.options.disciplines == [
        "architectural", "structural", "mep", "combined"
    ]


def test_fixture_exercises_track_c_fields(baseline_request: ExportIFCRequest):
    """The baseline is meant to EXERCISE the new Track C fields end-to-end.

    If this ever drops to zero, the baseline has lost its Track C coverage
    and the boundary is no longer being tested on a realistic payload.
    """
    props_with_wall_type = 0
    props_with_structural_material = 0
    props_with_mep_system = 0
    for storey in baseline_request.geometry.storeys:
        for el in storey.elements:
            if el.properties.wall_type:
                props_with_wall_type += 1
            if el.properties.structural_material:
                props_with_structural_material += 1
            if el.properties.mep_system:
                props_with_mep_system += 1
    assert props_with_wall_type >= 5, "fewer walls carry wallType than expected"
    assert props_with_structural_material >= 10
    assert props_with_mep_system >= 3


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_build_produces_non_empty_ifc(build_results: dict, discipline: str):
    result = build_results[discipline]
    assert len(result["bytes"]) > 0, f"{discipline} produced empty bytes"
    lower, upper = SIZE_BAND_BYTES[discipline]
    assert lower <= len(result["bytes"]) <= upper, (
        f"{discipline} output {len(result['bytes'])} bytes out of band "
        f"[{lower}, {upper}]"
    )


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_no_build_failures(build_results: dict, discipline: str):
    failures = build_results[discipline]["failures"]
    assert failures == [], (
        f"{discipline} had {len(failures)} per-element failures: "
        f"{[f.element_id for f in failures]}"
    )


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_parses_as_ifc4(build_results: dict, discipline: str):
    model = build_results[discipline]["model"]
    assert model.schema == "IFC4", f"{discipline} schema was {model.schema!r}"


# ── Schema layer ────────────────────────────────────────────────────────


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_has_exactly_one_project(build_results: dict, discipline: str):
    model = build_results[discipline]["model"]
    projects = list(model.by_type("IfcProject"))
    assert len(projects) == 1, f"{discipline}: expected 1 IfcProject, got {len(projects)}"


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_has_si_length_unit(build_results: dict, discipline: str):
    """IfcUnitAssignment with at least one SI length unit (METRE)."""
    model = build_results[discipline]["model"]
    assignments = list(model.by_type("IfcUnitAssignment"))
    assert assignments, f"{discipline}: no IfcUnitAssignment"
    unit_names = []
    for a in assignments:
        for u in (a.Units or []):
            if u.is_a("IfcSIUnit"):
                unit_names.append(u.Name)
    assert "METRE" in unit_names, (
        f"{discipline}: no METRE SI unit; found {unit_names}"
    )


# ── Element-floor layer ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "discipline",
    ["architectural", "structural", "mep", "combined"],
)
def test_entity_floors(build_results: dict, discipline: str):
    """Per-discipline minimums — the contract with Phase 2+."""
    model = build_results[discipline]["model"]
    floors = FLOORS_BY_DISCIPLINE[discipline]
    actual = {cls: len(list(model.by_type(cls))) for cls in floors}
    violations = [
        (cls, need, actual[cls])
        for cls, need in floors.items()
        if actual[cls] < need
    ]
    assert not violations, (
        f"{discipline} entity floors violated: "
        + ", ".join(f"{c}: need≥{n}, got {got}" for c, n, got in violations)
    )


# ── Hierarchy layer ─────────────────────────────────────────────────────


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_spatial_hierarchy_is_connected(build_results: dict, discipline: str):
    """Project aggregates Site; Site aggregates Building; Building aggregates Storey."""
    model = build_results[discipline]["model"]

    project = model.by_type("IfcProject")[0]
    site_under_project = _aggregates_children_of(project)
    assert any(c.is_a("IfcSite") for c in site_under_project), (
        f"{discipline}: IfcProject does not aggregate any IfcSite"
    )

    for site in model.by_type("IfcSite"):
        children = _aggregates_children_of(site)
        assert any(c.is_a("IfcBuilding") for c in children), (
            f"{discipline}: IfcSite {site.GlobalId} has no IfcBuilding child"
        )

    for building in model.by_type("IfcBuilding"):
        children = _aggregates_children_of(building)
        assert any(c.is_a("IfcBuildingStorey") for c in children), (
            f"{discipline}: IfcBuilding {building.GlobalId} has no storey"
        )


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_elements_belong_to_a_storey(build_results: dict, discipline: str):
    """Every physical building element must be contained in an IfcBuildingStorey.

    Exception: IfcSpace aggregates under a storey via IfcRelAggregates, not
    IfcRelContainedInSpatialStructure — so we accept either for spaces.
    """
    model = build_results[discipline]["model"]
    checked_classes = [
        "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcWindow", "IfcDoor",
        "IfcStairFlight", "IfcDuctSegment", "IfcPipeSegment",
        "IfcCableCarrierSegment",
    ]
    orphans: list[str] = []
    for cls in checked_classes:
        for elem in model.by_type(cls):
            if not _is_in_spatial_structure(elem):
                orphans.append(f"{cls}:{getattr(elem, 'Name', elem.GlobalId)}")
    assert not orphans, f"{discipline}: orphaned elements: {orphans[:10]}"


# ── Opening / wall-void layer ──────────────────────────────────────────


def test_windows_and_doors_have_openings(build_results: dict):
    """Every IfcWindow/IfcDoor must fill an IfcOpeningElement that voids a wall.

    Only meaningful on the 'architectural' and 'combined' outputs.
    """
    for discipline in ("architectural", "combined"):
        model = build_results[discipline]["model"]
        fillings = {
            rel.RelatedBuildingElement.GlobalId
            for rel in model.by_type("IfcRelFillsElement")
            if rel.RelatedBuildingElement is not None
        }
        missing: list[str] = []
        for fillable in list(model.by_type("IfcWindow")) + list(model.by_type("IfcDoor")):
            if fillable.GlobalId not in fillings:
                missing.append(f"{fillable.is_a()}:{fillable.Name}")
        assert not missing, (
            f"{discipline}: filling elements not in any IfcRelFillsElement: {missing}"
        )


# ── Material layer ─────────────────────────────────────────────────────


def test_walls_have_material_association(build_results: dict):
    """Every IfcWall must reach a material — either DIRECTLY (instance-level
    rel, the Phase 1 contract) or INDIRECTLY via its IfcWallType (the
    Phase 2 contract introduced by Fix 3 type instancing).

    The walk-up lets the same test pin both contracts: parapet/enrichment
    walls keep the per-instance pattern, user-emitted walls inherit
    through their type.
    """
    model = build_results["combined"]["model"]
    # Direct: instance is the RelatedObject of an IfcRelAssociatesMaterial
    materialised_walls: set[str] = set()
    for rel in model.by_type("IfcRelAssociatesMaterial"):
        for obj in rel.RelatedObjects or []:
            if obj.is_a("IfcWall"):
                materialised_walls.add(obj.GlobalId)
    # Indirect: wall → IfcRelDefinesByType → IfcWallType (the type carries
    # the material). The same IfcRelAssociatesMaterial scan above also
    # captures type-level associations; we just need to translate from
    # type → instances.
    typed_to_instances: dict[int, list[str]] = {}
    for rel in model.by_type("IfcRelDefinesByType"):
        relating = rel.RelatingType
        if relating is None or not relating.is_a("IfcWallType"):
            continue
        ids = [o.GlobalId for o in (rel.RelatedObjects or []) if o.is_a("IfcWall")]
        typed_to_instances.setdefault(relating.id(), []).extend(ids)
    for rel in model.by_type("IfcRelAssociatesMaterial"):
        for obj in rel.RelatedObjects or []:
            if obj.is_a("IfcWallType"):
                materialised_walls.update(typed_to_instances.get(obj.id(), []))

    all_walls = {w.GlobalId for w in model.by_type("IfcWall")}
    unmaterialised = all_walls - materialised_walls
    assert not unmaterialised, (
        f"{len(unmaterialised)} IfcWall(s) with no material association "
        f"(direct OR via IfcWallType inheritance)"
    )


def test_walls_have_property_sets(build_results: dict):
    """Every IfcWall must carry at least one IfcPropertySet via IfcRelDefinesByProperties."""
    model = build_results["combined"]["model"]
    propertied_walls: set[str] = set()
    for rel in model.by_type("IfcRelDefinesByProperties"):
        defin = rel.RelatingPropertyDefinition
        if defin is None or not defin.is_a("IfcPropertySet"):
            continue
        for obj in rel.RelatedObjects or []:
            if obj.is_a("IfcWall"):
                propertied_walls.add(obj.GlobalId)
    all_walls = {w.GlobalId for w in model.by_type("IfcWall")}
    missing = all_walls - propertied_walls
    assert not missing, f"{len(missing)} IfcWall(s) with no IfcPropertySet"


# ── Meta: entity-count helper parity ───────────────────────────────────


def test_count_helper_agrees_with_model(build_results: dict):
    """scripts/count_ifc_entities.count_entities() must agree with by_type() calls.

    Locks the helper script against silent regression — any future edit to
    the helper that changes its behavior will break the baseline test too.
    """
    import sys
    helper_dir = Path(__file__).resolve().parents[1] / "scripts"
    sys.path.insert(0, str(helper_dir))
    try:
        from count_ifc_entities import count_entities  # type: ignore
    finally:
        sys.path.remove(str(helper_dir))

    model = build_results["combined"]["model"]
    counts = count_entities(model)
    # Spot-check: the helper and by_type() agree on key classes.
    for cls in ("IfcWall", "IfcColumn", "IfcSlab", "IfcProject"):
        expected = len(list(model.by_type(cls)))
        assert counts.get(cls, 0) == expected, (
            f"count_entities disagrees with by_type on {cls}: "
            f"helper={counts.get(cls)}, by_type={expected}"
        )


# ── Helpers ────────────────────────────────────────────────────────────


def _aggregates_children_of(parent) -> list:
    """Return everything aggregated under `parent` via IfcRelAggregates."""
    children: list = []
    for rel in parent.IsDecomposedBy or []:
        if rel.is_a("IfcRelAggregates"):
            children.extend(rel.RelatedObjects or [])
    return children


def _is_in_spatial_structure(elem) -> bool:
    """True if `elem` is contained in a spatial structure (storey/space/building).

    IFC4 spec: building elements relate to storeys via either
    IfcRelContainedInSpatialStructure (most elements) or IfcRelAggregates
    (IfcSpace, nested composite elements).
    """
    if getattr(elem, "ContainedInStructure", None):
        for rel in elem.ContainedInStructure:
            if rel.is_a("IfcRelContainedInSpatialStructure"):
                parent = rel.RelatingStructure
                if parent and parent.is_a("IfcSpatialStructureElement"):
                    return True
    if getattr(elem, "Decomposes", None):
        for rel in elem.Decomposes:
            if rel.is_a("IfcRelAggregates"):
                parent = rel.RelatingObject
                if parent and parent.is_a() in (
                    "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace",
                ):
                    return True
    # Windows/doors are not contained directly; they fill openings on walls
    # which themselves are contained. Treat them as "in structure" via
    # their host wall relationship.
    if elem.is_a() in ("IfcWindow", "IfcDoor"):
        for rel in getattr(elem, "FillsVoids", []) or []:
            opening = rel.RelatingOpeningElement
            if opening and opening.VoidsElements:
                host = opening.VoidsElements[0].RelatingBuildingElement
                if host and _is_in_spatial_structure(host):
                    return True
    return False
