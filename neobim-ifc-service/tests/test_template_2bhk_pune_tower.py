"""Phase E2 + E3 — Tests for `build_2bhk_pune_tower`.

Validates:
  * G+5 — the default smoke (1 stilt + 5 habitable = 6 storeys).
  * G+11 — medium-rise (1 stilt + 11 = 12 storeys, top at 35.7 m).
  * G+23 — marquee scale (1 stilt + 23 = 24 storeys, top at 71.7 m).
  * Stilt-less variant.
  * Storey continuity at variable heights (2.7 m stilt + 3.0 m habitable).
  * Column extrusion at G+23 height (72.2 m) doesn't fail the resolver.
  * Determinism on G+5.
"""

from __future__ import annotations

import pytest

from app.domain.building_model import BuildingModel
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower


# ─── G+5 (smoke baseline) ────────────────────────────────────────


def test_tower_g5_builds_clean() -> None:
    """G+5 (1 stilt + 5 habitable = 6 storeys) builds invariant-clean."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    assert isinstance(bm, BuildingModel)
    assert len(bm.project.site.building.storeys) == 6


def test_tower_g5_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE completes for G+5."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    # Sanity: every column gets a placement + geometry.
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements and c.id in geometries


def test_tower_g5_storey_continuity() -> None:
    """STOREY_CONTINUITY holds with mixed stilt (2.7 m) + habitable (3.0 m)."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    expected = [(0, 0.0, 2.7), (1, 2.7, 3.0), (2, 5.7, 3.0),
                (3, 8.7, 3.0), (4, 11.7, 3.0), (5, 14.7, 3.0)]
    for s, (idx, elev, h) in zip(storeys, expected):
        assert s.index == idx
        assert s.elevation == elev
        assert s.actual_height == h


def test_tower_g5_element_density() -> None:
    """G+5 element counts (computed exactly).

    After Slice T2.0.3 (2-zone core refactor):
      * Walls=104 (was 128 in T2.0.1.2: dropped 4 cabin walls per storey
        × 6 storeys = -24).
      * Rooms=54 (was 60: dropped lift-cabin Room per storey × 6 = -6).
      * Doors=52 (unchanged: still 6 storeys × 2 core doors, but on
        ph-lobby-north now instead of ph-lobby-lift / ph-lift-stair).
      * Railings=15 (unchanged from T2.0.1.2).
    Architectural correctness > raw element count per the forward-only
    quality rule (correctness improvement is acceptable trade-off).
    """
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    walls = sum(len(s.walls) for s in bld.storeys)
    rooms = sum(len(s.rooms) for s in bld.storeys)
    slabs = sum(len(s.slabs) for s in bld.storeys)
    stairs = sum(len(s.stairs) for s in bld.storeys)
    railings = sum(1 for s in bld.storeys for w in s.walls if w.type == "railing")
    assert walls == 104, f"walls={walls}"
    assert rooms == 54, f"rooms={rooms}"
    assert slabs == 7, f"slabs={slabs}"
    assert stairs == 5, f"stairs={stairs}"
    assert railings == 15, f"railings={railings}"
    assert len(bld.structural_system.columns) == 16
    assert len(bld.structural_system.beams) == 126
    assert len(bld.foundation.footings) == 16
    assert len(bld.doors) == 52, f"doors={len(bld.doors)}"
    assert len(bld.windows) == 35


# ─── Slice T2.0.1 visual-bug regression tests ───────────────────


def test_tower_each_habitable_floor_has_balcony() -> None:
    """Every habitable floor in the tower has a balcony room with parapet
    walls (Slice T2.0.1 fix for visual bug 1)."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    habitable_storeys = [s for s in bld.storeys if any(
        "living-dining" in r.id for r in s.rooms
    )]
    assert len(habitable_storeys) == 5
    for s in habitable_storeys:
        balcony_rooms = [r for r in s.rooms if "balcony" in r.id]
        assert len(balcony_rooms) >= 1, f"storey {s.id} has no balcony room"
        # Confirm parapet walls exist on this storey: id ending in "-E-n"
        # or "-W-n" (the north-parapet split segments) or the FLAT's N
        # wall (which is parapet height when has_balcony=True).
        parapet_walls = [
            w for w in s.walls
            if w.id.endswith("-E-n") or w.id.endswith("-W-n")
            or w.id == f"wall-flat-{s.id.replace('storey-', '')}-N"
        ]
        assert len(parapet_walls) >= 3, (
            f"storey {s.id} expected ≥3 parapet walls (E-n + W-n + N), "
            f"got {len(parapet_walls)}: {[w.id for w in parapet_walls]}"
        )
        # Parapets are short (1.0 m), not full storey height.
        for w in parapet_walls:
            height = w.top_z - w.base_z
            assert height < 1.5, (
                f"parapet wall {w.id} has height {height} m; expected < 1.5 m"
            )


def test_tower_stairs_inside_core_footprint() -> None:
    """Slice T2.0.1 fix for visual bug 2: stair total_run must fit
    within the core's east-west inner width (~2.81 m), not extend
    outside the building. Pre-T2.0.1 used tread_depth=0.250 → run=4.25m
    which extended the stair past the building's east edge."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    plot_width = 7.32
    core_width = 3.0
    # Core inner width = core_width - half_int_wall - half_ext_wall.
    core_inner_width = core_width - 0.0675 - 0.125
    for s in bld.storeys:
        for st in s.stairs:
            total_run = st.riser_count * st.tread_depth
            assert total_run < core_inner_width, (
                f"stair {st.id}: total_run={total_run:.3f} m exceeds "
                f"core inner width {core_inner_width:.3f} m — would "
                f"render outside building footprint"
            )


def test_stair_builder_emits_3d_stepped_geometry() -> None:
    """Slice T2.0.1.1 — IfcStairFlight body has non-zero Z extent.

    Pre-fix the stair builder's IFC axis configuration extruded the
    stepped polyline along its OWN axis, collapsing the body to a flat
    z=[0,0] shape. The fix sets `Axis=(0,-1,0)` on the placement so
    local Y maps to world Z (vertical), and `ExtrudedDirection=(0,0,-1)`
    extrudes laterally for the stair width along world +Y. Result: a
    proper 3D stepped solid with z range = [0, total_rise].
    """
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from scripts.export_2bhk_pune_to_ifc import build_ifc_from_building_model

    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    model = build_ifc_from_building_model(bm)

    import ifcopenshell.geom
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    stair_flights = model.by_type("IfcStairFlight")
    assert len(stair_flights) >= 5
    for flight in stair_flights:
        shape = ifcopenshell.geom.create_shape(settings, flight)
        verts = shape.geometry.verts
        zs = verts[2::3]
        z_range = max(zs) - min(zs)
        # Each stair rises >= 2.5 m (stilt→hab1 rise 2.55 m or hab→hab 2.85 m).
        assert z_range > 2.0, (
            f"stair {flight.Name} has z_range={z_range:.3f} m — "
            f"geometry collapsed to flat shape; Phase 1 builder bug"
        )


def test_tower_g5_balconies_use_railings_not_walls() -> None:
    """Slice T2.0.1.2 — balcony N/E/W edges are `Wall(type="railing")`
    nodes (NOT solid walls). Modern Indian residential default;
    the IFC builder dispatches them to IfcRailing entities."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    # 5 habitable floors × 3 railings (E-n, N, W-n) = 15.
    assert len(railings) == 15, (
        f"expected 15 railings (3 per habitable storey × 5), "
        f"got {len(railings)}"
    )
    for r in railings:
        assert r.thickness == pytest.approx(0.050), (
            f"{r.id}: thickness={r.thickness} (expected 50 mm metal panel)"
        )
        assert r.layers and r.layers[0].material_name == "MS-Steel", (
            f"{r.id}: material is not MS-Steel"
        )
        assert r.is_external is True


def test_railing_renders_at_correct_height() -> None:
    """Slice T2.0.1.2 — IfcRailing in the exported IFC has
    extrusion_depth = 1.1 m (NBC India guard-rail standard for
    residential balconies)."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from scripts.export_2bhk_pune_to_ifc import build_ifc_from_building_model

    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    model = build_ifc_from_building_model(bm)

    # Slice P2.A adds HANDRAILs alongside stair flights; this test
    # remains scoped to GUARDRAILs (balcony parapets at 1.1m).
    guardrails = [r for r in model.by_type("IfcRailing")
                  if r.PredefinedType == "GUARDRAIL"]
    # 5 habitable floors × 3 railings = 15 IfcRailing GUARDRAILs.
    assert len(guardrails) == 15, (
        f"expected 15 IfcRailing GUARDRAILs (3 per habitable × 5), "
        f"got {len(guardrails)}"
    )
    for r in guardrails:
        depth = None
        for rep in r.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcExtrudedAreaSolid"):
                    depth = item.Depth
                    break
            if depth is not None:
                break
        assert depth is not None, f"{r.Name} has no IfcExtrudedAreaSolid"
        assert depth == pytest.approx(1.1), (
            f"{r.Name}: extrusion_depth={depth:.3f} m (expected 1.1 m)"
        )


def test_tower_each_lobby_has_stair_door() -> None:
    """Slice T2.0.3 — 2-zone core: every floor's lobby has BOTH a
    direct door to the stair AND a direct door to the lift. Both doors
    are on the same `ph-lobby-north` partition wall (different x
    positions). User picks stair or lift directly from the lobby — no
    "lift hall" intermediate band."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
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
        assert len(lobby_lift) == 1, (
            f"storey {s.id}: expected 1 lobby↔lift door, got {len(lobby_lift)}"
        )


def test_tower_lift_shaft_has_enclosing_walls() -> None:
    """Slice T2.0.3 — every storey has a lift Room bounded by 4 walls
    forming the shaft (south=ph-lobby-north, east=core-E, north=core-N,
    west=pv-stair-lift). The previous T2.0.1 separate `lift-cabin`
    inner Room + 4 cabin walls was DROPPED in T2.0.3 because the new
    2-zone layout makes the lift shaft itself a proper enclosed
    compartment (no need for an inner box)."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5)
    bld = bm.project.site.building
    for s in bld.storeys:
        s_idx_str = s.id.replace("storey-", "")
        lift_rooms = [
            r for r in s.rooms if r.id == f"room-core-{s_idx_str}-lift"
        ]
        assert len(lift_rooms) == 1, (
            f"storey {s.id} expected 1 lift Room, got {len(lift_rooms)}"
        )
        lift = lift_rooms[0]
        # Lift's 4 bounding edges (south/east/north/west of the shaft).
        assert len(lift.bounding_edges) == 4
        wall_ids = {e.wall_id for e in lift.bounding_edges}
        # Two of those walls are SHARED with neighbouring rooms
        # (ph-lobby-north, core-E, core-N), and the WEST edge is
        # `pv-stair-lift` — the dedicated stair/lift partition.
        assert f"wall-core-{s_idx_str}-pv-stair-lift" in wall_ids, (
            f"storey {s.id}: lift's west bound should be pv-stair-lift, "
            f"got walls {wall_ids}"
        )
        assert f"wall-core-{s_idx_str}-ph-lobby-north" in wall_ids
    # No more lift-cabin rooms in T2.0.3.
    cabin_rooms = [
        r for s in bld.storeys for r in s.rooms if "lift-cabin" in r.id
    ]
    assert len(cabin_rooms) == 0, (
        f"T2.0.3 dropped lift-cabin Room; expected 0 cabin rooms, "
        f"got {len(cabin_rooms)}"
    )


def test_tower_g5_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_2bhk_pune_tower(habitable_floor_count=5).model_dump_json(indent=2)
    b = build_2bhk_pune_tower(habitable_floor_count=5).model_dump_json(indent=2)
    assert a == b


# ─── No-stilt variant ────────────────────────────────────────────


def test_tower_no_stilt_variant() -> None:
    """`has_stilt_parking=False` removes storey 0; storey 0 IS habitable."""
    bm = build_2bhk_pune_tower(habitable_floor_count=5, has_stilt_parking=False)
    bld = bm.project.site.building
    assert len(bld.storeys) == 5  # no stilt
    # Storey 0 should be habitable (has flat rooms, not parking).
    s0 = bld.storeys[0]
    room_ids = {r.id for r in s0.rooms}
    assert any("living-dining" in rid for rid in room_ids), (
        "storey 0 should be a habitable flat, not stilt parking"
    )


# ─── G+11 (medium-rise scale check) ──────────────────────────────


def test_tower_g11_builds_clean() -> None:
    """G+11 (12 storeys total) builds and resolves."""
    bm = build_2bhk_pune_tower(habitable_floor_count=11)
    assert len(bm.project.site.building.storeys) == 12
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)


def test_tower_g11_top_elevation() -> None:
    """Top of G+11 building is at 2.7 + 11×3.0 = 35.7 m."""
    bm = build_2bhk_pune_tower(habitable_floor_count=11)
    top = bm.project.site.building.storeys[-1]
    assert top.elevation + top.actual_height == pytest.approx(35.7)


# ─── G+23 (marquee scale) ────────────────────────────────────────


def test_tower_g23_builds_clean() -> None:
    """G+23 (24 storeys total) builds and resolves."""
    bm = build_2bhk_pune_tower(habitable_floor_count=23)
    assert len(bm.project.site.building.storeys) == 24


def test_tower_g23_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE succeeds at G+23 — confirms Phase 1 builders
    handle ~1900 placements and 72 m column extrusion without overflow."""
    bm = build_2bhk_pune_tower(habitable_floor_count=23)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    assert len(placements) > 1500
    assert len(geometries) > 1500


def test_tower_g23_column_height() -> None:
    """G+23 columns span -0.5 m → 71.7 m (= 72.2 m total)."""
    bm = build_2bhk_pune_tower(habitable_floor_count=23)
    cols = bm.project.site.building.structural_system.columns
    for c in cols:
        assert c.base_z == -0.5
        assert c.top_z == pytest.approx(71.7)
    # geometry_resolver must produce extrusion_depth = 72.2 m.
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    sample = geometries[cols[0].id]
    assert sample.extrusion_depth == pytest.approx(72.2)


def test_tower_g23_storey_continuity() -> None:
    """All 24 G+23 storeys satisfy STOREY_CONTINUITY (validator passes)."""
    bm = build_2bhk_pune_tower(habitable_floor_count=23)
    storeys = sorted(bm.project.site.building.storeys, key=lambda s: s.index)
    for prev, nxt in zip(storeys, storeys[1:]):
        assert nxt.elevation == pytest.approx(prev.elevation + prev.actual_height)
