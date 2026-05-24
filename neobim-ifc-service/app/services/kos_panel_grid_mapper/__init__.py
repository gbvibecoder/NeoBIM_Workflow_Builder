"""KOS Panel-Grid Mapper — public API.

PR 1 (foundation): types + exceptions + constants + version.
PR 2 (numeric):    area_weight_calculator + sku_resolver pure functions.
PR 3 (validator):  output_validator (21 invariants) + new schema fields
                   (WallSegment.is_custom_order/custom_quote_request/plan_polyline/
                   source_wall_ids, TotalCounts.by_segment, PanelGridMapperOutput.
                   waste_ratio/downstream_ready) + SegmentCount + ValidationIssue.
PR 4 (algorithm):  wall_segmenter + orientation_inferrer pure functions +
                   WallSegmentDraft / OrientationResult staging types.
PR 5 (lookups):    system_selector + multi_row_handler + curve_handler pure
                   functions + SystemSelectionResult / MultiLiftResult /
                   CurveResult result types.
PR 6 (junctions):  corner_handler (R1 clockwise-walk LEFT ownership) +
                   t_junction_handler (PC{thickness} fallback for K4-110/K6-180)
                   + opening_handler (heuristic detection today, full layout
                   scaffold for parser slice 5C-3). 3 new result types.
PR 7 (splitter):   splitter dispatcher + 3 strategies (minimize_cuts DEFAULT,
                   minimize_panels, symmetric). R5 INTEGRATED (external + None
                   reservation handled via neighbour_covered_*_mm offset).
                   PanelReservation / SplitInput / SplitResult types.
PR 8 (orchestrator): mapper.map_walls_to_panels() — single public entry point
                   that runs the full DESIGN §6.1 pipeline (validate → segment →
                   enrich → corner/T-junction → split → totals → validate).
                   The only allowed datetime.now() lives here, in the
                   generated_at field.
Future PRs add: app/routers/kos_panel_mapper.py (PR 9 — FastAPI route).

Single source of truth: temp_folder/phase-5d-panel-grid-mapper/DESIGN.md
"""

from .area_weight_calculator import (
    compute_panel_area_sqft,
    compute_panel_metrics,
    compute_panel_price_inr,
    compute_panel_weight_kg,
    compute_raw_weight_kg,
    compute_skin_rib_split,
    compute_waste_kg,
)
from .constants import (
    DEFAULT_RUNNING_BOND_OFFSET_MM,
    DEFAULT_SEISMIC_ZONE,
    DEFAULT_SPLIT_STRATEGY,
    DEFAULT_WALL_HEIGHT_MM,
    JOINT_OVERLAP_MM,
    KG_PER_SFT,
    MAPPER_SCHEMA_VERSION,
    MAX_LIFT_HEIGHT_MM,
    MIN_KALZEN_CURVE_RADIUS_MM,
    MM2_PER_SFT,
    MM_PER_FT,
    PARSER_OPENINGS_AVAILABLE,
    PRICE_PER_SFT_INR,
    REINFORCEMENT_SPEC_SOURCE,
    REINFORCEMENT_SPECS,
    RIB_FRACTION,
    SKIN_FRACTION,
    SKU_THICKNESS_FOR_SYSTEM,
    STANDARD_PANEL_CUT_LENGTH_MM,
    STANDARD_PANEL_RAW_HEIGHT_MM,
    STANDARD_PANEL_WIDTH_MM,
    STANDARD_PANEL_WIDTHS_MM,
    THICKNESS_BANDS,
    classify_bracing_height,
)
from .exceptions import (
    CustomQuoteRequired,
    MapperError,
    MapperInputError,
    OutputInvariantError,
)
from .corner_handler import handle_corner
from .curve_handler import detect_curve
from .mapper import map_walls_to_panels
from .multi_row_handler import plan_lifts
from .opening_handler import detect_openings
from .orientation_inferrer import infer_application
from .output_validator import (
    validate_or_raise,
    validate_output,
)
from .sku_resolver import (
    assign_label,
    build_sku_code,
    resolve_bracing_height_class,
    resolve_reinforcement_spec,
)
from .splitter import split_wall_to_panels
from .splitter_strategies import (
    split_minimize_cuts,
    split_minimize_panels,
    split_symmetric,
)
from .system_selector import select_system
from .t_junction_handler import handle_t_junction
from .types import (
    CornerHandlerResult,
    CurveResult,
    CustomQuoteRequest,
    MapperInput,
    MultiLiftResult,
    Opening,
    OpeningHandlerResult,
    OrientationResult,
    Panel,
    PanelGridMapperOutput,
    PanelReservation,
    ParserJunction,
    ParserOutput,
    ParserTitleBlock,
    ParserWall,
    ProjectContext,
    ReinforcementSpec,
    SegmentCount,
    SplitInput,
    SplitResult,
    SystemSelectionResult,
    TJunctionHandlerResult,
    TotalCounts,
    ValidationIssue,
    WallSegment,
    WallSegmentDraft,
)
from .wall_segmenter import segment_walls

__all__ = [
    # Version
    "MAPPER_SCHEMA_VERSION",
    # Constants
    "STANDARD_PANEL_WIDTH_MM",
    "STANDARD_PANEL_RAW_HEIGHT_MM",
    "STANDARD_PANEL_CUT_LENGTH_MM",
    "PRICE_PER_SFT_INR",
    "KG_PER_SFT",
    "SKIN_FRACTION",
    "RIB_FRACTION",
    "MM_PER_FT",
    "MM2_PER_SFT",
    "THICKNESS_BANDS",
    "SKU_THICKNESS_FOR_SYSTEM",
    "MAX_LIFT_HEIGHT_MM",
    "REINFORCEMENT_SPEC_SOURCE",
    "REINFORCEMENT_SPECS",
    "classify_bracing_height",
    "MIN_KALZEN_CURVE_RADIUS_MM",
    "JOINT_OVERLAP_MM",
    "STANDARD_PANEL_WIDTHS_MM",
    "PARSER_OPENINGS_AVAILABLE",
    "DEFAULT_SEISMIC_ZONE",
    "DEFAULT_WALL_HEIGHT_MM",
    "DEFAULT_SPLIT_STRATEGY",
    "DEFAULT_RUNNING_BOND_OFFSET_MM",
    # Exceptions
    "MapperError",
    "MapperInputError",
    "OutputInvariantError",
    "CustomQuoteRequired",
    # Input types
    "ParserWall",
    "ParserJunction",
    "ParserTitleBlock",
    "ParserOutput",
    "ProjectContext",
    "MapperInput",
    # Output types
    "Panel",
    "ReinforcementSpec",
    "Opening",
    "WallSegment",
    "CustomQuoteRequest",
    "TotalCounts",
    "PanelGridMapperOutput",
    # PR 2 — area_weight_calculator
    "compute_panel_area_sqft",
    "compute_panel_weight_kg",
    "compute_skin_rib_split",
    "compute_panel_price_inr",
    "compute_raw_weight_kg",
    "compute_waste_kg",
    "compute_panel_metrics",
    # PR 2 — sku_resolver
    "build_sku_code",
    "assign_label",
    "resolve_reinforcement_spec",
    "resolve_bracing_height_class",
    # PR 3 — output_validator
    "validate_output",
    "validate_or_raise",
    # PR 3 — new schema types
    "SegmentCount",
    "ValidationIssue",
    # PR 4 — wall_segmenter + orientation_inferrer
    "segment_walls",
    "infer_application",
    "WallSegmentDraft",
    "OrientationResult",
    # PR 5 — system_selector + multi_row_handler + curve_handler
    "select_system",
    "plan_lifts",
    "detect_curve",
    "SystemSelectionResult",
    "MultiLiftResult",
    "CurveResult",
    # PR 6 — corner_handler + t_junction_handler + opening_handler
    "handle_corner",
    "handle_t_junction",
    "detect_openings",
    "CornerHandlerResult",
    "TJunctionHandlerResult",
    "OpeningHandlerResult",
    # PR 7 — splitter dispatcher + 3 strategies + types
    "split_wall_to_panels",
    "split_minimize_cuts",
    "split_minimize_panels",
    "split_symmetric",
    "PanelReservation",
    "SplitInput",
    "SplitResult",
    # PR 8 — orchestrator (the public entry point)
    "map_walls_to_panels",
]
