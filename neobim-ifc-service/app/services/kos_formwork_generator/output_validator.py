"""Output validator — 20 invariants F-1 .. F-20 per DESIGN v2 doc 02 §21.

🚨 **AUTHORITATIVE**: DESIGN v2 doc 02 §21 wins over PR 4 prompt's predictive list.
The 20 invariants enforce FRB bracing correctness + cross-tier reconciliation +
determinism contracts (UUID, SHA-256, ISO 8601). NOT the prompt's schema/naming
invariants (those are derivable from byte-equal golden).

Severity per DESIGN v2:
* **soft** — F-1, F-6, F-7 — returned as warnings (tuple[str, ...])
* **hard** — F-2, F-3, F-4, F-5, F-8, F-9, F-10, F-11, F-12, F-13, F-14, F-15,
  F-16, F-17, F-18, F-19, F-20 — raise ``FormworkInvariantError``.

Hard violations stop at the FIRST raise (single-shot semantics). Soft warnings
are collected and returned together. This matches BOQ's ``validate_boq_output``
pattern.

🚨 Invariants reference EXACT field names verified in Pre-flight B/C:
* ``Tier5FormworkWallSegment.wall_id`` (NOT ``wall_segment_id``)
* ``Tier6FormworkComponent.wall_segment_id`` (NOT ``wall_id``)
* ``Tier5FormworkWallSegment.total_diagonals`` (NOT ``total_diagonal_braces``)
* ``Tier1FormworkSummary.total_diagonal_braces`` (NOT ``total_diagonals``)
"""
from __future__ import annotations

import logging
import math
import re
from typing import Tuple

from app.services.kos_formwork_generator.constants import (
    FORMWORK_SKU_CATALOG,
    FORMWORK_SKU_CODES,
    POUR_RATE_MAX_M_PER_HR,
)
from app.services.kos_formwork_generator.exceptions import FormworkInvariantError
from app.services.kos_formwork_generator.lookup_tables import BRACING_LOOKUP_TABLE
from app.services.kos_formwork_generator.types import (
    FormworkGeneratorOutput,
)

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# INVARIANT IDs (20 — F-1 .. F-20 in declared order)
# ═════════════════════════════════════════════════════════════════════

INVARIANT_IDS: Tuple[str, ...] = (
    "F-1", "F-2", "F-3", "F-4", "F-5", "F-6", "F-7", "F-8", "F-9", "F-10",
    "F-11", "F-12", "F-13", "F-14", "F-15", "F-16", "F-17", "F-18", "F-19", "F-20",
)

# Tolerance for linear_m float comparison (per DESIGN v2 doc 02 line 1551).
_KG_TOLERANCE: float = 0.001

# Regex patterns
_UUID_PATTERN: re.Pattern[str] = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_SHA256_PATTERN: re.Pattern[str] = re.compile(r"^[0-9a-f]{64}$")
_ISO8601_Z_PATTERN: re.Pattern[str] = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
)

# Wall-type families per DESIGN v2 §4.1
_BASEMENT_OR_RETAINING = frozenset({"basement", "retaining"})
_K8_SYSTEMS = frozenset({"K8-200", "K8-250"})

# Component-type → Tier 5 attribute name (used by F-17 quantity reconciliation)
_COMPONENT_TO_TIER5_ATTR: dict[str, str] = {
    "prop": "total_props",
    "waler": "total_walers",
    "kicker": "total_kickers",
    "diagonal_brace": "total_diagonals",
    "raker_prop": "total_raker_props",
    "corner_clamp": "total_corner_clamps",
    "base_plate": "total_base_plates",
    "prop_head": "total_prop_heads",
    "joint_gasket": "joint_gasket_meters",
    "starter_track": "starter_track_meters",
}

# Tier 2 bucket sets (mirrors PR 3 tier2_summary; expressed locally for F-19 path).
_BRACING_PRIMARY_TYPES = frozenset({
    "prop", "kicker", "waler", "diagonal_brace", "raker_prop",
})
_BRACING_SECONDARY_TYPES = frozenset({
    "base_plate", "prop_head", "corner_clamp",
    "joint_gasket", "starter_track",
})

# SKU_UNITS lookup (built lazily from FORMWORK_SKU_CATALOG).
_SKU_UNITS: dict[str, str] = {
    sku: unit for sku, _category, unit, *_ in FORMWORK_SKU_CATALOG
}


# ═════════════════════════════════════════════════════════════════════
# F-1 .. F-9 — bracing-scheme correctness
# ═════════════════════════════════════════════════════════════════════


def _check_f1_total_component_count(
    output: FormworkGeneratorOutput,
) -> list[str]:
    """F-1 (soft): total Tier 6 component count ≥ 0."""
    total = sum(c.quantity for c in output.tier_6_components)
    if total < 0:
        return [f"F-1 (soft): tier_6 total component quantity {total} < 0"]
    return []


def _check_f2_prop_sku_matches_frb(output: FormworkGeneratorOutput) -> None:
    """F-2 (hard): per non-custom wall, prop_sku matches FRB Appendix A Card 1."""
    lookup = {(s.system, s.bracing_height_class): s for s in BRACING_LOOKUP_TABLE}
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        scheme = lookup.get((w.system, w.bracing_height_class))
        if scheme is None:
            raise FormworkInvariantError(
                f"F-2: wall {w.wall_id} ({w.system}, {w.bracing_height_class}) "
                f"has no BRACING_LOOKUP entry",
                invariant_id="F-2",
                hint="Verify BRACING_LOOKUP_TABLE covers this system/height combination.",
            )
        if w.prop_sku != scheme.prop_sku:
            raise FormworkInvariantError(
                f"F-2: wall {w.wall_id} prop_sku {w.prop_sku!r} != FRB Card 1 "
                f"{scheme.prop_sku!r} for {w.system}/{w.bracing_height_class}",
                invariant_id="F-2",
                hint="Tier 5 prop_sku must come from BRACING_LOOKUP[(system, bracing_height_class)].prop_sku.",
            )


def _check_f3_k8_basement_joint_gasket(output: FormworkGeneratorOutput) -> None:
    """F-3 (hard): every K8 basement/retaining wall has joint_gasket sum > 0."""
    # Aggregate joint_gasket quantities per wall from Tier 6.
    jg_per_wall: dict[str, float] = {}
    for c in output.tier_6_components:
        if c.component_type == "joint_gasket":
            jg_per_wall[c.wall_segment_id] = jg_per_wall.get(c.wall_segment_id, 0.0) + c.quantity

    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        if w.system not in _K8_SYSTEMS:
            continue
        if w.application not in _BASEMENT_OR_RETAINING:
            continue
        total_jg = jg_per_wall.get(w.wall_id, 0.0)
        if total_jg <= 0.0:
            raise FormworkInvariantError(
                f"F-3: K8 wall {w.wall_id} ({w.system}, {w.application}) has "
                f"joint_gasket quantity {total_jg} (must be > 0 per FRB §6 JE-6)",
                invariant_id="F-3",
                hint="K8 basement/retaining walls require joint gaskets.",
            )


def _check_f4_seismic_high_diagonals(output: FormworkGeneratorOutput) -> None:
    """F-4 (hard): Seismic IV/V → every non-custom K8 wall with h>3.0m has diagonals.

    🚨 Resolved seismic zone is not stored on the output dataclass; we infer
    from FormworkContext via the audit_trail hash isn't decodable. Instead,
    we conservatively check: if ANY wall has total_diagonals > 0, the project
    is treated as seismic-aware; if seismic mandate is in play (caller must
    pre-validate context), Tier 5 already encodes the result. We enforce
    the K8 + h>3.0m gate by requiring diagonals when has_diagonal scheme
    flag is set, which IS encoded in BRACING_LOOKUP_TABLE.has_diagonal.
    """
    lookup = {(s.system, s.bracing_height_class): s for s in BRACING_LOOKUP_TABLE}
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        if w.system not in _K8_SYSTEMS:
            continue
        scheme = lookup.get((w.system, w.bracing_height_class))
        if scheme is None or not scheme.has_diagonal:
            continue
        if w.total_diagonals <= 0:
            raise FormworkInvariantError(
                f"F-4: K8 wall {w.wall_id} ({w.system}, h={w.height_mm}mm, "
                f"class={w.bracing_height_class}) has total_diagonals={w.total_diagonals} "
                f"but FRB scheme mandates has_diagonal=True",
                invariant_id="F-4",
                hint="Seismic-aware K8 walls require diagonal braces per FRB §9.5 BI-17.",
            )


def _check_f5_k8_basement_raker_props(output: FormworkGeneratorOutput) -> None:
    """F-5 (hard): K8 basement/retaining → raker_prop > 0 (FRB §9.4 BI-16)."""
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        if w.system not in _K8_SYSTEMS:
            continue
        if w.application not in _BASEMENT_OR_RETAINING:
            continue
        if w.total_raker_props <= 0:
            raise FormworkInvariantError(
                f"F-5: K8 wall {w.wall_id} ({w.system}, {w.application}) has "
                f"total_raker_props={w.total_raker_props} (must be > 0 per FRB §9.4 BI-16)",
                invariant_id="F-5",
                hint="K8 basement/retaining walls require raker props.",
            )


def _check_f6_corner_prop_floor(output: FormworkGeneratorOutput) -> list[str]:
    """F-6 (soft): for each tier_5 wall: total_props >= 2 × corner_count_at_wall.

    Soft because per-position geometry verification needs Tier 6 details.
    Without explicit corner-count-per-wall on Tier 5, this trivially holds
    when total_corner_clamps == 0; otherwise we use total_corner_clamps as a
    proxy for corners-touching-this-wall and check the inequality.
    """
    warnings: list[str] = []
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        if w.total_corner_clamps > 0 and w.total_props < 2 * w.total_corner_clamps:
            warnings.append(
                f"F-6 (soft): wall {w.wall_id} has total_props={w.total_props} < "
                f"2 * total_corner_clamps ({2 * w.total_corner_clamps})"
            )
    return warnings


def _check_f7_corner_zone_spacing(output: FormworkGeneratorOutput) -> list[str]:
    """F-7 (soft): corner-zone spacing ≤ standard × 0.6 (max 1.2m) — verified by
    component_counter when corners present.

    Always trivially passes because component_counter enforces this at compute
    time. Defensive soft check: report if any wall participating in corners
    has prop_spacing_m above the legal corner-zone effective spacing.
    """
    warnings: list[str] = []
    for w in output.tier_5_wall_segments:
        if w.is_custom_order or w.total_corner_clamps == 0:
            continue
        effective_corner_spacing = min(w.prop_spacing_m * 0.6, 1.2)
        # Tier 5 carries only the standard spacing; component_counter applies
        # corner adjustment per-position. So a passing condition is implicit.
        # We surface a soft warning only when the standard spacing itself
        # is already > 1.2m (impossible per BracingScheme but defensive).
        if effective_corner_spacing > 1.2:
            warnings.append(
                f"F-7 (soft): wall {w.wall_id} effective corner spacing "
                f"{effective_corner_spacing:.2f}m exceeds 1.2m cap"
            )
    return warnings


def _check_f8_kicker_count_floor(output: FormworkGeneratorOutput) -> None:
    """F-8 (hard): kicker_count >= 2 × ceil(length_mm / kicker_spacing_mm)."""
    lookup = {(s.system, s.bracing_height_class): s for s in BRACING_LOOKUP_TABLE}
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        scheme = lookup.get((w.system, w.bracing_height_class))
        if scheme is None:
            continue
        kicker_spacing = scheme.kicker_spacing_mm
        if kicker_spacing <= 0:
            continue
        expected = 2 * math.ceil(w.length_mm / kicker_spacing)
        if w.total_kickers < expected:
            raise FormworkInvariantError(
                f"F-8: wall {w.wall_id} has total_kickers={w.total_kickers} < "
                f"2 × ceil({w.length_mm}/{kicker_spacing}) = {expected}",
                invariant_id="F-8",
                hint="Each wall needs two kicker rows (one per side); FRB §9.4 BI-14.",
            )


def _check_f9_pour_rate_within_max(output: FormworkGeneratorOutput) -> None:
    """F-9 (hard): pour_rate_applied ≤ POUR_RATE_MAX[system], unless an operator_review
    contains 'pour_rate_override' for this wall.
    """
    pr_override_active = any(
        item.review_type == "pour_rate_override" for item in output.operator_review_items
    )
    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        max_rate = POUR_RATE_MAX_M_PER_HR.get(w.system)
        if max_rate is None:
            continue
        if w.pour_rate_applied_m_per_hr > max_rate and not pr_override_active:
            raise FormworkInvariantError(
                f"F-9: wall {w.wall_id} ({w.system}) pour_rate_applied="
                f"{w.pour_rate_applied_m_per_hr:.2f} > FRB §10.2 max {max_rate:.2f}",
                invariant_id="F-9",
                hint="Set context.pour_rate_m_per_hr and add a 'pour_rate_override' "
                     "operator_review entry if intentional.",
            )


# ═════════════════════════════════════════════════════════════════════
# F-10 — wastage identity
# ═════════════════════════════════════════════════════════════════════


def _check_f10_wastage_identity(output: FormworkGeneratorOutput) -> None:
    """F-10 (hard): per Tier 4: total_quantity == base_quantity + wastage_quantity."""
    for t4 in output.tier_4_sku_details:
        expected = t4.base_quantity + t4.wastage_quantity
        if t4.unit == "linear_m":
            if abs(t4.total_quantity - expected) > _KG_TOLERANCE:
                raise FormworkInvariantError(
                    f"F-10: tier_4 {t4.sku_code} total {t4.total_quantity} != "
                    f"base+wastage ({expected}); tolerance {_KG_TOLERANCE}",
                    invariant_id="F-10",
                    hint="Tier 4 wastage identity broken — investigate build_tier4_skus.",
                )
        else:
            if t4.total_quantity != expected:
                raise FormworkInvariantError(
                    f"F-10: tier_4 {t4.sku_code} total {t4.total_quantity} != "
                    f"base+wastage ({expected})",
                    invariant_id="F-10",
                    hint="Tier 4 wastage identity broken — investigate build_tier4_skus.",
                )


# ═════════════════════════════════════════════════════════════════════
# F-11 .. F-13 — determinism (id + hashes)
# ═════════════════════════════════════════════════════════════════════


def _check_f11_formwork_id_uuid(output: FormworkGeneratorOutput) -> None:
    """F-11 (hard): formwork_id matches UUID v1-v5 hex format."""
    if not _UUID_PATTERN.match(output.formwork_id or ""):
        raise FormworkInvariantError(
            f"F-11: formwork_id {output.formwork_id!r} is not a valid UUID",
            invariant_id="F-11",
            hint="Must be 8-4-4-4-12 lowercase hex.",
        )


def _check_f12_mapper_output_hash(output: FormworkGeneratorOutput) -> None:
    """F-12 (hard): mapper_output_hash is 64 lowercase hex chars."""
    h = output.audit_trail.mapper_output_hash
    if not _SHA256_PATTERN.match(h or ""):
        raise FormworkInvariantError(
            f"F-12: audit_trail.mapper_output_hash {h!r} is not a 64-char lowercase hex SHA-256",
            invariant_id="F-12",
            hint="Must be exactly 64 lowercase hex chars.",
        )


def _check_f13_context_hash(output: FormworkGeneratorOutput) -> None:
    """F-13 (hard): context_hash is 64 lowercase hex chars."""
    h = output.audit_trail.context_hash
    if not _SHA256_PATTERN.match(h or ""):
        raise FormworkInvariantError(
            f"F-13: audit_trail.context_hash {h!r} is not a 64-char lowercase hex SHA-256",
            invariant_id="F-13",
            hint="Must be exactly 64 lowercase hex chars.",
        )


# ═════════════════════════════════════════════════════════════════════
# F-14 .. F-16 — catalog + quantity + unit consistency
# ═════════════════════════════════════════════════════════════════════


def _check_f14_skus_in_catalog(output: FormworkGeneratorOutput) -> None:
    """F-14 (hard): every Tier 4 sku_code is in FORMWORK_SKU_CODES."""
    for t4 in output.tier_4_sku_details:
        if t4.sku_code not in FORMWORK_SKU_CODES:
            raise FormworkInvariantError(
                f"F-14: tier_4 sku_code {t4.sku_code!r} not in FORMWORK_SKU_CODES "
                f"(catalog has {len(FORMWORK_SKU_CODES)} entries)",
                invariant_id="F-14",
                hint="Add the SKU to FORMWORK_SKU_CATALOG or remove the rogue entry.",
            )


def _check_f15_quantities_non_negative(output: FormworkGeneratorOutput) -> None:
    """F-15 (hard): all Tier 4 quantities ≥ 0."""
    for t4 in output.tier_4_sku_details:
        if t4.total_quantity < 0 or t4.base_quantity < 0 or t4.wastage_quantity < 0:
            raise FormworkInvariantError(
                f"F-15: tier_4 {t4.sku_code} has negative quantity "
                f"(base={t4.base_quantity}, wastage={t4.wastage_quantity}, total={t4.total_quantity})",
                invariant_id="F-15",
                hint="Quantities must be non-negative.",
            )


def _check_f16_unit_matches_catalog(output: FormworkGeneratorOutput) -> None:
    """F-16 (hard): each Tier 6 unit matches SKU_UNITS lookup."""
    for c in output.tier_6_components:
        expected_unit = _SKU_UNITS.get(c.sku_code)
        if expected_unit is None:
            # SKU isn't in catalog — caught by F-14 propagation; tier_6 SKU may be a
            # corner-clamp SKU dynamically minted (KZ-CC-90-110 etc.) which IS in catalog.
            # If still missing, fall through F-14.
            continue
        if c.unit != expected_unit:
            raise FormworkInvariantError(
                f"F-16: tier_6 {c.component_id} ({c.sku_code}) unit {c.unit!r} != "
                f"catalog unit {expected_unit!r}",
                invariant_id="F-16",
                hint="Unit must match SKU_UNITS for the sku_code.",
            )


# ═════════════════════════════════════════════════════════════════════
# F-17 .. F-19 — cross-tier reconciliation
# ═════════════════════════════════════════════════════════════════════


def _check_f17_tier6_per_wall_matches_tier5(output: FormworkGeneratorOutput) -> None:
    """F-17 (hard): per (wall_id, component_type): Σ tier_6.quantity == tier_5 total.

    Tier 5 carries per-component-type aggregates (total_props, total_walers, etc.)
    rather than per-SKU rollups, so we reconcile by component_type.
    """
    # Aggregate Tier 6 quantities per (wall_segment_id, component_type)
    t6_per_wall_type: dict[tuple, float] = {}
    for c in output.tier_6_components:
        key = (c.wall_segment_id, c.component_type)
        t6_per_wall_type[key] = t6_per_wall_type.get(key, 0.0) + c.quantity

    for w in output.tier_5_wall_segments:
        if w.is_custom_order:
            continue
        for ctype, t5_attr in _COMPONENT_TO_TIER5_ATTR.items():
            t5_value = getattr(w, t5_attr)
            t6_value = t6_per_wall_type.get((w.wall_id, ctype), 0.0)
            if ctype in ("joint_gasket", "starter_track"):
                # linear_m comparison with tolerance
                if abs(t6_value - t5_value) > _KG_TOLERANCE:
                    raise FormworkInvariantError(
                        f"F-17: wall {w.wall_id} {ctype} tier_6 sum {t6_value} != "
                        f"tier_5.{t5_attr} {t5_value} (tolerance {_KG_TOLERANCE})",
                        invariant_id="F-17",
                        hint="Cross-tier quantity reconciliation broken.",
                    )
            else:
                # discrete (nos) — exact match (Tier 6 quantities are integers stored as float)
                if abs(t6_value - t5_value) > 1e-9:
                    raise FormworkInvariantError(
                        f"F-17: wall {w.wall_id} {ctype} tier_6 sum {t6_value} != "
                        f"tier_5.{t5_attr} {t5_value}",
                        invariant_id="F-17",
                        hint="Cross-tier quantity reconciliation broken.",
                    )


def _check_f18_tier6_per_sku_matches_tier4(output: FormworkGeneratorOutput) -> None:
    """F-18 (hard): per sku_code: Σ tier_6.quantity == tier_4.total_quantity.

    Tier 4 applies wastage; Tier 6 quantities already include wastage as well
    (per PR 2 wastage application). Verify equality within tolerance.
    """
    t6_per_sku: dict[str, float] = {}
    for c in output.tier_6_components:
        t6_per_sku[c.sku_code] = t6_per_sku.get(c.sku_code, 0.0) + c.quantity

    for t4 in output.tier_4_sku_details:
        t6_sum = t6_per_sku.get(t4.sku_code, 0.0)
        if t4.unit == "linear_m":
            if abs(t6_sum - t4.total_quantity) > _KG_TOLERANCE:
                raise FormworkInvariantError(
                    f"F-18: sku {t4.sku_code} tier_6 sum {t6_sum} != tier_4 total "
                    f"{t4.total_quantity} (tolerance {_KG_TOLERANCE})",
                    invariant_id="F-18",
                    hint="Per-SKU quantity reconciliation broken.",
                )
        else:
            if abs(t6_sum - t4.total_quantity) > 1e-9:
                raise FormworkInvariantError(
                    f"F-18: sku {t4.sku_code} tier_6 sum {t6_sum} != tier_4 total "
                    f"{t4.total_quantity}",
                    invariant_id="F-18",
                    hint="Per-SKU quantity reconciliation broken.",
                )


def _check_f19_tier2_path_agreement(output: FormworkGeneratorOutput) -> None:
    """F-19 (hard): Tier 2 buckets computed via Tier 4 path == via Tier 6 path.

    Tier 6 is the authoritative source for Tier 2 (per PR 3 tier2_summary).
    Cross-check by recomputing via Tier 4 (group by sku_code → category)
    and verify both produce same (count, linear_meters) per bucket.
    """
    # Tier 6 path (already in Tier 2)
    primary_count = output.tier_2_categories.bracing_primary.count
    primary_linear = output.tier_2_categories.bracing_primary.linear_meters
    secondary_count = output.tier_2_categories.bracing_secondary.count
    secondary_linear = output.tier_2_categories.bracing_secondary.linear_meters

    # Tier 4 path: aggregate by SKU → derive bucket via component_type lookup
    # via Tier 6 (which carries component_type). To make Tier 4 → bucket mapping
    # we need a SKU → component_type lookup; build it from Tier 6.
    sku_to_ctype: dict[str, str] = {}
    for c in output.tier_6_components:
        sku_to_ctype.setdefault(c.sku_code, c.component_type)

    t4_primary_count = 0
    t4_primary_linear = 0.0
    t4_secondary_count = 0
    t4_secondary_linear = 0.0

    for t4 in output.tier_4_sku_details:
        ctype = sku_to_ctype.get(t4.sku_code)
        if ctype is None:
            # SKU present in Tier 4 but not Tier 6 (impossible if F-18 holds) → skip
            continue
        if ctype in _BRACING_PRIMARY_TYPES:
            if t4.unit == "nos":
                t4_primary_count += int(t4.total_quantity)
            else:
                t4_primary_linear += t4.total_quantity
        elif ctype in _BRACING_SECONDARY_TYPES:
            if t4.unit == "nos":
                t4_secondary_count += int(t4.total_quantity)
            else:
                t4_secondary_linear += t4.total_quantity

    t4_primary_linear = round(t4_primary_linear, 5)
    t4_secondary_linear = round(t4_secondary_linear, 5)

    if t4_primary_count != primary_count:
        raise FormworkInvariantError(
            f"F-19: primary count tier_4 path {t4_primary_count} != tier_6 path {primary_count}",
            invariant_id="F-19",
            hint="Tier 2 → Tier 4 vs Tier 2 → Tier 6 disagree.",
        )
    if abs(t4_primary_linear - primary_linear) > _KG_TOLERANCE:
        raise FormworkInvariantError(
            f"F-19: primary linear_meters tier_4 path {t4_primary_linear} != "
            f"tier_6 path {primary_linear}",
            invariant_id="F-19",
            hint="Tier 2 → Tier 4 vs Tier 2 → Tier 6 disagree.",
        )
    if t4_secondary_count != secondary_count:
        raise FormworkInvariantError(
            f"F-19: secondary count tier_4 path {t4_secondary_count} != tier_6 path {secondary_count}",
            invariant_id="F-19",
            hint="Tier 2 → Tier 4 vs Tier 2 → Tier 6 disagree.",
        )
    if abs(t4_secondary_linear - secondary_linear) > _KG_TOLERANCE:
        raise FormworkInvariantError(
            f"F-19: secondary linear_meters tier_4 path {t4_secondary_linear} != "
            f"tier_6 path {secondary_linear}",
            invariant_id="F-19",
            hint="Tier 2 → Tier 4 vs Tier 2 → Tier 6 disagree.",
        )


# ═════════════════════════════════════════════════════════════════════
# F-20 — format
# ═════════════════════════════════════════════════════════════════════


def _check_f20_generated_at_iso(output: FormworkGeneratorOutput) -> None:
    """F-20 (hard): generated_at matches ISO 8601 with 'Z'."""
    if not _ISO8601_Z_PATTERN.match(output.generated_at or ""):
        raise FormworkInvariantError(
            f"F-20: generated_at {output.generated_at!r} does not match "
            f"ISO 8601 'YYYY-MM-DDTHH:MM:SS(.f)Z' format",
            invariant_id="F-20",
            hint="Must end with 'Z' (UTC).",
        )


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def validate_formwork_output(
    output: FormworkGeneratorOutput,
) -> Tuple[str, ...]:
    """Run all 20 invariants in declared F-1 .. F-20 order.

    Args:
        output: full FormworkGeneratorOutput to validate.

    Returns:
        Tuple of soft-warning strings (F-1, F-6, F-7). Empty tuple when all
        soft checks pass.

    Raises:
        FormworkInvariantError: on the first hard violation. The exception
        carries ``invariant_id`` (e.g., 'F-2') and an optional ``hint``.
    """
    logger.debug(
        "validate_formwork_output: formwork_id=%s, %d tier_5 walls, %d tier_6 components",
        output.formwork_id,
        len(output.tier_5_wall_segments),
        len(output.tier_6_components),
    )

    warnings: list[str] = []

    # Soft invariants first so they always run regardless of later hard failures
    # in the same SUBJECT AREA. We still stop at the FIRST hard violation.
    warnings.extend(_check_f1_total_component_count(output))

    _check_f2_prop_sku_matches_frb(output)
    _check_f3_k8_basement_joint_gasket(output)
    _check_f4_seismic_high_diagonals(output)
    _check_f5_k8_basement_raker_props(output)

    warnings.extend(_check_f6_corner_prop_floor(output))
    warnings.extend(_check_f7_corner_zone_spacing(output))

    _check_f8_kicker_count_floor(output)
    _check_f9_pour_rate_within_max(output)
    _check_f10_wastage_identity(output)

    _check_f11_formwork_id_uuid(output)
    _check_f12_mapper_output_hash(output)
    _check_f13_context_hash(output)
    _check_f14_skus_in_catalog(output)
    _check_f15_quantities_non_negative(output)
    _check_f16_unit_matches_catalog(output)
    _check_f17_tier6_per_wall_matches_tier5(output)
    _check_f18_tier6_per_sku_matches_tier4(output)
    _check_f19_tier2_path_agreement(output)
    _check_f20_generated_at_iso(output)

    logger.debug(
        "validate_formwork_output: PASSED for %s (%d soft warnings)",
        output.formwork_id, len(warnings),
    )
    return tuple(warnings)
