"""Phase T2.2 Phase A — Tests for the 3BHK Pune duplex floor units.

Two Layer-2 builders under test:

  * `build_3bhk_pune_gf_floor_unit` — kitchen / drawing / living-dining /
    pooja / etc. (8 rooms; optional stair). Mirrors the GF role of
    1BHK/2BHK duplex units, scaled up for 3BHK with separate drawing
    room and dedicated pooja.

  * `build_3bhk_pune_ff_floor_unit` — 3 bedrooms (master + bedroom-2 +
    bedroom-3) + master-bath + common-bath + stair-landing + study +
    front balcony (8 rooms with balcony, 7 without).

Tests wrap each unit in a 1-storey BuildingModel (matching the 1BHK +
2BHK FLAT test scaffolding pattern) so the unit can pass through the
full invariant pipeline. Production code goes through the 3BHK Layer-3
assemblers (Phase C/D/E).
"""

from __future__ import annotations

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
from app.templates._3bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    build_3bhk_pune_ff_floor_unit,
    build_3bhk_pune_gf_floor_unit,
)
from app.templates._common import (
    FloorUnit,
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_roof_slab_layers,
)


# ─── 1-storey wrapper for invariant testing ─────────────────────────


def _wrap_floor_unit_in_building(
    fu: FloorUnit,
    *,
    floor_height: float = 3.0,
    building_name: str = "Test 3BHK Wrapper",
) -> BuildingModel:
    """Wrap a 3BHK FloorUnit in a 1-storey BuildingModel.

    Uses 12 columns (3 × 4 grid, 300mm RCC) — same structural sizing
    as 2BHK. Reuses `make_rcc_grid_columns_and_footings` from
    `_common.py` directly (no new helper needed for 3BHK).
    """
    z_roof_top = fu.elevation + floor_height
    z_roof_bottom = z_roof_top - 0.150
    slab_roof = Slab(
        id="slab-roof",
        host_storey_id=fu.storey_id,
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
        host_storey_id=fu.storey_id,
    )
    cols_by_label = {c.id.removeprefix("col-"): c for c in cols}
    beams = make_orthogonal_beam_grid(
        columns_by_label=cols_by_label,
        x_labels_in_order=["A", "B", "C"],
        y_labels_in_order=["1", "2", "3", "4"],
        beam_top_z=z_roof_bottom,
        host_storey_id=fu.storey_id,
        level_label="L1",
    )
    beams.sort(key=lambda b: b.id)

    storey = Storey(
        id=fu.storey_id, name="Test Storey",
        elevation=fu.elevation, actual_height=floor_height, index=0,
        rooms=fu.rooms, walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs, openings=fu.openings,
    )
    building = Building(
        id="building-1", name=building_name,
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
        build_id="phase-t2-2-test",
        source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(
        id="project-1", name=f"{building_name} Project",
        site=site, metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


def _build_default_gf(**overrides) -> FloorUnit:
    """Default GF for tests. has_stair=False because the wrapper is
    1-storey. Stair-specific tests override has_stair=True and call
    the function directly without wrapping."""
    defaults = dict(
        storey_id="storey-test",
        storey_index=0,
        name_prefix="gf",
        floor_slab_id="slab-test",
        elevation=0.0,
        has_stair=False,
    )
    defaults.update(overrides)
    return build_3bhk_pune_gf_floor_unit(**defaults)


def _build_default_ff(**overrides) -> FloorUnit:
    defaults = dict(
        storey_id="storey-test",
        storey_index=0,
        name_prefix="ff",
        floor_slab_id="slab-test",
        elevation=0.0,
    )
    defaults.update(overrides)
    return build_3bhk_pune_ff_floor_unit(**defaults)


# ─── GF floor unit ──────────────────────────────────────────────────


def test_3bhk_gf_floor_unit_default_room_count() -> None:
    """8 rooms — store, utility, stair-foyer, pooja, kitchen, powder,
    living-dining, drawing."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 8
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
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual == expected


def test_3bhk_gf_floor_unit_default_wall_count() -> None:
    """10 walls = 4 perimeter + 6 partitions (ph-y40-w/-e, ph-y65,
    ph-y80, pv-x30, pv-x50). Single-segment partitions where rooms
    share consistent sides; split where conventions force it."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 10


def test_3bhk_gf_has_drawing_separate_from_living() -> None:
    """3BHK luxury convention: drawing room is a separate Room from
    living-dining (1BHK/2BHK do not have this distinction). Verifies
    both rooms exist and have distinct usage tags."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    rooms_by_id = {r.id: r for s in bm.project.site.building.storeys for r in s.rooms}
    assert "room-gf-drawing" in rooms_by_id
    assert "room-gf-living-dining" in rooms_by_id
    assert rooms_by_id["room-gf-drawing"].usage == "drawing"
    assert rooms_by_id["room-gf-living-dining"].usage == "living-dining"


def test_3bhk_gf_has_dedicated_pooja() -> None:
    """3BHK has a dedicated pooja Room (not a kitchen alcove)."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    rooms = [r for s in bm.project.site.building.storeys for r in s.rooms]
    pooja = next((r for r in rooms if r.id == "room-gf-pooja"), None)
    assert pooja is not None
    assert pooja.usage == "pooja"


def test_3bhk_gf_default_door_count() -> None:
    """8 doors: 1 exterior (main entry on N) + 7 interior."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    doors = bm.project.site.building.doors
    assert len(doors) == 8
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 1


def test_3bhk_gf_default_window_count() -> None:
    """8 windows, all on perimeter walls."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    windows = bm.project.site.building.windows
    assert len(windows) == 8
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external, f"window {win.id} on internal wall {wall.id}"


def test_3bhk_gf_floor_unit_meets_nbc_minimums() -> None:
    """All habitable + service rooms hit NBC India 3BHK minimums on
    the default 11.0 × 20.0 plot.

    NBC 3BHK mins (T2.2 prompt §3.4): living-dining 12.5 (strict, vs
    1BHK relaxed 9.5), drawing 9.5, bedroom 9.5, kitchen 5.0, bath 1.8,
    toilet 1.4. Auxiliary rooms (pooja, store, utility, stair, balcony,
    study) have no NBC minimum.
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
    bm = _wrap_floor_unit_in_building(_build_default_gf())
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


def test_3bhk_gf_floor_unit_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes for GF unit."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries
    for s in bm.project.site.building.storeys:
        for w in s.walls:
            assert w.id in placements and w.id in geometries


def test_3bhk_gf_has_stair_when_enabled() -> None:
    """has_stair=True (default) emits exactly 1 stair with 19 risers."""
    fu = _build_default_gf(has_stair=True)
    assert len(fu.stairs) == 1
    stair = fu.stairs[0]
    assert stair.riser_count == 19
    assert stair.flight_count == 2


def test_3bhk_gf_no_stair_when_disabled() -> None:
    """has_stair=False (used by single-storey house) emits zero stairs."""
    fu = _build_default_gf(has_stair=False)
    assert fu.stairs == []


def test_3bhk_gf_main_entry_uses_lobby_sentinel() -> None:
    """door_to_stair_outside=False substitutes TOWER_CORE_LOBBY_SENTINEL."""
    fu = _build_default_gf(name_prefix="s3", door_to_stair_outside=False)
    main = next(d for d in fu.doors if d.id == "door-s3-main-entry")
    assert TOWER_CORE_LOBBY_SENTINEL in main.connects_room_ids
    assert "Outside" not in main.connects_room_ids


def test_3bhk_gf_column_grid_is_3x4() -> None:
    """3BHK uses 3 × 4 column grid (12 columns), same as 2BHK."""
    fu = _build_default_gf()
    assert len(fu.column_grid_x) == 3
    assert len(fu.column_grid_y) == 4


# ─── FF floor unit ──────────────────────────────────────────────────


def test_3bhk_ff_floor_unit_default_room_count() -> None:
    """8 rooms with balcony — study, bedroom-2, stair-landing,
    master-bath, common-bath, master-bedroom, bedroom-3,
    balcony-front."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 8
    expected = {
        "room-ff-study",
        "room-ff-bedroom-2",
        "room-ff-stair-landing",
        "room-ff-master-bath",
        "room-ff-common-bath",
        "room-ff-master-bedroom",
        "room-ff-bedroom-3",
        "room-ff-balcony-front",
    }
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual == expected


def test_3bhk_ff_has_three_bedrooms() -> None:
    """3BHK FF has exactly 3 bedrooms (master + bedroom-2 + bedroom-3)."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    bedrooms = [
        r for s in bm.project.site.building.storeys for r in s.rooms
        if r.usage in ("bedroom", "master-bedroom")
    ]
    assert len(bedrooms) == 3
    bedroom_ids = {b.id for b in bedrooms}
    assert bedroom_ids == {
        "room-ff-master-bedroom",
        "room-ff-bedroom-2",
        "room-ff-bedroom-3",
    }


def test_3bhk_ff_default_wall_count() -> None:
    """11 walls with balcony = 4 perimeter + 7 partitions (ph-y40,
    ph-y65, ph-y80, pv-x30, pv-x40, pv-x50, ph-y115)."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 11


def test_3bhk_ff_default_door_count() -> None:
    """8 doors with balcony: 6 interior + 2 sliding to balcony.
    No exterior doors (FF reached via stair from GF)."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    doors = bm.project.site.building.doors
    assert len(doors) == 8
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 0


def test_3bhk_ff_default_window_count() -> None:
    """8 windows with balcony, all on perimeter walls."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    windows = bm.project.site.building.windows
    assert len(windows) == 8
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external


def test_3bhk_ff_meets_nbc_minimums() -> None:
    """All habitable + service rooms hit NBC India 3BHK mins."""
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
    bm = _wrap_floor_unit_in_building(_build_default_ff())
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


def test_3bhk_ff_master_bedroom_meets_luxury_target() -> None:
    """3BHK master-bedroom has luxury target ≥ 14 sqm. On default plot
    the master-bedroom is ~25 sqm — comfortably luxury."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    master = next(
        r for s in bm.project.site.building.storeys for r in s.rooms
        if r.id == "room-ff-master-bedroom"
    )
    poly = Polygon([(v.x, v.y) for v in master.footprint_polygon])
    assert poly.area >= 14.0, (
        f"master-bedroom area {poly.area:.2f} sqm < luxury target 14.0"
    )


def test_3bhk_ff_master_bath_attached_to_master() -> None:
    """master-bath shares an edge with master-bedroom (en-suite)."""
    fu = _build_default_ff()
    master = next(r for r in fu.rooms if r.id == "room-ff-master-bedroom")
    master_bath = next(r for r in fu.rooms if r.id == "room-ff-master-bath")
    # master is north of master-bath; master-bath's north_wall reference
    # ph-y65 is master's south_wall too. ph-y65 axis is shared.
    master_south_wall_id = next(
        e.wall_id for e in master.bounding_edges
    )
    mbath_walls = {e.wall_id for e in master_bath.bounding_edges}
    master_walls = {e.wall_id for e in master.bounding_edges}
    # Master-bath and master-bedroom must share at least one wall id.
    shared = mbath_walls & master_walls
    assert shared, (
        f"master-bath does not share any wall with master-bedroom; "
        f"mbath walls={mbath_walls}, master walls={master_walls}"
    )


def test_3bhk_ff_floor_unit_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE succeeds for FF unit."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries


def test_3bhk_ff_no_balcony_drops_room_and_wall() -> None:
    """has_balcony=False drops balcony Room, ph-y115 partition, and
    the 2 balcony doors. master-bedroom + bedroom-3 extend to N
    envelope and gain north windows for cross-ventilation."""
    bm = _wrap_floor_unit_in_building(_build_default_ff(has_balcony=False))
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    doors = bm.project.site.building.doors
    windows = bm.project.site.building.windows
    assert rooms == 7  # drop balcony
    assert walls == 10  # drop ph-y115
    assert len(doors) == 6  # drop both balcony doors
    assert len(windows) == 10  # +2 north windows for ventilation
    actual_ids = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert "room-ff-balcony-front" not in actual_ids


def test_3bhk_ff_no_stairs() -> None:
    """FF never has a stair — vertical circulation hosted on GF."""
    fu = _build_default_ff()
    assert fu.stairs == []


# ─── Cross-cutting (GF + FF) ─────────────────────────────────────────


def test_3bhk_floor_units_scale_smaller_plot() -> None:
    """Both units build + resolve cleanly on a 9.0 × 17.0m plot.

    Buildable on 9.0 × 17.0 with 4.5/3.0/1.5 setbacks: 6.0 × 9.5 =
    57 sqm — at the minimum threshold. NBC mins not enforced for
    scaled variants."""
    for builder in [_build_default_gf, _build_default_ff]:
        bm = _wrap_floor_unit_in_building(
            builder(plot_width_m=9.0, plot_length_m=17.0)
        )
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        assert len(bm.project.site.building.structural_system.columns) == 12


def test_3bhk_floor_units_scale_larger_plot() -> None:
    """Both units build + resolve cleanly on a 13.0 × 22.0m plot."""
    for builder in [_build_default_gf, _build_default_ff]:
        bm = _wrap_floor_unit_in_building(
            builder(plot_width_m=13.0, plot_length_m=22.0)
        )
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        assert len(bm.project.site.building.structural_system.columns) == 12


def test_3bhk_floor_units_deterministic() -> None:
    """Same args → byte-identical JSON across calls (both GF and FF)."""
    for builder in [_build_default_gf, _build_default_ff]:
        a = _wrap_floor_unit_in_building(builder()).model_dump_json(indent=2)
        b = _wrap_floor_unit_in_building(builder()).model_dump_json(indent=2)
        assert a == b


def test_3bhk_floor_units_id_prefix_works() -> None:
    """Custom name_prefix flows through every node ID."""
    fu = _build_default_gf(name_prefix="s5")
    assert all(w.id.startswith("wall-s5-") for w in fu.walls)
    assert all(r.id.startswith("room-s5-") for r in fu.rooms)
    assert all(d.id.startswith("door-s5-") for d in fu.doors)
    assert all(o.id.startswith("opening-s5-") for o in fu.openings)
    assert all(wn.id.startswith("window-s5-") for wn in fu.windows)


def test_3bhk_floor_units_z_coords_derive_from_elevation() -> None:
    """elevation=9.0 puts every Z at 9.0 + offset."""
    fu = _build_default_gf(elevation=9.0)
    for w in fu.walls:
        assert w.base_z == 9.0
        assert w.top_z == 9.0 + 3.0 - 0.150
    for slab in fu.slabs:
        assert slab.top_z == 9.0
        assert slab.bottom_z == 9.0 - 0.150
    for op in fu.openings:
        assert op.sill_z >= 9.0


def test_3bhk_external_walls_have_3_layers() -> None:
    """Forward-only quality: external walls have 3-layer composite."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    external_walls = [
        w for s in bm.project.site.building.storeys for w in s.walls if w.is_external
    ]
    assert len(external_walls) == 4
    for w in external_walls:
        assert len(w.layers) == 3
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9


def test_3bhk_internal_partitions_have_3_layers() -> None:
    """Forward-only quality: internal partitions have 3-layer composite."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    partitions = [
        w for s in bm.project.site.building.storeys for w in s.walls
        if not w.is_external
    ]
    assert len(partitions) == 6  # GF has 6 partitions
    for w in partitions:
        assert len(w.layers) == 3
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9
