"""Slice 2B.3 Phase A.1 — PLOT_POLYGON_VALID invariant tests.

The 13th BuildingModel invariant — added by Slice 2B.3 to support the
extension primitives (compound wall, gate, car porch, servant quarter)
that need a legal plot boundary distinct from the building envelope.

Back-compat contract (the most important property here): an empty
``Site.plot_polygon`` SKIPS the invariant entirely. Every pre-2B.3
template that does not populate ``plot_polygon`` continues to validate
against the original 12 invariants without surprise.
"""

from __future__ import annotations

import pytest

from app.domain.building_model import (
    Building,
    BuildingModel,
    BuildingModelValidationError,
    Project,
    ProjectMetadata,
    Provenance,
    Site,
    Storey,
    StructuralSystem,
    Vec2,
)


def _minimal_provenance() -> Provenance:
    return Provenance(
        input_contract_version="Tier2Template-1.0.0",
        target_fidelity="design-development",
        generated_at="2026-05-11T00:00:00Z",
        build_id="test",
        source_contract="BuildingModel",
    )


def _make_bm(
    *,
    plot_polygon: list[Vec2],
    envelope_polygon: list[Vec2],
) -> BuildingModel:
    """Construct a minimal BuildingModel with the given plot + envelope.

    Uses no rooms/walls/doors — purely exercises the structural shell so
    PLOT_POLYGON_VALID can be tested without dragging in the full 12
    other invariants. Storey is empty (allowed: rooms / walls have
    default_factory=list)."""
    storey = Storey(
        id="s-0",
        name="Ground",
        elevation=0.0,
        actual_height=3.0,
        index=0,
    )
    building = Building(
        id="b-1",
        name="Test",
        envelope_polygon=envelope_polygon,
        structural_system=StructuralSystem(),
        storeys=[storey],
    )
    site = Site(
        id="site-1",
        plot_polygon=plot_polygon,
        building=building,
    )
    project = Project(
        id="p-1",
        name="Test",
        site=site,
        metadata=ProjectMetadata(provenance=_minimal_provenance()),
    )
    return BuildingModel.build({"project": project.model_dump(mode="python")})


# Helper: a square envelope at (1,1)..(4,4) — fully inside a (0,0)..(5,5) plot.
_ENV_INSIDE = [
    Vec2(x=1.0, y=1.0),
    Vec2(x=4.0, y=1.0),
    Vec2(x=4.0, y=4.0),
    Vec2(x=1.0, y=4.0),
]
_PLOT_5x5 = [
    Vec2(x=0.0, y=0.0),
    Vec2(x=5.0, y=0.0),
    Vec2(x=5.0, y=5.0),
    Vec2(x=0.0, y=5.0),
]


# ─── Back-compat: empty plot polygon ────────────────────────────────


def test_empty_plot_polygon_skips_invariant() -> None:
    """The invariant must skip cleanly when plot_polygon is empty.

    This is THE back-compat contract — every pre-2B.3 template emits
    plot_polygon=[] and must still validate. The bigger 1764-baseline
    pytest run is the integration check; this is the unit-level
    proof that the empty path is not even attempted to be validated.
    """
    bm = _make_bm(plot_polygon=[], envelope_polygon=_ENV_INSIDE)
    assert bm.project.site.plot_polygon == []


def test_empty_plot_polygon_with_empty_envelope_passes() -> None:
    """Belt-and-suspenders: both empty also passes."""
    bm = _make_bm(plot_polygon=[], envelope_polygon=[])
    assert bm.project.site.plot_polygon == []


# ─── Sub-rule 1: polygon validity ───────────────────────────────────


def test_plot_polygon_with_two_vertices_fails() -> None:
    bad = [Vec2(x=0.0, y=0.0), Vec2(x=5.0, y=0.0)]
    with pytest.raises(BuildingModelValidationError) as exc:
        _make_bm(plot_polygon=bad, envelope_polygon=_ENV_INSIDE)
    assert exc.value.rule_id == "PLOT_POLYGON_VALID"
    assert "distinct" in exc.value.actual or "input" in exc.value.actual


def test_plot_polygon_with_clockwise_winding_fails() -> None:
    """CW (signed area < 0) must be rejected — adapter mirror logic
    relies on consistent CCW winding everywhere."""
    cw = [
        Vec2(x=0.0, y=0.0),
        Vec2(x=0.0, y=5.0),
        Vec2(x=5.0, y=5.0),
        Vec2(x=5.0, y=0.0),
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        _make_bm(plot_polygon=cw, envelope_polygon=_ENV_INSIDE)
    assert exc.value.rule_id == "PLOT_POLYGON_VALID"
    assert "counterclockwise" in exc.value.expected.lower()


def test_plot_polygon_self_intersecting_fails() -> None:
    """Bowtie polygon — shapely flags is_valid=False."""
    bowtie = [
        Vec2(x=0.0, y=0.0),
        Vec2(x=5.0, y=5.0),
        Vec2(x=5.0, y=0.0),
        Vec2(x=0.0, y=5.0),
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        _make_bm(plot_polygon=bowtie, envelope_polygon=_ENV_INSIDE)
    assert exc.value.rule_id == "PLOT_POLYGON_VALID"


# ─── Sub-rule 2: envelope-inside-plot containment ───────────────────


def test_envelope_outside_plot_fails() -> None:
    """Envelope at (10,10)..(20,20) does not fit inside a (0,0)..(5,5) plot."""
    far_envelope = [
        Vec2(x=10.0, y=10.0),
        Vec2(x=20.0, y=10.0),
        Vec2(x=20.0, y=20.0),
        Vec2(x=10.0, y=20.0),
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        _make_bm(plot_polygon=_PLOT_5x5, envelope_polygon=far_envelope)
    assert exc.value.rule_id == "PLOT_POLYGON_VALID"
    # Error must specify which vertex is outside (senior-engineer
    # specific-errors rule).
    assert "outside" in exc.value.actual or "exceed" in exc.value.actual.lower()


def test_envelope_partially_outside_plot_fails() -> None:
    """One vertex outside the plot — fails with that vertex's coords."""
    partial_envelope = [
        Vec2(x=1.0, y=1.0),
        Vec2(x=4.0, y=1.0),
        Vec2(x=4.0, y=4.0),
        Vec2(x=1.0, y=10.0),  # outside (plot ends at y=5)
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        _make_bm(plot_polygon=_PLOT_5x5, envelope_polygon=partial_envelope)
    assert exc.value.rule_id == "PLOT_POLYGON_VALID"
    assert "10" in exc.value.actual  # the offending y=10 should appear


def test_envelope_on_plot_boundary_passes() -> None:
    """Vertices sitting exactly on the plot boundary (zero side-setback
    case — common for 1BHK Pune templates) are allowed via the 1mm
    tolerance buffer."""
    on_boundary = [
        Vec2(x=0.0, y=0.0),
        Vec2(x=5.0, y=0.0),
        Vec2(x=5.0, y=5.0),
        Vec2(x=0.0, y=5.0),
    ]
    bm = _make_bm(plot_polygon=_PLOT_5x5, envelope_polygon=on_boundary)
    assert len(bm.project.site.plot_polygon) == 4


def test_empty_envelope_with_populated_plot_passes() -> None:
    """If envelope_polygon is empty, nothing to contain — pass."""
    bm = _make_bm(plot_polygon=_PLOT_5x5, envelope_polygon=[])
    assert len(bm.project.site.plot_polygon) == 4


def test_valid_plot_with_inside_envelope_passes() -> None:
    """Happy path — envelope fully inside plot."""
    bm = _make_bm(plot_polygon=_PLOT_5x5, envelope_polygon=_ENV_INSIDE)
    assert bm.project.site.plot_polygon == _PLOT_5x5
    assert bm.project.site.building.envelope_polygon == _ENV_INSIDE
