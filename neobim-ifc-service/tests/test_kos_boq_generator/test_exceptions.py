"""Tests for ``app.services.kos_boq_generator.exceptions``.

Verifies the 4-class BOQError tree and the stable ``error_code`` attribute
each subclass carries.
"""

from __future__ import annotations

import pytest

from app.services.kos_boq_generator import (
    BOQConfigError,
    BOQError,
    BOQInputError,
    BOQInvariantError,
)


# ──────────────────────────────────────────────────────────────────────────────
# Subclass tree integrity
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_error_is_subclass_of_exception() -> None:
    assert issubclass(BOQError, Exception)


def test_boq_input_error_subclass_of_boq_error() -> None:
    assert issubclass(BOQInputError, BOQError)


def test_boq_invariant_error_subclass_of_boq_error() -> None:
    assert issubclass(BOQInvariantError, BOQError)


def test_boq_config_error_subclass_of_boq_error() -> None:
    assert issubclass(BOQConfigError, BOQError)


# ──────────────────────────────────────────────────────────────────────────────
# error_code stability — clients switch on these strings
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_error_code_is_boq_unspecified() -> None:
    assert BOQError.error_code == "BOQ_UNSPECIFIED"


def test_boq_input_error_code_is_boq_input_invalid() -> None:
    assert BOQInputError.error_code == "BOQ_INPUT_INVALID"


def test_boq_invariant_error_code_is_boq_output_invariant_violated() -> None:
    assert BOQInvariantError.error_code == "BOQ_OUTPUT_INVARIANT_VIOLATED"


def test_boq_config_error_code_is_boq_config_broken() -> None:
    assert BOQConfigError.error_code == "BOQ_CONFIG_BROKEN"


def test_error_codes_all_distinct() -> None:
    """The 4 error_codes must be distinct strings — clients switch on them."""
    codes = {
        BOQError.error_code,
        BOQInputError.error_code,
        BOQInvariantError.error_code,
        BOQConfigError.error_code,
    }
    assert len(codes) == 4


# ──────────────────────────────────────────────────────────────────────────────
# Constructor + attribute behavior
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_error_message_preserved() -> None:
    """Standard ``str(exc)`` returns the message."""
    err = BOQError("something went wrong")
    assert str(err) == "something went wrong"


def test_boq_error_with_no_hint_is_none() -> None:
    err = BOQError("foo")
    assert err.hint is None


def test_boq_error_with_hint_kwarg() -> None:
    err = BOQError("foo", hint="try frobbing the bar")
    assert err.hint == "try frobbing the bar"


def test_boq_input_error_carries_hint() -> None:
    """Hint propagates through ``BOQInputError`` ctor (inherited)."""
    err = BOQInputError("project_id is empty", hint="provide a non-empty string")
    assert err.hint == "provide a non-empty string"


def test_boq_invariant_error_carries_invariant_id() -> None:
    """``invariant_id`` attribute is set + accessible."""
    err = BOQInvariantError(
        "Tier 4 sum drifted from Tier 1",
        invariant_id="B-1",
    )
    assert err.invariant_id == "B-1"


def test_boq_invariant_error_carries_message() -> None:
    """The message body propagates through ``str(exc)``."""
    msg = "B-6 tax arithmetic failure: 21594.82 ≠ 21594.81 (diff 0.01)"
    err = BOQInvariantError(msg, invariant_id="B-6")
    assert msg in str(err)


def test_boq_invariant_error_carries_hint_optional() -> None:
    err = BOQInvariantError(
        "B-15 fail",
        invariant_id="B-15",
        hint="check Indian comma formatter",
    )
    assert err.hint == "check Indian comma formatter"


def test_boq_invariant_error_hint_defaults_to_none() -> None:
    err = BOQInvariantError("B-15 fail", invariant_id="B-15")
    assert err.hint is None


def test_boq_config_error_carries_hint() -> None:
    err = BOQConfigError(
        "mapper re-export broken",
        hint="check kos_panel_grid_mapper.constants",
    )
    assert err.hint == "check kos_panel_grid_mapper.constants"


# ──────────────────────────────────────────────────────────────────────────────
# Exception catch semantics
# ──────────────────────────────────────────────────────────────────────────────


def test_boq_input_error_caught_as_boq_error() -> None:
    """Router can catch BOQError to handle any BOQ-originated error."""
    with pytest.raises(BOQError):
        raise BOQInputError("test")


def test_boq_invariant_error_caught_as_boq_error() -> None:
    with pytest.raises(BOQError):
        raise BOQInvariantError("test", invariant_id="B-1")


def test_boq_config_error_caught_as_boq_error() -> None:
    with pytest.raises(BOQError):
        raise BOQConfigError("test")


def test_boq_error_subclasses_distinct_in_isinstance() -> None:
    """Specific catches don't bleed into each other."""
    input_err = BOQInputError("a")
    invariant_err = BOQInvariantError("b", invariant_id="B-1")
    config_err = BOQConfigError("c")

    assert isinstance(input_err, BOQInputError)
    assert not isinstance(input_err, BOQInvariantError)
    assert not isinstance(invariant_err, BOQInputError)
    assert not isinstance(config_err, BOQInputError)
