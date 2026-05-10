"""Phase T2.2 Phase C/D — Tests for the 3BHK Pune house + duplex."""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon

from app.domain.building_model import BuildingModel
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates.tier2_3bhk_pune import (
    build_3bhk_pune_duplex,
    build_3bhk_pune_template,
)
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house


# ─── Phase D: build_3bhk_pune_duplex ──────────────────────────────────


def test_3bhk_duplex_builds_clean() -> None:
    """`build_3bhk_pune_duplex` returns an invariant-valid BuildingModel."""
    bm = build_3bhk_pune_duplex()
    assert isinstance(bm, BuildingModel)
    assert bm.project.name == "3BHK Pune Duplex Project"
    assert bm.project.site.building.name == "3BHK Pune Duplex"


def test_3bhk_duplex_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes."""
    bm = build_3bhk_pune_duplex()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries


def test_3bhk_duplex_storey_count() -> None:
    """2 storeys: storey-ground at z=0, storey-first at z=3."""
    bm = build_3bhk_pune_duplex()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 2
    by_id = {s.id: s for s in storeys}
    assert by_id["storey-ground"].elevation == 0.0
    assert by_id["storey-first"].elevation == 3.0
    assert (
        by_id["storey-ground"].elevation + by_id["storey-ground"].actual_height
        == by_id["storey-first"].elevation
    )


def test_3bhk_duplex_column_count() -> None:
    """12 columns (3 × 4 grid), all 0.300×0.300m."""
    bm = build_3bhk_pune_duplex()
    cols = bm.project.site.building.structural_system.columns
    assert len(cols) == 12
    for c in cols:
        assert c.profile.dimensions["width"] == 0.300
        assert c.profile.dimensions["depth"] == 0.300
        assert c.host_storey_id == "storey-ground"


def test_3bhk_duplex_footing_count() -> None:
    """12 footings, 1.5 × 1.5m pads."""
    bm = build_3bhk_pune_duplex()
    foundation = bm.project.site.building.foundation
    assert foundation is not None
    footings = foundation.footings
    assert len(footings) == 12
    for f in footings:
        poly = Polygon([(v.x, v.y) for v in f.footprint_polygon])
        assert abs(poly.area - 2.25) < 1e-6


def test_3bhk_duplex_has_one_stair() -> None:
    """1 stair, hosted on storey-ground, 19 risers."""
    bm = build_3bhk_pune_duplex()
    stairs = []
    for s in bm.project.site.building.storeys:
        stairs.extend(s.stairs)
    assert len(stairs) == 1
    assert stairs[0].host_storey_id == "storey-ground"
    assert stairs[0].riser_count == 19


def test_3bhk_template_alias_matches_duplex() -> None:
    """`build_3bhk_pune_template` returns byte-identical to duplex."""
    a = build_3bhk_pune_template().model_dump_json(indent=2)
    b = build_3bhk_pune_duplex().model_dump_json(indent=2)
    assert a == b


def test_3bhk_duplex_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_3bhk_pune_duplex().model_dump_json()
    b = build_3bhk_pune_duplex().model_dump_json()
    assert a == b


def test_3bhk_duplex_envelope_polygon_ccw() -> None:
    """Building envelope polygon is CCW (positive signed area)."""
    from app.domain.building_model import _signed_area

    bm = build_3bhk_pune_duplex()
    poly = bm.project.site.building.envelope_polygon
    assert _signed_area(list(poly)) > 0


def test_3bhk_duplex_provenance_stamps() -> None:
    """Provenance carries Tier-2 metadata."""
    bm = build_3bhk_pune_duplex()
    prov = bm.project.metadata.provenance
    assert prov.target_fidelity == "LOD-300"
    assert prov.source_contract == "BuildingModel"
    assert prov.build_id == "tier2-3bhk-pune-v1"


def test_3bhk_duplex_no_room_violates_nbc() -> None:
    """Each room meets NBC India 3BHK minimum on default plot."""
    nbc_min = {
        "living": 9.5,
        "living-dining": 12.5,
        "drawing": 9.5,
        "bedroom": 9.5,
        "master-bedroom": 9.5,
        "kitchen": 5.0,
        "bath": 1.8,
        "toilet": 1.4,
    }
    bm = build_3bhk_pune_duplex()
    for s in bm.project.site.building.storeys:
        for room in s.rooms:
            poly = Polygon([(v.x, v.y) for v in room.footprint_polygon])
            min_area = nbc_min.get(room.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{room.id} ({room.usage}): area {poly.area:.2f} sqm "
                    f"< NBC min {min_area} sqm"
                )


def test_3bhk_duplex_scaling_smaller_plot() -> None:
    """Builds + resolves cleanly on 9.0 × 17.0m plot."""
    bm = build_3bhk_pune_duplex(plot_width_m=9.0, plot_length_m=17.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert len(bm.project.site.building.structural_system.columns) == 12


def test_3bhk_duplex_scaling_larger_plot() -> None:
    """Builds + resolves cleanly on 13.0 × 22.0m plot."""
    bm = build_3bhk_pune_duplex(plot_width_m=13.0, plot_length_m=22.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert len(bm.project.site.building.structural_system.columns) == 12


def test_3bhk_duplex_too_small_plot_fails_loud() -> None:
    """Plot below buildable minimum raises ValueError."""
    with pytest.raises(ValueError, match="buildable"):
        build_3bhk_pune_duplex(plot_width_m=5.0, plot_length_m=10.0)


def test_3bhk_duplex_element_density() -> None:
    """Exact element counts for the 2-storey 3BHK duplex."""
    bm = build_3bhk_pune_duplex()
    bld = bm.project.site.building
    walls = sum(len(s.walls) for s in bld.storeys)
    rooms = sum(len(s.rooms) for s in bld.storeys)
    slabs = sum(len(s.slabs) for s in bld.storeys)
    columns = len(bld.structural_system.columns)
    beams = len(bld.structural_system.beams)
    footings = len(bld.foundation.footings) if bld.foundation else 0
    openings = sum(len(s.openings) for s in bld.storeys)
    doors = len(bld.doors)
    windows = len(bld.windows)
    stairs = sum(len(s.stairs) for s in bld.storeys)

    assert walls == 21, f"walls={walls} (expected 21 = 10 GF + 11 FF)"
    assert rooms == 16, f"rooms={rooms} (expected 16 = 8 GF + 8 FF)"
    assert slabs == 3, f"slabs={slabs} (expected 3)"
    assert columns == 12
    assert footings == 12
    assert beams == 34, f"beams={beams} (expected 34 = 17/level × 2)"
    assert openings == 32, f"openings={openings} (expected 32)"
    assert doors == 16, f"doors={doors} (expected 16 = 8 GF + 8 FF)"
    assert windows == 16, f"windows={windows} (expected 16 = 8 GF + 8 FF)"
    assert stairs == 1


# ─── Phase C: build_3bhk_pune_house ───────────────────────────────────


def test_3bhk_house_builds_clean() -> None:
    """`build_3bhk_pune_house` returns invariant-valid BuildingModel."""
    bm = build_3bhk_pune_house()
    assert isinstance(bm, BuildingModel)
    assert bm.project.name == "3BHK Pune House Project"


def test_3bhk_house_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE succeeds for 3BHK house."""
    bm = build_3bhk_pune_house()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements and c.id in geometries


def test_3bhk_house_storey_count_is_one() -> None:
    """One storey at z=0."""
    bm = build_3bhk_pune_house()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 1
    assert storeys[0].id == "storey-ground"


def test_3bhk_house_no_stair() -> None:
    """House has zero stairs."""
    bm = build_3bhk_pune_house()
    stairs = sum(len(s.stairs) for s in bm.project.site.building.storeys)
    assert stairs == 0


def test_3bhk_house_room_count() -> None:
    """House has 8 rooms — exactly the GF floor unit's room set."""
    bm = build_3bhk_pune_house()
    rooms = [r for s in bm.project.site.building.storeys for r in s.rooms]
    assert len(rooms) == 8
    expected = {
        "room-gf-store",
        "room-gf-utility",
        "room-gf-stair-foyer",
        "room-gf-pooja",
        "room-gf-kitchen",
        "room-gf-powder",
        "room-gf-living-dining",
        "room-gf-drawing",
    }
    assert {r.id for r in rooms} == expected


def test_3bhk_house_deterministic() -> None:
    """Byte-identical across calls."""
    a = build_3bhk_pune_house().model_dump_json(indent=2)
    b = build_3bhk_pune_house().model_dump_json(indent=2)
    assert a == b


def test_3bhk_house_scales() -> None:
    """House builds on smaller and larger plots."""
    for w, l in [(9.0, 17.0), (13.0, 22.0)]:
        bm = build_3bhk_pune_house(plot_width_m=w, plot_length_m=l)
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        assert len(bm.project.site.building.structural_system.columns) == 12


def test_3bhk_house_element_density() -> None:
    """Exact element counts for the single-storey 3BHK bungalow."""
    bm = build_3bhk_pune_house()
    bld = bm.project.site.building
    walls = sum(len(s.walls) for s in bld.storeys)
    rooms = sum(len(s.rooms) for s in bld.storeys)
    slabs = sum(len(s.slabs) for s in bld.storeys)
    columns = len(bld.structural_system.columns)
    beams = len(bld.structural_system.beams)
    footings = len(bld.foundation.footings) if bld.foundation else 0
    openings = sum(len(s.openings) for s in bld.storeys)
    doors = len(bld.doors)
    windows = len(bld.windows)
    stairs = sum(len(s.stairs) for s in bld.storeys)

    assert walls == 10, f"walls={walls}"
    assert rooms == 8, f"rooms={rooms}"
    assert slabs == 2, f"slabs={slabs}"
    assert columns == 12
    assert footings == 12
    assert beams == 17, f"beams={beams} (expected 17, one ceiling level)"
    assert openings == 16
    assert doors == 8
    assert windows == 8
    assert stairs == 0
    total = walls + rooms + slabs + columns + footings + beams + openings + doors + windows + stairs
    assert total == 93, f"total={total} (expected 93)"
