"""Slice 2B.3 Phase A.2 — servant_quarter extension tests."""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions._common import (
    ExtensionRequiresPlotError,
    PlotBoundaryViolationError,
    polygon_area,
)
from app.services.design_agent.extensions.servant_quarter import (
    DEFAULT_BATH_WIDTH_M,
    DEFAULT_BEDROOM_DEPTH_M,
    DEFAULT_BEDROOM_WIDTH_M,
    add_servant_quarter,
)
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_3bhk_pune import build_3bhk_pune_duplex
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower


# ─── Happy path on 3BHK House (3.0m rear setback) ───────────────────


def test_servant_quarter_adds_5_walls() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    new_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-sq-wall-")
    ]
    assert len(new_walls) == 5  # 4 outer + 1 partition


def test_servant_quarter_adds_2_rooms() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    new_rooms = [
        r
        for r in out.project.site.building.storeys[0].rooms
        if r.id.startswith("ext-sq-")
    ]
    assert len(new_rooms) == 2
    usages = {r.usage for r in new_rooms}
    assert usages == {"bedroom", "bathroom"}


def test_servant_bedroom_meets_NBC_minimum() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    bedroom = next(
        r
        for r in out.project.site.building.storeys[0].rooms
        if r.id.startswith("ext-sq-bedroom")
    )
    area = polygon_area(list(bedroom.footprint_polygon))
    assert area >= 9.5 - 0.001  # NBC bedroom min, Option (a)


def test_servant_bath_meets_NBC_bathroom_minimum() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    bath = next(
        r
        for r in out.project.site.building.storeys[0].rooms
        if r.id.startswith("ext-sq-bath")
    )
    area = polygon_area(list(bath.footprint_polygon))
    assert area >= 1.8 - 0.001  # NBC bathroom min


def test_servant_quarter_adds_2_doors() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    new_doors = [
        d for d in out.project.site.building.doors if d.id.startswith("ext-sq-")
    ]
    assert len(new_doors) == 2
    # One entry door (Outside + bedroom), one internal (bedroom + bath).
    entry = next(d for d in new_doors if "Outside" in d.connects_room_ids)
    assert entry.predefined_type == "DOOR"
    internal = next(d for d in new_doors if "Outside" not in d.connects_room_ids)
    assert len(internal.connects_room_ids) == 2


def test_servant_quarter_adds_2_windows() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    new_windows = [
        w for w in out.project.site.building.windows if w.id.startswith("ext-sq-")
    ]
    assert len(new_windows) == 2


def test_servant_quarter_adds_roof_slab() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    new_slabs = [
        s
        for s in out.project.site.building.storeys[0].slabs
        if s.id.startswith("ext-sq-roof")
    ]
    assert len(new_slabs) == 1
    assert new_slabs[0].predefined_type == "ROOF"


def test_servant_quarter_rear_aligned_at_3bhk_house() -> None:
    """For 3BHK plot 11×20, rear at y=0; servant 6.25 wide × 2.0 deep
    centered on x=5.5: x-range [2.375, 8.625], y-range [0, 2.0]."""
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    bedroom = next(
        r
        for r in out.project.site.building.storeys[0].rooms
        if r.id.startswith("ext-sq-bedroom")
    )
    fp = list(bedroom.footprint_polygon)
    ys = [v.y for v in fp]
    assert min(ys) == 0.0
    assert max(ys) == DEFAULT_BEDROOM_DEPTH_M


# ─── NBC + plot refusals ────────────────────────────────────────────


def test_servant_quarter_refuses_1bhk_house_shallow_rear() -> None:
    """1BHK rear setback 1.5m < 2.0m bedroom_depth + 1.0m clearance = 3.0m."""
    bm = build_1bhk_pune_house()
    with pytest.raises(PlotBoundaryViolationError) as exc:
        add_servant_quarter(bm)
    assert "rear setback" in exc.value.reason.lower() or "clearance" in exc.value.reason.lower()


def test_servant_quarter_refuses_2bhk_house_shallow_rear() -> None:
    """2BHK rear setback also 1.5m → refuse at default."""
    bm = build_2bhk_pune_house()
    with pytest.raises(PlotBoundaryViolationError):
        add_servant_quarter(bm)


def test_servant_quarter_works_on_3bhk_duplex() -> None:
    """3BHK Duplex shares the 3.0m rear setback with 3BHK House."""
    bm = build_3bhk_pune_duplex()
    out = add_servant_quarter(bm)
    new_rooms = [
        r
        for r in out.project.site.building.storeys[0].rooms
        if r.id.startswith("ext-sq-")
    ]
    assert len(new_rooms) == 2


def test_servant_quarter_refuses_excess_total_width() -> None:
    bm = build_3bhk_pune_house()
    with pytest.raises(PlotBoundaryViolationError):
        add_servant_quarter(bm, bedroom_width_m=12.0)  # > 11m plot


# ─── Tower refusal ──────────────────────────────────────────────────


def test_servant_quarter_refuses_towers() -> None:
    bm = build_3bhk_pune_tower()
    with pytest.raises(ExtensionRequiresPlotError):
        add_servant_quarter(bm)


# ─── Re-validation under 13 invariants ──────────────────────────────


def test_servant_quarter_re_validates_under_13_invariants() -> None:
    bm = build_3bhk_pune_house()
    out = add_servant_quarter(bm)
    assert out is not None
