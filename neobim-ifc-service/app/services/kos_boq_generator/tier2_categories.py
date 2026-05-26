"""Tier 2 — Three-bucket category rollup (Standard / Accessories / Custom).

Sources:

* 02_ALGORITHMS.md Problem 5
* ASSUMPTION-BOQ-14: TIER2_STANDARD_PANEL_PREFIXES = ("AP",) — only AP counts
  as customer-facing "standard panel"; everything else (BT, TC, CP, CTC, ECF,
  ECM, JTF, JTM, PC) is accessory
* Anti-pattern #20: by_reason sorted alphabetically by key
* Anti-pattern #21: custom subtotal_inr is "TBD" Literal
* Anti-pattern #29: standard panel prefix via constant lookup, not hardcoded "AP"
* Anti-pattern #30: empty customs → ``by_reason = ()``
* Anti-pattern #31: aggregate by Literal ``reason`` (NOT human-readable
  ``reason_detail``)
* Anti-pattern #36: ``sum()`` uses ``start=0.0`` for float-typed sums

Pure function. No I/O. No mutation. Deterministic.
"""

from __future__ import annotations

from .constants import (
    TIER2_ACCESSORY_PREFIXES,
    TIER2_STANDARD_PANEL_PREFIXES,
)
from .types import (
    CustomQuoteLineItem,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2Category,
    Tier3SKUType,
)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def build_tier2_categories(
    tier3_rows: tuple[Tier3SKUType, ...],
    custom_quote_items: tuple[CustomQuoteLineItem, ...],
) -> Tier2Category:
    """Build Tier 2 from Tier 3 + custom items.

    Three buckets:

    * ``standard_panels``: aggregate Tier 3 rows whose prefix ∈
      ``TIER2_STANDARD_PANEL_PREFIXES`` (= ``("AP",)``).
    * ``accessories``: aggregate Tier 3 rows whose prefix ∈
      ``TIER2_ACCESSORY_PREFIXES`` (BT, TC, CP, CTC, ECF, ECM, JTF, JTM, PC).
    * ``custom_quotes``: derived from ``custom_quote_items`` (count + sum of
      ``estimated_weight_kg`` + ``by_reason`` aggregation).

    The synthetic CUSTOM Tier 3 row (if present) is NOT folded into the
    standard or accessories bucket. It mirrors the same source data as the
    custom bucket here (both derive from ``custom_quote_items``); having both
    representations is a deliberate redundancy: Tier 3 surfaces the rollup
    per-prefix, Tier 2 surfaces the customer-facing 3-bucket split.

    Parameters
    ----------
    tier3_rows:
        Per-prefix Tier 3 rows from ``build_tier3_sku_types``.
    custom_quote_items:
        Caller-supplied custom quote line items.

    Returns
    -------
    Tier2Category
        Three buckets (standard / accessories / custom).
    """
    standard_bucket = _build_priced_bucket(tier3_rows, TIER2_STANDARD_PANEL_PREFIXES)
    accessories_bucket = _build_priced_bucket(tier3_rows, TIER2_ACCESSORY_PREFIXES)
    custom_bucket = _build_custom_bucket(custom_quote_items)

    return Tier2Category(
        standard_panels=standard_bucket,
        accessories=accessories_bucket,
        custom_quotes=custom_bucket,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Priced bucket builder (standard panels + accessories share this logic)
# ──────────────────────────────────────────────────────────────────────────────


def _build_priced_bucket(
    tier3_rows: tuple[Tier3SKUType, ...],
    matching_prefixes: tuple[str, ...],
) -> Tier2Bucket:
    """Aggregate Tier 3 rows whose prefix is in the matching set.

    Anti-pattern #29: matching by constant tuple membership (NOT hardcoded
    ``== "AP"`` etc.) — keeps the categorization data-driven.

    Anti-pattern #36: float sums use ``start=0.0`` so empty matching set
    returns ``0.0`` (float), not ``0`` (int).
    """
    matching = [r for r in tier3_rows if r.sku_prefix in matching_prefixes]
    return Tier2Bucket(
        count=sum(r.total_count for r in matching),                    # int sum
        weight_kg=sum((r.total_weight_kg for r in matching), start=0.0),
        subtotal_inr=sum((r.total_price_inr for r in matching), start=0.0),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Custom bucket builder
# ──────────────────────────────────────────────────────────────────────────────


def _build_custom_bucket(
    custom_items: tuple[CustomQuoteLineItem, ...],
) -> Tier2BucketCustom:
    """Build the custom-quotes bucket.

    * ``count``: len(custom_items)
    * ``weight_kg_estimated``: sum of ``item.estimated_weight_kg`` where not None
    * ``subtotal_inr``: always "TBD" (Literal — anti-pattern #21)
    * ``by_reason``: tuple of ``(reason_key, count)`` pairs sorted alphabetically
      by key (anti-pattern #20). Aggregates by the Literal ``reason`` enum
      value, NOT the human-readable ``reason_detail`` string (anti-pattern #31).

    Edge case (anti-pattern #30): empty custom_items → ``by_reason = ()``.
    """
    count = len(custom_items)
    weight_estimated = sum(
        (
            item.estimated_weight_kg for item in custom_items
            if item.estimated_weight_kg is not None
        ),
        start=0.0,
    )

    # Aggregate by_reason — anti-pattern #31: use Literal enum, NOT reason_detail
    reason_counts: dict[str, int] = {}
    for item in custom_items:
        reason_counts[item.reason] = reason_counts.get(item.reason, 0) + 1

    # Anti-pattern #20: alphabetical sort by key (deterministic across runs).
    by_reason = tuple(sorted(reason_counts.items()))

    return Tier2BucketCustom(
        count=count,
        weight_kg_estimated=weight_estimated,
        subtotal_inr="TBD",                                            # anti-pattern #21
        by_reason=by_reason,
    )
