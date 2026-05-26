"""Tests for ``app.services.kos_boq_generator.constants``.

Coverage:
* Karthik commercial defaults (tax 18%, discount 0%, validity 30, terms exact)
* Mapper re-exports verified via ``is`` identity (anti-pattern #6)
* Tolerance constants exact values
* Tier prefix groupings
* UUID5 namespace frozen for life (anti-pattern #8)
* Semver / quote-number template exact strings
* Re-export integrity assertion runs at import time
"""

from __future__ import annotations

import uuid

from app.services.kos_boq_generator import constants as boq_constants


# ──────────────────────────────────────────────────────────────────────────────
# Re-export identity tests (anti-pattern #6: use `is`, not `==`)
# ──────────────────────────────────────────────────────────────────────────────


def test_kg_per_sft_re_export_is_same_object_as_mapper() -> None:
    """BOQ must re-export mapper's KG_PER_SFT under the alias KG_PER_SFT_BY_THICKNESS.

    Uses `is` (identity) rather than `==` (equality) to catch accidental copy.
    If this fails, someone wrote ``KG_PER_SFT_BY_THICKNESS = dict(mapper.X)``
    instead of ``from mapper.constants import KG_PER_SFT as KG_PER_SFT_BY_THICKNESS``.
    """
    from app.services.kos_boq_generator.constants import KG_PER_SFT_BY_THICKNESS
    from app.services.kos_panel_grid_mapper.constants import KG_PER_SFT as MAPPER_SOURCE

    assert KG_PER_SFT_BY_THICKNESS is MAPPER_SOURCE, (
        "BOQ constants must re-export mapper constants, not copy them."
    )


def test_panel_price_re_export_is_same_object_as_mapper() -> None:
    """PANEL_PRICE_INR_PER_SFT must be aliased from mapper's PRICE_PER_SFT_INR."""
    from app.services.kos_boq_generator.constants import PANEL_PRICE_INR_PER_SFT
    from app.services.kos_panel_grid_mapper.constants import PRICE_PER_SFT_INR as MAPPER_SOURCE

    assert PANEL_PRICE_INR_PER_SFT is MAPPER_SOURCE


def test_mm2_per_sft_re_export_is_same_object_as_mapper() -> None:
    """MM2_PER_SFT must be the SAME object as mapper's MM2_PER_SFT.

    Note: floats with the same value may or may not be `is`-equal in CPython
    (small-int caching doesn't apply to floats). But module-level re-export
    via `from X import Y` does preserve identity for float literals.
    """
    from app.services.kos_boq_generator.constants import MM2_PER_SFT
    from app.services.kos_panel_grid_mapper.constants import MM2_PER_SFT as MAPPER_SOURCE

    assert MM2_PER_SFT is MAPPER_SOURCE


# ──────────────────────────────────────────────────────────────────────────────
# Karthik commercial defaults
# ──────────────────────────────────────────────────────────────────────────────


def test_default_tax_rate_is_18_percent() -> None:
    """Karthik 2026-05-25 confirmed Indian GST construction default."""
    assert boq_constants.DEFAULT_TAX_RATE_PERCENT == 18.0


def test_default_discount_is_zero() -> None:
    """Karthik 2026-05-25 confirmed default — sales adds case-by-case."""
    assert boq_constants.DEFAULT_DISCOUNT_PERCENT == 0.0


def test_default_validity_is_30_days() -> None:
    """Industry standard, Karthik confirmed 2026-05-25."""
    assert boq_constants.DEFAULT_QUOTE_VALIDITY_DAYS == 30


def test_default_payment_terms_exact() -> None:
    assert boq_constants.DEFAULT_PAYMENT_TERMS == "50% advance, 50% before dispatch"


def test_default_delivery_terms_exact() -> None:
    assert boq_constants.DEFAULT_DELIVERY_TERMS == "Ex-works Kalzen factory"


def test_default_currency_is_inr() -> None:
    assert boq_constants.DEFAULT_CURRENCY == "INR"


def test_karthik_pricing_version_exact() -> None:
    """Pricing version token for audit trail. Bump when Karthik changes ₹225/sft."""
    assert boq_constants.KARTHIK_PRICING_VERSION == "v1.0: ₹225/sft flat (2026-05-23)"


# ──────────────────────────────────────────────────────────────────────────────
# Tolerance constants
# ──────────────────────────────────────────────────────────────────────────────


def test_inr_tolerance_is_0_01() -> None:
    """Used by B-1, B-2, B-3, B-6 reconciliation invariants."""
    assert boq_constants.INR_TOLERANCE_RUPEES == 0.01


def test_kg_tolerance_is_0_001() -> None:
    """Used by weight reconciliation invariants."""
    assert boq_constants.KG_TOLERANCE == 0.001


def test_area_tolerance_is_0_0001() -> None:
    """Used by area reconciliation invariants."""
    assert boq_constants.AREA_TOLERANCE_SQFT == 0.0001


def test_relative_tolerance_is_1e_minus_9() -> None:
    """Used for exact-equality where float roundoff is acceptable."""
    assert boq_constants.RELATIVE_TOLERANCE == 1e-9


def test_inr_display_decimals_is_2() -> None:
    """Currency display precision (2 decimal places)."""
    assert boq_constants.INR_DISPLAY_DECIMALS == 2


# ──────────────────────────────────────────────────────────────────────────────
# Currency support
# ──────────────────────────────────────────────────────────────────────────────


def test_supported_currencies_inr_only() -> None:
    """v1 supports INR only. Multi-currency is documented future hook."""
    assert boq_constants.SUPPORTED_CURRENCIES == frozenset({"INR"})


def test_supported_currencies_is_frozenset() -> None:
    """Use frozenset (immutable) so it's safe as a module-level constant."""
    assert isinstance(boq_constants.SUPPORTED_CURRENCIES, frozenset)


# ──────────────────────────────────────────────────────────────────────────────
# Tier prefix groupings (ASSUMPTION-BOQ-14)
# ──────────────────────────────────────────────────────────────────────────────


def test_tier2_standard_panel_prefixes_is_ap_only() -> None:
    """Only AP counts as customer-facing 'standard panel'."""
    assert boq_constants.TIER2_STANDARD_PANEL_PREFIXES == ("AP",)


def test_tier2_accessory_prefixes_has_9_entries() -> None:
    """9 accessory prefixes: BT, TC, CP, CTC, ECF, ECM, JTF, JTM, PC."""
    assert len(boq_constants.TIER2_ACCESSORY_PREFIXES) == 9


def test_tier2_accessory_prefixes_excludes_ap() -> None:
    """AP must NOT appear in accessories — it's the standard bucket."""
    assert "AP" not in boq_constants.TIER2_ACCESSORY_PREFIXES


def test_tier2_accessory_prefixes_exact_membership() -> None:
    expected = ("BT", "TC", "CP", "CTC", "ECF", "ECM", "JTF", "JTM", "PC")
    assert boq_constants.TIER2_ACCESSORY_PREFIXES == expected


def test_tier3_canonical_order_complete_with_custom_last() -> None:
    """CUSTOM is the synthetic last row in Tier 3."""
    assert boq_constants.TIER3_CANONICAL_PREFIX_ORDER[-1] == "CUSTOM"


def test_tier3_canonical_order_has_11_entries() -> None:
    """10 prefix entries + CUSTOM synthetic row."""
    assert len(boq_constants.TIER3_CANONICAL_PREFIX_ORDER) == 11


def test_tier3_canonical_starts_with_ap() -> None:
    """AP is the dominant prefix and appears first."""
    assert boq_constants.TIER3_CANONICAL_PREFIX_ORDER[0] == "AP"


def test_sku_prefix_descriptions_has_11_entries() -> None:
    """One per Tier 3 prefix + CUSTOM."""
    assert len(boq_constants.SKU_PREFIX_DESCRIPTIONS) == 11


def test_sku_prefix_descriptions_is_tuple_of_pairs() -> None:
    """Anti-pattern #2/#9: tuple-of-pairs, not dict."""
    for entry in boq_constants.SKU_PREFIX_DESCRIPTIONS:
        assert isinstance(entry, tuple) and len(entry) == 2


# ──────────────────────────────────────────────────────────────────────────────
# UUID5 namespace (anti-pattern #8: underscore prefix)
# ──────────────────────────────────────────────────────────────────────────────


def test_uuid_namespace_frozen_exact_hex() -> None:
    """The UUID5 namespace MUST never change. Any change invalidates ALL
    deterministic UUIDs ever produced. ASSUMPTION-BOQ-20."""
    from app.services.kos_boq_generator.constants import _BOQ_UUID_NAMESPACE

    assert str(_BOQ_UUID_NAMESPACE) == "a5b8c2d1-4e6f-7890-1234-567890abcdef"


def test_uuid_namespace_is_uuid_instance() -> None:
    from app.services.kos_boq_generator.constants import _BOQ_UUID_NAMESPACE

    assert isinstance(_BOQ_UUID_NAMESPACE, uuid.UUID)


# ──────────────────────────────────────────────────────────────────────────────
# Input validation limits
# ──────────────────────────────────────────────────────────────────────────────


def test_max_discount_100_percent() -> None:
    """IV-5 upper bound — discount cannot exceed 100% (sales free)."""
    assert boq_constants.MAX_DISCOUNT_PERCENT == 100.0


def test_min_discount_0_percent() -> None:
    """IV-5 lower bound — discount cannot be negative."""
    assert boq_constants.MIN_DISCOUNT_PERCENT == 0.0


def test_max_tax_100_percent() -> None:
    """IV-4 upper bound."""
    assert boq_constants.MAX_TAX_PERCENT == 100.0


def test_min_tax_0_percent() -> None:
    assert boq_constants.MIN_TAX_PERCENT == 0.0


def test_min_quote_validity_1_day() -> None:
    """IV-3 lower bound — quote must be valid at least one day."""
    assert boq_constants.MIN_QUOTE_VALIDITY_DAYS == 1


def test_max_quote_validity_365_days() -> None:
    """IV-3 upper bound — quote valid up to one year."""
    assert boq_constants.MAX_QUOTE_VALIDITY_DAYS == 365


def test_catalog_thickness_tolerance_is_10_percent() -> None:
    """Custom-quote weight estimator threshold. ASSUMPTION-BOQ-16."""
    assert boq_constants.CATALOG_THICKNESS_TOLERANCE_PERCENT == 10.0


# ──────────────────────────────────────────────────────────────────────────────
# Semver / quote number template
# ──────────────────────────────────────────────────────────────────────────────


def test_quote_number_template_format() -> None:
    """Anti-pattern #14: format must be documented and exact."""
    assert boq_constants.QUOTE_NUMBER_TEMPLATE == "Q-{project_id}-001-{date_compact}"


def test_quote_number_template_format_renders() -> None:
    """Verify the template renders the expected canonical form."""
    rendered = boq_constants.QUOTE_NUMBER_TEMPLATE.format(
        project_id="P_INT_8_TEST", date_compact="20260525",
    )
    assert rendered == "Q-P_INT_8_TEST-001-20260525"


def test_boq_schema_version_is_0_1_0() -> None:
    """Initial version. Bump per semver policy in module docstring."""
    assert boq_constants.BOQ_SCHEMA_VERSION == "0.1.0"


def test_boq_calculation_version_is_v1_0() -> None:
    """Initial algorithm version. Bump when algorithms change."""
    assert boq_constants.BOQ_CALCULATION_VERSION == "v1.0"


# ──────────────────────────────────────────────────────────────────────────────
# Re-export integrity assert ran at import time
# ──────────────────────────────────────────────────────────────────────────────


def test_constants_module_imports_without_assertion_error() -> None:
    """Re-importing the module must not raise — the runtime assert at the
    bottom of constants.py verifies mapper constants exist and are not None.

    If KG_PER_SFT, PRICE_PER_SFT_INR, or MM2_PER_SFT became None in mapper,
    importing constants.py would raise AssertionError immediately."""
    import importlib

    from app.services.kos_boq_generator import constants

    importlib.reload(constants)
    # Should not raise


def test_kg_per_sft_has_three_thicknesses() -> None:
    """Karthik standard catalog: K4-110, K6-150 (155 SKU), K8-200."""
    assert set(boq_constants.KG_PER_SFT_BY_THICKNESS.keys()) == {110, 155, 200}


def test_kg_per_sft_values_match_karthik() -> None:
    """Karthik confirmations 2026-05-22/23."""
    assert boq_constants.KG_PER_SFT_BY_THICKNESS[110] == 1.29
    assert boq_constants.KG_PER_SFT_BY_THICKNESS[155] == 1.46
    assert boq_constants.KG_PER_SFT_BY_THICKNESS[200] == 1.63


def test_panel_price_is_225_rupees() -> None:
    """Karthik 2026-05-23 17:58: ``225 for all`` (flat across all thicknesses)."""
    assert boq_constants.PANEL_PRICE_INR_PER_SFT == 225


def test_mm2_per_sft_is_92903_04() -> None:
    """IEEE-754 pinned conversion constant (MM_PER_FT² with last-bit drift removed)."""
    assert boq_constants.MM2_PER_SFT == 92903.04
