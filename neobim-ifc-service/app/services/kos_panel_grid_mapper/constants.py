"""
Locked constants for the KOS Panel-Grid Mapper.

Single source of truth: DESIGN.md §2.2 (Karthik canonical values) + §4.2 (constants module).
Any value here that contradicts DESIGN.md is a bug.

POLICY-KARTHIK-WINS: when Karthik's WhatsApp confirmations conflict with Vamshi PDF
observations, Karthik wins. 300mm panel width is canonical; Vamshi divergences are
reference-only.
"""

from __future__ import annotations

from typing import Final, Literal

# ──────────────────────────────────────────────────────────────────────────────
# Schema version
# ──────────────────────────────────────────────────────────────────────────────

MAPPER_SCHEMA_VERSION: Final[str] = "0.1.0"

# ──────────────────────────────────────────────────────────────────────────────
# Panel dimensions — LOCKED (Karthik WhatsApp 2026-05-23 17:36)
# ──────────────────────────────────────────────────────────────────────────────

STANDARD_PANEL_WIDTH_MM: Final[int] = 300
"""Uniform across all three thicknesses (110/155/200). Karthik 2026-05-23 17:36."""

STANDARD_PANEL_RAW_HEIGHT_MM: Final[int] = 3048
"""10 feet (304.8 × 10). Manufactured panel height before site cut.
Karthik 2026-05-23 17:36."""

STANDARD_PANEL_CUT_LENGTH_MM: Final[int] = 2998
"""Typical installed cut length (50mm clearance from 3048mm raw). Vamshi convention,
verified across all 10 segment sheets in Kalzen BIM integration.pdf."""

# ──────────────────────────────────────────────────────────────────────────────
# Commercial constants — LOCKED (Karthik WhatsApp 2026-05-23 17:58)
# ──────────────────────────────────────────────────────────────────────────────

PRICE_PER_SFT_INR: Final[int] = 225
"""Flat across all three thicknesses. Karthik chose simplicity over tiered ₹215/₹225 split.
Karthik 2026-05-23 17:58: "225 for all"."""

# Weight rates by thickness (kg per square foot of raw material).
# Karthik confirmations 2026-05-22/23.
KG_PER_SFT: Final[dict[int, float]] = {
    110: 1.29,   # Karthik 2026-05-23 17:37
    155: 1.46,   # Karthik (earlier, within 2026-05-22 window)
    200: 1.63,   # Karthik 2026-05-23 17:49
}

SKIN_FRACTION: Final[float] = 0.60
"""Karthik 2026-05-22 — 60% skin by weight."""

RIB_FRACTION: Final[float] = 0.40
"""Karthik 2026-05-22 — 40% rib by weight. SKIN_FRACTION + RIB_FRACTION must equal 1.0."""

# ──────────────────────────────────────────────────────────────────────────────
# Unit conversion
# ──────────────────────────────────────────────────────────────────────────────

MM_PER_FT: Final[float] = 304.8
"""International foot definition (NIST). NOT 305 or 304."""

MM2_PER_SFT: Final[float] = 92903.04
"""Square millimetres per square foot — the canonical denominator used in every
area computation throughout the mapper.

We pin this to the literal 92903.04 (rather than computing `MM_PER_FT * MM_PER_FT`)
because IEEE-754 representation of `304.8 * 304.8` yields 92903.04000000001 — an
≈1e-11 relative drift that, while harmless to downstream 2dp rounding, would
break exact-equality validation in the mapper's invariants. Using the literal
keeps every `area_sqft = mm2 / 92903.04` computation reproducible bit-for-bit
across CPUs/runs. Match to MM_PER_FT² holds within 1e-9 relative tolerance —
verified by test_constants.test_mm2_per_sft_close_to_mm_per_ft_squared."""

# ──────────────────────────────────────────────────────────────────────────────
# Type aliases (also re-exported from types.py — kept here as Literal[] for
# import convenience and to avoid types.py ↔ constants.py circularity).
# ──────────────────────────────────────────────────────────────────────────────

System = Literal["K4-110", "K6-150", "K6-180", "K8-200", "K8-250", "CUSTOM"]
"""5 standard systems + CUSTOM bucket for non-standard thicknesses."""

Application = Literal[
    "internal_partition",
    "villa_external",
    "apartment_external_g3",
    "apartment_external_g5",
    "school_commercial_g3",
    "lift_shaft_g5",
    "shear_wall_g10",
    "basement_lt3m",
    "basement_gt3m",
    "retaining",
]
"""10 application categories from Field Rule Book §4.2."""

SimpleApplication = Literal["external", "internal", "basement", "retaining"]
"""Coarse 4-category bucket used inside the mapper for branching."""

SkuPrefix = Literal["AP", "BT", "TC", "CP", "CTC", "ECF", "ECM", "JTF", "JTM", "PC"]
"""10 SKU prefixes from Vamshi PDF. See DESIGN.md §4.5 for label→SKU mapping."""

SplitStrategy = Literal["minimize_panels", "minimize_cuts", "symmetric"]
"""3 splitter strategies. Default = minimize_cuts per POLICY-DEFAULT-STRATEGY-B."""

SeismicZone = Literal["II", "III", "IV", "V"]
"""Indian seismic zones II–V (Zone I retired). Default III per POLICY-DEFAULT-CONFIG."""

PanelOrientation = Literal["vertical", "horizontal"]

BracingHeightClass = Literal["le_2.4m", "2.4_to_3.0m", "3.0_to_4.5m", "4.5_to_6.0m"]
"""Card 1 (Field Rule Book Appendix A) bracing-height bands."""

# ──────────────────────────────────────────────────────────────────────────────
# Lookup tables (4 — algorithms live elsewhere; this module only holds data)
# ──────────────────────────────────────────────────────────────────────────────

# Table 1: Thickness band → system
# Used by system_selector.py (Problem 1).
# Bands are HALF-OPEN intervals [low, high). ≥275mm flagged CUSTOM via fallback.
THICKNESS_BANDS: Final[tuple[tuple[int, int, System], ...]] = (
    # (min_mm_inclusive, max_mm_exclusive, system)
    (100, 120, "K4-110"),     # 110mm band: parser tolerance ±10mm
    (145, 160, "K6-150"),     # 150 and 155 collapse to K6-150 (POLICY-KARTHIK-WINS)
    (170, 190, "K6-180"),     # 180mm — flag stocking status warning
    (190, 220, "K8-200"),     # 200mm
    (240, 270, "K8-250"),     # 250mm — flag CUSTOM
    # ≥275mm → CUSTOM via fallback in system_selector
)

# Table 2: System → SKU thickness (the numeric component in SKU codes)
# E.g. K6-150 → 155 because Vamshi-namespace SKUs say "AP155".
# This is the POLICY-KARTHIK-WINS naming reconciliation.
SKU_THICKNESS_FOR_SYSTEM: Final[dict[System, int | None]] = {
    "K4-110": 110,
    "K6-150": 155,    # 150mm system → 155 SKU code (Vamshi convention)
    "K6-180": 180,    # WARNING emitted by system_selector if used
    "K8-200": 200,
    "K8-250": 250,    # CUSTOM flag emitted by system_selector
    "CUSTOM": None,   # caller must read custom_thickness_mm from output
}

# Table 3: System + simple-application → max lift height (mm)
# From Field Rule Book §4.2. Used by multi_row_handler.py (Problem 9).
# CUSTOM walls use default 3000mm with warning.
MAX_LIFT_HEIGHT_MM: Final[dict[tuple[System, SimpleApplication], int]] = {
    ("K4-110", "internal"):  3600,
    ("K4-110", "external"):  3600,
    ("K6-150", "external"):  3000,
    ("K6-150", "internal"):  3000,
    ("K6-180", "external"):  3600,
    ("K6-180", "internal"):  3600,
    ("K8-200", "external"):  3000,   # lift shaft / shear wall up to G+10
    ("K8-200", "basement"):  1800,
    ("K8-250", "basement"):  1800,
    ("K8-250", "retaining"): 2400,
}

# Table 4: System + seismic zone → reinforcement spec source section identifier.
# Used by sku_resolver.py to pull from Field Rule Book §8.2.
# Returns the section identifier; the actual rebar spec is in REINFORCEMENT_SPECS.
REINFORCEMENT_SPEC_SOURCE: Final[dict[tuple[System, SeismicZone], str]] = {
    ("K4-110", "II"):  "§8.2 K4",
    ("K4-110", "III"): "§8.2 K4",
    ("K4-110", "IV"):  "§8.2 K4",
    ("K4-110", "V"):   "§8.2 K4",
    ("K6-150", "II"):  "§8.2 K6 Zone II",
    ("K6-150", "III"): "§8.2 K6 Zone III",
    ("K6-150", "IV"):  "§8.2 K6 Zone IV/V",
    ("K6-150", "V"):   "§8.2 K6 Zone IV/V",
    ("K6-180", "II"):  "§8.2 K6 Zone II",
    ("K6-180", "III"): "§8.2 K6 Zone III",
    ("K6-180", "IV"):  "§8.2 K6 Zone IV/V",
    ("K6-180", "V"):   "§8.2 K6 Zone IV/V",
    ("K8-200", "II"):  "§8.2 K8",
    ("K8-200", "III"): "§8.2 K8",
    ("K8-200", "IV"):  "§8.2 K8",
    ("K8-200", "V"):   "§8.2 K8",
    ("K8-250", "II"):  "§8.2 K8 basement",
    ("K8-250", "III"): "§8.2 K8 basement",
    ("K8-250", "IV"):  "§8.2 K8 basement",
    ("K8-250", "V"):   "§8.2 K8 basement",
}

# Actual reinforcement specs (returned as ReinforcementSpec dataclass — see types.py).
# This is the keyed lookup table; sku_resolver builds the dataclass per request.
# Values from Field Rule Book §8.2.
REINFORCEMENT_SPECS: Final[dict[str, dict[str, str | int]]] = {
    "§8.2 K4": {
        "vertical_bars":     "2 nos 10mm dia. @ 600mm c/c",
        "horizontal_bars":   "8mm dia. @ 400mm c/c",
        "concrete_grade":    "M20",
        "cover_external_mm": 20,
        "cover_internal_mm": 20,
    },
    "§8.2 K6 Zone II": {
        "vertical_bars":     "12mm @ 200mm c/c",
        "horizontal_bars":   "10mm @ 300mm c/c",
        "concrete_grade":    "M25",
        "cover_external_mm": 25,
        "cover_internal_mm": 20,
    },
    "§8.2 K6 Zone III": {
        "vertical_bars":     "16mm @ 150mm c/c",
        "horizontal_bars":   "10mm @ 300mm c/c",
        "concrete_grade":    "M25",
        "cover_external_mm": 25,
        "cover_internal_mm": 20,
    },
    "§8.2 K6 Zone IV/V": {
        "vertical_bars":     "16mm @ 150mm c/c",
        "horizontal_bars":   "12mm @ 250mm c/c",
        "concrete_grade":    "M30",
        "cover_external_mm": 30,
        "cover_internal_mm": 25,
    },
    "§8.2 K8": {
        "vertical_bars":     "16mm-20mm @ 150mm c/c",
        "horizontal_bars":   "12mm-16mm @ 200mm c/c",
        "concrete_grade":    "M30",
        "cover_external_mm": 30,
        "cover_internal_mm": 25,
    },
    "§8.2 K8 basement": {
        "vertical_bars":     "16mm-20mm @ 150mm c/c",
        "horizontal_bars":   "12mm-16mm @ 200mm c/c",
        "concrete_grade":    "M35",
        "cover_external_mm": 30,
        "cover_internal_mm": 25,
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# Bracing height classification (Field Rule Book Appendix A, Card 1)
# Pure function — used by sku_resolver.py.
# ──────────────────────────────────────────────────────────────────────────────


def classify_bracing_height(height_mm: int) -> BracingHeightClass:
    """Given a wall height in mm, return its Card 1 bracing-height band.

    Boundaries are inclusive-upper (e.g. exactly 2400mm → "le_2.4m"). Caller
    decides what to do when height > 6000mm (Card 1 doesn't cover it; emit
    warning and default to the top band).
    """
    if height_mm <= 2400:
        return "le_2.4m"
    if height_mm <= 3000:
        return "2.4_to_3.0m"
    if height_mm <= 4500:
        return "3.0_to_4.5m"
    if height_mm <= 6000:
        return "4.5_to_6.0m"
    # Above Card 1's range — caller emits warning, defaults to top band.
    return "4.5_to_6.0m"


# ──────────────────────────────────────────────────────────────────────────────
# Tolerances (validation + algorithm)
# ──────────────────────────────────────────────────────────────────────────────

EPSILON_MM: Final[float] = 1e-6
"""Floating-point tolerance for mm comparisons."""

JUNCTION_TOLERANCE_MM: Final[float] = 20.0
"""Matches parser kos_drawing_geometry.JUNCTION_TOLERANCE_MM. Two wall endpoints within
this distance are treated as meeting at the same junction."""

ANGLE_COLLINEAR_TOL_DEG: Final[float] = 3.0
"""Matches parser THICKNESS_ANGLE_TOL_DEG. Two walls within this angular delta are
treated as collinear (same wall direction)."""

C1_LENGTH_TOLERANCE_MM: Final[float] = 50.0
"""Soft tolerance for validation invariant C-1 (panel widths sum ≈ segment length).
Absorbs joint-engagement residuals up to 50mm or 2% of length, whichever is larger."""

C1_LENGTH_TOLERANCE_FRACTION: Final[float] = 0.02
"""Relative tolerance for C-1 (used as max(absolute, relative))."""

SPLITTER_RESIDUAL_DROP_THRESHOLD_MM: Final[float] = 50.0
"""Residual ≤ this is dropped (absorbed by joint engagement)."""

SPLITTER_RESIDUAL_INFILL_THRESHOLD_MM: Final[float] = 250.0
"""Residual in (drop, infill] gets one narrow CTC infill panel.
Residual > infill triggers an additional standard 300mm panel."""

MIN_KALZEN_CURVE_RADIUS_MM: Final[float] = 600.0
"""ASSUMPTION-A18 — minimum curve radius for straight-panel approximation.
Used by curve_handler (PR 5). Curves below this threshold get flagged for
CUSTOM curved SKU rather than approximated with straights. See DESIGN.md §6.9.

🟡 PENDING-KARTHIK: the 600mm threshold is an engineering inference; Vamshi has
zero curves so Karthik hasn't confirmed. Conservative default."""

# ──────────────────────────────────────────────────────────────────────────────
# Defaults (POLICY-DEFAULT-CONFIG)
# ──────────────────────────────────────────────────────────────────────────────

DEFAULT_SEISMIC_ZONE: Final[SeismicZone] = "III"
"""Per DESIGN §10 POLICY-DEFAULT-CONFIG. Covers most Indian urban regions."""

DEFAULT_WALL_HEIGHT_MM: Final[int] = 3000
"""Vamshi convention. Most floor-to-ceiling residential walls in India."""

DEFAULT_SPLIT_STRATEGY: Final[SplitStrategy] = "minimize_cuts"
"""POLICY-DEFAULT-STRATEGY-B from DESIGN §10. Justified by stockability + site-fit risk."""

DEFAULT_RUNNING_BOND_OFFSET_MM: Final[int] = 150
"""Half-panel offset between consecutive lifts. Multi-row stagger rule
(ASSUMPTION-A19)."""

# ──────────────────────────────────────────────────────────────────────────────
# FUTURE-HOOK constants (currently inactive; flip when Karthik confirms)
# These exist so future enhancements don't require schema or architecture changes.
# ──────────────────────────────────────────────────────────────────────────────

# FUTURE-HOOK: when Karthik confirms interlock geometry, set non-zero overlap mm.
# The splitter automatically re-derives panel counts to absorb the overlap.
JOINT_OVERLAP_MM: Final[int] = 0
"""See DESIGN.md §9 PENDING-KARTHIK item: interlock geometry. Currently 0 (canonical
mapper produces theoretical 300mm-per-panel widths)."""

# FUTURE-HOOK: when Karthik confirms a multi-width catalog (e.g. [200, 300, 600]),
# replace this scalar with a tuple and Strategy A automatically picks from the catalog.
STANDARD_PANEL_WIDTHS_MM: Final[tuple[int, ...]] = (STANDARD_PANEL_WIDTH_MM,)
"""Single-width catalog today. Tuple form so future expansion is one-line."""

# FUTURE-HOOK: when parser slice 5C-3 (PARSER-ENH-1) lands with opening extraction,
# orchestrator flips this to True. Opening handler then layouts opening frames per
# DESIGN §6.8.
PARSER_OPENINGS_AVAILABLE: Final[bool] = False
"""See DESIGN.md §9 PENDING item. Today the parser doesn't extract openings; mapper
emits all-solid panel layouts. When True, opening_handler.layout_opening_frame()
becomes active in the orchestrator."""
