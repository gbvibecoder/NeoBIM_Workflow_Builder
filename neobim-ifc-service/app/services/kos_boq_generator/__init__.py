"""KOS BOQ Generator — generates 6-tier BOQ from PanelGridMapperOutput.

This package transforms mapper output into customer-facing commercial
deliverables with full audit trail, custom-quote separation, and operator
review surfacing.

Phase 5E-1 IMPLEMENT slice. **PR 1 = Foundation** (constants + types +
exceptions + package init). Algorithm implementations land in PRs 2-6:

* PR 2 — Tier 6 + Tier 5 + Tier 4 algorithms (with openings + custom flags)
* PR 3 — Tier 3 + Tier 2 + Tier 1 + formatters
* PR 4 — Custom quote handler + operator review + id_generator + validator
* PR 5 — Orchestrator (``generator.py`` — the public ``generate_boq()`` entry)
* PR 6 — Router + main.py wiring + 90VR HTTP integration test

Public API surface (this package's ``__all__``):

* ``BOQInput`` / ``BOQContext``: input contract
* ``BOQGeneratorOutput``: root output type (6-tier hierarchical structure)
* 14 tier / category / audit dataclasses
* 4 exception classes
* 4 enum ``Literal`` aliases
* 23 constants (Karthik defaults, mapper re-exports, tolerances, prefix groups,
  semver, quote-number template)

Usage (when PR 5 ships the orchestrator)::

    from app.services.kos_boq_generator import generate_boq, BOQInput, BOQContext
    boq = generate_boq(BOQInput(mapper_output=..., context=...))
"""

from __future__ import annotations

# Constants (Karthik defaults + mapper re-exports + tolerances + groupings)
from .constants import (
    AREA_TOLERANCE_SQFT,
    BOQ_CALCULATION_VERSION,
    BOQ_SCHEMA_VERSION,
    CATALOG_THICKNESS_TOLERANCE_PERCENT,
    DEFAULT_CURRENCY,
    DEFAULT_DELIVERY_TERMS,
    DEFAULT_DISCOUNT_PERCENT,
    DEFAULT_PAYMENT_TERMS,
    DEFAULT_QUOTE_VALIDITY_DAYS,
    DEFAULT_TAX_RATE_PERCENT,
    INR_DISPLAY_DECIMALS,
    INR_TOLERANCE_RUPEES,
    KARTHIK_PRICING_VERSION,
    KG_PER_SFT_BY_THICKNESS,
    KG_TOLERANCE,
    MAX_DISCOUNT_PERCENT,
    MAX_QUOTE_VALIDITY_DAYS,
    MAX_TAX_PERCENT,
    MIN_DISCOUNT_PERCENT,
    MIN_QUOTE_VALIDITY_DAYS,
    MIN_TAX_PERCENT,
    MM2_PER_SFT,
    PANEL_PRICE_INR_PER_SFT,
    QUOTE_NUMBER_TEMPLATE,
    RELATIVE_TOLERANCE,
    SKU_PREFIX_DESCRIPTIONS,
    SUPPORTED_CURRENCIES,
    TIER2_ACCESSORY_PREFIXES,
    TIER2_STANDARD_PANEL_PREFIXES,
    TIER3_CANONICAL_PREFIX_ORDER,
)

# Exceptions
from .exceptions import (
    BOQConfigError,
    BOQError,
    BOQInputError,
    BOQInvariantError,
)

# Types
from .types import (
    # Enum aliases (4)
    BOQOpeningType,
    CustomQuoteReason,
    OperatorReviewType,
    QuoteStatus,
    # Input (2)
    BOQContext,
    BOQInput,
    # Output root (1)
    BOQGeneratorOutput,
    # Tier types (9)
    Tier1ProjectSummary,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier2Category,
    Tier3SKUType,
    Tier4SKUDetail,
    Tier5SegmentOpening,
    Tier5WallSegment,
    Tier6PanelPiece,
    # Custom-quote + operator-review (2)
    CustomQuoteLineItem,
    OperatorReviewItem,
    # Commercial + audit (2)
    BOQAuditTrail,
    BOQCommercialTerms,
)

# PR 2 — Tier 6 / Tier 5 / Tier 4 algorithm builders
from .tier4_sku_details import build_tier4_sku_details
from .tier5_segments import build_tier5_segments
from .tier6_panel_pieces import build_tier6_panel_pieces

# PR 3 — Tier 3 / Tier 2 / Tier 1 algorithm builders + formatters
from .formatters import (
    compute_quote_validity_until,
    format_indian_comma,
    synth_quote_number,
)
from .tier1_summary import build_tier1_project_summary
from .tier2_categories import build_tier2_categories
from .tier3_sku_types import build_tier3_sku_types

# PR 3 (Scenario B per §3.9) — SKIN/RIB weight fractions re-exported from mapper
from .constants import (
    RIB_WEIGHT_FRACTION,
    SKIN_WEIGHT_FRACTION,
)

# PR 4 — custom quote handler + operator review handler + ID generator + validator
from .custom_quote_handler import build_custom_quote_items
from .id_generator import (
    build_audit_trail,
    compute_generated_at,
    compute_mapper_output_hash,
    mint_boq_id,
)
from .operator_review_handler import build_operator_review_items
from .output_validator import validate_boq_output

# PR 5 — orchestrator (public entry point)
from .orchestrator import generate_boq

__all__ = [
    # Constants — Karthik defaults
    "DEFAULT_TAX_RATE_PERCENT",
    "DEFAULT_DISCOUNT_PERCENT",
    "DEFAULT_QUOTE_VALIDITY_DAYS",
    "DEFAULT_PAYMENT_TERMS",
    "DEFAULT_DELIVERY_TERMS",
    "DEFAULT_CURRENCY",
    "SUPPORTED_CURRENCIES",
    "KARTHIK_PRICING_VERSION",
    # Constants — mapper re-exports (aliased)
    "KG_PER_SFT_BY_THICKNESS",
    "PANEL_PRICE_INR_PER_SFT",
    "MM2_PER_SFT",
    # Constants — tolerances + formatting
    "INR_TOLERANCE_RUPEES",
    "KG_TOLERANCE",
    "AREA_TOLERANCE_SQFT",
    "RELATIVE_TOLERANCE",
    "INR_DISPLAY_DECIMALS",
    "BOQ_SCHEMA_VERSION",
    "BOQ_CALCULATION_VERSION",
    "QUOTE_NUMBER_TEMPLATE",
    # Constants — limits + prefix groups
    "MIN_DISCOUNT_PERCENT",
    "MAX_DISCOUNT_PERCENT",
    "MIN_TAX_PERCENT",
    "MAX_TAX_PERCENT",
    "MIN_QUOTE_VALIDITY_DAYS",
    "MAX_QUOTE_VALIDITY_DAYS",
    "CATALOG_THICKNESS_TOLERANCE_PERCENT",
    "TIER2_STANDARD_PANEL_PREFIXES",
    "TIER2_ACCESSORY_PREFIXES",
    "TIER3_CANONICAL_PREFIX_ORDER",
    "SKU_PREFIX_DESCRIPTIONS",
    # Exceptions
    "BOQError",
    "BOQInputError",
    "BOQInvariantError",
    "BOQConfigError",
    # Input types
    "BOQInput",
    "BOQContext",
    # Output root
    "BOQGeneratorOutput",
    # Tier types
    "Tier1ProjectSummary",
    "Tier2Category",
    "Tier2Bucket",
    "Tier2BucketCustom",
    "Tier3SKUType",
    "Tier4SKUDetail",
    "Tier5SegmentOpening",
    "Tier5WallSegment",
    "Tier6PanelPiece",
    # Custom + operator
    "CustomQuoteLineItem",
    "OperatorReviewItem",
    # Commercial + audit
    "BOQCommercialTerms",
    "BOQAuditTrail",
    # Enum aliases
    "CustomQuoteReason",
    "OperatorReviewType",
    "BOQOpeningType",
    "QuoteStatus",
    # PR 2 — algorithm builders
    "build_tier6_panel_pieces",
    "build_tier5_segments",
    "build_tier4_sku_details",
    # PR 3 — algorithm builders + formatters + weight fractions
    "build_tier3_sku_types",
    "build_tier2_categories",
    "build_tier1_project_summary",
    "format_indian_comma",
    "synth_quote_number",
    "compute_quote_validity_until",
    "SKIN_WEIGHT_FRACTION",
    "RIB_WEIGHT_FRACTION",
    # PR 4 — custom quote + operator review + ID generator + validator
    "build_custom_quote_items",
    "build_operator_review_items",
    "mint_boq_id",
    "compute_mapper_output_hash",
    "compute_generated_at",
    "build_audit_trail",
    "validate_boq_output",
    # PR 5 — orchestrator
    "generate_boq",
]
