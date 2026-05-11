"""Slice 2B.3 Phase A.1 — Adapter must transform Site.plot_polygon.

The 2B.2 adapter pipeline already iterates terrain_polygon and
envelope_polygon under each transform. After 2B.3 it must also handle
plot_polygon — winding-aware (mirror reverses) — so that the
"extensions before adapter" pipeline order keeps the plot meaningful
in the user's transformed coordinate frame.

Coverage:
  * No-op plan returns identical model (back-compat path).
  * Mirror_X: plot rectangle reflects across x-centre and stays CCW.
  * Mirror_Y: same on y-axis.
  * Rotate 180: plot rectangle reflects through plot centre.
  * Empty plot polygon (towers) passes through unchanged.
  * After mirror, plot still passes PLOT_POLYGON_VALID (containment +
    CCW), because BuildingModel.build re-runs the invariants.
"""

from __future__ import annotations

from shapely.geometry import Point, Polygon

from app.domain.building_model import _signed_area
from app.services.design_agent.transforms import apply_adaptations
from app.services.design_agent.types import (
    AdaptationPlan,
    TransformAxis,
    TransformRotation,
)
from app.templates.tier2_3bhk_pune_house import build_3bhk_pune_house
from app.templates.tier2_3bhk_pune_tower import build_3bhk_pune_tower

# 3BHK Pune House plot dims — 11×20m rectangle.
_PW = 11.0
_PL = 20.0
_PLOT_AREA = _PW * _PL  # 220 sqm


def _plot_signed_area(bm) -> float:
    return _signed_area(list(bm.project.site.plot_polygon))


def _envelope_inside_plot(bm) -> bool:
    """All envelope vertices fall inside the plot polygon (1mm
    tolerance — the same machinery PLOT_POLYGON_VALID itself uses)."""
    plot = list(bm.project.site.plot_polygon)
    env = list(bm.project.site.building.envelope_polygon)
    if not plot or not env:
        return True
    shp = Polygon([(v.x, v.y) for v in plot]).buffer(0.001)
    return all(shp.contains(Point(v.x, v.y)) for v in env)


def test_noop_plan_preserves_plot_polygon_byte_identical() -> None:
    """A no-op plan returns the same Python object. plot_polygon
    survives because nothing was touched at all."""
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=None,
        rotation=TransformRotation.NONE,
        reasoning="no-op plan for plot polygon test",
    )
    out = apply_adaptations(bm, plan)
    # The 2B.2 adapter explicitly returns the input unchanged for no-op.
    assert out is bm
    assert out.project.site.plot_polygon == bm.project.site.plot_polygon


def test_mirror_x_preserves_plot_invariants() -> None:
    """Adapter anchors transforms at the building envelope's bbox
    centre (not the plot centre — that's the 2B.2 contract). After
    mirror_X, the plot polygon is reflected around the envelope x-
    centre and ends up at non-zero coordinates. The CRITICAL invariants
    that must hold:

      * 4 vertices preserved
      * CCW winding restored (mirror flips winding; ``_xform_polygon``
        reverses the vertex list to re-establish CCW)
      * Plot area preserved (rigid motion + reversal preserve area)
      * Envelope still contained in the (now-shifted) plot
    """
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=TransformAxis.X,
        rotation=TransformRotation.NONE,
        reasoning="mirror x for plot polygon test",
    )
    out = apply_adaptations(bm, plan)
    plot = out.project.site.plot_polygon
    assert len(plot) == 4
    assert _plot_signed_area(out) > 0  # CCW restored
    assert abs(_plot_signed_area(out) - _PLOT_AREA) < 1e-9  # area preserved
    assert _envelope_inside_plot(out)  # containment preserved


def test_mirror_y_preserves_plot_invariants() -> None:
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=TransformAxis.Y,
        rotation=TransformRotation.NONE,
        reasoning="mirror y for plot polygon test",
    )
    out = apply_adaptations(bm, plan)
    assert len(out.project.site.plot_polygon) == 4
    assert _plot_signed_area(out) > 0
    assert abs(_plot_signed_area(out) - _PLOT_AREA) < 1e-9
    assert _envelope_inside_plot(out)


def test_rotate_180_preserves_plot_invariants() -> None:
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=None,
        rotation=TransformRotation.CW_180,
        reasoning="rotate 180 for plot polygon test",
    )
    out = apply_adaptations(bm, plan)
    assert len(out.project.site.plot_polygon) == 4
    assert _plot_signed_area(out) > 0
    assert abs(_plot_signed_area(out) - _PLOT_AREA) < 1e-9
    assert _envelope_inside_plot(out)


def test_rotate_90_preserves_plot_invariants() -> None:
    """Rigid 90° rotation preserves area and CCW winding."""
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=None,
        rotation=TransformRotation.CW_90,
        reasoning="rotate 90 for plot polygon test",
    )
    out = apply_adaptations(bm, plan)
    assert _plot_signed_area(out) > 0
    assert abs(_plot_signed_area(out) - _PLOT_AREA) < 1e-9
    assert _envelope_inside_plot(out)


def test_tower_empty_plot_polygon_survives_mirror() -> None:
    """Empty plot_polygon (towers) passes through every transform
    unchanged — back-compat for the deferred tower-plot-semantics
    case."""
    bm = build_3bhk_pune_tower()
    assert bm.project.site.plot_polygon == []
    plan = AdaptationPlan(
        mirror_axis=TransformAxis.X,
        rotation=TransformRotation.CW_90,
        reasoning="mirror+rotate over empty plot",
    )
    out = apply_adaptations(bm, plan)
    assert out.project.site.plot_polygon == []


def test_mirror_then_rebuild_passes_plot_polygon_valid() -> None:
    """End-to-end proof: after the adapter mirrors the plot polygon and
    re-runs BuildingModel.build, PLOT_POLYGON_VALID still passes
    (because the `_xform_polygon` reversal restores CCW, and the
    envelope is symmetric enough that containment survives).

    This is the property that justifies "extensions before adapter" —
    plot stays valid through every transform."""
    bm = build_3bhk_pune_house()
    plan = AdaptationPlan(
        mirror_axis=TransformAxis.X,
        rotation=TransformRotation.CW_180,
        reasoning="combined mirror+rotate to maximally stress the plot transform",
    )
    out = apply_adaptations(bm, plan)
    # Construction succeeded → all 13 invariants passed.
    assert out is not None
    assert _signed_area(list(out.project.site.plot_polygon)) > 0
