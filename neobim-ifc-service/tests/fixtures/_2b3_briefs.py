"""Slice 2B.3.B — 20 fixture briefs for the ExtensionPlanner.

Mirrors the matcher fixtures (``_2b1_briefs.py``) and adapter
fixtures (``_2b2_briefs.py``) in shape so the fixture-driven test
runner stays symmetric across slices.

Outcome envelopes
-----------------
``ExpectedPlan`` carries the canonical set of include_* booleans the
planner is expected to emit. Stored as a ``frozenset[ExtensionType]``
of types that should be True; the test ignores ordering and the
ExtensionPlan's reasoning string.

``ExpectedRefuse`` carries the allowed ``suggested_action`` set so a
v2-deferral (ship_as_is) cannot silently downgrade to
``ask_user_clarification`` (a different UX path) and vice versa.

Categories (20 total per user spec):
   * 5 SINGLE-EXTENSION
   * 5 MULTI-EXTENSION
   * 5 VAGUE / INFERENCE
   * 3 V2-DEFERRAL (refuse, ship_as_is)
   * 2 NO-OP (plan with empty extensions list — minimalist briefs)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Union

from app.services.design_agent.types import (
    BriefAnalysis,
    BuildingClass,
    ExtensionType,
    FidelityHint,
    MatchResult,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    TemplateId,
    TemplateParameters,
)


SuggestedActionKind = Literal[
    "ship_as_is",
    "ask_user_clarification",
]


# ─── Outcome envelopes ───────────────────────────────────────────────


@dataclass(frozen=True)
class ExpectedPlan:
    """Expected ``decision="plan"`` outcome — set of True booleans.

    Allows multiple acceptable answers when the brief is genuinely
    ambiguous (e.g., "house with garden" could plausibly produce
    {compound_wall} or {compound_wall, entry_gate}). Test passes if
    the planner's output is any of the acceptable sets.
    """

    acceptable_sets: tuple[frozenset[ExtensionType], ...]

    def matches(self, types: frozenset[ExtensionType]) -> bool:
        return types in self.acceptable_sets


@dataclass(frozen=True)
class ExpectedRefuse:
    allowed_actions: tuple[SuggestedActionKind, ...]


ExpectedOutcome = Union[ExpectedPlan, ExpectedRefuse]


@dataclass(frozen=True)
class ExtensionFixture:
    name: str
    description: str
    analysis: BriefAnalysis
    match_result: MatchResult
    expected: ExpectedOutcome


# ─── Construction helpers ────────────────────────────────────────────


def _residential_class(sub_type: str, nbc_group: str = "A-3") -> BuildingClass:
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


def _site_pune(
    *,
    plot_w: Optional[float] = None,
    plot_l: Optional[float] = None,
) -> SiteContext:
    return SiteContext(
        plot_width_m=plot_w,
        plot_length_m=plot_l,
        location_city="Pune",
        seismic_zone="III",
        wind_zone=2,
    )


def _build_analysis(
    *,
    raw_brief_summary: str,
    sub_type: str = "duplex",
    nbc_group: str = "A-3",
    plot_w: float = 11.0,
    plot_l: float = 20.0,
    floors_above_ground: int = 2,
    user_priorities: Optional[list[str]] = None,
    explicit_room_list: Optional[list[str]] = None,
) -> BriefAnalysis:
    return BriefAnalysis(
        building_class=_residential_class(sub_type, nbc_group),
        site_context=_site_pune(plot_w=plot_w, plot_l=plot_l),
        style_intent=StyleIntent(architectural_style="modern"),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=floors_above_ground,
        floors_below_ground=0,
        explicit_room_list=explicit_room_list or [],
        explicit_dimensions={},
        user_priorities=user_priorities or [],
        raw_brief_summary=raw_brief_summary,
    )


def _match_3bhk_house() -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK3_PUNE_HOUSE,
        parameters=TemplateParameters(
            plot_width_m=11.0,
            plot_length_m=20.0,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.85,
        reasoning="3BHK + single-floor house family; clean match.",
    )


def _match_3bhk_duplex() -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK3_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=11.0,
            plot_length_m=20.0,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.87,
        reasoning="3BHK duplex with pooja + joint-family priorities.",
    )


def _match_1bhk_duplex() -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK1_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=12.20,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.81,
        reasoning="1BHK duplex on narrow Pune plot.",
    )


def _match_2bhk_tower() -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK2_PUNE_TOWER,
        parameters=TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
            habitable_floor_count=5,
            has_stilt_parking=True,
        ),
        confidence=0.84,
        reasoning="2BHK tower G+5 with stilt parking.",
    )


CW = ExtensionType.COMPOUND_WALL
EG = ExtensionType.ENTRY_GATE
CP = ExtensionType.CAR_PORCH
SQ = ExtensionType.SERVANT_QUARTER
MU = ExtensionType.MUMTY


# ═════════════════════════════════════════════════════════════════════
# 5 SINGLE-EXTENSION fixtures
# ═════════════════════════════════════════════════════════════════════


_FIX_SINGLE_COMPOUND = ExtensionFixture(
    name="single_compound_wall",
    description="Only a compound wall — perimeter brick boundary.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK duplex on a 11×20m Pune plot, north-facing. The "
            "client wants a perimeter compound wall around the plot "
            "boundary for security. No gate / no porch / nothing else."
        ),
        user_priorities=["compound_wall"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(acceptable_sets=(frozenset({CW}),)),
)


_FIX_SINGLE_GATE = ExtensionFixture(
    name="single_entry_gate",
    description=(
        "Explicit entry gate request. Planner should infer compound "
        "wall too (a gate requires a wall) so the acceptable set is "
        "{EG, CW}."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Pune 3BHK house with a main entry gate at the front for "
            "vehicle access. We need the gate to be wide enough for "
            "cars."
        ),
        user_priorities=["entry_gate"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(
        # Both interpretations are acceptable: explicit gate alone, or
        # gate + inferred compound wall.
        acceptable_sets=(
            frozenset({EG}),
            frozenset({EG, CW}),
        ),
    ),
)


_FIX_SINGLE_PORCH = ExtensionFixture(
    name="single_car_porch",
    description="Covered car parking at front; nothing else.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK duplex in Pune. Need a covered car porch at the "
            "front of the house for the family car. Standard layout "
            "otherwise — no compound wall, no gate."
        ),
        user_priorities=["car_porch"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(acceptable_sets=(frozenset({CP}),)),
)


_FIX_SINGLE_SERVANT = ExtensionFixture(
    name="single_servant_quarter",
    description="Servant quarter at rear; nothing else.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK house in Pune. Need a servant quarter (bedroom + "
            "bath) at the back of the plot for the live-in domestic "
            "help. No other add-ons required."
        ),
        user_priorities=["servant_room"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(acceptable_sets=(frozenset({SQ}),)),
)


_FIX_SINGLE_MUMTY = ExtensionFixture(
    name="single_mumty",
    description="Mumty for terrace access; nothing else.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "1BHK duplex in Pune. Need a mumty on the roof for direct "
            "stair access to the terrace — currently there's no way "
            "up. Default everything else."
        ),
        sub_type="duplex",
        plot_w=7.32,
        plot_l=12.20,
        user_priorities=["mumty"],
    ),
    match_result=_match_1bhk_duplex(),
    expected=ExpectedPlan(acceptable_sets=(frozenset({MU}),)),
)


# ═════════════════════════════════════════════════════════════════════
# 5 MULTI-EXTENSION fixtures
# ═════════════════════════════════════════════════════════════════════


_FIX_MULTI_COMPOUND_GATE = ExtensionFixture(
    name="multi_compound_and_gate",
    description="Boundary wall + main gate.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "Pune 3BHK duplex with a compound wall around the plot "
            "and a main entry gate at the front. Otherwise standard."
        ),
        user_priorities=["compound_wall", "entry_gate"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(acceptable_sets=(frozenset({CW, EG}),)),
)


_FIX_MULTI_PARKING_SECURITY = ExtensionFixture(
    name="multi_parking_and_security",
    description="Compound + gate + car porch (parking + security combo).",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune house with compound wall + entry gate + a "
            "covered car porch at the front. The family wants the "
            "plot secured and the car protected."
        ),
        user_priorities=["compound_wall", "entry_gate", "car_porch"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG, CP}),),
    ),
)


_FIX_MULTI_SERVANT_AND_MUMTY = ExtensionFixture(
    name="multi_servant_and_mumty",
    description="Servant quarter + mumty (back + roof).",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK family home in Pune. Need a servant room at the "
            "back for our domestic help and a mumty on the roof for "
            "terrace access. No compound wall — apartment-style open "
            "plot."
        ),
        user_priorities=["servant_room", "mumty"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({SQ, MU}),),
    ),
)


_FIX_MULTI_ALL_FIVE_EXPLICIT = ExtensionFixture(
    name="multi_all_five_explicit",
    description="Brief lists every extension explicitly.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "Complete 3BHK Pune duplex: compound wall around the "
            "plot, main entry gate at the front, covered car porch "
            "at the front, servant quarter (bedroom + bath) at the "
            "back, and mumty on the roof for terrace access. The full "
            "set."
        ),
        user_priorities=[
            "compound_wall",
            "entry_gate",
            "car_porch",
            "servant_room",
            "mumty",
        ],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG, CP, SQ, MU}),),
    ),
)


_FIX_MULTI_COMPOUND_GATE_MUMTY = ExtensionFixture(
    name="multi_compound_gate_mumty",
    description="Three: compound + gate + mumty.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "Pune 3BHK duplex. Compound wall around the plot, entry "
            "gate at the front, and a mumty on the roof for terrace "
            "access. No car porch, no servant quarter."
        ),
        user_priorities=["compound_wall", "entry_gate", "mumty"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG, MU}),),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 5 VAGUE / INFERENCE fixtures
# ═════════════════════════════════════════════════════════════════════


_FIX_VAGUE_STANDARD_INDIAN = ExtensionFixture(
    name="vague_standard_indian_setup",
    description=(
        "Vague 'standard Indian residential setup' should infer the "
        "full add-on profile (all 5 True)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Standard Indian residential setup, 3BHK Pune duplex. "
            "Give us all the essentials a typical Indian middle-class "
            "family home would have."
        ),
        user_priorities=["standard_setup"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG, CP, SQ, MU}),),
    ),
)


_FIX_VAGUE_PARKING_SECURITY = ExtensionFixture(
    name="vague_parking_and_security",
    description=(
        "Brief mentions 'parking and security' — infer porch + "
        "compound + gate (servant + mumty NOT implied)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune family house, need parking and security."
        ),
        user_priorities=["parking", "security"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG, CP}),),
    ),
)


_FIX_VAGUE_JOINT_FAMILY = ExtensionFixture(
    name="vague_joint_family_with_help",
    description=(
        "'Joint family with full-time help' → infer servant_quarter. "
        "Other extensions not auto-implied here."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK house in Pune for a joint family with full-time "
            "domestic help. Modern layout, single floor."
        ),
        user_priorities=["joint_family", "domestic_help"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({SQ}),),
    ),
)


_FIX_VAGUE_BUNGALOW_GATE = ExtensionFixture(
    name="vague_bungalow_with_garden_and_gate",
    description=(
        "'Bungalow with garden and gate' → compound + gate; garden "
        "implies open front yard, NO porch."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK bungalow in Pune with a garden in front and a main "
            "gate at the entrance. We want the property fenced."
        ),
        user_priorities=["garden", "gate"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({CW, EG}),),
    ),
)


_FIX_VAGUE_TOWER_MUMTY = ExtensionFixture(
    name="vague_tower_with_terrace_usage",
    description=(
        "Tower brief mentions habitable terrace → infer mumty for "
        "access. Tower-incompatible extensions NOT implied."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+5 tower in Pune with a habitable terrace on the "
            "top floor — residents should be able to use the terrace "
            "for gardens and gatherings."
        ),
        sub_type="apartment",
        nbc_group="A-4",
        plot_w=7.32,
        plot_l=15.24,
        floors_above_ground=5,
        user_priorities=["habitable_terrace"],
    ),
    match_result=_match_2bhk_tower(),
    expected=ExpectedPlan(
        acceptable_sets=(frozenset({MU}),),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 3 V2-DEFERRAL fixtures (refuse, ship_as_is)
# ═════════════════════════════════════════════════════════════════════


_FIX_DEFER_POOL = ExtensionFixture(
    name="defer_swimming_pool",
    description="Swimming pool — deferred to v2 / MISC.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune duplex with a private swimming pool in the rear "
            "yard. Lap-pool style, ~3×7m. Standard layout otherwise."
        ),
        user_priorities=["swimming_pool"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


_FIX_DEFER_BASEMENT = ExtensionFixture(
    name="defer_basement",
    description="Basement — deferred to v2 / MISC.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune house with a basement for storage and a home "
            "theater. ~80 sqm sub-grade floor with access stair down."
        ),
        user_priorities=["basement"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


_FIX_DEFER_SOLAR = ExtensionFixture(
    name="defer_solar_pv",
    description="Solar PV — deferred to v2 / MISC.",
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune duplex with a 5 kW rooftop solar PV array for "
            "energy independence. Need the solar panels integrated "
            "into the roof structure."
        ),
        user_priorities=["solar_pv"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


# ═════════════════════════════════════════════════════════════════════
# 2 NO-OP fixtures (plan with empty extensions list)
# ═════════════════════════════════════════════════════════════════════


_FIX_NOOP_MINIMAL = ExtensionFixture(
    name="noop_minimal_modern",
    description=(
        "Minimalist modern brief with no extension mentions — empty "
        "plan."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Modern 2BHK Pune duplex, minimalist clean lines, no "
            "ornamentation. Family of three, standard residential."
        ),
        sub_type="duplex",
        plot_w=7.32,
        plot_l=15.24,
        user_priorities=["modern", "minimalist"],
    ),
    match_result=MatchResult(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.86,
        reasoning="2BHK Pune duplex; modern minimalist preference.",
    ),
    expected=ExpectedPlan(acceptable_sets=(frozenset(),)),
)


_FIX_NOOP_APARTMENT_STYLE = ExtensionFixture(
    name="noop_apartment_style_open_plot",
    description=(
        "User opts out of compound wall — empty plan since no other "
        "extensions are mentioned."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK Pune house, apartment-style open plot — no compound "
            "wall, no gate, no extras. Just the building itself."
        ),
        user_priorities=["no_compound", "open_plot"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedPlan(acceptable_sets=(frozenset(),)),
)


# ─── Top-level fixture tuple ─────────────────────────────────────────


ALL_FIXTURES: tuple[ExtensionFixture, ...] = (
    # Single (5)
    _FIX_SINGLE_COMPOUND,
    _FIX_SINGLE_GATE,
    _FIX_SINGLE_PORCH,
    _FIX_SINGLE_SERVANT,
    _FIX_SINGLE_MUMTY,
    # Multi (5)
    _FIX_MULTI_COMPOUND_GATE,
    _FIX_MULTI_PARKING_SECURITY,
    _FIX_MULTI_SERVANT_AND_MUMTY,
    _FIX_MULTI_ALL_FIVE_EXPLICIT,
    _FIX_MULTI_COMPOUND_GATE_MUMTY,
    # Vague / inference (5)
    _FIX_VAGUE_STANDARD_INDIAN,
    _FIX_VAGUE_PARKING_SECURITY,
    _FIX_VAGUE_JOINT_FAMILY,
    _FIX_VAGUE_BUNGALOW_GATE,
    _FIX_VAGUE_TOWER_MUMTY,
    # V2-deferral (3)
    _FIX_DEFER_POOL,
    _FIX_DEFER_BASEMENT,
    _FIX_DEFER_SOLAR,
    # No-op (2)
    _FIX_NOOP_MINIMAL,
    _FIX_NOOP_APARTMENT_STYLE,
)


__all__ = [
    "ExpectedPlan",
    "ExpectedRefuse",
    "ExpectedOutcome",
    "ExtensionFixture",
    "ALL_FIXTURES",
]
