"""Tests for kos_panel_grid_mapper.exceptions — class hierarchy + error_code values."""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    CustomQuoteRequired,
    MapperError,
    MapperInputError,
    OutputInvariantError,
)


# ──────────────────────────────────────────────────────────────────────────────
# Each exception has a non-empty `error_code`
# ──────────────────────────────────────────────────────────────────────────────


def test_mapper_error_has_error_code() -> None:
    assert isinstance(MapperError.error_code, str)
    assert MapperError.error_code == "MAPPER_ERROR"


def test_mapper_input_error_has_error_code() -> None:
    assert isinstance(MapperInputError.error_code, str)
    assert MapperInputError.error_code == "MAPPER_INPUT_INVALID"


def test_output_invariant_error_has_error_code() -> None:
    assert isinstance(OutputInvariantError.error_code, str)
    assert OutputInvariantError.error_code == "MAPPER_OUTPUT_INVARIANT_FAILED"


def test_custom_quote_required_has_error_code() -> None:
    assert isinstance(CustomQuoteRequired.error_code, str)
    assert CustomQuoteRequired.error_code == "MAPPER_CUSTOM_QUOTE_REQUIRED"


# ──────────────────────────────────────────────────────────────────────────────
# Inheritance — every mapper error inherits MapperError → Exception
# ──────────────────────────────────────────────────────────────────────────────


def test_mapper_input_error_subclasses_mapper_error() -> None:
    assert issubclass(MapperInputError, MapperError)
    assert issubclass(MapperInputError, Exception)


def test_output_invariant_error_subclasses_mapper_error() -> None:
    assert issubclass(OutputInvariantError, MapperError)
    assert issubclass(OutputInvariantError, Exception)


def test_custom_quote_required_subclasses_mapper_error() -> None:
    assert issubclass(CustomQuoteRequired, MapperError)
    assert issubclass(CustomQuoteRequired, Exception)


# ──────────────────────────────────────────────────────────────────────────────
# CustomQuoteRequired carries wall_segment_id + thickness_mm
# ──────────────────────────────────────────────────────────────────────────────


def test_custom_quote_required_constructs_with_attrs() -> None:
    exc = CustomQuoteRequired(
        message="thickness 275mm > 250mm standard",
        wall_segment_id="P_EXT_7",
        thickness_mm=275.0,
    )
    assert exc.wall_segment_id == "P_EXT_7"
    assert exc.thickness_mm == 275.0
    assert "thickness 275mm" in str(exc)


def test_custom_quote_required_can_be_raised() -> None:
    with pytest.raises(CustomQuoteRequired) as exc_info:
        raise CustomQuoteRequired(
            message="thickness 300mm not in standard catalog",
            wall_segment_id="P_INT_3",
            thickness_mm=300.0,
        )
    assert exc_info.value.wall_segment_id == "P_INT_3"
    assert exc_info.value.thickness_mm == 300.0


def test_mapper_input_error_can_be_raised() -> None:
    with pytest.raises(MapperInputError):
        raise MapperInputError("walls list is empty")


def test_output_invariant_error_can_be_raised() -> None:
    with pytest.raises(OutputInvariantError):
        raise OutputInvariantError("C-1 length-sum check failed")


# ──────────────────────────────────────────────────────────────────────────────
# Error codes unique across the 4 exception classes
# ──────────────────────────────────────────────────────────────────────────────


def test_error_codes_unique() -> None:
    codes = {
        MapperError.error_code,
        MapperInputError.error_code,
        OutputInvariantError.error_code,
        CustomQuoteRequired.error_code,
    }
    assert len(codes) == 4, f"Duplicate error_codes: {codes}"
