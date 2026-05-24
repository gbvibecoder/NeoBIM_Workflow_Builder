"""Tests for system_selector.select_system — DESIGN.md §6.2.

Coverage:
  - Null thickness → CUSTOM
  - Each standard band (110/155/180/200/250) → correct system
  - Band-gap thicknesses → CUSTOM
  - Custom-thick (≥275) → CUSTOM
  - K6-180 → is_custom_order=True + warning
  - K8-250 → is_custom_order=True + warning
  - Application-hint overrides (basement_gt3m, basement_lt3m, retaining,
    shear_wall_g10, lift_shaft_g5, apartment_external_g5)
  - inferred_application fallback (basement, retaining)
  - The acid pair: P_INT_8 (110→K4-110), P_EXT_3 (155→K6-150)
  - Determinism
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    SystemSelectionResult,
    select_system,
)


# ──────────────────────────────────────────────────────────────────────────────
# THE ACID PAIR — Vamshi P_INT_8 + P_EXT_3
# ──────────────────────────────────────────────────────────────────────────────


def test_acid_p_int_8_110mm_maps_to_k4_110() -> None:
    """P_INT_8 wall: 110mm thick, internal → K4-110 (standard, no warnings)."""
    res = select_system(
        wall_thickness_mm=110.0,
        application_hint="internal_partition",
        inferred_application="internal",
    )
    assert res.system == "K4-110"
    assert res.sku_thickness_mm == 110
    assert res.is_custom_order is False
    assert res.warnings == ()


def test_acid_p_ext_3_155mm_maps_to_k6_150() -> None:
    """P_EXT_3 wall: 155mm thick, external → K6-150 (sku=155, standard)."""
    res = select_system(
        wall_thickness_mm=155.0,
        application_hint=None,    # no hint; rely on inferred external
        inferred_application="external",
    )
    assert res.system == "K6-150"
    assert res.sku_thickness_mm == 155
    assert res.is_custom_order is False
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Band-select baseline (no overrides)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "thickness, expected_system, expected_sku",
    [
        (110.0, "K4-110", 110),
        (150.0, "K6-150", 155),    # 150 and 155 collapse to K6-150 per POLICY-KARTHIK-WINS
        (155.0, "K6-150", 155),
        (200.0, "K8-200", 200),
    ],
)
def test_band_select_standard_thickness(
    thickness: float, expected_system: str, expected_sku: int
) -> None:
    """Standard Karthik catalog thicknesses → no warnings, not custom-order."""
    res = select_system(wall_thickness_mm=thickness)
    assert res.system == expected_system
    assert res.sku_thickness_mm == expected_sku
    assert res.is_custom_order is False
    assert res.warnings == ()


def test_band_select_k6_180() -> None:
    """K6-180 is in Rulebook §4.1 but NOT in Karthik's standard catalog —
    is_custom_order=True with explanatory warning."""
    res = select_system(wall_thickness_mm=180.0)
    assert res.system == "K6-180"
    assert res.sku_thickness_mm == 180
    assert res.is_custom_order is True
    assert any("K6-180" in w and "custom_quote_request" in w for w in res.warnings)


def test_band_select_k8_250() -> None:
    """K8-250: Karthik confirmed custom-on-request."""
    res = select_system(wall_thickness_mm=250.0)
    assert res.system == "K8-250"
    assert res.sku_thickness_mm == 250
    assert res.is_custom_order is True
    assert any("K8-250" in w and "custom_quote_request" in w for w in res.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# CUSTOM fallbacks
# ──────────────────────────────────────────────────────────────────────────────


def test_null_thickness_returns_custom() -> None:
    res = select_system(wall_thickness_mm=None)
    assert res.system == "CUSTOM"
    assert res.sku_thickness_mm is None
    assert res.is_custom_order is True
    assert any("thickness_mm null" in w for w in res.warnings)


def test_zero_thickness_returns_custom() -> None:
    res = select_system(wall_thickness_mm=0.0)
    assert res.system == "CUSTOM"
    assert res.is_custom_order is True


def test_negative_thickness_returns_custom() -> None:
    res = select_system(wall_thickness_mm=-5.0)
    assert res.system == "CUSTOM"
    assert res.is_custom_order is True


def test_sub_standard_thin_under_100_returns_custom() -> None:
    """Walls < 100mm thin are sub-standard."""
    res = select_system(wall_thickness_mm=80.0)
    assert res.system == "CUSTOM"
    assert res.sku_thickness_mm is None
    assert res.is_custom_order is True
    assert any("sub-standard thin" in w for w in res.warnings)


@pytest.mark.parametrize("thickness", [130.0, 165.0, 230.0])
def test_band_gap_thicknesses_route_to_custom(thickness: float) -> None:
    """Thicknesses falling in gaps between bands (120-145, 160-170, 220-240)
    route to CUSTOM."""
    res = select_system(wall_thickness_mm=thickness)
    assert res.system == "CUSTOM"
    assert res.is_custom_order is True
    assert any("band gap" in w for w in res.warnings)


def test_custom_thick_above_275_returns_custom() -> None:
    """Karthik: anything 275mm+ is custom-on-request."""
    res = select_system(wall_thickness_mm=300.0)
    assert res.system == "CUSTOM"
    assert res.is_custom_order is True
    assert any("custom-thick" in w for w in res.warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Application-hint overrides (Rulebook §4.2)
# ──────────────────────────────────────────────────────────────────────────────


def test_basement_gt3m_hint_forces_k8_250() -> None:
    """Even with 110mm wall, basement_gt3m mandates K8-250 per §4.2."""
    res = select_system(
        wall_thickness_mm=110.0,
        application_hint="basement_gt3m",
    )
    assert res.system == "K8-250"
    assert res.sku_thickness_mm == 250
    assert res.is_custom_order is True
    assert any("basement_gt3m" in w for w in res.warnings)


def test_basement_lt3m_hint_forces_k8_200() -> None:
    res = select_system(
        wall_thickness_mm=155.0,
        application_hint="basement_lt3m",
    )
    assert res.system == "K8-200"
    assert res.sku_thickness_mm == 200
    assert res.is_custom_order is False
    assert any("basement_lt3m" in w for w in res.warnings)


def test_basement_lt3m_hint_no_override_when_already_k8_200() -> None:
    """If band already chose K8-200, no override warning."""
    res = select_system(
        wall_thickness_mm=200.0,
        application_hint="basement_lt3m",
    )
    assert res.system == "K8-200"
    # No basement_lt3m override warning because system was already K8-200.
    assert not any("basement_lt3m" in w for w in res.warnings)


def test_retaining_hint_forces_k8_250() -> None:
    res = select_system(wall_thickness_mm=200.0, application_hint="retaining")
    assert res.system == "K8-250"
    assert any("retaining" in w for w in res.warnings)


def test_shear_wall_g10_hint_forces_k8_200() -> None:
    res = select_system(wall_thickness_mm=155.0, application_hint="shear_wall_g10")
    assert res.system == "K8-200"
    assert any("shear_wall_g10" in w for w in res.warnings)


def test_lift_shaft_g5_hint_forces_k8_200() -> None:
    res = select_system(wall_thickness_mm=110.0, application_hint="lift_shaft_g5")
    assert res.system == "K8-200"
    assert any("lift_shaft_g5" in w for w in res.warnings)


def test_apartment_external_g5_hint_forces_k6_180() -> None:
    res = select_system(wall_thickness_mm=155.0, application_hint="apartment_external_g5")
    assert res.system == "K6-180"
    assert res.is_custom_order is True   # K6-180 is custom-order regardless of override path
    assert any("apartment_external_g5" in w for w in res.warnings)


def test_internal_partition_hint_no_override() -> None:
    """internal_partition shouldn't trigger any override — the band wins."""
    res = select_system(wall_thickness_mm=110.0, application_hint="internal_partition")
    assert res.system == "K4-110"
    assert res.warnings == ()   # no overrides → no warnings


def test_villa_external_hint_no_override() -> None:
    res = select_system(wall_thickness_mm=155.0, application_hint="villa_external")
    assert res.system == "K6-150"
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# inferred_application fallback (when application_hint is None)
# ──────────────────────────────────────────────────────────────────────────────


def test_inferred_basement_applies_default_lt3m_override() -> None:
    """When orientation_inferrer says 'basement' but no explicit hint, default
    to basement_lt3m (K8-200) conservatively."""
    res = select_system(
        wall_thickness_mm=110.0,
        application_hint=None,
        inferred_application="basement",
    )
    assert res.system == "K8-200"
    assert any("inferred_application='basement'" in w for w in res.warnings)


def test_inferred_basement_with_existing_k8_no_override() -> None:
    """Band already K8-200 → no override warning."""
    res = select_system(
        wall_thickness_mm=200.0,
        application_hint=None,
        inferred_application="basement",
    )
    assert res.system == "K8-200"
    # No override warning since system already K8-200.
    assert not any("inferred_application='basement'" in w for w in res.warnings)


def test_inferred_retaining_applies_override() -> None:
    res = select_system(
        wall_thickness_mm=200.0,
        application_hint=None,
        inferred_application="retaining",
    )
    assert res.system == "K8-250"
    assert any("inferred_application='retaining'" in w for w in res.warnings)


def test_inferred_external_no_override() -> None:
    res = select_system(
        wall_thickness_mm=155.0,
        application_hint=None,
        inferred_application="external",
    )
    assert res.system == "K6-150"
    assert res.warnings == ()


def test_inferred_internal_no_override() -> None:
    res = select_system(
        wall_thickness_mm=110.0,
        application_hint=None,
        inferred_application="internal",
    )
    assert res.system == "K4-110"
    assert res.warnings == ()


# ──────────────────────────────────────────────────────────────────────────────
# Return type sanity + determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_return_type_is_system_selection_result() -> None:
    res = select_system(wall_thickness_mm=110.0)
    assert isinstance(res, SystemSelectionResult)


def test_warnings_is_always_tuple() -> None:
    for kwargs in [
        {"wall_thickness_mm": 110.0},
        {"wall_thickness_mm": None},
        {"wall_thickness_mm": 180.0},
        {"wall_thickness_mm": 110.0, "application_hint": "basement_gt3m"},
    ]:
        res = select_system(**kwargs)  # type: ignore[arg-type]
        assert isinstance(res.warnings, tuple)


def test_determinism_repeated_calls_produce_identical_results() -> None:
    args = dict(wall_thickness_mm=155.0, application_hint=None, inferred_application="external")
    a = select_system(**args)  # type: ignore[arg-type]
    b = select_system(**args)  # type: ignore[arg-type]
    assert a == b
