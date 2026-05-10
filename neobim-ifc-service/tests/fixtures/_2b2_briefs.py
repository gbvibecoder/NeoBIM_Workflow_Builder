"""Slice 2B.2.B — 15 fixture briefs for the AdaptationPlanner.

Mirrors the matcher fixtures (``_2b1_briefs.py``) in shape so the
fixture-driven test runner can stay symmetric across slices.

Outcome envelopes
-----------------
``ExpectedAdapt`` carries the canonical (mirror_axis, rotation) the
planner is expected to emit. Combined-transform briefs may have
multiple mathematically equivalent representations
(``mirror_X + rot_180`` collapses to ``mirror_Y``); the
``acceptable_plans`` tuple lists every form the test treats as a
pass. The planner's reasoning string is checked for length only —
the exact wording is the LLM's call.

``ExpectedRefuse`` carries the allowed ``suggested_action`` set so
a v2-deferral (the bulk of refusals) cannot silently downgrade to
``ask_user_clarification`` (which means a different UX path) and
vice versa.

Categories (3 fixtures each = 15 total)
---------------------------------------
* MIRROR — explicit mirror request, no rotation
* ROTATE — explicit cardinal-direction rotation, no mirror
* COMBINED — mirror + rotation in the same brief
* NO-OP — north-facing or orientation-silent (default)
* V2-DEFERRAL — vastu, room swaps, asymmetric features

Cache files
-----------
After the first mint with ANTHROPIC_API_KEY, every fixture lands a
file under ``app/services/design_agent/cache/``. Subsequent CI runs
read the cache directly with no network. Cache key is the SHA-256 of
``(system_prompt + user_message + schema + model)`` — see
:func:`compute_cache_key`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Union

from app.services.design_agent.types import (
    BriefAnalysis,
    BuildingClass,
    FidelityHint,
    MatchResult,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    TemplateId,
    TemplateParameters,
    TransformAxis,
    TransformRotation,
)


SuggestedActionKind = Literal[
    "ship_as_is",
    "ask_user_clarification",
    "fallback_to_design_agent",
]


# ─── Outcome envelopes ───────────────────────────────────────────────


@dataclass(frozen=True)
class ExpectedAdapt:
    """An expected ``decision="adapt"`` outcome.

    ``acceptable_plans`` is a tuple of ``(mirror_axis_or_None,
    rotation)`` pairs the test will treat as a pass. Most fixtures
    have exactly one canonical answer; combined-transform fixtures
    can have two equivalent forms because mirror_X ∘ rot_180 ==
    mirror_Y (the planner may pick either representation, both
    produce identical BuildingModels under apply_adaptations).
    """

    acceptable_plans: tuple[
        tuple[Optional[TransformAxis], TransformRotation], ...
    ]

    def matches(
        self,
        mirror_axis: Optional[TransformAxis],
        rotation: TransformRotation,
    ) -> bool:
        return (mirror_axis, rotation) in self.acceptable_plans


@dataclass(frozen=True)
class ExpectedRefuse:
    allowed_actions: tuple[SuggestedActionKind, ...]


ExpectedOutcome = Union[ExpectedAdapt, ExpectedRefuse]


@dataclass(frozen=True)
class AdapterFixture:
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
    site_orientation: Optional[str] = None,
) -> SiteContext:
    """Pune site with seismic III + wind 2.

    ``site_orientation`` accepts the canonical 8-point compass
    literal (N/S/E/W/NE/...) — the BriefAnalyst stage normally
    populates it from the brief; we set it explicitly when the
    fixture's brief is unambiguous about plot orientation.
    """
    return SiteContext(
        plot_width_m=plot_w,
        plot_length_m=plot_l,
        location_city="Pune",
        seismic_zone="III",
        wind_zone=2,
        site_orientation=site_orientation,  # type: ignore[arg-type]
    )


def _build_analysis(
    *,
    raw_brief_summary: str,
    sub_type: str = "duplex",
    nbc_group: str = "A-3",
    plot_w: float = 7.32,
    plot_l: float = 15.24,
    floors_above_ground: int = 2,
    site_orientation: Optional[str] = None,
    user_priorities: Optional[list[str]] = None,
) -> BriefAnalysis:
    return BriefAnalysis(
        building_class=_residential_class(sub_type, nbc_group),
        site_context=_site_pune(
            plot_w=plot_w,
            plot_l=plot_l,
            site_orientation=site_orientation,
        ),
        style_intent=StyleIntent(architectural_style="modern"),
        structural_intent=StructuralIntent(),
        fidelity_hint=FidelityHint(),
        floors_above_ground=floors_above_ground,
        floors_below_ground=0,
        explicit_room_list=[],
        explicit_dimensions={},
        user_priorities=user_priorities or [],
        raw_brief_summary=raw_brief_summary,
    )


def _match_2bhk_duplex(plot_w: float = 7.32, plot_l: float = 15.24) -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.88,
        reasoning="2BHK + duplex form factor + Pune defaults; clean match.",
    )


def _match_3bhk_duplex(plot_w: float = 10.97, plot_l: float = 19.81) -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK3_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.85,
        reasoning="3BHK + duplex with pooja and joint-family priorities.",
    )


def _match_3bhk_house(plot_w: float = 10.0, plot_l: float = 18.0) -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK3_PUNE_HOUSE,
        parameters=TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.82,
        reasoning="3BHK + single-floor house family; clean match.",
    )


def _match_2bhk_tower(
    plot_w: float = 8.0, plot_l: float = 16.0, habitable: int = 5
) -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK2_PUNE_TOWER,
        parameters=TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
            habitable_floor_count=habitable,
            has_stilt_parking=True,
        ),
        confidence=0.84,
        reasoning="2BHK tower G+5 with stilt parking.",
    )


def _match_1bhk_duplex(plot_w: float = 6.0, plot_l: float = 12.0) -> MatchResult:
    return MatchResult(
        template_id=TemplateId.BHK1_PUNE_DUPLEX,
        parameters=TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            floor_height_m=3.0,
            seismic_zone="III",
            wind_zone=2,
        ),
        confidence=0.81,
        reasoning="1BHK + duplex + narrow Pune plot.",
    )


# ═════════════════════════════════════════════════════════════════════
# 3 MIRROR-ONLY fixtures
# ═════════════════════════════════════════════════════════════════════


_FIX_MIRROR_E_W_EXPLICIT = AdapterFixture(
    name="mirror_e_w_explicit",
    description=(
        "Explicit east-west mirror — 'mirrored' / 'flipped' / 'mirror image'. "
        "Default mirror axis under ambiguity is X (E-W flip)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "User wants the standard 2BHK G+1 duplex on a 24x50 ft north-"
            "facing Pune plot, but mirrored — flipped east to west. The "
            "kitchen should end up on the opposite side of the layout."
        ),
        site_orientation="N",
        user_priorities=["mirror_layout", "kitchen_west_side"],
    ),
    match_result=_match_2bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((TransformAxis.X, TransformRotation.NONE),),
    ),
)


_FIX_MIRROR_AMBIGUOUS_FLIP = AdapterFixture(
    name="mirror_ambiguous_flip_default_x",
    description=(
        "Ambiguous 'flipped layout' / 'mirror image' without an axis "
        "spelled out. Default to X (E-W) mirror per the orientation "
        "section in the prompt."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Same 3BHK duplex layout but as a mirror image — flipped. "
            "We want a mirrored copy of the standard plan."
        ),
        plot_w=10.97,
        plot_l=19.81,
        site_orientation="N",
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((TransformAxis.X, TransformRotation.NONE),),
    ),
)


_FIX_MIRROR_N_S_EXPLICIT = AdapterFixture(
    name="mirror_n_s_explicit",
    description=(
        "Explicit north-south mirror — entry stays on north but the "
        "internal layout flips so the kitchen ends up at the back."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "1BHK duplex with the internal layout mirrored north to south "
            "— I want the kitchen at the rear (south wall) instead of "
            "the front; entry stays on the north side."
        ),
        sub_type="duplex",
        plot_w=6.0,
        plot_l=12.0,
        site_orientation="N",
        user_priorities=["mirror_n_s", "kitchen_at_rear"],
    ),
    match_result=_match_1bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((TransformAxis.Y, TransformRotation.NONE),),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 3 ROTATE-ONLY fixtures
# ═════════════════════════════════════════════════════════════════════


_FIX_ROTATE_180_SOUTH = AdapterFixture(
    name="rotate_180_south_facing",
    description=(
        "Standard south-facing brief — plot opens onto the southern "
        "road, entry door must be on south. 180° rotation from the "
        "north-facing template default."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "South-facing plot in Pune, 2BHK G+5 tower with stilt parking. "
            "Main entrance must be on the south edge facing the access "
            "road; layout otherwise standard."
        ),
        sub_type="apartment",
        nbc_group="A-4",
        plot_w=8.0,
        plot_l=16.0,
        floors_above_ground=5,
        site_orientation="S",
        user_priorities=["south_facing_entry"],
    ),
    match_result=_match_2bhk_tower(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.CW_180),),
    ),
)


_FIX_ROTATE_90_EAST = AdapterFixture(
    name="rotate_90_east_facing",
    description=(
        "East-facing entry — plot opens onto an eastern road. 90° "
        "clockwise rotation moves the entry from north to east."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "East-facing 3BHK bungalow in Pune; the plot opens onto an "
            "east-side access road and the main entry must be on the "
            "east. Single-floor, otherwise standard 3BHK layout."
        ),
        sub_type="bungalow",
        plot_w=10.0,
        plot_l=18.0,
        floors_above_ground=1,
        site_orientation="E",
        user_priorities=["east_facing_entry"],
    ),
    match_result=_match_3bhk_house(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.CW_90),),
    ),
)


_FIX_ROTATE_270_WEST = AdapterFixture(
    name="rotate_270_west_facing",
    description=(
        "West-facing entry — plot opens onto a western road. 270° "
        "clockwise rotation (= 90° CCW)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "1BHK duplex with the entry door on the west side; the plot's "
            "access road runs along the west edge of the parcel. Otherwise "
            "the standard 1BHK G+1 duplex layout."
        ),
        plot_w=6.0,
        plot_l=12.0,
        site_orientation="W",
        user_priorities=["west_facing_entry"],
    ),
    match_result=_match_1bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.CW_270),),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 3 COMBINED fixtures (mirror + rotate in same brief)
# ═════════════════════════════════════════════════════════════════════


_FIX_COMBO_MIRROR_X_ROT_180 = AdapterFixture(
    name="combo_mirror_x_plus_south_facing",
    description=(
        "Mirrored layout AND south-facing entry. Canonical answer is "
        "mirror=X + rot=180. Mathematically equivalent to mirror=Y + "
        "rot=NONE (both produce identical BuildingModels), so the "
        "test accepts either."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK duplex on a south-facing plot in Pune; the layout "
            "should also be mirror-imaged from the standard plan — "
            "kitchen on the opposite side. So we need both: rotated 180° "
            "to put entry on south AND flipped E-W."
        ),
        plot_w=10.97,
        plot_l=19.81,
        site_orientation="S",
        user_priorities=["south_facing_entry", "mirror_layout"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=(
            (TransformAxis.X, TransformRotation.CW_180),
            (TransformAxis.Y, TransformRotation.NONE),
        ),
    ),
)


_FIX_COMBO_MIRROR_X_ROT_90 = AdapterFixture(
    name="combo_mirror_x_plus_east_facing",
    description=(
        "Mirrored layout AND east-facing entry. Canonical answer is "
        "mirror=X + rot=90."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+5 tower in Pune; plot opens east, entry on east, AND "
            "the standard 2BHK layout should be flipped E-W relative to "
            "the catalogue plan (kitchen on the opposite side from "
            "default)."
        ),
        sub_type="apartment",
        nbc_group="A-4",
        plot_w=8.0,
        plot_l=16.0,
        floors_above_ground=5,
        site_orientation="E",
        user_priorities=["east_facing_entry", "mirror_layout"],
    ),
    match_result=_match_2bhk_tower(),
    expected=ExpectedAdapt(
        acceptable_plans=(
            (TransformAxis.X, TransformRotation.CW_90),
            (TransformAxis.Y, TransformRotation.CW_270),
        ),
    ),
)


_FIX_COMBO_MIRROR_Y_ROT_90 = AdapterFixture(
    name="combo_mirror_y_plus_east_facing",
    description=(
        "Explicit N-S mirror AND east-facing entry. mirror=Y + rot=90 "
        "(or its equivalent mirror=X + rot=270 — both produce identical "
        "buildings)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+5 tower with east-facing entry; ALSO flip the "
            "interior layout north to south so the kitchen ends up at "
            "the back of the building (south end of the new layout)."
        ),
        sub_type="apartment",
        nbc_group="A-4",
        plot_w=8.0,
        plot_l=16.0,
        floors_above_ground=5,
        site_orientation="E",
        user_priorities=["east_facing_entry", "mirror_n_s"],
    ),
    match_result=_match_2bhk_tower(),
    expected=ExpectedAdapt(
        acceptable_plans=(
            (TransformAxis.Y, TransformRotation.CW_90),
            (TransformAxis.X, TransformRotation.CW_270),
        ),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 3 NO-OP fixtures (default orientation, no transform)
# ═════════════════════════════════════════════════════════════════════


_FIX_NOOP_NORTH_EXPLICIT = AdapterFixture(
    name="noop_north_facing_explicit",
    description=(
        "Brief explicitly states north-facing — that's the template "
        "default. No-op plan (mirror=none, rotation=0)."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "Standard 2BHK G+1 duplex on a 24x50 ft north-facing Pune "
            "plot; modern style; layout per catalogue."
        ),
        site_orientation="N",
        user_priorities=["north_facing"],
    ),
    match_result=_match_2bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.NONE),),
    ),
)


_FIX_NOOP_ORIENTATION_SILENT = AdapterFixture(
    name="noop_orientation_silent",
    description=(
        "Brief silent on orientation — planner should default to no-op "
        "rather than guess a non-default rotation."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK G+1 duplex with pooja room for a joint family on a "
            "36x65 ft Pune plot; modern style; ground floor living + "
            "kitchen + 1 bedroom + bath + pooja, first floor master + "
            "2 bedrooms + 2 baths + balcony."
        ),
        plot_w=10.97,
        plot_l=19.81,
        # Deliberately no site_orientation, no orientation user_priorities.
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.NONE),),
    ),
)


_FIX_NOOP_DEFAULT_KEYWORD = AdapterFixture(
    name="noop_default_orientation_keyword",
    description=(
        "Brief explicitly says 'default orientation' / 'standard "
        "layout' — no transform requested."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "1BHK G+1 duplex on a 6x12 m Pune plot, default orientation "
            "and standard catalogue layout — no special chirality or "
            "rotation requirements; we want exactly what the catalogue "
            "shows."
        ),
        plot_w=6.0,
        plot_l=12.0,
        user_priorities=["default_orientation", "catalogue_standard"],
    ),
    match_result=_match_1bhk_duplex(),
    expected=ExpectedAdapt(
        acceptable_plans=((None, TransformRotation.NONE),),
    ),
)


# ═════════════════════════════════════════════════════════════════════
# 3 V2-DEFERRAL fixtures (refuse with ship_as_is)
# ═════════════════════════════════════════════════════════════════════


_FIX_DEFER_VASTU = AdapterFixture(
    name="defer_vastu_compliant",
    description=(
        "Vastu-compliant brief. v1 cannot interpret vastu rules into a "
        "specific transform — refuse with ship_as_is so the matcher's "
        "default IFC still ships."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK duplex in Pune that must be vastu compliant — kitchen "
            "in south-east corner, pooja room in north-east, master "
            "bedroom in south-west. Plot orientation is east-facing. "
            "Apply standard Vastu Shastra rules."
        ),
        plot_w=10.97,
        plot_l=19.81,
        site_orientation="E",
        user_priorities=["vastu_compliant", "vastu_kitchen_se", "vastu_pooja_ne"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


_FIX_DEFER_ROOM_SWAP = AdapterFixture(
    name="defer_room_swap",
    description=(
        "Room swap request — kitchen ↔ pooja room. v1 transforms apply "
        "uniformly to the whole building; per-room swap deferred to v2."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "3BHK duplex on a Pune plot — keep the standard north-facing "
            "layout but swap the positions of the kitchen and the pooja "
            "room. The pooja should be where the kitchen normally goes "
            "and vice versa."
        ),
        plot_w=10.97,
        plot_l=19.81,
        site_orientation="N",
        user_priorities=["swap_kitchen_pooja"],
    ),
    match_result=_match_3bhk_duplex(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


_FIX_DEFER_ASYMMETRIC = AdapterFixture(
    name="defer_asymmetric_balcony",
    description=(
        "Asymmetric per-side feature. Mirror/rotate are symmetric "
        "operations; v2 will introduce per-side feature toggles."
    ),
    analysis=_build_analysis(
        raw_brief_summary=(
            "2BHK G+5 tower in Pune with a balcony only on the east side "
            "— no balcony on the west wall. Otherwise standard layout, "
            "north-facing entry."
        ),
        sub_type="apartment",
        nbc_group="A-4",
        plot_w=8.0,
        plot_l=16.0,
        floors_above_ground=5,
        site_orientation="N",
        user_priorities=["balcony_east_only", "no_balcony_west"],
    ),
    match_result=_match_2bhk_tower(),
    expected=ExpectedRefuse(allowed_actions=("ship_as_is",)),
)


# ─── Top-level fixture tuple ─────────────────────────────────────────


ALL_FIXTURES: tuple[AdapterFixture, ...] = (
    # Mirror only (3)
    _FIX_MIRROR_E_W_EXPLICIT,
    _FIX_MIRROR_AMBIGUOUS_FLIP,
    _FIX_MIRROR_N_S_EXPLICIT,
    # Rotate only (3)
    _FIX_ROTATE_180_SOUTH,
    _FIX_ROTATE_90_EAST,
    _FIX_ROTATE_270_WEST,
    # Combined (3)
    _FIX_COMBO_MIRROR_X_ROT_180,
    _FIX_COMBO_MIRROR_X_ROT_90,
    _FIX_COMBO_MIRROR_Y_ROT_90,
    # No-op (3)
    _FIX_NOOP_NORTH_EXPLICIT,
    _FIX_NOOP_ORIENTATION_SILENT,
    _FIX_NOOP_DEFAULT_KEYWORD,
    # V2-deferral (3)
    _FIX_DEFER_VASTU,
    _FIX_DEFER_ROOM_SWAP,
    _FIX_DEFER_ASYMMETRIC,
)


__all__ = [
    "ExpectedAdapt",
    "ExpectedRefuse",
    "ExpectedOutcome",
    "AdapterFixture",
    "ALL_FIXTURES",
]
