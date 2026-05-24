"""Tests for area_weight_calculator — pure-function numeric formulas.

Coverage:
  - Direct verification of each of the 7 public functions against
    DESIGN.md §4.4 formulas.
  - P_INT_8 canonical metrics test from PR 2 prompt (vertical panel
    2998×300×110 → 9.68 sft / 12.49 kg / 7.49 skin / 5.00 rib / 12.70 raw /
    0.21 waste / ₹2178.24).
  - P_INT_8 horizontal panel (2101×300×110) — confirms horizontal works.
  - P_EXT_3 long horizontal (9370×300×155 with raw=12192) — confirms R6
    long-horizontal raw computation.
  - Self-consistency: compute_panel_metrics matches individual function calls.
  - Edge cases: invalid thickness raises, skin+rib invariant holds.
"""

from __future__ import annotations

import math

import pytest

from app.services.kos_panel_grid_mapper import (
    KG_PER_SFT,
    MM2_PER_SFT,
    PRICE_PER_SFT_INR,
    RIB_FRACTION,
    SKIN_FRACTION,
    compute_panel_area_sqft,
    compute_panel_metrics,
    compute_panel_price_inr,
    compute_panel_weight_kg,
    compute_raw_weight_kg,
    compute_skin_rib_split,
    compute_waste_kg,
)


# ──────────────────────────────────────────────────────────────────────────────
# compute_panel_area_sqft
# ──────────────────────────────────────────────────────────────────────────────


def test_area_2998_by_300_matches_design() -> None:
    """P_INT_8 standard vertical panel — DESIGN §8.1 worked example."""
    area = compute_panel_area_sqft(2998, 300)
    assert area == pytest.approx(9.68, abs=0.01)
    # Full precision: 2998*300/92903.04 = 9.681061...
    assert area == pytest.approx(9.681061, abs=1e-5)


def test_area_2101_by_300_matches_design() -> None:
    """P_INT_8 horizontal band (HB1/HB2 BT110-2101/TC110-2101)."""
    area = compute_panel_area_sqft(2101, 300)
    assert area == pytest.approx(6.78, abs=0.01)


def test_area_9370_by_300_math_derived() -> None:
    """P_EXT_3 long horizontal (BT155-9370 / TC155-9370).

    Math: (9370 × 300) / 92903.04 = 30.25735... → 30.26 at 2dp.

    Note: DESIGN.md §8.2 prints 30.25 for this panel — that's a transcription
    typo (off by 0.0074 from the true math). The mapper computes 30.26 cleanly;
    a DESIGN-doc patch is recommended in a future doc fix. Surfaced in PR 2 report.
    """
    area = compute_panel_area_sqft(9370, 300)
    assert area == pytest.approx(30.26, abs=0.005)
    assert area == pytest.approx(30.25735, abs=1e-4)


def test_area_narrow_infill_70mm() -> None:
    """P_EXT_3 narrow CTC residual infill (70mm wide) — R4 verifies any width works."""
    area = compute_panel_area_sqft(2998, 70)
    assert area == pytest.approx(2.26, abs=0.01)


def test_area_zero_inputs_returns_zero() -> None:
    assert compute_panel_area_sqft(0, 300) == 0.0
    assert compute_panel_area_sqft(2998, 0) == 0.0


def test_area_uses_canonical_mm2_per_sft_denominator() -> None:
    """Areas must be computed via the literal 92903.04, not MM_PER_FT ** 2 —
    this guards against the IEEE-754 drift caught in PR 1's MM2_PER_SFT pin."""
    area = compute_panel_area_sqft(1000, 1000)
    expected = 1000.0 * 1000.0 / MM2_PER_SFT
    assert area == expected   # exact float equality, no approx


# ──────────────────────────────────────────────────────────────────────────────
# compute_panel_weight_kg
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "thickness, expected_per_sft",
    [(110, 1.29), (155, 1.46), (200, 1.63)],
)
def test_weight_for_each_standard_thickness(thickness: int, expected_per_sft: float) -> None:
    """1 sft × Karthik rate gives the catalog kg/sft per thickness."""
    assert compute_panel_weight_kg(1.0, thickness) == pytest.approx(expected_per_sft, abs=1e-12)


def test_weight_for_p_int_8_vertical_panel() -> None:
    """9.68 sft × 1.29 = 12.49 kg (DESIGN §8.1)."""
    area = compute_panel_area_sqft(2998, 300)
    weight = compute_panel_weight_kg(area, 110)
    assert weight == pytest.approx(12.49, abs=0.01)


def test_weight_raises_on_non_standard_thickness() -> None:
    with pytest.raises(ValueError, match="not one of Karthik's standard catalog"):
        compute_panel_weight_kg(10.0, 180)
    with pytest.raises(ValueError):
        compute_panel_weight_kg(10.0, 99)
    with pytest.raises(ValueError):
        compute_panel_weight_kg(10.0, 250)


def test_weight_zero_area_returns_zero() -> None:
    assert compute_panel_weight_kg(0.0, 110) == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# compute_skin_rib_split
# ──────────────────────────────────────────────────────────────────────────────


def test_skin_rib_split_p_int_8_panel() -> None:
    skin, rib = compute_skin_rib_split(12.49)
    assert skin == pytest.approx(7.49, abs=0.01)
    assert rib == pytest.approx(5.00, abs=0.01)


def test_skin_rib_split_for_horizontal_panel() -> None:
    """P_INT_8 horizontal: 8.75 kg → skin 5.25, rib 3.50."""
    skin, rib = compute_skin_rib_split(8.75)
    assert skin == pytest.approx(5.25, abs=0.01)
    assert rib == pytest.approx(3.50, abs=0.01)


def test_skin_plus_rib_equals_input_exactly() -> None:
    """Invariant: skin + rib == input weight, within IEEE-754 ε.
    Necessary for output_validator C-9 (skin+rib === weight to ±0.001 kg)."""
    for w in [12.49, 8.75, 44.16, 100.0, 0.0, 1e-9, 1234.5678]:
        skin, rib = compute_skin_rib_split(w)
        assert math.isclose(skin + rib, w, rel_tol=1e-12, abs_tol=1e-12)


def test_skin_rib_fractions_match_constants() -> None:
    """Split must use SKIN_FRACTION (0.60) and RIB_FRACTION (0.40) exactly."""
    skin, rib = compute_skin_rib_split(100.0)
    assert skin == 100.0 * SKIN_FRACTION
    assert rib == 100.0 * RIB_FRACTION


def test_skin_rib_zero_input() -> None:
    skin, rib = compute_skin_rib_split(0.0)
    assert skin == 0.0
    assert rib == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# compute_panel_price_inr
# ──────────────────────────────────────────────────────────────────────────────


def test_price_for_p_int_8_vertical() -> None:
    """9.68 sft × ₹225 ≈ ₹2178.24 (DESIGN §8.1)."""
    area = compute_panel_area_sqft(2998, 300)
    price = compute_panel_price_inr(area)
    assert price == pytest.approx(2178.24, abs=0.01)


def test_price_for_p_int_8_horizontal() -> None:
    """6.78 sft × ₹225 ≈ ₹1526.51."""
    area = compute_panel_area_sqft(2101, 300)
    price = compute_panel_price_inr(area)
    assert price == pytest.approx(1526.51, abs=0.01)


def test_price_flat_rate_locked_at_225() -> None:
    """Karthik 2026-05-23 17:58 — ₹225 flat for all thicknesses."""
    assert compute_panel_price_inr(1.0) == PRICE_PER_SFT_INR


def test_price_zero_area() -> None:
    assert compute_panel_price_inr(0.0) == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# compute_raw_weight_kg (R6 — long horizontals supported)
# ──────────────────────────────────────────────────────────────────────────────


def test_raw_weight_for_standard_vertical_panel() -> None:
    """3048mm × 300mm × 110mm: standard raw stock → 12.70 kg per panel."""
    raw = compute_raw_weight_kg(3048, 300, 110)
    assert raw == pytest.approx(12.70, abs=0.01)


def test_raw_weight_for_short_horizontal_uses_full_raw() -> None:
    """2101mm cut horizontal but raw_length=3048 (cut ≤ raw, one stock piece).
    Per R6: raw_length passed by caller; this function just multiplies."""
    raw = compute_raw_weight_kg(3048, 300, 110)
    assert raw == pytest.approx(12.70, abs=0.01)


def test_raw_weight_for_long_horizontal_p_ext_3() -> None:
    """R6 INTEGRATED: BT155-9370 → raw_length=ceil(9370/3048)*3048=12192mm (4 pieces).
    raw_weight = (12192 × 300 / 92903.04) × 1.46 ≈ 57.48 kg (DESIGN §8.2)."""
    raw = compute_raw_weight_kg(12192, 300, 155)
    assert raw == pytest.approx(57.48, abs=0.01)


def test_raw_weight_raises_on_non_standard_thickness() -> None:
    with pytest.raises(ValueError):
        compute_raw_weight_kg(3048, 300, 180)


# ──────────────────────────────────────────────────────────────────────────────
# compute_waste_kg
# ──────────────────────────────────────────────────────────────────────────────


def test_waste_for_p_int_8_vertical() -> None:
    """raw 12.70 - installed 12.49 = 0.21 kg waste (DESIGN §8.1)."""
    waste = compute_waste_kg(12.70, 12.49)
    assert waste == pytest.approx(0.21, abs=0.01)


def test_waste_for_p_int_8_horizontal() -> None:
    """raw 12.70 - installed 8.75 = 3.94 kg waste (more waste because cut is shorter)."""
    waste = compute_waste_kg(12.70, 8.75)
    assert waste == pytest.approx(3.94, abs=0.01)


def test_waste_for_p_ext_3_long_horizontal_with_design_doc_values() -> None:
    """Tests the SUBTRACTION using whatever inputs come in — function-level only.
    Math: 57.48 - 44.16 = 13.32 (these are DESIGN.md's claimed rounded values)."""
    assert compute_waste_kg(57.48, 44.16) == pytest.approx(13.32, abs=0.001)


def test_waste_for_p_ext_3_long_horizontal_math_derived() -> None:
    """End-to-end math, NOT DESIGN's transcription:
        installed = 44.1757 kg (math, 2dp = 44.18)
        raw       = 57.4803 kg (math, 2dp = 57.48)
        waste     = raw - installed = 13.3046 → 13.30 at 2dp.

    DESIGN.md §8.2 prints waste=13.32, which uses DESIGN's pre-rounded weight
    (44.16) rather than the math-derived weight (44.18). The mapper computes
    13.30 cleanly. Surfaced in PR 2 report; DESIGN-doc patch recommended.
    """
    waste = compute_waste_kg(57.480315, 44.175734)
    assert waste == pytest.approx(13.30, abs=0.005)


def test_waste_is_pure_subtraction_no_guard() -> None:
    """Function performs raw_weight - installed_weight without guarding. A
    negative waste indicates an upstream algorithm bug; output_validator C-16
    catches that — not this pure function."""
    assert compute_waste_kg(10.0, 15.0) == -5.0   # passes through cleanly


# ──────────────────────────────────────────────────────────────────────────────
# compute_panel_metrics — the convenience aggregator
# ──────────────────────────────────────────────────────────────────────────────


def test_compute_panel_metrics_p_int_8_canonical() -> None:
    """The flagship test from the PR 2 prompt:
       compute_panel_metrics(2998, 3048, 300, 110) must round to DESIGN §8.1 values."""
    m = compute_panel_metrics(2998, 3048, 300, 110)
    assert m["area_sqft"] == pytest.approx(9.68, abs=0.01)
    assert m["weight_kg"] == pytest.approx(12.49, abs=0.01)
    assert m["weight_kg_skin"] == pytest.approx(7.49, abs=0.01)
    assert m["weight_kg_rib"] == pytest.approx(5.00, abs=0.01)
    assert m["raw_weight_kg"] == pytest.approx(12.70, abs=0.01)
    assert m["waste_weight_kg"] == pytest.approx(0.21, abs=0.01)
    assert m["price_inr"] == pytest.approx(2178.24, abs=0.01)


def test_compute_panel_metrics_p_int_8_horizontal() -> None:
    """P_INT_8 horizontal (BT110-2101 / TC110-2101): 2101×300×110."""
    m = compute_panel_metrics(2101, 3048, 300, 110)
    assert m["area_sqft"] == pytest.approx(6.78, abs=0.01)
    assert m["weight_kg"] == pytest.approx(8.75, abs=0.01)
    assert m["weight_kg_skin"] == pytest.approx(5.25, abs=0.01)
    assert m["weight_kg_rib"] == pytest.approx(3.50, abs=0.01)
    assert m["raw_weight_kg"] == pytest.approx(12.70, abs=0.01)
    assert m["waste_weight_kg"] == pytest.approx(3.94, abs=0.01)
    assert m["price_inr"] == pytest.approx(1526.51, abs=0.01)


def test_compute_panel_metrics_p_ext_3_long_horizontal_r6() -> None:
    """P_EXT_3 BT155-9370: 9370mm cut, 12192mm raw (4 stock pieces), 300×155.

    Values below are MATH-DERIVED (full precision then rounded to 2dp).
    DESIGN.md §8.2 has transcription errors here — price drift ₹1.86,
    weight drift 0.02 — surfaced in PR 2 report. The mapper computes
    these values correctly; DESIGN-doc patch recommended.

    Full-precision values:
        area_sqft       = 30.257352
        weight_kg       = 44.175734
        weight_kg_skin  = 26.505441
        weight_kg_rib   = 17.670294
        raw_weight_kg   = 57.480315
        waste_weight_kg = 13.304581
        price_inr       = 6807.904241
    """
    m = compute_panel_metrics(9370, 12192, 300, 155)
    assert m["area_sqft"] == pytest.approx(30.26, abs=0.005)         # DESIGN: 30.25 (typo)
    assert m["weight_kg"] == pytest.approx(44.18, abs=0.005)         # DESIGN: 44.16 (typo)
    assert m["weight_kg_skin"] == pytest.approx(26.51, abs=0.005)    # DESIGN: 26.50 (typo)
    assert m["weight_kg_rib"] == pytest.approx(17.67, abs=0.005)     # DESIGN: 17.67 ✓
    assert m["raw_weight_kg"] == pytest.approx(57.48, abs=0.005)     # DESIGN: 57.48 ✓
    assert m["waste_weight_kg"] == pytest.approx(13.30, abs=0.005)   # DESIGN: 13.32 (typo)
    assert m["price_inr"] == pytest.approx(6807.90, abs=0.01)        # DESIGN: 6806.04 (drift ₹1.86)


def test_compute_panel_metrics_keys_match_panel_dataclass() -> None:
    """The dict keys must match Panel dataclass field names exactly so the
    orchestrator can `Panel(**metrics, ...)`."""
    m = compute_panel_metrics(2998, 3048, 300, 110)
    expected_keys = {
        "area_sqft",
        "weight_kg",
        "weight_kg_skin",
        "weight_kg_rib",
        "raw_weight_kg",
        "waste_weight_kg",
        "price_inr",
    }
    assert set(m.keys()) == expected_keys


def test_compute_panel_metrics_self_consistent_with_individual_calls() -> None:
    """compute_panel_metrics must produce the same values as composing the
    individual function calls."""
    m = compute_panel_metrics(2998, 3048, 300, 110)
    expected_area = compute_panel_area_sqft(2998, 300)
    expected_weight = compute_panel_weight_kg(expected_area, 110)
    expected_skin, expected_rib = compute_skin_rib_split(expected_weight)
    expected_raw = compute_raw_weight_kg(3048, 300, 110)
    expected_waste = compute_waste_kg(expected_raw, expected_weight)
    expected_price = compute_panel_price_inr(expected_area)
    assert m["area_sqft"] == expected_area
    assert m["weight_kg"] == expected_weight
    assert m["weight_kg_skin"] == expected_skin
    assert m["weight_kg_rib"] == expected_rib
    assert m["raw_weight_kg"] == expected_raw
    assert m["waste_weight_kg"] == expected_waste
    assert m["price_inr"] == expected_price


def test_compute_panel_metrics_invariant_skin_plus_rib_equals_weight() -> None:
    """Output_validator C-9 needs this to hold for every panel."""
    for params in [
        (2998, 3048, 300, 110),
        (2101, 3048, 300, 110),
        (9370, 12192, 300, 155),
        (2998, 3048, 70, 155),
        (3500, 3048, 300, 200),
    ]:
        m = compute_panel_metrics(*params)
        assert math.isclose(
            m["weight_kg_skin"] + m["weight_kg_rib"],
            m["weight_kg"],
            rel_tol=1e-12,
            abs_tol=1e-12,
        )


def test_compute_panel_metrics_invariant_raw_ge_installed() -> None:
    """For valid inputs (raw ≥ cut), waste must be ≥ 0."""
    for cut, raw in [(2998, 3048), (2101, 3048), (9370, 12192)]:
        m = compute_panel_metrics(cut, raw, 300, 110)
        assert m["raw_weight_kg"] >= m["weight_kg"]
        assert m["waste_weight_kg"] >= 0


def test_compute_panel_metrics_raises_on_invalid_thickness() -> None:
    with pytest.raises(ValueError):
        compute_panel_metrics(2998, 3048, 300, 180)


# ──────────────────────────────────────────────────────────────────────────────
# Determinism — same input ⇒ exact same float-bit output
# ──────────────────────────────────────────────────────────────────────────────


def test_determinism_repeated_calls_produce_identical_floats() -> None:
    """Pure functions must produce bit-stable output across repeated invocations."""
    results = [compute_panel_metrics(2998, 3048, 300, 110) for _ in range(10)]
    first = results[0]
    for r in results[1:]:
        for k in first:
            assert r[k] == first[k]   # exact float equality
