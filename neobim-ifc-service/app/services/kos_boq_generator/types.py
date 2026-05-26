"""BOQ Generator type definitions.

15 frozen dataclasses + 4 string Literal enum aliases.

All types are immutable. Collections use ``tuple[...]`` not ``list[...]``.
String enums use ``Literal[...]``. Optional fields are explicitly ``Optional[T]``.

Mirrors 01_SCHEMA.md Section B exactly. If types here drift from the schema
doc, the schema doc is canonical — update types to match (do not modify the
doc to fit code).

KEY DESIGN DECISIONS (from 15-anti-pattern audit):

1. ``BOQInput.mapper_output`` uses concrete type ``PanelGridMapperOutput``
   (no circular import risk — BOQ depends on mapper, never reverse).
   Anti-pattern #1.
2. ``Tier2BucketCustom.by_reason`` and ``BOQAuditTrail.pipeline_versions`` use
   tuple-of-pairs for true immutability. ``@dataclass(frozen=True)`` prevents
   field re-assignment but NOT mutation of internal dicts. Tuples close this
   gap. Anti-patterns #2 and #9.
3. ``Tier4SKUDetail`` stores BOTH ``unit_*`` and ``line_total_*`` fields. PR 1
   defines the schema; PR 2 ensures ``line_total_X == quantity * unit_X``; PR 4
   invariant validates. No ``@property`` accessors — fields must be settable
   for the algorithm to populate. Anti-pattern #5.
4. ``CustomQuoteLineItem.subtotal_inr`` is ``Literal["TBD"]`` — a JSON-friendly
   sentinel that round-trips through JSON cleanly. Anti-pattern #10.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

# Import the mapper output type — no circular import (BOQ imports mapper, not
# reverse). The concrete type satisfies anti-pattern #1.
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

# ──────────────────────────────────────────────────────────────────────────────
# String enum aliases (4) — Literal types are runtime-erased; treat as docs.
# ──────────────────────────────────────────────────────────────────────────────

# 10-value enum for custom-quote reason classification.
# v1 emits values #1-#6 from mapper output via regex classifier (PR 4).
# Values #7-#10 are RESERVED for future when curve_handler routes via dedicated
# reasons. Schema-stable.
# Source: 01_SCHEMA.md §B + 02_ALGORITHMS.md Problem 7 regex classifier.
CustomQuoteReason = Literal[
    "thickness_exceeds_catalog",        # 1. > 220mm but not 250
    "thickness_below_minimum",          # 2. < 100mm
    "thickness_unknown",                # 3. parser couldn't detect (thickness=0)
    "thickness_between_bands",          # 4. falls in gap (120-144 or 160-169mm)
    "system_180_not_stocked",           # 5. K6-180 in rulebook but not stocked
    "system_250_custom_on_request",     # 6. K8-250 custom on request
    "curved_wall_custom_panels",        # 7. RESERVED — curve_handler approximate
    "tight_curve_below_min_radius",     # 8. RESERVED — radius < 600mm
    "orphan_opening_reference",         # 9. RESERVED — orphan with no recovery
    "other_custom",                     # 10. safety catch-all
]

# 4-value enum for operator-review item type.
# v1 emits only ``"orphan_opening"``. Other 3 are RESERVED for future detectors.
# Source: 01_SCHEMA.md §B + PR-HOTFIX-2 orphan handling.
OperatorReviewType = Literal[
    "orphan_opening",
    "low_confidence_opening",
    "ambiguous_thickness",
    "curve_radius_uncertain",
]

# 3-value enum for opening type, derived from sill_height + width.
# Heuristic: sill>0 → window; sill==0 AND width>=1800 → sliding_door; else door.
# Source: ASSUMPTION-BOQ-9 in 01_SCHEMA.md.
BOQOpeningType = Literal["door", "window", "sliding_door"]

# Quote status for custom-quote line items.
# v1 always emits ``"pending_sales_review"`` for new items.
# ``"priced"`` and ``"voided"`` are RESERVED for future quote-version tracking.
QuoteStatus = Literal["pending_sales_review", "priced", "voided"]


# ──────────────────────────────────────────────────────────────────────────────
# Input dataclasses (2)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BOQContext:
    """Caller-supplied commercial parameters.

    Source: 01_SCHEMA.md Section A.

    Validation rules IV-1 through IV-8 enforced by PR 5 orchestrator:

    * IV-1: project_id non-empty, non-whitespace
    * IV-2: quote_date valid ISO-8601 date
    * IV-3: quote_validity_days in [1, 365]
    * IV-4: tax_rate_percent in [0, 100]
    * IV-5: discount_percent in [0, 100]
    * IV-6: currency in SUPPORTED_CURRENCIES
    * IV-7: mapper_output is a PanelGridMapperOutput dataclass (handled in BOQInput)
    * IV-8: deterministic_id_seed is None or non-empty str
    """

    project_id: str
    quote_date: str
    quote_number: Optional[str] = None              # auto-generated if None
    quote_validity_days: int = 30
    customer_name: Optional[str] = None
    customer_address: Optional[str] = None
    delivery_address: Optional[str] = None
    tax_rate_percent: float = 18.0
    discount_percent: float = 0.0
    currency: Literal["INR"] = "INR"
    include_bracing_placeholder: bool = False
    notes: Optional[str] = None
    # Determinism hooks for golden tests + reproducibility.
    # When ``deterministic_id_seed`` is set, PR 4's id_generator emits a stable
    # UUID5; when ``generated_at_override`` is set, it's used verbatim.
    # Source: 01_SCHEMA.md §A.
    deterministic_id_seed: Optional[str] = None
    generated_at_override: Optional[str] = None


@dataclass(frozen=True)
class BOQInput:
    """Root input contract for BOQ Generator.

    Combines mapper output with caller-supplied commercial context.
    """

    mapper_output: PanelGridMapperOutput
    context: BOQContext


# ──────────────────────────────────────────────────────────────────────────────
# Tier 1: Project Summary (1 dataclass)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier1ProjectSummary:
    """Customer-facing project summary — first view in the BOQ.

    Source: 01_SCHEMA.md Section B.

    Note: ``grand_total_inr`` covers STANDARD + ACCESSORIES only. Custom items
    are explicitly excluded (their ``subtotal_inr="TBD"``). The
    ``has_unpriced_items`` flag + ``total_custom_quote_items`` count make this
    impossible to miss. POLICY-CUSTOM-QUOTE-SEPARATE.
    """

    # Identity
    project_name: str
    quote_number: str
    quote_date: str
    quote_validity_until: str

    # Quantity rollups
    total_standard_panels: int                      # AP only (ASSUMPTION-BOQ-14)
    total_accessory_pieces: int                     # BT+TC+CP+CTC+ECF+ECM+JTF+JTM+PC
    total_custom_quote_items: int
    total_curve_segments: int
    total_openings_in_walls: int                    # from PR-HOTFIX-2 wiring
    total_orphan_openings: int                      # OperatorReviewItem count

    # Weight rollups (kg)
    total_weight_kg: float
    total_weight_kg_skin: float                     # 60% (Karthik split)
    total_weight_kg_rib: float                      # 40% (Karthik split)

    # Money (₹) — unrounded floats; display via grand_total_inr_formatted
    standard_panels_subtotal_inr: float             # AP only
    accessories_subtotal_inr: float                 # everything except AP and CUSTOM
    custom_quotes_pending_count: int
    custom_quotes_estimated_weight_kg: float
    discount_inr: float
    subtotal_after_discount_inr: float
    tax_inr: float
    grand_total_inr: float                          # std + acc only — custom excluded
    grand_total_inr_formatted: str                  # Indian-comma "₹X,XX,XXX.XX"

    # Flags
    has_unpriced_items: bool                        # True when custom_quote_items non-empty


# ──────────────────────────────────────────────────────────────────────────────
# Tier 2: Category buckets (3 dataclasses)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier2Bucket:
    """A priced category bucket (standard panels OR accessories)."""

    count: int
    weight_kg: float
    subtotal_inr: float


@dataclass(frozen=True)
class Tier2BucketCustom:
    """The custom-quote category bucket — pricing is always "TBD".

    CRITICAL — anti-pattern #2: ``by_reason`` is a tuple of ``(reason_key, count)``
    pairs (NOT a dict). Dicts in frozen dataclasses are still mutable internally;
    a caller can do ``obj.by_reason["x"] = 5`` even on a frozen dataclass. Tuples
    close this gap.

    Pairs MUST be sorted alphabetically by key for determinism (anti-pattern #15).
    Lookup helper: ``dict(self.by_reason).get(reason_key, 0)``.
    """

    count: int
    weight_kg_estimated: float                       # sum where computable
    subtotal_inr: Literal["TBD"]                     # always TBD — no auto-pricing
    by_reason: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True)
class Tier2Category:
    """Tier 2 = 3 buckets: Standard / Accessories / Custom."""

    standard_panels: Tier2Bucket
    accessories: Tier2Bucket
    custom_quotes: Tier2BucketCustom


# ──────────────────────────────────────────────────────────────────────────────
# Tier 3: SKU type rollup (1 dataclass)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier3SKUType:
    """One row per SKU prefix.

    Order in ``tuple[Tier3SKUType, ...]`` follows ``TIER3_CANONICAL_PREFIX_ORDER``.
    The synthetic ``"CUSTOM"`` row appears LAST when ``custom_quote_items`` is
    non-empty.

    For the CUSTOM row, ``total_price_inr`` is ``0.0`` (custom items priced
    via ``custom_quote_items`` only — POLICY-CUSTOM-QUOTE-SEPARATE).
    """

    sku_prefix: str
    total_count: int
    total_area_sqft: float
    total_weight_kg: float
    total_price_inr: float                           # 0.0 for CUSTOM row
    notes: str


# ──────────────────────────────────────────────────────────────────────────────
# Tier 4: Per-SKU detail (1 dataclass)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier4SKUDetail:
    """One row per unique SKU code.

    AP155-2998 and AP200-2998 are separate rows.
    AP155-2998 and AP155-2998-CUT (cut member variant) are also separate rows.

    CONSTRUCTION CONTRACT (enforced by PR 4 invariant B-7):

    * ``line_total_area_sqft == quantity * unit_area_sqft`` (±AREA_TOLERANCE_SQFT)
    * ``line_total_weight_kg == quantity * unit_weight_kg`` (±KG_TOLERANCE)
    * ``line_total_price_inr == quantity * unit_price_inr`` (±INR_TOLERANCE_RUPEES)

    PR 1 schema ALLOWS divergence (both unit_* and line_total_* are settable
    fields). PR 2 algorithm ENSURES consistency. PR 4 validator CHECKS.
    Do NOT add ``@property`` accessors here — fields must be settable for the
    algorithm to populate. Anti-pattern #5.
    """

    sku_code: str                                    # e.g. "AP155-2998"
    sku_prefix: str                                  # e.g. "AP"
    thickness_mm: int
    description: str
    quantity: int
    unit_area_sqft: float
    unit_weight_kg: float
    unit_price_inr: float
    # Invariant B-7 reconciliation targets (algorithm-populated):
    line_total_area_sqft: float
    line_total_weight_kg: float
    line_total_price_inr: float


# ──────────────────────────────────────────────────────────────────────────────
# Tier 5: Per-wall-segment (2 dataclasses)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier5SegmentOpening:
    """An opening within a Tier 5 wall segment.

    Populated from ``WallSegment.openings`` (post-HOTFIX-2 wiring).

    ``opening_type`` is derived from ``sill_height_mm + width_mm`` via the
    ASSUMPTION-BOQ-9 heuristic — mapper's ``Opening`` dataclass doesn't carry
    type today.
    """

    position_mm: float
    width_mm: float
    height_mm: float
    sill_height_mm: float
    opening_type: BOQOpeningType                     # derived; not from mapper


@dataclass(frozen=True)
class Tier5WallSegment:
    """One row per wall segment (matches mapper segments 1:1).

    For non-custom segments (``is_custom_order=False``): ``panel_count`` > 0,
    ``sku_breakdown`` populated, ``segment_price_inr`` > 0.

    For custom segments (``is_custom_order=True``): ``panel_count == 0``,
    ``sku_breakdown == ()``, ``segment_weight_kg == 0.0``,
    ``segment_price_inr == 0.0``. The pricing for custom segments lives in
    ``BOQGeneratorOutput.custom_quote_items`` with ``subtotal_inr="TBD"``.
    POLICY-CUSTOM-QUOTE-SEPARATE + ASSUMPTION-BOQ-12.
    """

    wall_id: str                                     # e.g. "P_EXT_3"
    system: str                                      # e.g. "K6-150" or "CUSTOM"
    application: str                                 # e.g. "internal" / "external"
    length_mm: float
    height_mm: int
    is_custom_order: bool                            # True ⇒ panel_count==0
    is_curved: bool
    curve_radius_mm: Optional[float]                 # populated when is_curved
    area_sqft: float
    panel_count: int                                 # 0 if is_custom_order
    openings: tuple[Tier5SegmentOpening, ...]        # from PR-HOTFIX-2 wiring
    sku_breakdown: tuple[Tier4SKUDetail, ...]        # SKUs in THIS segment only
    segment_weight_kg: float                         # 0.0 if is_custom_order
    segment_price_inr: float                         # 0.0 if is_custom_order
    notes: str                                       # mapper warnings + info_notes


# ──────────────────────────────────────────────────────────────────────────────
# Tier 6: Per-panel-piece (1 dataclass) — finest granularity
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tier6PanelPiece:
    """One row per individual panel — finest granularity, used by shop drawings.

    1:1 mapping from mapper's ``Panel``. Custom segments contribute zero pieces
    (POLICY-CUSTOM-QUOTE-SEPARATE).
    """

    wall_id: str
    panel_label: str                                 # e.g. "S1", "V3", "HB2"
    sku_code: str
    position_mm: float
    cut_length_mm: int
    width_mm: int
    is_cut_member: bool
    area_sqft: float
    weight_kg: float
    price_inr: float


# ──────────────────────────────────────────────────────────────────────────────
# Custom-quote + operator-review (2 dataclasses)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CustomQuoteLineItem:
    """A wall segment requiring custom Kalzen quote — pricing TBD.

    ``subtotal_inr`` is the literal string ``"TBD"`` (sentinel for "needs sales
    handoff"). This round-trips through JSON cleanly as a string. Anti-pattern #10.

    ``curve_radius_mm`` and ``arc_length_mm`` are populated when ``reason ∈
    {"curved_wall_custom_panels", "tight_curve_below_min_radius"}`` — RESERVED
    for future curve_handler routing (v1: always None).

    Source: 01_SCHEMA.md §B + 02_ALGORITHMS.md Problem 7.
    """

    wall_id: str
    reason: CustomQuoteReason
    reason_detail: str                               # verbatim mapper reason string
    thickness_mm: Optional[float]
    length_mm: float
    height_mm: int
    area_sqft: Optional[float]
    estimated_weight_kg: Optional[float]
    curve_radius_mm: Optional[float]                 # RESERVED for future
    arc_length_mm: Optional[float]                   # RESERVED for future
    subtotal_inr: Literal["TBD"]                     # sentinel
    quote_status: QuoteStatus                        # v1 always "pending_sales_review"


@dataclass(frozen=True)
class OperatorReviewItem:
    """An item the operator must manually verify before customer delivery.

    Generated from mapper warnings (orphan openings, low-confidence detections).
    v1 emits only ``review_type="orphan_opening"`` items via regex parsing of
    mapper warnings (POLICY-ORPHAN-OPENING-WARNING). The other 3 review_types
    are RESERVED for future detectors.
    """

    review_type: OperatorReviewType
    description: str                                 # human-readable problem
    source_warning: str                              # verbatim mapper warning text
    suggested_action: str                            # operator next step


# ──────────────────────────────────────────────────────────────────────────────
# Commercial terms + audit trail (2 dataclasses)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BOQCommercialTerms:
    """Customer-visible commercial conditions."""

    delivery_terms: str
    payment_terms: str
    quote_validity_until: str
    notes: str


@dataclass(frozen=True)
class BOQAuditTrail:
    """Full reproducibility metadata.

    CRITICAL — anti-patterns #2 + #9: ``pipeline_versions`` is a tuple of
    ``(component_name, version_string)`` pairs (NOT a dict). Pairs MUST be
    sorted alphabetically by component name for determinism.

    Example::

        pipeline_versions=(
            ("boq",              "v1.0"),
            ("mapper",           "v1.0"),
            ("mapper_hotfix_1",  "splitter-short-segment-hardening"),
            ("mapper_hotfix_2",  "opening-consumer-wiring"),
            ("parser",           "v1.0"),
        )
    """

    mapper_output_hash: str                          # SHA-256 of canonical mapper JSON
    boq_calculation_version: str
    karthik_pricing_version: str
    custom_quote_review_required: bool
    operator_review_required: bool
    pipeline_versions: tuple[tuple[str, str], ...]


# ──────────────────────────────────────────────────────────────────────────────
# Output root (1 dataclass)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BOQGeneratorOutput:
    """The complete BOQ output document.

    Customer receives this as JSON (PDF rendering deferred to later phase).
    Byte-stable when ``BOQContext.deterministic_id_seed`` and
    ``BOQContext.generated_at_override`` are both pinned.

    Source: 01_SCHEMA.md Section B root.
    """

    # Identity
    boq_id: str                                      # UUID5 if seed else UUID4
    generated_at: str                                # ISO-8601 UTC
    schema_version: str                              # = BOQ_SCHEMA_VERSION

    # 6 tiers (drill-down hierarchy)
    tier_1_summary: Tier1ProjectSummary
    tier_2_categories: Tier2Category
    tier_3_sku_types: tuple[Tier3SKUType, ...]
    tier_4_sku_details: tuple[Tier4SKUDetail, ...]
    tier_5_wall_segments: tuple[Tier5WallSegment, ...]
    tier_6_panel_pieces: tuple[Tier6PanelPiece, ...]

    # Non-tier sections
    custom_quote_items: tuple[CustomQuoteLineItem, ...]
    operator_review_items: tuple[OperatorReviewItem, ...]
    commercial_terms: BOQCommercialTerms
    audit_trail: BOQAuditTrail

    # Transparency surface
    warnings: tuple[str, ...]                        # inherited mapper + BOQ's own
    assumptions_made: tuple[str, ...]
    pending_karthik: tuple[str, ...]
