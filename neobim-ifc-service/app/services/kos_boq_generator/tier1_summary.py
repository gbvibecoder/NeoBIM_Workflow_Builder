"""Tier 1 — Project summary (the customer's first-screen view).

Sources:

* 02_ALGORITHMS.md Problem 6
* POLICY-DISCOUNT-PRE-TAX: discount applied BEFORE tax
* ASSUMPTION-BOQ-15: skin/rib = 60/40 split on Tier 2 total weight (NOT
  per-panel sum — IEEE-754 drift risk)

Money math (POLICY-DISCOUNT-PRE-TAX)::

    priced_subtotal       = std_subtotal + accessories_subtotal
                            # custom items EXCLUDED (POLICY-CUSTOM-QUOTE-SEPARATE)
    discount_inr          = priced_subtotal * (discount_percent / 100)
    subtotal_after_discount = priced_subtotal - discount_inr
    tax_inr               = subtotal_after_discount * (tax_rate_percent / 100)
    grand_total           = subtotal_after_discount + tax_inr

CRITICAL — multiplication form (anti-pattern #37):

Pre-flight A (2026-05-25) verified that PR 1's golden was computed with the
**parenthesized form** (``value * (pct / 100)``), not the left-to-right form
(``value * pct / 100``). The two differ by 1 ULP for some inputs because
intermediate ``value * pct`` loses precision before division by 100.

This module uses ``value * (pct / 100)`` (Form B/C/D from pre-flight A) for
byte-equal golden reproduction. The prompt's spec showed Form A; pre-flight A
proved Form A doesn't match. PR 3 follows golden, not prompt spec.

Pure function. No I/O. No ``random``, no ``datetime.now()``. Deterministic.
"""

from __future__ import annotations

from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

from .constants import (
    RIB_WEIGHT_FRACTION,
    SKIN_WEIGHT_FRACTION,
)
from .formatters import (
    compute_quote_validity_until,
    format_indian_comma,
    synth_quote_number,
)
from .types import (
    BOQContext,
    CustomQuoteLineItem,
    OperatorReviewItem,
    Tier1ProjectSummary,
    Tier2Category,
    Tier5WallSegment,
    Tier6PanelPiece,
)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def build_tier1_project_summary(
    tier6: tuple[Tier6PanelPiece, ...],
    tier5: tuple[Tier5WallSegment, ...],
    tier2: Tier2Category,
    custom_quote_items: tuple[CustomQuoteLineItem, ...],
    operator_review_items: tuple[OperatorReviewItem, ...],
    context: BOQContext,
    mapper_output: PanelGridMapperOutput,
) -> Tier1ProjectSummary:
    """Build the Tier 1 project summary.

    Inputs are the outputs of preceding tier algorithms (Tier 6/5/2) + custom
    and operator items (synthesised by PR 4 in production; synth'd for PR 3
    tests) + commercial context + mapper output (for project name).

    The ``tier6`` parameter is currently unused in the algorithm but kept in
    the signature for forward-compatibility — PR 5's orchestrator may want
    to add per-panel diagnostics to the summary later.

    All anti-pattern compliance verified — see this module's docstring +
    inline comments for citation.
    """
    # ── Counts (anti-pattern #7: from Tier 2 hierarchy, not per-panel sums) ──
    total_standard = tier2.standard_panels.count
    total_accessory = tier2.accessories.count
    total_custom = len(custom_quote_items)
    # is_curved flag on Tier 5 today is hardcoded False (mapper lacks the
    # attribute per PR 2 §3.7). When mapper adds it, this count starts firing.
    total_curves = sum(1 for seg in tier5 if seg.is_curved)
    total_openings = sum(len(seg.openings) for seg in tier5)
    # Anti-pattern #25 conceptually: only count "orphan_opening" review_type
    # (other future types like "low_confidence_opening" count separately).
    total_orphans = sum(
        1 for item in operator_review_items
        if item.review_type == "orphan_opening"
    )

    # ── Weights (anti-pattern #6: 60/40 on Tier 2 total, NOT per-panel sum) ──
    total_weight = tier2.standard_panels.weight_kg + tier2.accessories.weight_kg
    total_weight_skin = total_weight * SKIN_WEIGHT_FRACTION
    total_weight_rib = total_weight * RIB_WEIGHT_FRACTION
    custom_weight_estimated = tier2.custom_quotes.weight_kg_estimated

    # ── Money math (POLICY-DISCOUNT-PRE-TAX + Form D from pre-flight A) ──
    # Anti-pattern #16: grand_total EXCLUDES custom subtotal (custom = "TBD").
    standard_subtotal = tier2.standard_panels.subtotal_inr
    accessories_subtotal = tier2.accessories.subtotal_inr
    priced_subtotal = standard_subtotal + accessories_subtotal

    # Anti-pattern #17/#18: use context, NOT hardcoded.
    # Anti-pattern #37: parenthesized division (Form D) to match PR 1 golden.
    discount_inr = priced_subtotal * (context.discount_percent / 100)
    subtotal_after_discount = priced_subtotal - discount_inr
    tax_inr = subtotal_after_discount * (context.tax_rate_percent / 100)
    grand_total = subtotal_after_discount + tax_inr

    # Format grand total with Indian comma (anti-patterns #8, #9, #10, #11).
    grand_total_formatted = format_indian_comma(grand_total)

    # ── Quote metadata (anti-patterns #13/#14) ──
    quote_number = context.quote_number or synth_quote_number(
        context.project_id, context.quote_date
    )
    # Anti-pattern #12: pure date arithmetic.
    quote_validity_until = compute_quote_validity_until(
        context.quote_date, context.quote_validity_days
    )

    return Tier1ProjectSummary(
        # Anti-pattern #19: project_name from MAPPER output, not context.project_id.
        project_name=mapper_output.project_name,
        quote_number=quote_number,
        quote_date=context.quote_date,
        quote_validity_until=quote_validity_until,
        # Counts
        total_standard_panels=total_standard,
        total_accessory_pieces=total_accessory,
        total_custom_quote_items=total_custom,
        total_curve_segments=total_curves,
        total_openings_in_walls=total_openings,
        total_orphan_openings=total_orphans,
        # Weights
        total_weight_kg=total_weight,
        total_weight_kg_skin=total_weight_skin,
        total_weight_kg_rib=total_weight_rib,
        # Money
        standard_panels_subtotal_inr=standard_subtotal,
        accessories_subtotal_inr=accessories_subtotal,
        custom_quotes_pending_count=total_custom,
        custom_quotes_estimated_weight_kg=custom_weight_estimated,
        discount_inr=discount_inr,
        subtotal_after_discount_inr=subtotal_after_discount,
        tax_inr=tax_inr,
        grand_total_inr=grand_total,
        grand_total_inr_formatted=grand_total_formatted,
        # Anti-pattern #15: derived from len(custom_quote_items) > 0.
        has_unpriced_items=len(custom_quote_items) > 0,
    )
