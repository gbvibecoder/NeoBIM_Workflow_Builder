"""Slice 2B.3 Phase A.2 — compound_wall extension tests.

Compound wall is the simplest of the five extensions: 4 perimeter
brick walls, no rooms, no doors, no NBC validation. Tests cover:

  * Per-property contracts (4 walls added, on ground storey, correct
    geometry, all 13 invariants still pass).
  * Per-template matrix: every house/duplex builder accepts the
    extension cleanly. Towers refuse with ExtensionRequiresPlotError.
  * Stacking: extensions are applied in template-space; calling the
    function twice causes ID collision (DUPLICATE_WALL_ID) — caller
    (orchestrator) is responsible for at-most-once application.
"""

from __future__ import annotations

import pytest

from app.services.design_agent.extensions._common import (
    ExtensionRequiresPlotError,
)
from app.services.design_agent.extensions.compound_wall import (
    DEFAULT_HEIGHT_M,
    add_compound_wall,
)
from app.templates.tier2_1bhk_pune import build_1bhk_pune_duplex
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house
from app.templates.tier2_1bhk_pune_tower import build_1bhk_pune_tower
from app.templates.tier2_2bhk_pune import build_2bhk_pune_duplex
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower
from app.templates.tier2_3bhk_pune import build_3bhk_pune_duplex
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower

HOUSE_DUPLEX = [
    ("1bhk-house", build_1bhk_pune_house),
    ("1bhk-duplex", build_1bhk_pune_duplex),
    ("2bhk-house", build_2bhk_pune_house),
    ("2bhk-duplex", build_2bhk_pune_duplex),
    ("3bhk-house", build_3bhk_pune_house),
    ("3bhk-duplex", build_3bhk_pune_duplex),
]
TOWERS = [
    ("1bhk-tower", build_1bhk_pune_tower),
    ("2bhk-tower", build_2bhk_pune_tower),
    ("3bhk-tower", build_3bhk_pune_tower),
]


# ─── Per-property tests on 3BHK House baseline ──────────────────────


def test_compound_wall_adds_exactly_4_walls() -> None:
    bm = build_3bhk_pune_house()
    before_walls = len(bm.project.site.building.storeys[0].walls)
    out = add_compound_wall(bm)
    after_walls = len(out.project.site.building.storeys[0].walls)
    assert after_walls - before_walls == 4


def test_compound_wall_walls_named_with_ext_prefix() -> None:
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    new_wall_ids = {
        w.id for w in out.project.site.building.storeys[0].walls
    } - {w.id for w in bm.project.site.building.storeys[0].walls}
    assert len(new_wall_ids) == 4
    for wid in new_wall_ids:
        assert wid.startswith("ext-compound-"), f"unexpected id {wid}"


def test_compound_wall_walls_at_default_height() -> None:
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    new_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    for w in new_walls:
        assert w.base_z == 0.0
        assert abs(w.top_z - DEFAULT_HEIGHT_M) < 1e-9


def test_compound_wall_walls_have_230mm_thickness() -> None:
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    for w in out.project.site.building.storeys[0].walls:
        if w.id.startswith("ext-compound-"):
            assert abs(w.thickness - 0.230) < 1e-9
            assert w.is_external
            assert not w.is_load_bearing  # boundary walls are not load-bearing
            assert w.type == "solid"


def test_compound_wall_walls_traverse_plot_perimeter_ccw() -> None:
    """The 4 walls should walk the plot CCW: SW→SE (south),
    SE→NE (east), NE→NW (north), NW→SW (west)."""
    bm = build_3bhk_pune_house()
    plot = bm.project.site.plot_polygon
    xs = sorted({v.x for v in plot})
    ys = sorted({v.y for v in plot})
    x_min, x_max = xs
    y_min, y_max = ys

    out = add_compound_wall(bm)
    walls_by_dir: dict[str, list] = {}
    for w in out.project.site.building.storeys[0].walls:
        if not w.id.startswith("ext-compound-"):
            continue
        direction = w.id.split("-")[2]  # ext-compound-S-1 -> S
        walls_by_dir[direction] = list(w.axis_points)

    assert set(walls_by_dir) == {"S", "E", "N", "W"}
    # South wall: SW → SE (y=y_min, x increasing).
    sw, se = walls_by_dir["S"]
    assert sw.x == x_min and sw.y == y_min
    assert se.x == x_max and se.y == y_min
    # East wall: SE → NE.
    ese, ene = walls_by_dir["E"]
    assert ese.x == x_max and ese.y == y_min
    assert ene.x == x_max and ene.y == y_max
    # North wall: NE → NW (x decreasing).
    nne, nnw = walls_by_dir["N"]
    assert nne.x == x_max and nne.y == y_max
    assert nnw.x == x_min and nnw.y == y_max
    # West wall: NW → SW.
    wnw, wsw = walls_by_dir["W"]
    assert wnw.x == x_min and wnw.y == y_max
    assert wsw.x == x_min and wsw.y == y_min


def test_compound_wall_re_validates_under_13_invariants() -> None:
    """The returned BuildingModel construction itself proves all 13
    invariants hold (BuildingModel.build raises on any failure)."""
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    assert out is not None
    # Sanity: the same plot polygon is preserved.
    assert out.project.site.plot_polygon == bm.project.site.plot_polygon


def test_compound_wall_custom_height_respected() -> None:
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm, height_m=1.5)
    new_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    for w in new_walls:
        assert abs(w.top_z - 1.5) < 1e-9


def test_compound_wall_returns_fresh_model_object() -> None:
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    assert out is not bm  # frozen-graph rebuild produces a new object


# ─── Template × extension matrix (house/duplex) ─────────────────────


@pytest.mark.parametrize("label,builder", HOUSE_DUPLEX)
def test_compound_wall_applies_to_every_house_duplex(label, builder) -> None:
    bm = builder()
    out = add_compound_wall(bm)
    new_walls = [
        w
        for w in out.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(new_walls) == 4, f"{label}: expected 4 new walls"


# ─── Towers refuse (deferred per option (i)) ────────────────────────


@pytest.mark.parametrize("label,builder", TOWERS)
def test_compound_wall_refuses_towers(label, builder) -> None:
    bm = builder()
    with pytest.raises(ExtensionRequiresPlotError) as exc:
        add_compound_wall(bm)
    assert exc.value.extension_type == "compound_wall"
    assert "plot_polygon is empty" in exc.value.reason


# ─── Idempotency / double-call ──────────────────────────────────────


def test_compound_wall_double_call_succeeds_via_unique_ids() -> None:
    """A second call adds 4 MORE walls with -2 suffixes (because
    make_unique_id increments past existing -1 ids). That's not the
    intended use — the orchestrator applies each extension at most
    once — but the function itself must not crash on double-call."""
    bm = build_3bhk_pune_house()
    once = add_compound_wall(bm)
    twice = add_compound_wall(once)
    new_walls = [
        w
        for w in twice.project.site.building.storeys[0].walls
        if w.id.startswith("ext-compound-")
    ]
    assert len(new_walls) == 8  # 4 from first call + 4 from second
    # Second batch has -2 suffix.
    suffixes_2 = [w.id for w in new_walls if w.id.endswith("-2")]
    assert len(suffixes_2) == 4


# ─── Plot polygon survives the extension ────────────────────────────


def test_compound_wall_preserves_envelope_polygon() -> None:
    """Compound wall must NOT modify Building.envelope_polygon; it
    only adds perimeter walls. Verifies the model_copy cascade only
    touched .storeys[].walls."""
    bm = build_3bhk_pune_house()
    out = add_compound_wall(bm)
    assert (
        out.project.site.building.envelope_polygon
        == bm.project.site.building.envelope_polygon
    )


def test_compound_wall_preserves_existing_doors_count() -> None:
    bm = build_3bhk_pune_house()
    before = len(bm.project.site.building.doors)
    out = add_compound_wall(bm)
    after = len(out.project.site.building.doors)
    assert after == before  # compound wall does not add doors
