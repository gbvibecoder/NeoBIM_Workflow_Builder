"""Lookup tables for KOS Formwork Quantities Generator.

BRACING_LOOKUP_TABLE: 16 ``BracingScheme`` entries per FRB Appendix A Card 1
(K4-110 × 3 + K6-150 × 4 + K6-180 × 3 + K8-200 × 3 + K8-250 × 3 = 16).

Reference: 5F-DESIGN v2 doc 02_ALGORITHMS.md §3 (Problem 1 — Bracing scheme lookup),
which itself cites PREFLIGHT_A_FIELD_RULES.md PART 16 (Appendix A Card 1).

Lookup semantics (PR 2 ``component_counter`` will implement):
  Given (system, height_m), select the unique row whose
  [height_range_min_m, height_range_max_m] interval CONTAINS height_m,
  with the upper bound INCLUSIVE per FRB convention.
"""
from __future__ import annotations

import logging
from typing import Final, Tuple

from app.services.kos_formwork_generator.types import BracingScheme

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# BRACING LOOKUP TABLE — 16 entries (FRB Appendix A Card 1)
# ═════════════════════════════════════════════════════════════════════

BRACING_LOOKUP_TABLE: Final[Tuple[BracingScheme, ...]] = (
    # ───── K4-110 — 3 entries (internal partitions only, max 3.6m) ─────
    BracingScheme(
        system="K4-110",
        height_range_min_m=0.0,
        height_range_max_m=2.4,
        bracing_height_class="le_2.4m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=2.4,
        waler_count=0,
        waler_position="N/A",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 1 (K4-110 ≤2.4m)",
    ),
    BracingScheme(
        system="K4-110",
        height_range_min_m=2.4,
        height_range_max_m=3.0,
        bracing_height_class="2.4_to_3.0m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=2.0,
        waler_count=0,
        waler_position="N/A",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 2 (K4-110 2.4-3.0m)",
    ),
    BracingScheme(
        system="K4-110",
        height_range_min_m=3.0,
        height_range_max_m=3.6,
        bracing_height_class="3.0_to_4.5m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=1.8,
        waler_count=1,
        waler_position="H/2",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 3 (K4-110 3.0-3.6m)",
    ),

    # ───── K6-150 — 4 entries ─────
    BracingScheme(
        system="K6-150",
        height_range_min_m=0.0,
        height_range_max_m=2.4,
        bracing_height_class="le_2.4m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=2.4,
        waler_count=0,
        waler_position="N/A",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 4 (K6-150 ≤2.4m)",
    ),
    BracingScheme(
        system="K6-150",
        height_range_min_m=2.4,
        height_range_max_m=3.0,
        bracing_height_class="2.4_to_3.0m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=2.0,
        waler_count=0,
        waler_position="N/A",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 5 (K6-150 2.4-3.0m)",
    ),
    BracingScheme(
        system="K6-150",
        height_range_min_m=3.0,
        height_range_max_m=4.5,
        bracing_height_class="3.0_to_4.5m",
        lifts=1,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=1.8,
        waler_count=1,
        waler_position="H/2",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 6 (K6-150 3.0-4.5m)",
    ),
    BracingScheme(
        system="K6-150",
        height_range_min_m=4.5,
        height_range_max_m=5.0,
        bracing_height_class="4.5_to_6.0m",
        lifts=2,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=1.5,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 7 (K6-150 4.5-5.0m)",
    ),

    # ───── K6-180 — 3 entries ─────
    BracingScheme(
        system="K6-180",
        height_range_min_m=0.0,
        height_range_max_m=2.4,
        bracing_height_class="le_2.4m",
        lifts=1,
        prop_type="L",
        prop_sku="KZ-PROP-L",
        prop_spacing_m=2.4,
        waler_count=0,
        waler_position="N/A",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 8 (K6-180 ≤2.4m)",
    ),
    BracingScheme(
        system="K6-180",
        height_range_min_m=2.4,
        height_range_max_m=3.6,
        bracing_height_class="2.4_to_3.0m",
        lifts=1,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=2.0,
        waler_count=1,
        waler_position="H/2",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 9 (K6-180 2.4-3.6m)",
    ),
    BracingScheme(
        system="K6-180",
        height_range_min_m=3.6,
        height_range_max_m=5.0,
        bracing_height_class="3.0_to_4.5m",
        lifts=2,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=1.5,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=600,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 10 (K6-180 3.6-5.0m)",
    ),

    # ───── K8-200 — 3 entries (no le_2.4m row; K8 starts at 2.4m) ─────
    BracingScheme(
        system="K8-200",
        height_range_min_m=0.0,
        height_range_max_m=3.0,
        bracing_height_class="2.4_to_3.0m",
        lifts=1,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=1.8,
        waler_count=1,
        waler_position="H/2",
        kicker_spacing_mm=400,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 11 (K8-200 ≤3.0m)",
    ),
    BracingScheme(
        system="K8-200",
        height_range_min_m=3.0,
        height_range_max_m=4.5,
        bracing_height_class="3.0_to_4.5m",
        lifts=1,
        prop_type="H",
        prop_sku="KZ-PROP-H",
        prop_spacing_m=1.5,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=400,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 12 (K8-200 3.0-4.5m)",
    ),
    BracingScheme(
        system="K8-200",
        height_range_min_m=4.5,
        height_range_max_m=6.0,
        bracing_height_class="4.5_to_6.0m",
        lifts=2,
        prop_type="H",
        prop_sku="KZ-PROP-H",
        prop_spacing_m=1.2,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=400,
        has_diagonal=True,
        frb_source="FRB Appendix A Card 1 row 13 (K8-200 4.5-6.0m, diagonal mandatory)",
    ),

    # ───── K8-250 — 3 entries ─────
    BracingScheme(
        system="K8-250",
        height_range_min_m=0.0,
        height_range_max_m=3.0,
        bracing_height_class="2.4_to_3.0m",
        lifts=1,
        prop_type="M",
        prop_sku="KZ-PROP-M",
        prop_spacing_m=1.5,
        waler_count=1,
        waler_position="H/2",
        kicker_spacing_mm=400,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 14 (K8-250 ≤3.0m)",
    ),
    BracingScheme(
        system="K8-250",
        height_range_min_m=3.0,
        height_range_max_m=4.5,
        bracing_height_class="3.0_to_4.5m",
        lifts=1,
        prop_type="H",
        prop_sku="KZ-PROP-H",
        prop_spacing_m=1.2,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=400,
        has_diagonal=False,
        frb_source="FRB Appendix A Card 1 row 15 (K8-250 3.0-4.5m)",
    ),
    BracingScheme(
        system="K8-250",
        height_range_min_m=4.5,
        height_range_max_m=6.0,
        bracing_height_class="4.5_to_6.0m",
        lifts=2,
        prop_type="XH",
        prop_sku="KZ-PROP-XH",
        prop_spacing_m=1.2,
        waler_count=2,
        waler_position="mid_and_upper",
        kicker_spacing_mm=400,
        has_diagonal=True,
        frb_source="FRB Appendix A Card 1 row 16 (K8-250 4.5-6.0m, diagonal mandatory)",
    ),
)


# ═════════════════════════════════════════════════════════════════════
# MODULE-LOAD VALIDATION (fail-fast on malformed lookup table)
# ═════════════════════════════════════════════════════════════════════


_EXPECTED_LOOKUP_TABLE_LEN: Final[int] = 16


def _validate_bracing_lookup_table() -> None:
    """Validate BRACING_LOOKUP_TABLE integrity at module-load time.

    Raises:
        RuntimeError: on wrong entry count, missing FRB citation, malformed
                      height range (min > max), or duplicate (system, range) keys.
    """
    if len(BRACING_LOOKUP_TABLE) != _EXPECTED_LOOKUP_TABLE_LEN:
        raise RuntimeError(
            f"BRACING_LOOKUP_TABLE has {len(BRACING_LOOKUP_TABLE)} entries; "
            f"expected exactly {_EXPECTED_LOOKUP_TABLE_LEN} (FRB Appendix A Card 1)."
        )

    seen_keys: set[tuple[str, float, float]] = set()
    for i, scheme in enumerate(BRACING_LOOKUP_TABLE):
        if not isinstance(scheme, BracingScheme):
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE entry {i} is not a BracingScheme: {type(scheme).__name__}"
            )
        if not scheme.frb_source.startswith("FRB"):
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE entry {i} ({scheme.system}) missing FRB citation: "
                f"{scheme.frb_source!r}"
            )
        if scheme.height_range_min_m >= scheme.height_range_max_m:
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE entry {i} ({scheme.system}): "
                f"height_range_min_m ({scheme.height_range_min_m}) >= "
                f"height_range_max_m ({scheme.height_range_max_m})"
            )
        key = (scheme.system, scheme.height_range_min_m, scheme.height_range_max_m)
        if key in seen_keys:
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE duplicate (system, range) key: {key}"
            )
        seen_keys.add(key)
        if scheme.lifts not in (1, 2):
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE entry {i} ({scheme.system}): "
                f"invalid lifts={scheme.lifts} (must be 1 or 2)"
            )
        if scheme.kicker_spacing_mm not in (400, 600):
            raise RuntimeError(
                f"BRACING_LOOKUP_TABLE entry {i} ({scheme.system}): "
                f"invalid kicker_spacing_mm={scheme.kicker_spacing_mm} (must be 400 or 600)"
            )


_validate_bracing_lookup_table()


logger.info(
    "BRACING_LOOKUP_TABLE loaded: %d entries (FRB Appendix A Card 1)",
    len(BRACING_LOOKUP_TABLE),
)
