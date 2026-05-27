"""Aggregate Tier 6 components + custom-quote items → Tier 2 buckets.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation).

Bucket assignment derived from PR 1 golden math:
  - PR 1 golden P_INT_8 has bracing_primary.count = 14 = 5 (props) + 9 (kickers)
  - PR 1 golden P_INT_8 has bracing_secondary.count = 10 = 5 (BP) + 5 (PH)
  - PR 1 golden P_INT_8 has bracing_secondary.linear_meters = 2.20605 (track)

So BRACING_PRIMARY = {prop, kicker, waler, diagonal_brace, raker_prop} (FRB §9 active
bracing); BRACING_SECONDARY = {base_plate, prop_head, corner_clamp, joint_gasket,
starter_track, alignment_brace, misc} (accessories + corner SKUs).

🚨 Count semantics: `count` = SUM OF INTEGER QUANTITIES for entries with unit='nos'.
   It is NOT the number of Tier 6 entries.

🚨 linear_meters: SUM of `quantity` for entries with unit='linear_m', rounded to 5 decimals.

custom_quotes:
  - `count` = len(custom_quote_items)
  - `pending_count` = len(custom_quote_items) for PR 3 (PR 4 may differentiate states)
  - `note` = literal from PR 1 golden
"""
from __future__ import annotations

import logging
from typing import Tuple

from app.services.kos_formwork_generator.exceptions import FormworkInvariantError
from app.services.kos_formwork_generator.types import (
    FormworkCustomQuoteRequest,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2FormworkCategories,
    Tier6FormworkComponent,
)

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# BUCKET ASSIGNMENT (verified against PR 1 golden P_INT_8)
# ═════════════════════════════════════════════════════════════════════

#: Active bracing components per FRB §9 (Bracing Installation Rules).
#: Tier 2 `bracing_primary` aggregates Tier 6 entries with these component_types.
BRACING_PRIMARY_COMPONENT_TYPES: frozenset = frozenset({
    "prop",
    "kicker",
    "waler",
    "diagonal_brace",
    "raker_prop",
})

#: Accessory + connector + edge components.
#: Tier 2 `bracing_secondary` aggregates Tier 6 entries with these component_types.
BRACING_SECONDARY_COMPONENT_TYPES: frozenset = frozenset({
    "base_plate",
    "prop_head",
    "corner_clamp",
    "joint_gasket",
    "starter_track",
    "alignment_brace",
    "misc",
})

#: Literal note string for custom_quotes bucket. Per PR 1 golden + Karthik scope lock 2026-05-26.
_CUSTOM_QUOTES_NOTE: str = (
    "Custom quote — engineer reviews (no pricing in 5F output per Karthik 2026-05-26)."
)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier2_summary(
    tier_6_components: Tuple[Tier6FormworkComponent, ...],
    custom_quote_items: Tuple[FormworkCustomQuoteRequest, ...] = (),
) -> Tier2FormworkCategories:
    """Build Tier 2 buckets from Tier 6 components + custom-quote items.

    Args:
        tier_6_components: tuple of Tier 6 entries (from build_tier6_components).
        custom_quote_items: tuple of custom-quote requests (PR 4 generates;
            PR 3 takes empty tuple for byte-equal P_INT_8 test).

    Returns:
        Tier2FormworkCategories with three buckets:
          - bracing_primary: Tier2Bucket(count, linear_meters)
          - bracing_secondary: Tier2Bucket(count, linear_meters)
          - custom_quotes: Tier2BucketCustom(count, pending_count, note)

    Raises:
        FormworkInvariantError: if a Tier 6 component_type is not in either bucket set.
    """
    logger.debug(
        "build_tier2_summary: %d Tier 6 entries, %d custom_quote_items",
        len(tier_6_components), len(custom_quote_items),
    )

    primary_count = 0
    primary_linear_m = 0.0
    secondary_count = 0
    secondary_linear_m = 0.0

    for comp in tier_6_components:
        ctype = comp.component_type
        if ctype in BRACING_PRIMARY_COMPONENT_TYPES:
            if comp.unit == "nos":
                # Sum integer quantities (golden semantics).
                primary_count += int(comp.quantity)
            elif comp.unit == "linear_m":
                primary_linear_m += comp.quantity
            else:
                raise FormworkInvariantError(
                    f"Tier 6 component {comp.component_id!r} has unknown unit "
                    f"{comp.unit!r}",
                    invariant_id="F-T2-UNKNOWN-UNIT",
                )
        elif ctype in BRACING_SECONDARY_COMPONENT_TYPES:
            if comp.unit == "nos":
                secondary_count += int(comp.quantity)
            elif comp.unit == "linear_m":
                secondary_linear_m += comp.quantity
            else:
                raise FormworkInvariantError(
                    f"Tier 6 component {comp.component_id!r} has unknown unit "
                    f"{comp.unit!r}",
                    invariant_id="F-T2-UNKNOWN-UNIT",
                )
        else:
            raise FormworkInvariantError(
                f"Tier 6 component {comp.component_id!r} has component_type "
                f"{ctype!r} which is not in BRACING_PRIMARY nor BRACING_SECONDARY. "
                f"PRIMARY={sorted(BRACING_PRIMARY_COMPONENT_TYPES)}, "
                f"SECONDARY={sorted(BRACING_SECONDARY_COMPONENT_TYPES)}.",
                invariant_id="F-T2-UNKNOWN-COMPONENT-TYPE",
            )

    bracing_primary = Tier2Bucket(
        count=primary_count,
        linear_meters=round(primary_linear_m, 5),
    )
    bracing_secondary = Tier2Bucket(
        count=secondary_count,
        linear_meters=round(secondary_linear_m, 5),
    )
    custom_quotes = Tier2BucketCustom(
        count=len(custom_quote_items),
        pending_count=len(custom_quote_items),
        note=_CUSTOM_QUOTES_NOTE,
    )

    logger.debug(
        "build_tier2_summary: primary count=%d linear=%.5f; secondary count=%d linear=%.5f; custom=%d",
        primary_count, bracing_primary.linear_meters,
        secondary_count, bracing_secondary.linear_meters,
        len(custom_quote_items),
    )
    return Tier2FormworkCategories(
        bracing_primary=bracing_primary,
        bracing_secondary=bracing_secondary,
        custom_quotes=custom_quotes,
    )
