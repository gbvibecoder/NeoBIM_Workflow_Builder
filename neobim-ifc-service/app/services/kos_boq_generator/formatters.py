"""Formatters — Indian comma INR + quote-number synth + quote-validity date math.

Source: 02_ALGORITHMS.md Problem 9 (Indian comma format).

Three pure utility functions:

* ``format_indian_comma(value: float) -> str``
    Format a rupee amount as ``₹X,XX,XXX.XX`` per Indian numbering convention.
    Uses ``decimal.Decimal`` half-up rounding (not Python's banker ``round()``).
    Handles negative values (minus before ₹), rounds-to-zero (no spurious "-₹0.00"),
    lakh and crore boundaries, and decimal-carry-over from rounding.

* ``synth_quote_number(project_id: str, quote_date_iso: str) -> str``
    Synthesize quote number from ``QUOTE_NUMBER_TEMPLATE`` constant.
    Used by Tier 1 when ``BOQContext.quote_number`` is ``None``.

* ``compute_quote_validity_until(quote_date_iso: str, days: int) -> str``
    Compute quote validity end date via ``date.fromisoformat()`` + ``timedelta``.
    Handles leap years, month rollover, year rollover correctly.

All three functions are PURE: no I/O, no ``random``, no ``datetime.now()``,
no ``time.time()``, no ``os.environ`` reads. Deterministic.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from .constants import QUOTE_NUMBER_TEMPLATE


# Indian rupee symbol — Unicode U+20B9. Inlined here (not in constants.py)
# because it only appears in this module's formatter output. Adding to
# constants.py would be over-abstraction for a single literal.
_INR_SYMBOL = "₹"


# ──────────────────────────────────────────────────────────────────────────────
# Indian comma INR formatter
#
# Pattern: ``₹X,XX,XXX.XX`` — last 3 digits of integer part, then groups of 2.
# Lakh boundary: 100,000 → "1,00,000". Crore boundary: 10,000,000 → "1,00,00,000".
# Decimal: always 2 places, half-up rounding via Decimal (NOT banker's).
#
# Sources:
# * 02_ALGORITHMS.md Problem 9
# * Anti-pattern #2 (Decimal half-up, not Python round())
# * Anti-pattern #9 (last-3-then-2s grouping)
# * Anti-pattern #10 (minus before ₹ for negatives)
# * Anti-pattern #11 (carry-over from rounding: 0.999 → "₹1.00")
# ──────────────────────────────────────────────────────────────────────────────


_QUANTIZE_TWO_PLACES = Decimal("0.01")


def format_indian_comma(value: float) -> str:
    """Format a float as Indian-comma rupee string ``₹X,XX,XXX.XX``.

    Args:
        value: rupee amount (may be negative or zero).

    Returns:
        Formatted string with ``₹`` prefix (or ``-₹`` for negatives).

    Examples:
        >>> format_indian_comma(0.0)
        '₹0.00'
        >>> format_indian_comma(21594.82)
        '₹21,594.82'
        >>> format_indian_comma(100000.0)        # lakh boundary
        '₹1,00,000.00'
        >>> format_indian_comma(10000000.0)      # crore boundary
        '₹1,00,00,000.00'
        >>> format_indian_comma(1359743.23)      # 90VR-MR grand total
        '₹13,59,743.23'
        >>> format_indian_comma(-1500.0)         # negative — minus before ₹
        '-₹1,500.00'
        >>> format_indian_comma(-0.0001)         # rounds to zero — no minus
        '₹0.00'
        >>> format_indian_comma(0.995)           # half-up carries over
        '₹1.00'
    """
    # Decimal(str(value)) — CRITICAL: avoids IEEE-754 noise from Decimal(float).
    # Decimal(0.1) gives 0.1000000000000000055511151231257827021181583404541015625;
    # Decimal(str(0.1)) gives Decimal("0.1") exactly.
    d = Decimal(str(value)).quantize(_QUANTIZE_TWO_PLACES, rounding=ROUND_HALF_UP)

    # Handle rounded-to-zero — including small negative inputs (anti-pattern #10
    # cousin: "-₹0.00" is wrong; the value rounded to zero is just zero).
    if d == 0:
        return f"{_INR_SYMBOL}0.00"

    # Truly negative: minus BEFORE the rupee symbol.
    if d < 0:
        return "-" + format_indian_comma(float(-d))

    # Split integer and 2-decimal-place portion. Integer cast is safe because
    # quantize ensures at most 2 decimals.
    integer_part = int(d)
    decimal_part = int((d - Decimal(integer_part)) * 100)

    # Apply Indian comma grouping: last 3 digits unbroken, then groups of 2.
    int_str = str(integer_part)
    if len(int_str) <= 3:
        formatted_int = int_str
    else:
        last_three = int_str[-3:]
        rest = int_str[:-3]
        # Groups of 2 from the right; prepend leading-shorter-group if odd.
        rest_groups: list[str] = []
        while len(rest) > 2:
            rest_groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            rest_groups.insert(0, rest)
        formatted_int = ",".join(rest_groups + [last_three])

    return f"{_INR_SYMBOL}{formatted_int}.{decimal_part:02d}"


# ──────────────────────────────────────────────────────────────────────────────
# Quote number synthesis
#
# Format (per PR 1's ``QUOTE_NUMBER_TEMPLATE`` constant):
#     ``Q-{project_id}-001-{date_compact}``
# Where ``date_compact`` is ``YYYYMMDD`` (no separators).
#
# Used by Tier 1's ``build_tier1_project_summary`` when caller's
# ``BOQContext.quote_number`` is ``None``.
#
# Source: 02_ALGORITHMS.md Problem 9 + Anti-pattern #13 (template-driven).
# ──────────────────────────────────────────────────────────────────────────────


def synth_quote_number(project_id: str, quote_date_iso: str) -> str:
    """Synthesize a quote number from project ID and ISO date.

    Args:
        project_id: caller-supplied project identifier (e.g. "P_INT_8_TEST").
        quote_date_iso: ISO 8601 date string (e.g. "2026-05-25").

    Returns:
        Formatted quote number (e.g. "Q-P_INT_8_TEST-001-20260525").

    Examples:
        >>> synth_quote_number("P_INT_8_TEST", "2026-05-25")
        'Q-P_INT_8_TEST-001-20260525'
        >>> synth_quote_number("90VR-MR-001", "2026-05-25")
        'Q-90VR-MR-001-001-20260525'
    """
    # Compact date format: strip dashes from ISO (2026-05-25 → 20260525).
    date_compact = quote_date_iso.replace("-", "")
    return QUOTE_NUMBER_TEMPLATE.format(
        project_id=project_id,
        date_compact=date_compact,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Quote validity date arithmetic
#
# Pure function using stdlib ``date.fromisoformat()`` + ``timedelta`` (which
# correctly handle leap years, month rollover, year rollover).
#
# NOT using ``datetime.now()`` — pure functional, deterministic.
#
# Source: 02_ALGORITHMS.md Problem 9 + Anti-pattern #12.
# ──────────────────────────────────────────────────────────────────────────────


def compute_quote_validity_until(quote_date_iso: str, days: int) -> str:
    """Compute the quote validity end date.

    Args:
        quote_date_iso: ISO 8601 date string for the quote date.
        days: number of days the quote is valid.

    Returns:
        ISO 8601 date string for the validity end date.

    Examples:
        >>> compute_quote_validity_until("2026-05-25", 30)    # +30 days
        '2026-06-24'
        >>> compute_quote_validity_until("2026-12-15", 30)    # year rollover
        '2027-01-14'
        >>> compute_quote_validity_until("2024-02-28", 1)     # leap year (Feb 29)
        '2024-02-29'
        >>> compute_quote_validity_until("2025-02-28", 1)     # non-leap (Mar 1)
        '2025-03-01'
        >>> compute_quote_validity_until("2026-01-31", 30)    # month rollover
        '2026-03-02'
    """
    d = date.fromisoformat(quote_date_iso)
    valid_until = d + timedelta(days=days)
    return valid_until.isoformat()
