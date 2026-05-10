"""Phase T2.1 Phase C/D — Tests for the 1BHK Pune house + duplex.

Mirrors `test_template_2bhk_pune.py` structure: house and duplex
covered in a single test file, since both are Layer-3 assemblers
that compose the same Layer-2 floor units (GF only for the house;
GF + FF for the duplex).
"""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon

from app.domain.building_model import BuildingModel
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates.tier2_1bhk_pune import (
    build_1bhk_pune_duplex,
    build_1bhk_pune_template,
)
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house


# ─── Phase D: build_1bhk_pune_duplex ──────────────────────────────────


def test_1bhk_duplex_builds_clean() -> None:
    """`build_1bhk_pune_duplex` returns an invariant-valid BuildingModel."""
    bm = build_1bhk_pune_duplex()
    assert isinstance(bm, BuildingModel)
    assert bm.project.id == "project-1"
    assert bm.project.name == "1BHK Pune Duplex Project"
    assert bm.project.site.building.name == "1BHK Pune Duplex"


def test_1bhk_duplex_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes without raising."""
    bm = build_1bhk_pune_duplex()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries


def test_1bhk_duplex_storey_count() -> None:
    """2 storeys: storey-ground at z=0, storey-first at z=3."""
    bm = build_1bhk_pune_duplex()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 2
    by_id = {s.id: s for s in storeys}
    assert by_id["storey-ground"].elevation == 0.0
    assert by_id["storey-ground"].index == 0
    assert by_id["storey-first"].elevation == 3.0
    assert by_id["storey-first"].index == 1
    # STOREY_CONTINUITY: top of ground = bottom of first.
    assert (
        by_id["storey-ground"].elevation + by_id["storey-ground"].actual_height
        == by_id["storey-first"].elevation
    )


def test_1bhk_duplex_column_count() -> None:
    """9 columns (3 × 3 grid), all 0.230×0.230m, all hosted on storey-ground."""
    bm = build_1bhk_pune_duplex()
    cols = bm.project.site.building.structural_system.columns
    assert len(cols) == 9
    for c in cols:
        assert c.profile.profile_type == "rectangle"
        assert c.profile.dimensions["width"] == 0.230
        assert c.profile.dimensions["depth"] == 0.230
        assert c.host_storey_id == "storey-ground"
        assert c.material == "M25-RCC"


def test_1bhk_duplex_footing_count() -> None:
    """9 footings, each supports exactly one column, 1.2 × 1.2m pads."""
    bm = build_1bhk_pune_duplex()
    foundation = bm.project.site.building.foundation
    assert foundation is not None
    footings = foundation.footings
    assert len(footings) == 9
    supported = {f.supports_column_id for f in footings}
    assert len(supported) == 9
    column_ids = {c.id for c in bm.project.site.building.structural_system.columns}
    assert supported == column_ids
    for f in footings:
        # 1.2 × 1.2m pad → footprint area = 1.44 sqm.
        poly = Polygon([(v.x, v.y) for v in f.footprint_polygon])
        assert poly.is_valid
        assert abs(poly.area - 1.44) < 1e-6


def test_1bhk_duplex_has_one_stair() -> None:
    """Exactly 1 stair, hosted on storey-ground, with rise matching the slab gap."""
    bm = build_1bhk_pune_duplex()
    stairs = []
    for s in bm.project.site.building.storeys:
        stairs.extend(s.stairs)
    assert len(stairs) == 1
    stair = stairs[0]
    assert stair.host_storey_id == "storey-ground"
    assert stair.riser_count == 19


def test_1bhk_template_alias_matches_duplex() -> None:
    """`build_1bhk_pune_template` returns byte-identical to `build_1bhk_pune_duplex`."""
    a = build_1bhk_pune_template().model_dump_json(indent=2)
    b = build_1bhk_pune_duplex().model_dump_json(indent=2)
    assert a == b


def test_1bhk_duplex_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_1bhk_pune_duplex().model_dump_json()
    b = build_1bhk_pune_duplex().model_dump_json()
    assert a == b


def test_1bhk_duplex_envelope_polygon_ccw() -> None:
    """Building envelope polygon is CCW (positive signed area)."""
    from app.domain.building_model import _signed_area

    bm = build_1bhk_pune_duplex()
    poly = bm.project.site.building.envelope_polygon
    assert len(poly) >= 3
    assert _signed_area(list(poly)) > 0


def test_1bhk_duplex_provenance_stamps() -> None:
    """Provenance carries the locked Tier-2 metadata."""
    bm = build_1bhk_pune_duplex()
    prov = bm.project.metadata.provenance
    assert prov.target_fidelity == "LOD-300"
    assert prov.source_contract == "BuildingModel"
    assert prov.input_contract_version == "Tier2Template-1.0.0"
    assert prov.build_id == "tier2-1bhk-pune-v1"
    assert prov.generated_at == "2026-05-10T00:00:00Z"


def test_1bhk_duplex_no_mep_v1() -> None:
    """MEP excluded from v1; Phase 5 will populate."""
    bm = build_1bhk_pune_duplex()
    assert bm.project.site.building.mep_systems == []


def test_1bhk_duplex_no_room_violates_nbc_minimums() -> None:
    """Each room's footprint area meets NBC India 1BHK minimum on default plot."""
    nbc_min = {
        "living": 9.5,
        "bedroom": 9.5,
        "kitchen": 5.0,
        "bath": 1.8,
        "toilet": 1.4,
    }
    bm = build_1bhk_pune_duplex()
    for s in bm.project.site.building.storeys:
        for room in s.rooms:
            poly = Polygon([(v.x, v.y) for v in room.footprint_polygon])
            assert poly.is_valid
            assert poly.area > 0
            min_area = nbc_min.get(room.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{room.id} ({room.usage}): area {poly.area:.2f} sqm "
                    f"< NBC min {min_area} sqm"
                )


def test_1bhk_duplex_scaling_smaller_plot() -> None:
    """Builds + resolves cleanly on a 6.0 × 11.0m plot."""
    bm = build_1bhk_pune_duplex(plot_width_m=6.0, plot_length_m=11.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    bld = bm.project.site.building
    assert len(bld.structural_system.columns) == 9


def test_1bhk_duplex_scaling_larger_plot() -> None:
    """Builds + resolves cleanly on a 9.0 × 14.0m plot."""
    bm = build_1bhk_pune_duplex(plot_width_m=9.0, plot_length_m=14.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    bld = bm.project.site.building
    assert len(bld.structural_system.columns) == 9


def test_1bhk_duplex_too_small_plot_fails_loud() -> None:
    """A plot below 4×5m buildable raises ValueError early."""
    with pytest.raises(ValueError, match="buildable"):
        build_1bhk_pune_duplex(plot_width_m=3.0, plot_length_m=6.0)


def test_1bhk_duplex_element_density() -> None:
    """Exact element counts for the 2-storey 1BHK duplex.

    Counts are deterministic on the default plot. Forward-only quality
    rule: any regression that drops elements unexpectedly fails loudly.
    """
    bm = build_1bhk_pune_duplex()
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

    assert walls == 17, f"walls={walls} (expected 17 = 9 GF + 8 FF)"
    assert rooms == 10, f"rooms={rooms} (expected 10 = 5 GF + 5 FF)"
    assert slabs == 3, f"slabs={slabs} (expected 3: 2 floor + 1 roof)"
    assert columns == 9, f"columns={columns} (expected 9 = 3×3 grid)"
    assert footings == 9, f"footings={footings} (expected 9)"
    # 12 beams per ceiling level × 2 levels = 24
    assert beams == 24, f"beams={beams} (expected 24 = 12/level × 2)"
    assert openings == 21, f"openings={openings} (expected 21 = 12 GF + 9 FF)"
    assert doors == 10, f"doors={doors} (expected 10 = 6 GF + 4 FF)"
    assert windows == 11, f"windows={windows} (expected 11 = 6 GF + 5 FF)"
    assert stairs == 1, f"stairs={stairs} (expected 1)"


# ─── Phase C: build_1bhk_pune_house ───────────────────────────────────


def test_1bhk_house_builds_clean() -> None:
    """`build_1bhk_pune_house` returns an invariant-valid BuildingModel."""
    bm = build_1bhk_pune_house()
    assert isinstance(bm, BuildingModel)
    assert bm.project.name == "1BHK Pune House Project"
    assert bm.project.site.building.name == "1BHK Pune House"


def test_1bhk_house_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes without raising."""
    bm = build_1bhk_pune_house()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements
        assert c.id in geometries


def test_1bhk_house_storey_count_is_one() -> None:
    """Exactly one storey at z=0."""
    bm = build_1bhk_pune_house()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 1
    assert storeys[0].id == "storey-ground"
    assert storeys[0].elevation == 0.0
    assert storeys[0].index == 0


def test_1bhk_house_no_stair() -> None:
    """Single-storey house has zero stairs."""
    bm = build_1bhk_pune_house()
    stairs = sum(len(s.stairs) for s in bm.project.site.building.storeys)
    assert stairs == 0


def test_1bhk_house_room_count() -> None:
    """House has 5 rooms — exactly the GF floor unit's room set."""
    bm = build_1bhk_pune_house()
    rooms = [r for s in bm.project.site.building.storeys for r in s.rooms]
    assert len(rooms) == 5
    expected = {
        "room-gf-powder",
        "room-gf-utility",
        "room-gf-kitchen",
        "room-gf-stair-foyer",
        "room-gf-living-dining",
    }
    assert {r.id for r in rooms} == expected


def test_1bhk_house_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_1bhk_pune_house().model_dump_json(indent=2)
    b = build_1bhk_pune_house().model_dump_json(indent=2)
    assert a == b


def test_1bhk_house_scales() -> None:
    """House builds + resolves cleanly on smaller and larger plots."""
    for w, l in [(6.0, 11.0), (9.0, 14.0)]:
        bm = build_1bhk_pune_house(plot_width_m=w, plot_length_m=l)
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        bld = bm.project.site.building
        assert len(bld.storeys) == 1
        assert len(bld.structural_system.columns) == 9


def test_1bhk_house_element_density() -> None:
    """Exact element counts for the single-storey 1BHK bungalow."""
    bm = build_1bhk_pune_house()
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

    assert walls == 9, f"walls={walls} (expected 9)"
    assert rooms == 5, f"rooms={rooms} (expected 5)"
    assert slabs == 2, f"slabs={slabs} (expected 2: floor + roof)"
    assert columns == 9, f"columns={columns} (expected 9)"
    assert footings == 9, f"footings={footings} (expected 9)"
    assert beams == 12, f"beams={beams} (expected 12, one ceiling level)"
    assert openings == 12, f"openings={openings} (expected 12)"
    assert doors == 6, f"doors={doors} (expected 6)"
    assert windows == 6, f"windows={windows} (expected 6)"
    assert stairs == 0, f"stairs={stairs} (expected 0)"

    total = walls + rooms + slabs + columns + footings + beams + openings + doors + windows + stairs
    assert total == 70, f"total elements {total} (expected 70)"
