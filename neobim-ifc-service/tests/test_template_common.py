"""Phase T2.0 — Tests for Layer-2/Layer-3 composition types in `_common.py`.

Covers `FloorUnit` and `TowerCore` dataclasses (Slice T2.0 §2.1). These
types are the contract between the floor-unit builders (Layer 2) and the
building assemblers (Layer 3): a FloorUnit is one floor's worth of
geometry parameterized by elevation; a TowerCore is the shared vertical
circulation that gets stitched across multiple FloorUnits in a tower.

Tests deliberately stay narrow: each one exercises a single field /
constraint so a failure points at exactly the broken contract.
"""

from __future__ import annotations

import dataclasses

import pytest

from app.domain.building_model import Stair, Vec2
from app.templates._common import FloorUnit, TowerCore


def _square_polygon(side: float = 5.0) -> list[Vec2]:
    """4-vertex CCW square at the origin — minimal valid footprint polygon."""
    return [
        Vec2(x=0.0, y=0.0),
        Vec2(x=side, y=0.0),
        Vec2(x=side, y=side),
        Vec2(x=0.0, y=side),
    ]


def _minimal_floor_unit(**overrides) -> FloorUnit:
    """Build a minimal valid FloorUnit; tests override fields as needed."""
    defaults = dict(
        storey_id="s0",
        storey_index=0,
        elevation=0.0,
        floor_height=3.0,
        rooms=[],
        walls=[],
        slabs=[],
        openings=[],
        doors=[],
        windows=[],
        stairs=[],
        floor_footprint_polygon=_square_polygon(),
        column_grid_x=[0.5, 4.5],
        column_grid_y=[0.5, 4.5],
    )
    defaults.update(overrides)
    return FloorUnit(**defaults)


# ─── FloorUnit ──────────────────────────────────────────────────────


def test_floor_unit_constructs_with_minimal_fields() -> None:
    fu = _minimal_floor_unit()
    assert fu.storey_id == "s0"
    assert fu.storey_index == 0
    assert fu.elevation == 0.0
    assert fu.floor_height == 3.0
    assert fu.rooms == []
    assert fu.walls == []
    assert fu.slabs == []
    assert fu.openings == []
    assert fu.doors == []
    assert fu.windows == []
    assert fu.stairs == []
    assert len(fu.floor_footprint_polygon) == 4
    assert fu.column_grid_x == [0.5, 4.5]
    assert fu.column_grid_y == [0.5, 4.5]


def test_floor_unit_is_frozen() -> None:
    """`@dataclass(frozen=True)` blocks attribute reassignment."""
    fu = _minimal_floor_unit()
    with pytest.raises(dataclasses.FrozenInstanceError):
        fu.storey_id = "changed"
    with pytest.raises(dataclasses.FrozenInstanceError):
        fu.elevation = 100.0


def test_floor_unit_storey_index_must_be_non_negative() -> None:
    with pytest.raises(ValueError, match="storey_index"):
        _minimal_floor_unit(storey_index=-1)


def test_floor_unit_floor_height_must_be_positive() -> None:
    with pytest.raises(ValueError, match="floor_height"):
        _minimal_floor_unit(floor_height=0.0)
    with pytest.raises(ValueError, match="floor_height"):
        _minimal_floor_unit(floor_height=-3.0)


def test_floor_unit_footprint_polygon_must_have_three_vertices() -> None:
    """Polygon < 3 verts is degenerate and would later trip FOOTPRINT_VALID."""
    too_few = [Vec2(x=0, y=0), Vec2(x=1, y=0)]
    with pytest.raises(ValueError, match="floor_footprint_polygon"):
        _minimal_floor_unit(floor_footprint_polygon=too_few)


def test_floor_unit_carries_elevation_and_index_for_storey_assembly() -> None:
    """Layer-3 assemblers read elevation + storey_index to wire the Storey."""
    fu0 = _minimal_floor_unit(storey_id="s0", storey_index=0, elevation=0.0)
    fu1 = _minimal_floor_unit(storey_id="s1", storey_index=1, elevation=3.0)
    fu5 = _minimal_floor_unit(storey_id="s5", storey_index=5, elevation=15.0)
    assert fu0.elevation < fu1.elevation < fu5.elevation
    assert fu0.storey_index < fu1.storey_index < fu5.storey_index


# ─── TowerCore ──────────────────────────────────────────────────────


def _minimal_tower_core(**overrides) -> TowerCore:
    """Build a minimal valid TowerCore with no-op callables."""
    defaults = dict(
        core_walls_per_floor=lambda idx, sid, bz, tz: [],
        core_rooms_per_floor=lambda idx, sid: [],
        stair_per_floor=lambda idx, sid, bz, tz: None,
        core_footprint_polygon=_square_polygon(2.0),
        core_x_offset=0.0,
        core_y_offset=0.0,
    )
    defaults.update(overrides)
    return TowerCore(**defaults)


def test_tower_core_constructs_with_minimal_fields() -> None:
    tc = _minimal_tower_core(core_x_offset=7.32, core_y_offset=0.0)
    assert tc.core_x_offset == 7.32
    assert tc.core_y_offset == 0.0
    assert callable(tc.core_walls_per_floor)
    assert callable(tc.core_rooms_per_floor)
    assert callable(tc.stair_per_floor)


def test_tower_core_is_frozen() -> None:
    tc = _minimal_tower_core()
    with pytest.raises(dataclasses.FrozenInstanceError):
        tc.core_x_offset = 99.0


def test_tower_core_footprint_polygon_must_have_three_vertices() -> None:
    too_few = [Vec2(x=0, y=0), Vec2(x=2, y=0)]
    with pytest.raises(ValueError, match="core_footprint_polygon"):
        _minimal_tower_core(core_footprint_polygon=too_few)


def test_tower_core_callables_receive_per_floor_args() -> None:
    """Verify the callable signatures match the spec contract.

    Phase E1 widened core_walls_per_floor to (idx, storey_id, base_z, top_z)
    so the same TowerCore handles variable floor heights (e.g., 2.7 m
    stilt + 3.0 m habitable storeys).
    """
    captured: list[tuple] = []

    def walls(idx: int, sid: str, bz: float, tz: float) -> list:
        captured.append(("walls", idx, sid, bz, tz))
        return []

    def rooms(idx: int, sid: str) -> list:
        captured.append(("rooms", idx, sid))
        return []

    def stair(idx: int, sid: str, bz: float, tz: float):
        captured.append(("stair", idx, sid, bz, tz))
        return None

    tc = _minimal_tower_core(
        core_walls_per_floor=walls,
        core_rooms_per_floor=rooms,
        stair_per_floor=stair,
    )
    tc.core_walls_per_floor(2, "storey-2", 6.0, 8.85)
    tc.core_rooms_per_floor(2, "storey-2")
    tc.stair_per_floor(2, "storey-2", 6.0, 8.85)
    assert captured == [
        ("walls", 2, "storey-2", 6.0, 8.85),
        ("rooms", 2, "storey-2"),
        ("stair", 2, "storey-2", 6.0, 8.85),
    ]


# ─── Re-export sanity ────────────────────────────────────────────────


def test_dataclasses_are_in_common_dunder_all() -> None:
    """`FloorUnit` + `TowerCore` are part of the public surface of `_common`."""
    from app.templates import _common

    assert "FloorUnit" in _common.__all__
    assert "TowerCore" in _common.__all__
