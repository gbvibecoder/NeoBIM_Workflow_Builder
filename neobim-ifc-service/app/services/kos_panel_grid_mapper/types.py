"""
Typed dataclasses for the KOS Panel-Grid Mapper.

Single source of truth: DESIGN.md §3 (input contract) + §4 (output contract).
Every refinement R1-R6 from Step 4 of the design slice is integrated:

  - R2: WallSegment.neighbour_covered_left_mm + neighbour_covered_right_mm
  - R4: Panel.width_mm is int (was Literal[300])
  - R6: Panel.raw_length_mm is int — supports horizontal multi-piece tracks

All dataclasses are frozen=True. No mutation after construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from .constants import (
    Application,
    BracingHeightClass,
    PanelOrientation,
    SeismicZone,
    SimpleApplication,
    SkuPrefix,
    SplitStrategy,
    System,
)

# ──────────────────────────────────────────────────────────────────────────────
# INPUT CONTRACT — mirrors the on-the-wire shape of /kos/parse-drawing output
# (see neobim-ifc-service/app/services/kos_drawing_geometry.py:50-81 and
#  app/routers/kos_drawing_parser.py:114-146). DESIGN §3.1.
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ParserWall:
    """One wall segment as emitted by the parser.

    Parser-side source: kos_drawing_geometry.py::_seg_to_wall (line 50-81).
    """

    id: str                          # "w0", "w1", ... (parser uses w-prefix, NOT "wall_001")
    start: tuple[float, float]       # mm coords
    end: tuple[float, float]         # mm coords
    length_mm: float
    thickness_mm: Optional[float]    # None if parser couldn't detect
    angle_degrees: float             # 0 = horizontal, 90 = vertical (parser convention, [0, 180))
    layer: str                       # DXF layer or "PDF:black@1.2pt"
    detection_tier: int              # 1-4
    confidence: float                # 0.0-1.0


@dataclass(frozen=True)
class ParserJunction:
    """One junction (point where walls meet) as emitted by the parser.

    NOTE: parser uses `point`/`wall_ids`/`wall_count` — NOT `position`/`walls` as the
    original 5D prompt mistakenly claimed. CONTEXT_CONFIRMED.md §1 documented this
    correction. Junction types are CORNER/T_JOIN/X_JOIN/END (NOT L/T/X/endpoint).
    """

    point: tuple[float, float]                              # mm coords
    type: Literal["CORNER", "T_JOIN", "X_JOIN", "END"]
    wall_ids: tuple[str, ...]                               # sorted list of incident wall ids
    wall_count: int                                         # 1=END, 2=CORNER, 3=T_JOIN, 4=X_JOIN


@dataclass(frozen=True)
class ParserTitleBlock:
    """Title block metadata if extracted by the parser."""

    project_name: Optional[str] = None
    drawing_number: Optional[str] = None
    revision: Optional[str] = None
    scale: Optional[str] = None
    drawn_by: Optional[str] = None
    checked_by: Optional[str] = None
    level: Optional[str] = None         # "GROUND FLOOR", "BASEMENT", etc.
    date: Optional[str] = None


@dataclass(frozen=True)
class ParserOutput:
    """The complete parser output for one drawing.

    Field order mirrors routers/kos_drawing_parser.py::_assemble_response (lines 114-146).
    """

    walls: tuple[ParserWall, ...]
    junctions: tuple[ParserJunction, ...]
    title_block: ParserTitleBlock
    drawing_classification: str                       # "FLOOR_PLAN" / "SECTION" / "ELEVATION" / "DETAIL"
    drawing_classification_confidence: float
    drawing_classification_signals: tuple[str, ...]
    drawing_classification_reasoning: str
    layers_found: tuple[str, ...]
    drawing_bounds: dict[str, float]                  # {"min_x", "min_y", "max_x", "max_y"}
    units_detected: str                               # e.g. "pdf 1:50 (pt→mm ×17.6389)"
    stats: dict[str, int | float]                     # entity counts, parse stats
    field_confidences: dict[str, float]
    downstream_ready: dict[str, bool]                 # {"boq", "formwork", "shop_drawings"}
    missing_data: tuple[str, ...]
    detection_strategy_used: str
    overall_confidence: float
    parser_version: str
    phase: str
    duration_ms: float
    warnings: tuple[str, ...]


# Caller-supplied project metadata. DESIGN §3.2.


@dataclass(frozen=True)
class ProjectContext:
    """Caller-supplied project metadata.

    Defaults follow POLICY-DEFAULT-CONFIG (DESIGN §10).
    """

    project_name: str
    seismic_zone: SeismicZone = "III"
    application_hint: Optional[Application] = None
    split_strategy: SplitStrategy = "minimize_cuts"
    wall_height_mm: int = 3000


@dataclass(frozen=True)
class MapperInput:
    """The mapper's input contract: parser output + caller-supplied context."""

    parser_output: ParserOutput
    project_context: ProjectContext


# ──────────────────────────────────────────────────────────────────────────────
# OUTPUT CONTRACT — DESIGN §4
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Panel:
    """One installed panel/track/cap/connector.

    R4 INTEGRATED: width_mm is `int` (was Literal[300]) so the splitter can emit
        narrow CTC infills and Strategy A's custom-width APs.
    R6 INTEGRATED: raw_length_mm is `int` (allows horizontals > 3048mm to track
        multi-piece raw stock consumption).
    """

    label: str                              # "S1", "C1", "V1", "HB1", etc. — for shop drawing
    sku: str                                # "AP155-2998", "BT110-1305", etc.
    type: SkuPrefix
    thickness_mm: Literal[110, 155, 200]    # strictly Karthik standard catalog
    width_mm: int                           # R4: int (was Literal[300]); default 300
    cut_length_mm: int
    raw_length_mm: int                      # R6: ≥ cut_length_mm; supports horizontals > 3048
    position_mm: float                      # distance from segment start (vertical-panel sequence axis)
    orientation: PanelOrientation
    is_cut_member: bool
    cut_male_mm: float                      # Vamshi M:X joint-trim depth (mm)
    cut_female_mm: float                    # Vamshi F:Y joint-trim depth (mm)
    area_sqft: float                        # = (cut_length × width) / 92903.04
    weight_kg: float                        # = area_sqft × KG_PER_SFT[thickness]
    weight_kg_skin: float                   # = weight_kg × 0.60
    weight_kg_rib: float                    # = weight_kg × 0.40
    raw_weight_kg: float                    # area-equivalent at raw_length × width
    waste_weight_kg: float                  # = raw_weight_kg - weight_kg
    price_inr: float                        # = area_sqft × 225


@dataclass(frozen=True)
class ReinforcementSpec:
    """Reinforcement (rebar) specification for a wall segment. Per Field Rule Book §8.2."""

    vertical_bars: str                      # e.g. "16mm @ 150mm c/c"
    horizontal_bars: str                    # e.g. "10mm @ 300mm c/c"
    concrete_grade: str                     # "M20" | "M25" | "M30" | "M35"
    cover_external_mm: int
    cover_internal_mm: int
    source_section: str                     # e.g. "Rulebook §8.2 K6 Zone III" (audit trail)


@dataclass(frozen=True)
class Opening:
    """A door or window in the wall.

    Today this is always empty in mapper output (PARSER-ENH-1 pending). When the
    parser starts emitting opening data, the orchestrator populates this list.
    """

    position_mm: float                      # distance from segment start
    width_mm: float
    height_mm: float
    sill_height_mm: float                   # 0 for doors; >0 for windows


@dataclass(frozen=True)
class WallSegment:
    """One named wall segment (P_EXT_1, P_INT_5, etc.) with its full panel layout.

    R2 INTEGRATED: neighbour_covered_left_mm + neighbour_covered_right_mm tell the
        splitter what positions are already filled by the neighbour's owned corner
        unit, so it skips them (instead of emitting an ECM default).

    PR 3 SCHEMA CORRECTIONS (defaults so PR 1 fixtures keep working unchanged):
        + plan_polyline       — wall centerline (x,y) points (DESIGN §4.3)
        + source_wall_ids     — parser-side wall ids merged into this segment
        + is_custom_order     — True for CUSTOM / non-standard systems (DESIGN §4.3,
                                required by output_validator C-18)
        + custom_quote_request — per-segment quote request (DESIGN §4.3, required by C-18).
                                For non-CUSTOM segments this is None and panels[] is populated;
                                for CUSTOM segments panels[] is empty and this is populated.
    """

    id: str                                 # "P_EXT_1", "P_INT_5", etc. (auto-named)
    system: System
    custom_thickness_mm: Optional[int]      # populated only when system == "CUSTOM"
    inferred_application: SimpleApplication
    application_confidence: float           # 0.0-1.0
    application_source: Literal["user_hint", "geometry_heuristic"]
    length_mm: float                        # plan-extent (A11)
    height_mm: int
    area_sqft: float
    lifts_required: int                     # ≥1
    neighbour_covered_left_mm: float        # R2 — splitter offset (mm covered by neighbour's corner)
    neighbour_covered_right_mm: float       # R2 — splitter offset (right end)
    panels: tuple[Panel, ...]               # all panels (vertical + horizontal mixed)
    openings: tuple[Opening, ...]           # empty today (PARSER-ENH-1)
    openings_inferable: bool                # heuristic flag from opening_handler
    bracing_height_class: BracingHeightClass
    reinforcement_spec: ReinforcementSpec
    segment_cost_inr: float                 # sum of all panel.price_inr
    segment_weight_kg: float
    segment_skin_kg: float
    segment_rib_kg: float
    segment_raw_kg: float
    segment_waste_kg: float
    segment_panel_counts: dict[str, int]    # {"AP155-2998": 29, "CP155-2998": 1, ...}
    warnings: tuple[str, ...]
    info_notes: tuple[str, ...]             # non-warning informational messages
    assumptions: tuple[str, ...]            # per-segment assumption tags applied
    # ── PR 3 additions (defaults — backward-compatible with PR 1 constructors) ──
    plan_polyline: tuple[tuple[float, float], ...] = ()
    source_wall_ids: tuple[str, ...] = ()
    is_custom_order: bool = False
    custom_quote_request: Optional["CustomQuoteRequest"] = None


@dataclass(frozen=True)
class CustomQuoteRequest:
    """Emitted alongside CUSTOM-system walls; signals sales handoff needed.

    NOT an HTTP error — it's a normal output field. The 200 OK response carries
    this so the caller knows which walls require manual sales engagement.
    """

    wall_segment_id: str
    thickness_mm: float
    length_mm: float
    height_mm: int
    reason: str                             # e.g. "thickness 275mm exceeds standard catalog"


@dataclass(frozen=True)
class SegmentCount:
    """One row of TotalCounts.by_segment (per-segment panel count rollup).

    PR 3 schema correction — DESIGN.md §4.5 declares:
        by_segment: Array<{ segment_id: string; panel_count: number }>
    """

    segment_id: str
    panel_count: int


@dataclass(frozen=True)
class TotalCounts:
    """Project-level grand totals — for the BOQ generator's six-tier rollup.

    PR 3 schema correction: + by_segment (DESIGN §4.5, required by validator C-5).
    Defaulted to empty tuple so PR 1 constructors keep working.
    """

    by_sku: dict[str, int]                  # {"AP155-2998": 254, "CP155-2998": 4, ...}
    by_type: dict[str, int]                 # {"AP": 254, "CP": 4, "BT": 13, ...}
    by_thickness: dict[int, int]            # {110: 79, 155: 234}
    grand_total: int                        # sum of all panel counts
    by_segment: tuple[SegmentCount, ...] = ()    # PR 3 addition


@dataclass(frozen=True)
class PanelGridMapperOutput:
    """The complete mapper output — single deliverable per /kos/generate-panel-layout call."""

    project_name: str
    seismic_zone: SeismicZone
    split_strategy_used: SplitStrategy
    wall_height_mm: int
    wall_segments: tuple[WallSegment, ...]
    custom_quote_requests: tuple[CustomQuoteRequest, ...]
    total_counts: TotalCounts
    total_cost_inr: float
    total_weight_kg: float
    total_skin_kg: float
    total_rib_kg: float
    total_raw_kg: float
    total_waste_kg: float
    warnings: tuple[str, ...]
    assumptions_made: tuple[str, ...]        # all 🔴 ASSUMPTION items surfaced this run
    pending_karthik: tuple[str, ...]         # all 🟡 PENDING items still outstanding
    info_notes: tuple[str, ...]
    schema_version: str                      # = MAPPER_SCHEMA_VERSION
    generated_at: str                        # ISO-8601 timestamp — set by mapper.py orchestrator
    # ── PR 3 additions (defaults — backward-compatible with PR 1 constructors) ──
    waste_ratio: float = 0.0                 # total_waste_kg / total_raw_kg (DESIGN §4.2, C-17)
    downstream_ready: dict[str, bool] = field(
        default_factory=lambda: {"boq": False, "formwork": False, "shop_drawings": False}
    )                                        # gating signal for BOQ/Formwork/Shop generators (C-20)


# ──────────────────────────────────────────────────────────────────────────────
# WALL SEGMENT DRAFT — staging type used by wall_segmenter (PR 4)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class WallSegmentDraft:
    """Intermediate segment representation produced by `wall_segmenter.segment_walls`.

    The full WallSegment dataclass needs many fields (system, application, panels,
    reinforcement, etc.) that the segmenter alone cannot fill in. The draft carries
    only what segmentation produces; downstream stages (orientation_inferrer,
    system_selector, splitter, …) progressively enrich it; the orchestrator (PR 8)
    assembles the final WallSegment.

    DESIGN.md §6.3 — wall segmentation algorithm.
    """

    id: str                                  # "P_EXT_1" .. or "P_INT_5" .., assigned by the segmenter
    source_wall_ids: tuple[str, ...]         # ordered list of parser wall ids in this segment
    plan_polyline: tuple[tuple[float, float], ...]  # the segment's centerline path, (x,y) mm
    length_mm: float                         # plan-extent (A11), not sum of source-wall lengths
    is_closed_loop: bool                     # True iff this segment is part of the closed perimeter
    endpoint_junction_types: tuple[str, ...]  # for open chains: (type_at_start, type_at_end);
                                              # empty tuple for closed loops (no endpoints).


# ──────────────────────────────────────────────────────────────────────────────
# ORIENTATION RESULT — emitted by orientation_inferrer (PR 4)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class OrientationResult:
    """The output of orientation_inferrer.infer_application.

    DESIGN.md §6.4 — 7-priority ladder for application inference. The 4-value
    SimpleApplication is what WallSegment.inferred_application carries downstream.
    """

    application: SimpleApplication           # "external" | "internal" | "basement" | "retaining"
    confidence: float                        # 0.0 - 1.0
    source: Literal["user_hint", "geometry_heuristic"]
    warnings: tuple[str, ...]                # any caveats (low confidence, conflict, etc.)


# ──────────────────────────────────────────────────────────────────────────────
# SYSTEM SELECTION RESULT — emitted by system_selector (PR 5)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SystemSelectionResult:
    """Output of system_selector.select_system.

    DESIGN.md §6.2 (Problem 1) — thickness band → system, with optional
    application_hint override per Rulebook §4.2.

    `sku_thickness_mm` is the integer thickness that goes into SKU codes
    (e.g. 155 for K6-150 walls per Vamshi convention). None when no fixed
    SKU exists (CUSTOM walls).

    `is_custom_order` flags walls that need a sales handoff: K6-180
    (rulebook only, not in Karthik's 110/155/200 standard catalog), K8-250
    (Karthik confirmed custom-on-request), and CUSTOM (thickness outside
    bands).
    """

    system: System
    sku_thickness_mm: Optional[int]
    is_custom_order: bool
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# MULTI-LIFT RESULT — emitted by multi_row_handler (PR 5)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MultiLiftResult:
    """Output of multi_row_handler.plan_lifts.

    DESIGN.md §6.10 (Problem 9) — lifts_required = ceil(height / max_lift),
    where max_lift is looked up by (system, application) from
    MAX_LIFT_HEIGHT_MM in constants.py.

    `running_bond_offset_mm` is 150mm (half panel — ASSUMPTION-A19) for
    multi-lift walls so panel joints stagger between lifts. Single-lift
    walls have offset 0.
    """

    lifts_required: int                      # ≥ 1
    max_lift_height_mm: int                  # the per-lift cap used in computation
    running_bond_offset_mm: int              # 150 for multi-lift; 0 for single
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# CURVE RESULT — emitted by curve_handler (PR 5)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CurveResult:
    """Output of curve_handler.detect_curve.

    DESIGN.md §6.9 (Problem 8) — curve detection via consecutive small-Δangle
    clusters. `decision` is "approximate" when straight panels can follow
    the radius (≥ MIN_KALZEN_CURVE_RADIUS_MM = 600mm — ASSUMPTION-A18), and
    "flag_custom" when the radius is too tight (custom curved SKU required).
    """

    has_curve: bool
    curve_radius_mm: Optional[float]         # None if no curve detected
    decision: Literal["approximate", "flag_custom"]
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# CORNER HANDLER RESULT — emitted by corner_handler (PR 6)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CornerHandlerResult:
    """Output of corner_handler.handle_corner.

    DESIGN.md §6.6 (Problem 5) — 90°/135° corner reservation per the R1
    ownership rule: each segment owns its LEFT corner in clockwise walk
    (= the corner at its plan_polyline[0]). The owner emits the CP panel;
    the other segment treats the corner region as "covered by neighbour"
    and starts its first emitted panel after the covered offset.

    R1 INTEGRATED: ownership is "clockwise-walk LEFT" (each segment owns the
    corner at its own polyline[0]), NOT alphabetical. This matches Vamshi's
    1-CP-per-segment pattern exactly (4 externals → 4 CP total, one per
    segment).
    """

    junction_point: tuple[float, float]
    owner_segment_id: str                    # the segment that emits the CP panel
    owner_corner_side: Literal["left", "right"]
    other_segment_id: str
    other_corner_side: Literal["left", "right"]  # where the corner sits on the abutting segment
    corner_angle_deg: int                    # 90 or 135 (0 = unusual; treated as 90 with warning)
    sku_thickness_mm: int                    # SKU thickness used for the CP panel
    panel_sku: str                           # e.g. "CP155-2998"
    width_mm: int                            # STANDARD_PANEL_WIDTH_MM = 300
    cut_length_mm: int                       # STANDARD_PANEL_CUT_LENGTH_MM = 2998
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# T-JUNCTION HANDLER RESULT — emitted by t_junction_handler (PR 6)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TJunctionHandlerResult:
    """Output of t_junction_handler.handle_t_junction.

    DESIGN.md §6.7 (Problem 6) — at a T_JOIN (3 walls meet, two collinear =
    "through pair", one perpendicular = "ending"), the ending segment gets a
    PC{thickness} terminator panel at the side where it abuts the through wall.

    For K4-110 / K6-180 (no KZ-CC-T-{thickness} in Rulebook §7.2), the panel
    SKU is still PC{thickness}-2998 per Vamshi P_INT_7 convention; a warning
    flags the fallback.
    """

    junction_point: tuple[float, float]
    ending_segment_id: str
    ending_corner_side: Literal["left", "right"]   # which end of the ending segment is at the T
    through_segment_id: Optional[str]               # may be None if collinear pair can't be unified
    sku_thickness_mm: int                           # SKU thickness for the PC panel
    panel_sku: str                                  # e.g. "PC110-2998"
    width_mm: int                                   # STANDARD_PANEL_WIDTH_MM = 300
    cut_length_mm: int                              # STANDARD_PANEL_CUT_LENGTH_MM = 2998
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# PANEL RESERVATION + SPLIT INPUT / RESULT — consumed/emitted by splitter (PR 7)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PanelReservation:
    """A pre-determined panel at the LEFT or RIGHT end of a wall segment.

    Constructed by the orchestrator (PR 8) from CornerHandlerResult /
    TJunctionHandlerResult and passed to the splitter as
    first_panel_reservation / last_panel_reservation. Each WallSegment can
    have at most one reservation on each side.

    `label` is optional: if supplied, the splitter uses it verbatim
    (e.g. "S1" for a corner CP); if None, the splitter assigns the next
    sequential S/V label.
    """

    sku_type: SkuPrefix                      # "CP" / "PC" / "ECM" / "ECF" / "JTM" / "JTF"
    sku_thickness_mm: int                    # 110 / 155 / 180 / 200 / 250
    width_mm: int = 300                      # STANDARD_PANEL_WIDTH_MM
    cut_length_mm: int = 2998                # STANDARD_PANEL_CUT_LENGTH_MM
    label: Optional[str] = None              # explicit label override


@dataclass(frozen=True)
class SplitInput:
    """The input contract for splitter.split_wall_to_panels.

    The orchestrator (PR 8) populates this from:
      - WallSegmentDraft (segment id + length)
      - SystemSelectionResult (system + sku_thickness)
      - OrientationResult (application)
      - CornerHandlerResult / TJunctionHandlerResult (reservations + covered offsets)
      - OpeningHandlerResult (openings list — empty today)
      - ProjectContext (split_strategy + wall_height_mm)

    R5 INTEGRATED: when application == "external" and no reservation exists on
    a given side, the splitter does NOT emit an ECM default. Instead it treats
    `neighbour_covered_*_mm` as a covered offset (the neighbour's corner CP
    occupies that region from this segment's perspective).
    """

    segment_id: str
    segment_length_mm: float
    segment_height_mm: int
    system: System
    sku_thickness_mm: int                    # SKU thickness for AP/CP/CTC/etc.
    application: SimpleApplication
    strategy: SplitStrategy                  # "minimize_cuts" / "minimize_panels" / "symmetric"
    first_panel_reservation: Optional[PanelReservation] = None
    last_panel_reservation: Optional[PanelReservation] = None
    neighbour_covered_left_mm: float = 0.0
    neighbour_covered_right_mm: float = 0.0
    openings: tuple["Opening", ...] = ()


@dataclass(frozen=True)
class SplitResult:
    """Output of splitter.split_wall_to_panels.

    `panels` order: 2 horizontal bands (HB1=BT, HB2=TC) first, then the
    vertical panels in left-to-right (position) order: S1 (first reservation
    or ECM default), S2..S{n} (AP run + any narrow CTC infill), V1 (last
    reservation or CTC terminator). Total ≥ 2 (always at least the two HBs).
    """

    panels: tuple[Panel, ...]
    strategy_used: SplitStrategy
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# OPENING HANDLER RESULT — emitted by opening_handler (PR 6)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class OpeningHandlerResult:
    """Output of opening_handler.detect_openings.

    DESIGN.md §6.8 (Problem 7) — today the parser does NOT emit Opening
    objects (PARSER_OPENINGS_AVAILABLE = False), so the handler runs only the
    heuristic detection step: it counts interior END junctions in the
    segment (END junctions that aren't at the segment's two endpoints — these
    indicate opening edges along the wall) and sets `openings_inferable` if
    ≥ 2 interior ENDs found. Returns empty `openings` list.

    When PARSER_OPENINGS_AVAILABLE flips to True (parser slice 5C-3), this
    handler will additionally compute the V (jamb) + HB (header/sill) frame
    panels per opening — that path is scaffolded in the module but not
    exercised today.
    """

    openings: tuple[Opening, ...]
    openings_inferable: bool                 # heuristic flag: ≥ 2 interior ENDs
    interior_end_count: int                  # diagnostic — how many interior ENDs were found
    warnings: tuple[str, ...]


# ──────────────────────────────────────────────────────────────────────────────
# VALIDATION ISSUE — emitted by output_validator (PR 3)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ValidationIssue:
    """One issue raised by an output_validator check.

    DESIGN §5 distinguishes hard vs soft severity:
      - hard: orchestrator raises OutputInvariantError with the issue list
              (algorithm bug — must not reach the client)
      - soft: orchestrator appends the message to output.warnings
              (e.g. C-11 external→CP first, C-19 bracing-class mismatch, C-21 ID pattern)
    """

    rule: str                                # "C-1", "C-2", ..., "C-21"
    severity: Literal["hard", "soft"]
    message: str                             # human-readable description with diagnostic numbers
    segment_id: Optional[str] = None         # populated when issue is segment-scoped
    panel_label: Optional[str] = None        # populated when issue is panel-scoped
