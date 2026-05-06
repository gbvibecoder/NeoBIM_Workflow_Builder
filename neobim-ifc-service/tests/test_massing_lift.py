"""Phase 1 Slice 2 — MassingGeometry → BuildingModel lift tests.

Covers the public lift() API, all seven heuristics, the six pre-defined
LiftWarning codes that fire in real fixtures, and determinism.

Each fixture has an "expected warning code multiset" pinned. If lift's
behavior on a fixture changes, the warning multiset must be updated
deliberately — silent drift is what the determinism + warning-set tests
exist to catch.
"""

from __future__ import annotations

import copy
import json
from collections import Counter
from pathlib import Path

import pytest

from app.domain.building_model import BuildingModel
from app.models.request import ExportOptions, MassingGeometry
from app.services.massing_to_building_model import LiftWarning, lift


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _load_fixture(name: str) -> MassingGeometry:
    with open(_FIXTURE_DIR / f"{name}.json") as fp:
        d = json.load(fp)
    return MassingGeometry.model_validate(d["geometry"])


def _lift(name: str, *, options: ExportOptions | None = None) -> tuple[BuildingModel, list[LiftWarning]]:
    return lift(
        _load_fixture(name),
        options or ExportOptions(),
        build_id=f"build-{name}",
        fixture_match=name,
    )


# ─── Per-fixture acceptance ──────────────────────────────────────────


def test_lift_simple_box_clean():
    """Acceptance criterion: simple_box produces ZERO warnings."""
    bm, warnings = _lift("simple_box")
    assert isinstance(bm, BuildingModel)
    assert warnings == [], f"Unexpected warnings: {[w.model_dump() for w in warnings]}"


def test_lift_multistorey_residential_known_warnings():
    """Pinned warning multiset. Update intentionally if lift behavior changes."""
    bm, warnings = _lift("multistorey_residential")
    codes = Counter(w.code for w in warnings)
    # All MEP segments lack a source equipment or terminal in this fixture →
    # 5 MEP_NO_ANCHOR (2 ducts + 2 pipes + 1 cable-tray).
    assert codes == Counter({"MEP_NO_ANCHOR": 5}), f"Got {dict(codes)}"


def test_lift_non_rectangular_known_warnings():
    bm, warnings = _lift("non_rectangular")
    codes = Counter(w.code for w in warnings)
    # 1 equipment exists (HVAC) but ducts aren't connected to it → 2 HVAC orphans;
    # plumbing has only a segment with no source/terminal → 1.
    assert codes == Counter({"MEP_NO_ANCHOR": 3}), f"Got {dict(codes)}"


def test_all_three_fixtures_produce_invariant_valid_BuildingModels():
    """Defense in depth: lift output is a valid BuildingModel (all 12 invariants
    pass) for every Phase 0 fixture."""
    for name in ("simple_box", "multistorey_residential", "non_rectangular"):
        bm, _w = _lift(name)
        # If we got here, BuildingModel.build succeeded which means all 12
        # invariants passed.
        assert bm.project.metadata.provenance.fixture_match == name


# ─── Counts sanity ───────────────────────────────────────────────────


def test_simple_box_node_counts():
    bm, _ = _lift("simple_box")
    b = bm.project.site.building
    assert len(b.storeys) == 1
    assert sum(len(s.walls) for s in b.storeys) == 4
    assert sum(len(s.rooms) for s in b.storeys) == 1
    assert sum(len(s.slabs) for s in b.storeys) == 2  # 1 floor + 1 roof
    assert len(b.doors) == 1
    assert len(b.windows) == 1


def test_multistorey_residential_storey_continuity_holds():
    bm, _ = _lift("multistorey_residential")
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    for i in range(len(storeys) - 1):
        cur, nxt = storeys[i], storeys[i + 1]
        assert abs((cur.elevation + cur.actual_height) - nxt.elevation) <= 0.005


# ─── Determinism ─────────────────────────────────────────────────────


def _bm_json_without_timestamp(bm: BuildingModel) -> str:
    """Drop Provenance.generated_at (the only intentionally non-deterministic
    field) before comparing."""
    d = bm.model_dump(mode="json")
    d["project"]["metadata"]["provenance"]["generated_at"] = "<elided>"
    return json.dumps(d, sort_keys=True)


def test_lift_determinism_simple_box():
    bm1, w1 = _lift("simple_box")
    bm2, w2 = _lift("simple_box")
    assert _bm_json_without_timestamp(bm1) == _bm_json_without_timestamp(bm2)
    assert [w.model_dump() for w in w1] == [w.model_dump() for w in w2]


def test_lift_determinism_multistorey():
    bm1, w1 = _lift("multistorey_residential")
    bm2, w2 = _lift("multistorey_residential")
    assert _bm_json_without_timestamp(bm1) == _bm_json_without_timestamp(bm2)
    # Warning order also deterministic
    assert [(w.code, w.legacy_element_id) for w in w1] == [
        (w.code, w.legacy_element_id) for w in w2
    ]


# ─── Provenance ──────────────────────────────────────────────────────


def test_provenance_carries_required_fields():
    bm, _ = _lift("simple_box")
    p = bm.project.metadata.provenance
    assert p.input_contract_version == "MassingGeometry-1.0.0"
    assert p.source_contract == "MassingGeometry-lifted"
    assert p.agent_stages_run == "lift-from-massing"
    assert p.build_id == "build-simple_box"
    assert p.fixture_match == "simple_box"
    # Default ExportOptions.target_fidelity is "design-development"
    assert p.target_fidelity == "design-development"
    assert p.generated_at and "T" in p.generated_at  # ISO 8601 with T separator


def test_provenance_target_fidelity_propagates():
    options = ExportOptions(targetFidelity="tender-ready")
    bm, _ = lift(
        _load_fixture("simple_box"),
        options,
        build_id="b1",
        fixture_match="simple_box",
    )
    assert bm.project.metadata.provenance.target_fidelity == "tender-ready"


# ─── Stair recomputation ─────────────────────────────────────────────


def test_stair_riser_recomputed_to_match_structural_rise():
    """Legacy fixture has riser_count=16, riser_height=0.1875 (total 3.0m).
    Lift recomputes both fields so riser_count * riser_height matches the
    actual structural rise (slab_above.bottom_z - slab_below.top_z) within
    1mm — that's what the STAIR_RISE_MATCHES invariant checks. The exact
    rise depends on per-storey slab thicknesses, so we derive it from the
    constructed BuildingModel rather than hardcoding."""
    bm, _ = _lift("multistorey_residential")
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    storey0 = storeys[0]
    storey1 = storeys[1]
    assert len(storey0.stairs) == 1
    stair = storey0.stairs[0]
    slab_below = next(s for s in storey0.slabs if s.predefined_type == "FLOOR")
    slab_above = next(s for s in storey1.slabs if s.predefined_type == "FLOOR")
    structural_rise = slab_above.bottom_z - slab_below.top_z
    rise_total = stair.riser_count * stair.riser_height
    assert abs(rise_total - structural_rise) <= 0.001, (
        f"Stair rise {rise_total:.4f}m != structural {structural_rise:.4f}m"
    )
    # And the legacy values (16 × 0.1875 = 3.0m) were definitely overridden:
    assert (stair.riser_count, stair.riser_height) != (16, 0.1875)


# ─── LiftWarning shape ───────────────────────────────────────────────


def test_LiftWarning_is_frozen():
    w = LiftWarning(code="X", legacy_element_id="y", message="m", fallback="f")
    with pytest.raises(Exception):  # ValidationError on frozen mutation
        w.code = "Z"  # type: ignore[misc]


def test_LiftWarning_carries_all_four_fields():
    bm, warnings = _lift("multistorey_residential")
    assert warnings  # has at least one MEP_NO_ANCHOR
    for w in warnings:
        assert w.code
        assert w.legacy_element_id
        assert w.message
        assert w.fallback


# ─── Targeted broken-input scenarios ─────────────────────────────────


def _fixture_dict(name: str) -> dict:
    with open(_FIXTURE_DIR / f"{name}.json") as fp:
        return json.load(fp)


def _lift_dict(d: dict) -> tuple[BuildingModel, list[LiftWarning]]:
    geom = MassingGeometry.model_validate(d["geometry"])
    options = ExportOptions()
    return lift(geom, options, build_id="b", fixture_match="")


def test_lift_skips_wall_with_one_vertex():
    d = _fixture_dict("simple_box")
    # Mutate one wall to have only 1 vertex
    d["geometry"]["storeys"][0]["elements"][0]["vertices"] = [
        d["geometry"]["storeys"][0]["elements"][0]["vertices"][0]
    ]
    bm, warnings = _lift_dict(d)
    assert any(w.code == "WALL_INSUFFICIENT_VERTICES" for w in warnings)
    # Building should still construct (with 3 walls instead of 4)
    assert sum(len(s.walls) for s in bm.project.site.building.storeys) == 3


def test_lift_skips_door_with_unknown_parent_wall():
    d = _fixture_dict("simple_box")
    # Find the door element and set its parent_wall_id to a non-existent id
    for s in d["geometry"]["storeys"]:
        for e in s["elements"]:
            if e["type"] == "door":
                e["properties"]["parentWallId"] = "wall_does_not_exist"
                # Move the door vertex far away so nearest-axis search also fails
                e["vertices"] = [{"x": -100, "y": -100, "z": 0}]
                break
    bm, warnings = _lift_dict(d)
    assert any(w.code == "OPENING_NO_WALL_MATCH" for w in warnings)
    assert len(bm.project.site.building.doors) == 0  # door dropped


def test_lift_emits_warning_for_invalid_door_placement():
    d = _fixture_dict("simple_box")
    # Set door wall_offset close to wall end so it violates 100mm clearance
    for s in d["geometry"]["storeys"]:
        for e in s["elements"]:
            if e["type"] == "door":
                # simple_box wall is 10m long, door width 1.0; offset 9.5
                # → 9.5 + 1.0 = 10.5 > 10 - 0.1 = 9.9 ⇒ fails clearance
                e["properties"]["wallOffset"] = 9.5
                break
    bm, warnings = _lift_dict(d)
    assert any(w.code == "OPENING_INVALID_PLACEMENT" for w in warnings)


def test_lift_skips_space_with_no_footprint_no_vertices():
    d = _fixture_dict("simple_box")
    for s in d["geometry"]["storeys"]:
        for e in s["elements"]:
            if e["type"] == "space":
                e["vertices"] = []
                e["properties"]["spaceFootprint"] = None
                break
    bm, warnings = _lift_dict(d)
    assert any(w.code == "ROOM_NO_FOOTPRINT" for w in warnings)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 0


def test_lift_emits_storey_discontinuity_when_gap():
    d = _fixture_dict("multistorey_residential")
    # Move storey 1 elevation 0.5m higher than expected (creating a 0.5m gap)
    d["geometry"]["storeys"][1]["elevation"] = (
        d["geometry"]["storeys"][1]["elevation"] + 0.5
    )
    bm, warnings = _lift_dict(d)
    assert any(w.code == "STOREY_DISCONTINUITY" for w in warnings)
    # Lift must heal the gap so STOREY_CONTINUITY holds
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    for i in range(len(storeys) - 1):
        cur, nxt = storeys[i], storeys[i + 1]
        assert abs((cur.elevation + cur.actual_height) - nxt.elevation) <= 0.005


def test_lift_emits_unsupported_type_warning():
    d = _fixture_dict("simple_box")
    # Inject an element with a type we don't yet map
    storey0 = d["geometry"]["storeys"][0]
    storey0["elements"].append(
        {
            "id": "balcony-1",
            "type": "balcony",
            "ifcType": "IfcBuildingElementProxy",
            "vertices": [
                {"x": 0, "y": 0, "z": 0},
                {"x": 1, "y": 0, "z": 0},
            ],
            "faces": [],
            "properties": {"name": "B1", "storeyIndex": 0},
        }
    )
    bm, warnings = _lift_dict(d)
    assert any(
        w.code == "LIFT_UNSUPPORTED_TYPE" and w.legacy_element_id == "balcony-1"
        for w in warnings
    )


# ─── Returned BuildingModel always passes invariants ─────────────────


def test_returned_BuildingModel_passes_all_invariants():
    """If lift handed back a BuildingModel that fails an invariant, this
    would have raised inside lift(); reaching here means all invariants
    held for every fixture above. This test is the contractual assertion."""
    for name in ("simple_box", "multistorey_residential", "non_rectangular"):
        bm, _ = _lift(name)
        # round-trip via build() to confirm
        BuildingModel.build(bm.model_dump(mode="json"))
