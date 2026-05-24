"""Tests for sku_resolver — SKU code construction + label assignment +
reinforcement and bracing lookups.

Coverage:
  - build_sku_code: all 10 SKU prefixes, formatting per DESIGN §4.4
  - assign_label: every branch in DESIGN §4.5 label-mapping table
  - resolve_reinforcement_spec: K4 / K6-150 / K6-180 / K8-200 / K8-250 × 4 zones
  - resolve_reinforcement_spec: CUSTOM raises ValueError
  - resolve_bracing_height_class: thin wrapper smoke tests
  - SKU regex compliance with output_validator's C-12 pattern
"""

from __future__ import annotations

import re

import pytest

from app.services.kos_panel_grid_mapper import (
    REINFORCEMENT_SPECS,
    ReinforcementSpec,
    assign_label,
    build_sku_code,
    classify_bracing_height,
    resolve_bracing_height_class,
    resolve_reinforcement_spec,
)


# ──────────────────────────────────────────────────────────────────────────────
# build_sku_code — DESIGN §4.4 format "{TYPE}{THICKNESS}-{CUT_LENGTH}"
# ──────────────────────────────────────────────────────────────────────────────


def test_build_sku_code_ap155_2998() -> None:
    """Standard AP stretcher (P_EXT_3 S2-S30, P_INT_8 S2-S6 cousin)."""
    assert build_sku_code("AP", 155, 2998) == "AP155-2998"


def test_build_sku_code_bt110_2101() -> None:
    """P_INT_8 HB1 bottom track."""
    assert build_sku_code("BT", 110, 2101) == "BT110-2101"


def test_build_sku_code_tc110_2101() -> None:
    """P_INT_8 HB2 top cap."""
    assert build_sku_code("TC", 110, 2101) == "TC110-2101"


def test_build_sku_code_cp155_2998() -> None:
    """P_EXT_3 S1 corner unit."""
    assert build_sku_code("CP", 155, 2998) == "CP155-2998"


def test_build_sku_code_ctc110_2998() -> None:
    """P_INT_8 V1 end-terminator (CTC)."""
    assert build_sku_code("CTC", 110, 2998) == "CTC110-2998"


def test_build_sku_code_ecm110_2998() -> None:
    """P_INT_8 S1 end-cap male."""
    assert build_sku_code("ECM", 110, 2998) == "ECM110-2998"


def test_build_sku_code_all_ten_prefixes() -> None:
    """Sanity: every Vamshi SKU prefix builds cleanly."""
    for prefix in ["AP", "BT", "TC", "CP", "CTC", "ECF", "ECM", "JTF", "JTM", "PC"]:
        sku = build_sku_code(prefix, 155, 2998)
        assert sku == f"{prefix}155-2998"


def test_build_sku_code_long_horizontal() -> None:
    """P_EXT_3 BT155-9370 — 4-digit cut length, R6 long-horizontal case."""
    assert build_sku_code("BT", 155, 9370) == "BT155-9370"


def test_build_sku_code_long_horizontal_5digit() -> None:
    """Future-proofing: even longer walls (>9999mm) should format cleanly."""
    assert build_sku_code("BT", 200, 12500) == "BT200-12500"


def test_build_sku_code_complies_with_c12_regex() -> None:
    """Every built SKU must match output_validator's C-12 regex pattern."""
    pattern = re.compile(r"^(AP|BT|TC|CP|CTC|ECF|ECM|JTF|JTM|PC)(110|155|200)-\d+(-CUT)?$")
    skus = [
        build_sku_code("AP", 155, 2998),
        build_sku_code("BT", 110, 2101),
        build_sku_code("CP", 200, 2998),
        build_sku_code("CTC", 155, 2998),
        build_sku_code("ECF", 110, 2998),
        build_sku_code("JTM", 200, 9370),
    ]
    for sku in skus:
        assert pattern.match(sku), f"SKU {sku!r} fails C-12 regex"


def test_build_sku_code_does_not_validate_thickness() -> None:
    """Per docstring: thickness is NOT validated by this function. Non-standard
    thicknesses (e.g. 180 for K6-180 SKU rendering) are legitimate inputs prior
    to CustomQuoteRequest routing in system_selector (PR 5)."""
    # K6-180 SKU rendering (rulebook system, NOT in Karthik's standard catalog)
    assert build_sku_code("AP", 180, 2998) == "AP180-2998"   # builds cleanly


# ──────────────────────────────────────────────────────────────────────────────
# assign_label — DESIGN §4.5 label → SKU mapping
# ──────────────────────────────────────────────────────────────────────────────


# BT / TC always HB labels.
def test_label_bt_first_position() -> None:
    assert assign_label("BT", 1, None) == "HB1"


def test_label_tc_second_position() -> None:
    """Vamshi convention: HB1 = BT (bottom), HB2 = TC (top); both share HB sequence."""
    assert assign_label("TC", 2, None) == "HB2"


def test_label_bt_arbitrary_position() -> None:
    """Multi-piece BT (e.g. interrupted by openings) gets sequential HB labels."""
    assert assign_label("BT", 5, None) == "HB5"


# AP, CP, ECF/ECM, JTF/JTM, PC default to S labels (when not opening-adjacent).
@pytest.mark.parametrize("sku_type", ["AP", "CP", "ECF", "ECM", "JTF", "JTM", "PC"])
def test_label_default_s_for_non_opening(sku_type: str) -> None:
    assert assign_label(sku_type, 1, None) == "S1"
    assert assign_label(sku_type, 5, None) == "S5"


# CTC + opening_index → V label (vertical jamb framing).
def test_label_ctc_around_opening_is_v() -> None:
    """CTC at opening_index=1 → V1 (jamb piece, DESIGN §4.5)."""
    assert assign_label("CTC", 99, opening_index=1) == "V1"


def test_label_ctc_v_uses_opening_index_not_position() -> None:
    """V1, V2 numbering is per-opening, not per-segment position."""
    assert assign_label("CTC", 50, opening_index=3) == "V3"


# AP + opening_index → C label (narrow custom-width AP next to jamb).
def test_label_ap_around_opening_is_c() -> None:
    """Narrow AP adjacent to opening jamb gets C label (DESIGN §4.5)."""
    assert assign_label("AP", 12, opening_index=1) == "C1"


def test_label_ap_c_uses_opening_index() -> None:
    assert assign_label("AP", 99, opening_index=7) == "C7"


# CTC without opening_index (mid-wall infill or end-terminator) → S label by default.
def test_label_ctc_no_opening_index_default_s() -> None:
    """CTC mid-wall infill case: splitter typically sets label inline, but if the
    function is called it falls back to S label (the natural default)."""
    assert assign_label("CTC", 7, opening_index=None) == "S7"


# Opening-related labels MUST not collide with mid-segment S/HB sequences.
def test_label_opening_index_takes_precedence() -> None:
    """Same position_index but with vs without opening_index → different labels."""
    assert assign_label("AP", 3, opening_index=None) == "S3"
    assert assign_label("AP", 3, opening_index=2) == "C2"


# ──────────────────────────────────────────────────────────────────────────────
# resolve_reinforcement_spec — Field Rule Book §8.2 lookup
# ──────────────────────────────────────────────────────────────────────────────


def test_reinforcement_k4_seismic_iii() -> None:
    """K4-110 internal partition spec is uniform across all 4 zones."""
    spec = resolve_reinforcement_spec("K4-110", "III")
    assert isinstance(spec, ReinforcementSpec)
    assert spec.vertical_bars == "2 nos 10mm dia. @ 600mm c/c"
    assert spec.horizontal_bars == "8mm dia. @ 400mm c/c"
    assert spec.concrete_grade == "M20"
    assert spec.cover_external_mm == 20
    assert spec.cover_internal_mm == 20
    assert spec.source_section == "Rulebook §8.2 K4"


def test_reinforcement_k4_zones_all_identical() -> None:
    """K4 has one row per Field Rule Book §8.2; the 4 zones map to the same spec."""
    specs = [resolve_reinforcement_spec("K4-110", z) for z in ("II", "III", "IV", "V")]
    for s in specs[1:]:
        assert s == specs[0]


def test_reinforcement_k6_150_zone_iii() -> None:
    """K6-150 in Zone III: M25 concrete, 16mm @ 150mm vertical."""
    spec = resolve_reinforcement_spec("K6-150", "III")
    assert spec.concrete_grade == "M25"
    assert spec.vertical_bars == "16mm @ 150mm c/c"
    assert spec.horizontal_bars == "10mm @ 300mm c/c"
    assert spec.source_section == "Rulebook §8.2 K6 Zone III"


def test_reinforcement_k6_150_zone_ii_uses_zone_ii_spec() -> None:
    """Zone II uses 12mm @ 200mm c/c — lighter than Zone III."""
    spec = resolve_reinforcement_spec("K6-150", "II")
    assert spec.vertical_bars == "12mm @ 200mm c/c"
    assert spec.concrete_grade == "M25"
    assert spec.source_section == "Rulebook §8.2 K6 Zone II"


def test_reinforcement_k6_150_zone_iv() -> None:
    """K6-150 in Zone IV/V: M30 concrete, 12mm @ 250mm horizontal."""
    spec = resolve_reinforcement_spec("K6-150", "IV")
    assert spec.concrete_grade == "M30"
    assert spec.horizontal_bars == "12mm @ 250mm c/c"
    assert spec.cover_external_mm == 30
    assert spec.source_section == "Rulebook §8.2 K6 Zone IV/V"


def test_reinforcement_k6_150_zone_v_same_as_iv() -> None:
    """Zones IV and V share the same spec per Field Rule Book §8.2."""
    assert resolve_reinforcement_spec("K6-150", "IV") == resolve_reinforcement_spec(
        "K6-150", "V"
    )


def test_reinforcement_k6_180_zone_iii() -> None:
    """K6-180 (rulebook only) — uses K6 Zone III spec."""
    spec = resolve_reinforcement_spec("K6-180", "III")
    assert spec.concrete_grade == "M25"
    assert spec.source_section == "Rulebook §8.2 K6 Zone III"


def test_reinforcement_k8_200_zone_iii() -> None:
    """K8-200 structural/core: M30 minimum."""
    spec = resolve_reinforcement_spec("K8-200", "III")
    assert spec.concrete_grade == "M30"
    assert spec.vertical_bars == "16mm-20mm @ 150mm c/c"
    assert spec.cover_external_mm == 30


def test_reinforcement_k8_250_zone_iii() -> None:
    """K8-250 basement/retaining: M35 (Field Rule Book §8.2 K8 basement row)."""
    spec = resolve_reinforcement_spec("K8-250", "III")
    assert spec.concrete_grade == "M35"
    assert spec.source_section == "Rulebook §8.2 K8 basement"


def test_reinforcement_custom_raises() -> None:
    """CUSTOM system has no fixed spec — must route through CustomQuoteRequest."""
    with pytest.raises(ValueError, match="CUSTOM system has no fixed reinforcement"):
        resolve_reinforcement_spec("CUSTOM", "III")


def test_reinforcement_spec_source_field_format() -> None:
    """source_section starts with 'Rulebook §' for audit-trail clarity."""
    for system in ("K4-110", "K6-150", "K6-180", "K8-200", "K8-250"):
        for zone in ("II", "III", "IV", "V"):
            spec = resolve_reinforcement_spec(system, zone)  # type: ignore[arg-type]
            assert spec.source_section.startswith("Rulebook §"), (
                f"Bad source_section format for {system}/{zone}: {spec.source_section}"
            )


def test_reinforcement_spec_is_reinforcement_spec_instance() -> None:
    """Always returns the ReinforcementSpec dataclass (not a dict or other)."""
    spec = resolve_reinforcement_spec("K6-150", "III")
    assert isinstance(spec, ReinforcementSpec)


def test_reinforcement_spec_values_match_constants_dict() -> None:
    """Cross-check: the returned ReinforcementSpec matches the constants.py dict."""
    spec = resolve_reinforcement_spec("K6-150", "III")
    raw = REINFORCEMENT_SPECS["§8.2 K6 Zone III"]
    assert spec.vertical_bars == raw["vertical_bars"]
    assert spec.horizontal_bars == raw["horizontal_bars"]
    assert spec.concrete_grade == raw["concrete_grade"]
    assert spec.cover_external_mm == raw["cover_external_mm"]
    assert spec.cover_internal_mm == raw["cover_internal_mm"]


def test_reinforcement_all_20_system_zone_pairs_resolve() -> None:
    """5 systems × 4 zones = 20 combinations — none should KeyError."""
    count = 0
    for system in ("K4-110", "K6-150", "K6-180", "K8-200", "K8-250"):
        for zone in ("II", "III", "IV", "V"):
            spec = resolve_reinforcement_spec(system, zone)  # type: ignore[arg-type]
            assert isinstance(spec, ReinforcementSpec)
            count += 1
    assert count == 20


# ──────────────────────────────────────────────────────────────────────────────
# resolve_bracing_height_class — thin wrapper smoke tests
# ──────────────────────────────────────────────────────────────────────────────


def test_bracing_class_default_3000mm() -> None:
    """Most Vamshi segments: 3000mm wall height → '2.4_to_3.0m' band."""
    assert resolve_bracing_height_class(3000) == "2.4_to_3.0m"


def test_bracing_class_basement_3000mm() -> None:
    """K8-200 basement wall at 3000mm sits at the upper edge of its band."""
    assert resolve_bracing_height_class(3000) == "2.4_to_3.0m"


def test_bracing_class_tall_4500mm() -> None:
    assert resolve_bracing_height_class(4500) == "3.0_to_4.5m"


def test_bracing_class_max_6000mm() -> None:
    assert resolve_bracing_height_class(6000) == "4.5_to_6.0m"


def test_bracing_class_above_card_1_range() -> None:
    """Height > 6000mm defaults to top band (caller emits warning at orchestrator)."""
    assert resolve_bracing_height_class(7000) == "4.5_to_6.0m"


def test_bracing_class_wrapper_delegates_to_constants_function() -> None:
    """resolve_bracing_height_class must return the same as constants.classify_bracing_height."""
    for h in (1000, 2400, 2401, 3000, 3001, 4500, 4501, 6000, 6001, 10000):
        assert resolve_bracing_height_class(h) == classify_bracing_height(h)


# ──────────────────────────────────────────────────────────────────────────────
# Determinism — same input ⇒ identical output strings
# ──────────────────────────────────────────────────────────────────────────────


def test_determinism_build_sku_code() -> None:
    results = [build_sku_code("AP", 155, 2998) for _ in range(10)]
    assert all(r == "AP155-2998" for r in results)


def test_determinism_assign_label() -> None:
    results = [assign_label("CTC", 5, opening_index=2) for _ in range(10)]
    assert all(r == "V2" for r in results)


def test_determinism_resolve_reinforcement_spec() -> None:
    s1 = resolve_reinforcement_spec("K6-150", "III")
    s2 = resolve_reinforcement_spec("K6-150", "III")
    assert s1 == s2
