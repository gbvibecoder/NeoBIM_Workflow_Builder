"""Tests for ``http_serializers`` — dataclass ↔ dict round-trip.

Verifies that the HTTP serialization layer preserves all PR 4 contracts:
- mapper output SHA-256 byte-equal (via asdict + canonical JSON)
- BOQ output 16-field structure
- Type-correct deserialization of Optional, Literal, tuple, dict, nested
"""

from __future__ import annotations

import dataclasses
import hashlib
import json

import pytest

from app.services.kos_boq_generator import (
    BOQContext,
    BOQGeneratorOutput,
    generate_boq,
)
from app.services.kos_boq_generator.http_serializers import (
    _convert_value,
    _dict_to_dataclass,
    _is_tuple_type,
    _is_union_with_none,
    boq_output_to_dict,
    dict_to_boq_context,
    dict_to_panel_grid_mapper_output,
)


# ──────────────────────────────────────────────────────────────────────────────
# 🚨 THE CRITICAL CONTRACT: HTTP serialization preserves PR 4 SHA-256
# ──────────────────────────────────────────────────────────────────────────────


def test_mapper_output_serialization_preserves_sha256(p_int_8_mapper_output) -> None:
    """🚨 CRITICAL: ``asdict(mapper) → canonical JSON → SHA-256`` matches PR 4 golden."""
    d = dataclasses.asdict(p_int_8_mapper_output)
    json_str = json.dumps(d, sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(json_str.encode("utf-8")).hexdigest()
    expected = "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"
    assert h == expected, (
        f"SHA-256 mismatch — HTTP serialization breaks PR 4 byte-equal contract!\n"
        f"  Computed: {h}\n"
        f"  Expected: {expected}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Round-trip tests
# ──────────────────────────────────────────────────────────────────────────────


def test_dict_to_boq_context_round_trip_p_int_8(boq_context_p_int_8) -> None:
    """Context → dict → context: dataclass equality holds."""
    d = dataclasses.asdict(boq_context_p_int_8)
    ctx_roundtrip = dict_to_boq_context(d)
    assert ctx_roundtrip == boq_context_p_int_8


def test_dict_to_panel_grid_mapper_output_round_trip_p_int_8(
    p_int_8_mapper_output,
) -> None:
    """Mapper output → dict → mapper output: dataclass equality holds."""
    d = json.loads(json.dumps(dataclasses.asdict(p_int_8_mapper_output)))
    mapper_roundtrip = dict_to_panel_grid_mapper_output(d)
    assert mapper_roundtrip == p_int_8_mapper_output


def test_90vr_mr_serialization_round_trip(ninety_vr_mr_mapper_output) -> None:
    """🚨 Real customer data (573 panels) round-trips correctly."""
    d = json.loads(json.dumps(dataclasses.asdict(ninety_vr_mr_mapper_output)))
    mapper_roundtrip = dict_to_panel_grid_mapper_output(d)
    assert mapper_roundtrip == ninety_vr_mr_mapper_output


def test_boq_output_to_dict_preserves_all_16_fields(p_int_8_input) -> None:
    """boq_output_to_dict produces a dict with exactly 16 keys."""
    output = generate_boq(p_int_8_input)
    d = boq_output_to_dict(output)
    assert isinstance(d, dict)
    assert len(d) == 16
    expected = {
        "boq_id", "generated_at", "schema_version",
        "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
        "tier_4_sku_details", "tier_5_wall_segments", "tier_6_panel_pieces",
        "custom_quote_items", "operator_review_items",
        "commercial_terms", "audit_trail",
        "warnings", "assumptions_made", "pending_karthik",
    }
    assert set(d.keys()) == expected


# ──────────────────────────────────────────────────────────────────────────────
# Type-handling unit tests
# ──────────────────────────────────────────────────────────────────────────────


def test_dict_to_dataclass_handles_optional_fields() -> None:
    """BOQContext.notes is Optional[str] — must accept None and missing key."""
    ctx = dict_to_boq_context({
        "project_id": "X",
        "quote_date": "2026-05-25",
        # All Optional fields omitted — should use defaults
    })
    assert ctx.notes is None
    assert ctx.deterministic_id_seed is None
    assert ctx.generated_at_override is None


def test_dict_to_dataclass_handles_optional_explicit_none() -> None:
    """Explicit null for Optional fields → None."""
    ctx = dict_to_boq_context({
        "project_id": "X",
        "quote_date": "2026-05-25",
        "notes": None,
    })
    assert ctx.notes is None


def test_dict_to_dataclass_handles_tuple_of_dataclasses(p_int_8_mapper_output) -> None:
    """tuple[WallSegment, ...] correctly deserialized."""
    d = json.loads(json.dumps(dataclasses.asdict(p_int_8_mapper_output)))
    mapper = dict_to_panel_grid_mapper_output(d)
    assert isinstance(mapper.wall_segments, tuple)
    for seg in mapper.wall_segments:
        assert dataclasses.is_dataclass(seg)


def test_dict_to_dataclass_handles_nested_dataclasses(p_int_8_mapper_output) -> None:
    """WallSegment.reinforcement_spec is a nested dataclass."""
    d = json.loads(json.dumps(dataclasses.asdict(p_int_8_mapper_output)))
    mapper = dict_to_panel_grid_mapper_output(d)
    for seg in mapper.wall_segments:
        assert dataclasses.is_dataclass(seg.reinforcement_spec)


def test_dict_to_dataclass_handles_dict_pass_through(p_int_8_mapper_output) -> None:
    """dict[str, bool] (downstream_ready) and dict[str, int] (by_sku) pass through."""
    d = json.loads(json.dumps(dataclasses.asdict(p_int_8_mapper_output)))
    mapper = dict_to_panel_grid_mapper_output(d)
    assert isinstance(mapper.downstream_ready, dict)
    assert isinstance(mapper.total_counts.by_sku, dict)


def test_dict_to_dataclass_handles_literal_pass_through() -> None:
    """BOQContext.currency is Literal['INR'] — value passes through."""
    ctx = dict_to_boq_context({
        "project_id": "X",
        "quote_date": "2026-05-25",
        "currency": "INR",
    })
    assert ctx.currency == "INR"


def test_dict_to_dataclass_returns_none_for_none_input() -> None:
    """None input → None output (safe for Optional nested dataclass)."""
    assert _dict_to_dataclass(BOQContext, None) is None


def test_dict_to_dataclass_raises_typeerror_for_non_dict() -> None:
    """Non-dict input raises TypeError with cls name."""
    with pytest.raises(TypeError, match="Expected dict for dataclass BOQContext"):
        _dict_to_dataclass(BOQContext, "not-a-dict")


# ──────────────────────────────────────────────────────────────────────────────
# Type-introspection helper unit tests
# ──────────────────────────────────────────────────────────────────────────────


def test_is_union_with_none_detects_optional() -> None:
    from typing import Optional
    assert _is_union_with_none(Optional[int]) is True


def test_is_union_with_none_detects_pipe_union() -> None:
    assert _is_union_with_none(int | None) is True


def test_is_union_with_none_false_for_plain_type() -> None:
    assert _is_union_with_none(int) is False


def test_is_tuple_type_detects_generic_tuple() -> None:
    assert _is_tuple_type(tuple[int, ...]) is True


def test_is_tuple_type_false_for_list() -> None:
    assert _is_tuple_type(list[int]) is False


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI encoder equivalence (pre-flight B Part 2)
# ──────────────────────────────────────────────────────────────────────────────


def test_fastapi_encoder_matches_stdlib_json(p_int_8_input) -> None:
    """FastAPI's jsonable_encoder produces same shape as stdlib json round-trip.

    Pre-flight B Part 2 confirmed this; this test guards against regression.
    """
    from fastapi.encoders import jsonable_encoder
    output = generate_boq(p_int_8_input)
    d = dataclasses.asdict(output)
    fastapi_encoded = jsonable_encoder(d)
    stdlib_encoded = json.loads(json.dumps(d))
    assert fastapi_encoded == stdlib_encoded
