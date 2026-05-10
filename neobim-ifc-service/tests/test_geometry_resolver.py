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


# ─── Slice T2.0.1.1 — short walls (parapet / half-wall / counter / railing) ─


def test_geometry_resolver_respects_short_walls():
    """Slice T2.0.1.1 — when wall.top_z is BELOW the slab above (a parapet,
    half-wall, counter, or railing), the resolved geometry must keep the
    wall's declared height. Pre-fix the resolver unconditionally
    overrode top_z with slab_above.bottom_z, stretching parapets to
    full ceiling height."""
    from app.domain.building_model import (
        Building, BuildingModel, Foundation, Project, ProjectMetadata,
        Provenance, ReraData, Roof, Site, Slab, Storey, StructuralSystem,
    )
    from app.templates._common import (
        make_external_wall, make_isolated_pad_footing, make_rcc_column,
        make_rectangular_polygon_ccw, make_slab_layers,
    )
    from app.domain.building_model import Vec2

    # Two-storey building with a 1.0 m parapet on the south wall of the
    # ground floor (deliberately shorter than the slab above at z=2.85).
    rect = make_rectangular_polygon_ccw(0.0, 5.0, 0.0, 5.0)
    storey0 = Storey(
        id="s0", name="GF", elevation=0.0, actual_height=3.0, index=0,
        rooms=[], walls=[
            make_external_wall(
                wall_id="wall-parapet", name="Parapet South",
                host_storey_id="s0",
                start=Vec2(x=0, y=0), end=Vec2(x=5, y=0),
                base_z=0.0, top_z=1.0,  # 1m parapet, NOT 2.85m
            ),
            make_external_wall(
                wall_id="wall-fullheight", name="Full N",
                host_storey_id="s0",
                start=Vec2(x=5, y=5), end=Vec2(x=0, y=5),
                base_z=0.0, top_z=2.85,  # full height, matches slab above
            ),
        ],
        slabs=[Slab(
            id="slab-s0", host_storey_id="s0", footprint_polygon=rect,
            top_z=0.0, bottom_z=-0.15, layers=make_slab_layers(),
            predefined_type="FLOOR",
        )],
        stairs=[], openings=[],
    )
    storey1 = Storey(
        id="s1", name="FF", elevation=3.0, actual_height=3.0, index=1,
        rooms=[], walls=[],
        slabs=[Slab(
            id="slab-s1", host_storey_id="s1", footprint_polygon=rect,
            top_z=3.0, bottom_z=2.85, layers=make_slab_layers(),
            predefined_type="FLOOR",
        )],
        stairs=[], openings=[],
    )
    col = make_rcc_column(column_id="c1", host_storey_id="s0",
                          location=Vec2(x=2.5, y=2.5), base_z=-0.5, top_z=3.0)
    ftg = make_isolated_pad_footing(footing_id="f1", supports_column_id="c1",
                                     location=Vec2(x=2.5, y=2.5),
                                     top_z=-0.5, bottom_z=-1.1)
    building = Building(
        id="b1", name="ShortWallTest",
        envelope_polygon=rect,
        structural_system=StructuralSystem(
            id="ss-1", columns=[col], beams=[], allows_slanted=False),
        mep_systems=[], storeys=[storey0, storey1],
        foundation=Foundation(id="fd-1", footings=[ftg]),
        roof=Roof(id="r-1", type="flat"),
        doors=[], windows=[],
    )
    site = Site(id="site-1", name="P", true_north_deg=0.0,
                terrain_polygon=[], building=building)
    prov = Provenance(
        input_contract_version="Tier2Template-1.0.0",
        target_fidelity="LOD-300",
        generated_at="2026-05-10T00:00:00Z",
        build_id="short-wall-test",
        source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(id="p1", name="ShortWallTest",
                      site=site, metadata=metadata)
    bm = BuildingModel.build({"project": project.model_dump()})

    from app.services.placement_resolver import resolve_placements
    placements = resolve_placements(bm)
    geos = resolve_geometries(bm, placements)

    parapet = geos["wall-parapet"]
    fullheight = geos["wall-fullheight"]
    # Parapet: extrusion_depth = 1.0 m (NOT 2.85 m, the slab-above bottom).
    assert parapet.extrusion_depth == pytest.approx(1.0), (
        f"parapet wall got stretched to {parapet.extrusion_depth} m "
        f"(expected 1.0 m — Slice T2.0.1.1 fix should respect wall.top_z)"
    )
    # Full-height: unchanged, still 2.85 m.
    assert fullheight.extrusion_depth == pytest.approx(2.85), (
        f"full-height wall got {fullheight.extrusion_depth} m "
        f"(expected 2.85 m — fix must not affect full-height walls)"
    )
