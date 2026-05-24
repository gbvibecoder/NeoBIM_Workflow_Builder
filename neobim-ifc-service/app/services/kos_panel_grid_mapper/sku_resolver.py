"""
SKU code construction + label assignment + reinforcement / bracing lookup.

Source of truth:
  - DESIGN.md §4.4 SKU code format ({TYPE}{THICKNESS}-{CUT_LENGTH})
  - DESIGN.md §4.5 label → SKU mapping table (Vamshi convention)
  - DESIGN.md §4.6 ReinforcementSpec (Field Rule Book §8.2 lookup)
  - DESIGN.md §5 validation rule C-12 (SKU regex)
  - DESIGN.md §6.10 panel orientation defaults

All functions here are **pure**: same input ⇒ same string/dataclass output.
The mapper's algorithm modules call these to construct labels/SKUs/specs
without re-deriving the rules each time.
"""

from __future__ import annotations

from typing import Optional

from .constants import (
    REINFORCEMENT_SPEC_SOURCE,
    REINFORCEMENT_SPECS,
    BracingHeightClass,
    SeismicZone,
    SkuPrefix,
    System,
    classify_bracing_height,
)
from .types import ReinforcementSpec


def build_sku_code(sku_type: SkuPrefix, thickness_mm: int, cut_length_mm: int) -> str:
    """Build a Vamshi-namespace SKU code from its three components.

    Format (DESIGN §4.4 + validation regex C-12):
        "{TYPE}{THICKNESS}-{CUT_LENGTH}"

    Examples (from DESIGN §8 worked examples):
        ("AP",  155, 2998) → "AP155-2998"
        ("BT",  110, 2101) → "BT110-2101"
        ("CP",  155, 2998) → "CP155-2998"
        ("CTC", 110, 2998) → "CTC110-2998"
        ("ECM", 110, 2998) → "ECM110-2998"

    Note: this function does NOT append the "-CUT" suffix for cut members.
    The Panel's `is_cut_member` flag carries that information separately;
    output_validator C-12's regex allows the optional "-CUT" suffix as a
    future SKU-grouping aid (caller appends it if needed).

    The function does NOT validate that thickness is one of {110, 155, 200}
    — non-standard thicknesses are legitimate input for K6-180 SKU code
    construction (e.g. "AP180-2998") prior to CustomQuoteRequest routing.
    Validation of standard-vs-custom is the system_selector's job (PR 5).
    """
    return f"{sku_type}{thickness_mm}-{cut_length_mm}"


def assign_label(
    sku_type: SkuPrefix,
    position_index: int,
    opening_index: Optional[int] = None,
) -> str:
    """Assign a deterministic shop-drawing label per Vamshi convention.

    Rules (DESIGN §4.5 — label → SKU mapping table):

    +------------------------------------------+--------+------------------+
    | Case                                     | Output | SKU types        |
    +------------------------------------------+--------+------------------+
    | Horizontal band (full-wall floor/ceil)   | HB{n}  | BT, TC           |
    | Vertical jamb around opening             | V{n}   | CTC (opening)    |
    | Narrow AP next to opening jamb           | C{n}   | AP (opening)     |
    | Mid-wall stretcher / corner / end-cap    | S{n}   | All others       |
    +------------------------------------------+--------+------------------+

    Args:
        sku_type:        the panel's SKU prefix (10 valid values)
        position_index:  1-based sequential counter for the segment-wide label
                         class (e.g. 3 for the third S panel → "S3")
        opening_index:   1-based index within an opening frame (e.g. 1 for "V1",
                         "C1"). None for non-opening contexts.

    Returns:
        Label string, one of "HB{n}", "V{n}", "C{n}", "S{n}".

    Edge-case scope note: this function does NOT label two cases that the
    splitter handles inline (per DESIGN §6.5 splitter pseudocode):

        - End-terminator CTC at a wall's free end → splitter sets `label="V1"`
          directly (the "V" label is a Vamshi convention for the terminator
          regardless of opening adjacency).
        - Mid-wall CTC narrow infill (residual absorption) → splitter sets
          `label=f"S{len(panels)+1}"` directly.

    For both, the splitter knows the right label from runtime context that
    is opaque to a pure assign_label call. Calling this function for those
    cases would still give a sensible output (S or V) but the splitter
    overrides with the precise per-context choice.
    """
    if sku_type in ("BT", "TC"):
        return f"HB{position_index}"
    if sku_type == "CTC" and opening_index is not None:
        return f"V{opening_index}"
    if sku_type == "AP" and opening_index is not None:
        return f"C{opening_index}"
    # Default: S label for AP main / CP / ECM / ECF / JTM / JTF / PC / CTC mid-wall.
    return f"S{position_index}"


def resolve_reinforcement_spec(
    system: System, seismic_zone: SeismicZone
) -> ReinforcementSpec:
    """Look up the reinforcement spec for a (system, seismic_zone) pair.

    Two-stage lookup (DESIGN §4.6 + Field Rule Book §8.2):
      1. REINFORCEMENT_SPEC_SOURCE[(system, zone)] → section identifier string
      2. REINFORCEMENT_SPECS[section_id] → dict of bars/grade/cover values
      3. Build the ReinforcementSpec dataclass with `source_section` set to
         "Rulebook {section_id}" for audit-trail clarity.

    Examples:
        resolve_reinforcement_spec("K4-110", "III") →
            vertical_bars   = "2 nos 10mm dia. @ 600mm c/c"
            horizontal_bars = "8mm dia. @ 400mm c/c"
            concrete_grade  = "M20"
            cover_external_mm = 20
            cover_internal_mm = 20
            source_section  = "Rulebook §8.2 K4"

        resolve_reinforcement_spec("K6-150", "IV") →
            vertical_bars   = "16mm @ 150mm c/c"
            horizontal_bars = "12mm @ 250mm c/c"
            concrete_grade  = "M30"
            cover_external_mm = 30
            cover_internal_mm = 25
            source_section  = "Rulebook §8.2 K6 Zone IV/V"

    Raises:
        ValueError: when system is "CUSTOM" (no rebar spec exists for arbitrary
            thicknesses; CUSTOM walls route to CustomQuoteRequest at the
            orchestrator level and skip reinforcement lookup entirely).
    """
    if system == "CUSTOM":
        raise ValueError(
            "resolve_reinforcement_spec: CUSTOM system has no fixed reinforcement "
            "spec — orchestrator should route CUSTOM walls to CustomQuoteRequest "
            "and skip this lookup."
        )
    key = (system, seismic_zone)
    if key not in REINFORCEMENT_SPEC_SOURCE:
        raise ValueError(
            f"resolve_reinforcement_spec: no spec for {key}. "
            f"REINFORCEMENT_SPEC_SOURCE has {len(REINFORCEMENT_SPEC_SOURCE)} entries; "
            f"check constants.py for coverage."
        )
    section_id = REINFORCEMENT_SPEC_SOURCE[key]
    spec_values = REINFORCEMENT_SPECS[section_id]
    return ReinforcementSpec(
        vertical_bars=str(spec_values["vertical_bars"]),
        horizontal_bars=str(spec_values["horizontal_bars"]),
        concrete_grade=str(spec_values["concrete_grade"]),
        cover_external_mm=int(spec_values["cover_external_mm"]),
        cover_internal_mm=int(spec_values["cover_internal_mm"]),
        source_section=f"Rulebook {section_id}",
    )


def resolve_bracing_height_class(height_mm: int) -> BracingHeightClass:
    """Thin wrapper over `constants.classify_bracing_height`.

    Existence rationale: the sku_resolver module is the canonical "lookup
    services" surface that the orchestrator (PR 8) and Formwork Generator
    (future slice) call. Routing the bracing-class lookup through this
    module — even though it's a one-line delegation today — keeps the
    abstraction boundary clean and gives us a single point to add warning
    emission for height > 6000mm (Card 1 upper cap) in a future PR.
    """
    return classify_bracing_height(height_mm)
