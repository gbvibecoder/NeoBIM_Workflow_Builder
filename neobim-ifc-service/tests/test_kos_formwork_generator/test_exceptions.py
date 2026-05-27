"""Tests for exceptions.py — 4 exception classes."""
from __future__ import annotations

import pytest

from app.services.kos_formwork_generator.exceptions import (
    FormworkConfigError,
    FormworkError,
    FormworkInputError,
    FormworkInvariantError,
)


# ═════════════════════════════════════════════════════════════════════
# FormworkError (base)
# ═════════════════════════════════════════════════════════════════════


class TestFormworkError:
    def test_error_code_class_attr(self):
        assert FormworkError.error_code == "FORMWORK_UNSPECIFIED"

    def test_instance_error_code(self):
        e = FormworkError("test")
        assert e.error_code == "FORMWORK_UNSPECIFIED"

    def test_message_stored(self):
        e = FormworkError("hello error")
        assert e.message == "hello error"
        assert str(e) == "hello error"

    def test_hint_default_none(self):
        e = FormworkError("test")
        assert e.hint is None

    def test_hint_stored(self):
        e = FormworkError("test", hint="try this")
        assert e.hint == "try this"

    def test_repr_includes_error_code(self):
        e = FormworkError("test")
        assert "FORMWORK_UNSPECIFIED" in repr(e)

    def test_repr_includes_message(self):
        e = FormworkError("specific msg")
        assert "specific msg" in repr(e)

    def test_repr_includes_hint(self):
        e = FormworkError("test", hint="hint text")
        assert "hint text" in repr(e)


# ═════════════════════════════════════════════════════════════════════
# Subclasses
# ═════════════════════════════════════════════════════════════════════


class TestFormworkConfigError:
    def test_error_code(self):
        e = FormworkConfigError("malformed")
        assert e.error_code == "FORMWORK_CONFIG_BROKEN"

    def test_is_formwork_error(self):
        e = FormworkConfigError("malformed")
        assert isinstance(e, FormworkError)


class TestFormworkInputError:
    def test_error_code(self):
        e = FormworkInputError("bad input")
        assert e.error_code == "FORMWORK_INPUT_INVALID"

    def test_is_formwork_error(self):
        e = FormworkInputError("bad input")
        assert isinstance(e, FormworkError)


# ═════════════════════════════════════════════════════════════════════
# FormworkInvariantError (has invariant_id)
# ═════════════════════════════════════════════════════════════════════


class TestFormworkInvariantError:
    def test_error_code(self):
        e = FormworkInvariantError("violated", invariant_id="F-7")
        assert e.error_code == "FORMWORK_OUTPUT_INVARIANT_VIOLATED"

    def test_invariant_id_required(self):
        with pytest.raises(TypeError):
            FormworkInvariantError("missing invariant_id")  # type: ignore[call-arg]

    def test_invariant_id_stored(self):
        e = FormworkInvariantError("test", invariant_id="F-3")
        assert e.invariant_id == "F-3"

    def test_can_have_hint(self):
        e = FormworkInvariantError("test", invariant_id="F-5", hint="check inputs")
        assert e.hint == "check inputs"

    def test_is_formwork_error(self):
        e = FormworkInvariantError("test", invariant_id="F-1")
        assert isinstance(e, FormworkError)

    def test_repr_includes_invariant_id(self):
        e = FormworkInvariantError("test", invariant_id="F-12")
        assert "F-12" in repr(e)


# ═════════════════════════════════════════════════════════════════════
# Raise + catch behavior
# ═════════════════════════════════════════════════════════════════════


class TestRaiseable:
    def test_base_raise(self):
        with pytest.raises(FormworkError):
            raise FormworkError("test")

    def test_config_raise(self):
        with pytest.raises(FormworkConfigError):
            raise FormworkConfigError("test")

    def test_input_raise(self):
        with pytest.raises(FormworkInputError):
            raise FormworkInputError("test")

    def test_invariant_raise(self):
        with pytest.raises(FormworkInvariantError):
            raise FormworkInvariantError("test", invariant_id="F-1")

    def test_subclass_caught_as_base(self):
        with pytest.raises(FormworkError):
            raise FormworkConfigError("test")

    def test_invariant_caught_as_base(self):
        with pytest.raises(FormworkError):
            raise FormworkInvariantError("test", invariant_id="F-1")

    def test_message_preserved_through_catch(self):
        try:
            raise FormworkInputError("specific msg")
        except FormworkError as e:
            assert e.message == "specific msg"
            assert str(e) == "specific msg"
