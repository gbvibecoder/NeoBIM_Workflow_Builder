"""Slice 2B.3 Phase A.2 — mumty extension tests.

The most complex extension: adds a new storey, modifies an existing
roof slab, places a stair through the slab opening. The ONLY
extension that supports tower templates (per option (i)).
"""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions.mumty import (
    DEFAULT_MUMTY_DEPTH_M,
    DEFAULT_MUMTY_WIDTH_M,
    DEFAULT_STOREY_HEIGHT_M,
    add_mumty,
)
from app.templates.tier2_1bhk_pune import build_1bhk_pune_duplex
from app.templates.tier2_1bhk_pune_tower import build_1bhk_pune_tower
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower


# ─── Happy path on 3BHK House (single-storey) ───────────────────────


def test_mumty_adds_new_storey() -> None:
    bm = build_3bhk_pune_house()
    before_storeys = len(bm.project.site.building.storeys)
    out = add_mumty(bm)
    after_storeys = len(out.project.site.building.storeys)
    assert after_storeys - before_storeys == 1
    new_storey = max(out.project.site.building.storeys, key=lambda s: s.index)
    assert new_storey.id.startswith("ext-mu-storey")
    assert abs(new_storey.actual_height - DEFAULT_STOREY_HEIGHT_M) < 1e-9


def test_mumty_adds_4_walls_on_new_storey() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    new_storey = max(out.project.site.building.storeys, key=lambda s: s.index)
    mumty_walls = [w for w in new_storey.walls if w.id.startswith("ext-mu-wall-")]
    assert len(mumty_walls) == 4


def test_mumty_adds_floor_and_roof_slabs() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    new_storey = max(out.project.site.building.storeys, key=lambda s: s.index)
    floor_slab = [
        s
        for s in new_storey.slabs
        if s.predefined_type == "FLOOR" and s.id.startswith("ext-mu-floor")
    ]
    roof_slab = [
        s
        for s in new_storey.slabs
        if s.predefined_type == "ROOF" and s.id.startswith("ext-mu-roof")
    ]
    assert len(floor_slab) == 1
    assert len(roof_slab) == 1


def test_mumty_room_is_stairs_landing() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    new_storey = max(out.project.site.building.storeys, key=lambda s: s.index)
    mumty_rooms = [r for r in new_storey.rooms if r.id.startswith("ext-mu-room")]
    assert len(mumty_rooms) == 1
    assert mumty_rooms[0].usage == "stairs_landing"


def test_mumty_door_added_to_building() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    mumty_doors = [
        d for d in out.project.site.building.doors if d.id.startswith("ext-mu-door")
    ]
    assert len(mumty_doors) == 1
    assert mumty_doors[0].connects_room_ids[0] == "Outside"


def test_mumty_stair_added_to_top_storey() -> None:
    bm = build_3bhk_pune_house()
    top_id = bm.project.site.building.storeys[0].id  # single-storey
    out = add_mumty(bm)
    stairs = [
        st
        for storey in out.project.site.building.storeys
        for st in storey.stairs
        if st.id.startswith("ext-mu-stair")
    ]
    assert len(stairs) == 1
    assert stairs[0].host_storey_id == top_id


def test_mumty_cuts_opening_in_roof_slab() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    # Top storey is the original storey-ground; its roof slab now has
    # an opening polygon.
    top_storey = next(
        s for s in out.project.site.building.storeys if s.index == 0
    )
    roof = next(s for s in top_storey.slabs if s.predefined_type == "ROOF")
    assert len(roof.openings_polygons) == 1
    # Opening polygon vertex count = stair plan polygon vertex count = 4.
    assert len(roof.openings_polygons[0]) == 4


# ─── STAIR_RISE_MATCHES contract ────────────────────────────────────


def test_mumty_stair_rise_matches_floor_to_floor() -> None:
    """rise = mumty_floor_slab.bottom_z - top_floor_slab.top_z. For
    3BHK House: mumty_floor.bottom_z = 3.0, top_floor.top_z = 0 → rise = 3.0m.
    16 risers × 0.1875 = 3.0 ✓."""
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    stair = next(
        st
        for storey in out.project.site.building.storeys
        for st in storey.stairs
        if st.id.startswith("ext-mu-stair")
    )
    assert stair.riser_count == 16
    rise_total = stair.riser_count * stair.riser_height
    assert abs(rise_total - 3.0) < 1e-3  # storey-ground 3.0m floor-to-floor


# ─── Tower support (option (i) — mumty is the only tower extension) ─


def test_mumty_works_on_3bhk_tower() -> None:
    """Towers have empty plot_polygon, but mumty doesn't need it.
    Verifies the option (i) decision: tower extensions = mumty only."""
    bm = build_3bhk_pune_tower()
    out = add_mumty(bm)
    new_storey = max(out.project.site.building.storeys, key=lambda s: s.index)
    assert new_storey.id.startswith("ext-mu-storey")


def test_mumty_works_on_1bhk_tower() -> None:
    bm = build_1bhk_pune_tower()
    out = add_mumty(bm)
    assert out is not None


def test_mumty_works_on_2bhk_tower() -> None:
    bm = build_2bhk_pune_tower()
    out = add_mumty(bm)
    assert out is not None


# ─── Multi-storey templates (duplexes) ──────────────────────────────


def test_mumty_works_on_1bhk_duplex_above_first_floor() -> None:
    """Duplex has 2 storeys; mumty lands at index=2."""
    bm = build_1bhk_pune_duplex()
    top_index_before = max(s.index for s in bm.project.site.building.storeys)
    out = add_mumty(bm)
    top_index_after = max(s.index for s in out.project.site.building.storeys)
    assert top_index_after == top_index_before + 1


# ─── Re-validation under 13 invariants ──────────────────────────────


def test_mumty_re_validates_under_13_invariants() -> None:
    bm = build_3bhk_pune_house()
    out = add_mumty(bm)
    assert out is not None  # construction passed all 13 invariants
