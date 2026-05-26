"""Tier 3 — Per-SKU-prefix rollup (project-wide grouping by prefix).

Sources:

* 02_ALGORITHMS.md Problem 4
* ASSUMPTION-BOQ (canonical prefix order): ``TIER3_CANONICAL_PREFIX_ORDER``
* POLICY-CUSTOM-QUOTE-SEPARATE: synthetic CUSTOM row only when custom items present
* Anti-pattern #3: CUSTOM row only when custom_quote_items non-empty
* Anti-pattern #4: skip prefixes with 0 panels
* Anti-pattern #5: follow TIER3_CANONICAL_PREFIX_ORDER, not Python dict insertion
* Anti-pattern #22: CUSTOM row ``total_price_inr = 0.0`` always
* Anti-pattern #36: use ``start=0.0`` for float-typed sums

Notes-field discrepancy (PR 3 §3.2 / Anti-pattern #24 vs PR 1 golden):

* Prompt anti-pattern #24 specified ``notes = "Multiple thickness variants"``
  or ``""`` based on per-prefix thickness count.
* PR 1 golden (verified by pre-flight A) uses ``SKU_PREFIX_DESCRIPTIONS`` lookup
  values (e.g. ``"vertical panel (standard stretcher)"`` for AP).
* PR 1 golden is the canonical contract (audit-first discipline).
* This module uses the SKU_PREFIX_DESCRIPTIONS lookup, NOT the per-thickness
  conditional. Documented as PR 3 Discrepancy #2.

Pure function. No I/O. No mutation. Deterministic.
"""

from __future__ import annotations

from .constants import (
    SKU_PREFIX_DESCRIPTIONS,
    TIER3_CANONICAL_PREFIX_ORDER,
)
from .types import CustomQuoteLineItem, Tier3SKUType, Tier4SKUDetail


# Build O(1) lookup dict from the tuple-of-pairs constant (anti-pattern #2 — the
# constant uses tuples for immutability; dict is per-module cache for lookup).
_DESCRIPTION_LOOKUP: dict[str, str] = dict(SKU_PREFIX_DESCRIPTIONS)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def build_tier3_sku_types(
    tier4_rows: tuple[Tier4SKUDetail, ...],
    custom_quote_items: tuple[CustomQuoteLineItem, ...],
) -> tuple[Tier3SKUType, ...]:
    """Build Tier 3 from Tier 4 + custom items.

    Standard prefixes: aggregate Tier 4 rows sharing a prefix into one row.
    CUSTOM row: synthetic, derived from ``custom_quote_items`` count + summed
    estimated weight + summed area where computable.

    Order: ``TIER3_CANONICAL_PREFIX_ORDER`` (CUSTOM last). Prefixes with zero
    panels in Tier 4 are skipped (anti-pattern #4).

    Edge case (anti-pattern #20): empty Tier 4 + empty customs → ``()``.
    Empty Tier 4 + non-empty customs → ``(CUSTOM row,)`` only.

    Parameters
    ----------
    tier4_rows:
        Project-wide Tier 4 SKU details from ``build_tier4_sku_details``.
    custom_quote_items:
        Caller-supplied custom quote line items. PR 3 takes these as input;
        PR 4 builds them from mapper's ``custom_quote_requests`` via regex
        classifier.

    Returns
    -------
    tuple[Tier3SKUType, ...]
        Per-prefix rows in canonical order, with synthetic CUSTOM row last
        (only when ``custom_quote_items`` is non-empty).
    """
    # Group Tier 4 rows by prefix.
    by_prefix: dict[str, list[Tier4SKUDetail]] = {}
    for row in tier4_rows:
        by_prefix.setdefault(row.sku_prefix, []).append(row)

    tier3_rows: list[Tier3SKUType] = []
    for prefix in TIER3_CANONICAL_PREFIX_ORDER:
        # CUSTOM handled separately at end (anti-pattern #3: only if items exist).
        if prefix == "CUSTOM":
            continue
        # Anti-pattern #4: skip prefixes with zero Tier 4 rows.
        if prefix not in by_prefix:
            continue
        tier3_rows.append(_build_standard_tier3_row(prefix, by_prefix[prefix]))

    # Synthetic CUSTOM row at end if there are any custom items
    # (anti-pattern #3: don't emit when empty).
    if custom_quote_items:
        tier3_rows.append(_build_custom_tier3_row(custom_quote_items))

    return tuple(tier3_rows)


# ──────────────────────────────────────────────────────────────────────────────
# Per-prefix row builders
# ──────────────────────────────────────────────────────────────────────────────


def _build_standard_tier3_row(
    prefix: str,
    rows: list[Tier4SKUDetail],
) -> Tier3SKUType:
    """Aggregate Tier 4 rows of a single SKU prefix into one Tier 3 row.

    Aggregations:

    * ``total_count``: int sum of quantities (safe; integers don't drift)
    * ``total_area_sqft``: float sum with ``start=0.0`` (anti-pattern #36)
    * ``total_weight_kg``: float sum with ``start=0.0``
    * ``total_price_inr``: float sum with ``start=0.0``

    Notes: per PR 1 golden contract (Discrepancy #2 — overrides anti-pattern #24),
    use ``SKU_PREFIX_DESCRIPTIONS`` lookup value, regardless of thickness count.
    """
    total_count = sum(r.quantity for r in rows)                        # int sum
    total_area = sum((r.line_total_area_sqft for r in rows), start=0.0)
    total_weight = sum((r.line_total_weight_kg for r in rows), start=0.0)
    total_price = sum((r.line_total_price_inr for r in rows), start=0.0)

    return Tier3SKUType(
        sku_prefix=prefix,
        total_count=total_count,
        total_area_sqft=total_area,
        total_weight_kg=total_weight,
        total_price_inr=total_price,
        notes=_DESCRIPTION_LOOKUP.get(prefix, prefix),
    )


def _build_custom_tier3_row(
    custom_items: tuple[CustomQuoteLineItem, ...],
) -> Tier3SKUType:
    """Build the synthetic CUSTOM Tier 3 row from ``custom_quote_items``.

    Per POLICY-CUSTOM-QUOTE-SEPARATE + anti-pattern #22:
    ``total_price_inr = 0.0`` always (custom items have ``subtotal_inr = "TBD"``
    individually; the Tier 3 row never carries a price).

    Aggregations skip ``None`` values (custom items may have unknown
    ``area_sqft`` or ``estimated_weight_kg``).

    Notes: uses ``SKU_PREFIX_DESCRIPTIONS["CUSTOM"]`` for consistency with the
    other Tier 3 rows (PR 1 constants already defined this).
    """
    total_count = len(custom_items)
    total_area = sum(
        (item.area_sqft for item in custom_items if item.area_sqft is not None),
        start=0.0,
    )
    total_weight = sum(
        (
            item.estimated_weight_kg for item in custom_items
            if item.estimated_weight_kg is not None
        ),
        start=0.0,
    )

    return Tier3SKUType(
        sku_prefix="CUSTOM",
        total_count=total_count,
        total_area_sqft=total_area,
        total_weight_kg=total_weight,
        total_price_inr=0.0,                                           # anti-pattern #22
        notes=_DESCRIPTION_LOOKUP.get("CUSTOM", "Custom quote items"),
    )
