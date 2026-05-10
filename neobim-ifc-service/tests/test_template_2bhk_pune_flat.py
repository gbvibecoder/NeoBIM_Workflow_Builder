"""Phase E0 — Tests for `build_2bhk_pune_flat_floor_unit`.

The FLAT floor unit (Layer-2) is the building block for the Phase E
tower assembler. Each tower habitable storey instantiates one FLAT.
These tests validate the unit in isolation — they wrap it in a
1-storey building (mirroring what the Phase D house assembler does)
because a FloorUnit by itself can't be passed through
BuildingModel.build() — Layer-3 assembly is required to satisfy the
spatial-hierarchy invariants.

The wrapper here is intentionally NOT promoted to a public assembler:
production code goes through `tier2_2bhk_pune_house.py` (GF layout) or
the upcoming tower assembler (FLAT layout per floor). The wrapper
exists only to give the tests a way to exercise the FLAT unit through
the full invariant pipeline.
"""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon

from app.domain.building_model import (
    Building,
    BuildingModel,
    Foundation,
    Project,
    ProjectMetadata,
    Provenance,
    ReraData,
    Roof,
    Site,
    Slab,
    Storey,
    StructuralSystem,
)
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates._2bhk_pune_flat_floor_unit import (
    build_2bhk_pune_flat_floor_unit,
)
from app.templates._2bhk_pune_floor_unit import TOWER_CORE_LOBBY_SENTINEL
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


def _wrap_flat_in_building(
    *,
    has_balcony: bool = True,
    plot_width_m: float = 7.32,
    plot_length_m: float = 15.24,
    floor_height: float = 3.0,
    door_to_stair_outside: bool = True,
) -> BuildingModel:
    """Test helper: wrap one FLAT FloorUnit in a 1-storey BuildingModel.

    Mirrors the Phase D house assembler but uses the FLAT layout instead
    of GF. This is test scaffolding only — production tower code goes
    through the (yet-to-author) Phase E tower assembler.
    """
    fu = build_2bhk_pune_flat_floor_unit(
        storey_id="storey-ground",
        storey_index=0,
        name_prefix="flat",
        floor_slab_id="slab-ground",
        elevation=0.0,
        floor_height=floor_height,
        plot_width_m=plot_width_m,
        plot_length_m=plot_length_m,
        door_to_stair_outside=door_to_stair_outside,
        has_balcony=has_balcony,
    )

    z_roof_top = floor_height
    z_roof_bottom = floor_height - 0.150
    slab_roof = Slab(
        id="slab-roof",
        host_storey_id="storey-ground",
        footprint_polygon=fu.floor_footprint_polygon,
        top_z=z_roof_top,
        bottom_z=z_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    x_dict = dict(zip(["A", "B", "C"], fu.column_grid_x))
    y_dict = dict(zip(["1", "2", "3", "4"], fu.column_grid_y))
    cols, ftgs = make_rcc_grid_columns_and_footings(
        x_axes=x_dict, y_axes=y_dict,
        column_base_z=-0.5, column_top_z=z_roof_top,
        footing_top_z=-0.5, footing_bottom_z=-1.1,
        host_storey_id="storey-ground",
    )
    cols_by_label = {c.id.removeprefix("col-"): c for c in cols}
    beams = make_orthogonal_beam_grid(
        columns_by_label=cols_by_label,
        x_labels_in_order=["A", "B", "C"],
        y_labels_in_order=["1", "2", "3", "4"],
        beam_top_z=z_roof_bottom,
        host_storey_id="storey-ground",
        level_label="L1",
    )
    beams.sort(key=lambda b: b.id)

    storey = Storey(
        id="storey-ground", name="Ground Floor",
        elevation=0.0, actual_height=floor_height, index=0,
        rooms=fu.rooms, walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs, openings=fu.openings,
    )
    building = Building(
        id="building-1", name="Test Flat Wrapper",
        occupancy_nbc_group="A-1",
        envelope_polygon=fu.floor_footprint_polygon,
        structural_system=StructuralSystem(
            id="structural-system-1",
            columns=cols, beams=beams, allows_slanted=False,
        ),
        mep_systems=[], storeys=[storey],
        foundation=Foundation(id="foundation-1", footings=ftgs),
        roof=Roof(id="roof-1", type="flat"),
        doors=sorted(fu.doors, key=lambda d: d.id),
        windows=sorted(fu.windows, key=lambda w: w.id),
    )
    site = Site(
        id="site-1", name="Test Plot", true_north_deg=0.0,
        terrain_polygon=[], building=building,
    )
    prov = Provenance(
        input_contract_version="Tier2Template-1.0.0",
        target_fidelity="LOD-300",
        generated_at="2026-05-09T00:00:00Z",
        build_id="phase-e0-test",
        source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(
        id="project-1", name="Test Flat Wrapper Project",
        site=site, metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


# ─── Default-args FLAT (has_balcony=True) ────────────────────────


def test_flat_floor_unit_default_room_count() -> None:
    """7 rooms — living-dining, kitchen, bedroom-2, common-bath,
    master-bedroom, master-bath, balcony."""
    bm = _wrap_flat_in_building()
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 7
    expected_room_ids = {
        "room-flat-living-dining",
        "room-flat-kitchen",
        "room-flat-bedroom-2",
        "room-flat-common-bath",
        "room-flat-master-bedroom",
        "room-flat-master-bath",
        "room-flat-balcony",
    }
    actual_ids = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual_ids == expected_room_ids


def test_flat_floor_unit_default_wall_count() -> None:
    """14 walls (after Slice T2.0.1) = 6 perimeter (E and W split into
    south + north-parapet at y_p110) + 8 partitions. Was 12 before T2.0.1
    when E and W were single full-height walls."""
    bm = _wrap_flat_in_building()
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 14


def test_flat_floor_unit_default_door_count() -> None:
    """8 doors: 1 exterior + 7 interior."""
    bm = _wrap_flat_in_building()
    doors = bm.project.site.building.doors
    assert len(doors) == 8
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 1, "expected exactly 1 exterior door (main entry)"


def test_flat_floor_unit_default_window_count() -> None:
    """7 windows on perimeter walls."""
    bm = _wrap_flat_in_building()
    windows = bm.project.site.building.windows
    assert len(windows) == 7

    # All windows on perimeter walls.
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external, (
            f"window {win.id} on internal wall {wall.id}"
        )


def test_flat_floor_unit_meets_nbc_minimums() -> None:
    """All habitable + service rooms hit NBC India minimum areas."""
    nbc_min = {
        "living": 12.5,
        "bedroom": 9.5,
        "kitchen": 5.0,
        "bath": 1.8,
        "toilet": 1.4,
        "dining": 7.0,
    }
    bm = _wrap_flat_in_building()
    for s in bm.project.site.building.storeys:
        for r in s.rooms:
            poly = Polygon([(v.x, v.y) for v in r.footprint_polygon])
            assert poly.is_valid
            assert poly.area > 0
            min_area = nbc_min.get(r.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{r.id} ({r.usage}): area {poly.area:.2f} sqm < NBC min {min_area}"
                )


def test_flat_floor_unit_no_stairs() -> None:
    """FLAT never has a stair — vertical circulation belongs to the tower core."""
    bm = _wrap_flat_in_building()
    stairs = sum(len(s.stairs) for s in bm.project.site.building.storeys)
    assert stairs == 0


def test_flat_floor_unit_passes_phase1_resolve() -> None:
    """Pass 1 RESOLVE — placements + geometries succeed."""
    bm = _wrap_flat_in_building()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    # Every column and wall must have a placement + geometry.
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries
    for s in bm.project.site.building.storeys:
        for w in s.walls:
            assert w.id in placements and w.id in geometries


# ─── has_balcony toggle ─────────────────────────────────────────


def test_flat_floor_unit_no_balcony_room_count() -> None:
    """has_balcony=False drops to 6 rooms (no balcony) and 11 walls."""
    bm = _wrap_flat_in_building(has_balcony=False)
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert rooms == 6
    assert walls == 11
    actual_ids = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert "room-flat-balcony" not in actual_ids


def test_flat_floor_unit_no_balcony_door_count() -> None:
    """has_balcony=False drops the master-balcony door (8 → 7)."""
    bm = _wrap_flat_in_building(has_balcony=False)
    assert len(bm.project.site.building.doors) == 7


# ─── Tower-core sentinel ─────────────────────────────────────────


def test_flat_floor_unit_tower_core_sentinel() -> None:
    """`door_to_stair_outside=False` substitutes the tower-core lobby sentinel
    in the main entry door's connects_room_ids."""
    fu = build_2bhk_pune_flat_floor_unit(
        storey_id="storey-3",
        storey_index=3,
        name_prefix="s3",
        floor_slab_id="slab-s3-floor",
        elevation=9.0,
        door_to_stair_outside=False,
    )
    main = next(d for d in fu.doors if d.id == "door-s3-main-entry")
    assert TOWER_CORE_LOBBY_SENTINEL in main.connects_room_ids
    assert "Outside" not in main.connects_room_ids


# ─── Scaling ────────────────────────────────────────────────────


def test_flat_floor_unit_scales_smaller_plot() -> None:
    """Builds + resolves cleanly on a 6.0 × 12.0 m plot."""
    bm = _wrap_flat_in_building(plot_width_m=6.0, plot_length_m=12.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 7


def test_flat_floor_unit_scales_larger_plot() -> None:
    """Builds + resolves cleanly on a 9.0 × 18.0 m plot."""
    bm = _wrap_flat_in_building(plot_width_m=9.0, plot_length_m=18.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 7


# ─── Determinism ────────────────────────────────────────────────


def test_flat_floor_unit_is_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = _wrap_flat_in_building().model_dump_json(indent=2)
    b = _wrap_flat_in_building().model_dump_json(indent=2)
    assert a == b
