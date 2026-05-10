"""Slice 2B.1 — Static descriptor catalog for the nine Tier-2 templates.

Single source of truth consumed by:

* :mod:`app.services.design_agent.prompts.template_matcher` — renders
  the descriptors into the matcher LLM's system prompt as the candidate
  set with few-shot examples.
* :mod:`app.services.design_agent.template_dispatcher` — sanity-check
  cross-reference; the dispatcher's enum-to-callable map and the
  catalog must agree on exactly the nine ids.
* Tests (``tests/test_template_catalog.py``) — assert nine entries,
  unique ids, well-formed plot bounds, ≥ three few-shot examples.

Each :class:`TemplateDescriptor` carries the human-readable description
plus typical-plot bounds the matcher can default to when the brief omits
a plot dimension. ``suitable_for_briefs_like`` is the few-shot pool the
matcher prompt embeds verbatim — keep examples *short* (one phrase per
line) so the prompt stays inside Anthropic's 1024-token cache floor
without bloating into Sonnet-tier latency.

This module imports nothing heavy and produces a frozen tuple at import
time so subsequent reads are zero-cost.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.design_agent.types import TemplateId


BHKFamily = Literal["1BHK", "2BHK", "3BHK"]
FormFactor = Literal["house", "duplex", "tower"]


class TemplateDescriptor(BaseModel):
    """One row in the matcher's candidate catalog.

    Frozen + ConfigDict to match the rest of the design-agent surface.
    Validates internally that ``typical_plot_min_m`` is component-wise
    less than ``typical_plot_max_m`` so the matcher's "if uncertain,
    default to the typical plot" guidance never hands the dispatcher an
    inverted range.
    """

    model_config = ConfigDict(frozen=True)

    template_id: TemplateId
    bhk_family: BHKFamily
    form_factor: FormFactor
    description: str = Field(..., min_length=10)
    typical_plot_min_m: tuple[float, float]
    typical_plot_max_m: tuple[float, float]
    floor_count: str = Field(..., min_length=1)
    target_market: str = Field(..., min_length=10)
    suitable_for_briefs_like: tuple[str, ...]

    @model_validator(mode="after")
    def _bounds_well_formed(self) -> "TemplateDescriptor":
        min_w, min_l = self.typical_plot_min_m
        max_w, max_l = self.typical_plot_max_m
        if min_w <= 0 or min_l <= 0 or max_w <= 0 or max_l <= 0:
            raise ValueError(
                f"{self.template_id}: plot bounds must be positive "
                f"(min={self.typical_plot_min_m}, max={self.typical_plot_max_m})"
            )
        if min_w > max_w or min_l > max_l:
            raise ValueError(
                f"{self.template_id}: typical_plot_min_m must be "
                f"componentwise <= typical_plot_max_m "
                f"(min={self.typical_plot_min_m}, max={self.typical_plot_max_m})"
            )
        if len(self.suitable_for_briefs_like) < 3:
            raise ValueError(
                f"{self.template_id}: need at least 3 few-shot examples; "
                f"got {len(self.suitable_for_briefs_like)}"
            )
        return self


# ─── The catalog ─────────────────────────────────────────────────────


CATALOG: tuple[TemplateDescriptor, ...] = (
    TemplateDescriptor(
        template_id=TemplateId.BHK1_PUNE_HOUSE,
        bhk_family="1BHK",
        form_factor="house",
        description=(
            "Single-storey 1BHK independent house on a small plot. "
            "Living + kitchen + 1 bedroom + 1 bath. RCC frame, "
            "load-bearing brick infill, sloped or flat roof. "
            "Typical Pune plot ~7.32 x 12.20 m."
        ),
        typical_plot_min_m=(5.0, 9.0),
        typical_plot_max_m=(9.0, 14.0),
        floor_count="1 (ground only)",
        target_market="Compact 1BHK independent house, retirees, small family, low budget",
        suitable_for_briefs_like=(
            "1BHK ground-floor bungalow on small Pune plot",
            "Single-floor 1 bedroom independent house for elderly parents",
            "Small 1BHK home on 25x40 ft plot",
            "Affordable 1BHK ground-only house",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK1_PUNE_DUPLEX,
        bhk_family="1BHK",
        form_factor="duplex",
        description=(
            "Two-storey 1BHK duplex (G + 1) on a small plot. Ground "
            "floor: living + kitchen + dining; first floor: bedroom + "
            "bath + balcony. Internal stair connects floors. RCC frame "
            "with masonry walls."
        ),
        typical_plot_min_m=(5.0, 9.0),
        typical_plot_max_m=(9.0, 14.0),
        floor_count="2 (G + 1)",
        target_market="Compact 1BHK duplex, young couples, weekend home, narrow plots",
        suitable_for_briefs_like=(
            "1BHK G+1 duplex on narrow Pune plot",
            "Two-storey 1 bedroom row house",
            "Small 1BHK duplex with ground floor living and upstairs bedroom",
            "1BHK duplex bungalow",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK1_PUNE_TOWER,
        bhk_family="1BHK",
        form_factor="tower",
        description=(
            "Multi-storey 1BHK apartment tower with stilt parking + "
            "habitable floors. Default G+5; G+11 / G+23 selected by "
            "habitable_floor_count parameter. Single 1BHK flat per floor; "
            "RCC frame, lift + stair core, parapet roof."
        ),
        # min aligned to the builder's documented default plot — the tower-
        # core lobby needs ~8m of buildable depth, so anything narrower fails
        # `make_2bhk_pune_tower_core` invariants. The matcher must default
        # to a known-good plot when the brief is silent on dimensions.
        typical_plot_min_m=(7.32, 12.20),
        typical_plot_max_m=(10.0, 16.0),
        floor_count="stilt + 5 (default), 11, or 23 habitable floors",
        target_market="1BHK flats in mid-rise tower, urban rental, first-time buyers",
        suitable_for_briefs_like=(
            "G+5 1BHK apartment building in Pune",
            "1BHK flats high-rise tower",
            "Mid-rise residential tower with 1 bedroom flats per floor",
            "Stilt + 11 storey 1BHK apartment block",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK2_PUNE_HOUSE,
        bhk_family="2BHK",
        form_factor="house",
        description=(
            "Single-storey 2BHK independent house on a typical Pune plot. "
            "Living + dining + kitchen + 2 bedrooms + 2 baths + utility. "
            "RCC frame, load-bearing infill walls, flat parapet roof."
        ),
        typical_plot_min_m=(6.0, 12.0),
        typical_plot_max_m=(10.0, 18.0),
        floor_count="1 (ground only)",
        target_market="Standard 2BHK independent house, small family, single-floor preference",
        suitable_for_briefs_like=(
            "Single floor 2 bedroom home on 1500 sqft plot",
            "2BHK ground-floor bungalow Pune",
            "2BHK independent house single storey",
            "Ground-only 2 bedroom house with 2 baths",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        bhk_family="2BHK",
        form_factor="duplex",
        description=(
            "Two-storey 2BHK duplex (G + 1) — the flagship Tier-2 Pune "
            "template. Ground floor: living + dining + kitchen + 1 "
            "bedroom + bath + utility; first floor: master bedroom + "
            "bath + balcony + study/family room. Internal stair, RCC "
            "frame, masonry walls, brick balcony parapet."
        ),
        typical_plot_min_m=(6.0, 12.0),
        typical_plot_max_m=(10.0, 18.0),
        floor_count="2 (G + 1)",
        target_market="Standard 2BHK duplex bungalow, mid-income family, north-facing plots",
        suitable_for_briefs_like=(
            "2BHK duplex on 24x50 north-facing Pune plot",
            "G+1 2 bedroom duplex bungalow",
            "Two-storey 2BHK home with master bedroom upstairs",
            "2BHK row house duplex with balcony",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK2_PUNE_TOWER,
        bhk_family="2BHK",
        form_factor="tower",
        description=(
            "Multi-storey 2BHK apartment tower with stilt parking + "
            "habitable floors. Default G+5; G+11 / G+23 selected by "
            "habitable_floor_count parameter. Single 2BHK flat per "
            "floor with railing balconies, RCC frame, lift + stair core."
        ),
        # min aligned to builder default — same tower-core lobby
        # constraint as the 1BHK tower variant.
        typical_plot_min_m=(7.32, 15.24),
        typical_plot_max_m=(10.0, 18.0),
        floor_count="stilt + 5 (default), 11, or 23 habitable floors",
        target_market="2BHK flats in mid-rise tower, working family, urban Pune",
        suitable_for_briefs_like=(
            "G+11 apartment building 2BHK flats Pune",
            "12 storey 2 bedroom apartment tower",
            "Mid-rise 2BHK residential tower with stilt parking",
            "Stilt + 5 storey 2BHK apartment block with balcony",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK3_PUNE_HOUSE,
        bhk_family="3BHK",
        form_factor="house",
        description=(
            "Single-storey 3BHK independent house on a larger Pune plot. "
            "Living + dining + kitchen + 3 bedrooms + 3 baths + utility "
            "+ pooja. RCC frame, load-bearing infill walls."
        ),
        # min sized so `_buildable_bounds (3BHK)` clears: with default
        # setbacks (front 4.5, rear 3.0, side 1.5) a 10x18 plot yields
        # 7x10.5 buildable, comfortably above the 6x9 layout minimum.
        typical_plot_min_m=(10.0, 18.0),
        typical_plot_max_m=(13.0, 24.0),
        floor_count="1 (ground only)",
        target_market="Larger 3BHK independent house, joint family, single-floor",
        suitable_for_briefs_like=(
            "3BHK ground-only house on 36x65 ft plot",
            "Single floor 3 bedroom independent house",
            "3BHK bungalow ground floor only Pune",
            "3 bedroom single storey home with pooja room",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK3_PUNE_DUPLEX,
        bhk_family="3BHK",
        form_factor="duplex",
        description=(
            "Two-storey 3BHK duplex (G + 1) on a larger Pune plot. "
            "Ground floor: living + dining + kitchen + 1 bedroom + bath "
            "+ utility + pooja; first floor: master bedroom + 2nd bedroom "
            "+ 2 baths + balcony. Internal stair, RCC frame."
        ),
        # min matches BHK3_PUNE_HOUSE — same `_buildable_bounds (3BHK)`
        # invariant on the duplex's ground-floor layout.
        typical_plot_min_m=(10.0, 18.0),
        typical_plot_max_m=(13.0, 24.0),
        floor_count="2 (G + 1)",
        target_market="Standard 3BHK duplex bungalow, joint family, larger plots",
        suitable_for_briefs_like=(
            "3BHK duplex bungalow on 36x65 ft plot Pune",
            "G+1 3 bedroom duplex with pooja room",
            "Two-storey 3 bedroom home for joint family",
            "3BHK duplex with master bedroom and balcony upstairs",
        ),
    ),
    TemplateDescriptor(
        template_id=TemplateId.BHK3_PUNE_TOWER,
        bhk_family="3BHK",
        form_factor="tower",
        description=(
            "Multi-storey 3BHK apartment tower with stilt parking + "
            "habitable floors. Default G+5; G+11 / G+23 selected by "
            "habitable_floor_count. Single 3BHK flat per floor with "
            "railing balconies, RCC frame, lift + stair core."
        ),
        # min aligned to BHK3 buildable-bounds invariant + tower-core
        # lobby depth requirement (8m). Anything narrower or shorter
        # fails dispatch on default Pune setbacks.
        typical_plot_min_m=(10.0, 18.0),
        typical_plot_max_m=(13.0, 24.0),
        floor_count="stilt + 5 (default), 11, or 23 habitable floors",
        target_market="3BHK flats in mid- to high-rise tower, premium urban Pune",
        suitable_for_briefs_like=(
            "G+11 3BHK apartment tower Pune",
            "Premium 3 bedroom flats in 12 storey building",
            "G+5 3BHK residential tower with stilt parking",
            "Mid-rise 3BHK apartment block with balcony per flat",
        ),
    ),
)


_BY_ID: dict[TemplateId, TemplateDescriptor] = {d.template_id: d for d in CATALOG}


def descriptor_for(template_id: TemplateId) -> TemplateDescriptor:
    """Return the descriptor for ``template_id`` or raise KeyError.

    KeyError is preferred to ValueError because the lookup is keyed:
    every reachable enum value resolves; an unknown value indicates a
    catalog/enum drift that should crash loudly during tests.
    """
    try:
        return _BY_ID[template_id]
    except KeyError as exc:
        raise KeyError(
            f"No catalog descriptor for template_id={template_id!r}; "
            f"catalog covers {sorted(t.value for t in _BY_ID)}"
        ) from exc


__all__ = [
    "BHKFamily",
    "FormFactor",
    "TemplateDescriptor",
    "CATALOG",
    "descriptor_for",
]
