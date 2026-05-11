"""Slice 2B.3 Phase A.4 — matrix + stacking + adapter-interaction +
NBC/plot refusals + drift detection.

Fills the test-coverage gaps that the per-extension test files (A.2)
and the orchestrator test file (A.3) didn't reach:

  * Template × extension matrix — every (4 plot-dependent extensions
    + mumty) × (9 templates) cell either succeeds or refuses with
    the documented error class.
  * Stacking — additional pair / triple / quadruple combinations on
    3BHK Pune House beyond the all-5 case in A.3.
  * Adapter × extension interaction — every extension survives every
    canonical adapter transform (mirror_X, mirror_Y, CW_90, CW_180,
    CW_270).
  * NBC + plot refusal — explicit `pytest.raises` tests beyond the
    happy-path / single-failure cases in A.2.
  * NBC lookup drift detection — extensions/_common.py NBC values
    must equal reference_data/nbc_india_minimums.py value-for-value.
    Any divergence (someone updates one without the other) fails this
    test loudly.
"""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions._common import (
    NBC_MIN_AREA_SQM,
    ExtensionRequiresPlotError,
    NBCViolationError,
    PlotBoundaryViolationError,
)
from app.services.design_agent.extensions.car_porch import add_car_porch
from app.services.design_agent.extensions.compound_wall import add_compound_wall
from app.services.design_agent.extensions.entry_gate import add_entry_gate
from app.services.design_agent.extensions.mumty import add_mumty
from app.services.design_agent.extensions.servant_quarter import (
    add_servant_quarter,
)
from app.services.design_agent.transforms import apply_adaptations
from app.services.design_agent.transforms_extensions import apply_extensions
from app.services.design_agent.types import (
    AdaptationPlan,
    ExtensionPlan,
    ExtensionRequest,
    ExtensionType,
    TransformAxis,
    TransformRotation,
)
from app.templates.tier2_1bhk_pune import build_1bhk_pune_duplex
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house
from app.templates.tier2_1bhk_pune_tower import build_1bhk_pune_tower
from app.templates.tier2_2bhk_pune import build_2bhk_pune_duplex
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower
from app.templates.tier2_3bhk_pune import build_3bhk_pune_duplex
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower

REASON = "Phase A.4 matrix test reasoning (10+ chars)"

HOUSE_DUPLEX = [
    ("1bhk-house", build_1bhk_pune_house, 2.5, 1.5),
    ("1bhk-duplex", build_1bhk_pune_duplex, 2.5, 1.5),
    ("2bhk-house", build_2bhk_pune_house, 2.5, 1.5),
    ("2bhk-duplex", build_2bhk_pune_duplex, 2.5, 1.5),
    ("3bhk-house", build_3bhk_pune_house, 4.5, 3.0),
    ("3bhk-duplex", build_3bhk_pune_duplex, 4.5, 3.0),
]
TOWERS = [
    ("1bhk-tower", build_1bhk_pune_tower),
    ("2bhk-tower", build_2bhk_pune_tower),
    ("3bhk-tower", build_3bhk_pune_tower),
]
ALL_TEMPLATES = HOUSE_DUPLEX + [(n, b, None, None) for n, b in TOWERS]


# ─── 1. NBC LOOKUP DRIFT DETECTION ──────────────────────────────────


def test_nbc_lookup_matches_authoritative_source() -> None:
    """The extensions/_common.py NBC_MIN_AREA_SQM mirror must equal
    reference_data/nbc_india_minimums.py NBC_MIN_AREAS_SQM value-by-
    value. Drift between the two copies is a real bug found during
    Phase A.4 (24 of ~30 entries had been hand-typed with fabricated
    values). This test prevents recurrence.
    """
    from app.services.design_agent.reference_data.nbc_india_minimums import (
        NBC_MIN_AREAS_SQM,
    )

    # Both tables must have the same key set.
    assert set(NBC_MIN_AREA_SQM.keys()) == set(NBC_MIN_AREAS_SQM.keys()), (
        f"NBC key drift detected. "
        f"Only in extensions/_common.py: "
        f"{set(NBC_MIN_AREA_SQM) - set(NBC_MIN_AREAS_SQM)}. "
        f"Only in reference_data: "
        f"{set(NBC_MIN_AREAS_SQM) - set(NBC_MIN_AREA_SQM)}."
    )
    # Per-key value equality.
    mismatches = [
        (k, NBC_MIN_AREA_SQM[k], NBC_MIN_AREAS_SQM[k])
        for k in NBC_MIN_AREA_SQM
        if NBC_MIN_AREA_SQM[k] != NBC_MIN_AREAS_SQM[k]
    ]
    assert not mismatches, (
        f"NBC value drift between extensions/_common.py and "
        f"reference_data/nbc_india_minimums.py: {mismatches}. Update both "
        f"copies atomically (prefer the reference_data file as primary)."
    )


# ─── 2. TEMPLATE × EXTENSION MATRIX (4×9 = 36 cells) ─────────────────


# Compound wall — succeeds on house/duplex, refuses on towers.
@pytest.mark.parametrize("label,builder,_fs,_rs", HOUSE_DUPLEX)
def test_matrix_compound_wall_succeeds_on_house_duplex(
    label, builder, _fs, _rs
) -> None:
    bm = builder()
    out = add_compound_wall(bm)
    new_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(new_walls) == 4


@pytest.mark.parametrize("label,builder", TOWERS)
def test_matrix_compound_wall_refuses_towers(label, builder) -> None:
    with pytest.raises(ExtensionRequiresPlotError):
        add_compound_wall(builder())


# Entry gate — succeeds on house/duplex (auto-adds compound + cuts opening).
@pytest.mark.parametrize("label,builder,_fs,_rs", HOUSE_DUPLEX)
def test_matrix_entry_gate_succeeds_on_house_duplex(
    label, builder, _fs, _rs
) -> None:
    bm = builder()
    out = add_entry_gate(bm)
    # Gate door present.
    gates = [
        d
        for d in out.project.site.building.doors
        if d.predefined_type == "GATE"
    ]
    assert len(gates) == 1


@pytest.mark.parametrize("label,builder", TOWERS)
def test_matrix_entry_gate_refuses_towers(label, builder) -> None:
    with pytest.raises(ExtensionRequiresPlotError):
        add_entry_gate(builder())


# Car porch — succeeds only when front_setback ≥ 4.5m (3BHK family).
@pytest.mark.parametrize("label,builder,front,_rs", HOUSE_DUPLEX)
def test_matrix_car_porch_per_template(label, builder, front, _rs) -> None:
    bm = builder()
    if front and front >= 4.5:
        out = add_car_porch(bm)
        slabs = [
            s
            for s in out.project.site.building.storeys[0].slabs
            if s.id.startswith("ext-cp-roof")
        ]
        assert len(slabs) == 1
    else:
        with pytest.raises(PlotBoundaryViolationError):
            add_car_porch(bm)


@pytest.mark.parametrize("label,builder", TOWERS)
def test_matrix_car_porch_refuses_towers(label, builder) -> None:
    with pytest.raises(ExtensionRequiresPlotError):
        add_car_porch(builder())


# Servant quarter — succeeds only when rear_setback ≥ 3.0m (3BHK family).
@pytest.mark.parametrize("label,builder,_fs,rear", HOUSE_DUPLEX)
def test_matrix_servant_quarter_per_template(label, builder, _fs, rear) -> None:
    bm = builder()
    if rear and rear >= 3.0:
        out = add_servant_quarter(bm)
        rooms = [
            r
            for r in out.project.site.building.storeys[0].rooms
            if r.id.startswith("ext-sq-")
        ]
        assert len(rooms) == 2
    else:
        with pytest.raises(PlotBoundaryViolationError):
            add_servant_quarter(bm)


@pytest.mark.parametrize("label,builder", TOWERS)
def test_matrix_servant_quarter_refuses_towers(label, builder) -> None:
    with pytest.raises(ExtensionRequiresPlotError):
        add_servant_quarter(builder())


# Mumty — succeeds on ALL 9 templates (no plot polygon needed).
@pytest.mark.parametrize(
    "label,builder",
    [(n, b) for n, b, _, _ in HOUSE_DUPLEX] + TOWERS,
)
def test_matrix_mumty_succeeds_on_every_template(label, builder) -> None:
    bm = builder()
    out = add_mumty(bm)
    before_storeys = len(bm.project.site.building.storeys)
    after_storeys = len(out.project.site.building.storeys)
    assert after_storeys == before_storeys + 1


# ─── 3. STACKING ON 3BHK PUNE HOUSE (7 more) ────────────────────────


def _req(t: ExtensionType, **overrides) -> ExtensionRequest:
    return ExtensionRequest(extension_type=t, **overrides)


def _apply_via_orchestrator(bm, types: list[ExtensionType]):
    plan = ExtensionPlan(
        extensions=[_req(t) for t in types], reasoning=REASON
    )
    out, failed = apply_extensions(bm, plan)
    return out, failed


@pytest.mark.parametrize(
    "stacked",
    [
        # pairs
        [ExtensionType.COMPOUND_WALL, ExtensionType.CAR_PORCH],
        [ExtensionType.ENTRY_GATE, ExtensionType.SERVANT_QUARTER],
        [ExtensionType.MUMTY, ExtensionType.COMPOUND_WALL],
        [ExtensionType.CAR_PORCH, ExtensionType.SERVANT_QUARTER],
        [ExtensionType.ENTRY_GATE, ExtensionType.MUMTY],
        # triple
        [
            ExtensionType.COMPOUND_WALL,
            ExtensionType.CAR_PORCH,
            ExtensionType.SERVANT_QUARTER,
        ],
        # quadruple (excluding mumty so only 1 storey)
        [
            ExtensionType.COMPOUND_WALL,
            ExtensionType.ENTRY_GATE,
            ExtensionType.CAR_PORCH,
            ExtensionType.SERVANT_QUARTER,
        ],
    ],
)
def test_stacking_succeeds_on_3bhk_house(stacked) -> None:
    bm = build_3bhk_pune_house()
    out, failed = _apply_via_orchestrator(bm, stacked)
    assert failed is None
    # All 13 invariants pass — construction succeeded.
    assert out is not None
    assert out is not bm


# ─── 4. ADAPTER × EXTENSION INTERACTION (4 more) ────────────────────


@pytest.mark.parametrize(
    "ext_type,axis,rotation",
    [
        (ExtensionType.ENTRY_GATE, TransformAxis.X, TransformRotation.NONE),
        (ExtensionType.CAR_PORCH, None, TransformRotation.CW_180),
        (ExtensionType.SERVANT_QUARTER, None, TransformRotation.CW_90),
        (ExtensionType.MUMTY, None, TransformRotation.CW_270),
    ],
)
def test_adapter_extension_interaction(ext_type, axis, rotation) -> None:
    """Each extension applies cleanly to 3BHK Pune House, then the
    adapter transforms the result without any of the 13 invariants
    firing. The pipeline order is extensions-before-adapter; the
    transform's rigid motion preserves geometry."""
    bm = build_3bhk_pune_house()
    out, failed = _apply_via_orchestrator(bm, [ext_type])
    assert failed is None
    plan = AdaptationPlan(
        mirror_axis=axis,
        rotation=rotation,
        reasoning=f"adapter test for {ext_type.value}",
    )
    final = apply_adaptations(out, plan)
    # Construction passed → all 13 invariants hold.
    assert final is not None


# ─── 5. EXPLICIT NBC + PLOT REFUSAL ─────────────────────────────────


def test_servant_quarter_sub_nbc_bedroom_dims_refuses() -> None:
    """Force a sub-NBC bedroom: 2.0m wide × 2.0m deep = 4.0 sqm,
    below NBC 'bedroom' minimum 7.5 sqm."""
    bm = build_3bhk_pune_house()
    with pytest.raises(NBCViolationError) as exc:
        add_servant_quarter(bm, bedroom_width_m=2.0)
    assert exc.value.extension_type == "servant_quarter"
    assert "bedroom" in exc.value.reason.lower()


def test_mumty_too_wide_for_envelope_refuses() -> None:
    """Mumty wider than the building envelope x-range fails the
    envelope-fit guard."""
    bm = build_3bhk_pune_house()
    # 3BHK envelope is 8m wide; 20m mumty fails the fit check.
    with pytest.raises(PlotBoundaryViolationError) as exc:
        add_mumty(bm, mumty_width_m=20.0)
    assert exc.value.extension_type == "mumty"
