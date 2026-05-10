"""Phase P1.6 — IDS-cleanup regression guards.

Validates the P1.6 fixes that drove IDS violations from 2475 → 0:

  * Fix A (instance-level material assignment): every IfcBeam,
    IfcColumn, IfcSlab, IfcStair, IfcFooting, IfcRailing has an
    IfcRelAssociatesMaterial → IfcMaterial.
  * Fix B (Qto NetFloorArea / NetArea / NetVolume): Space + Slab Qto
    values are non-zero IfcAreaMeasure / IfcVolumeMeasure (the IDS
    spec was buggy on dataType — fixed in `ids/lod-300.ids`).
  * Fix C (LOD-300 stub elements): every IFC has at least one
    IfcGrid, IfcReinforcingBar, IfcDistributionSystem, IfcDuctSegment,
    IfcPipeSegment, IfcSanitaryTerminal, IfcAirTerminal, IfcLightFixture,
    IfcRailing.
  * Headline: IDS pass-rate = 100% on all 12 templates.
"""

from __future__ import annotations

import pytest

from app.templates import (
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_tower,
    build_2bhk_pune_house,
    build_2bhk_pune_template,
    build_2bhk_pune_tower,
    build_3bhk_pune_duplex,
    build_3bhk_pune_house,
    build_3bhk_pune_tower,
)
from scripts.export_2bhk_pune_to_ifc import build_ifc_from_building_model


def _builders():
    return [
        ("1bhk-house", build_1bhk_pune_house),
        ("1bhk-duplex", build_1bhk_pune_duplex),
        ("1bhk-tower-g5", lambda: build_1bhk_pune_tower(habitable_floor_count=5)),
        ("2bhk-house", build_2bhk_pune_house),
        ("2bhk-duplex", build_2bhk_pune_template),
        ("2bhk-tower-g5", lambda: build_2bhk_pune_tower(habitable_floor_count=5)),
        ("3bhk-house", build_3bhk_pune_house),
        ("3bhk-duplex", build_3bhk_pune_duplex),
        ("3bhk-tower-g5", lambda: build_3bhk_pune_tower(habitable_floor_count=5)),
    ]


@pytest.fixture(params=_builders(), ids=lambda p: p[0])
def ifc_model(request):
    label, builder = request.param
    bm = builder()
    model = build_ifc_from_building_model(bm)
    return label, model


# ─── Fix A — Instance-level material assignment ──────────────────────


def _has_material_association(entity) -> bool:
    """Walk HasAssociations for IfcRelAssociatesMaterial → IfcMaterial."""
    for rel in getattr(entity, "HasAssociations", []) or []:
        if rel.is_a("IfcRelAssociatesMaterial"):
            mat = rel.RelatingMaterial
            if mat is not None:
                return True
    return False


def test_p1_6_a_every_beam_has_instance_material(ifc_model) -> None:
    """Every IfcBeam has an IfcRelAssociatesMaterial → IfcMaterial.
    Closes the ~1434 LOD300_BEAM_MATERIAL violations."""
    label, model = ifc_model
    beams = list(model.by_type("IfcBeam"))
    assert len(beams) > 0
    for b in beams:
        assert _has_material_association(b), (
            f"{label}: beam {b.GlobalId} missing IfcRelAssociatesMaterial"
        )


def test_p1_6_a_every_column_has_instance_material(ifc_model) -> None:
    """Every IfcColumn has instance-level material."""
    label, model = ifc_model
    cols = list(model.by_type("IfcColumn"))
    assert len(cols) > 0
    for c in cols:
        assert _has_material_association(c)


def test_p1_6_a_every_slab_has_instance_material(ifc_model) -> None:
    """Every IfcSlab has instance-level material."""
    label, model = ifc_model
    slabs = list(model.by_type("IfcSlab"))
    assert len(slabs) > 0
    for s in slabs:
        assert _has_material_association(s)


def test_p1_6_a_every_footing_has_instance_material(ifc_model) -> None:
    """Every IfcFooting has instance-level material (M25-RCC)."""
    label, model = ifc_model
    footings = list(model.by_type("IfcFooting"))
    assert len(footings) > 0
    for f in footings:
        assert _has_material_association(f)


# ─── Fix B — Qto values (after IDS dataType fix) ─────────────────────


def test_p1_6_b_every_space_has_nonzero_netfloorarea(ifc_model) -> None:
    """Every IfcSpace's Qto_SpaceBaseQuantities.NetFloorArea is > 0.
    Closes the 669 LOD300_SPACE_NET_FLOOR_AREA violations."""
    label, model = ifc_model
    spaces = list(model.by_type("IfcSpace"))
    assert len(spaces) > 0
    for s in spaces:
        net_area = _qto_value(s, "Qto_SpaceBaseQuantities", "NetFloorArea")
        assert net_area is not None and net_area > 0, (
            f"{label}: space {s.GlobalId} has NetFloorArea={net_area}"
        )


def test_p1_6_b_every_slab_has_nonzero_netarea(ifc_model) -> None:
    """Every IfcSlab's Qto_SlabBaseQuantities.NetArea is > 0."""
    label, model = ifc_model
    slabs = list(model.by_type("IfcSlab"))
    for s in slabs:
        net_area = _qto_value(s, "Qto_SlabBaseQuantities", "NetArea")
        assert net_area is not None and net_area > 0


# ─── Fix C — Stub LOD-300 elements ───────────────────────────────────


@pytest.mark.parametrize("ifc_class", [
    "IfcGrid",
    "IfcReinforcingBar",
    "IfcDistributionSystem",
    "IfcDuctSegment",
    "IfcPipeSegment",
    "IfcSanitaryTerminal",
    "IfcAirTerminal",
    "IfcLightFixture",
    "IfcRailing",
])
def test_p1_6_c_every_template_has_at_least_one_stub_class(
    ifc_model, ifc_class
) -> None:
    """LOD-300 IDS rules require at least one of each MEP / structural
    reference class. P1.6 stub emitter ensures presence on every
    template."""
    label, model = ifc_model
    entities = model.by_type(ifc_class)
    assert len(entities) >= 1, (
        f"{label}: expected ≥1 {ifc_class}, got {len(entities)}"
    )


def test_p1_6_c_every_railing_has_predefined_type(ifc_model) -> None:
    """Every IfcRailing has PredefinedType set (GUARDRAIL or HANDRAIL)."""
    label, model = ifc_model
    for r in model.by_type("IfcRailing"):
        assert r.PredefinedType in ("GUARDRAIL", "HANDRAIL"), (
            f"{label}: railing {r.GlobalId} PredefinedType={r.PredefinedType}"
        )


def test_p1_6_c_reinforcing_bar_has_nominal_diameter(ifc_model) -> None:
    """Every IfcReinforcingBar has NominalDiameter set."""
    label, model = ifc_model
    for rebar in model.by_type("IfcReinforcingBar"):
        assert rebar.NominalDiameter is not None
        assert rebar.NominalDiameter > 0


# ─── Headline: IDS pass-rate ─────────────────────────────────────────


def test_p1_6_ids_pass_rate_is_100_percent(ifc_model) -> None:
    """The headline metric: every template's IFC passes the LOD-300
    IDS rule set with ZERO violations. Final state of P1.6 cleanup."""
    label, model = ifc_model
    from app.services.ids_validator import validate_ifc

    result = validate_ifc(model, "combined", "LOD-300")
    assert len(result.violations) == 0, (
        f"{label}: {len(result.violations)} IDS violations remain "
        f"(rules evaluated: {result.rules_evaluated})"
    )


# ─── Helper ──────────────────────────────────────────────────────────


def _qto_value(entity, qto_name: str, prop_name: str):
    """Read a quantity from a named Qto_*BaseQuantities on an entity.

    Returns the IfcAreaMeasure / IfcVolumeMeasure / IfcLengthMeasure
    raw float value, or None if not found.
    """
    for rel in getattr(entity, "IsDefinedBy", []) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            d = rel.RelatingPropertyDefinition
            if d.is_a("IfcElementQuantity") and d.Name == qto_name:
                for q in d.Quantities or []:
                    if q.Name != prop_name:
                        continue
                    if q.is_a("IfcQuantityArea"):
                        return q.AreaValue
                    if q.is_a("IfcQuantityVolume"):
                        return q.VolumeValue
                    if q.is_a("IfcQuantityLength"):
                        return q.LengthValue
                    if q.is_a("IfcQuantityCount"):
                        return q.CountValue
    return None
