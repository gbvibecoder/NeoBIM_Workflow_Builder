"""KOS Formwork Quantities Generator — public API.

5F-IMPLEMENT PR 1 (Foundation + Golden) — ONLY types, constants, exceptions,
lookup tables, golden fixture. Algorithm modules (corner_counter,
component_counter, tier*, custom_quote_handler, operator_review_handler,
id_generator, output_validator, orchestrator, http_serializers, router)
ship in PR 2-6.

🚨 Naming convention (per DESIGN v2 doc 03 §4):
  - Tier types prefixed ``Tier{N}Formwork*`` (e.g., ``Tier1FormworkSummary``).
  - Type aliases for category/reason/review-type are ``typing.Literal`` —
    NOT ``enum.Enum``. Use ``typing.get_args()`` to introspect at runtime.

Reference: 5F-DESIGN v2 docs at temp_folder/phase-5f-design/.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ─── Types (16 dataclasses + 8 Literal aliases) ────────────────────────

from app.services.kos_formwork_generator.types import (
    # Input + output envelopes
    FormworkInput,
    FormworkContext,
    FormworkGeneratorOutput,
    # Tier types (DESIGN v2 authoritative names)
    Tier1FormworkSummary,
    Tier2FormworkCategories,
    Tier2Bucket,
    Tier2BucketCustom,
    Tier3SKUType,
    Tier4SKUDetail,
    Tier5FormworkWallSegment,
    Tier6FormworkComponent,
    # Auxiliary
    FormworkCustomQuoteRequest,
    FormworkOperatorReviewItem,
    FormworkAuditTrail,
    BracingScheme,
    # Literal aliases
    FormworkCategory,
    FormworkCustomQuoteReason,
    FormworkOperatorReviewType,
    WallTypeOverride,
    Unit,
    SeismicZone,
    SystemCode,
    BracingHeightClass,
    PropType,
)

# ─── Exceptions (4 classes) ────────────────────────────────────────────

from app.services.kos_formwork_generator.exceptions import (
    FormworkError,
    FormworkConfigError,
    FormworkInputError,
    FormworkInvariantError,
)

# ─── Constants ─────────────────────────────────────────────────────────

from app.services.kos_formwork_generator.constants import (
    # Versions
    FORMWORK_SCHEMA_VERSION,
    FORMWORK_CALCULATION_VERSION,
    FIELD_RULE_BOOK_VERSION,
    # Defaults
    WASTAGE_PERCENT_DEFAULT,
    SEISMIC_ZONE_DEFAULT,
    # SKU catalog
    FORMWORK_SKU_CATALOG,
    FORMWORK_SKU_CODES,
    SKU_DESCRIPTION,
    SKU_UNIT,
    SKU_CATEGORY,
    SKU_FRB_SOURCE,
    # Lookup-style defaults (for PR 2+ algorithms)
    POUR_RATE_DEFAULTS_M_PER_HR,
    POUR_RATE_MAX_M_PER_HR,
    # Output baselines
    PENDING_KARTHIK_DEFAULT,
    ASSUMPTIONS_MADE_DEFAULT,
    PIPELINE_VERSIONS_DEFAULT,
)

# ─── Lookup tables ─────────────────────────────────────────────────────

from app.services.kos_formwork_generator.lookup_tables import (
    BRACING_LOOKUP_TABLE,
)

# ─── PR 2 algorithm modules (appended; PR 1 imports above unchanged) ───────

from app.services.kos_formwork_generator.corner_counter import (
    count_corners,
    CornerDetection,
)
from app.services.kos_formwork_generator.component_counter import (
    count_components,
    find_bracing_scheme,
    ComponentCounts,
)
from app.services.kos_formwork_generator.tier6_components import (
    build_tier6_components,
    CANONICAL_CATEGORY_ORDER,
)
from app.services.kos_formwork_generator.tier5_walls import (
    build_tier5_walls,
)
from app.services.kos_formwork_generator.tier4_skus import (
    build_tier4_skus,
)

# ─── PR 3: Aggregation + ID generator (appended; PR 1+2 imports unchanged) ─

from app.services.kos_formwork_generator.tier3_categories import (
    build_tier3_categories,
)
from app.services.kos_formwork_generator.tier2_summary import (
    build_tier2_summary,
    BRACING_PRIMARY_COMPONENT_TYPES,
    BRACING_SECONDARY_COMPONENT_TYPES,
)
from app.services.kos_formwork_generator.tier1_project import (
    build_tier1_project,
)
from app.services.kos_formwork_generator.id_generator import (
    mint_formwork_id,
    compute_mapper_output_hash,
    compute_context_hash,
    compute_generated_at,
    build_audit_trail,
)

# ─── PR 4: Validators + Handlers (appended; PR 1-3 imports unchanged) ──────

from app.services.kos_formwork_generator.custom_quote_handler import (
    build_custom_quote_items,
    CUSTOM_QUOTE_TRIGGER_RULES,
    FRB_MAX_HEIGHT_M,
)
from app.services.kos_formwork_generator.operator_review_handler import (
    build_operator_review_items,
    OPERATOR_REVIEW_TRIGGER_RULES,
    APPLICATION_CONFIDENCE_THRESHOLD,
)
from app.services.kos_formwork_generator.output_validator import (
    validate_formwork_output,
    INVARIANT_IDS,
)

# ─── PR 5: Orchestrator (appended; PR 1-4 imports unchanged) ───────────────

from app.services.kos_formwork_generator.orchestrator import generate_formwork

# ─── PR 6: HTTP serializers (appended; PR 1-5 imports unchanged) ───────────

from app.services.kos_formwork_generator.http_serializers import (
    format_formwork_output_json,
    dict_to_panel_grid_mapper_output,
    dict_to_formwork_context,
)


__all__ = [
    # Input + output envelopes
    "FormworkInput", "FormworkContext", "FormworkGeneratorOutput",
    # Tier types
    "Tier1FormworkSummary", "Tier2FormworkCategories", "Tier2Bucket",
    "Tier2BucketCustom", "Tier3SKUType", "Tier4SKUDetail",
    "Tier5FormworkWallSegment", "Tier6FormworkComponent",
    # Auxiliary
    "FormworkCustomQuoteRequest", "FormworkOperatorReviewItem",
    "FormworkAuditTrail", "BracingScheme",
    # Literal aliases
    "FormworkCategory", "FormworkCustomQuoteReason", "FormworkOperatorReviewType",
    "WallTypeOverride", "Unit", "SeismicZone", "SystemCode",
    "BracingHeightClass", "PropType",
    # Exceptions
    "FormworkError", "FormworkConfigError",
    "FormworkInputError", "FormworkInvariantError",
    # Constants — versions
    "FORMWORK_SCHEMA_VERSION", "FORMWORK_CALCULATION_VERSION",
    "FIELD_RULE_BOOK_VERSION",
    # Constants — defaults
    "WASTAGE_PERCENT_DEFAULT", "SEISMIC_ZONE_DEFAULT",
    # SKU catalog
    "FORMWORK_SKU_CATALOG", "FORMWORK_SKU_CODES",
    "SKU_DESCRIPTION", "SKU_UNIT", "SKU_CATEGORY", "SKU_FRB_SOURCE",
    # Pour rate lookups
    "POUR_RATE_DEFAULTS_M_PER_HR", "POUR_RATE_MAX_M_PER_HR",
    # Output baselines
    "PENDING_KARTHIK_DEFAULT", "ASSUMPTIONS_MADE_DEFAULT",
    "PIPELINE_VERSIONS_DEFAULT",
    # Lookup tables
    "BRACING_LOOKUP_TABLE",
    # ── PR 2: Algorithm modules ──
    "count_corners", "CornerDetection",
    "count_components", "find_bracing_scheme", "ComponentCounts",
    "build_tier6_components", "CANONICAL_CATEGORY_ORDER",
    "build_tier5_walls",
    "build_tier4_skus",
    # ── PR 3: Aggregation + ID generator ──
    "build_tier3_categories",
    "build_tier2_summary",
    "BRACING_PRIMARY_COMPONENT_TYPES", "BRACING_SECONDARY_COMPONENT_TYPES",
    "build_tier1_project",
    "mint_formwork_id",
    "compute_mapper_output_hash", "compute_context_hash",
    "compute_generated_at", "build_audit_trail",
    # ── PR 4: Validators + Handlers ──
    "build_custom_quote_items", "CUSTOM_QUOTE_TRIGGER_RULES", "FRB_MAX_HEIGHT_M",
    "build_operator_review_items", "OPERATOR_REVIEW_TRIGGER_RULES",
    "APPLICATION_CONFIDENCE_THRESHOLD",
    "validate_formwork_output", "INVARIANT_IDS",
    # ── PR 5: Orchestrator ──
    "generate_formwork",
    # ── PR 6: HTTP serializers ──
    "format_formwork_output_json",
    "dict_to_panel_grid_mapper_output",
    "dict_to_formwork_context",
]


logger.debug(
    "5F Formwork Generator PR 1+2+3+4+5+6 modules loaded: "
    "%d SKUs, %d bracing schemes, schema_version=%s, calculation_version=%s",
    len(FORMWORK_SKU_CATALOG),
    len(BRACING_LOOKUP_TABLE),
    FORMWORK_SCHEMA_VERSION,
    FORMWORK_CALCULATION_VERSION,
)
