"""Phase 1 Slice 4 — geometry_resolver tests.

Verifies ResolvedGeometry shape per node type:
    walls → SweptSolid rect(length × thickness) × (top − base) up
    slabs → SweptSolid polygon × thickness down
    columns → SweptSolid rect(profile dim) × (top − base) up
    rooms → SweptSolid polygon × ceiling_height
    beams → SweptSolid rect(profile) × axis_length along beam axis
    doors / windows → Parametric (no extrusion in resolver)
    MEP source/terminal → BoundingBox
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domain.building_model import BuildingModel
from app.models.request import ExportOptions, MassingGeometry
from app.services.geometry_resolver import resolve_geometries
from app.services.massing_to_building_model import lift
from app.services.placement_resolver import resolve_placements


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _lift_and_resolve(name: str):
    with open(_FIXTURE_DIR / f"{name}.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _ = lift(geom, ExportOptions(), build_id=f"b-{name}", fixture_match=name)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    return bm, placements, geometries


# ─── Walls ──────────────────────────────────────────────────────────


def test_wall_geometry_is_swept_solid_rectangle():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            g = geos[wall.id]
            assert g.representation_type == "SweptSolid"
            assert g.profile_type == "rectangle"
            assert g.profile_x_dim is not None and g.profile_x_dim > 0
            assert g.profile_y_dim is not None and g.profile_y_dim > 0
            assert g.extrusion_depth is not None and g.extrusion_depth > 0


def test_wall_profile_x_dim_equals_axis_length():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            a, b = wall.axis_points[0], wall.axis_points[-1]
            length = ((b.x - a.x) ** 2 + (b.y - a.y) ** 2) ** 0.5
            assert geos[wall.id].profile_x_dim == pytest.approx(length, abs=1e-6)


def test_wall_profile_y_dim_equals_thickness():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            assert geos[wall.id].profile_y_dim == pytest.approx(wall.thickness)


def test_wall_extrusion_direction_is_world_up():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            d = geos[wall.id].extrusion_direction
            assert d is not None
            assert (d.x, d.y, d.z) == (0.0, 0.0, 1.0)


# ─── Slabs ──────────────────────────────────────────────────────────


def test_slab_geometry_is_polygon_swept_down():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for slab in storey.slabs:
            g = geos[slab.id]
            assert g.representation_type == "SweptSolid"
            assert g.profile_type == "polygon"
            assert len(g.profile_polygon) >= 3
            assert g.extrusion_depth == pytest.approx(slab.top_z - slab.bottom_z)
            assert g.extrusion_direction is not None
            assert g.extrusion_direction.z == -1.0


# ─── Columns ────────────────────────────────────────────────────────


def test_column_geometry_uses_profile_dimensions():
    bm, _p, geos = _lift_and_resolve("multistorey_residential")
    for col in bm.project.site.building.structural_system.columns:
        g = geos[col.id]
        assert g.representation_type == "SweptSolid"
        assert g.profile_type in {"rectangle", "circle"}
        assert g.extrusion_depth is not None and g.extrusion_depth > 0


# ─── Rooms ──────────────────────────────────────────────────────────


def test_room_geometry_is_polygon_extruded_to_ceiling():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for storey in bm.project.site.building.storeys:
        for room in storey.rooms:
            g = geos[room.id]
            assert g.representation_type == "SweptSolid"
            assert g.profile_type == "polygon"
            assert g.extrusion_depth is not None and g.extrusion_depth > 0


# ─── Beams ──────────────────────────────────────────────────────────


def test_beam_geometry_extrusion_along_beam_axis():
    bm, _p, geos = _lift_and_resolve("multistorey_residential")
    for beam in bm.project.site.building.structural_system.beams:
        g = geos[beam.id]
        assert g.representation_type == "SweptSolid"
        assert g.profile_type == "rectangle"
        s, e = beam.start_point, beam.end_point
        L = ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 + (e.z - s.z) ** 2) ** 0.5
        assert g.extrusion_depth == pytest.approx(L, abs=1e-6)


# ─── Doors / Windows are parametric (no extrusion in resolver) ──────


def test_door_geometry_is_parametric():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for door in bm.project.site.building.doors:
        g = geos[door.id]
        assert g.representation_type == "Parametric"


def test_window_geometry_is_parametric():
    bm, _p, geos = _lift_and_resolve("simple_box")
    for window in bm.project.site.building.windows:
        g = geos[window.id]
        assert g.representation_type == "Parametric"


# ─── Openings ───────────────────────────────────────────────────────


def test_opening_geometry_rectangle_with_buffer():
    bm, _p, geos = _lift_and_resolve("simple_box")
    walls_by_id = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    for storey in bm.project.site.building.storeys:
        for opening in storey.openings:
            g = geos[opening.id]
            wall = walls_by_id[opening.in_wall_id]
            assert g.profile_x_dim == pytest.approx(opening.width)
            # YDim = wall.thickness + 1.0 buffer (so cut goes through wall fully)
            assert g.profile_y_dim == pytest.approx(wall.thickness + 1.0)
            assert g.extrusion_depth == pytest.approx(opening.height)


# ─── Coverage ──────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_geometry_resolved_for_every_wall_in_all_fixtures(fixture: str):
    bm, _p, geos = _lift_and_resolve(fixture)
    for storey in bm.project.site.building.storeys:
        for wall in storey.walls:
            assert wall.id in geos
            assert geos[wall.id].representation_type == "SweptSolid"


def test_resolve_geometries_is_deterministic():
    bm1, p1, g1 = _lift_and_resolve("multistorey_residential")
    bm2, p2, g2 = _lift_and_resolve("multistorey_residential")
    assert g1.keys() == g2.keys()
    for k in g1:
        assert g1[k] == g2[k]
