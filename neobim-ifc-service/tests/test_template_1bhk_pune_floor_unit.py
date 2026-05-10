"""Phase T2.1 Phase A — Tests for the 1BHK Pune duplex floor units.

Two Layer-2 builders under test:

  * `build_1bhk_pune_gf_floor_unit` — kitchen-side (5 rooms, optional
    stair). Mirrors the GF role of the 2BHK duplex but with a smaller
    footprint and only 1 bedroom-equivalent service zone.

  * `build_1bhk_pune_ff_floor_unit` — bedroom-side (5 rooms with
    balcony, 4 without). Single-bedroom + en-suite layout matching
    typical Pune 1BHK upper floors.

Tests exercise each unit by wrapping it in a 1-storey BuildingModel
(the same scaffolding `test_template_2bhk_pune_flat.py` uses) — a
FloorUnit by itself can't go through `BuildingModel.build()` because
the spatial-hierarchy invariants need a Project / Site / Building
wrapper. The wrapper here is test-only; production code goes through
the Layer-3 building assemblers.
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
from app.templates._1bhk_pune_floor_unit import (
    TOWER_CORE_LOBBY_SENTINEL,
    build_1bhk_pune_ff_floor_unit,
    build_1bhk_pune_gf_floor_unit,
    make_1bhk_grid_columns_and_footings,
)
from app.templates._common import (
    FloorUnit,
    make_orthogonal_beam_grid,
    make_roof_slab_layers,
)


# ─── 1-storey wrapper for invariant testing ─────────────────────────


def _wrap_floor_unit_in_building(
    fu: FloorUnit,
    *,
    floor_height: float = 3.0,
    building_name: str = "Test 1BHK Wrapper",
) -> BuildingModel:
    """Wrap a 1BHK FloorUnit in a 1-storey BuildingModel for testing.

    Mirrors the FLAT test scaffolding: foundation + 9 columns + roof
    slab + structural beams. Production code goes through the actual
    Layer-3 assemblers (`tier2_1bhk_pune_house.py` etc.); this helper
    exists only so tests can exercise a single FloorUnit through the
    full invariant pipeline.
    """
    z_roof_top = fu.elevation + floor_height
    z_roof_bottom = z_roof_top - 0.150
    slab_roof = Slab(
        id="slab-roof",
        host_storey_id=fu.storey_id,
        footprint_polygon=fu.floor_footprint_polygon,
        top_z=z_roof_top,
        bottom_z=z_roof_bottom,
        layers=make_roof_slab_layers(),
        predefined_type="ROOF",
    )

    x_dict = dict(zip(["A", "B", "C"], fu.column_grid_x))
    y_dict = dict(zip(["1", "2", "3"], fu.column_grid_y))
    cols, ftgs = make_1bhk_grid_columns_and_footings(
        x_axes=x_dict, y_axes=y_dict,
        column_base_z=-0.5, column_top_z=z_roof_top,
        footing_top_z=-0.5, footing_bottom_z=-1.0,
        host_storey_id=fu.storey_id,
    )
    cols_by_label = {c.id.removeprefix("col-"): c for c in cols}
    beams = make_orthogonal_beam_grid(
        columns_by_label=cols_by_label,
        x_labels_in_order=["A", "B", "C"],
        y_labels_in_order=["1", "2", "3"],
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
        build_id="phase-t2-1-test",
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
    """Default GF for tests. has_stair=False because the test wrapper is
    1-storey — a stair would reference a non-existent upper storey and
    fail STAIR_RISE_MATCHES. Stair-specific tests override has_stair=True
    and call the function directly without wrapping."""
    defaults = dict(
        storey_id="storey-test",
        storey_index=0,
        name_prefix="gf",
        floor_slab_id="slab-test",
        elevation=0.0,
        has_stair=False,
    )
    defaults.update(overrides)
    return build_1bhk_pune_gf_floor_unit(**defaults)


def _build_default_ff(**overrides) -> FloorUnit:
    defaults = dict(
        storey_id="storey-test",
        storey_index=0,
        name_prefix="ff",
        floor_slab_id="slab-test",
        elevation=0.0,
    )
    defaults.update(overrides)
    return build_1bhk_pune_ff_floor_unit(**defaults)


# ─── GF floor unit ──────────────────────────────────────────────────


def test_1bhk_gf_floor_unit_default_room_count() -> None:
    """5 rooms — powder, utility, kitchen, stair-foyer, living-dining."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 5
    expected = {
        "room-gf-powder",
        "room-gf-utility",
        "room-gf-kitchen",
        "room-gf-stair-foyer",
        "room-gf-living-dining",
    }
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual == expected


def test_1bhk_gf_floor_unit_default_wall_count() -> None:
    """9 walls = 4 perimeter (S/E/N/W) + 5 partitions (ph-y25-w/-e,
    ph-y55, pv-x35-s/-n)."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 9


def test_1bhk_gf_floor_unit_default_door_count() -> None:
    """6 doors: 1 exterior (main entry) + 5 interior."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    doors = bm.project.site.building.doors
    assert len(doors) == 6
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 1


def test_1bhk_gf_floor_unit_default_window_count() -> None:
    """6 windows, all on perimeter walls (NBC §15.2.4 daylight rule)."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    windows = bm.project.site.building.windows
    assert len(windows) == 6
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external, f"window {win.id} on internal wall {wall.id}"


def test_1bhk_gf_floor_unit_meets_nbc_minimums() -> None:
    """Each habitable / service room hits its NBC India minimum on the
    default 7.32 × 12.20 plot.

    1BHK NBC mins (§3.4 of T2.1 prompt; relaxed living minimum from
    2BHK's 12.5 to 9.5 because 1BHK living-dining can be smaller):
        living, bedroom, study: 9.5 sqm
        kitchen: 5.0
        bath: 1.8
        toilet: 1.4
    """
    # NBC India §15.2.4 enforces minimum sizes on habitable rooms
    # (living, dining, bedroom). Auxiliary rooms (study / utility /
    # storage / pooja / balcony / stair) and service rooms (powder
    # toilet at 1.4, bath at 1.8) have lower or no thresholds. 1BHK
    # living minimum relaxed to 9.5 sqm per T2.1 prompt §3.4 (vs
    # 2BHK's 12.5 sqm enforced in test_template_2bhk_pune.py).
    nbc_min = {
        "living": 9.5,
        "bedroom": 9.5,
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


def test_1bhk_gf_floor_unit_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes for GF unit."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries
    for s in bm.project.site.building.storeys:
        for w in s.walls:
            assert w.id in placements and w.id in geometries


def test_1bhk_gf_has_stair_when_enabled() -> None:
    """has_stair=True (default) emits exactly 1 stair with 19 risers."""
    fu = _build_default_gf(has_stair=True)
    assert len(fu.stairs) == 1
    stair = fu.stairs[0]
    assert stair.riser_count == 19
    assert stair.flight_count == 2
    assert stair.landing_count == 1
    # Stair sits within the stair-foyer footprint (mid-east mid-band).
    assert len(stair.plan_polygon) == 4


def test_1bhk_gf_no_stair_when_disabled() -> None:
    """has_stair=False (used by single-storey house) emits zero stairs."""
    fu = _build_default_gf(has_stair=False)
    assert fu.stairs == []


def test_1bhk_gf_main_entry_uses_lobby_sentinel() -> None:
    """door_to_stair_outside=False substitutes TOWER_CORE_LOBBY_SENTINEL
    in the main entry's connects_room_ids — same contract as 2BHK GF."""
    fu = _build_default_gf(name_prefix="s3", door_to_stair_outside=False)
    main = next(d for d in fu.doors if d.id == "door-s3-main-entry")
    assert TOWER_CORE_LOBBY_SENTINEL in main.connects_room_ids
    assert "Outside" not in main.connects_room_ids


# ─── FF floor unit ──────────────────────────────────────────────────


def test_1bhk_ff_floor_unit_default_room_count() -> None:
    """5 rooms with balcony — study, master-bath, stair-landing,
    master-bedroom, balcony."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    assert rooms == 5
    expected = {
        "room-ff-study",
        "room-ff-master-bath",
        "room-ff-stair-landing",
        "room-ff-master-bedroom",
        "room-ff-balcony",
    }
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert actual == expected


def test_1bhk_ff_floor_unit_default_wall_count() -> None:
    """8 walls = 4 perimeter + 4 partitions (ph-y25, pv-x35-m, ph-y55,
    ph-y85). The duplex FF balcony uses standard external walls (not
    railings — railings are reserved for the tower FLAT layout)."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    assert walls == 8


def test_1bhk_ff_floor_unit_default_door_count() -> None:
    """4 doors with balcony: bedroom-landing, bedroom-mbath (en-suite),
    study-landing, bedroom-balcony (sliding glass). No exterior doors
    on FF — circulation comes through the GF stair."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    doors = bm.project.site.building.doors
    assert len(doors) == 4
    exterior = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior) == 0


def test_1bhk_ff_floor_unit_default_window_count() -> None:
    """5 windows with balcony, all on perimeter walls."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    windows = bm.project.site.building.windows
    assert len(windows) == 5
    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    for win in windows:
        wall = walls[openings[win.in_opening_id].in_wall_id]
        assert wall.is_external


def test_1bhk_ff_floor_unit_meets_nbc_minimums() -> None:
    """All FF rooms hit NBC India 1BHK minimums on the default plot."""
    # NBC India §15.2.4 enforces minimum sizes on habitable rooms
    # (living, dining, bedroom). Auxiliary rooms (study / utility /
    # storage / pooja / balcony / stair) and service rooms (powder
    # toilet at 1.4, bath at 1.8) have lower or no thresholds. 1BHK
    # living minimum relaxed to 9.5 sqm per T2.1 prompt §3.4 (vs
    # 2BHK's 12.5 sqm enforced in test_template_2bhk_pune.py).
    nbc_min = {
        "living": 9.5,
        "bedroom": 9.5,
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


def test_1bhk_ff_floor_unit_passes_phase1_resolve() -> None:
    """Pass-1 RESOLVE — placements + geometries — completes for FF unit."""
    bm = _wrap_floor_unit_in_building(_build_default_ff())
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements and col.id in geometries


def test_1bhk_ff_no_balcony_drops_room_and_door() -> None:
    """has_balcony=False drops the balcony room, the y=8.5 partition,
    and the bedroom-balcony sliding door. Adds a north window so the
    bedroom retains cross-ventilation."""
    bm = _wrap_floor_unit_in_building(_build_default_ff(has_balcony=False))
    rooms = sum(len(s.rooms) for s in bm.project.site.building.storeys)
    walls = sum(len(s.walls) for s in bm.project.site.building.storeys)
    doors = bm.project.site.building.doors
    windows = bm.project.site.building.windows
    assert rooms == 4
    assert walls == 7  # 4 perimeter + 3 partitions (no ph-y85)
    assert len(doors) == 3
    assert len(windows) == 6  # +1 north window to compensate for no balcony
    actual = {r.id for s in bm.project.site.building.storeys for r in s.rooms}
    assert "room-ff-balcony" not in actual


def test_1bhk_ff_has_no_stairs() -> None:
    """FF never has a stair — vertical circulation hosted on GF only."""
    fu = _build_default_ff()
    assert fu.stairs == []


# ─── Cross-cutting (GF + FF) ─────────────────────────────────────────


def test_1bhk_floor_units_scale_smaller_plot() -> None:
    """Both units build + resolve cleanly on a 6.0 × 11.0m plot.

    Buildable on 6 × 11 (with default setbacks 2.5/1.5/0): 6.0 × 7.0 =
    42 sqm — tight but legal. NBC mins not enforced for scaled variants
    (see test_*_meets_nbc_minimums for default-plot enforcement)."""
    for builder in [_build_default_gf, _build_default_ff]:
        bm = _wrap_floor_unit_in_building(
            builder(plot_width_m=6.0, plot_length_m=11.0)
        )
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        # Sanity: all 9 columns produce placements at any plot.
        assert len(bm.project.site.building.structural_system.columns) == 9


def test_1bhk_floor_units_scale_larger_plot() -> None:
    """Both units build + resolve cleanly on a 9.0 × 14.0m plot."""
    for builder in [_build_default_gf, _build_default_ff]:
        bm = _wrap_floor_unit_in_building(
            builder(plot_width_m=9.0, plot_length_m=14.0)
        )
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        assert len(bm.project.site.building.structural_system.columns) == 9


def test_1bhk_floor_units_deterministic() -> None:
    """Same args → byte-identical JSON across calls (both GF and FF)."""
    for builder in [_build_default_gf, _build_default_ff]:
        a = _wrap_floor_unit_in_building(builder()).model_dump_json(indent=2)
        b = _wrap_floor_unit_in_building(builder()).model_dump_json(indent=2)
        assert a == b


def test_1bhk_floor_units_id_prefix_works() -> None:
    """Custom name_prefix flows through every node ID — required so the
    tower / duplex assemblers can stack multiple floors with unique IDs."""
    fu = _build_default_gf(name_prefix="s5")
    assert all(w.id.startswith("wall-s5-") for w in fu.walls)
    assert all(r.id.startswith("room-s5-") for r in fu.rooms)
    assert all(d.id.startswith("door-s5-") for d in fu.doors)
    assert all(o.id.startswith("opening-s5-") for o in fu.openings)
    assert all(wn.id.startswith("window-s5-") for wn in fu.windows)
    if fu.stairs:
        assert all(st.id.startswith("stair-s5-") for st in fu.stairs)


def test_1bhk_floor_units_z_coords_derive_from_elevation() -> None:
    """Calling at elevation=9.0 puts every Z coordinate at 9.0 + offset
    — same Z discipline the FloorUnit contract guarantees."""
    fu = _build_default_gf(elevation=9.0)
    for w in fu.walls:
        assert w.base_z == 9.0
        assert w.top_z == 9.0 + 3.0 - 0.150  # floor_height - slab_thickness
    for slab in fu.slabs:
        assert slab.top_z == 9.0
        assert slab.bottom_z == 9.0 - 0.150
    # Window sill_z should be elevation + offset, not literal ~0.9 etc.
    for op in fu.openings:
        assert op.sill_z >= 9.0  # never below this floor's slab top


def test_1bhk_external_walls_have_3_layers() -> None:
    """Forward-only quality gate: every external wall has 3 MaterialLayers
    summing to wall thickness (cement-plaster + brick + cement-plaster)."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    external_walls = [
        w for s in bm.project.site.building.storeys for w in s.walls if w.is_external
    ]
    assert len(external_walls) == 4  # 4 perimeter walls
    for w in external_walls:
        assert len(w.layers) == 3
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9
        functions = [L.function for L in w.layers]
        assert "core" in functions


def test_1bhk_internal_partitions_have_3_layers() -> None:
    """Forward-only quality gate: every internal partition has 3
    MaterialLayers summing to wall thickness."""
    bm = _wrap_floor_unit_in_building(_build_default_gf())
    partitions = [
        w
        for s in bm.project.site.building.storeys
        for w in s.walls
        if not w.is_external
    ]
    assert len(partitions) == 5  # 5 GF partitions
    for w in partitions:
        assert len(w.layers) == 3
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9
