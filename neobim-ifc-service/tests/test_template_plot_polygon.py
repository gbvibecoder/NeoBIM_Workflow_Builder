"""Slice 2B.3 Phase A.1 — Per-template Site.plot_polygon checks.

For all 9 Tier-2 builders:
  * House / duplex (6 builders) MUST emit a non-empty CCW plot polygon
    that fully contains the building envelope.
  * Tower (3 builders) MUST emit an empty plot polygon — tower-plot
    semantics are deferred to a future slice (the lift/stair core
    extends the building envelope past plot_width_m, so a naive
    rectangular plot would fail PLOT_POLYGON_VALID's containment).

These tests are the structural proof that the backfill is complete and
the invariant is back-compat-safe.
"""

from __future__ import annotations

import pytest
from shapely.geometry import Point, Polygon

from app.domain.building_model import _signed_area
from app.templates.tier2_1bhk_pune import build_1bhk_pune_duplex
from app.templates.tier2_1bhk_pune_house import build_1bhk_pune_house
from app.templates.tier2_1bhk_pune_tower import build_1bhk_pune_tower
from app.templates.tier2_2bhk_pune import build_2bhk_pune_duplex
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower
from app.templates.tier2_3bhk_pune import build_3bhk_pune_duplex
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower

# (label, builder, expected_plot_dims) — None for towers (empty plot).
HOUSE_DUPLEX = [
    ("1bhk-house", build_1bhk_pune_house, (7.32, 12.20)),
    ("1bhk-duplex", build_1bhk_pune_duplex, (7.32, 12.20)),
    ("2bhk-house", build_2bhk_pune_house, (7.32, 15.24)),
    ("2bhk-duplex", build_2bhk_pune_duplex, (7.32, 15.24)),
    ("3bhk-house", build_3bhk_pune_house, (11.0, 20.0)),
    ("3bhk-duplex", build_3bhk_pune_duplex, (11.0, 20.0)),
]
TOWERS = [
    ("1bhk-tower", build_1bhk_pune_tower),
    ("2bhk-tower", build_2bhk_pune_tower),
    ("3bhk-tower", build_3bhk_pune_tower),
]


@pytest.mark.parametrize("label,builder,dims", HOUSE_DUPLEX)
def test_house_duplex_emits_valid_plot_polygon(label, builder, dims) -> None:
    bm = builder()
    plot = bm.project.site.plot_polygon
    expected_w, expected_l = dims

    # 4 vertices forming a rectangle anchored at (0,0).
    assert len(plot) == 4, f"{label}: plot polygon should have 4 vertices"
    xs = sorted({v.x for v in plot})
    ys = sorted({v.y for v in plot})
    assert xs == [0.0, expected_w], f"{label}: plot x range ≠ [0, {expected_w}]"
    assert ys == [0.0, expected_l], f"{label}: plot y range ≠ [0, {expected_l}]"

    # CCW winding — adapter mirror logic depends on this.
    assert _signed_area(list(plot)) > 0, f"{label}: plot must be CCW"


@pytest.mark.parametrize("label,builder,dims", HOUSE_DUPLEX)
def test_house_duplex_envelope_inside_plot(label, builder, dims) -> None:
    """Sub-rule 2 of PLOT_POLYGON_VALID, exercised template-by-template."""
    bm = builder()
    plot = bm.project.site.plot_polygon
    envelope = bm.project.site.building.envelope_polygon

    shp_plot = Polygon([(v.x, v.y) for v in plot]).buffer(0.001)
    for v in envelope:
        assert shp_plot.contains(Point(v.x, v.y)), (
            f"{label}: envelope vertex ({v.x:.3f}, {v.y:.3f}) escaped plot"
        )


@pytest.mark.parametrize("label,builder", TOWERS)
def test_tower_emits_empty_plot_polygon(label, builder) -> None:
    """Tower templates MUST leave plot_polygon empty (back-compat path).

    The combined_envelope's east edge sits at core_x_max =
    plot_width_m + _CORE_WIDTH_M, which exceeds plot_width_m. A naive
    plot rectangle would fail PLOT_POLYGON_VALID containment, so the
    template intentionally skips the invariant via the empty-list
    back-compat clause."""
    bm = builder()
    assert bm.project.site.plot_polygon == [], (
        f"{label}: tower must emit empty plot_polygon (deferred-items "
        "registry — tower-plot semantics)"
    )


@pytest.mark.parametrize(
    "label,builder",
    [(l, b) for l, b, _ in HOUSE_DUPLEX] + [(l, b) for l, b in TOWERS],
)
def test_all_templates_still_validate_under_13_invariants(label, builder) -> None:
    """Every template must still construct a valid BuildingModel under
    the new 13-invariant set. Constructing the BuildingModel via the
    builder is itself the assertion — the @model_validator runs all
    invariants and raises on failure."""
    bm = builder()
    assert bm is not None  # construction succeeded; invariants passed
