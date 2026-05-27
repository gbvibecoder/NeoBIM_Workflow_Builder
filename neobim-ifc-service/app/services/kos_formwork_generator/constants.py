"""Constants for KOS Formwork Quantities Generator.

NO pricing constants (bracing on lease per Karthik 2026-05-26 — Decision 15).
NO weight constants. NO tax/discount/currency. NO Indian-comma formatter.

Reference: 5F-DESIGN v2 doc 00_CONTEXT_CONFIRMED.md §5 + doc 01_SCHEMA.md §7.

SKU catalog count: 33 entries (30 confirmed + 3 placeholder).

🚨 **Internal inconsistency in DESIGN v2:** prose claims "34 SKUs" but the
authoritative ``SKU_CATALOG_ORDER`` declaration in DESIGN v2 §7 lists 33
entries. Implementation follows the structural declaration (33). Surfaced
in Pre-flight A + PR1_REPORT.md §discoveries.
"""
from __future__ import annotations

import logging
import uuid
from types import MappingProxyType
from typing import Final, Mapping, Tuple

from app.services.kos_formwork_generator.types import FormworkCategory

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# VERSION CONSTANTS
# ═════════════════════════════════════════════════════════════════════

#: Output schema version (semver). Read into ``FormworkGeneratorOutput.schema_version``.
FORMWORK_SCHEMA_VERSION: Final[str] = "0.1.0"

#: 5F generator algorithm version. Read into ``FormworkAuditTrail.formwork_calculation_version``.
FORMWORK_CALCULATION_VERSION: Final[str] = "v0.1.0"

#: FRB version stamp. Read into ``FormworkAuditTrail.field_rule_book_version``.
FIELD_RULE_BOOK_VERSION: Final[str] = "KZ-FIELD-RB-001 v1.0 (2026-05-23)"


# ═════════════════════════════════════════════════════════════════════
# UUID NAMESPACE
#
# 5F uses a distinct namespace from BOQ. Same ``deterministic_id_seed``
# produces different UUID for BOQ vs Formwork — intentional separation so
# that BOQ and Formwork outputs for the same project never collide on ID.
# BOQ namespace: a5b8c2d1-4e6f-7890-1234-567890abcdef
# ═════════════════════════════════════════════════════════════════════

_FORMWORK_UUID_NAMESPACE: Final[uuid.UUID] = uuid.UUID(
    "b6c9d3e2-5f70-8901-2345-678901abcdef"
)


# ═════════════════════════════════════════════════════════════════════
# CONTEXT DEFAULTS
# ═════════════════════════════════════════════════════════════════════

WASTAGE_PERCENT_DEFAULT: Final[float] = 5.0  # FRB §2.1 item 5
SEISMIC_ZONE_DEFAULT: Final[str] = "III"     # Pune default per DESIGN v2 doc 00 §8


# ═════════════════════════════════════════════════════════════════════
# SKU CATALOG (33 entries — per DESIGN v2 SKU_CATALOG_ORDER structural declaration)
#
# Each entry: (sku_code, category, unit, description, frb_section)
# NO weight_kg, NO price_inr columns (bracing on lease).
# ═════════════════════════════════════════════════════════════════════

FORMWORK_SKU_CATALOG: Final[Tuple[Tuple[str, FormworkCategory, str, str, str], ...]] = (
    # ─── Props — 4 SKUs (FRB §9.1 RULE BI-1) ───
    ("KZ-PROP-L",  "props", "nos", "Light-duty prop (yellow label, K4/K6 ≤3.0m)",        "FRB §9.1 RULE BI-1"),
    ("KZ-PROP-M",  "props", "nos", "Medium prop (blue label, K6 3.0-4.5m / K8 ≤3.0m)",   "FRB §9.1 RULE BI-1"),
    ("KZ-PROP-H",  "props", "nos", "Heavy prop (green label, K8 3.0-6.0m)",              "FRB §9.1 RULE BI-1"),
    ("KZ-PROP-XH", "props", "nos", "Extra-heavy prop (red label, K8-250 4.5-6.0m)",      "FRB §9.1 RULE BI-1"),

    # ─── Waler clamps — 5 SKUs (FRB §9.2 RULE BI-11, torque 25 Nm) ───
    ("KZ-WC-110", "walers", "nos", "Waler clamp 110mm (K4-110)",   "FRB §9.2 RULE BI-11"),
    ("KZ-WC-150", "walers", "nos", "Waler clamp 150mm (K6-150)",   "FRB §9.2 RULE BI-11"),
    ("KZ-WC-180", "walers", "nos", "Waler clamp 180mm (K6-180)",   "FRB §9.2 RULE BI-11"),
    ("KZ-WC-200", "walers", "nos", "Waler clamp 200mm (K8-200)",   "FRB §9.2 RULE BI-11"),
    ("KZ-WC-250", "walers", "nos", "Waler clamp 250mm (K8-250)",   "FRB §9.2 RULE BI-11"),

    # ─── Kickers — 2 SKUs (FRB §9.4 RULE BI-14) ───
    ("KZ-KICK-01", "kickers", "nos", "Kicker (timber, K4 600mm / K6 600/400mm)", "FRB §9.4 RULE BI-14"),
    ("KZ-KICK-02", "kickers", "nos", "Kicker (steel angle, K8 400mm)",            "FRB §9.4 RULE BI-14"),

    # ─── Diagonal brace — 1 SKU (FRB §9.5 RULE BI-18) ───
    ("KZ-DB-01", "diagonal_braces", "nos", "Diagonal brace tube Ø48mm adjustable 1.5-2.5m", "FRB §9.5 RULE BI-18"),

    # ─── Placeholder SKUs (pending Karthik / engineer confirmation) ───
    ("KZ-RAKER-01", "raker_props",      "nos", "Raker prop (placeholder pending Karthik) — FRB §9.4 BI-16 has no SKU", "FRB §9.4 RULE BI-16"),
    ("KZ-TURN-01",  "misc",             "nos", "Turnbuckle (placeholder pending engineer applicability)",              "FRB inferred (Pre-flight A)"),
    ("KZ-ALIGN-01", "alignment_braces", "nos", "Alignment brace (placeholder pending engineer applicability)",         "FRB inferred (Pre-flight A)"),

    # ─── Corner clamps 90° — 5 SKUs (FRB §7.2, torque 30 Nm) ───
    ("KZ-CC-90-110", "corner_clamps", "nos", "Corner clamp 90° K4-110 (yellow, 30 Nm)", "FRB §7.2"),
    ("KZ-CC-90-150", "corner_clamps", "nos", "Corner clamp 90° K6-150 (blue, 30 Nm)",   "FRB §7.2"),
    ("KZ-CC-90-180", "corner_clamps", "nos", "Corner clamp 90° K6-180 (green, 30 Nm)",  "FRB §7.2"),
    ("KZ-CC-90-200", "corner_clamps", "nos", "Corner clamp 90° K8-200 (orange, 30 Nm)", "FRB §7.2"),
    ("KZ-CC-90-250", "corner_clamps", "nos", "Corner clamp 90° K8-250 (red, 30 Nm)",    "FRB §7.2"),

    # ─── Corner clamps 135° — 2 SKUs (only K6-150 + K8-200 supported) ───
    ("KZ-CC-135-150", "corner_clamps", "nos", "Corner clamp 135° K6-150 (blue+yellow stripe, 30 Nm)",  "FRB §7.2"),
    ("KZ-CC-135-200", "corner_clamps", "nos", "Corner clamp 135° K8-200 (orange+yellow stripe, 30 Nm)", "FRB §7.2"),

    # ─── Corner clamps T-junction — 3 SKUs (35 Nm torque) ───
    ("KZ-CC-T-150", "corner_clamps", "nos", "Corner clamp T-junction K6-150 (blue+white dot, 35 Nm)",  "FRB §7.2"),
    ("KZ-CC-T-200", "corner_clamps", "nos", "Corner clamp T-junction K8-200 (orange+white dot, 35 Nm)", "FRB §7.2"),
    ("KZ-CC-T-250", "corner_clamps", "nos", "Corner clamp T-junction K8-250 (red+white dot, 35 Nm)",    "FRB §7.2"),

    # ─── Base plate + Prop head (1 each; hard-surface assumption) ───
    ("KZ-BP-01", "base_plates", "nos", "Base plate (steel, 1 per prop on hard surface)", "FRB §9.1 RULE BI-5"),
    ("KZ-PH-01", "prop_heads",  "nos", "Prop head adapter (1 per prop)",                  "FRB §9.1 RULE BI-6"),

    # ─── Joint gasket — 1 SKU (linear_m; K8 + basement per FRB §6 JE-6) ───
    ("KZ-JG-01", "joint_gaskets", "linear_m", "Joint gasket (K8 + basement walls; provisional formula)", "FRB §6 RULE JE-6"),

    # ─── Starter tracks — 5 SKUs (linear_m, one per thickness) ───
    ("KZ-TRACK-110", "starter_tracks", "linear_m", "Starter track 110mm", "FRB §2.1 item 4"),
    ("KZ-TRACK-150", "starter_tracks", "linear_m", "Starter track 150mm", "FRB §2.1 item 4"),
    ("KZ-TRACK-180", "starter_tracks", "linear_m", "Starter track 180mm", "FRB §2.1 item 4"),
    ("KZ-TRACK-200", "starter_tracks", "linear_m", "Starter track 200mm", "FRB §2.1 item 4"),
    ("KZ-TRACK-250", "starter_tracks", "linear_m", "Starter track 250mm", "FRB §2.1 item 4"),
)


#: Frozenset of all SKU codes for O(1) membership tests.
FORMWORK_SKU_CODES: Final[frozenset[str]] = frozenset(
    sku_entry[0] for sku_entry in FORMWORK_SKU_CATALOG
)


# ═════════════════════════════════════════════════════════════════════
# SKU LOOKUP HELPERS (immutable mappings inlined from former formatters.py)
# Per DESIGN v2 doc 03 §3.3, SKU description / prefix / thickness lookups
# live in constants.py (no separate formatters module).
# ═════════════════════════════════════════════════════════════════════

#: SKU code → description (for Tier4SKUDetail.description).
SKU_DESCRIPTION: Final[Mapping[str, str]] = MappingProxyType({
    entry[0]: entry[3] for entry in FORMWORK_SKU_CATALOG
})

#: SKU code → unit (for Tier4SKUDetail.unit + Tier6FormworkComponent.unit).
SKU_UNIT: Final[Mapping[str, str]] = MappingProxyType({
    entry[0]: entry[2] for entry in FORMWORK_SKU_CATALOG
})

#: SKU code → category (for Tier2FormworkCategories rollup).
SKU_CATEGORY: Final[Mapping[str, FormworkCategory]] = MappingProxyType({
    entry[0]: entry[1] for entry in FORMWORK_SKU_CATALOG
})

#: SKU code → FRB citation (for Tier6FormworkComponent.source_rule).
SKU_FRB_SOURCE: Final[Mapping[str, str]] = MappingProxyType({
    entry[0]: entry[4] for entry in FORMWORK_SKU_CATALOG
})


# ═════════════════════════════════════════════════════════════════════
# PENDING KARTHIK (4 items per Decision 11 v2 — verbatim from DESIGN v2 §16)
# ═════════════════════════════════════════════════════════════════════

PENDING_KARTHIK_DEFAULT: Final[Tuple[str, ...]] = (
    "Joint gasket formula '(panel_count - 1) × wall_height' provisional; Karthik confirms during PR 1",
    "Missing SKU codes: raker prop (KZ-RAKER-01 placeholder), turnbuckle, alignment brace — engineer confirms applicability",
    "Vamshi reference project (DWG + reference Formwork Quantities sheet) — for Phase 5H E2E validation",
    "Formwork Quantities format example — Karthik confirmed quantity-only structure; format optional pending visual reference",
)


# ═════════════════════════════════════════════════════════════════════
# POUR RATE DEFAULTS (FRB §10.2) — used by PR 2+ algorithms (Problem 14)
#
# 🚨 PR 1 ships these as documentation/baseline. Per FRB §10.2 the values
# depend on (system, height_m, is_basement); pour rate <3m wall vs >3m wall
# differs for K6/K8. PR 2's component_counter will use a smarter lookup.
# For PR 1's golden hash to remain stable, the simple per-system defaults
# below are sufficient (P_INT_8 doesn't override).
# ═════════════════════════════════════════════════════════════════════

POUR_RATE_DEFAULTS_M_PER_HR: Final[Mapping[str, float]] = MappingProxyType({
    "K4-110": 3.0,
    "K6-150": 3.0,
    "K6-180": 3.0,
    "K8-200": 2.0,
    "K8-250": 2.0,
})

POUR_RATE_MAX_M_PER_HR: Final[Mapping[str, float]] = MappingProxyType({
    "K4-110": 3.0,
    "K6-150": 3.0,
    "K6-180": 3.0,
    "K8-200": 2.0,
    "K8-250": 2.0,
})


# ═════════════════════════════════════════════════════════════════════
# ASSUMPTIONS (always emitted in output.assumptions_made)
# ═════════════════════════════════════════════════════════════════════

ASSUMPTIONS_MADE_DEFAULT: Final[Tuple[str, ...]] = (
    "POLICY-FORMWORK-AUDIT-TRAIL",
    "POLICY-FORMWORK-WASTE-5PCT",
    "POLICY-FORMWORK-GASKET-LINEAR-METER-PROVISIONAL",
    "POLICY-FORMWORK-STARTER-TRACK-ONE-PER-WALL-PROVISIONAL",
    "POLICY-FORMWORK-QUANTITY-ONLY-PER-KARTHIK-2026-05-26",
)


# ═════════════════════════════════════════════════════════════════════
# PIPELINE VERSIONS (for FormworkAuditTrail.pipeline_versions)
# Tuple of (component, version) pairs — sorted alphabetically by component.
# ═════════════════════════════════════════════════════════════════════

PIPELINE_VERSIONS_DEFAULT: Final[Tuple[Tuple[str, str], ...]] = (
    ("field_rule_book", FIELD_RULE_BOOK_VERSION),
    ("formwork",        FORMWORK_CALCULATION_VERSION),
    ("mapper",          "v1.0"),
)


# ═════════════════════════════════════════════════════════════════════
# MODULE-LOAD VALIDATION (fail-fast on malformed catalog)
# ═════════════════════════════════════════════════════════════════════


def _validate_sku_catalog() -> None:
    """Validate FORMWORK_SKU_CATALOG integrity at module-load time.

    Raises:
        RuntimeError: if catalog has malformed entry, duplicate code,
                      invalid unit, missing FRB citation, or invalid category.

    Notes:
        Fires at import — broken catalog fails loudly, not silently.
        Runtime exceptions at module load are intentional (programmer error).
    """
    valid_units = frozenset({"nos", "linear_m"})
    valid_categories = frozenset({
        "props", "walers", "kickers", "diagonal_braces", "raker_props",
        "corner_clamps", "base_plates", "prop_heads", "joint_gaskets",
        "starter_tracks", "alignment_braces", "misc", "custom_quotes",
    })
    seen_codes: set[str] = set()

    for i, entry in enumerate(FORMWORK_SKU_CATALOG):
        if not isinstance(entry, tuple) or len(entry) != 5:
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {i} malformed: expected 5-tuple, got {entry!r}"
            )
        code, category, unit, description, frb = entry
        if not isinstance(code, str) or not code.startswith("KZ-"):
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {i}: code {code!r} must start with 'KZ-'"
            )
        if code in seen_codes:
            raise RuntimeError(f"FORMWORK_SKU_CATALOG duplicate code: {code}")
        seen_codes.add(code)
        if category not in valid_categories:
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {code}: invalid category {category!r} "
                f"(must be one of {sorted(valid_categories)})"
            )
        if unit not in valid_units:
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {code}: invalid unit {unit!r} "
                f"(must be 'nos' or 'linear_m')"
            )
        if not isinstance(description, str) or not description.strip():
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {code}: description empty or non-string"
            )
        if not isinstance(frb, str) or not frb.startswith("FRB"):
            raise RuntimeError(
                f"FORMWORK_SKU_CATALOG entry {code}: missing FRB citation (got {frb!r})"
            )


_validate_sku_catalog()


logger.info(
    "5F constants loaded: %d SKUs, schema_version=%s, calculation_version=%s, frb_version=%s, %d pending_karthik items",
    len(FORMWORK_SKU_CATALOG),
    FORMWORK_SCHEMA_VERSION,
    FORMWORK_CALCULATION_VERSION,
    FIELD_RULE_BOOK_VERSION,
    len(PENDING_KARTHIK_DEFAULT),
)
