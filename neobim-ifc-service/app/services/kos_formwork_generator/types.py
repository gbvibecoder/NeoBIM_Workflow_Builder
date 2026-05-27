"""Type definitions for KOS Formwork Quantities Generator.

All dataclasses are frozen (immutable). All collections are tuples.
Reference: 5F-DESIGN v2 doc 01_SCHEMA.md.

Per Decision 9 (DESIGN v2 §6, §8, §9): FormworkCategory,
FormworkCustomQuoteReason, and FormworkOperatorReviewType are
``typing.Literal`` type aliases (mirrors BOQ CustomQuoteReason pattern;
NOT ``enum.Enum``). Verified Pre-flight A.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Optional, Tuple

from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# LITERAL TYPE ALIASES (per Decision 9 v2)
#
# These are exposed as type aliases — NOT enum classes. Use ``typing.get_args()``
# at runtime to inspect membership, or import the alias and rely on type
# checkers / Literal-aware validators.
# ═════════════════════════════════════════════════════════════════════

#: 13 category arms per DESIGN v2 doc 01 §6 (revised 2026-05-26).
#: Dropped from v1: wedge_ties, tie_rods (Karthik "won't be applicable").
FormworkCategory = Literal[
    "props",
    "walers",
    "kickers",
    "diagonal_braces",
    "raker_props",
    "corner_clamps",
    "base_plates",
    "prop_heads",
    "joint_gaskets",
    "starter_tracks",
    "alignment_braces",
    "misc",
    "custom_quotes",
]

#: 10 reason arms per DESIGN v2 doc 01 §8.
FormworkCustomQuoteReason = Literal[
    # Inherited from mapper (mapper already routed these; 5F re-emits)
    "inherited_curved_wall",
    "inherited_custom_thickness",
    "inherited_other_custom",
    # 5F-specific (NEW conditions detected during formwork calc)
    "height_exceeds_field_rule_book_max",
    "pour_rate_exceeds_field_rule_book_max",
    "seismic_zone_v_verification",
    "non_standard_corner_angle",
    "unsupported_corner_thickness",
    "unsupported_t_junction_thickness",
    "wall_type_override_high_risk",
]

#: 9 review-type arms per DESIGN v2 doc 01 §9.
#: Dropped 2026-05-26: ``reuse_cycles_non_default`` (Decision 14 REMOVED).
FormworkOperatorReviewType = Literal[
    # Inherited from mapper
    "inherited_orphan_opening",
    "inherited_low_confidence_opening",
    "inherited_ambiguous_thickness",
    "inherited_curve_radius_uncertain",
    # 5F-specific
    "seismic_zone_high",
    "pour_rate_override",
    "wall_type_override",
    "low_application_confidence",
    "context_incomplete",
]

#: Sub-Literal used by FormworkContext.wall_type_overrides and tier types.
WallTypeOverride = Literal["external", "internal", "basement", "retaining"]

#: Used across tier types.
Unit = Literal["nos", "linear_m"]

#: Seismic zone (mapper does not emit Zone I).
SeismicZone = Literal["II", "III", "IV", "V"]

#: System literal (5 standard systems).
SystemCode = Literal["K4-110", "K6-150", "K6-180", "K8-200", "K8-250"]

#: BracingHeightClass — matches mapper's bracing_height_class field.
BracingHeightClass = Literal["le_2.4m", "2.4_to_3.0m", "3.0_to_4.5m", "4.5_to_6.0m"]

#: PropType (capacity classification).
PropType = Literal["L", "M", "H", "XH"]


# ═════════════════════════════════════════════════════════════════════
# CONTEXT (9 fields per DESIGN v2 §3 v2)
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class FormworkContext:
    """Engineering-only context for Formwork Quantities generation.

    Bracing is on lease (Karthik 2026-05-26) — no commercial fields.
    All fields immutable. Defaults match Field Rule Book conventions.

    Fields (9 total):
        project_id: required project identifier.
        quote_date: ISO 8601 date (YYYY-MM-DD); audit only.
        seismic_zone: optional override; None → use mapper.seismic_zone.
        pour_rate_m_per_hr: optional override; None → use FRB §10.2 default.
        wastage_percent: percentage buffer per FRB §2.1 (default 5.0).
        wall_type_overrides: immutable tuple of (wall_id, type) pairs;
            empty tuple → use mapper.inferred_application per wall.
        deterministic_id_seed: optional; when set, formwork_id uses UUID5
            with this seed. When None, formwork_id uses UUID4.
        generated_at_override: optional pinned ISO timestamp for byte-equal tests.
        notes: optional free-form text.
    """

    project_id: str
    quote_date: str
    seismic_zone: Optional[SeismicZone] = None
    pour_rate_m_per_hr: Optional[float] = None
    wastage_percent: float = 5.0
    wall_type_overrides: Tuple[Tuple[str, WallTypeOverride], ...] = ()
    deterministic_id_seed: Optional[str] = None
    generated_at_override: Optional[str] = None
    notes: Optional[str] = None


# ═════════════════════════════════════════════════════════════════════
# BRACING SCHEME (lookup table entry; 16 total per FRB Appendix A Card 1)
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class BracingScheme:
    """A single bracing scheme entry per FRB Appendix A Card 1.

    16 schemes total: K4-110 (3) + K6-150 (4) + K6-180 (3) + K8-200 (3) + K8-250 (3).
    Lookup key is (system, height_mm); PR 2 component_counter selects the row
    whose [height_range_min_m, height_range_max_m) interval contains height_m.
    """

    system: SystemCode
    height_range_min_m: float
    height_range_max_m: float
    bracing_height_class: BracingHeightClass
    lifts: int
    prop_type: PropType
    prop_sku: str
    prop_spacing_m: float
    waler_count: int
    waler_position: str  # "N/A" | "H/2" | "mid_and_upper"
    kicker_spacing_mm: int
    has_diagonal: bool
    frb_source: str


# ═════════════════════════════════════════════════════════════════════
# TIER TYPES (per DESIGN v2 doc 01 §5)
# 🚨 Per DESIGN v2 naming: Tier{N}FormworkX (with Formwork infix).
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class Tier6FormworkComponent:
    """Individual bracing component instance (7 fields per DESIGN v2 §5.6).

    NO weight_kg, NO unit_price_inr, NO line_total_inr (bracing on lease).

    Convention for component ordering and IDs (locked here, PR 2-5 must follow):
      - Within a project, walls sorted alphabetically by ``wall_segment_id``.
      - Within a wall, components sorted by ``component_type`` in canonical order:
        prop → kicker → base_plate → prop_head → starter_track → waler →
        diagonal_brace → corner_clamp → joint_gasket → raker_prop.
      - Component IDs are sequential ``C-0001``, ``C-0002``, ... in this order.
    """

    component_id: str
    wall_segment_id: str
    component_type: Literal[
        "prop",
        "waler",
        "kicker",
        "diagonal_brace",
        "raker_prop",
        "corner_clamp",
        "base_plate",
        "prop_head",
        "joint_gasket",
        "starter_track",
    ]
    sku_code: str
    quantity: float
    unit: Unit
    source_rule: str


@dataclass(frozen=True)
class Tier5FormworkWallSegment:
    """Per-wall bracing scheme rollup — quantity-only (22 fields per DESIGN v2 §5.5)."""

    wall_id: str
    system: str
    application: str
    length_mm: float
    height_mm: int
    bracing_height_class: str
    is_custom_order: bool

    # Applied bracing scheme (from FRB Appendix A Card 1)
    bracing_scheme_applied: str
    prop_sku: str
    prop_spacing_m: float

    # Per-wall component quantities (all wastage-adjusted)
    total_props: int
    total_walers: int
    total_kickers: int
    total_diagonals: int
    total_raker_props: int
    total_corner_clamps: int
    total_base_plates: int
    total_prop_heads: int
    joint_gasket_meters: float
    starter_track_meters: float

    pour_rate_applied_m_per_hr: float
    notes: str


@dataclass(frozen=True)
class Tier4SKUDetail:
    """Per-SKU project total — quantity-only (8 fields per DESIGN v2 §5.4 actual code)."""

    sku_code: str
    sku_prefix: str
    thickness_mm: int
    description: str
    base_quantity: float
    wastage_quantity: float
    total_quantity: float
    unit: Unit


@dataclass(frozen=True)
class Tier3SKUType:
    """Per-SKU-prefix project total (3 fields per DESIGN v2 §5.3)."""

    sku_prefix: str
    total_count: int
    total_linear_meters: float


@dataclass(frozen=True)
class Tier2Bucket:
    """Quantity-only bucket for bracing_primary / bracing_secondary (2 fields per §5.2)."""

    count: int
    linear_meters: float


@dataclass(frozen=True)
class Tier2BucketCustom:
    """Custom-quote bucket (3 fields per §5.2)."""

    count: int
    pending_count: int
    note: str


@dataclass(frozen=True)
class Tier2FormworkCategories:
    """3-bucket categorization per Decision 2 (quantity-only).

    - bracing_primary: props, walers, kickers, diagonal braces, raker props
    - bracing_secondary: corner clamps, base plates, prop heads, joint gaskets, starter tracks
    - custom_quotes: routed away from standard rollup
    """

    bracing_primary: Tier2Bucket
    bracing_secondary: Tier2Bucket
    custom_quotes: Tier2BucketCustom


@dataclass(frozen=True)
class Tier1FormworkSummary:
    """Tier 1 — project quantity totals (15 fields per DESIGN v2 §5.1).

    NO commercial fields (no grand_total_inr, no tax, no discount, no total_weight_kg).
    """

    project_name: str
    quote_date: str

    # Project structure totals
    total_wall_segments_with_bracing: int
    total_corners_detected: int

    # Bracing-primary category totals
    total_props: int
    total_walers: int
    total_kickers: int
    total_diagonal_braces: int
    total_raker_props: int

    # Bracing-secondary category totals
    total_corner_clamps: int
    total_base_plates: int
    total_prop_heads: int
    total_joint_gasket_meters: float
    total_starter_track_meters: float

    # Custom + reviews
    total_custom_quote_items: int
    operator_review_items_count: int


# ═════════════════════════════════════════════════════════════════════
# AUXILIARY TYPES (per DESIGN v2 §10, §11, §12)
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class FormworkCustomQuoteRequest:
    """A wall segment routed away from standard rollup (11 fields per §10).

    Engineer reviews; no pricing produced by 5F (bracing on lease).
    """

    wall_id: str
    reason: FormworkCustomQuoteReason
    reason_detail: str
    system: str
    thickness_mm: Optional[float]
    length_mm: float
    height_mm: int
    application: str
    seismic_zone: str
    estimated_bracing_complexity: Literal["low", "medium", "high"]
    estimated_prop_count: Optional[int]


@dataclass(frozen=True)
class FormworkOperatorReviewItem:
    """A condition requiring operator review (4 fields per §11)."""

    review_type: FormworkOperatorReviewType
    description: str
    source_warning: str
    suggested_action: str


@dataclass(frozen=True)
class FormworkAuditTrail:
    """Audit trail metadata for traceability (7 fields per DESIGN v2 §12).

    Hashes live INSIDE audit_trail (Decision 8 v2), NOT at FormworkGeneratorOutput
    top-level — mirrors BOQ pattern verified Pre-flight C.
    """

    mapper_output_hash: str
    context_hash: str
    formwork_calculation_version: str
    field_rule_book_version: str
    custom_quote_review_required: bool
    operator_review_required: bool
    pipeline_versions: Tuple[Tuple[str, str], ...]


# ═════════════════════════════════════════════════════════════════════
# OUTPUT (15 fields per DESIGN v2 §4 v2)
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class FormworkGeneratorOutput:
    """Top-level frozen result of generate_formwork() — 15 fields.

    No commercial_terms field (dropped per Karthik 2026-05-26).
    Hashes (mapper_output_hash, context_hash) live INSIDE ``audit_trail``.
    """

    formwork_id: str
    generated_at: str
    schema_version: str
    tier_1_summary: Tier1FormworkSummary
    tier_2_categories: Tier2FormworkCategories
    tier_3_sku_types: Tuple[Tier3SKUType, ...]
    tier_4_sku_details: Tuple[Tier4SKUDetail, ...]
    tier_5_wall_segments: Tuple[Tier5FormworkWallSegment, ...]
    tier_6_components: Tuple[Tier6FormworkComponent, ...]
    custom_quote_items: Tuple[FormworkCustomQuoteRequest, ...]
    operator_review_items: Tuple[FormworkOperatorReviewItem, ...]
    audit_trail: FormworkAuditTrail
    warnings: Tuple[str, ...]
    assumptions_made: Tuple[str, ...]
    pending_karthik: Tuple[str, ...]


# ═════════════════════════════════════════════════════════════════════
# INPUT WRAPPER
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class FormworkInput:
    """Pipeline input envelope: mapper output + 5F-specific context.

    Pure input — ``generate_formwork(input)`` does NOT mutate either field.
    Both are deeply immutable (mapper_output is frozen, context is frozen,
    all nested collections are tuples).
    """

    mapper_output: PanelGridMapperOutput
    context: FormworkContext


logger.debug("5F Formwork Generator types module loaded (16 dataclasses + 8 Literal aliases)")
