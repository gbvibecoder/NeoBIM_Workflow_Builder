"""Aggregate Tier 4 SKU details → Tier 3 per-sku_prefix totals.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation).

For each unique sku_prefix in Tier 4:
  - `total_count` = sum of `total_quantity` across Tier 4 entries with unit='nos'
  - `total_linear_meters` = sum of `total_quantity` across Tier 4 entries with unit='linear_m'
    (rounded to 5 decimal places per PR 1 golden precision)

Output order preserves Tier 4 first-occurrence (matches PR 1 golden convention).
"""
from __future__ import annotations

import logging
from typing import Dict, Tuple

from app.services.kos_formwork_generator.exceptions import FormworkInvariantError
from app.services.kos_formwork_generator.types import Tier3SKUType, Tier4SKUDetail

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier3_categories(
    tier_4_sku_details: Tuple[Tier4SKUDetail, ...],
) -> Tuple[Tier3SKUType, ...]:
    """Aggregate Tier 4 → Tier 3 per sku_prefix.

    Args:
        tier_4_sku_details: tuple of Tier4SKUDetail in first-occurrence order
            (as produced by build_tier4_skus).

    Returns:
        Tuple of Tier3SKUType in Tier 4 first-occurrence order. Each entry has
        `sku_prefix`, `total_count` (sum of 'nos' quantities), and
        `total_linear_meters` (sum of 'linear_m' quantities, rounded to 5 decimals).

    Raises:
        FormworkInvariantError: if a sku_prefix has mixed units in Tier 4 input
            (e.g., one 'nos' SKU and one 'linear_m' SKU with the same prefix —
            should never happen with PR 1 catalog; defensive check).
    """
    logger.debug(
        "build_tier3_categories: %d Tier4 entries input", len(tier_4_sku_details),
    )

    # Group by sku_prefix, preserving first-occurrence order via dict insertion order.
    # Python 3.7+ dicts preserve insertion order.
    prefix_data: Dict[str, dict] = {}
    prefix_order: list = []

    for entry in tier_4_sku_details:
        prefix = entry.sku_prefix
        if prefix not in prefix_data:
            prefix_order.append(prefix)
            prefix_data[prefix] = {
                "total_count": 0,
                "total_linear_meters": 0.0,
                "units_seen": set(),
            }
        data = prefix_data[prefix]
        data["units_seen"].add(entry.unit)
        if entry.unit == "nos":
            # Integer counts (cast to int defensively; ceil already applied in Tier 4).
            data["total_count"] += int(entry.total_quantity)
        elif entry.unit == "linear_m":
            data["total_linear_meters"] += entry.total_quantity
        else:
            raise FormworkInvariantError(
                f"Tier 4 entry {entry.sku_code!r} has unknown unit {entry.unit!r}",
                invariant_id="F-T3-UNKNOWN-UNIT",
            )

    # Validate unit consistency per prefix
    for prefix, data in prefix_data.items():
        if len(data["units_seen"]) > 1:
            raise FormworkInvariantError(
                f"sku_prefix {prefix!r} has mixed units {sorted(data['units_seen'])}; "
                f"Tier 3 cannot aggregate inconsistent unit types within a prefix.",
                invariant_id="F-T3-UNIT-CONSISTENT",
            )

    # Build Tier 3 entries in first-occurrence order
    results: list = []
    for prefix in prefix_order:
        data = prefix_data[prefix]
        results.append(
            Tier3SKUType(
                sku_prefix=prefix,
                total_count=data["total_count"],
                total_linear_meters=round(data["total_linear_meters"], 5),
            )
        )

    logger.debug("build_tier3_categories: emitted %d Tier 3 entries", len(results))
    return tuple(results)
