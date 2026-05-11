"""Slice 2B.3 Phase A.3 — apply_extensions orchestrator tests.

Coverage:

  * No-op plan returns input unchanged (byte-identical path).
  * Canonical order applied (independent of plan order).
  * Dedup: duplicates by extension_type collapsed first-wins.
  * Single-extension success / failure paths.
  * Multi-extension stacking on 3BHK House (all 5 succeed).
  * Tower path: 4 fail with ExtensionRequiresPlot, mumty succeeds.
  * Total-failure path: input bm preserved, ship_as_is action.
  * Partial-failure path: skip_failed_extensions action.
  * Parameter override propagation (length_m → porch_depth_m etc.).
"""

from __future__ import annotations

import pytest

from app.services.design_agent.transforms_extensions import apply_extensions
from app.services.design_agent.types import (
    ExtensionAttachment,
    ExtensionPlan,
    ExtensionRequest,
    ExtensionType,
)
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower

REASON = "test orchestrator path (10 chars min)"


def _req(t: ExtensionType, **overrides) -> ExtensionRequest:
    return ExtensionRequest(extension_type=t, **overrides)


# ─── No-op + back-compat ────────────────────────────────────────────


def test_noop_plan_returns_input_unchanged() -> None:
    """Empty extensions list → orchestrator returns the input
    BuildingModel object identically. This is the byte-identical
    path that preserves the 2B.2 pipeline's behaviour."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(extensions=[], reasoning=REASON)
    assert plan.is_noop
    out, failed = apply_extensions(bm, plan)
    assert out is bm
    assert failed is None


# ─── Single extension ───────────────────────────────────────────────


def test_single_compound_wall_succeeds() -> None:
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[_req(ExtensionType.COMPOUND_WALL)],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    assert out is not bm
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound) == 4


def test_single_mumty_works_on_tower() -> None:
    """Mumty is the only extension that supports towers (per option (i))."""
    bm = build_3bhk_pune_tower()
    plan = ExtensionPlan(
        extensions=[_req(ExtensionType.MUMTY)],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    assert len(out.project.site.building.storeys) == len(
        bm.project.site.building.storeys
    ) + 1


# ─── Canonical order ───────────────────────────────────────────────


def test_canonical_order_independent_of_plan_order() -> None:
    """Plan with [mumty, compound_wall, entry_gate] applies them as
    compound_wall → entry_gate → mumty. We verify the gate's
    auto-add path doesn't fire (because compound_wall ran first
    and left ext-compound-N-* already present)."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.MUMTY),
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.ENTRY_GATE),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound) == 4, "compound_wall ran once (not auto-added a second time)"
    # Mumty added a storey.
    assert len(out.project.site.building.storeys) == 2


# ─── Dedup ─────────────────────────────────────────────────────────


def test_duplicate_extension_types_deduped_first_wins() -> None:
    """plan.extensions = [compound(h=1.8), compound(h=2.0)] applies
    only the first (h=1.8)."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL, height_m=1.8),
            _req(ExtensionType.COMPOUND_WALL, height_m=2.0),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound) == 4  # NOT 8 (no double-add)
    assert all(abs(w.top_z - 1.8) < 1e-9 for w in compound)


# ─── Multi-extension stacking ──────────────────────────────────────


def test_all_5_extensions_stack_on_3bhk_house() -> None:
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.ENTRY_GATE),
            _req(ExtensionType.CAR_PORCH),
            _req(ExtensionType.SERVANT_QUARTER),
            _req(ExtensionType.MUMTY),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    # 4 compound walls + 5 servant walls + 4 mumty walls + 10 existing = 23
    walls = sum(len(s.walls) for s in out.project.site.building.storeys)
    assert walls == 23
    # 2 storeys (mumty added one)
    assert len(out.project.site.building.storeys) == 2


# ─── Tower partial-failure ─────────────────────────────────────────


def test_tower_all_5_partial_failure_mumty_only_succeeds() -> None:
    """Tower: 4 extensions fail (ExtensionRequiresPlotError);
    mumty succeeds. Orchestrator returns partial success."""
    bm = build_3bhk_pune_tower()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.ENTRY_GATE),
            _req(ExtensionType.CAR_PORCH),
            _req(ExtensionType.SERVANT_QUARTER),
            _req(ExtensionType.MUMTY),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is not None
    assert failed.suggested_action == "skip_failed_extensions"
    assert set(failed.failed_extensions) == {
        ExtensionType.COMPOUND_WALL,
        ExtensionType.ENTRY_GATE,
        ExtensionType.CAR_PORCH,
        ExtensionType.SERVANT_QUARTER,
    }
    # Mumty succeeded → out has 1 extra storey.
    assert len(out.project.site.building.storeys) == len(
        bm.project.site.building.storeys
    ) + 1


# ─── Total failure ─────────────────────────────────────────────────


def test_tower_all_house_only_extensions_total_failure_reverts_bm() -> None:
    """Tower + plan of [compound, gate, porch, servant] = all 4 fail.
    Total-failure path: orchestrator reverts to input bm and emits
    ship_as_is."""
    bm = build_3bhk_pune_tower()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.ENTRY_GATE),
            _req(ExtensionType.CAR_PORCH),
            _req(ExtensionType.SERVANT_QUARTER),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is not None
    assert failed.suggested_action == "ship_as_is"
    assert out is bm  # input bm preserved
    assert len(failed.failed_extensions) == 4


# ─── Partial failure with one explicit refusal ─────────────────────


def test_partial_failure_keeps_succeeded_extension() -> None:
    """3BHK House + [compound, servant_quarter(bedroom_width=12)]:
    servant fails plot-width check, compound succeeds. Partial."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.SERVANT_QUARTER, width_m=12.0),  # > plot width
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is not None
    assert failed.suggested_action == "skip_failed_extensions"
    assert failed.failed_extensions == [ExtensionType.SERVANT_QUARTER]
    # Compound wall must have applied.
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound) == 4


# ─── Failure reason carries rule_id detail ─────────────────────────


def test_failure_reason_contains_extension_name() -> None:
    """The reason string includes the offending extension's name so
    a user-facing surfacing can pinpoint which one to revise."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[_req(ExtensionType.ENTRY_GATE, width_m=2.0)],  # < NBC min
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is not None
    assert "entry_gate" in failed.reason


# ─── Parameter override propagation ────────────────────────────────


def test_porch_depth_override_via_length_m() -> None:
    """ExtensionRequest.length_m maps to porch_depth_m for car_porch."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[_req(ExtensionType.CAR_PORCH, length_m=1.5)],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    porch_slab = next(
        s
        for s in out.project.site.building.storeys[0].slabs
        if s.id.startswith("ext-cp-roof")
    )
    fp = porch_slab.footprint_polygon
    ys = [v.y for v in fp]
    assert abs((max(ys) - min(ys)) - 1.5) < 1e-9  # porch depth = 1.5m


def test_compound_wall_height_override() -> None:
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[_req(ExtensionType.COMPOUND_WALL, height_m=1.5)],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    for w in compound:
        assert abs(w.top_z - 1.5) < 1e-9


# ─── ExtensionPlan schema contract ─────────────────────────────────


def test_extension_plan_rejects_short_reasoning() -> None:
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ExtensionPlan(extensions=[], reasoning="short")


def test_extension_plan_is_noop_property() -> None:
    plan = ExtensionPlan(extensions=[], reasoning=REASON)
    assert plan.is_noop is True
    plan2 = ExtensionPlan(
        extensions=[_req(ExtensionType.COMPOUND_WALL)], reasoning=REASON
    )
    assert plan2.is_noop is False


def test_extension_request_default_attachment_is_front() -> None:
    req = _req(ExtensionType.CAR_PORCH)
    assert req.attachment == ExtensionAttachment.FRONT


# ─── Re-apply (idempotency-style: orchestrator never double-applies) ─


def test_orchestrator_does_not_double_apply_via_entry_gate_auto_add() -> None:
    """When BOTH compound_wall AND entry_gate are in the plan, the
    orchestrator runs compound_wall first; entry_gate's auto-add
    logic detects the existing wall and skips re-adding. End result:
    4 compound walls (not 8)."""
    bm = build_3bhk_pune_house()
    plan = ExtensionPlan(
        extensions=[
            _req(ExtensionType.COMPOUND_WALL),
            _req(ExtensionType.ENTRY_GATE),
        ],
        reasoning=REASON,
    )
    out, failed = apply_extensions(bm, plan)
    assert failed is None
    compound = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound) == 4
