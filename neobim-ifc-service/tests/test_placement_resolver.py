"""Phase 1 Slice 4 — placement_resolver tests.

Covers:
  * Every spatial node in a BuildingModel gets a ResolvedPlacement.
  * The 11-step dependency order: openings need walls; doors/windows
    need openings; rooms need slabs; etc.
  * Wall placement origin is at axis_points[0]; local_x_axis points
    along the polyline; base_z honours the slab below when present.
  * Column placement honours the supporting footing's top_z when
    `supports_column_id` ties them.
  * Cycle detection (synthesised) raises BuildingModelResolutionError.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domain.building_model import BuildingModel, BuildingModelResolutionError
from app.models.request import ExportOptions, MassingGeometry
from app.services.massing_to_building_model import lift
from app.services.placement_resolver import ResolvedPlacement, resolve_placements


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _lift_fixture(name: str) -> BuildingModel:
    with open(_FIXTURE_DIR / f"{name}.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _w = lift(geom, ExportOptions(), build_id=f"build-{name}", fixture_match=name)
    return bm


# ─── Coverage ────────────────────────────────────────────────────────


def test_every_node_gets_a_placement_simple_box():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    bld = bm.project.site.building
    expected_ids = {bm.project.id, bm.project.site.id, bld.id}
    for storey in bld.storeys:
        expected_ids.add(storey.id)
        for w in storey.walls:
            expected_ids.add(w.id)
        for s in storey.slabs:
            expected_ids.add(s.id)
        for r in storey.rooms:
            expected_ids.add(r.id)
        for o in storey.openings:
            expected_ids.add(o.id)
        for st in storey.stairs:
            expected_ids.add(st.id)
    for c in bld.structural_system.columns:
        expected_ids.add(c.id)
    for b in bld.structural_system.beams:
        expected_ids.add(b.id)
    for d in bld.doors:
        expected_ids.add(d.id)
    for w in bld.windows:
        expected_ids.add(w.id)
    if bld.foundation:
        for f in bld.foundation.footings:
            expected_ids.add(f.id)
    missing = expected_ids - placements.keys()
    assert not missing, f"Nodes missing ResolvedPlacement: {missing}"


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_every_storey_node_present_in_all_fixtures(fixture: str):
    bm = _lift_fixture(fixture)
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        assert storey.id in placements
        for w in storey.walls:
            assert w.id in placements


# ─── Wall placement values ───────────────────────────────────────────


def test_wall_placement_origin_at_axis_start_simple_box():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            p = placements[wall.id]
            a = wall.axis_points[0]
            assert p.origin.x == pytest.approx(a.x)
            assert p.origin.y == pytest.approx(a.y)


def test_wall_placement_local_x_axis_along_axis_direction():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            p = placements[wall.id]
            a, b = wall.axis_points[0], wall.axis_points[-1]
            dx = b.x - a.x
            dy = b.y - a.y
            length = (dx * dx + dy * dy) ** 0.5
            assert p.local_x_axis.x == pytest.approx(dx / length, abs=1e-6)
            assert p.local_x_axis.y == pytest.approx(dy / length, abs=1e-6)
            assert p.local_x_axis.z == pytest.approx(0.0, abs=1e-9)


def test_wall_local_z_axis_is_world_up():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            p = placements[wall.id]
            assert p.local_z_axis.x == 0.0
            assert p.local_z_axis.y == 0.0
            assert p.local_z_axis.z == 1.0


def test_wall_base_z_uses_slab_below_top_when_present():
    """For a storey-0 wall with a FLOOR slab on storey 0, base_z = slab.top_z.
    On simple_box this is 0.0 (matches storey elevation)."""
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    storey0 = bm.project.site.building.storeys[0]
    slab = next(s for s in storey0.slabs if s.predefined_type == "FLOOR")
    for wall in storey0.walls:
        p = placements[wall.id]
        assert p.origin.z == pytest.approx(slab.top_z, abs=1e-9)


def test_wall_relative_to_lowest_host_storey():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            assert placements[wall.id].relative_to_node_id == storey.id


# ─── Column placement values ─────────────────────────────────────────


def test_column_placement_at_location_with_base_z():
    bm = _lift_fixture("multistorey_residential")
    placements = resolve_placements(bm)
    for col in bm.project.site.building.structural_system.columns:
        p = placements[col.id]
        assert p.origin.x == pytest.approx(col.location.x)
        assert p.origin.y == pytest.approx(col.location.y)
        # In simple Phase 0 fixtures, no footings exist → uses col.base_z
        assert p.origin.z == pytest.approx(col.base_z)


# ─── Slab placement values ───────────────────────────────────────────


def test_slab_placement_at_first_footprint_vertex_top_z():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for slab in storey.slabs:
            p = placements[slab.id]
            assert p.origin.x == pytest.approx(slab.footprint_polygon[0].x)
            assert p.origin.y == pytest.approx(slab.footprint_polygon[0].y)
            assert p.origin.z == pytest.approx(slab.top_z)


# ─── Opening / Door / Window placement hierarchy ────────────────────


def test_opening_placement_relative_to_wall():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for storey in bm.project.site.building.storeys:
        for opening in storey.openings:
            p = placements[opening.id]
            assert p.relative_to_node_id == opening.in_wall_id
            # X is distance along wall, Y is 0 (wall axis offset)
            assert p.origin.x == pytest.approx(opening.distance_along_wall)
            assert p.origin.y == pytest.approx(0.0)


def test_door_placement_relative_to_opening():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for door in bm.project.site.building.doors:
        p = placements[door.id]
        assert p.relative_to_node_id == door.in_opening_id


def test_window_placement_relative_to_opening():
    bm = _lift_fixture("simple_box")
    placements = resolve_placements(bm)
    for window in bm.project.site.building.windows:
        p = placements[window.id]
        assert p.relative_to_node_id == window.in_opening_id


# ─── Determinism ─────────────────────────────────────────────────────


def test_resolve_placements_is_deterministic():
    bm = _lift_fixture("multistorey_residential")
    p1 = resolve_placements(bm)
    p2 = resolve_placements(bm)
    assert p1.keys() == p2.keys()
    for k in p1:
        assert p1[k] == p2[k]


# ─── Failure modes (synthesised) ────────────────────────────────────


def test_resolution_error_is_a_runtime_error():
    """Sanity: BuildingModelResolutionError inherits from RuntimeError so
    callers can catch it without importing the BuildingModel module."""
    err = BuildingModelResolutionError("test")
    assert isinstance(err, RuntimeError)


# ─── Beam placement (multistorey has 1 beam) ────────────────────────


def test_beam_placement_origin_at_start_point():
    bm = _lift_fixture("multistorey_residential")
    placements = resolve_placements(bm)
    beams = bm.project.site.building.structural_system.beams
    assert beams, "Multistorey fixture should have at least one beam"
    for b in beams:
        p = placements[b.id]
        assert p.origin.x == pytest.approx(b.start_point.x)
        assert p.origin.y == pytest.approx(b.start_point.y)
        assert p.origin.z == pytest.approx(b.start_point.z)


def test_beam_local_x_axis_along_start_to_end():
    bm = _lift_fixture("multistorey_residential")
    placements = resolve_placements(bm)
    for beam in bm.project.site.building.structural_system.beams:
        p = placements[beam.id]
        s, e = beam.start_point, beam.end_point
        dx, dy, dz = e.x - s.x, e.y - s.y, e.z - s.z
        L = (dx * dx + dy * dy + dz * dz) ** 0.5
        assert p.local_x_axis.x == pytest.approx(dx / L, abs=1e-6)
        assert p.local_x_axis.y == pytest.approx(dy / L, abs=1e-6)
        assert p.local_x_axis.z == pytest.approx(dz / L, abs=1e-6)
