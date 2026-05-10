"""Slice 2B.1 — TemplateId → builder dispatcher tests.

The dispatcher is the only place a TemplateId enum value is resolved
back to an :mod:`app.templates` callable. These tests pin three
contracts:

1. **Coverage** — every TemplateId enum value resolves to a valid
   BuildingModel. No silent KeyError, no missing builder.
2. **Parameter passthrough** — overrides on
   :class:`TemplateParameters` reach the underlying builder. We assert
   on observable BuildingModel state (envelope bounding box, ReraData,
   storey count) rather than mocking the builder, so a regression in
   the parameter-name reconciliation surfaces immediately.
3. **Family branching** — duplex builders see ``floor_to_floor_m``,
   house + tower see ``floor_height``; tower-only fields are silently
   ignored for non-tower templates.
"""

from __future__ import annotations

import pytest

from app.domain.building_model import BuildingModel
from app.services.design_agent import (
    MatchResult,
    TemplateId,
    TemplateParameters,
    dispatch_match,
    dispatch_template,
)
from app.services.design_agent import template_dispatcher as td


# Default plot a Tier-2 builder always accepts. 1BHK / 2BHK builders
# default to 7.32 m wide; 3BHK to 11.0 m. We use family-specific defaults
# below so each dispatcher call hits the builder's "happy path" footprint
# and we get a clean BuildingModel back without size-related invariant
# failures.
_FAMILY_DEFAULT_PLOT: dict[TemplateId, tuple[float, float]] = {
    TemplateId.BHK1_PUNE_HOUSE: (7.32, 12.20),
    TemplateId.BHK1_PUNE_DUPLEX: (7.32, 12.20),
    TemplateId.BHK1_PUNE_TOWER: (7.32, 12.20),
    TemplateId.BHK2_PUNE_HOUSE: (7.32, 15.24),
    TemplateId.BHK2_PUNE_DUPLEX: (7.32, 15.24),
    TemplateId.BHK2_PUNE_TOWER: (7.32, 15.24),
    TemplateId.BHK3_PUNE_HOUSE: (11.0, 20.0),
    TemplateId.BHK3_PUNE_DUPLEX: (11.0, 20.0),
    TemplateId.BHK3_PUNE_TOWER: (11.0, 20.0),
}


def _default_params_for(template_id: TemplateId) -> TemplateParameters:
    """Build a TemplateParameters that the given builder will accept
    without invariant violations."""
    plot_w, plot_l = _FAMILY_DEFAULT_PLOT[template_id]
    return TemplateParameters(
        plot_width_m=plot_w,
        plot_length_m=plot_l,
    )


def _envelope_bbox(bm: BuildingModel) -> tuple[float, float, float, float]:
    """Min / max x and y of the building's envelope polygon."""
    poly = bm.project.site.building.envelope_polygon
    xs = [p.x for p in poly]
    ys = [p.y for p in poly]
    return (min(xs), min(ys), max(xs), max(ys))


# ─── Coverage: every TemplateId resolves ─────────────────────────────


@pytest.mark.parametrize("template_id", list(TemplateId), ids=lambda t: t.value)
def test_dispatcher_resolves_every_template_id(template_id: TemplateId) -> None:
    """Each enum value dispatches to a builder that returns a
    BuildingModel passing all 12 Phase-1 invariants. Failure here means
    either a builder import is broken or the enum has drifted ahead of
    the dispatcher map.
    """
    params = _default_params_for(template_id)
    bm = dispatch_template(template_id, params)
    assert isinstance(bm, BuildingModel)


@pytest.mark.parametrize("template_id", list(TemplateId), ids=lambda t: t.value)
def test_dispatcher_via_match_result(template_id: TemplateId) -> None:
    """``dispatch_match`` is the convenience wrapper the route handler
    uses. It must produce the same BuildingModel as
    ``dispatch_template``. We don't compare BuildingModels directly
    (frozen-Pydantic byte-identical equality is sensitive to provenance
    timestamps); structural identity (storey count + envelope) is
    sufficient."""
    params = _default_params_for(template_id)
    result = MatchResult(
        template_id=template_id,
        parameters=params,
        confidence=0.95,
        reasoning="dispatcher coverage test fixture",
    )
    bm = dispatch_match(result)
    assert isinstance(bm, BuildingModel)
    direct = dispatch_template(template_id, params)
    assert (
        len(bm.project.site.building.storeys)
        == len(direct.project.site.building.storeys)
    )
    assert _envelope_bbox(bm) == pytest.approx(_envelope_bbox(direct))


# ─── Parameter passthrough: plot dimensions ──────────────────────────


def test_dispatcher_passes_plot_width_through_to_house() -> None:
    """A wider plot_width_m on TemplateParameters expands the envelope
    bounding box of the resulting BuildingModel."""
    narrow = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    wide = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(plot_width_m=8.5, plot_length_m=15.24),
    )
    nx0, _, nx1, _ = _envelope_bbox(narrow)
    wx0, _, wx1, _ = _envelope_bbox(wide)
    assert (wx1 - wx0) > (nx1 - nx0), (
        f"wider plot did not produce wider envelope: "
        f"narrow span={nx1 - nx0:.3f} m, wide span={wx1 - wx0:.3f} m"
    )


def test_dispatcher_passes_plot_length_through_to_duplex() -> None:
    """A longer plot_length_m on TemplateParameters expands the envelope
    bounding box of the duplex (where the parameter rename
    floor_height_m → floor_to_floor_m happens)."""
    short = dispatch_template(
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    long_ = dispatch_template(
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateParameters(plot_width_m=7.32, plot_length_m=17.0),
    )
    _, sy0, _, sy1 = _envelope_bbox(short)
    _, ly0, _, ly1 = _envelope_bbox(long_)
    assert (ly1 - ly0) > (sy1 - sy0), (
        f"longer plot did not produce longer envelope: "
        f"short span={sy1 - sy0:.3f} m, long span={ly1 - ly0:.3f} m"
    )


# ─── Parameter passthrough: site context ─────────────────────────────


@pytest.mark.parametrize(
    "seismic_zone", ["II", "III", "IV", "V"], ids=lambda z: f"seismic_{z}"
)
def test_dispatcher_passes_seismic_zone_to_rera_data(seismic_zone: str) -> None:
    """``seismic_zone`` propagates to ReraData on the house builder.

    The builder records seismic_zone on bm.project.metadata.rera; the
    dispatcher must pass it verbatim, not silently normalise to the
    default 'III'.
    """
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            seismic_zone=seismic_zone,  # type: ignore[arg-type]
        ),
    )
    rera = bm.project.metadata.rera
    assert rera is not None
    assert rera.seismic_zone == seismic_zone


@pytest.mark.parametrize("wind_zone", [1, 2, 3, 4, 5, 6], ids=lambda z: f"wind_{z}")
def test_dispatcher_passes_wind_zone_to_rera_data(wind_zone: int) -> None:
    """``wind_zone`` propagates to ReraData."""
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(
            plot_width_m=7.32, plot_length_m=15.24, wind_zone=wind_zone
        ),
    )
    rera = bm.project.metadata.rera
    assert rera is not None
    assert rera.wind_zone == wind_zone


# ─── Parameter passthrough: floor-height name reconciliation ─────────


def test_dispatcher_translates_floor_height_to_floor_to_floor_m_for_duplex() -> None:
    """Duplex builders accept ``floor_to_floor_m``; the dispatcher must
    forward TemplateParameters.floor_height_m under that name. We assert
    indirectly by checking the storey-1 elevation matches the requested
    floor height (the only storey-2 construction uses floor_to_floor_m
    as the elevation increment).
    """
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateParameters(
            plot_width_m=7.32, plot_length_m=15.24, floor_height_m=3.4
        ),
    )
    storeys = bm.project.site.building.storeys
    assert len(storeys) >= 2, "duplex must have at least 2 storeys"
    # storey 0 is at elevation 0; storey 1 at 1 * floor_height
    storey_elevations = sorted(s.elevation for s in storeys)
    delta = storey_elevations[1] - storey_elevations[0]
    assert delta == pytest.approx(3.4, abs=1e-3), (
        f"duplex storey-1 elevation increment = {delta:.3f} m; "
        f"expected 3.4 m (floor_height_m passthrough as floor_to_floor_m)"
    )


def test_dispatcher_translates_floor_height_for_house() -> None:
    """House builders accept ``floor_height``; the dispatcher must
    forward under that name. We assert via Storey.actual_height (the
    storey's vertical extent, set from floor_height by the builder).
    """
    bm_a = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(
            plot_width_m=7.32, plot_length_m=15.24, floor_height_m=3.0
        ),
    )
    bm_b = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(
            plot_width_m=7.32, plot_length_m=15.24, floor_height_m=3.6
        ),
    )
    a_h = bm_a.project.site.building.storeys[0].actual_height
    b_h = bm_b.project.site.building.storeys[0].actual_height
    assert b_h > a_h, (
        f"house with taller floor_height did not propagate to "
        f"Storey.actual_height: 3.0m -> {a_h:.3f}, 3.6m -> {b_h:.3f}"
    )
    # Tighter — the builder pins actual_height to floor_height directly.
    assert a_h == pytest.approx(3.0, abs=0.05)
    assert b_h == pytest.approx(3.6, abs=0.05)


# ─── Parameter passthrough: tower-only fields ────────────────────────


def test_dispatcher_passes_habitable_floor_count_to_tower() -> None:
    """Increasing ``habitable_floor_count`` increases the tower's
    storey count (one storey per habitable floor + 1 stilt by default).
    """
    short_tower = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=5,
        ),
    )
    tall_tower = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=11,
        ),
    )
    short_storeys = len(short_tower.project.site.building.storeys)
    tall_storeys = len(tall_tower.project.site.building.storeys)
    assert tall_storeys > short_storeys, (
        f"habitable_floor_count override did not increase storey count: "
        f"5 -> {short_storeys} storeys, 11 -> {tall_storeys} storeys"
    )
    # Specifically, +6 habitable floors → +6 storeys.
    assert tall_storeys - short_storeys == 6


def test_dispatcher_passes_has_stilt_parking_to_tower() -> None:
    """Disabling ``has_stilt_parking`` removes the stilt storey, so
    a tower with the same habitable_floor_count has one fewer storey.
    """
    with_stilt = dispatch_template(
        TemplateId.BHK1_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=12.20,
            habitable_floor_count=5,
            has_stilt_parking=True,
        ),
    )
    no_stilt = dispatch_template(
        TemplateId.BHK1_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=12.20,
            habitable_floor_count=5,
            has_stilt_parking=False,
        ),
    )
    assert (
        len(with_stilt.project.site.building.storeys)
        == len(no_stilt.project.site.building.storeys) + 1
    )


def test_dispatcher_passes_stilt_height_to_tower() -> None:
    """``stilt_height_m`` overrides the stilt storey's storey-elevation
    delta. We pick a non-default height so a passthrough bug surfaces
    as a divergent storey-1 elevation.
    """
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=3,
            has_stilt_parking=True,
            stilt_height_m=3.0,  # non-default (default 2.7)
        ),
    )
    storeys = sorted(
        bm.project.site.building.storeys, key=lambda s: s.elevation
    )
    # storey[0] is stilt at 0; storey[1] is first habitable at stilt_height
    delta = storeys[1].elevation - storeys[0].elevation
    assert delta == pytest.approx(3.0, abs=1e-3), (
        f"stilt_height_m passthrough broken: stilt → habitable delta = "
        f"{delta:.3f} m (expected 3.0)"
    )


# ─── Family branching: tower-only params ignored for non-tower ───────


def test_dispatcher_ignores_tower_only_params_for_house() -> None:
    """Setting habitable_floor_count / has_stilt_parking / stilt_height_m
    on a non-tower TemplateParameters must NOT raise — the dispatcher
    branches on family and silently drops these for house / duplex.
    """
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_HOUSE,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=11,
            has_stilt_parking=True,
            stilt_height_m=3.0,
        ),
    )
    # Single-storey house regardless of tower fields.
    assert len(bm.project.site.building.storeys) == 1


def test_dispatcher_ignores_tower_only_params_for_duplex() -> None:
    """Same as above but for duplex (which uses floor_to_floor_m and
    therefore exercises the alternate kwarg-renaming branch)."""
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=23,
            has_stilt_parking=True,
            stilt_height_m=2.7,
        ),
    )
    # Duplex is always G+1 (two habitable storeys).
    assert len(bm.project.site.building.storeys) == 2


def test_dispatcher_ignores_has_balcony_in_phase_2b1() -> None:
    """has_balcony is reserved for slice 2B.2 — the dispatcher in this
    slice must produce identical structural output regardless of the
    flag's value.
    """
    a = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=5,
            has_balcony=None,
        ),
    )
    b = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=5,
            has_balcony=True,
        ),
    )
    c = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=5,
            has_balcony=False,
        ),
    )
    # Identical storey count and envelope across all three.
    a_storeys = len(a.project.site.building.storeys)
    assert a_storeys == len(b.project.site.building.storeys)
    assert a_storeys == len(c.project.site.building.storeys)
    assert _envelope_bbox(a) == pytest.approx(_envelope_bbox(b))
    assert _envelope_bbox(a) == pytest.approx(_envelope_bbox(c))


# ─── Error path: unknown TemplateId ──────────────────────────────────


def test_dispatcher_raises_keyerror_when_builder_missing() -> None:
    """A drifted enum (id present in TemplateId but missing from
    _BUILDER_MAP) surfaces as a KeyError naming every covered id, not
    a silent None or ImportError. Simulated by popping a real entry
    from the map.
    """
    real_id = TemplateId.BHK1_PUNE_HOUSE
    saved_builder = td._BUILDER_MAP.pop(real_id)
    try:
        with pytest.raises(KeyError, match="No builder registered"):
            dispatch_template(
                real_id,
                TemplateParameters(plot_width_m=7.32, plot_length_m=12.20),
            )
    finally:
        td._BUILDER_MAP[real_id] = saved_builder


# ─── TemplateParameters validation ───────────────────────────────────


def test_template_parameters_rejects_zero_plot_width() -> None:
    """plot_width_m must be > 0 — Pydantic Field(gt=0) constraint."""
    with pytest.raises(Exception):  # pydantic.ValidationError
        TemplateParameters(plot_width_m=0.0, plot_length_m=10.0)


def test_template_parameters_rejects_negative_plot_length() -> None:
    with pytest.raises(Exception):
        TemplateParameters(plot_width_m=10.0, plot_length_m=-1.0)


def test_template_parameters_rejects_invalid_seismic_zone() -> None:
    """SeismicZone is Literal['II', 'III', 'IV', 'V']."""
    with pytest.raises(Exception):
        TemplateParameters(
            plot_width_m=10.0,
            plot_length_m=10.0,
            seismic_zone="VI",  # type: ignore[arg-type]
        )


def test_template_parameters_rejects_wind_zone_out_of_range() -> None:
    """Wind zone is 1-6 inclusive."""
    with pytest.raises(Exception):
        TemplateParameters(plot_width_m=10.0, plot_length_m=10.0, wind_zone=0)
    with pytest.raises(Exception):
        TemplateParameters(plot_width_m=10.0, plot_length_m=10.0, wind_zone=7)


def test_template_parameters_rejects_habitable_floor_count_out_of_range() -> None:
    """habitable_floor_count is 1-30 inclusive."""
    with pytest.raises(Exception):
        TemplateParameters(
            plot_width_m=10.0, plot_length_m=10.0, habitable_floor_count=0
        )
    with pytest.raises(Exception):
        TemplateParameters(
            plot_width_m=10.0, plot_length_m=10.0, habitable_floor_count=31
        )


def test_template_parameters_is_frozen() -> None:
    """frozen=True so callers cannot mutate after creation."""
    p = TemplateParameters(plot_width_m=10.0, plot_length_m=10.0)
    with pytest.raises(Exception):
        p.plot_width_m = 20.0  # type: ignore[misc]


def test_match_result_requires_min_reasoning_length() -> None:
    """reasoning has min_length=10 — too-short text rejected."""
    with pytest.raises(Exception):
        MatchResult(
            template_id=TemplateId.BHK1_PUNE_HOUSE,
            parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=12.20),
            confidence=0.9,
            reasoning="too short",
        )


def test_match_result_validates_confidence_range() -> None:
    with pytest.raises(Exception):
        MatchResult(
            template_id=TemplateId.BHK1_PUNE_HOUSE,
            parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=12.20),
            confidence=1.5,
            reasoning="reasoning long enough",
        )


def test_match_result_serializes_template_id_as_function_name() -> None:
    """``model_dump(mode='json')`` writes the underlying function-name
    string (because TemplateId subclasses str). This is what cache files
    will contain.
    """
    result = MatchResult(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
        confidence=0.9,
        reasoning="Two-bedroom duplex baseline match.",
    )
    dumped = result.model_dump(mode="json")
    assert dumped["template_id"] == "build_2bhk_pune_duplex"
