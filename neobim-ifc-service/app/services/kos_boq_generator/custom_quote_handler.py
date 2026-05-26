"""Custom quote handler — regex classifier + weight estimator + line item builder.

Sources:

* 02_ALGORITHMS.md Problem 7
* ASSUMPTION-BOQ-9: custom-quote reason classification by regex against
  mapper-emitted English string (acceptable for v1; 37/37 90VR-MR cases
  match one of the 6 v1-exercised patterns from CONTEXT_CONFIRMED Q2)
* ASSUMPTION-BOQ-16: weight estimation via ±10% catalog thickness tolerance

10-value ``CustomQuoteReason`` enum (verified by pre-flight A):

  v1-exercised on 90VR-MR (6 of 10):
    - thickness_exceeds_catalog        (6 on 90VR-MR)
    - thickness_below_minimum          (11 on 90VR-MR)
    - thickness_unknown                (11 on 90VR-MR)
    - thickness_between_bands          (4 on 90VR-MR)
    - system_180_not_stocked           (3 on 90VR-MR)
    - system_250_custom_on_request     (2 on 90VR-MR)
  RESERVED (0 on 90VR-MR; future-proofing):
    - curved_wall_custom_panels
    - tight_curve_below_min_radius
    - orphan_opening_reference
    - other_custom                     (fallback)

90VR-MR distribution {11,11,6,4,3,2} = 37 — matches mapper baseline.

Pure function. No I/O. No mutation. Deterministic.
"""

from __future__ import annotations

import re
from typing import Optional

from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

from .constants import (
    CATALOG_THICKNESS_TOLERANCE_PERCENT,
    KG_PER_SFT_BY_THICKNESS,
    MM2_PER_SFT,
)
from .types import CustomQuoteLineItem, CustomQuoteReason


# ──────────────────────────────────────────────────────────────────────────────
# Reason classifier — regex patterns (anti-pattern #40: case-insensitive)
#
# Order matters: first-match-wins. More specific patterns first.
# Pre-flight A confirmed the exact 18 distinct reason strings on 90VR-MR;
# all are covered by these patterns.
# ──────────────────────────────────────────────────────────────────────────────


# Pattern matches a thickness value (with optional decimals) in the reason string.
# Examples matched: "thickness=74.09mm", "thickness 50.81 mm", "thickness=300.57mm"
_THICKNESS_VALUE_RE: re.Pattern[str] = re.compile(
    r"thickness\s*[=]?\s*([\d.]+)\s*mm",
    re.IGNORECASE,
)

# System-specific patterns (highest priority — most specific).
_K6_180_RE: re.Pattern[str] = re.compile(r"K6-180", re.IGNORECASE)
_K8_250_RE: re.Pattern[str] = re.compile(r"K8-250", re.IGNORECASE)

# Curve patterns (RESERVED — v1 mapper doesn't emit these but defensive).
_CURVED_GENERIC_RE: re.Pattern[str] = re.compile(
    r"curv(?:e|ed|ing)", re.IGNORECASE,
)
_TIGHT_CURVE_RE: re.Pattern[str] = re.compile(
    r"tight\s*curve|radius\s*below|min(?:imum)?\s*radius", re.IGNORECASE,
)

# Orphan opening (RESERVED — orphans surface via operator_review_handler;
# this pattern exists only for the rare case mapper might emit them as
# custom_quote_requests in some future flow).
_ORPHAN_REFERENCE_RE: re.Pattern[str] = re.compile(
    r"orphan\s*opening", re.IGNORECASE,
)


def classify_reason(reason_string: str) -> CustomQuoteReason:
    """Classify a mapper-emitted English reason string into a ``CustomQuoteReason``.

    Classification priority (first-match-wins):

    1. K8-250 system → ``system_250_custom_on_request`` (2 of 37 on 90VR-MR)
    2. K6-180 system → ``system_180_not_stocked`` (3 of 37)
    3. Tight curve / min radius → ``tight_curve_below_min_radius`` (RESERVED)
    4. Generic curve → ``curved_wall_custom_panels`` (RESERVED)
    5. Orphan opening → ``orphan_opening_reference`` (RESERVED)
    6. Thickness=0.0 → ``thickness_unknown`` (11 of 37)
    7. Thickness numeric → bucket by value:
       * < 100mm → ``thickness_below_minimum`` (11 of 37)
       * In gap bands (120-144 / 160-169) → ``thickness_between_bands`` (4 of 37)
       * ≥ 220mm → ``thickness_exceeds_catalog`` (6 of 37)
       * Other (105-119, 145-159, 170-184, 195-209, 245-274 — within
         catalog ±tolerance) → fallback ``other_custom``
    8. No match → ``other_custom`` (fallback)

    Pure function. Anti-pattern #40: case-insensitive + whitespace tolerant
    (regex flags + ``\\s*``). Empty/None input → ``other_custom``.

    Pre-flight A verified all 18 distinct 90VR-MR reason strings map to one
    of the 6 v1-exercised enum values (no ``other_custom`` fallthroughs).
    """
    if not reason_string:
        return "other_custom"

    text = reason_string.strip()

    # Layer 1: system-specific (most specific first)
    if _K8_250_RE.search(text):
        return "system_250_custom_on_request"
    if _K6_180_RE.search(text):
        return "system_180_not_stocked"

    # Layer 2: curve / orphan (reserved; specific keyword detection)
    if _TIGHT_CURVE_RE.search(text):
        return "tight_curve_below_min_radius"
    if _CURVED_GENERIC_RE.search(text):
        return "curved_wall_custom_panels"
    if _ORPHAN_REFERENCE_RE.search(text):
        return "orphan_opening_reference"

    # Layer 3: thickness numeric (bucket by value)
    match = _THICKNESS_VALUE_RE.search(text)
    if match:
        try:
            value = float(match.group(1))
        except ValueError:
            return "other_custom"

        if value == 0.0:
            return "thickness_unknown"
        if value < 100.0:
            return "thickness_below_minimum"
        # Band-gap buckets: 120-144 and 160-169mm (gaps in K4/K6/K8 catalog).
        if 120.0 <= value < 145.0:
            return "thickness_between_bands"
        if 160.0 <= value < 170.0:
            return "thickness_between_bands"
        if value >= 220.0:
            return "thickness_exceeds_catalog"
        # Else: thickness fell within catalog bands (110±, 155±, 200±) but
        # mapper still flagged custom for some reason. Treat as other_custom.
        return "other_custom"

    # Layer 4: no recognizable signal — fallback
    return "other_custom"


# ──────────────────────────────────────────────────────────────────────────────
# Weight estimator (ASSUMPTION-BOQ-16 — ±10% catalog tolerance)
# ──────────────────────────────────────────────────────────────────────────────


def _nearest_catalog_kg_per_sft(thickness_mm: Optional[float]) -> Optional[float]:
    """Pick KG_PER_SFT for nearest catalog thickness within ±10% relative tolerance.

    Catalog thicknesses: 110, 155, 200 mm.
    Tolerance: ``CATALOG_THICKNESS_TOLERANCE_PERCENT`` (10%) per ASSUMPTION-BOQ-16.

    Anti-pattern #41: returns None when no catalog within tolerance (not 0.0).
    Anti-pattern #42: when multiple matches, pick closest by absolute distance.

    Examples:
        105 → 1.29 (within 5% of 110)
        149 → 1.46 (within 4% of 155)
        225 → None (outside ±10% of all catalogs)
        0 / None → None
    """
    if thickness_mm is None or thickness_mm <= 0:
        return None

    rel_tol = CATALOG_THICKNESS_TOLERANCE_PERCENT / 100.0
    candidates: list[tuple[int, float]] = []
    for catalog_t in KG_PER_SFT_BY_THICKNESS:
        relative_dev = abs(thickness_mm - catalog_t) / catalog_t
        if relative_dev <= rel_tol:
            candidates.append((catalog_t, abs(thickness_mm - catalog_t)))

    if not candidates:
        return None

    # Anti-pattern #42: closest by absolute distance.
    closest_catalog = min(candidates, key=lambda c: c[1])[0]
    return KG_PER_SFT_BY_THICKNESS[closest_catalog]


def _estimate_weight_kg(
    thickness_mm: Optional[float],
    area_sqft: Optional[float],
) -> Optional[float]:
    """Estimate weight (kg) from thickness + area.

    Returns None when:
    - thickness is None or out of catalog tolerance (per ASSUMPTION-BOQ-16)
    - area is None (can't compute weight without area)

    Otherwise: area * kg_per_sft (for nearest catalog thickness).
    """
    if area_sqft is None:
        return None
    kg_per_sft = _nearest_catalog_kg_per_sft(thickness_mm)
    if kg_per_sft is None:
        return None
    return area_sqft * kg_per_sft


def _compute_area_or_none(
    length_mm: Optional[float],
    height_mm: Optional[int],
) -> Optional[float]:
    """Compute area in sqft from length × height (mm)."""
    if length_mm is None or height_mm is None or length_mm <= 0 or height_mm <= 0:
        return None
    return length_mm * height_mm / MM2_PER_SFT


# ──────────────────────────────────────────────────────────────────────────────
# Public API: build_custom_quote_items
# ──────────────────────────────────────────────────────────────────────────────


def build_custom_quote_items(
    mapper_output: PanelGridMapperOutput,
) -> tuple[CustomQuoteLineItem, ...]:
    """Build CustomQuoteLineItem tuple from mapper.custom_quote_requests.

    For each ``CustomQuoteRequest``:

    1. Classify ``req.reason`` (English) → ``CustomQuoteReason`` enum
    2. Compute area_sqft from length × height
    3. Estimate weight via ±10% catalog tolerance
    4. Preserve original reason string as ``reason_detail`` (anti-pattern #43)

    Field mapping from mapper.CustomQuoteRequest → BOQ.CustomQuoteLineItem:
      ``req.wall_segment_id`` → ``item.wall_id`` (renamed)
      ``req.thickness_mm``    → ``item.thickness_mm`` (preserved as float)
      ``req.length_mm``       → ``item.length_mm``
      ``req.height_mm``       → ``item.height_mm``
      ``req.reason``          → ``item.reason_detail`` (verbatim)

    The output is sorted by ``wall_id`` for deterministic ordering across
    runs (mapper insertion order is also deterministic, but explicit sort
    is defensive against future mapper changes).

    Pure function. Deterministic.

    Edge case (anti-pattern #20 carry): empty input → ``()``.
    """
    items: list[CustomQuoteLineItem] = []

    for req in mapper_output.custom_quote_requests:
        # Thickness: mapper sometimes emits 0.0 for unknown — preserve as None
        # at the BOQ layer when classified as thickness_unknown.
        # NOTE: we preserve the raw thickness in the dataclass regardless;
        # the consumer (Tier 3 CUSTOM row + Tier 2 custom bucket) uses
        # estimated_weight_kg + area_sqft which are None-aware.
        raw_thickness: Optional[float] = (
            float(req.thickness_mm) if req.thickness_mm and req.thickness_mm > 0
            else None
        )

        area_sqft = _compute_area_or_none(req.length_mm, req.height_mm)
        estimated_weight = _estimate_weight_kg(raw_thickness, area_sqft)
        reason_enum = classify_reason(req.reason)

        items.append(CustomQuoteLineItem(
            wall_id=req.wall_segment_id,                               # rename
            reason=reason_enum,
            reason_detail=req.reason,                                  # verbatim
            thickness_mm=raw_thickness,
            length_mm=float(req.length_mm),
            height_mm=int(req.height_mm),
            area_sqft=area_sqft,
            estimated_weight_kg=estimated_weight,
            curve_radius_mm=None,                                      # RESERVED
            arc_length_mm=None,                                        # RESERVED
            subtotal_inr="TBD",                                        # always TBD
            quote_status="pending_sales_review",
        ))

    # Sort by wall_id for deterministic ordering (defensive — mapper is also
    # deterministic but explicit sort future-proofs against re-ordering).
    return tuple(sorted(items, key=lambda c: c.wall_id))
