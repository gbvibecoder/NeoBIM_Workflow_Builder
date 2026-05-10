"""Slice 2B.1.C — 20 brief fixtures for the TemplateMatcher.

The fixtures are *Python* objects (not JSON) so:

* Pydantic validation catches malformed BriefAnalyses at import time
  (a typo in a literal value or a missing required field is a hard
  fail before pytest even collects).
* The expected-outcome envelopes are typed structs the test suite
  binds against directly — no fragile dict drift.

Outcome envelopes
-----------------
``ExpectedMatch`` carries the minimum acceptable confidence and a
parameter-assertion dict. Each parameter assertion is a callable
``(TemplateParameters) -> bool``; the test renders the failing
assertion's docstring on mismatch so a regression message is precise.

``ExpectedRefuse`` carries the allowed ``suggested_action`` set and
the max ``best_confidence`` ceiling so a refusal that surfaces with
artificially high confidence (e.g. the matcher rates a hospital at
0.9) surfaces as a fail rather than a silent pass.

Categories — five fixtures per
------------------------------
* CLEAR POSITIVE — straightforward match across BHK + form factor.
* AMBIGUOUS — between two templates; matcher picks one cleanly.
* EDGE — tight plot, unusual floor count, non-Pune city.
* NEGATIVE — refusal expected (commercial / institutional / >3BHK /
  non-rectangular / under-specified).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Union

from app.services.design_agent.types import (
    BriefAnalysis,
    BuildingClass,
    FidelityHint,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    SuggestedAction,
    TemplateId,
    TemplateParameters,
)


# ─── Outcome envelopes ───────────────────────────────────────────────


@dataclass(frozen=True)
class ExpectedMatch:
    template_id: TemplateId
    min_confidence: float
    parameter_assertions: tuple[
        tuple[str, Callable[[TemplateParameters], bool]], ...
    ] = ()
    """Each entry: (description, predicate). The test renders the
    description verbatim on failure so the precise broken expectation
    surfaces in the pytest output.
    """


@dataclass(frozen=True)
class ExpectedRefuse:
    max_best_confidence: float
    allowed_actions: tuple[SuggestedAction, ...]
    """Set of suggested_action values the test treats as acceptable.
    Most negative cases require ``("reject",)`` exactly; the vague-
    brief case allows ``("ask_user_clarification",)``.
    """


ExpectedOutcome = Union[ExpectedMatch, ExpectedRefuse]


@dataclass(frozen=True)
class MatcherFixture:
    name: str
    description: str
    analysis: BriefAnalysis
    expected: ExpectedOutcome


# ─── BriefAnalysis builder helpers ───────────────────────────────────


def _residential_class(sub_type: str, nbc_group: str = "A-3") -> BuildingClass:
    """Pre-built BuildingClass for residential templates.

    nbc_group default A-3 (one- or two-family residential); pass A-4
    for multi-family / apartments.
    """
    return BuildingClass(
        primary_type="residential",
        sub_type=sub_type,
        nbc_group=nbc_group,  # type: ignore[arg-type]
        nbc_subdivision=(
            "Two-family residential"
            if nbc_group == "A-3"
            else "Multi-family residential"
        ),
    )


def _commercial_class(sub_type: str, nbc_group: str = "F") -> BuildingClass:
    """NBC India group F = Business (offices, banks). The codebase's
    NBCGroup literal accepts the bare letter, not the F-1 / F-2
    subgroup notation."""
    return BuildingClass(
        primary_type="office",  # type: ignore[arg-type]
        sub_type=sub_type,
        nbc_group=nbc_group,  # type: ignore[arg-type]
        nbc_subdivision="Office",
    )


def _institutional_class(sub_type: str, nbc_group: str = "C") -> BuildingClass:
    return BuildingClass(
        primary_type="hospital",  # type: ignore[arg-type]
        sub_type=sub_type,
        nbc_group=nbc_group,  # type: ignore[arg-type]
        nbc_subdivision="Hospital",
    )


def _site_pune(
    *,
    plot_w: Optional[float] = None,
    plot_l: Optional[float] = None,
    plot_area: Optional[float] = None,
    seismic: str = "III",
    wind: int = 2,
) -> SiteContext:
    """Pune site context with seismic III + wind 2 (canonical)."""
    return SiteContext(
        plot_width_m=plot_w,
        plot_length_m=plot_l,
        plot_area_sqm=plot_area,
        location_city="Pune",
        seismic_zone=seismic,  # type: ignore[arg-type]
        wind_zone=wind,
    )


def _build_analysis(
    *,
    raw_brief_summary: str,
    building_class: BuildingClass,
    site_context: SiteContext,
    floors_above_ground: int,
    style: str = "modern",
    explicit_rooms: Optional[list[str]] = None,
    explicit_dimensions: Optional[dict[str, str]] = None,
    user_priorities: Optional[list[str]] = None,
) -> BriefAnalysis:
    return BriefAnalysis(
        building_class=building_class,
        site_context=site_context,
        style_intent=StyleIntent(architectural_style=style),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=floors_above_ground,
        floors_below_ground=0,
        explicit_room_list=explicit_rooms or [],
        explicit_dimensions=explicit_dimensions or {},
        user_priorities=user_priorities or [],
        raw_brief_summary=raw_brief_summary,
    )


# ─── 5 CLEAR POSITIVE ────────────────────────────────────────────────


_FIX_CLEAR_2BHK_DUPLEX = MatcherFixture(
    name="clear_2bhk_pune_duplex",
    description=(
        "Flagship case: 2BHK G+1 duplex on a 24x50 ft Pune plot. The "
        "matcher should land the duplex form factor and convert ft -> m "
        "to 7.32 x 15.24 cleanly."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "User wants a 2BHK G+1 duplex on a 24x50 ft north-facing "
            "Pune plot, modern style with internal stair and ground-floor "
            "living + dining + kitchen, master bedroom + bath upstairs."
        ),
        building_class=_residential_class("duplex", "A-3"),
        site_context=_site_pune(plot_w=7.32, plot_l=15.24),
        floors_above_ground=2,
        explicit_rooms=[
            "living", "dining", "kitchen", "bedroom",
            "master_bedroom", "bathroom", "balcony",
        ],
        user_priorities=["natural_light", "north_facing"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        min_confidence=0.80,
        parameter_assertions=(
            (
                "plot_width_m close to 7.32m (24 ft)",
                lambda p: 7.0 <= p.plot_width_m <= 7.7,
            ),
            (
                "plot_length_m close to 15.24m (50 ft)",
                lambda p: 14.5 <= p.plot_length_m <= 15.8,
            ),
            (
                "seismic_zone III propagated from BriefAnalysis",
                lambda p: p.seismic_zone == "III",
            ),
        ),
    ),
)


_FIX_CLEAR_3BHK_TOWER = MatcherFixture(
    name="clear_3bhk_pune_tower_g5",
    description=(
        "3BHK G+5 apartment in Pune. Matcher should pick the tower "
        "family with habitable_floor_count=5 and stilt parking on by "
        "default."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK G+5 apartment building in Pune with stilt parking; "
            "single 3BHK flat per floor, modern facade."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=11.0, plot_l=20.0),
        floors_above_ground=5,
        explicit_rooms=["living", "kitchen", "bedroom", "balcony"],
        user_priorities=["stilt_parking"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK3_PUNE_TOWER,
        min_confidence=0.80,
        parameter_assertions=(
            (
                "habitable_floor_count == 5",
                lambda p: p.habitable_floor_count == 5,
            ),
            (
                "has_stilt_parking is True (or None -> builder default)",
                lambda p: p.has_stilt_parking in (True, None),
            ),
        ),
    ),
)


_FIX_CLEAR_1BHK_HOUSE = MatcherFixture(
    name="clear_1bhk_pune_house_small",
    description=(
        "Small 1BHK ground-floor house on a 25x40 ft plot for elderly "
        "parents. Matcher should pick the 1BHK house with ft -> m "
        "conversion."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Single-storey 1BHK house for elderly parents on a 25x40 ft "
            "plot in Pune; living + kitchen + 1 bedroom + 1 bath, no "
            "stairs."
        ),
        building_class=_residential_class("bungalow", "A-3"),
        site_context=_site_pune(plot_w=7.62, plot_l=12.19),
        floors_above_ground=1,
        explicit_rooms=["living", "kitchen", "bedroom", "bathroom"],
        user_priorities=["single_floor", "elderly_friendly"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK1_PUNE_HOUSE,
        min_confidence=0.75,
    ),
)


_FIX_CLEAR_2BHK_HOUSE = MatcherFixture(
    name="clear_2bhk_pune_house_single_floor",
    description=(
        "Single-floor 2BHK home on a 1500 sqft plot. Matcher should "
        "pick the 2BHK house and default plot dimensions to the "
        "candidate's typical_plot_min (never invent dimensions from "
        "area alone)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Single-floor 2BHK home on a 1500 sqft plot in Pune; living "
            "+ dining + kitchen + 2 bedrooms + 2 baths, no upstairs."
        ),
        building_class=_residential_class("bungalow", "A-3"),
        site_context=_site_pune(plot_area=139.35),  # 1500 sqft
        floors_above_ground=1,
        explicit_rooms=["living", "dining", "kitchen", "bedroom", "bathroom"],
        user_priorities=["single_floor"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_HOUSE,
        min_confidence=0.70,
        parameter_assertions=(
            (
                "plot_width_m at or above 6.0m (typical_plot_min)",
                lambda p: p.plot_width_m >= 6.0,
            ),
            (
                "plot_length_m at or above 12.0m",
                lambda p: p.plot_length_m >= 12.0,
            ),
        ),
    ),
)


_FIX_CLEAR_3BHK_DUPLEX = MatcherFixture(
    name="clear_3bhk_pune_duplex_joint_family",
    description=(
        "3BHK G+1 duplex with pooja room for a joint family. Matcher "
        "should pick the 3BHK duplex on a larger plot."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK G+1 duplex with pooja room for a joint family in "
            "Pune; 36x65 ft plot, ground floor: living + dining + "
            "kitchen + 1 bedroom + bath + pooja; first floor: master "
            "bedroom + 2nd bedroom + 2 baths + balcony."
        ),
        building_class=_residential_class("duplex", "A-3"),
        site_context=_site_pune(plot_w=10.97, plot_l=19.81),  # 36x65 ft
        floors_above_ground=2,
        explicit_rooms=[
            "living", "dining", "kitchen", "bedroom",
            "master_bedroom", "bathroom", "pooja_room", "balcony",
        ],
        user_priorities=["pooja_room", "joint_family"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK3_PUNE_DUPLEX,
        min_confidence=0.80,
    ),
)


# ─── 5 AMBIGUOUS ─────────────────────────────────────────────────────


_FIX_AMB_2BHK_TOWER_G11 = MatcherFixture(
    name="ambiguous_g11_2bhk_tower_60_flats",
    description=(
        "G+11 apartment, 60 flats, 2BHK each. Matcher should pick "
        "BHK2_PUNE_TOWER with habitable_floor_count=11 even though "
        "'60 flats' implies 5 flats per floor (the builder pins "
        "flats_per_floor=1, so confidence is moderately lower)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "G+11 apartment building in Pune, 60 flats total, 2BHK "
            "each, with stilt parking and lift; modern facade."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=8.0, plot_l=16.0),
        floors_above_ground=11,
        explicit_rooms=["living", "kitchen", "bedroom", "balcony"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_TOWER,
        min_confidence=0.65,  # ambiguity discount
        parameter_assertions=(
            (
                "habitable_floor_count == 11",
                lambda p: p.habitable_floor_count == 11,
            ),
        ),
    ),
)


_FIX_AMB_1BHK_TOWER_HIGH = MatcherFixture(
    name="ambiguous_12_storey_1bhk_tower",
    description=(
        "12 storey 1BHK apartment block. Matcher should pick "
        "BHK1_PUNE_TOWER with habitable_floor_count=11 (12 storeys "
        "= stilt + 11 habitable, the more conservative reading)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "12 storey 1BHK apartment block in Pune; stilt parking "
            "on ground level and 11 habitable floors above."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=7.32, plot_l=12.20),
        floors_above_ground=11,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK1_PUNE_TOWER,
        min_confidence=0.70,
        parameter_assertions=(
            (
                "habitable_floor_count between 11 and 12",
                lambda p: p.habitable_floor_count in (11, 12),
            ),
        ),
    ),
)


_FIX_AMB_1BHK_DUPLEX_NARROW = MatcherFixture(
    name="ambiguous_narrow_1bhk_duplex",
    description=(
        "1BHK on a narrow plot, two storeys with internal stair. "
        "Matcher should pick BHK1_PUNE_DUPLEX (1BHK + duplex)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Narrow 1BHK row house on a 6x12 m plot in Pune, two "
            "storeys with internal stair; ground floor living + "
            "kitchen, bedroom + bath upstairs."
        ),
        building_class=_residential_class("duplex", "A-3"),
        site_context=_site_pune(plot_w=6.0, plot_l=12.0),
        floors_above_ground=2,
        explicit_rooms=["living", "kitchen", "bedroom", "bathroom"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK1_PUNE_DUPLEX,
        min_confidence=0.75,
    ),
)


_FIX_AMB_2BHK_DUPLEX_NO_DIMS = MatcherFixture(
    name="ambiguous_2bhk_duplex_no_plot_dims",
    description=(
        "2BHK duplex Pune, brief silent on plot dims. Matcher should "
        "pick BHK2_PUNE_DUPLEX and default plot to typical_plot_min "
        "for the candidate."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+1 duplex bungalow in Pune; modern style, no "
            "specific plot dimensions given."
        ),
        building_class=_residential_class("duplex", "A-3"),
        site_context=_site_pune(),
        floors_above_ground=2,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        min_confidence=0.65,
        parameter_assertions=(
            (
                "plot_width_m within typical bounds [6.0, 10.0]",
                lambda p: 6.0 <= p.plot_width_m <= 10.0,
            ),
            (
                "plot_length_m within typical bounds [12.0, 18.0]",
                lambda p: 12.0 <= p.plot_length_m <= 18.0,
            ),
        ),
    ),
)


_FIX_AMB_3BHK_TOWER_G23 = MatcherFixture(
    name="ambiguous_24_storey_3bhk_premium",
    description=(
        "24 storey 3BHK premium tower. Matcher should pick "
        "BHK3_PUNE_TOWER with habitable_floor_count between 22 and "
        "24 (stilt + 23 habitable is the canonical reading)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "24 storey 3BHK premium residential tower in Pune; one "
            "3BHK flat per floor, lift + stair core, stilt parking."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=12.0, plot_l=22.0),
        floors_above_ground=23,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK3_PUNE_TOWER,
        min_confidence=0.70,
        parameter_assertions=(
            (
                "habitable_floor_count in {22, 23, 24}",
                lambda p: p.habitable_floor_count in (22, 23, 24),
            ),
        ),
    ),
)


# ─── 5 EDGE ──────────────────────────────────────────────────────────


_FIX_EDGE_DUPLEX_MUMBAI = MatcherFixture(
    name="edge_2bhk_duplex_mumbai",
    description=(
        "2BHK duplex but city is Mumbai (seismic still III, wind 3). "
        "Matcher should pass through the Mumbai-derived wind_zone "
        "instead of defaulting to Pune's 2."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+1 duplex on a 24x50 ft Mumbai plot; modern."
        ),
        building_class=_residential_class("duplex", "A-3"),
        site_context=SiteContext(
            plot_width_m=7.32,
            plot_length_m=15.24,
            location_city="Mumbai",
            seismic_zone="III",
            wind_zone=3,
        ),
        floors_above_ground=2,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        min_confidence=0.65,
        parameter_assertions=(
            (
                "wind_zone propagated as 3 (Mumbai), not defaulted to 2",
                lambda p: p.wind_zone == 3,
            ),
        ),
    ),
)


_FIX_EDGE_TIGHT_PLOT_1BHK_HOUSE = MatcherFixture(
    name="edge_1bhk_house_tight_plot",
    description=(
        "1BHK house on the tightest plot the catalogue allows: 5x9 m. "
        "Matcher should pick BHK1_PUNE_HOUSE with min-bound plot."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Compact single-floor 1BHK house on a 5x9 m plot in Pune; "
            "minimal footprint, ground only."
        ),
        building_class=_residential_class("bungalow", "A-3"),
        site_context=_site_pune(plot_w=5.0, plot_l=9.0),
        floors_above_ground=1,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK1_PUNE_HOUSE,
        min_confidence=0.70,
        parameter_assertions=(
            ("plot_width_m == 5.0", lambda p: p.plot_width_m == 5.0),
        ),
    ),
)


_FIX_EDGE_LARGE_3BHK_HOUSE = MatcherFixture(
    name="edge_3bhk_house_large_plot",
    description=(
        "3BHK house on the largest plot bound: 13x24 m. Matcher should "
        "pick BHK3_PUNE_HOUSE."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Large single-floor 3BHK house on a 13x24 m plot in Pune; "
            "joint family, ground only, ample setback."
        ),
        building_class=_residential_class("bungalow", "A-3"),
        site_context=_site_pune(plot_w=13.0, plot_l=24.0),
        floors_above_ground=1,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK3_PUNE_HOUSE,
        min_confidence=0.75,
    ),
)


_FIX_EDGE_TOWER_NO_STILT = MatcherFixture(
    name="edge_2bhk_tower_no_stilt",
    description=(
        "G+5 2BHK tower with explicit no parking. Matcher should "
        "pick BHK2_PUNE_TOWER with has_stilt_parking=False."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "G+5 2BHK apartment building in Pune with NO ground-floor "
            "parking and an open ground floor (small commercial below "
            "is NOT requested; just no stilt)."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=8.0, plot_l=16.0),
        floors_above_ground=5,
        user_priorities=["no_parking", "open_ground"],
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK2_PUNE_TOWER,
        min_confidence=0.65,
        parameter_assertions=(
            (
                "has_stilt_parking explicitly False",
                lambda p: p.has_stilt_parking is False,
            ),
        ),
    ),
)


_FIX_EDGE_TOWER_LOW_HABITABLE = MatcherFixture(
    name="edge_1bhk_tower_g3_low_count",
    description=(
        "1BHK tower with only G+3 (3 habitable floors). Matcher should "
        "pick BHK1_PUNE_TOWER with habitable_floor_count=3 (allowed by "
        "the [1, 30] range)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Small 1BHK G+3 apartment block in suburban Pune; stilt "
            "parking + 3 habitable floors."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=7.32, plot_l=12.20),
        floors_above_ground=3,
    ),
    expected=ExpectedMatch(
        template_id=TemplateId.BHK1_PUNE_TOWER,
        min_confidence=0.65,
        parameter_assertions=(
            (
                "habitable_floor_count == 3",
                lambda p: p.habitable_floor_count == 3,
            ),
        ),
    ),
)


# ─── 5 NEGATIVE — refusal expected ───────────────────────────────────


_FIX_NEG_COMMERCIAL_OFFICE = MatcherFixture(
    name="negative_commercial_office",
    description=(
        "Small office with 3 cabins. Pure commercial use; matcher "
        "must refuse with suggested_action='reject'."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Small office space in Pune with 3 cabins, 1 conference "
            "room, reception, and pantry; ground floor only."
        ),
        building_class=_commercial_class("office", "F"),
        site_context=_site_pune(plot_w=8.0, plot_l=12.0),
        floors_above_ground=1,
        explicit_rooms=["office", "meeting_room", "reception", "pantry"],
    ),
    expected=ExpectedRefuse(
        max_best_confidence=0.40,
        allowed_actions=("reject",),
    ),
)


_FIX_NEG_HOSPITAL = MatcherFixture(
    name="negative_hospital_50_beds",
    description=(
        "Hospital with 50 beds and ICU. Institutional; matcher must "
        "refuse with suggested_action='reject'."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "50-bed hospital in Pune with ICU, operation theatres, "
            "wards, and consultation rooms; G+3 building."
        ),
        building_class=_institutional_class("hospital", "C"),
        site_context=_site_pune(plot_w=20.0, plot_l=40.0),
        floors_above_ground=3,
        explicit_rooms=["ward", "icu", "operation_theatre", "consultation"],
    ),
    expected=ExpectedRefuse(
        max_best_confidence=0.30,
        allowed_actions=("reject",),
    ),
)


_FIX_NEG_CYLINDRICAL = MatcherFixture(
    name="negative_cylindrical_glass_tower",
    description=(
        "Cylindrical glass tower. Non-rectangular geometry; matcher "
        "must refuse with suggested_action='reject'."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Cylindrical glass-curtain residential tower, G+15, with "
            "circular floorplate and continuous glazing on all sides."
        ),
        building_class=_residential_class("apartment", "A-4"),
        site_context=_site_pune(plot_w=20.0, plot_l=20.0),
        floors_above_ground=15,
        style="modern_glass_curtain",
    ),
    expected=ExpectedRefuse(
        max_best_confidence=0.30,
        allowed_actions=("reject",),
    ),
)


_FIX_NEG_4BHK_VILLA = MatcherFixture(
    name="negative_4bhk_villa_pool",
    description=(
        "4BHK luxury villa with infinity pool and helipad. Out of "
        "BHK range AND has features no template covers; matcher must "
        "refuse with suggested_action='reject'."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "4BHK luxury villa with infinity pool, helipad, and home "
            "theatre on a 30x60 m plot in Pune; G+1."
        ),
        building_class=_residential_class("villa", "A-3"),
        site_context=_site_pune(plot_w=30.0, plot_l=60.0),
        floors_above_ground=2,
        explicit_rooms=[
            "living", "dining", "kitchen", "bedroom",
            "master_bedroom", "bathroom",
        ],
    ),
    expected=ExpectedRefuse(
        max_best_confidence=0.50,
        allowed_actions=("reject",),
    ),
)


_FIX_NEG_VAGUE = MatcherFixture(
    name="negative_vague_modern_apartment",
    description=(
        "Modern apartment in Mumbai. No BHK count, no plot dims, no "
        "form factor. Matcher must refuse with suggested_action="
        "'ask_user_clarification' (NOT 'reject' — user can clarify)."
    ),
    analysis=_build_analysis(
        raw_brief_summary="Modern apartment in Mumbai.",
        building_class=_residential_class("apartment", "A-4"),
        site_context=SiteContext(
            location_city="Mumbai",
            seismic_zone="III",
            wind_zone=3,
        ),
        floors_above_ground=1,
    ),
    expected=ExpectedRefuse(
        max_best_confidence=0.50,
        allowed_actions=("ask_user_clarification",),
    ),
)


# ─── Top-level fixture tuple ─────────────────────────────────────────


ALL_FIXTURES: tuple[MatcherFixture, ...] = (
    # Clear positive (5)
    _FIX_CLEAR_2BHK_DUPLEX,
    _FIX_CLEAR_3BHK_TOWER,
    _FIX_CLEAR_1BHK_HOUSE,
    _FIX_CLEAR_2BHK_HOUSE,
    _FIX_CLEAR_3BHK_DUPLEX,
    # Ambiguous (5)
    _FIX_AMB_2BHK_TOWER_G11,
    _FIX_AMB_1BHK_TOWER_HIGH,
    _FIX_AMB_1BHK_DUPLEX_NARROW,
    _FIX_AMB_2BHK_DUPLEX_NO_DIMS,
    _FIX_AMB_3BHK_TOWER_G23,
    # Edge (5)
    _FIX_EDGE_DUPLEX_MUMBAI,
    _FIX_EDGE_TIGHT_PLOT_1BHK_HOUSE,
    _FIX_EDGE_LARGE_3BHK_HOUSE,
    _FIX_EDGE_TOWER_NO_STILT,
    _FIX_EDGE_TOWER_LOW_HABITABLE,
    # Negative (5)
    _FIX_NEG_COMMERCIAL_OFFICE,
    _FIX_NEG_HOSPITAL,
    _FIX_NEG_CYLINDRICAL,
    _FIX_NEG_4BHK_VILLA,
    _FIX_NEG_VAGUE,
)


__all__ = [
    "ExpectedMatch",
    "ExpectedRefuse",
    "ExpectedOutcome",
    "MatcherFixture",
    "ALL_FIXTURES",
]
