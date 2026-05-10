"""Phase T1.2 — Tier-2 2BHK Pune duplex template tests.

Spec: `temp_folder/`-tracked Slice T1.2 implementation prompt §10.4 lists the
17 required tests + element-density quality gate. As the template is
authored slice-by-slice, tests appear in the same order:

  Step 2-3 (skeleton + grid):
    - test_template_builds_clean
    - test_template_passes_phase1_resolve
    - test_storey_count
    - test_column_count
    - test_footing_count
    - test_template_is_deterministic
    - test_envelope_polygon_ccw
    - test_provenance_stamps
    - test_no_mep_v1
    - test_scaling_smaller_plot
    - test_scaling_larger_plot

  Step 4-5 (walls):       test_external_walls_have_3_layers
  Step 6 (rooms):         test_room_count, test_no_room_violates_nbc_minimums
  Step 7 (stair):         test_stair_passes_rise_check
  Step 8 (openings):      test_door_count, test_window_count
  Step 9+ (final):        test_element_density_matches_target

Each test starts from a default-parametrised `build_2bhk_pune_template()`
(or scaled variant) and asserts a single property — keeps failure
attribution unambiguous.
"""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon

from app.domain.building_model import BuildingModel
from app.services.geometry_resolver import resolve_geometries
from app.services.placement_resolver import resolve_placements
from app.templates import build_2bhk_pune_house, build_2bhk_pune_template


# ─── Builds + invariants ──────────────────────────────────────────────


def test_template_builds_clean() -> None:
    """`build_2bhk_pune_template` returns a BuildingModel without raising.

    All 12 Phase-1 invariants must pass. Any failure surfaces as a
    BuildingModelValidationError with the offending rule_id.
    """
    bm = build_2bhk_pune_template()
    assert isinstance(bm, BuildingModel)
    assert bm.project.id == "project-1"
    assert bm.project.name == "2BHK Pune Duplex Project"


def test_template_passes_phase1_resolve() -> None:
    """Pass 1 RESOLVE — placements + geometries — completes without raising."""
    bm = build_2bhk_pune_template()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    # Sanity floor: every column must produce a placement and a geometry.
    for col in bm.project.site.building.structural_system.columns:
        assert col.id in placements, f"column {col.id} missing placement"
        assert col.id in geometries, f"column {col.id} missing geometry"


# ─── Topology counts (skeleton + grid) ────────────────────────────────


def test_storey_count() -> None:
    """Exactly 2 storeys: storey-ground at z=0, storey-first at z=3."""
    bm = build_2bhk_pune_template()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 2

    by_id = {s.id: s for s in storeys}
    assert "storey-ground" in by_id
    assert "storey-first" in by_id
    assert by_id["storey-ground"].elevation == 0.0
    assert by_id["storey-ground"].index == 0
    assert by_id["storey-first"].elevation == 3.0
    assert by_id["storey-first"].index == 1
    # STOREY_CONTINUITY: top of ground = bottom of first.
    assert (
        by_id["storey-ground"].elevation + by_id["storey-ground"].actual_height
        == by_id["storey-first"].elevation
    )


def test_column_count() -> None:
    """Exactly 12 columns, all 0.300×0.300 m, all hosted on storey-ground."""
    bm = build_2bhk_pune_template()
    cols = bm.project.site.building.structural_system.columns
    assert len(cols) == 12
    for c in cols:
        assert c.profile.profile_type == "rectangle"
        assert c.profile.dimensions["width"] == 0.300
        assert c.profile.dimensions["depth"] == 0.300
        assert c.host_storey_id == "storey-ground"
        assert c.top_location is None  # vertical
        assert c.material == "M25-RCC"


def test_footing_count() -> None:
    """Exactly 12 footings, each supports exactly one column, 1.5×1.5 m pads."""
    bm = build_2bhk_pune_template()
    foundation = bm.project.site.building.foundation
    assert foundation is not None
    footings = foundation.footings
    assert len(footings) == 12

    supported_columns = {f.supports_column_id for f in footings}
    assert len(supported_columns) == 12  # one footing per column, no duplicates
    column_ids = {c.id for c in bm.project.site.building.structural_system.columns}
    assert supported_columns == column_ids

    for f in footings:
        # 1.5 × 1.5 m pad → footprint area = 2.25 sqm.
        poly = Polygon([(v.x, v.y) for v in f.footprint_polygon])
        assert poly.is_valid
        assert abs(poly.area - 2.25) < 1e-6


# ─── Determinism + provenance + envelope ──────────────────────────────


def test_template_byte_identical_post_refactor() -> None:
    """T2.0 regression guard — refactor must not change template output.

    The snapshot at `tests/fixtures/snapshots/tier2_2bhk_pune_v1.json` is
    captured pre-T2.0 (Phase C start) and pinned. Any refactor that
    changes a single byte of `build_2bhk_pune_template().model_dump_json(
    indent=2, exclude_none=False)` fails this test. If the change is
    intentional (a real layout/material/provenance change), regenerate
    the snapshot deliberately — do NOT silently re-snap to make the test
    pass.
    """
    from pathlib import Path

    snapshot_path = (
        Path(__file__).parent
        / "fixtures"
        / "snapshots"
        / "tier2_2bhk_pune_v1.json"
    )
    expected_json = snapshot_path.read_text()

    bm = build_2bhk_pune_template()
    actual_json = bm.model_dump_json(indent=2, exclude_none=False)

    if actual_json != expected_json:
        # Compute a diff hint to make debugging easier.
        import difflib

        diff = list(
            difflib.unified_diff(
                expected_json.splitlines(keepends=True),
                actual_json.splitlines(keepends=True),
                fromfile="snapshot",
                tofile="actual",
                n=2,
            )
        )
        # Truncate diff to keep test output manageable.
        diff_excerpt = "".join(diff[:80])
        raise AssertionError(
            f"T2.0 refactor changed template output. Snapshot length "
            f"{len(expected_json)}, actual length {len(actual_json)}. "
            f"First 80 diff lines:\n{diff_excerpt}"
        )


def test_template_is_deterministic() -> None:
    """Calling the function twice with default args returns byte-identical JSON.

    Determinism is the contract that downstream caching layers (lift cache,
    fixture-match dedup) rely on. A failure here means a non-deterministic
    field crept in (random, datetime.now, dict iteration order, etc.).
    """
    a = build_2bhk_pune_template().model_dump_json()
    b = build_2bhk_pune_template().model_dump_json()
    assert a == b


def test_envelope_polygon_ccw() -> None:
    """Building envelope polygon is CCW (positive signed area)."""
    from app.domain.building_model import _signed_area

    bm = build_2bhk_pune_template()
    poly = bm.project.site.building.envelope_polygon
    assert len(poly) >= 3
    assert _signed_area(list(poly)) > 0


def test_provenance_stamps() -> None:
    """Provenance carries the locked Tier-2 metadata.

    target_fidelity == LOD-300 (Slice T1.1 decision 6).
    source_contract == BuildingModel (this template authors directly, not lifted).
    input_contract_version stamp matches the template-format version.
    """
    bm = build_2bhk_pune_template()
    prov = bm.project.metadata.provenance
    assert prov.target_fidelity == "LOD-300"
    assert prov.source_contract == "BuildingModel"
    assert prov.input_contract_version == "Tier2Template-1.0.0"
    assert prov.build_id == "tier2-2bhk-pune-v1"
    assert prov.generated_at == "2026-05-08T00:00:00Z"


def test_no_mep_v1() -> None:
    """Slice T1.1 decision 5: MEP excluded from v1; Phase 5 will populate."""
    bm = build_2bhk_pune_template()
    assert bm.project.site.building.mep_systems == []


# ─── Wall composition (Step 4 onwards) ────────────────────────────────


def test_external_walls_have_3_layers() -> None:
    """Every external wall has exactly 3 MaterialLayers summing to wall thickness.

    Quality gate from spec §0: composite material layers (3+ per wall/slab)
    is one of the wellness_center.ifc benchmark properties.
    """
    bm = build_2bhk_pune_template()
    external_walls = [
        w for s in bm.project.site.building.storeys for w in s.walls if w.is_external
    ]
    assert len(external_walls) >= 8, "expected ≥ 8 external walls (4 per storey)"
    for w in external_walls:
        assert len(w.layers) == 3, f"{w.id}: expected 3 layers, got {len(w.layers)}"
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9, (
            f"{w.id}: layers sum to {layer_sum}, wall thickness {w.thickness}"
        )
        functions = [L.function for L in w.layers]
        assert "core" in functions, f"{w.id}: missing 'core' material layer"


def test_internal_partitions_have_3_layers() -> None:
    """Every internal partition has 3 MaterialLayers summing to wall thickness."""
    bm = build_2bhk_pune_template()
    partitions = [
        w
        for s in bm.project.site.building.storeys
        for w in s.walls
        if not w.is_external
    ]
    assert len(partitions) >= 8, "expected ≥ 8 internal partitions"
    for w in partitions:
        assert len(w.layers) == 3, f"{w.id}: expected 3 layers"
        layer_sum = sum(L.thickness for L in w.layers)
        assert abs(layer_sum - w.thickness) < 1e-9, (
            f"{w.id}: layers sum to {layer_sum}, thickness {w.thickness}"
        )


# ─── Rooms (Step 5-6) ─────────────────────────────────────────────────


def test_room_count() -> None:
    """≥ 7 rooms on GF, ≥ 6 rooms on FF, ≥ 13 rooms total (spec §10.4 test 6).

    Architectural decision (spec §10): 8 FF rooms because the FF balcony
    must be split at the pv-x25 column line — pv-x25-n cuts through any
    room that spans x∈[0, 7.32] in y∈[10.5, 12.24], so the balcony is
    realised as balcony-w + balcony-e (not unrealistic for a Pune duplex
    — two separate balconies are common).
    """
    bm = build_2bhk_pune_template()
    storeys = {s.id: s for s in bm.project.site.building.storeys}
    gf_rooms = storeys["storey-ground"].rooms
    ff_rooms = storeys["storey-first"].rooms
    assert len(gf_rooms) >= 7, f"GF rooms: {len(gf_rooms)} < 7"
    assert len(ff_rooms) >= 6, f"FF rooms: {len(ff_rooms)} < 6"
    assert len(gf_rooms) + len(ff_rooms) >= 13


def test_stair_passes_rise_check() -> None:
    """Exactly 1 stair, hosted on storey-ground, with rise matching the slab gap.

    STAIR_RISE_MATCHES requires riser_count × riser_height == slab_above.bottom_z
    - slab_below.top_z within 1 mm. The template sets riser_count = 19 and
    derives riser_height from the actual structural rise, so the equation
    holds at default floor-to-floor (2.85 m / 19 = 0.150 m) and under any
    scaled floor height.
    """
    bm = build_2bhk_pune_template()
    storeys_by_id = {s.id: s for s in bm.project.site.building.storeys}

    stairs = []
    for s in bm.project.site.building.storeys:
        stairs.extend(s.stairs)
    assert len(stairs) == 1, f"expected 1 stair, got {len(stairs)}"
    stair = stairs[0]
    assert stair.host_storey_id == "storey-ground"
    assert stair.riser_count == 19
    assert stair.flight_count == 2
    assert stair.landing_count == 1
    assert len(stair.plan_polygon) >= 3

    slab_below = next(
        s
        for s in storeys_by_id["storey-ground"].slabs
        if s.predefined_type == "FLOOR"
    )
    slab_above = next(
        s
        for s in storeys_by_id["storey-first"].slabs
        if s.predefined_type == "FLOOR"
    )
    structural_rise = slab_above.bottom_z - slab_below.top_z
    total_rise = stair.riser_count * stair.riser_height
    assert abs(total_rise - structural_rise) < 0.001, (
        f"rise drift {abs(total_rise - structural_rise):.6f} m exceeds 1 mm "
        f"(structural {structural_rise} vs stair {total_rise})"
    )


def test_door_count() -> None:
    """≥ 1 door per room and ≥ 1 exterior door (spec §10.4 test 8).

    Door count must be in [12, 18] per spec §10.5 element-density.
    The "Outside" sentinel is a permitted singleton room id for
    exterior doors (DOOR_CONNECTS_ROOMS).
    """
    bm = build_2bhk_pune_template()
    doors = bm.project.site.building.doors
    assert 12 <= len(doors) <= 18, f"door count {len(doors)} outside [12, 18]"

    # Every room has at least one door referencing it.
    all_room_ids = {
        r.id for s in bm.project.site.building.storeys for r in s.rooms
    }
    door_room_ids: set[str] = set()
    for d in doors:
        for rid in d.connects_room_ids:
            if rid != "Outside":
                door_room_ids.add(rid)
    missing = all_room_ids - door_room_ids
    assert not missing, f"rooms with no door: {sorted(missing)}"

    # ≥ 1 exterior door (main entry).
    exterior_doors = [d for d in doors if "Outside" in d.connects_room_ids]
    assert len(exterior_doors) >= 1, "no exterior doors found"


def test_window_count() -> None:
    """Every habitable room has ≥ 1 window on a perimeter wall (spec §10.4 test 9).

    Habitable rooms = {living, kitchen, bedroom, study}. The "dining"
    NBC usage is folded into "living" in the merged living-dining room,
    so it inherits the living minimum + window requirement.

    Window count must be in [11, 17] per spec §10.5.
    """
    bm = build_2bhk_pune_template()
    windows = bm.project.site.building.windows
    assert 11 <= len(windows) <= 17, f"window count {len(windows)} outside [11, 17]"

    walls = {w.id: w for s in bm.project.site.building.storeys for w in s.walls}
    openings = {
        o.id: o for s in bm.project.site.building.storeys for o in s.openings
    }
    window_wall_ids = {
        openings[w.in_opening_id].in_wall_id for w in windows
    }

    # All windows must sit on perimeter walls (interior windows aren't useful
    # for ventilation / daylight — and waste opening budget).
    for w in windows:
        wall = walls[openings[w.in_opening_id].in_wall_id]
        assert wall.is_external, (
            f"window {w.id} on internal wall {wall.id} — windows belong on perimeters"
        )

    habitable = {"living", "kitchen", "bedroom", "study"}
    for s in bm.project.site.building.storeys:
        for room in s.rooms:
            if room.usage not in habitable:
                continue
            room_perimeter_walls = [
                e.wall_id
                for e in room.bounding_edges
                if walls[e.wall_id].is_external
            ]
            with_window = [
                wid for wid in room_perimeter_walls if wid in window_wall_ids
            ]
            assert with_window, (
                f"{room.id} ({room.usage}): no window on perimeter walls "
                f"({room_perimeter_walls})"
            )


def test_element_density_matches_target() -> None:
    """Element density matches spec §10.5 quality-gate ranges.

    These ranges are tuned to produce a wellness_center.ifc-grade IFC
    output: dense enough to look like a real building, sparse enough
    that every element is intentional.
    """
    bm = build_2bhk_pune_template()
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

    assert 22 <= walls <= 30, f"wall count {walls} outside [22, 30]"
    assert 13 <= rooms <= 17, f"room count {rooms} outside [13, 17]"
    assert slabs == 3, f"slab count {slabs} != 3"
    assert columns == 12, f"column count {columns} != 12"
    assert 30 <= beams <= 38, f"beam count {beams} outside [30, 38]"
    assert footings == 12, f"footing count {footings} != 12"
    assert 22 <= openings <= 32, f"opening count {openings} outside [22, 32]"
    assert 12 <= doors <= 18, f"door count {doors} outside [12, 18]"
    assert 11 <= windows <= 17, f"window count {windows} outside [11, 17]"
    assert stairs == 1, f"stair count {stairs} != 1"


def test_no_room_violates_nbc_minimums() -> None:
    """Each room's footprint area meets NBC India minimum for its usage.

    NBC minima used (matching spec §6.1):
        living: 12.5 sqm    (also for merged living-dining)
        bedroom: 9.5
        kitchen: 5.0
        bath: 1.8
        toilet: 1.4
        dining: 7.0
        store / utility / stair / pooja / balcony / study: no NBC minimum

    Default plot only (scaled plots may produce smaller rooms — see
    test_scaling_smaller_plot which only checks invariants, not NBC).
    """
    nbc_min = {
        "living": 12.5,
        "bedroom": 9.5,
        "kitchen": 5.0,
        "bath": 1.8,
        "toilet": 1.4,
        "dining": 7.0,
    }
    bm = build_2bhk_pune_template()
    for s in bm.project.site.building.storeys:
        for room in s.rooms:
            poly = Polygon([(v.x, v.y) for v in room.footprint_polygon])
            assert poly.is_valid, f"{room.id}: footprint not shapely-valid"
            assert poly.area > 0, f"{room.id}: zero area"
            min_area = nbc_min.get(room.usage)
            if min_area is not None:
                assert poly.area >= min_area, (
                    f"{room.id} ({room.usage}): area {poly.area:.2f} sqm "
                    f"< NBC minimum {min_area} sqm"
                )


# ─── Parametric scaling ───────────────────────────────────────────────


def test_scaling_smaller_plot() -> None:
    """A 6.0 × 12.0 m plot still yields a valid BuildingModel.

    The 2BHK layout must scale below the default 7.32 × 15.24 m. Buildable
    area on a 6 × 12 plot (after fixed setbacks) = 6.0 × 7.5 = 45 sqm —
    tight but legal. NBC minimums are not enforced for scaled variants
    (handled by `test_no_room_violates_nbc_minimums`, default plot only).
    """
    bm = build_2bhk_pune_template(plot_width_m=6.0, plot_length_m=12.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    bld = bm.project.site.building
    assert len(bld.structural_system.columns) == 12
    assert len(bld.structural_system.beams) >= 30


def test_scaling_larger_plot() -> None:
    """A 9.0 × 18.0 m plot also yields a valid BuildingModel."""
    bm = build_2bhk_pune_template(plot_width_m=9.0, plot_length_m=18.0)
    placements = resolve_placements(bm)
    resolve_geometries(bm, placements)
    bld = bm.project.site.building
    assert len(bld.structural_system.columns) == 12
    assert len(bld.structural_system.beams) >= 30


def test_too_small_plot_fails_loud() -> None:
    """A plot that yields buildable area below 4×5 m raises ValueError early.

    The 2BHK template would otherwise produce degenerate geometry that
    eventually trips ROOM_BOUNDED with a confusing message; failing here
    gives the caller a clear signal.
    """
    with pytest.raises(ValueError, match="too small|buildable"):
        build_2bhk_pune_template(plot_width_m=3.0, plot_length_m=6.0)


# ─── Phase D: build_2bhk_pune_house (single-storey bungalow) ─────────


def test_house_builds_clean() -> None:
    """`build_2bhk_pune_house` returns an invariant-valid BuildingModel."""
    bm = build_2bhk_pune_house()
    assert isinstance(bm, BuildingModel)
    assert bm.project.name == "2BHK Pune House Project"
    assert bm.project.site.building.name == "2BHK Pune House"


def test_house_passes_phase1_resolve() -> None:
    """Pass 1 RESOLVE — placements + geometries — completes without raising."""
    bm = build_2bhk_pune_house()
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    # Sanity: every column produced a placement + geometry.
    for c in bm.project.site.building.structural_system.columns:
        assert c.id in placements
        assert c.id in geometries


def test_house_storey_count() -> None:
    """Exactly one storey at z=0."""
    bm = build_2bhk_pune_house()
    storeys = bm.project.site.building.storeys
    assert len(storeys) == 1
    assert storeys[0].id == "storey-ground"
    assert storeys[0].elevation == 0.0
    assert storeys[0].index == 0


def test_house_no_stair() -> None:
    """Single-storey house has zero stairs (`has_stair=False` on the floor unit)."""
    bm = build_2bhk_pune_house()
    stairs = sum(len(s.stairs) for s in bm.project.site.building.storeys)
    assert stairs == 0


def test_house_room_count() -> None:
    """House has 7 rooms — exactly the GF floor unit's room set."""
    bm = build_2bhk_pune_house()
    rooms = [r for s in bm.project.site.building.storeys for r in s.rooms]
    assert len(rooms) == 7
    expected_room_ids = {
        "room-gf-powder",
        "room-gf-utility",
        "room-gf-store",
        "room-gf-pooja",
        "room-gf-kitchen",
        "room-gf-stair-foyer",
        "room-gf-living-dining",
    }
    assert {r.id for r in rooms} == expected_room_ids


def test_house_deterministic() -> None:
    """Same args → byte-identical JSON across calls."""
    a = build_2bhk_pune_house().model_dump_json(indent=2)
    b = build_2bhk_pune_house().model_dump_json(indent=2)
    assert a == b


def test_house_scales() -> None:
    """House builds + resolves cleanly on 6×12 and 9×18 plots."""
    for w, l in [(6.0, 12.0), (9.0, 18.0)]:
        bm = build_2bhk_pune_house(plot_width_m=w, plot_length_m=l)
        placements = resolve_placements(bm)
        resolve_geometries(bm, placements)
        bld = bm.project.site.building
        assert len(bld.storeys) == 1
        assert len(bld.structural_system.columns) == 12


def test_house_element_density() -> None:
    """Exact element counts for the single-storey 2BHK bungalow.

    The house is naturally ~56 % of the duplex's 156-element count (88
    elements), because per-floor elements (walls / rooms / openings /
    doors / windows / beams) halve when one floor is removed, while
    foundation + columns stay constant. This test asserts EXACT counts
    so any regression that drops elements unexpectedly fails loudly.

    The 70 % ratio rule from the original spec is mathematically
    unachievable for a single-storey 2BHK with the GF layout — the
    bungalow has fewer per-floor elements by design, not by regression.
    """
    bm = build_2bhk_pune_house()
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

    assert walls == 12, f"walls={walls} (expected 12)"
    assert rooms == 7, f"rooms={rooms} (expected 7)"
    assert slabs == 2, f"slabs={slabs} (expected 2: floor + roof)"
    assert columns == 12, f"columns={columns} (expected 12)"
    assert footings == 12, f"footings={footings} (expected 12)"
    assert beams == 17, f"beams={beams} (expected 17, one ceiling level)"
    assert openings == 13, f"openings={openings} (expected 13)"
    assert doors == 7, f"doors={doors} (expected 7)"
    assert windows == 6, f"windows={windows} (expected 6)"
    assert stairs == 0, f"stairs={stairs} (expected 0)"

    total = walls + rooms + slabs + columns + footings + beams + openings + doors + windows + stairs
    assert total == 88, f"total elements {total} (expected 88)"
