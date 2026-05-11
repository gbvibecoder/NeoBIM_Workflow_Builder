"""Slice 2B.3 Phase A.2 — car_porch extension tests."""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions._common import (
    ExtensionRequiresPlotError,
    PlotBoundaryViolationError,
)
from app.services.design_agent.extensions.car_porch import (
    DEFAULT_PORCH_DEPTH_M,
    DEFAULT_PORCH_HEIGHT_M,
    DEFAULT_PORCH_WIDTH_M,
    add_car_porch,
)
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_3bhk_pune import build_3bhk_pune_duplex
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower


# ─── Happy path on 3BHK House (4.5m front setback) ──────────────────


def test_car_porch_adds_4_columns_and_1_slab() -> None:
    bm = build_3bhk_pune_house()
    out = add_car_porch(bm)
    new_columns = [
        c
        for c in out.project.site.building.structural_system.columns
        if c.id.startswith("ext-cp-col-")
    ]
    new_slabs = [
        s
        for s in out.project.site.building.storeys[0].slabs
        if s.id.startswith("ext-cp-roof")
    ]
    assert len(new_columns) == 4
    assert len(new_slabs) == 1


def test_car_porch_columns_at_corners_of_porch_rect() -> None:
    """For 3BHK plot 11×20, default 6×3m porch centered on x=5.5,
    flush with north edge: corners at (2.5, 17), (8.5, 17), (8.5, 20), (2.5, 20)."""
    bm = build_3bhk_pune_house()
    out = add_car_porch(bm)
    cols = sorted(
        (
            c
            for c in out.project.site.building.structural_system.columns
            if c.id.startswith("ext-cp-col-")
        ),
        key=lambda c: (c.location.y, c.location.x),
    )
    cs = 0.230
    # Inset by cs/2 from each porch corner.
    expected = [
        (2.5 + cs / 2, 17.0 + cs / 2),  # SW
        (8.5 - cs / 2, 17.0 + cs / 2),  # SE
        (2.5 + cs / 2, 20.0 - cs / 2),  # NW
        (8.5 - cs / 2, 20.0 - cs / 2),  # NE
    ]
    actual = [(round(c.location.x, 4), round(c.location.y, 4)) for c in cols]
    assert sorted(actual) == sorted(
        [(round(e[0], 4), round(e[1], 4)) for e in expected]
    )


def test_car_porch_slab_at_correct_z() -> None:
    bm = build_3bhk_pune_house()
    out = add_car_porch(bm)
    slab = next(
        s
        for s in out.project.site.building.storeys[0].slabs
        if s.id.startswith("ext-cp-roof")
    )
    assert slab.predefined_type == "ROOF"
    assert abs(slab.bottom_z - DEFAULT_PORCH_HEIGHT_M) < 1e-9
    assert abs(slab.top_z - (DEFAULT_PORCH_HEIGHT_M + 0.150)) < 1e-9


def test_car_porch_columns_height_matches_porch_height() -> None:
    bm = build_3bhk_pune_house()
    out = add_car_porch(bm)
    cols = [
        c
        for c in out.project.site.building.structural_system.columns
        if c.id.startswith("ext-cp-col-")
    ]
    for c in cols:
        assert c.base_z == 0.0
        assert abs(c.top_z - DEFAULT_PORCH_HEIGHT_M) < 1e-9
        assert c.is_load_bearing
        assert c.material == "RCC-M25"


def test_car_porch_no_room_added() -> None:
    """Open structure: no IfcSpace. Verifies the architectural-correctness
    decision (ROOM_BOUNDED requires walls)."""
    bm = build_3bhk_pune_house()
    before_rooms = len(bm.project.site.building.storeys[0].rooms)
    out = add_car_porch(bm)
    after_rooms = len(out.project.site.building.storeys[0].rooms)
    assert after_rooms == before_rooms


# ─── Per-template matrix ────────────────────────────────────────────


def test_car_porch_works_on_3bhk_duplex() -> None:
    """Both 3BHK family templates have 4.5m front setback → default porch fits."""
    bm = build_3bhk_pune_duplex()
    out = add_car_porch(bm)
    assert len([
        c
        for c in out.project.site.building.structural_system.columns
        if c.id.startswith("ext-cp-col-")
    ]) == 4


# ─── NBC clearance refusal ──────────────────────────────────────────


def test_car_porch_refuses_when_front_setback_too_shallow() -> None:
    """1BHK Pune House has 2.5m front setback. Default 3.0m porch +
    1.5m clearance needs 4.5m → refusal."""
    bm = build_1bhk_pune_house()
    with pytest.raises(PlotBoundaryViolationError) as exc:
        add_car_porch(bm)
    assert exc.value.extension_type == "car_porch"
    assert "clearance" in exc.value.reason.lower()


def test_car_porch_with_smaller_depth_fits_2bhk_house() -> None:
    """2BHK House has 2.5m front setback. With porch_depth_m=1.0 (≤
    2.5 - 1.5 = 1.0), should fit."""
    bm = build_2bhk_pune_house()
    out = add_car_porch(bm, porch_depth_m=1.0)
    new_slabs = [
        s
        for s in out.project.site.building.storeys[0].slabs
        if s.id.startswith("ext-cp-roof")
    ]
    assert len(new_slabs) == 1


def test_car_porch_refuses_excess_porch_width() -> None:
    """A porch wider than the plot itself fails the x-fit guard."""
    bm = build_3bhk_pune_house()
    with pytest.raises(PlotBoundaryViolationError) as exc:
        add_car_porch(bm, porch_width_m=15.0)  # > 11m plot
    assert "plot width" in exc.value.reason.lower()


# ─── Tower refusal ──────────────────────────────────────────────────


def test_car_porch_refuses_towers() -> None:
    bm = build_3bhk_pune_tower()
    with pytest.raises(ExtensionRequiresPlotError):
        add_car_porch(bm)


# ─── Re-validation under 13 invariants ──────────────────────────────


def test_car_porch_re_validates_under_13_invariants() -> None:
    bm = build_3bhk_pune_house()
    out = add_car_porch(bm)
    assert out is not None
