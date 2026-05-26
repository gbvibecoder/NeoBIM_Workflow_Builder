"""HTTP serialization helpers for KOS BOQ Generator.

Converts BOQ inputs (mapper output + context) between JSON dicts and frozen
Python dataclasses. Uses ``typing.get_type_hints`` to resolve string
annotations (needed because the schema modules use
``from __future__ import annotations``).

Recursion handles:
- Primitives (str, int, float, bool) — pass through.
- ``Optional[X]`` / ``X | None`` / ``Union[X, None]`` — detect via
  ``type(None) in get_args(t)``; recurse on the non-None inner type.
- ``Literal[...]`` — pass through (the JSON value already equals one of
  the literal options).
- ``tuple[X, ...]`` — convert input list → tuple of converted X.
- ``dict[K, V]`` — pass through (mapper uses dict[int, int] and
  dict[str, bool]; JSON deserializes both as dict already).
- Nested dataclasses — recursive ``_dict_to_dataclass`` call.

Used by ``app/routers/kos_boq_router.py``. Pure module-level functions;
no global state.

Source: PR 6 of BOQ Generator IMPLEMENT slice.
"""

from __future__ import annotations

import dataclasses
import typing
from typing import Any, Type, TypeVar


T = TypeVar("T")


# ─────────────────────────────────────────────────────────────────────────────
# Type-introspection helpers (private)
# ─────────────────────────────────────────────────────────────────────────────


def _get_resolved_hints(cls: type) -> dict[str, Any]:
    """Return field type hints with forward refs resolved.

    Uses ``typing.get_type_hints`` (handles ``from __future__ import
    annotations``). Falls back to raw ``dataclass.fields().type`` strings
    if resolution fails (e.g., circular forward refs that can't resolve).
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
    """Extract X from ``Optional[X]`` / ``X | None``. Returns None if no
    non-None type exists (degenerate case; should not occur in practice).
    """
    args = typing.get_args(field_type)
    non_none = [a for a in args if a is not type(None)]
    return non_none[0] if non_none else None


def _is_tuple_type(field_type: Any) -> bool:
    """True for ``tuple[X, ...]`` / ``tuple[X, Y, Z]``."""
    return typing.get_origin(field_type) is tuple


def _get_tuple_inner(field_type: Any) -> Any:
    """Return X from ``tuple[X, ...]``. Assumes homogeneous tuple
    (which all BOQ/mapper schemas use)."""
    args = typing.get_args(field_type)
    return args[0] if args else None


def _is_dict_type(field_type: Any) -> bool:
    """True for ``dict[K, V]``."""
    return typing.get_origin(field_type) is dict


def _get_dict_key_value_types(field_type: Any) -> tuple[Any, Any]:
    """Return (key_type, value_type) for ``dict[K, V]``. Defaults to (Any, Any)."""
    args = typing.get_args(field_type)
    if len(args) >= 2:
        return args[0], args[1]
    return Any, Any


# ─────────────────────────────────────────────────────────────────────────────
# Recursive value conversion
# ─────────────────────────────────────────────────────────────────────────────


def _convert_value(field_type: Any, value: Any) -> Any:
    """Recursively convert a JSON-decoded value to match ``field_type``.

    Pure function. Raises ``TypeError`` / ``ValueError`` if conversion is
    impossible (e.g., expecting a dict for a nested dataclass and getting
    a list).
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
        # JSON only supports string keys; restore the declared key type
        # (e.g., dict[int, int] for TotalCounts.by_thickness) and recurse
        # on values in case they're dataclasses.
        key_type, value_type = _get_dict_key_value_types(field_type)
        return {
            (key_type(k) if key_type in (int, float) else k):
                _convert_value(value_type, v)
            for k, v in value.items()
        }

    if dataclasses.is_dataclass(field_type):
        return _dict_to_dataclass(field_type, value)

    # Primitives, Literal[...], or anything else — pass through.
    # (Literals are already validated strings/numbers.)
    return value


def _dict_to_dataclass(cls: Type[T], data: Any) -> T:
    """Convert a dict to a dataclass instance, recursively.

    Args:
        cls: Target dataclass type.
        data: dict (typically from ``json.loads``).

    Returns:
        Instance of ``cls`` with all nested types correctly constructed.

    Raises:
        TypeError: ``data`` is not a dict, or a required dataclass field
            is missing and has no default.
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
            # Missing field — let the dataclass constructor decide
            # (raises TypeError if required, uses default otherwise).
            continue
        try:
            kwargs[field_name] = _convert_value(field_type, data[field_name])
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Failed to convert field {cls.__name__}.{field_name} "
                f"(type {field_type}): {exc}"
            ) from exc

    return cls(**kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Public API (used by app/routers/kos_boq_router.py)
# ─────────────────────────────────────────────────────────────────────────────


def dict_to_panel_grid_mapper_output(data: dict[str, Any]):
    """Convert a JSON-decoded mapper-output dict → ``PanelGridMapperOutput``.

    Lazy import to avoid circular import risk at module load.
    """
    from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput
    return _dict_to_dataclass(PanelGridMapperOutput, data)


def dict_to_boq_context(data: dict[str, Any]):
    """Convert a JSON-decoded context dict → ``BOQContext``."""
    from app.services.kos_boq_generator.types import BOQContext
    return _dict_to_dataclass(BOQContext, data)


def boq_output_to_dict(output) -> dict[str, Any]:
    """Convert ``BOQGeneratorOutput`` → JSON-serializable dict.

    Uses ``dataclasses.asdict`` (recursive; preserves all 16 fields).
    Pre-flight B Part 2 verified FastAPI's encoder produces the same
    shape as stdlib ``json`` for tuple → list conversion, so no further
    normalization is needed here.
    """
    return dataclasses.asdict(output)
