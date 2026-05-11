"""Slice 2B.3 Phase A.2 — entry_gate extension tests."""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions._common import (
    ExtensionRequiresPlotError,
    NBCViolationError,
    PlotBoundaryViolationError,
)
from app.services.design_agent.extensions.compound_wall import add_compound_wall
from app.services.design_agent.extensions.entry_gate import (
    DEFAULT_GATE_HEIGHT_M,
    DEFAULT_GATE_WIDTH_M,
    NBC_MIN_GATE_WIDTH_M,
    add_entry_gate,
)
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower


# ─── Auto-add path: gate without prior compound wall ─────────────────


def test_entry_gate_auto_adds_compound_wall() -> None:
    """When a user requests entry_gate without first calling
    compound_wall, the gate function must add the wall itself."""
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    walls = out.project.site.building.storeys[0].walls
    compound_walls = [w for w in walls if w.id.startswith("ext-compound-")]
    assert len(compound_walls) == 4, "auto-add should create the 4 perimeter walls"


def test_entry_gate_with_existing_compound_wall_does_not_double_add() -> None:
    """When compound_wall is already present (e.g., orchestrator ran it
    first), entry_gate must NOT add a second set of compound walls."""
    bm = add_compound_wall(build_3bhk_pune_house())
    out = add_entry_gate(bm)
    compound_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(compound_walls) == 4, "should still be 4 walls (no duplication)"


# ─── Gate components ────────────────────────────────────────────────


def test_entry_gate_adds_one_opening_one_door_two_piers() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    new_openings = [
        o
        for o in out.project.site.building.storeys[0].openings
        if o.id.startswith("ext-eg-opening")
    ]
    new_doors = [
        d
        for d in out.project.site.building.doors
        if d.id.startswith("ext-eg-gate")
    ]
    new_piers = [
        c
        for c in out.project.site.building.structural_system.columns
        if c.id.startswith("ext-eg-pier-")
    ]
    assert len(new_openings) == 1
    assert len(new_doors) == 1
    assert len(new_piers) == 2


def test_entry_gate_door_has_predefined_type_GATE() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    gate_door = next(
        d for d in out.project.site.building.doors if d.id.startswith("ext-eg-gate")
    )
    assert gate_door.predefined_type == "GATE"
    assert gate_door.swing == "sliding"
    assert gate_door.connects_room_ids == ["Outside"]


def test_entry_gate_opening_predefined_type_is_DOOR() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    opening = next(
        o
        for o in out.project.site.building.storeys[0].openings
        if o.id.startswith("ext-eg-opening")
    )
    assert opening.predefined_type == "DOOR"


def test_entry_gate_opening_in_north_compound_wall() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    opening = next(
        o
        for o in out.project.site.building.storeys[0].openings
        if o.id.startswith("ext-eg-opening")
    )
    assert opening.in_wall_id.startswith("ext-compound-N-")


def test_entry_gate_opening_dimensions_match_defaults() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    opening = next(
        o
        for o in out.project.site.building.storeys[0].openings
        if o.id.startswith("ext-eg-opening")
    )
    assert abs(opening.width - DEFAULT_GATE_WIDTH_M) < 1e-9
    assert abs(opening.height - DEFAULT_GATE_HEIGHT_M) < 1e-9
    assert opening.sill_z == 0.0


def test_entry_gate_piers_centered_around_gate() -> None:
    """For 3BHK House plot 11×20m, gate centered on north (y=20)
    means piers at gate edges. Default 3.0m gate centered → piers at
    x=4.0 and x=7.0 (gate spans x∈[4,7] of an 11m wall)."""
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    piers = sorted(
        (
            c
            for c in out.project.site.building.structural_system.columns
            if c.id.startswith("ext-eg-pier-")
        ),
        key=lambda c: c.location.x,
    )
    assert len(piers) == 2
    # One pier at x=4, one at x=7 (3m apart, centered on x=5.5).
    assert abs(piers[0].location.x - 4.0) < 1e-9
    assert abs(piers[1].location.x - 7.0) < 1e-9
    # Both on the north plot line (y=20).
    assert abs(piers[0].location.y - 20.0) < 1e-9
    assert abs(piers[1].location.y - 20.0) < 1e-9


def test_entry_gate_pier_dimensions_300x300mm() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    piers = [
        c
        for c in out.project.site.building.structural_system.columns
        if c.id.startswith("ext-eg-pier-")
    ]
    for p in piers:
        assert p.profile.profile_type == "rectangle"
        assert p.profile.dimensions["width"] == 0.3
        assert p.profile.dimensions["height"] == 0.3
        assert p.material == "Burnt-Clay-Brick-230mm"
        assert not p.is_load_bearing


# ─── NBC + plot refusals ────────────────────────────────────────────


def test_entry_gate_refuses_below_nbc_minimum_width() -> None:
    bm = build_3bhk_pune_house()
    with pytest.raises(NBCViolationError) as exc:
        add_entry_gate(bm, gate_width_m=2.0)
    assert exc.value.extension_type == "entry_gate"
    assert "2.7" in exc.value.reason  # NBC minimum mentioned


def test_entry_gate_refuses_at_nbc_minus_epsilon() -> None:
    bm = build_3bhk_pune_house()
    with pytest.raises(NBCViolationError):
        add_entry_gate(bm, gate_width_m=NBC_MIN_GATE_WIDTH_M - 0.01)


def test_entry_gate_accepts_at_nbc_minimum() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm, gate_width_m=NBC_MIN_GATE_WIDTH_M)
    opening = next(
        o
        for o in out.project.site.building.storeys[0].openings
        if o.id.startswith("ext-eg-opening")
    )
    assert abs(opening.width - NBC_MIN_GATE_WIDTH_M) < 1e-9


def test_entry_gate_refuses_towers() -> None:
    bm = build_3bhk_pune_tower()
    with pytest.raises(ExtensionRequiresPlotError):
        add_entry_gate(bm)


# ─── Re-validation under 13 invariants ──────────────────────────────


def test_entry_gate_re_validates_under_13_invariants() -> None:
    bm = build_3bhk_pune_house()
    out = add_entry_gate(bm)
    assert out is not None  # construction succeeded
