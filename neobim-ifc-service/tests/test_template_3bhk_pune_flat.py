"""Phase T2.2 Phase B — Tests for `build_3bhk_pune_flat_floor_unit`.

The 3BHK FLAT is the building block for the 3BHK tower (Phase E).
Mirrors `test_template_2bhk_pune_flat.py` and
`test_template_1bhk_pune_flat.py` patterns.

Coverage:
  * Default-args FLAT (has_balcony=True): room/wall/door/window
    counts; NBC minimums; Pass-1 RESOLVE; main-entry on east wall;
    tower-core sentinel substitution; master-bedroom luxury target.
  * Modern balcony railings: 3 railings (E-n / N / W-n) with type
    "railing", 50mm MS-Steel, 1.1m height.
  * has_balcony=False variant: drops balcony Room, ph-y140, balcony
    doors, E/W splits + 3 railings; adds north windows.
  * Plot scaling, determinism, ID prefix, Z-coord derivation.
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
from app.templates._2bhk_pune_floor_unit import TOWER_CORE_LOBBY_SENTINEL
from app.templates._3bhk_pune_flat_floor_unit import (
    build_3bhk_pune_flat_floor_unit,
)
from app.templates._common import (
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


def _wrap_flat_in_building(
    *,
    has_balcony: bool = True,
    plot_width_m: float = 11.0,
    plot_length_m: float = 20.0,
    floor_height: float = 3.0,
    door_to_stair_outside: bool = True,
    name_prefix: str = "flat",
) -> BuildingModel:
    """Wrap one 3BHK FLAT FloorUnit in a 1-storey BuildingModel."""
    fu = build_3bhk_pune_flat_floor_unit(
        storey_id="storey-ground",
        storey_index=0,
        name_prefix=name_prefix,
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
        top_z=z_roof_top, bottom_z=z_roof_bottom,
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
        id="building-1", name="Test 3BHK Flat Wrapper",
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
        generated_at="2026-05-10T00:00:00Z",
        build_id="phase-t2-2-flat-test",
        source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(
        id="project-1", name="Test 3BHK Flat Wrapper Project",
        site=site, metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


# ─── Default-args FLAT (has_balcony=True) ────────────────────────────


def test_3bhk_flat_default_room_count() -> None:
    """8 rooms — living-dining, bedroom-2, kitchen, master-bath,
    common-bath, bedroom-3, master-bedroom, balcony-front."""
    bm = _wrap_flat_in_building()
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 8
    expected = {
        "room-flat-living-dining",
        "room-flat-bedroom-2",
        "room-flat-kitchen",
        "room-flat-master-bath",
        "room-flat-common-bath",
        "room-flat-bedroom-3",
        "room-flat-master-bedroom",
        "room-flat-balcony-front",
    }
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual == expected


def test_3bhk_flat_has_three_bedrooms() -> None:
    """3 bedrooms (master + bedroom-2 + bedroom-3)."""
    bm = _wrap_flat_in_building()
    bedrooms = [
        r for s in bm.project.site.building.storeys for r in s.rooms
        if r.usage in ("bedroom", "master-bedroom")
    ]
    assert len(bedrooms) == 3


def test_3bhk_flat_default_wall_count() -> None:
    """11 walls = 6 perimeter (3 walls + 3 railings) + 5 partitions
    (ph-y58, ph-y90, ph-y105, ph-y140, pv-x35)."""
    bm = _wrap_flat_in_building()
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 11


def test_3bhk_flat_default_door_count() -> None:
    """9 doors with balcony: 1 exterior (main entry) + 8 interior
    (incl. 2 sliding glass to balcony)."""
    bm = _wrap_flat_in_building()
    doors = bm.project.site.building.doors
    assert len(doors) == 9
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 1


def test_3bhk_flat_default_window_count() -> None:
    """8 windows, all on perimeter walls."""
    bm = _wrap_flat_in_building()
    windows = bm.project.site.building.windows
    assert len(windows) == 8
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external


def test_3bhk_flat_meets_nbc_minimums() -> None:
    """All habitable + service rooms hit NBC India 3BHK mins on the
    default 11.0 × 20.0 plot.

    NBC 3BHK mins (T2.2 prompt §3.4): living-dining 12.5 (strict),
    bedroom 9.5, kitchen 5.0, bath 1.8, toilet 1.4. Auxiliary
    (balcony) has no NBC min.
    """
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
    bm = _wrap_flat_in_building()
    for s in bm.project.site.building.storeys:
        for r in s.rooms:
            poly = Polygon([(v.x, v.y) for v in r.footprint_polygon])
            assert poly.is_valid
            assert poly.area > 0
            min_area = nbc_min.get(r.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{r.id} ({r.usage}): area {poly.area:.2f} sqm "
                    f"< NBC min {min_area} sqm"
                )


def test_3bhk_flat_master_bedroom_meets_luxury_target() -> None:
    """Master-bedroom hits luxury target ≥14 sqm on default plot.

    Locked layout v15 chose pv-x35 at x=5.0 (giving east zone 4.5m
    width × 3.5m depth, ≈14.49 sqm post-insets) over symmetric 4m
    bedrooms specifically to satisfy this luxury target."""
    bm = _wrap_flat_in_building()
    master = next(
        r for s in bm.project.site.building.storeys for r in s.rooms
        if r.id == "room-flat-master-bedroom"
    )
    poly = Polygon([(v.x, v.y) for v in master.footprint_polygon])
    assert poly.area >= 14.0, (
        f"master-bedroom area {poly.area:.2f} sqm < luxury target 14.0"
    )


def test_3bhk_flat_no_stairs() -> None:
    """FLAT never has a stair — vertical circulation is the tower's job."""
    bm = _wrap_flat_in_building()
    stairs = sum(len(s.stairs) for s in bm.project.site.building.storeys)
    assert stairs == 0


def test_3bhk_flat_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — succeeds for FLAT."""
    bm = _wrap_flat_in_building()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries
    for s in bm.project.site.building.storeys:
        for w in s.walls:
            assert w.id in placements and w.id in geometries


# ─── Tower-integration contracts ─────────────────────────────────────


def test_3bhk_flat_main_entry_on_east_wall() -> None:
    """Main entry on east perimeter wall (E-s when has_balcony=True),
    so the tower assembler can wire it into the side-core lobby east
    of the flat."""
    bm = _wrap_flat_in_building()
    storey = bm.project.site.building.storeys[0]
    main = next(d for d in bm.project.site.building.doors if "main-entry" in d.id)
    op = next(o for o in storey.openings if o.id == main.in_opening_id)
    wall = next(w for w in storey.walls if w.id == op.in_wall_id)
    assert wall.id.endswith("-E-s") or wall.id.endswith("-E"), (
        f"main entry on {wall.id}; expected east perimeter wall"
    )


def test_3bhk_flat_tower_core_sentinel_substitutes() -> None:
    """door_to_stair_outside=False puts TOWER_CORE_LOBBY_SENTINEL in
    the main entry's connects_room_ids."""
    fu = build_3bhk_pune_flat_floor_unit(
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


# ─── Modern balcony railings ─────────────────────────────────────────


def test_3bhk_flat_balcony_uses_railings_not_walls() -> None:
    """Balcony N/E-n/W-n edges are Wall(type="railing") — same modern
    Indian residential convention as 1BHK/2BHK FLAT."""
    bm = _wrap_flat_in_building()
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    assert len(railings) == 3
    railing_ids = {r.id for r in railings}
    assert railing_ids == {
        "wall-flat-E-n",
        "wall-flat-N",
        "wall-flat-W-n",
    }
    for r in railings:
        assert r.thickness == pytest.approx(0.050)
        assert r.layers and r.layers[0].material_name == "MS-Steel"
        assert r.is_external is True
        assert r.is_load_bearing is False


def test_3bhk_flat_railing_height_is_1100mm() -> None:
    """Railings extrude 1.1m above floor (NBC India §15 guard-rail)."""
    bm = _wrap_flat_in_building()
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    for r in railings:
        height = r.top_z - r.base_z
        assert height == pytest.approx(1.1)


# ─── has_balcony=False variant ───────────────────────────────────────


def test_3bhk_flat_no_balcony_drops_room() -> None:
    """has_balcony=False yields 7 rooms — drops balcony."""
    bm = _wrap_flat_in_building(has_balcony=False)
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 7
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert "room-flat-balcony-front" not in actual


def test_3bhk_flat_no_balcony_drops_railings() -> None:
    """has_balcony=False uses standard 4-perimeter — no railings."""
    bm = _wrap_flat_in_building(has_balcony=False)
    bld = bm.project.site.building
    railings = [
        w for s in bld.storeys for w in s.walls if w.type == "railing"
    ]
    assert railings == []
    walls = sum(len(s.walls) for s in bld.storeys)
    # 4 perimeter + 4 partitions (ph-y58, ph-y90, ph-y105, pv-x35; no ph-y140) = 8
    assert walls == 8


def test_3bhk_flat_no_balcony_drops_balcony_doors() -> None:
    """has_balcony=False drops 2 sliding doors (9 → 7)."""
    bm = _wrap_flat_in_building(has_balcony=False)
    doors = bm.project.site.building.doors
    assert len(doors) == 7
    door_ids = {d.id for d in doors}
    assert "door-flat-bedroom-3-balcony" not in door_ids
    assert "door-flat-master-balcony" not in door_ids


def test_3bhk_flat_no_balcony_adds_north_windows() -> None:
    """has_balcony=False adds bedroom-3 + master-bedroom north windows
    (8 → 10) so cross-ventilation is preserved."""
    bm = _wrap_flat_in_building(has_balcony=False)
    windows = bm.project.site.building.windows
    assert len(windows) == 10
    window_ids = {w.id for w in windows}
    assert "window-flat-bedroom-3-north" in window_ids
    assert "window-flat-master-north" in window_ids


def test_3bhk_flat_no_balcony_meets_nbc_minimums() -> None:
    """has_balcony=False rooms (bedrooms extend to N envelope) still
    meet NBC mins."""
    nbc_min = {
        "living": 9.5,
        "living-dining": 12.5,
        "bedroom": 9.5,
        "master-bedroom": 9.5,
        "kitchen": 5.0,
        "bath": 1.8,
        "toilet": 1.4,
    }
    bm = _wrap_flat_in_building(has_balcony=False)
    for s in bm.project.site.building.storeys:
        for r in s.rooms:
            poly = Polygon([(v.x, v.y) for v in r.footprint_polygon])
            min_area = nbc_min.get(r.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{r.id} ({r.usage}): area {poly.area:.2f} sqm "
                    f"< NBC min {min_area} sqm"
                )


def test_3bhk_flat_no_balcony_passes_phase1_resolve() -> None:
    """has_balcony=False passes Pass-1 RESOLVE."""
    bm = _wrap_flat_in_building(has_balcony=False)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for s in bm.project.site.building.storeys:
        for w in s.walls:
            assert w.id in placements and w.id in geometries


# ─── Plot scaling ────────────────────────────────────────────────────


def test_3bhk_flat_scales_smaller_plot() -> None:
    """Builds + resolves cleanly on 9.0 × 17.0m (min buildable 6×9.5)."""
    bm = _wrap_flat_in_building(plot_width_m=9.0, plot_length_m=17.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 8


def test_3bhk_flat_scales_larger_plot() -> None:
    """Builds + resolves cleanly on a 13.0 × 22.0m plot."""
    bm = _wrap_flat_in_building(plot_width_m=13.0, plot_length_m=22.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 8


# ─── Determinism + Z-coords + ID prefix ──────────────────────────────


def test_3bhk_flat_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = _wrap_flat_in_building().model_dump_json(indent=2)
    b = _wrap_flat_in_building().model_dump_json(indent=2)
    assert a == b


def test_3bhk_flat_id_prefix_works() -> None:
    """Custom name_prefix flows through every node ID."""
    fu = build_3bhk_pune_flat_floor_unit(
        storey_id="storey-7",
        storey_index=7,
        name_prefix="flat-s7",
        floor_slab_id="slab-flat-s7-floor",
        elevation=21.0,
    )
    assert all(w.id.startswith("wall-flat-s7-") for w in fu.walls)
    assert all(r.id.startswith("room-flat-s7-") for r in fu.rooms)
    assert all(d.id.startswith("door-flat-s7-") for d in fu.doors)


def test_3bhk_flat_z_coords_derive_from_elevation() -> None:
    """elevation=9.0 puts every Z at 9.0 + offset."""
    fu = build_3bhk_pune_flat_floor_unit(
        storey_id="storey-3",
        storey_index=3,
        name_prefix="flat-s3",
        floor_slab_id="slab-flat-s3-floor",
        elevation=9.0,
    )
    for w in fu.walls:
        assert w.base_z == 9.0
        if w.type == "railing":
            assert w.top_z == pytest.approx(9.0 + 1.1)
        else:
            assert w.top_z == pytest.approx(9.0 + 3.0 - 0.150)
    for slab in fu.slabs:
        assert slab.top_z == 9.0
    for op in fu.openings:
        assert op.sill_z >= 9.0
