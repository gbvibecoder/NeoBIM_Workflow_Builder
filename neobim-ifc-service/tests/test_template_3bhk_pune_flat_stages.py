"""Phase T2.2 Phase B — Stage A/B scaffolding tests for the 3BHK FLAT layout.

Mirrors the 1BHK FLAT stage tests (`test_template_1bhk_pune_flat_stages.py`)
but validates the conventions on the 3BHK FLAT default plot (11.0 × 20.0m
with 4.5/3.0/1.5/1.5 setbacks — non-zero side setback differs from
1BHK/2BHK plots).

The 3BHK FLAT is the highest-risk module of T2.2 because:
  * 8 rooms in 100 sqm (denser than 1BHK FLAT's 5 rooms in 60 sqm)
  * 3 bedrooms with limited spatial budget — multiple rooms had NBC
    failures during initial layout iterations
  * has_balcony=True splits perimeter walls into railings (3 of them),
    same convention as 1BHK/2BHK FLAT
  * Main entry on EAST wall for tower core integration
  * Side setback (1.5m) means buildable_x_min = 1.5 (not 0); world-coord
    geometry must shift correctly

Two pre-layout smoke tests validate:

  * Stage A — Skeleton (4 perimeter + 1 whole-buildable room).
    Confirms perimeter direction + room "left" side convention works
    on 11.0 × 20.0m plot with non-zero side setback.

  * Stage B — Single partition (4 perimeter + ph-y58 partition + 2
    rooms + 1 partition door). Validates the horizontal-partition
    convention at the exact y axis the full FLAT will use to split
    living-dining from the mid band.

Pass = the conventions are sound. These tests stay as permanent
regression guards (T2.1 lesson #14).
"""

from __future__ import annotations

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
    Vec2,
)
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates._common import (
    FloorUnit,
    _perimeter_walls,
    make_axis_aligned_room,
    make_door_pair,
    make_internal_wall,
    make_orthogonal_beam_grid,
    make_rcc_grid_columns_and_footings,
    make_rectangular_polygon_ccw,
    make_roof_slab_layers,
    make_slab_layers,
)


# ─── Plot constants (3BHK FLAT defaults) ─────────────────────────────

_PLOT_W: float = 11.0
_PLOT_L: float = 20.0
_FRONT_SET: float = 4.5
_REAR_SET: float = 3.0
_SIDE_SET: float = 1.5
_FLOOR_H: float = 3.0
_SLAB_T: float = 0.150
_HALF_EXT: float = 0.250 / 2.0
_HALF_INT: float = 0.135 / 2.0
_HALF_COL: float = 0.300 / 2.0


def _buildable() -> tuple[float, float, float, float, float]:
    """Return (x_min, x_max, y_min, y_max, depth) for the 3BHK FLAT default plot."""
    x_min, x_max = _SIDE_SET, _PLOT_W - _SIDE_SET  # [1.5, 9.5]
    y_min, y_max = _REAR_SET, _PLOT_L - _FRONT_SET  # [3.0, 15.5]
    return x_min, x_max, y_min, y_max, y_max - y_min


def _column_grid_for_test() -> tuple[list[float], list[float]]:
    """3 × 4 grid scaled to 3BHK plot (matches 2BHK helper)."""
    x_min, x_max, y_min, y_max, _ = _buildable()
    half_col = _HALF_COL
    x_axes = [
        x_min + half_col,
        (x_min + x_max) / 2.0,
        x_max - half_col,
    ]
    y_first = y_min + half_col
    y_last = y_max - half_col
    y_step = (y_last - y_first) / 3.0
    y_axes = [
        y_first,
        y_first + y_step,
        y_first + 2.0 * y_step,
        y_last,
    ]
    return x_axes, y_axes


# ─── 1-storey wrapper ────────────────────────────────────────────────


def _wrap_floor_unit_in_building(
    fu: FloorUnit, *, floor_height: float = 3.0
) -> BuildingModel:
    """Wrap a FloorUnit in a 1-storey BuildingModel for invariant testing."""
    z_roof_top = fu.elevation + floor_height
    z_roof_bottom = z_roof_top - _SLAB_T
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
        id=fu.storey_id, name="Stage Test Storey",
        elevation=fu.elevation, actual_height=floor_height, index=0,
        rooms=fu.rooms, walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs, openings=fu.openings,
    )
    building = Building(
        id="building-1", name="3BHK Stage Test Wrapper",
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
        build_id="phase-t2-2-stage", source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(
        id="project-1", name="3BHK Stage Test Project",
        site=site, metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


# ─── Stage A — perimeter + 1 whole-floor room ────────────────────────


def _build_stage_a_floor_unit(
    name_prefix: str = "flat-stage-a", elevation: float = 0.0
) -> FloorUnit:
    """4 perimeter walls + 1 whole-buildable room on the 3BHK FLAT
    default plot. No partitions, no openings."""
    x_min, x_max, y_min, y_max, _ = _buildable()
    z_wall_base = elevation
    z_wall_top = elevation + _FLOOR_H - _SLAB_T

    envelope = make_rectangular_polygon_ccw(x_min, x_max, y_min, y_max)

    sw = Vec2(x=x_min, y=y_min)
    se = Vec2(x=x_max, y=y_min)
    ne = Vec2(x=x_max, y=y_max)
    nw = Vec2(x=x_min, y=y_max)
    perimeter = _perimeter_walls(
        name_prefix=name_prefix, storey_id="storey-test",
        base_z=z_wall_base, top_z=z_wall_top,
        sw=sw, se=se, ne=ne, nw=nw,
    )

    floor_slab = Slab(
        id="slab-test", host_storey_id="storey-test",
        footprint_polygon=envelope,
        top_z=elevation, bottom_z=elevation - _SLAB_T,
        layers=make_slab_layers(),
        predefined_type="FLOOR",
    )

    test_room = make_axis_aligned_room(
        room_id=f"room-{name_prefix}-whole",
        name="Stage A Whole Floor", usage="living",
        xmin=x_min + _HALF_EXT, xmax=x_max - _HALF_EXT,
        ymin=y_min + _HALF_EXT, ymax=y_max - _HALF_EXT,
        south_wall=(f"wall-{name_prefix}-S", "left"),
        east_wall=(f"wall-{name_prefix}-E", "left"),
        north_wall=(f"wall-{name_prefix}-N", "left"),
        west_wall=(f"wall-{name_prefix}-W", "left"),
    )

    x_axes, y_axes = _column_grid_for_test()
    return FloorUnit(
        storey_id="storey-test", storey_index=0,
        elevation=elevation, floor_height=_FLOOR_H,
        rooms=[test_room],
        walls=sorted(perimeter, key=lambda w: w.id),
        slabs=[floor_slab],
        openings=[], doors=[], windows=[], stairs=[],
        floor_footprint_polygon=envelope,
        column_grid_x=x_axes, column_grid_y=y_axes,
    )


# ─── Stage B — perimeter + ph-y58 partition + 2 rooms + door ─────────


def _build_stage_b_floor_unit(
    name_prefix: str = "flat-stage-b", elevation: float = 0.0
) -> FloorUnit:
    """4 perimeter + ph-y58 partition + south room + north room + door.

    Targets the y=5.8 axis the full 3BHK FLAT layout will use to split
    living-dining (south band) from the mid band. If Stage B passes,
    the full layout's first horizontal partition is proven correct.
    """
    x_min, x_max, y_min, y_max, _ = _buildable()
    z_wall_base = elevation
    z_wall_top = elevation + _FLOOR_H - _SLAB_T
    y_p58 = 5.8

    envelope = make_rectangular_polygon_ccw(x_min, x_max, y_min, y_max)

    sw = Vec2(x=x_min, y=y_min)
    se = Vec2(x=x_max, y=y_min)
    ne = Vec2(x=x_max, y=y_max)
    nw = Vec2(x=x_min, y=y_max)
    perimeter = _perimeter_walls(
        name_prefix=name_prefix, storey_id="storey-test",
        base_z=z_wall_base, top_z=z_wall_top,
        sw=sw, se=se, ne=ne, nw=nw,
    )

    partition = make_internal_wall(
        wall_id=f"wall-{name_prefix}-ph-y58",
        name="Partition Y5.8 - Stage B",
        host_storey_id="storey-test",
        start=Vec2(x=x_min, y=y_p58),
        end=Vec2(x=x_max, y=y_p58),
        base_z=z_wall_base, top_z=z_wall_top,
    )

    floor_slab = Slab(
        id="slab-test", host_storey_id="storey-test",
        footprint_polygon=envelope,
        top_z=elevation, bottom_z=elevation - _SLAB_T,
        layers=make_slab_layers(),
        predefined_type="FLOOR",
    )

    south_room = make_axis_aligned_room(
        room_id=f"room-{name_prefix}-south",
        name="Stage B South (living-like)", usage="living",
        xmin=x_min + _HALF_EXT, xmax=x_max - _HALF_EXT,
        ymin=y_min + _HALF_EXT, ymax=y_p58 - _HALF_INT,
        south_wall=(f"wall-{name_prefix}-S", "left"),
        east_wall=(f"wall-{name_prefix}-E", "left"),
        north_wall=(f"wall-{name_prefix}-ph-y58", "right"),
        west_wall=(f"wall-{name_prefix}-W", "left"),
    )
    north_room = make_axis_aligned_room(
        room_id=f"room-{name_prefix}-north",
        name="Stage B North (mid-band-like)", usage="bedroom",
        xmin=x_min + _HALF_EXT, xmax=x_max - _HALF_EXT,
        ymin=y_p58 + _HALF_INT, ymax=y_max - _HALF_EXT,
        south_wall=(f"wall-{name_prefix}-ph-y58", "left"),
        east_wall=(f"wall-{name_prefix}-E", "left"),
        north_wall=(f"wall-{name_prefix}-N", "left"),
        west_wall=(f"wall-{name_prefix}-W", "left"),
    )

    walls = sorted(list(perimeter) + [partition], key=lambda w: w.id)

    op, dr = make_door_pair(
        door_id=f"door-{name_prefix}-partition",
        opening_id=f"opening-{name_prefix}-d01",
        wall_id=f"wall-{name_prefix}-ph-y58",
        distance_along_wall=(x_max - x_min) / 2.0 - 0.4,
        width=0.8, height=2.0, floor_z=elevation,
        swing="inward", handedness="right",
        connects_room_ids=[
            f"room-{name_prefix}-south",
            f"room-{name_prefix}-north",
        ],
    )

    x_axes, y_axes = _column_grid_for_test()
    return FloorUnit(
        storey_id="storey-test", storey_index=0,
        elevation=elevation, floor_height=_FLOOR_H,
        rooms=sorted([south_room, north_room], key=lambda r: r.id),
        walls=walls,
        slabs=[floor_slab],
        openings=[op], doors=[dr], windows=[], stairs=[],
        floor_footprint_polygon=envelope,
        column_grid_x=x_axes, column_grid_y=y_axes,
    )


# ─── Stage A tests ───────────────────────────────────────────────────


def test_3bhk_flat_stage_a_builds_clean() -> None:
    """4 perimeter walls + 1 whole-floor room passes all 12 invariants
    on the 3BHK FLAT default plot (11.0 × 20.0 with 1.5m side setbacks)."""
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    assert isinstance(bm, BuildingModel)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 1
    assert sum(len(s.walls) for s in bm.project.site.building.storeys) == 4


def test_3bhk_flat_stage_a_room_bounded_passes() -> None:
    """ROOM_BOUNDED resolves a clean rectangle for the whole-floor room.

    The 3BHK plot has non-zero side setback (1.5m) — buildable_x_min =
    1.5, NOT 0. World-coord geometry must shift correctly. Confirms the
    perimeter wall direction (CCW S→E→N→W) and room "left"-side
    convention is correct on the new plot.
    """
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    storey = bm.project.site.building.storeys[0]
    room = storey.rooms[0]
    assert len(room.footprint_polygon) == 4
    wall_ids = {w.id for w in storey.walls}
    for edge in room.bounding_edges:
        assert edge.wall_id in wall_ids
        assert edge.side == "left"


def test_3bhk_flat_stage_a_phase1_resolves() -> None:
    """Pass-1 RESOLVE succeeds for Stage A on 3BHK plot."""
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for w in bm.project.site.building.storeys[0].walls:
        assert w.id in placements and w.id in geometries
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements and c.id in geometries


def test_3bhk_flat_stage_a_buildable_offset_correct() -> None:
    """Buildable region uses world coords offset by the 1.5m side
    setback. Whole-floor room polygon corners reflect that shift."""
    fu = _build_stage_a_floor_unit()
    poly = fu.floor_footprint_polygon
    assert len(poly) == 4
    # SW corner at world (1.5, 3.0).
    assert poly[0].x == 1.5
    assert poly[0].y == 3.0
    # NE corner at world (9.5, 15.5).
    assert poly[2].x == 9.5
    assert poly[2].y == 15.5


# ─── Stage B tests ───────────────────────────────────────────────────


def test_3bhk_flat_stage_b_builds_clean() -> None:
    """4 perimeter + 1 partition + 2 rooms + 1 door passes all invariants."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    assert isinstance(bm, BuildingModel)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 2
    assert sum(len(s.walls) for s in bm.project.site.building.storeys) == 5
    assert len(bm.project.site.building.doors) == 1


def test_3bhk_flat_stage_b_partition_room_sides() -> None:
    """Stage B: south room references ph-y58 with side='right' (south
    of horizontal wall = right per convention); north room with
    side='left' (north of horizontal wall = left)."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    by_id = {r.id: r for s in bm.project.site.building.storeys for r in s.rooms}
    south = by_id["room-flat-stage-b-south"]
    north = by_id["room-flat-stage-b-north"]
    south_partition_edge = next(
        e for e in south.bounding_edges if "ph-y58" in e.wall_id
    )
    north_partition_edge = next(
        e for e in north.bounding_edges if "ph-y58" in e.wall_id
    )
    assert south_partition_edge.side == "right"
    assert north_partition_edge.side == "left"


def test_3bhk_flat_stage_b_door_connects_rooms() -> None:
    """Partition door references both rooms — DOOR_CONNECTS_ROOMS happy."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    door = bm.project.site.building.doors[0]
    assert set(door.connects_room_ids) == {
        "room-flat-stage-b-south",
        "room-flat-stage-b-north",
    }


def test_3bhk_flat_stage_b_phase1_resolves() -> None:
    """Pass-1 RESOLVE succeeds for Stage B."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for w in bm.project.site.building.storeys[0].walls:
        assert w.id in placements and w.id in geometries
