"""Tests for kos_panel_grid_mapper.constants — locked-value verification.

Every invariant listed in DESIGN.md §2.2 + the prompt's §2.2 invariants table is
exercised here. These are static-value tests; no algorithm logic runs.
"""

from __future__ import annotations

from app.services.kos_panel_grid_mapper import constants as C


# ──────────────────────────────────────────────────────────────────────────────
# Composition split — must sum to exactly 1.0
# ──────────────────────────────────────────────────────────────────────────────


def test_skin_plus_rib_equals_one() -> None:
    """SKIN + RIB fractions must equal exactly 1.0 (no other composition exists)."""
    assert C.SKIN_FRACTION + C.RIB_FRACTION == 1.0


def test_skin_and_rib_individually_valid() -> None:
    assert C.SKIN_FRACTION == 0.60
    assert C.RIB_FRACTION == 0.40


# ──────────────────────────────────────────────────────────────────────────────
# KG_PER_SFT — covers exactly Karthik's three standard thicknesses
# ──────────────────────────────────────────────────────────────────────────────


def test_kg_per_sft_covers_exactly_three_thicknesses() -> None:
    """KG_PER_SFT must have entries for 110, 155, 200 — and nothing else."""
    assert set(C.KG_PER_SFT.keys()) == {110, 155, 200}


def test_kg_per_sft_values_locked() -> None:
    """Per Karthik WhatsApp 2026-05-22/23 confirmations."""
    assert C.KG_PER_SFT[110] == 1.29
    assert C.KG_PER_SFT[155] == 1.46
    assert C.KG_PER_SFT[200] == 1.63


def test_kg_per_sft_linear_increase() -> None:
    """Sanity check: weight increases with thickness (~0.0038 kg/sft per mm)."""
    assert C.KG_PER_SFT[110] < C.KG_PER_SFT[155] < C.KG_PER_SFT[200]


# ──────────────────────────────────────────────────────────────────────────────
# THICKNESS_BANDS — non-overlapping + ordered by low bound
# ──────────────────────────────────────────────────────────────────────────────


def test_thickness_bands_ordered_by_low_bound() -> None:
    lows = [band[0] for band in C.THICKNESS_BANDS]
    assert lows == sorted(lows), f"THICKNESS_BANDS not ordered ascending: {lows}"


def test_thickness_bands_non_overlapping() -> None:
    """Each band's high must be ≤ next band's low (allows gaps; rejects overlap)."""
    for i in range(len(C.THICKNESS_BANDS) - 1):
        this_high = C.THICKNESS_BANDS[i][1]
        next_low = C.THICKNESS_BANDS[i + 1][0]
        assert this_high <= next_low, (
            f"THICKNESS_BANDS overlap at index {i}: "
            f"{C.THICKNESS_BANDS[i]} → {C.THICKNESS_BANDS[i + 1]}"
        )


def test_thickness_bands_low_lt_high() -> None:
    """Every band must have low < high (well-formed half-open interval)."""
    for low, high, system in C.THICKNESS_BANDS:
        assert low < high, f"Malformed band ({low}, {high}, {system})"


def test_thickness_bands_canonical_values_present() -> None:
    """The five canonical Karthik thicknesses must each fall into a band."""
    systems_by_thickness: dict[int, str] = {}
    for low, high, system in C.THICKNESS_BANDS:
        for t in (110, 150, 180, 200, 250):
            if low <= t < high:
                systems_by_thickness[t] = system
    assert systems_by_thickness[110] == "K4-110"
    assert systems_by_thickness[150] == "K6-150"
    assert systems_by_thickness[180] == "K6-180"
    assert systems_by_thickness[200] == "K8-200"
    assert systems_by_thickness[250] == "K8-250"


# ──────────────────────────────────────────────────────────────────────────────
# Unit conversion — exact integer-friendly value
# ──────────────────────────────────────────────────────────────────────────────


def test_mm_per_ft_locked() -> None:
    assert C.MM_PER_FT == 304.8


def test_mm2_per_sft_is_canonical_literal() -> None:
    """Pinned to the literal 92903.04 (exact double representation) — see the
    constants.py docstring for why we don't compute MM_PER_FT**2 at runtime."""
    assert C.MM2_PER_SFT == 92903.04


def test_mm2_per_sft_close_to_mm_per_ft_squared() -> None:
    """The literal 92903.04 matches MM_PER_FT² to ≈1e-11 (IEEE-754 rounding noise)."""
    import math

    computed = C.MM_PER_FT * C.MM_PER_FT
    assert math.isclose(C.MM2_PER_SFT, computed, rel_tol=1e-9)


# ──────────────────────────────────────────────────────────────────────────────
# SKU_THICKNESS_FOR_SYSTEM — exactly 6 entries (5 standard + CUSTOM)
# ──────────────────────────────────────────────────────────────────────────────


def test_sku_thickness_for_system_has_six_entries() -> None:
    assert len(C.SKU_THICKNESS_FOR_SYSTEM) == 6


def test_sku_thickness_for_system_keys() -> None:
    expected = {"K4-110", "K6-150", "K6-180", "K8-200", "K8-250", "CUSTOM"}
    assert set(C.SKU_THICKNESS_FOR_SYSTEM.keys()) == expected


def test_sku_thickness_k6_150_is_155() -> None:
    """POLICY-KARTHIK-WINS reconciliation: K6-150 system uses 155 SKU code."""
    assert C.SKU_THICKNESS_FOR_SYSTEM["K6-150"] == 155


def test_sku_thickness_custom_is_none() -> None:
    """CUSTOM has no fixed SKU thickness; caller reads custom_thickness_mm from output."""
    assert C.SKU_THICKNESS_FOR_SYSTEM["CUSTOM"] is None


# ──────────────────────────────────────────────────────────────────────────────
# Panel dimensions sanity
# ──────────────────────────────────────────────────────────────────────────────


def test_cut_length_le_raw_height() -> None:
    """A panel can't be cut longer than the raw stock."""
    assert C.STANDARD_PANEL_CUT_LENGTH_MM <= C.STANDARD_PANEL_RAW_HEIGHT_MM


def test_panel_width_locked_300mm() -> None:
    """Karthik WhatsApp 2026-05-23 17:36."""
    assert C.STANDARD_PANEL_WIDTH_MM == 300


def test_raw_height_is_10ft() -> None:
    """3048mm = 10 ft exactly (304.8 × 10)."""
    assert C.STANDARD_PANEL_RAW_HEIGHT_MM == 3048
    assert C.STANDARD_PANEL_RAW_HEIGHT_MM == int(C.MM_PER_FT * 10)


def test_cut_length_2998_vamshi_convention() -> None:
    assert C.STANDARD_PANEL_CUT_LENGTH_MM == 2998


def test_cut_length_50mm_clearance() -> None:
    """The 50mm difference between raw (3048) and cut (2998) is the floor clearance."""
    assert C.STANDARD_PANEL_RAW_HEIGHT_MM - C.STANDARD_PANEL_CUT_LENGTH_MM == 50


# ──────────────────────────────────────────────────────────────────────────────
# classify_bracing_height — boundary tests
# ──────────────────────────────────────────────────────────────────────────────


def test_bracing_height_boundary_le_2_4m() -> None:
    """Exactly 2400mm falls in "le_2.4m" (inclusive upper)."""
    assert C.classify_bracing_height(2400) == "le_2.4m"
    assert C.classify_bracing_height(2399) == "le_2.4m"
    assert C.classify_bracing_height(1000) == "le_2.4m"


def test_bracing_height_boundary_2401_jumps_to_next_band() -> None:
    assert C.classify_bracing_height(2401) == "2.4_to_3.0m"


def test_bracing_height_boundary_3000() -> None:
    """3000mm (Vamshi default) sits at upper edge of "2.4_to_3.0m"."""
    assert C.classify_bracing_height(3000) == "2.4_to_3.0m"


def test_bracing_height_boundary_3001() -> None:
    assert C.classify_bracing_height(3001) == "3.0_to_4.5m"


def test_bracing_height_boundary_4500() -> None:
    assert C.classify_bracing_height(4500) == "3.0_to_4.5m"


def test_bracing_height_boundary_4501() -> None:
    assert C.classify_bracing_height(4501) == "4.5_to_6.0m"


def test_bracing_height_boundary_6000() -> None:
    assert C.classify_bracing_height(6000) == "4.5_to_6.0m"


def test_bracing_height_above_card_1_range() -> None:
    """Heights > 6000mm fall outside Card 1; defaulted to top band (caller warns)."""
    assert C.classify_bracing_height(6001) == "4.5_to_6.0m"
    assert C.classify_bracing_height(10000) == "4.5_to_6.0m"


# ──────────────────────────────────────────────────────────────────────────────
# Pricing
# ──────────────────────────────────────────────────────────────────────────────


def test_price_per_sft_locked_225() -> None:
    """Karthik WhatsApp 2026-05-23 17:58 — flat ₹225/sft."""
    assert C.PRICE_PER_SFT_INR == 225


# ──────────────────────────────────────────────────────────────────────────────
# Defaults (POLICY-DEFAULT-CONFIG)
# ──────────────────────────────────────────────────────────────────────────────


def test_default_seismic_zone_is_iii() -> None:
    assert C.DEFAULT_SEISMIC_ZONE == "III"


def test_default_wall_height_is_3000() -> None:
    assert C.DEFAULT_WALL_HEIGHT_MM == 3000


def test_default_split_strategy_is_minimize_cuts() -> None:
    """POLICY-DEFAULT-STRATEGY-B."""
    assert C.DEFAULT_SPLIT_STRATEGY == "minimize_cuts"


# ──────────────────────────────────────────────────────────────────────────────
# Future-hooks — must start in baseline (inactive) state
# ──────────────────────────────────────────────────────────────────────────────


def test_parser_openings_available_flipped_in_5c3_pr4() -> None:
    """Flipped to True in 5C-3 PR 4 (2026-05-25) after the 90VR Team2
    calibration reached F1 = 0.826 on the real customer PDF (above the 0.70
    target). When True, opening_handler.layout_opening_frame() becomes
    active in the mapper orchestrator and the parser's ParserOpening data
    feeds V/HB frame computations."""
    assert C.PARSER_OPENINGS_AVAILABLE is True


def test_joint_overlap_mm_starts_at_zero() -> None:
    """Karthik hasn't confirmed interlock geometry; placeholder zero today."""
    assert C.JOINT_OVERLAP_MM == 0


def test_standard_panel_widths_is_single_width_today() -> None:
    """Today's catalog is single-width 300mm; tuple form for future expansion."""
    assert C.STANDARD_PANEL_WIDTHS_MM == (C.STANDARD_PANEL_WIDTH_MM,)
    assert len(C.STANDARD_PANEL_WIDTHS_MM) == 1


# ──────────────────────────────────────────────────────────────────────────────
# Lookup table coverage smoke tests
# ──────────────────────────────────────────────────────────────────────────────


def test_reinforcement_spec_source_has_20_entries() -> None:
    """5 systems × 4 seismic zones = 20 entries."""
    assert len(C.REINFORCEMENT_SPEC_SOURCE) == 20


def test_reinforcement_specs_keys_cover_all_source_values() -> None:
    """Every section-identifier referenced by REINFORCEMENT_SPEC_SOURCE must have
    an entry in REINFORCEMENT_SPECS (otherwise sku_resolver crashes)."""
    referenced = set(C.REINFORCEMENT_SPEC_SOURCE.values())
    available = set(C.REINFORCEMENT_SPECS.keys())
    assert referenced.issubset(available), (
        f"Missing REINFORCEMENT_SPECS entries: {referenced - available}"
    )


def test_max_lift_height_has_no_negative_or_zero_values() -> None:
    for key, value in C.MAX_LIFT_HEIGHT_MM.items():
        assert value > 0, f"MAX_LIFT_HEIGHT_MM[{key}] = {value} is non-positive"


# ──────────────────────────────────────────────────────────────────────────────
# Schema version
# ──────────────────────────────────────────────────────────────────────────────


def test_schema_version_set() -> None:
    assert C.MAPPER_SCHEMA_VERSION == "0.1.0"
