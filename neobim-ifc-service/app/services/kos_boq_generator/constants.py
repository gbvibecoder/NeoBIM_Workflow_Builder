"""BOQ Generator constants — single source of truth.

Categories:
1. Re-exports from mapper (single source of truth for Karthik-locked values)
2. BOQ-specific commercial defaults (tax, discount, terms — Karthik 2026-05-25)
3. Format/tolerance constants (used by PRs 2-6)
4. Limits for input validation (used by PR 5 orchestrator and PR 6 router)
5. Tier prefix groupings (Tier 2 / Tier 3 ordering rules)
6. UUID5 namespace for deterministic boq_id (FROZEN FOR LIFE)
7. Runtime re-export integrity check

NEVER redefine mapper constants here. If a value originates in
``kos_panel_grid_mapper.constants``, re-export it (use ``import X as Y`` if a
BOQ-friendly alias is desired). This ensures Karthik pricing updates in the
mapper propagate to BOQ without manual sync.

To verify re-export integrity, see ``test_re_exports_are_identity_not_copy`` in
``test_constants.py`` — it uses ``is`` not ``==`` (anti-pattern #6).

BOQ_SCHEMA_VERSION uses MAJOR.MINOR.PATCH semver:

    PATCH bump (0.1.0 → 0.1.1): bug fixes, no schema change.
    MINOR bump (0.1.0 → 0.2.0): backward-compatible field ADDITIONS only
                                (new optional fields with defaults).
    MAJOR bump (0.1.0 → 1.0.0): breaking changes — field removal, type change,
                                rename, required-field addition.

When ``BOQ_SCHEMA_VERSION`` bumps, ``BOQ_CALCULATION_VERSION`` may also bump if
algorithms changed. They are INDEPENDENT — schema can change without algo
change and vice versa.
"""

from __future__ import annotations

import uuid
from typing import Final

# ──────────────────────────────────────────────────────────────────────────────
# Section 1: Re-exports from mapper
#
# Mapper's actual names (verified via in-process introspection 2026-05-25):
#   KG_PER_SFT        — dict[int, float] of kg/sft per thickness
#   PRICE_PER_SFT_INR — int, the flat ₹225/sft Karthik price
#   MM2_PER_SFT       — float, the IEEE-754-pinned 92903.04 conversion constant
#
# We re-export under BOQ-friendly aliases via ``import X as Y``. This is
# aliasing, NOT redefinition — the underlying object identity is preserved,
# so the ``is`` identity checks in test_constants.py pass cleanly.
# ──────────────────────────────────────────────────────────────────────────────

from app.services.kos_panel_grid_mapper.constants import (  # noqa: F401
    KG_PER_SFT as KG_PER_SFT_BY_THICKNESS,
    MM2_PER_SFT,
    PRICE_PER_SFT_INR as PANEL_PRICE_INR_PER_SFT,
    # PR 3 (Scenario B per §3.9 decision tree, pre-flight A 2026-05-25 confirmed):
    # mapper exposes SKIN_FRACTION + RIB_FRACTION; re-export under BOQ-friendly
    # *_WEIGHT_FRACTION aliases. Aliasing preserves object identity (verified by
    # `is` check in test_constants.py). Source: ASSUMPTION-BOQ-15 (Karthik
    # 60/40 skin/rib split).
    SKIN_FRACTION as SKIN_WEIGHT_FRACTION,
    RIB_FRACTION as RIB_WEIGHT_FRACTION,
)

# ──────────────────────────────────────────────────────────────────────────────
# Section 2: BOQ-specific commercial defaults — Karthik 2026-05-25 confirmed
# via "proceed with documented defaults" message.
# ──────────────────────────────────────────────────────────────────────────────

# Tax rate for construction materials (Indian GST).
# Source: Karthik 2026-05-25 — confirmed via "proceed with documented defaults".
# Industry standard: 18% GST for construction materials in India.
DEFAULT_TAX_RATE_PERCENT: Final[float] = 18.0

# Discount default — 0% standard; sales adds case-by-case.
# Source: Karthik 2026-05-25 — confirmed via "proceed with documented defaults".
DEFAULT_DISCOUNT_PERCENT: Final[float] = 0.0

# Quote validity in days.
# Source: Industry standard; Karthik confirmed 2026-05-25.
DEFAULT_QUOTE_VALIDITY_DAYS: Final[int] = 30

# Commercial terms.
# Source: Karthik 2026-05-25 — confirmed via "proceed with documented defaults".
DEFAULT_PAYMENT_TERMS: Final[str] = "50% advance, 50% before dispatch"
DEFAULT_DELIVERY_TERMS: Final[str] = "Ex-works Kalzen factory"

# Currency — v1 INR only.
# Multi-currency is a documented future hook (DESIGN.md §7.7).
DEFAULT_CURRENCY: Final[str] = "INR"
SUPPORTED_CURRENCIES: Final[frozenset[str]] = frozenset({"INR"})

# Karthik pricing version token (for audit trail).
# Bump when Karthik changes ₹225/sft flat rate or 60/40 skin/rib split.
# Source: DESIGN.md §2.2 — Karthik 2026-05-23 17:58.
KARTHIK_PRICING_VERSION: Final[str] = "v1.0: ₹225/sft flat (2026-05-23)"

# ──────────────────────────────────────────────────────────────────────────────
# Section 3: Format and tolerance constants
#
# Used by PRs 2-6 (algorithm, validator, orchestrator). PR 4 validator MUST
# import tolerances here — no magic numbers in PR 4 code (anti-pattern #13).
# Source: 01_SCHEMA.md §C (validation invariants).
# ──────────────────────────────────────────────────────────────────────────────

# Schema and calculation versioning. See semver policy in module docstring above.
BOQ_SCHEMA_VERSION: Final[str] = "0.1.0"
BOQ_CALCULATION_VERSION: Final[str] = "v1.0"

# Reconciliation tolerances (used by PR 4 validator and PR 2/3 algorithms).
# Invariants B-1, B-2, B-3, B-6 reconciliation:                        ±₹0.01
# Weight reconciliations:                                              ±0.001 kg
# Area reconciliations:                                                ±0.0001 sqft
# Exact-equality reconciliations (float roundoff):                     ±1e-9 relative
INR_TOLERANCE_RUPEES: Final[float] = 0.01
KG_TOLERANCE: Final[float] = 0.001
AREA_TOLERANCE_SQFT: Final[float] = 0.0001
RELATIVE_TOLERANCE: Final[float] = 1e-9

# Currency display precision.
INR_DISPLAY_DECIMALS: Final[int] = 2

# Quote number synthesis format (used by PR 3 tier1_summary._synth_quote_number).
# Format: ``Q-{project_id}-001-{date_compact}``
# Where date_compact = YYYYMMDD (no separators).
# Example: project_id="P_INT_8_TEST", date="2026-05-25"
#       → "Q-P_INT_8_TEST-001-20260525"
# The "001" is sequence number; v1 always uses "001". Multi-quote-version
# history is a future feature (POLICY-BOQ-VERSIONED).
QUOTE_NUMBER_TEMPLATE: Final[str] = "Q-{project_id}-001-{date_compact}"

# ──────────────────────────────────────────────────────────────────────────────
# Section 4: Input validation limits (IV-1 through IV-8)
#
# Used by PR 5 orchestrator's ``validate_input()`` and PR 6 router.
# ──────────────────────────────────────────────────────────────────────────────

MIN_DISCOUNT_PERCENT: Final[float] = 0.0
MAX_DISCOUNT_PERCENT: Final[float] = 100.0
MIN_TAX_PERCENT: Final[float] = 0.0
MAX_TAX_PERCENT: Final[float] = 100.0
MIN_QUOTE_VALIDITY_DAYS: Final[int] = 1
MAX_QUOTE_VALIDITY_DAYS: Final[int] = 365

# Custom-quote weight estimator tolerance.
# When custom thickness is within ±10% of a catalog thickness (110/155/200),
# use catalog kg/sft for weight estimate. Otherwise estimated_weight_kg = None.
# Source: ASSUMPTION-BOQ-16 in 01_SCHEMA.md.
CATALOG_THICKNESS_TOLERANCE_PERCENT: Final[float] = 10.0

# ──────────────────────────────────────────────────────────────────────────────
# Section 5: Tier prefix groupings
#
# Source: ASSUMPTION-BOQ-14 in 01_SCHEMA.md.
# Only AP counts as "standard panel" customer-facing — other prefixes
# (BT, TC, CP, CTC, ECF, ECM, JTF, JTM, PC) are accessories.
# ──────────────────────────────────────────────────────────────────────────────

TIER2_STANDARD_PANEL_PREFIXES: Final[tuple[str, ...]] = ("AP",)
TIER2_ACCESSORY_PREFIXES: Final[tuple[str, ...]] = (
    "BT", "TC", "CP", "CTC", "ECF", "ECM", "JTF", "JTM", "PC",
)

# Tier 3 canonical SKU prefix order (for deterministic sorting).
# CUSTOM appears LAST as a synthetic row when custom_quote_items is non-empty.
# Source: 02_ALGORITHMS.md §4 Problem 4.
TIER3_CANONICAL_PREFIX_ORDER: Final[tuple[str, ...]] = (
    "AP", "BT", "TC", "CP", "CTC", "ECF", "ECM", "JTF", "JTM", "PC", "CUSTOM",
)

# Human-readable descriptions used by Tier 3 ``notes`` field.
# Source: 02_ALGORITHMS.md §3 Problem 2 _describe_sku helper.
SKU_PREFIX_DESCRIPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("AP",  "vertical panel (standard stretcher)"),
    ("BT",  "bottom track (horizontal)"),
    ("TC",  "top cap (horizontal)"),
    ("CP",  "corner panel (90° external)"),
    ("CTC", "connector / corner / terminator"),
    ("ECF", "end cap female"),
    ("ECM", "end cap male"),
    ("JTF", "joint connector female (mid-run)"),
    ("JTM", "joint connector male (mid-run)"),
    ("PC",  "T-junction abutment (de-facto K4)"),
    ("CUSTOM", "custom-quote items (priced separately)"),
)

# ──────────────────────────────────────────────────────────────────────────────
# Section 6: UUID5 namespace for deterministic BOQ ID generation in golden
# tests. Used by PR 4 id_generator.
#
# FROZEN FOR LIFE — never change this UUID. Any change invalidates ALL
# deterministic UUIDs ever produced.
# Source: POLICY-BOQ-AUDIT-TRAIL + ASSUMPTION-BOQ-20.
#
# Internal cryptographic constant (anti-pattern #8: underscore prefix). Tests
# legitimately import this for golden fixture reproducibility.
# ──────────────────────────────────────────────────────────────────────────────

_BOQ_UUID_NAMESPACE: Final[uuid.UUID] = uuid.UUID(
    "a5b8c2d1-4e6f-7890-1234-567890abcdef"
)

# ──────────────────────────────────────────────────────────────────────────────
# Section 7: Re-export integrity runtime check
#
# Runs at import time. If any required mapper constant is None (shouldn't
# happen but defensive), import fails loudly. PR 5 orchestrator will translate
# any such failure to ``BOQConfigError`` at the boundary.
# ──────────────────────────────────────────────────────────────────────────────

_REQUIRED_MAPPER_CONSTANTS = (
    KG_PER_SFT_BY_THICKNESS,
    PANEL_PRICE_INR_PER_SFT,
    MM2_PER_SFT,
    SKIN_WEIGHT_FRACTION,                                              # PR 3 (Scenario B)
    RIB_WEIGHT_FRACTION,                                               # PR 3 (Scenario B)
)
assert all(c is not None for c in _REQUIRED_MAPPER_CONSTANTS), (
    "Mapper constants re-export broken — check kos_panel_grid_mapper.constants"
)
# Sanity: skin + rib should equal 1.0 (60% + 40%). Defensive check at import time.
assert SKIN_WEIGHT_FRACTION + RIB_WEIGHT_FRACTION == 1.0, (
    f"Skin + rib fractions must sum to 1.0; got "
    f"{SKIN_WEIGHT_FRACTION} + {RIB_WEIGHT_FRACTION} = "
    f"{SKIN_WEIGHT_FRACTION + RIB_WEIGHT_FRACTION}"
)
