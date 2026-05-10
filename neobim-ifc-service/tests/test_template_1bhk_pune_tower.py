"""Phase T2.1 Phase E — Tests for `build_1bhk_pune_tower`.

Validates:
  * G+5 — the default smoke (1 stilt + 5 habitable = 6 storeys).
  * G+11 — medium-rise (1 stilt + 11 = 12 storeys, top at 35.7 m).
  * Stilt-less variant.
  * Storey continuity at variable heights (2.7 m stilt + 3.0 m habitable).
  * Determinism on G+5.
  * Each habitable floor has a balcony with railings.
  * 2-zone core layout: every lobby has both a stair-door and a lift-door.
"""

from __future__ import annotations

import pytest

from app.domain.building_model import BuildingModel
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates.tier2_1bhk_pune_tower import build_1bhk_pune_tower


# ─── G+5 (smoke baseline) ────────────────────────────────────────


def test_1bhk_tower_g5_builds_clean() -> None:
    """G+5 (1 stilt + 5 habitable = 6 storeys) builds invariant-clean."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    assert isinstance(bm, BuildingModel)
    assert len(bm.project.site.building.storeys) == 6
    assert bm.project.site.building.name == "1BHK Pune Tower G+5"


def test_1bhk_tower_g5_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE completes for G+5."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements and c.id in geometries


def test_1bhk_tower_g5_storey_continuity() -> None:
    """STOREY_CONTINUITY holds with mixed stilt (2.7m) + habitable (3.0m)."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    expected = [
        (0, 0.0, 2.7),
        (1, 2.7, 3.0),
        (2, 5.7, 3.0),
        (3, 8.7, 3.0),
        (4, 11.7, 3.0),
        (5, 14.7, 3.0),
    ]
    for s, (idx, elev, h) in zip(storeys, expected):
        assert s.index == idx
        assert s.elevation == pytest.approx(elev)
        assert s.actual_height == pytest.approx(h)


def test_1bhk_tower_g5_column_count() -> None:
    """G+5 has 13 columns (9 flat + 4 core)."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    cols = bm.project.site.building.structural_system.columns
    assert len(cols) == 13
    for c in cols:
        # All 1BHK columns are 230×230 mm — including the core.
        assert c.profile.dimensions["width"] == 0.230
        assert c.profile.dimensions["depth"] == 0.230


def test_1bhk_tower_g5_each_habitable_has_balcony() -> None:
    """Every habitable floor has a balcony Room with 3 railings (E-n + N + W-n)."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    habitable_storeys = [
        s for s in bld.storeys
        if any("living-dining" in r.id for r in s.rooms)
    ]
    assert len(habitable_storeys) == 5
    for s in habitable_storeys:
        balcony_rooms = [r for r in s.rooms if "balcony" in r.id]
        assert len(balcony_rooms) == 1
        railings = [w for w in s.walls if w.type == "railing"]
        assert len(railings) == 3, (
            f"storey {s.id}: expected 3 railings, got {len(railings)}"
        )


def test_1bhk_tower_g5_railings_are_ms_steel_at_1100mm() -> None:
    """All railings are 50mm MS-Steel at 1.1m height."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    # 5 habitable floors × 3 railings = 15.
    assert len(railings) == 15
    for r in railings:
        assert r.thickness == pytest.approx(0.050)
        assert r.layers and r.layers[0].material_name == "MS-Steel"
        height = r.top_z - r.base_z
        assert height == pytest.approx(1.1)


def test_1bhk_tower_each_lobby_has_stair_and_lift_door() -> None:
    """2-zone core: every floor's lobby has both a stair-door and a
    lift-door on `ph-lobby-north` (different x positions). Same
    contract as 2BHK tower from T2.0.3."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    core_doors = [d for d in bld.doors if d.id.startswith("door-core-")]
    assert len(core_doors) == 12, (
        f"expected 12 core doors (2 per storey × 6), got {len(core_doors)}"
    )
    for s in bld.storeys:
        s_idx_str = s.id.replace("storey-", "")
        lobby_id = f"room-core-{s_idx_str}-lobby"
        lift_id = f"room-core-{s_idx_str}-lift"
        stair_id = f"room-core-{s_idx_str}-stair"
        lobby_stair = [
            d for d in core_doors
            if set(d.connects_room_ids) == {lobby_id, stair_id}
        ]
        lobby_lift = [
            d for d in core_doors
            if set(d.connects_room_ids) == {lobby_id, lift_id}
        ]
        assert len(lobby_stair) == 1, (
            f"storey {s.id}: expected 1 lobby↔stair door, got {len(lobby_stair)}"
        )
        assert len(lobby_lift) == 1


def test_1bhk_tower_main_entry_routes_to_lobby() -> None:
    """Each habitable floor's main-entry door connects living-dining to
    the core's lobby (sentinel substituted by the assembler)."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    main_entries = [
        d for d in bld.doors
        if "main-entry" in d.id and d.id.startswith("door-flat-")
    ]
    assert len(main_entries) == 5  # one per habitable storey
    for d in main_entries:
        # Storey index e.g. "door-flat-s1-main-entry" → s1 → lobby s1.
        s_idx_str = d.id.split("-")[2]  # "s1"
        lobby_id = f"room-core-{s_idx_str}-lobby"
        assert lobby_id in d.connects_room_ids, (
            f"{d.id}: expected lobby {lobby_id}, got {d.connects_room_ids}"
        )


def test_1bhk_tower_g5_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_1bhk_pune_tower(habitable_floor_count=5).model_dump_json(indent=2)
    b = build_1bhk_pune_tower(habitable_floor_count=5).model_dump_json(indent=2)
    assert a == b


# ─── No-stilt variant ────────────────────────────────────────────


def test_1bhk_tower_no_stilt_variant() -> None:
    """`has_stilt_parking=False` removes storey 0; storey 0 IS habitable."""
    bm = build_1bhk_pune_tower(habitable_floor_count=5, has_stilt_parking=False)
    bld = bm.project.site.building
    assert len(bld.storeys) == 5
    s0 = bld.storeys[0]
    room_ids = {r.id for r in s0.rooms}
    assert any("living-dining" in rid for rid in room_ids), (
        "storey 0 should be a habitable flat, not stilt parking"
    )


# ─── G+11 ─────────────────────────────────────────────────────────


def test_1bhk_tower_g11_builds_clean() -> None:
    """G+11 (12 storeys) builds and resolves."""
    bm = build_1bhk_pune_tower(habitable_floor_count=11)
    assert len(bm.project.site.building.storeys) == 12
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)


def test_1bhk_tower_g11_top_elevation() -> None:
    """Top of G+11 building is at 2.7 + 11 × 3.0 = 35.7 m."""
    bm = build_1bhk_pune_tower(habitable_floor_count=11)
    top = bm.project.site.building.storeys[-1]
    assert top.elevation + top.actual_height == pytest.approx(35.7)


def test_1bhk_tower_g11_railings_count() -> None:
    """G+11 has 11 habitable × 3 railings = 33 railings."""
    bm = build_1bhk_pune_tower(habitable_floor_count=11)
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    assert len(railings) == 33


# ─── Validation ──────────────────────────────────────────────────


def test_1bhk_tower_rejects_zero_floors() -> None:
    """habitable_floor_count < 1 raises ValueError."""
    with pytest.raises(ValueError, match="habitable_floor_count"):
        build_1bhk_pune_tower(habitable_floor_count=0)


def test_1bhk_tower_rejects_multi_flats_per_floor() -> None:
    """flats_per_floor != 1 raises NotImplementedError (v2 territory)."""
    with pytest.raises(NotImplementedError, match="flats_per_floor"):
        build_1bhk_pune_tower(flats_per_floor=2)
