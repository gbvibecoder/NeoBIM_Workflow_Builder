"""Phase T2.1 Phase B — Stage A/B scaffolding tests for the 1BHK FLAT layout.

The FLAT floor unit is the highest-risk module of T2.1 because it
must:
  * Pack a self-contained 1BHK on one floor (5 rooms + balcony)
  * Use modern railings on the balcony perimeter (Wall(type="railing"))
  * Place the main entry on the EAST wall for tower side-core integration
  * Honor a `has_balcony` toggle that splits perimeter walls

Per the T2.1 prompt §13 ("surface twice"), we de-risk authoring by
running two pre-layout smoke tests on the 1BHK FLAT plot defaults
(7.32 × 12.20m, 2.5/1.5/0 setbacks) BEFORE writing the full
production function:

  * Stage A — Skeleton (4 perimeter walls + 1 whole-buildable room).
    Confirms the perimeter direction + room "left" side convention
    works on the new plot dimensions and triggers ROOM_BOUNDED to
    resolve a clean rectangle.

  * Stage B — Single partition (4 perimeter + ph-y45 horizontal
    partition + 2 rooms south/north of it + 1 partition door).
    Confirms the horizontal-partition + room-side convention
    ("south of wall = right", "north of wall = left") plus the door
    pair routing works at the exact wall axis the full FLAT layout
    will use to split living-dining from the mid-band rooms.

Both stages live in tests-only — no production code in
`_1bhk_pune_flat_floor_unit.py` yet. The full FLAT function lands in
the next surface; this scaffolding will be deleted (or archived) when
the full-layout test file replaces it.
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
from app.templates._1bhk_pune_floor_unit import (
    make_1bhk_grid_columns_and_footings,
)
from app.templates._common import (
    FloorUnit,
    _perimeter_walls,
    make_axis_aligned_room,
    make_door_pair,
    make_internal_wall,
    make_orthogonal_beam_grid,
    make_rectangular_polygon_ccw,
    make_roof_slab_layers,
    make_slab_layers,
)


# ─── Plot constants (1BHK FLAT defaults) ─────────────────────────────

_PLOT_W: float = 7.32
_PLOT_L: float = 12.20
_FRONT_SET: float = 2.5
_REAR_SET: float = 1.5
_FLOOR_H: float = 3.0
_SLAB_T: float = 0.150
_HALF_EXT: float = 0.250 / 2.0
_HALF_INT: float = 0.135 / 2.0
_HALF_COL: float = 0.230 / 2.0


def _buildable() -> tuple[float, float, float, float, float]:
    """Return (x_min, x_max, y_min, y_max, depth) for the 1BHK FLAT default plot."""
    x_min, x_max = 0.0, _PLOT_W
    y_min, y_max = _REAR_SET, _PLOT_L - _FRONT_SET
    return x_min, x_max, y_min, y_max, y_max - y_min


def _column_grid_for_test() -> tuple[list[float], list[float]]:
    """3×3 grid scaled to the FLAT default plot (matches the 1BHK helper)."""
    x_min, x_max, y_min, y_max, _ = _buildable()
    x_first = x_min + _HALF_COL
    x_last = x_max - _HALF_COL
    y_first = y_min + _HALF_COL
    y_last = y_max - _HALF_COL
    return (
        [x_first, (x_first + x_last) / 2.0, x_last],
        [y_first, (y_first + y_last) / 2.0, y_last],
    )


# ─── 1-storey wrapper (mirrors Phase A test scaffolding) ─────────────


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
        id=fu.storey_id, name="Stage Test Storey",
        elevation=fu.elevation, actual_height=floor_height, index=0,
        rooms=fu.rooms, walls=fu.walls,
        slabs=list(fu.slabs) + [slab_roof],
        stairs=fu.stairs, openings=fu.openings,
    )
    building = Building(
        id="building-1", name="Stage Test Wrapper",
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
        build_id="phase-b-stage", source_contract="BuildingModel",
    )
    metadata = ProjectMetadata(
        rera=ReraData(seismic_zone="III", wind_zone=2, nbc_occupancy_group="A-1"),
        permits=[], cobie_defaults={}, provenance=prov,
    )
    project = Project(
        id="project-1", name="Stage Test Project",
        site=site, metadata=metadata,
    )
    return BuildingModel.build({"project": project.model_dump()})


# ─── Stage A — perimeter + 1 whole-floor room ────────────────────────


def _build_stage_a_floor_unit(
    name_prefix: str = "flat-stage-a", elevation: float = 0.0
) -> FloorUnit:
    """4 perimeter walls + 1 whole-buildable Room. No partitions, no
    openings."""
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


# ─── Stage B — perimeter + 1 partition + 2 rooms + 1 door ────────────


def _build_stage_b_floor_unit(
    name_prefix: str = "flat-stage-b", elevation: float = 0.0
) -> FloorUnit:
    """4 perimeter + ph-y45 partition + south room (living-like) + north
    room (bedroom-like) + 1 door on the partition.

    Targets the exact y=4.5 axis the full FLAT layout will use to split
    living-dining (south band) from the kitchen / bedroom mid band. If
    Stage B passes, the full layout's first partition convention is
    proven correct.
    """
    x_min, x_max, y_min, y_max, _ = _buildable()
    z_wall_base = elevation
    z_wall_top = elevation + _FLOOR_H - _SLAB_T
    y_p45 = 4.5

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
        wall_id=f"wall-{name_prefix}-ph-y45",
        name="Partition Y4.5 - Stage B",
        host_storey_id="storey-test",
        start=Vec2(x=x_min, y=y_p45),
        end=Vec2(x=x_max, y=y_p45),
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
        name="Stage B South Room", usage="living",
        xmin=x_min + _HALF_EXT, xmax=x_max - _HALF_EXT,
        ymin=y_min + _HALF_EXT, ymax=y_p45 - _HALF_INT,
        south_wall=(f"wall-{name_prefix}-S", "left"),
        east_wall=(f"wall-{name_prefix}-E", "left"),
        north_wall=(f"wall-{name_prefix}-ph-y45", "right"),
        west_wall=(f"wall-{name_prefix}-W", "left"),
    )
    north_room = make_axis_aligned_room(
        room_id=f"room-{name_prefix}-north",
        name="Stage B North Room", usage="bedroom",
        xmin=x_min + _HALF_EXT, xmax=x_max - _HALF_EXT,
        ymin=y_p45 + _HALF_INT, ymax=y_max - _HALF_EXT,
        south_wall=(f"wall-{name_prefix}-ph-y45", "left"),
        east_wall=(f"wall-{name_prefix}-E", "left"),
        north_wall=(f"wall-{name_prefix}-N", "left"),
        west_wall=(f"wall-{name_prefix}-W", "left"),
    )

    walls = sorted(list(perimeter) + [partition], key=lambda w: w.id)

    op, dr = make_door_pair(
        door_id=f"door-{name_prefix}-partition",
        opening_id=f"opening-{name_prefix}-d01",
        wall_id=f"wall-{name_prefix}-ph-y45",
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


def test_flat_stage_a_builds_clean() -> None:
    """4 perimeter walls + 1 whole-floor room passes all 12 invariants."""
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    assert isinstance(bm, BuildingModel)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 1
    assert sum(len(s.walls) for s in bm.project.site.building.storeys) == 4


def test_flat_stage_a_room_bounded_passes() -> None:
    """ROOM_BOUNDED resolves a clean rectangle for the whole-floor room.

    Confirms the perimeter wall direction (CCW S→E→N→W) and the room
    "left"-side convention for external walls is correct on the 1BHK
    FLAT default plot (7.32 × 12.20m with 2.5/1.5/0 setbacks).
    """
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    storey = bm.project.site.building.storeys[0]
    room = storey.rooms[0]
    assert len(room.footprint_polygon) == 4
    wall_ids = {w.id for w in storey.walls}
    for edge in room.bounding_edges:
        assert edge.wall_id in wall_ids
        assert edge.side == "left", (
            f"Stage A: edge {edge.wall_id} side={edge.side}; expected "
            f"'left' for interior of CCW-walked perimeter wall"
        )


def test_flat_stage_a_phase1_resolves() -> None:
    """Pass-1 RESOLVE (placements + geometries) succeeds for Stage A."""
    fu = _build_stage_a_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for w in bm.project.site.building.storeys[0].walls:
        assert w.id in placements and w.id in geometries
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements and c.id in geometries


# ─── Stage B tests ───────────────────────────────────────────────────


def test_flat_stage_b_builds_clean() -> None:
    """4 perimeter + 1 partition + 2 rooms + 1 door passes all invariants."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    assert isinstance(bm, BuildingModel)
    assert sum(len(s.rooms) for s in bm.project.site.building.storeys) == 2
    assert sum(len(s.walls) for s in bm.project.site.building.storeys) == 5
    assert len(bm.project.site.building.doors) == 1


def test_flat_stage_b_partition_room_sides() -> None:
    """Stage B: south room (south of ph-y45) references it with side="right";
    north room (north of ph-y45) references it with side="left".

    Encodes the horizontal-partition convention from `_common.py`:
    "Horizontal partition — room north of wall is 'left', south is
    'right'." If this fails, the full FLAT layout's partitions
    would render with bounding edges on the wrong half-plane.
    """
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    by_id = {r.id: r for s in bm.project.site.building.storeys for r in s.rooms}
    south = by_id["room-flat-stage-b-south"]
    north = by_id["room-flat-stage-b-north"]

    south_partition_edge = next(
        e for e in south.bounding_edges if "ph-y45" in e.wall_id
    )
    north_partition_edge = next(
        e for e in north.bounding_edges if "ph-y45" in e.wall_id
    )
    assert south_partition_edge.side == "right"
    assert north_partition_edge.side == "left"


def test_flat_stage_b_door_connects_rooms() -> None:
    """The partition door correctly references both rooms — confirms
    DOOR_CONNECTS_ROOMS is happy with the partition-door pattern."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    door = bm.project.site.building.doors[0]
    assert set(door.connects_room_ids) == {
        "room-flat-stage-b-south",
        "room-flat-stage-b-north",
    }


def test_flat_stage_b_phase1_resolves() -> None:
    """Pass-1 RESOLVE succeeds for Stage B."""
    fu = _build_stage_b_floor_unit()
    bm = _wrap_floor_unit_in_building(fu)
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    for w in bm.project.site.building.storeys[0].walls:
        assert w.id in placements and w.id in geometries
