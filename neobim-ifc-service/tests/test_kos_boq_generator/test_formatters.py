"""Tests for ``formatters`` — Indian comma + quote synth + date arithmetic.

Coverage:

* **Indian comma**: all 22 boundary cases from prompt §3.2 (anti-patterns
  #8, #9, #10, #11)
* **Quote number**: synth format + various project_id shapes (anti-pattern #13)
* **Quote validity date**: leap years, month/year rollover (anti-pattern #12)

All tests are pure: no fixtures, no I/O, no random.
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator.formatters import (
    compute_quote_validity_until,
    format_indian_comma,
    synth_quote_number,
)


# ──────────────────────────────────────────────────────────────────────────────
# Indian comma — all 22 boundary tests (prompt §3.2)
# ──────────────────────────────────────────────────────────────────────────────


def test_format_indian_comma_zero() -> None:
    """#1 — zero."""
    assert format_indian_comma(0.0) == "₹0.00"


def test_format_indian_comma_0_001_below_half_rounds_to_zero() -> None:
    """#2 — 0.001 below half rounds down (Decimal half-up)."""
    assert format_indian_comma(0.001) == "₹0.00"


def test_format_indian_comma_0_004_below_half_rounds_down() -> None:
    """#3 — 0.004 below half rounds down."""
    assert format_indian_comma(0.004) == "₹0.00"


def test_format_indian_comma_0_005_half_up_rounds_up() -> None:
    """#4 — 0.005 half-up rounds UP (NOT Python's banker's-to-zero)."""
    assert format_indian_comma(0.005) == "₹0.01"


def test_format_indian_comma_0_006_above_half_rounds_up() -> None:
    """#5 — 0.006 above half rounds up."""
    assert format_indian_comma(0.006) == "₹0.01"


def test_format_indian_comma_0_50_basic() -> None:
    """#6 — half-rupee basic."""
    assert format_indian_comma(0.5) == "₹0.50"


def test_format_indian_comma_0_99() -> None:
    """#7 — just below rupee."""
    assert format_indian_comma(0.99) == "₹0.99"


def test_format_indian_comma_0_995_half_up_boundary_carries_to_one() -> None:
    """#8 — half-up boundary carries integer (0.995 → 1.00)."""
    assert format_indian_comma(0.995) == "₹1.00"


def test_format_indian_comma_1_00() -> None:
    """#9 — exact rupee."""
    assert format_indian_comma(1.0) == "₹1.00"


def test_format_indian_comma_99_99() -> None:
    """#10 — two-digit before comma."""
    assert format_indian_comma(99.99) == "₹99.99"


def test_format_indian_comma_100_00() -> None:
    """#11 — three-digit, no comma yet."""
    assert format_indian_comma(100.0) == "₹100.00"


def test_format_indian_comma_999_99() -> None:
    """#12 — three-digit max, still no comma."""
    assert format_indian_comma(999.99) == "₹999.99"


def test_format_indian_comma_1000_thousand_separator() -> None:
    """#13 — first comma at thousand (Indian: last 3 digits unbroken)."""
    assert format_indian_comma(1000.0) == "₹1,000.00"


def test_format_indian_comma_99999_99() -> None:
    """#14 — pre-lakh."""
    assert format_indian_comma(99999.99) == "₹99,999.99"


def test_format_indian_comma_100000_lakh_boundary() -> None:
    """#15 — lakh boundary (1,00,000 NOT 100,000)."""
    assert format_indian_comma(100000.0) == "₹1,00,000.00"


def test_format_indian_comma_999999_99() -> None:
    """#16 — pre-10-lakh."""
    assert format_indian_comma(999999.99) == "₹9,99,999.99"


def test_format_indian_comma_10000000_crore_boundary() -> None:
    """#17 — crore boundary (1,00,00,000 NOT 10,000,000)."""
    assert format_indian_comma(10000000.0) == "₹1,00,00,000.00"


def test_format_indian_comma_21594_82_p_int_8_grand_total() -> None:
    """#18 — P_INT_8 grand total (PR 3 golden contract)."""
    assert format_indian_comma(21594.82) == "₹21,594.82"


def test_format_indian_comma_1359743_23_90vr_grand_total() -> None:
    """#19 — 90VR-MR grand total (CONTEXT_CONFIRMED Step 0 baseline)."""
    assert format_indian_comma(1359743.23) == "₹13,59,743.23"


def test_format_indian_comma_negative_minus_before_symbol() -> None:
    """#20 — negative: minus BEFORE ₹ symbol (anti-pattern #10)."""
    assert format_indian_comma(-1500.0) == "-₹1,500.00"


def test_format_indian_comma_negative_rounds_to_zero_no_minus() -> None:
    """#21 — value that rounds to zero: NO spurious '-₹0.00'."""
    assert format_indian_comma(-0.0001) == "₹0.00"


def test_format_indian_comma_1234567890_12_very_large() -> None:
    """#22 — very large (100 crore territory)."""
    assert format_indian_comma(1234567890.12) == "₹1,23,45,67,890.12"


# Additional edge case: half-up at higher digits
def test_format_indian_comma_half_up_consistency() -> None:
    """Verify Decimal half-up (NOT Python's banker's rounding to even)."""
    # round(0.5) in Python returns 0 (banker's); our formatter must return 1
    assert format_indian_comma(0.5) == "₹0.50"
    # Banker would round 0.005 to 0.00 too; we go up
    assert format_indian_comma(0.005) == "₹0.01"
    # Banker would round 1.5 → 2.0; check 1.005 → 1.01 (not 1.00)
    assert format_indian_comma(1.005) == "₹1.01"


# Additional edge case: very small negative carries to zero (no minus)
def test_format_indian_comma_negative_005_rounds_to_minus_01() -> None:
    """Negative 0.005 rounds half-up to -0.01 (becomes '-₹0.01' with minus)."""
    # Decimal half-up on -0.005 yields -0.01 (away from zero direction).
    assert format_indian_comma(-0.005) == "-₹0.01"


# ──────────────────────────────────────────────────────────────────────────────
# Quote number synth — anti-pattern #13
# ──────────────────────────────────────────────────────────────────────────────


def test_synth_quote_number_format_matches_template() -> None:
    """Format: Q-{project_id}-001-{YYYYMMDD}."""
    assert synth_quote_number("P_INT_8_TEST", "2026-05-25") == (
        "Q-P_INT_8_TEST-001-20260525"
    )


def test_synth_quote_number_date_compaction() -> None:
    """Dashes stripped from ISO date for the compact form."""
    result = synth_quote_number("X", "2025-12-31")
    assert "20251231" in result
    assert "2025-12-31" not in result


def test_synth_quote_number_p_int_8_matches_golden() -> None:
    """P_INT_8 golden quote_number contract."""
    assert synth_quote_number("P_INT_8_TEST", "2026-05-25") == (
        "Q-P_INT_8_TEST-001-20260525"
    )


def test_synth_quote_number_with_hyphenated_project_id() -> None:
    """Project IDs may contain hyphens — preserve them."""
    result = synth_quote_number("90VR-MR-001", "2026-05-25")
    assert result == "Q-90VR-MR-001-001-20260525"


def test_synth_quote_number_with_underscored_project_id() -> None:
    """Underscores preserved."""
    result = synth_quote_number("project_with_underscores", "2026-05-25")
    assert result == "Q-project_with_underscores-001-20260525"


def test_synth_quote_number_iso_date_no_dashes_in_output() -> None:
    """Compact date portion has no dashes."""
    result = synth_quote_number("X", "2026-01-01")
    # Date portion (last 8 chars) should be pure digits
    assert result.endswith("20260101")


# ──────────────────────────────────────────────────────────────────────────────
# Quote validity date — anti-pattern #12
# ──────────────────────────────────────────────────────────────────────────────


def test_compute_quote_validity_30_days_from_may_25() -> None:
    """P_INT_8 golden contract: May 25 + 30 = June 24."""
    assert compute_quote_validity_until("2026-05-25", 30) == "2026-06-24"


def test_compute_quote_validity_leap_year_feb_28_plus_1() -> None:
    """2024 is leap year: Feb 28 + 1 = Feb 29."""
    assert compute_quote_validity_until("2024-02-28", 1) == "2024-02-29"


def test_compute_quote_validity_non_leap_year_feb_28_plus_1() -> None:
    """2025 is NOT leap year: Feb 28 + 1 = Mar 1."""
    assert compute_quote_validity_until("2025-02-28", 1) == "2025-03-01"


def test_compute_quote_validity_month_rollover_jan_31_to_march() -> None:
    """Jan 31 + 30 days crosses into March (non-leap year)."""
    # 2025-01-31 + 30 days = 2025-03-02 (Jan has 31, Feb has 28 in non-leap)
    assert compute_quote_validity_until("2025-01-31", 30) == "2025-03-02"


def test_compute_quote_validity_year_rollover_dec_to_jan() -> None:
    """December + 30 days crosses year boundary."""
    assert compute_quote_validity_until("2026-12-15", 30) == "2027-01-14"


def test_compute_quote_validity_january_31_plus_30_days_handles_february_correctly() -> None:
    """Leap year version of above (2024 has Feb 29)."""
    # 2024-01-31 + 30 days = 2024-03-01 (Jan 31, Feb 29 in leap)
    assert compute_quote_validity_until("2024-01-31", 30) == "2024-03-01"


def test_compute_quote_validity_30_days_consistent_across_decade() -> None:
    """May 25 + 30 days = June 24, every year."""
    for year in ("2023", "2024", "2025", "2026", "2027"):
        assert compute_quote_validity_until(f"{year}-05-25", 30) == f"{year}-06-24"


def test_compute_quote_validity_one_day_basic() -> None:
    """+1 day basic case."""
    assert compute_quote_validity_until("2026-01-01", 1) == "2026-01-02"


def test_compute_quote_validity_zero_days_same_day() -> None:
    """Edge case: 0 days returns same date."""
    assert compute_quote_validity_until("2026-05-25", 0) == "2026-05-25"
