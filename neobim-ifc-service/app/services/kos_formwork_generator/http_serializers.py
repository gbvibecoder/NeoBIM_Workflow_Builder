"""HTTP serialization helpers for KOS Formwork Generator.

Converts inputs (mapper_output + context) between JSON dicts and frozen Python
dataclasses, and converts ``FormworkGeneratorOutput`` to a JSON-safe dict.

🚨 Mirrors BOQ's ``http_serializers.py`` recursive walker (Pre-flight B).
The mapper deserializer is functionally identical because both BOQ and 5F
consume the same ``PanelGridMapperOutput`` shape.

Recursion handles (via ``typing.get_type_hints`` to resolve
``from __future__ import annotations`` forward refs):

* Primitives (str, int, float, bool) — pass through atomically.
* ``Optional[X]`` / ``X | None`` / ``Union[X, None]`` — recurse on inner type.
* ``Literal[...]`` — pass through (value already validated against literal options).
* ``tuple[X, ...]`` — JSON list → tuple of converted X.
* ``dict[K, V]`` — restore int/float keys (JSON only has string keys); recurse on values.
* Nested dataclasses — recursive ``_dict_to_dataclass``.

Public API:

* ``format_formwork_output_json(output)`` — convert output → JSON-safe dict.
* ``dict_to_panel_grid_mapper_output(data)`` — convert mapper dict → dataclass.
* ``dict_to_formwork_context(data)`` — convert context dict → dataclass.

Pure module-level functions; no global state, no mutation of input.
"""
from __future__ import annotations

import dataclasses
import logging
import typing
from typing import Any, Type, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ═════════════════════════════════════════════════════════════════════
# TYPE-INTROSPECTION HELPERS (private)
# ═════════════════════════════════════════════════════════════════════


def _get_resolved_hints(cls: type) -> dict[str, Any]:
    """Return field type hints with forward refs resolved.

    Uses ``typing.get_type_hints`` (handles ``from __future__ import annotations``).
    Falls back to raw string annotations if resolution fails.
    """
    try:
        return typing.get_type_hints(cls)
    except (NameError, AttributeError, TypeError):
        return {f.name: f.type for f in dataclasses.fields(cls)}


def _is_union_with_none(field_type: Any) -> bool:
    """True for ``Optional[X]`` / ``Union[X, None]`` / ``X | None``."""
    args = typing.get_args(field_type)
    return bool(args) and type(None) in args


def _strip_none_from_union(field_type: Any) -> Any:
    """Extract X from ``Optional[X]`` / ``X | None``. Returns None when degenerate."""
    args = typing.get_args(field_type)
    non_none = [a for a in args if a is not type(None)]
    return non_none[0] if non_none else None


def _is_tuple_type(field_type: Any) -> bool:
    """True for ``tuple[X, ...]`` / ``Tuple[X, ...]``."""
    return typing.get_origin(field_type) is tuple


def _get_tuple_inner(field_type: Any) -> Any:
    """Return X from ``tuple[X, ...]``. Assumes homogeneous."""
    args = typing.get_args(field_type)
    return args[0] if args else None


def _is_dict_type(field_type: Any) -> bool:
    """True for ``dict[K, V]`` / ``Dict[K, V]``."""
    return typing.get_origin(field_type) is dict


def _get_dict_key_value_types(field_type: Any) -> tuple[Any, Any]:
    """Return (key_type, value_type) for ``dict[K, V]``. Defaults to (Any, Any)."""
    args = typing.get_args(field_type)
    if len(args) >= 2:
        return args[0], args[1]
    return Any, Any


# ═════════════════════════════════════════════════════════════════════
# RECURSIVE VALUE CONVERSION (dict → dataclass)
# ═════════════════════════════════════════════════════════════════════


def _convert_value(field_type: Any, value: Any) -> Any:
    """Recursively convert a JSON-decoded value to match ``field_type``.

    Pure function. Raises TypeError/ValueError on structural mismatch.
    """
    if value is None:
        return None

    if _is_union_with_none(field_type):
        inner = _strip_none_from_union(field_type)
        if inner is None:
            return value
        return _convert_value(inner, value)

    if _is_tuple_type(field_type):
        inner = _get_tuple_inner(field_type)
        if inner is None:
            return tuple(value)
        return tuple(_convert_value(inner, item) for item in value)

    if _is_dict_type(field_type):
        # JSON only supports string keys; restore declared key type (e.g.,
        # dict[int, int] for TotalCounts.by_thickness) and recurse on values.
        key_type, value_type = _get_dict_key_value_types(field_type)
        return {
            (key_type(k) if key_type in (int, float) else k):
                _convert_value(value_type, v)
            for k, v in value.items()
        }

    if dataclasses.is_dataclass(field_type):
        return _dict_to_dataclass(field_type, value)

    # Primitives, Literal[...], Any — pass through.
    return value


def _dict_to_dataclass(cls: Type[T], data: Any) -> T:
    """Convert a dict to a dataclass instance, recursively.

    Args:
        cls: Target dataclass type.
        data: dict (typically from ``json.loads``).

    Returns:
        Instance of ``cls`` with all nested types correctly constructed.

    Raises:
        TypeError: ``data`` is not a dict, or a required field is missing and
            has no default (dataclass constructor raises).
        ValueError: conversion of a specific field failed.
    """
    if data is None:
        return None  # type: ignore[return-value]

    if not dataclasses.is_dataclass(cls):
        return data  # type: ignore[return-value]

    if not isinstance(data, dict):
        raise TypeError(
            f"Expected dict for dataclass {cls.__name__}, "
            f"got {type(data).__name__}: {data!r}"
        )

    hints = _get_resolved_hints(cls)
    kwargs: dict[str, Any] = {}

    for field_name, field_type in hints.items():
        if field_name not in data:
            # Missing field — let dataclass constructor handle (raises TypeError
            # if required without default; uses default otherwise).
            continue
        try:
            kwargs[field_name] = _convert_value(field_type, data[field_name])
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Failed to convert field {cls.__name__}.{field_name} "
                f"(type {field_type}): {exc}"
            ) from exc

    return cls(**kwargs)


# ═════════════════════════════════════════════════════════════════════
# SERIALIZATION — output → JSON-safe dict
# ═════════════════════════════════════════════════════════════════════


def _normalize_tuples_to_lists(obj: Any) -> Any:
    """Recursively convert tuples → lists for JSON-shape consistency.

    Handles:
      - dict: recurse into values
      - tuple: convert to list (recursing into elements)
      - list: recurse into items
      - str, int, float, bool, None, bytes: pass through atomically

    🚨 CRITICAL: strings are iterable but ATOMIC — must NOT recurse into chars.
    """
    if isinstance(obj, dict):
        return {k: _normalize_tuples_to_lists(v) for k, v in obj.items()}
    if isinstance(obj, tuple):
        return [_normalize_tuples_to_lists(v) for v in obj]
    if isinstance(obj, list):
        return [_normalize_tuples_to_lists(v) for v in obj]
    return obj


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def dict_to_panel_grid_mapper_output(data: dict[str, Any]):
    """Convert a JSON-decoded mapper-output dict → ``PanelGridMapperOutput``.

    Lazy import to avoid circular import risk at module load.

    Raises:
        TypeError, ValueError, KeyError: on structural mismatch.
    """
    from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput
    return _dict_to_dataclass(PanelGridMapperOutput, data)


def dict_to_formwork_context(data: dict[str, Any]):
    """Convert a JSON-decoded context dict → ``FormworkContext``.

    Lazy import to avoid circular import risk at module load.
    """
    from app.services.kos_formwork_generator.types import FormworkContext
    return _dict_to_dataclass(FormworkContext, data)


def format_formwork_output_json(output) -> dict[str, Any]:
    """Convert ``FormworkGeneratorOutput`` → JSON-safe dict.

    Returns a dict where:
      * All tuples are converted to lists (recursively).
      * All nested dataclasses are dicts.
      * Strings, primitives, None pass through atomically.

    🚨 The tuple→list normalization is necessary for stable dict equality in
    unit tests (golden JSON has lists; ``dataclasses.asdict`` keeps tuples for
    fields whose type was `tuple[...]`). FastAPI's encoder would normalize
    these too — running normalization here is idempotent and harmless.

    Args:
        output: ``FormworkGeneratorOutput`` instance.

    Returns:
        JSON-safe dict ready for ``json.dumps`` or FastAPI ``JSONResponse``.

    Raises:
        TypeError: if input is not a ``FormworkGeneratorOutput`` instance.
    """
    # Lazy import to avoid circular at module load
    from app.services.kos_formwork_generator.types import FormworkGeneratorOutput

    if not isinstance(output, FormworkGeneratorOutput):
        raise TypeError(
            f"format_formwork_output_json expects FormworkGeneratorOutput, "
            f"got {type(output).__name__}"
        )

    raw = dataclasses.asdict(output)
    normalized = _normalize_tuples_to_lists(raw)
    logger.debug("Serialized formwork_id=%s", output.formwork_id)
    return normalized
