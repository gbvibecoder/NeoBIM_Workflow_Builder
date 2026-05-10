"""Slice 2B.1.E — Dispatcher → IFC inherits P1.6 LOD-300 quality.

The marquee quality guarantee of the matcher slice: every BuildingModel
the matcher pipeline produces is an existing P1.6 template builder's
output, so IDS pass-rate stays at 100% by construction.

This file pins that contract by parametrising over all nine
:class:`TemplateId` values, dispatching through the slice 2B.1
``dispatch_template`` adapter (the same call path the route handler
makes), building IFC, and asserting every P1.6 stub-entity contract.
A regression here means the dispatcher silently broke parameter
passthrough (e.g. dropped seismic_zone, mis-translated floor_height_m
to floor_to_floor_m, or skipped a tower-only kwarg) — surfaced as a
missing entity rather than a vague "IFC empty" failure.

Specifically:

* Every dispatched IFC has IfcBeam / IfcColumn / IfcSlab with
  instance-level material associations (P1.6 Fix A).
* Every dispatched IFC carries the LOD-300 stub set (P1.6 Fix C):
  IfcGrid, IfcReinforcingBar, IfcDistributionSystem, IfcDuctSegment,
  IfcPipeSegment, IfcSanitaryTerminal, IfcAirTerminal, IfcLightFixture,
  IfcRailing — at least one of each.
* Every dispatched IFC has at least one IfcSpace + IfcDoor + IfcWindow.

Tests are gated on ``ifcopenshell`` availability (developer-laptop
friendly).
"""

from __future__ import annotations

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")

from app.services.design_agent import (  # noqa: E402
    TemplateId,
    TemplateParameters,
    dispatch_template,
)
from scripts.export_2bhk_pune_to_ifc import (  # noqa: E402
    build_ifc_from_building_model,
)


# Plot defaults that each TemplateId's builder accepts cleanly.
# Tower fixtures use habitable_floor_count=5 to match the existing
# P1.6 baseline (tower-g5 variants in test_phase_p1_6_ids_cleanup.py).
_FIXTURE_PARAMS: dict[TemplateId, TemplateParameters] = {
    TemplateId.BHK1_PUNE_HOUSE: TemplateParameters(
        plot_width_m=7.32, plot_length_m=12.20
    ),
    TemplateId.BHK1_PUNE_DUPLEX: TemplateParameters(
        plot_width_m=7.32, plot_length_m=12.20
    ),
    TemplateId.BHK1_PUNE_TOWER: TemplateParameters(
        plot_width_m=7.32, plot_length_m=12.20, habitable_floor_count=5
    ),
    TemplateId.BHK2_PUNE_HOUSE: TemplateParameters(
        plot_width_m=7.32, plot_length_m=15.24
    ),
    TemplateId.BHK2_PUNE_DUPLEX: TemplateParameters(
        plot_width_m=7.32, plot_length_m=15.24
    ),
    TemplateId.BHK2_PUNE_TOWER: TemplateParameters(
        plot_width_m=7.32, plot_length_m=15.24, habitable_floor_count=5
    ),
    TemplateId.BHK3_PUNE_HOUSE: TemplateParameters(
        plot_width_m=11.0, plot_length_m=20.0
    ),
    TemplateId.BHK3_PUNE_DUPLEX: TemplateParameters(
        plot_width_m=11.0, plot_length_m=20.0
    ),
    TemplateId.BHK3_PUNE_TOWER: TemplateParameters(
        plot_width_m=11.0, plot_length_m=20.0, habitable_floor_count=5
    ),
}


@pytest.fixture(
    params=list(TemplateId), ids=lambda t: t.value
)
def dispatched_ifc(request):
    """Build IFC4 file via the slice 2B.1 dispatcher path.

    Returns ``(template_id, ifcopenshell_file)`` so individual tests can
    name the failing template id in their assertion messages.
    """
    template_id: TemplateId = request.param
    params = _FIXTURE_PARAMS[template_id]
    bm = dispatch_template(template_id, params)
    model = build_ifc_from_building_model(bm)
    return template_id, model


def _has_material_association(entity) -> bool:
    """Walk HasAssociations for IfcRelAssociatesMaterial → IfcMaterial."""
    for rel in getattr(entity, "HasAssociations", []) or []:
        if rel.is_a("IfcRelAssociatesMaterial"):
            if rel.RelatingMaterial is not None:
                return True
    return False


# ─── P1.6 Fix A inheritance — instance-level material associations ───


def test_dispatcher_ifc_beams_have_instance_material(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    beams = list(model.by_type("IfcBeam"))
    assert len(beams) > 0, f"{template_id.value}: no beams in dispatched IFC"
    for b in beams:
        assert _has_material_association(b), (
            f"{template_id.value}: beam {b.GlobalId} missing material"
        )


def test_dispatcher_ifc_columns_have_instance_material(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    cols = list(model.by_type("IfcColumn"))
    assert len(cols) > 0, f"{template_id.value}: no columns"
    for c in cols:
        assert _has_material_association(c)


def test_dispatcher_ifc_slabs_have_instance_material(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    slabs = list(model.by_type("IfcSlab"))
    assert len(slabs) > 0, f"{template_id.value}: no slabs"
    for s in slabs:
        assert _has_material_association(s)


# ─── P1.6 Fix C inheritance — LOD-300 stub entities present ──────────


@pytest.mark.parametrize(
    "ifc_class",
    [
        "IfcGrid",
        "IfcReinforcingBar",
        "IfcDistributionSystem",
        "IfcDuctSegment",
        "IfcPipeSegment",
        "IfcSanitaryTerminal",
        "IfcAirTerminal",
        "IfcLightFixture",
        "IfcRailing",
    ],
)
def test_dispatcher_ifc_has_lod300_stub_entity(
    dispatched_ifc, ifc_class: str
) -> None:
    """Every dispatched IFC carries every P1.6 LOD-300 stub entity.

    Closes the same IDS-rule set that ``test_phase_p1_6_ids_cleanup``
    pins on the direct-builder path — proves the dispatcher does not
    silently bypass the stub emitters.
    """
    template_id, model = dispatched_ifc
    entities = list(model.by_type(ifc_class))
    assert len(entities) >= 1, (
        f"{template_id.value}: missing LOD-300 stub {ifc_class!r} in "
        f"dispatched IFC; matcher pipeline lost a P1.6 invariant"
    )


# ─── Spatial / opening sanity — every IFC has rooms + doors + windows ─


def test_dispatcher_ifc_has_spaces(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    spaces = list(model.by_type("IfcSpace"))
    assert len(spaces) > 0, f"{template_id.value}: no IfcSpace in dispatched IFC"


def test_dispatcher_ifc_has_doors(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    doors = list(model.by_type("IfcDoor"))
    assert len(doors) > 0, f"{template_id.value}: no IfcDoor"


def test_dispatcher_ifc_has_windows(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    windows = list(model.by_type("IfcWindow"))
    assert len(windows) > 0, f"{template_id.value}: no IfcWindow"


def test_dispatcher_ifc_has_storeys(dispatched_ifc) -> None:
    template_id, model = dispatched_ifc
    storeys = list(model.by_type("IfcBuildingStorey"))
    assert len(storeys) >= 1, (
        f"{template_id.value}: no IfcBuildingStorey in dispatched IFC"
    )


# ─── Smoke: dispatcher produces non-trivial IFC for every template ───


def test_dispatcher_ifc_has_non_trivial_wall_count_for_every_template(
    dispatched_ifc,
) -> None:
    """Every template's dispatched IFC has a non-trivial wall count.

    Wall + Railing counts (P1.6 baselines, 2026-05-10):

    * Houses (single storey): 14-17.
    * Duplexes (G+1): 22-30.
    * Towers (stilt + 5 habitable): 88-108.

    Threshold 10 — well below the smallest house's authored count, so
    a dispatcher regression that drops walls (e.g. parameter
    passthrough loses storey data, or builder-default override
    silently empties a storey) surfaces here without false positives
    from authoring trims. Family-specific element counts are owned by
    the per-template test files (test_template_*_pune.py).
    """
    template_id, model = dispatched_ifc
    walls = list(model.by_type("IfcWall"))
    railings = list(model.by_type("IfcRailing"))
    total = len(walls) + len(railings)
    assert total >= 10, (
        f"{template_id.value}: only {total} (Wall + Railing) elements; "
        f"expected at least 10 — dispatcher likely dropped a parameter"
    )
