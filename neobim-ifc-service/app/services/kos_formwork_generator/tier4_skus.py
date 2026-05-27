"""Aggregate Tier6 components → Tier4SKUDetail per unique SKU.

Reference: 5F-DESIGN v2 doc 02 §15 (Problem 13 — Tier aggregation).

Tier 4 stores per-SKU project totals with base + wastage breakdown.

Output ORDER preserves Tier 6 first-occurrence order (per PR 1 golden convention).
For P_INT_8: PROP → KICK → BP → PH → TRACK (matches Tier 6 canonical emission).
This is DETERMINISTIC because Tier 6 itself is deterministic (canonical category
order × alphabetic wall_id order).

🚨 base_quantity is NOT recomputed from total via float-inverse (lossy).
   Caller (orchestrator / tests) must pass base_quantities_by_sku dict produced
   by build_tier6_components alongside the components.
"""
from __future__ import annotations

import logging
from typing import Dict, Optional, Tuple

from app.services.kos_formwork_generator.constants import (
    FORMWORK_SKU_CATALOG,
    SKU_DESCRIPTION,
    SKU_UNIT,
)
from app.services.kos_formwork_generator.exceptions import (
    FormworkConfigError,
    FormworkInvariantError,
)
from app.services.kos_formwork_generator.types import (
    Tier4SKUDetail,
    Tier6FormworkComponent,
)

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═════════════════════════════════════════════════════════════════════

#: Valid thickness values for thickness_mm derivation.
_VALID_THICKNESSES: frozenset = frozenset({110, 150, 180, 200, 250})


# ═════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS (exposed for testing via __all__)
# ═════════════════════════════════════════════════════════════════════


def _derive_sku_prefix(sku_code: str) -> str:
    """Derive sku_prefix from SKU code per PR 1 golden convention.

    sku_prefix is the SECOND hyphen-separated segment (after 'KZ-').
    Examples:
        KZ-PROP-L     → 'PROP'
        KZ-KICK-01    → 'KICK'
        KZ-BP-01      → 'BP'
        KZ-PH-01      → 'PH'
        KZ-TRACK-110  → 'TRACK'
        KZ-WC-200     → 'WC'
        KZ-CC-90-150  → 'CC'
        KZ-DB-01      → 'DB'
        KZ-JG-01      → 'JG'
        KZ-RAKER-01   → 'RAKER'

    Raises:
        FormworkConfigError: if SKU doesn't match expected format.
    """
    parts = sku_code.split("-")
    if len(parts) < 2 or parts[0] != "KZ":
        raise FormworkConfigError(
            f"Cannot derive sku_prefix from {sku_code!r}; expected 'KZ-XXX-...' format."
        )
    return parts[1]


def _derive_thickness_mm(sku_code: str) -> int:
    """Derive thickness_mm from SKU code.

    Returns:
        Integer thickness if SKU's LAST segment is in {110, 150, 180, 200, 250}.
        Returns 0 otherwise (per PR 1 golden convention; thickness_mm is int not Optional).

    Examples:
        KZ-TRACK-110  → 110
        KZ-WC-150     → 150
        KZ-CC-90-200  → 200
        KZ-CC-T-250   → 250
        KZ-PROP-L     → 0
        KZ-KICK-01    → 0
        KZ-BP-01      → 0
    """
    parts = sku_code.split("-")
    if len(parts) < 2:
        return 0
    last = parts[-1]
    try:
        candidate = int(last)
    except ValueError:
        return 0
    if candidate in _VALID_THICKNESSES:
        return candidate
    return 0


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def build_tier4_skus(
    tier_6_components: Tuple[Tier6FormworkComponent, ...],
    base_quantities_by_sku: Dict[str, float],
    sku_catalog: Tuple[tuple, ...] = FORMWORK_SKU_CATALOG,
) -> Tuple[Tier4SKUDetail, ...]:
    """Aggregate Tier 6 components → Tier 4 per-SKU project totals.

    Args:
        tier_6_components: tuple of all Tier6FormworkComponent in the project.
        base_quantities_by_sku: dict {sku_code → sum of base quantities},
            produced by build_tier6_components.
        sku_catalog: override for testing; default is FORMWORK_SKU_CATALOG.

    Returns:
        Tuple of Tier4SKUDetail in Tier 6 first-occurrence order (matches PR 1 golden).
        Order is deterministic because Tier 6 itself is deterministic (canonical
        category emission × alphabetic wall_id processing).

    Raises:
        FormworkConfigError: if a Tier 6 SKU is missing from the catalog.
        FormworkInvariantError: if base_quantities_by_sku missing a SKU present in Tier 6,
                                 or if computed wastage_quantity is negative.
    """
    logger.debug(
        "build_tier4_skus: %d tier6 components, %d unique base SKUs",
        len(tier_6_components), len(base_quantities_by_sku),
    )

    # Use SKU_DESCRIPTION / SKU_UNIT for fast lookup (built from catalog at module load).
    # Per PR 1 constants.py these are MappingProxyType (immutable view of catalog).

    # Group total_quantities by sku_code, PRESERVING first-occurrence order
    # (Python 3.7+ dicts preserve insertion order).
    totals_by_sku: Dict[str, float] = {}
    sku_order: list = []  # explicit order tracking — defensive
    for comp in tier_6_components:
        if comp.sku_code not in totals_by_sku:
            sku_order.append(comp.sku_code)
        totals_by_sku[comp.sku_code] = totals_by_sku.get(comp.sku_code, 0.0) + comp.quantity

    results: list = []

    for sku_code in sku_order:
        if sku_code not in SKU_DESCRIPTION:
            raise FormworkConfigError(
                f"Tier 6 component references unknown SKU {sku_code!r} "
                f"not in FORMWORK_SKU_CATALOG."
            )
        if sku_code not in base_quantities_by_sku:
            raise FormworkInvariantError(
                f"Tier 6 component has SKU {sku_code!r} but base_quantities_by_sku "
                f"is missing it. build_tier6_components must track every emitted SKU.",
                invariant_id="F-TIER6-BASE-TRACKING",
            )

        total_quantity = totals_by_sku[sku_code]
        base_quantity = base_quantities_by_sku[sku_code]
        wastage_quantity = total_quantity - base_quantity

        # Round wastage to 5 decimals for linear_m (matches Tier 6 rounding)
        unit = SKU_UNIT[sku_code]
        if unit == "linear_m":
            wastage_quantity = round(wastage_quantity, 5)
            base_quantity = round(base_quantity, 5)
            total_quantity = round(total_quantity, 5)
        # For 'nos': base + wastage are integers; no rounding needed.

        if wastage_quantity < 0:
            raise FormworkInvariantError(
                f"SKU {sku_code!r}: wastage_quantity={wastage_quantity} is negative "
                f"(total={total_quantity}, base={base_quantity}).",
                invariant_id="F-WASTAGE-NON-NEGATIVE",
            )

        description = SKU_DESCRIPTION[sku_code]
        sku_prefix = _derive_sku_prefix(sku_code)
        thickness_mm = _derive_thickness_mm(sku_code)

        results.append(
            Tier4SKUDetail(
                sku_code=sku_code,
                sku_prefix=sku_prefix,
                thickness_mm=thickness_mm,
                description=description,
                base_quantity=base_quantity,
                wastage_quantity=wastage_quantity,
                total_quantity=total_quantity,
                unit=unit,
            )
        )

    logger.debug("build_tier4_skus: emitted %d Tier4 entries", len(results))
    return tuple(results)
