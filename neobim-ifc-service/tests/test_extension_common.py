"""Slice 2B.3 Phase A.2 — extensions/_common.py helper tests."""

from __future__ import annotations

import pytest

from app.domain.building_model import Vec2
from app.services.design_agent.extensions._common import (
    NBC_MIN_AREA_SQM,
    ExtensionError,
    ExtensionIDCollisionError,
    ExtensionRequiresPlotError,
    collect_existing_ids,
    commit_to_storey,
    get_ground_storey,
    get_top_storey,
    make_ccw_rectangle,
    make_unique_id,
    nbc_min_area_for,
    polygon_area,
    polygon_inside_plot,
    require_plot_polygon,
)
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower


# ─── make_ccw_rectangle ──────────────────────────────────────────────


def test_make_ccw_rectangle_returns_4_ccw_vertices() -> None:
    rect = make_ccw_rectangle(0.0, 0.0, 10.0, 5.0)
    assert len(rect) == 4
    assert rect[0] == Vec2(x=0.0, y=0.0)
    assert rect[1] == Vec2(x=10.0, y=0.0)
    assert rect[2] == Vec2(x=10.0, y=5.0)
    assert rect[3] == Vec2(x=0.0, y=5.0)
    assert polygon_area(rect) == 50.0


def test_make_ccw_rectangle_rejects_zero_width() -> None:
    with pytest.raises(ValueError):
        make_ccw_rectangle(5.0, 0.0, 5.0, 5.0)


def test_make_ccw_rectangle_rejects_inverted_bounds() -> None:
    with pytest.raises(ValueError):
        make_ccw_rectangle(10.0, 0.0, 0.0, 5.0)


# ─── polygon_inside_plot ─────────────────────────────────────────────


def test_polygon_inside_plot_empty_plot_returns_true() -> None:
    """Empty plot disables containment — back-compat with towers."""
    inner = make_ccw_rectangle(1.0, 1.0, 4.0, 4.0)
    assert polygon_inside_plot(inner, []) is True


def test_polygon_inside_plot_inside_returns_true() -> None:
    plot = make_ccw_rectangle(0.0, 0.0, 10.0, 10.0)
    inner = make_ccw_rectangle(1.0, 1.0, 9.0, 9.0)
    assert polygon_inside_plot(inner, plot) is True


def test_polygon_inside_plot_outside_returns_false() -> None:
    plot = make_ccw_rectangle(0.0, 0.0, 10.0, 10.0)
    far = make_ccw_rectangle(20.0, 20.0, 30.0, 30.0)
    assert polygon_inside_plot(far, plot) is False


def test_polygon_inside_plot_boundary_within_tolerance() -> None:
    plot = make_ccw_rectangle(0.0, 0.0, 10.0, 10.0)
    edge = [Vec2(x=0.0, y=0.0), Vec2(x=10.0, y=0.0), Vec2(x=10.0, y=10.0)]
    # All vertices on plot boundary — must be treated as "inside" via
    # the 1mm buffer tolerance.
    assert polygon_inside_plot(edge, plot) is True


# ─── ID generation ───────────────────────────────────────────────────


def test_collect_existing_ids_walks_3bhk_house() -> None:
    bm = build_3bhk_pune_house()
    ids = collect_existing_ids(bm)
    # Spot-check expected presences from earlier diagnostic.
    assert "site-1" in ids
    assert "building-1" in ids
    assert "storey-ground" in ids
    assert "wall-gf-N" in ids
    assert "slab-ground" in ids
    # All collected ids are non-empty strings.
    assert all(isinstance(i, str) and i for i in ids)


def test_make_unique_id_avoids_collision() -> None:
    existing = {"foo-1", "foo-2"}
    new1 = make_unique_id("foo", existing)
    assert new1 == "foo-3"
    assert "foo-3" in existing  # mutated set
    new2 = make_unique_id("foo", existing)
    assert new2 == "foo-4"


def test_make_unique_id_first_use_when_no_collision() -> None:
    existing: set[str] = set()
    assert make_unique_id("ext-compound-S", existing) == "ext-compound-S-1"


# ─── NBC lookup ──────────────────────────────────────────────────────


def test_nbc_min_area_for_known_usage() -> None:
    """Values match the authoritative source at
    reference_data/nbc_india_minimums.py. Drift is detected by
    test_nbc_lookup_matches_authoritative_source in test_phase_a4_matrix.py."""
    assert nbc_min_area_for("bedroom") == 7.5         # NBC Part 4 §3.4 (2nd bedroom)
    assert nbc_min_area_for("master_bedroom") == 9.5  # NBC Part 4 §3.4 (primary bedroom)
    assert nbc_min_area_for("bathroom") == 1.8        # NBC Part 4 §3.6


def test_nbc_min_area_for_unknown_returns_zero() -> None:
    """Unknown usages return 0.0 — no fabrication."""
    assert nbc_min_area_for("definitely-not-a-real-usage") == 0.0


def test_nbc_lookup_table_covers_residential_usages() -> None:
    """Every residential usage referenced by extensions has an entry."""
    for usage in [
        "living", "dining", "kitchen", "bedroom", "master_bedroom",
        "bathroom", "powder_room", "study", "store", "balcony",
        "utility", "external", "pooja_room",
    ]:
        assert usage in NBC_MIN_AREA_SQM, f"{usage} missing from NBC lookup"


# ─── Storey accessors ────────────────────────────────────────────────


def test_get_ground_storey_returns_index_0() -> None:
    bm = build_3bhk_pune_house()
    ground = get_ground_storey(bm)
    assert ground.index == 0


def test_get_top_storey_returns_highest_index() -> None:
    bm = build_3bhk_pune_house()
    top = get_top_storey(bm)
    # 3BHK Pune House is single-storey — top == ground.
    assert top.index == 0


# ─── require_plot_polygon ───────────────────────────────────────────


def test_require_plot_polygon_returns_plot_for_house() -> None:
    bm = build_3bhk_pune_house()
    plot = require_plot_polygon(bm, "test-extension")
    assert len(plot) == 4


def test_require_plot_polygon_raises_for_tower() -> None:
    bm = build_3bhk_pune_tower()
    with pytest.raises(ExtensionRequiresPlotError) as exc:
        require_plot_polygon(bm, "test-extension")
    assert exc.value.extension_type == "test-extension"
    assert "plot_polygon is empty" in exc.value.reason


# ─── commit_to_storey ────────────────────────────────────────────────


def test_commit_to_storey_no_op_returns_valid_model() -> None:
    """No additions still re-validates and returns a fresh model."""
    bm = build_3bhk_pune_house()
    out = commit_to_storey(bm, storey_index=0)
    # Should be a brand-new object (not the input).
    assert out is not bm
    # All 13 invariants pass (otherwise build() would have raised).
    assert out.project.site.plot_polygon == bm.project.site.plot_polygon


def test_commit_to_storey_unknown_storey_raises() -> None:
    bm = build_3bhk_pune_house()
    with pytest.raises(ExtensionError) as exc:
        commit_to_storey(bm, storey_index=99)
    assert "no storey at index=99" in exc.value.reason
