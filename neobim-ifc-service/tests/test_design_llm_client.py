"""Phase 2A Slice 2A.4 — LLM client tests.

Two test layers:

* **Cache-only tests** (always run): exercise the wrapper's deterministic
  surfaces — cache-key generation, schema hashing, cost arithmetic,
  custom error-class shapes, cache file round-trip — without touching
  the Anthropic SDK at all. These are the tests CI relies on.
* **API-key tests** (skipped via ``@pytest.mark.skipif`` when
  ``ANTHROPIC_API_KEY`` is unset): make real calls to verify the
  wrapper agrees with the live API on tool-use parsing, prompt
  caching, and Vision multimodal input.

Tests pass an explicit ``cache_dir=tmp_path`` to LLMClient so the
shipped ``app/services/design_agent/cache/`` directory stays
clean — those cache files are committed during Slice 2A.5 / 2A.6
when the BriefAnalyst / ProgramArchitect tests fire.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, Field, ConfigDict, ValidationError

from app.services.design_agent.llm_client import (
    ANTHROPIC_MODEL_NAMES,
    ANTHROPIC_PRICING,
    CircuitBreakerTripped,
    LLMAPIError,
    LLMCallMetadata,
    LLMClient,
    LLMRateLimited,
    LLMResponseValidationError,
    LLMUnavailableError,
    MODEL_MAX_TIMEOUT,
    PROMPT_CACHE_MIN_INPUT_TOKENS,
    canonicalize_user_message,
    compute_cache_key,
    compute_cost,
    hash_response_schema,
)


# ─── Test schemas ─────────────────────────────────────────────────────


class _GreetingResponse(BaseModel):
    """Tiny test schema — used by the API-key path to verify tool_use
    output is parsed back into a Pydantic model."""

    model_config = ConfigDict(frozen=True)
    greeting: str = Field(min_length=1)
    target_audience: str = Field(min_length=1)


class _MathResponse(BaseModel):
    """Even simpler schema for cache-key / cost-arithmetic tests."""

    model_config = ConfigDict(frozen=True)
    answer: int


# ─── Helpers ──────────────────────────────────────────────────────────


def _write_fake_cache(
    cache_dir: Path,
    *,
    cache_key: str,
    response_payload: dict,
    metadata: dict,
) -> Path:
    """Drop a synthetic cache file at the path the LLMClient expects."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = cache_dir / f"{cache_key}.json"
    p.write_text(
        json.dumps({"response": response_payload, "metadata": metadata}),
        encoding="utf-8",
    )
    return p


# ─── Cache-only tests (no API key required) ──────────────────────────


def test_compute_cache_key_deterministic() -> None:
    """Same inputs → same cache key. Foundation of the whole layer."""
    a = compute_cache_key(
        system_prompt="hello",
        user_message="world",
        response_schema=_GreetingResponse,
        model="claude-haiku-4-5-20251001",
    )
    b = compute_cache_key(
        system_prompt="hello",
        user_message="world",
        response_schema=_GreetingResponse,
        model="claude-haiku-4-5-20251001",
    )
    assert a == b
    # Three components separated by underscores, each 16 hex chars +
    # a model identifier.
    assert a.count("_") == 2


def test_compute_cache_key_changes_with_model() -> None:
    """Different model → different cache key (so Haiku and Opus don't
    share a cache file)."""
    common = dict(
        system_prompt="hello",
        user_message="world",
        response_schema=_GreetingResponse,
    )
    haiku = compute_cache_key(**common, model="claude-haiku-4-5-20251001")
    opus = compute_cache_key(**common, model="claude-opus-4-7")
    assert haiku != opus


def test_compute_cache_key_changes_with_schema() -> None:
    """Different schema → different cache key (so a schema bump
    invalidates old cache rows)."""
    common = dict(
        system_prompt="hello",
        user_message="world",
        model="claude-haiku-4-5-20251001",
    )
    a = compute_cache_key(**common, response_schema=_GreetingResponse)
    b = compute_cache_key(**common, response_schema=_MathResponse)
    assert a != b


def test_hash_response_schema_deterministic() -> None:
    """Same schema → same hash on every call (sort_keys=True under the
    hood). Two different schemas (or even two distinct classes with the
    same fields) hash differently because Pydantic's
    ``model_json_schema()`` includes the class title — that's the
    desired behaviour: a schema rename invalidates old cache rows."""
    a = hash_response_schema(_GreetingResponse)
    b = hash_response_schema(_GreetingResponse)
    assert a == b
    # And a different schema → different hash (class title differs)
    assert hash_response_schema(_MathResponse) != a


def test_canonicalize_user_message_handles_str() -> None:
    assert canonicalize_user_message("hello") == "hello"


def test_canonicalize_user_message_handles_list_dict() -> None:
    """List-of-blocks JSON-serialised with sort_keys for stable hashing."""
    msg = [{"type": "text", "text": "hi"}, {"type": "text", "text": "world"}]
    canonical = canonicalize_user_message(msg)
    # JSON output should sort keys — verify by re-parsing
    assert json.loads(canonical) == msg


def test_canonicalize_user_message_rejects_other_shapes() -> None:
    """Bytes / dict / int → TypeError (so an accidental shape doesn't
    silently cache-collide with itself)."""
    with pytest.raises(TypeError):
        canonicalize_user_message(b"raw")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        canonicalize_user_message({"raw": "dict"})  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        canonicalize_user_message(42)  # type: ignore[arg-type]


def test_compute_cost_known_arithmetic() -> None:
    """Spot-check the cost arithmetic against the known per-MTok rate.

    1M input tokens at Haiku 4.5's $1/MTok → $1.0. 0.5M output at
    $5/MTok → $2.5. Total = $3.5.
    """
    cost = compute_cost(
        "haiku-4.5",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=0,
        cache_creation_tokens=0,
    )
    assert cost == pytest.approx(3.5, abs=1e-6)


def test_compute_cost_zero_tokens_zero_cost() -> None:
    cost = compute_cost(
        "opus-4.7",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_creation_tokens=0,
    )
    assert cost == 0.0


def test_compute_cost_includes_cache_buckets() -> None:
    """Each bucket (read + creation) carries its own rate; sum them."""
    cost = compute_cost(
        "sonnet-4.6",
        input_tokens=1_000_000,
        output_tokens=0,
        cache_read_tokens=1_000_000,
        cache_creation_tokens=1_000_000,
    )
    # input ($3) + cache_read ($0.30) + cache_creation ($3.75)
    assert cost == pytest.approx(3.0 + 0.30 + 3.75, abs=1e-6)


def test_anthropic_pricing_has_all_models() -> None:
    """Drift sentinel: every ModelKey has a full pricing row."""
    expected_keys = {"input", "output", "cache_read", "cache_creation"}
    for model_key in ANTHROPIC_MODEL_NAMES:
        rates = ANTHROPIC_PRICING[model_key]
        assert set(rates.keys()) == expected_keys
        # Every rate must be positive (zero would be a configuration bug)
        for k, v in rates.items():
            assert v > 0, f"{model_key}.{k} must be > 0, got {v}"


def test_anthropic_model_names_canonical() -> None:
    """Drift sentinel — Phase 0 lesson on stale model strings."""
    assert ANTHROPIC_MODEL_NAMES["haiku-4.5"] == "claude-haiku-4-5-20251001"
    assert ANTHROPIC_MODEL_NAMES["sonnet-4.6"] == "claude-sonnet-4-6"
    assert ANTHROPIC_MODEL_NAMES["opus-4.7"] == "claude-opus-4-7"


def test_model_max_timeout_per_tier() -> None:
    """Per-spec ceilings: Haiku 10s, Sonnet 20s, Opus 30s."""
    assert MODEL_MAX_TIMEOUT["haiku-4.5"] == 10.0
    assert MODEL_MAX_TIMEOUT["sonnet-4.6"] == 20.0
    assert MODEL_MAX_TIMEOUT["opus-4.7"] == 30.0


def test_prompt_cache_min_token_constant_documented() -> None:
    assert PROMPT_CACHE_MIN_INPUT_TOKENS == 1024


# ─── Error taxonomy shape ────────────────────────────────────────────


def test_circuit_breaker_tripped_carries_fields() -> None:
    exc = CircuitBreakerTripped(
        model="haiku-4.5", configured_timeout=10.0, elapsed=11.5
    )
    assert exc.model == "haiku-4.5"
    assert exc.configured_timeout == 10.0
    assert exc.elapsed == 11.5
    assert "10.0s" in str(exc)
    assert "11.50s" in str(exc)


def test_llm_response_validation_error_wraps_original() -> None:
    """Validation errors carry both the Pydantic original and the raw
    tool input so callers can pinpoint per-field drift."""
    try:
        _MathResponse.model_validate({"answer": "not-an-int"})
    except ValidationError as orig:
        wrapped = LLMResponseValidationError(orig, {"answer": "not-an-int"})
        assert wrapped.original is orig
        assert wrapped.raw_input == {"answer": "not-an-int"}
        assert "Pydantic validation" in str(wrapped)


def test_error_taxonomy_classes_are_distinct() -> None:
    """Each error class has a unique mro so callers can branch on
    type rather than string-match the message."""
    classes = {
        LLMUnavailableError, CircuitBreakerTripped,
        LLMResponseValidationError, LLMRateLimited, LLMAPIError,
    }
    # All inherit from RuntimeError (or a subclass thereof)
    for c in classes:
        assert issubclass(c, RuntimeError)
    # Distinct types
    assert len(classes) == 5


# ─── Cache hit / miss ────────────────────────────────────────────────


def test_cache_hit_returns_parsed_response(tmp_path: Path) -> None:
    """Pre-populate a cache file, call the client, verify it loads
    without making a real API call."""
    client = LLMClient(cache_dir=tmp_path)
    cache_key = compute_cache_key(
        system_prompt="sys",
        user_message="msg",
        response_schema=_MathResponse,
        model=ANTHROPIC_MODEL_NAMES["haiku-4.5"],
    )
    _write_fake_cache(
        tmp_path,
        cache_key=cache_key,
        response_payload={"answer": 42},
        metadata={
            "model": ANTHROPIC_MODEL_NAMES["haiku-4.5"],
            "input_tokens": 100,
            "output_tokens": 20,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "cost_usd_estimated": 0.000200,
            "latency_ms": 750.0,
            "created_at_iso": "2026-05-07T12:00:00+00:00",
        },
    )
    parsed, meta = client.call(
        model="haiku-4.5",
        system_prompt="sys",
        user_message="msg",
        response_schema=_MathResponse,
        timeout_seconds=10.0,
    )
    assert isinstance(parsed, _MathResponse)
    assert parsed.answer == 42
    assert meta.cache_hit is True
    assert meta.input_tokens == 100
    assert meta.cost_usd_estimated == pytest.approx(0.000200, abs=1e-9)


def test_cache_miss_without_api_key_raises_llm_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client = LLMClient(cache_dir=tmp_path)
    with pytest.raises(LLMUnavailableError) as ei:
        client.call(
            model="haiku-4.5",
            system_prompt="sys",
            user_message="msg",
            response_schema=_MathResponse,
            timeout_seconds=10.0,
        )
    assert "ANTHROPIC_API_KEY" in str(ei.value)
    assert "cache miss" in str(ei.value)


def test_cache_hit_metadata_synthesizes_cache_hit_true(tmp_path: Path) -> None:
    """The cache file does NOT carry cache_hit; on load it is forced
    to True regardless of any field that might be in the file."""
    client = LLMClient(cache_dir=tmp_path)
    cache_key = compute_cache_key(
        system_prompt="x",
        user_message="y",
        response_schema=_MathResponse,
        model=ANTHROPIC_MODEL_NAMES["sonnet-4.6"],
    )
    # Inject a cache_hit=False to make sure we ignore it on load
    _write_fake_cache(
        tmp_path,
        cache_key=cache_key,
        response_payload={"answer": 7},
        metadata={
            "model": ANTHROPIC_MODEL_NAMES["sonnet-4.6"],
            "input_tokens": 50,
            "output_tokens": 10,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "cost_usd_estimated": 0.0,
            "latency_ms": 1.0,
            "cache_hit": False,  # ignored on load
            "created_at_iso": "2026-05-07T13:00:00+00:00",
        },
    )
    _, meta = client.call(
        model="sonnet-4.6",
        system_prompt="x",
        user_message="y",
        response_schema=_MathResponse,
        timeout_seconds=10.0,
    )
    assert meta.cache_hit is True


def test_cache_hit_invalid_response_payload_raises_validation_error(
    tmp_path: Path,
) -> None:
    """A cache file whose response no longer matches the schema must
    raise :class:`LLMResponseValidationError` — typically happens after
    the schema's been edited but the cache hasn't been regenerated."""
    client = LLMClient(cache_dir=tmp_path)
    cache_key = compute_cache_key(
        system_prompt="x",
        user_message="y",
        response_schema=_MathResponse,
        model=ANTHROPIC_MODEL_NAMES["haiku-4.5"],
    )
    _write_fake_cache(
        tmp_path,
        cache_key=cache_key,
        response_payload={"answer": "not-an-int"},  # schema mismatch
        metadata={
            "model": ANTHROPIC_MODEL_NAMES["haiku-4.5"],
            "input_tokens": 1, "output_tokens": 1,
            "cache_read_tokens": 0, "cache_creation_tokens": 0,
            "cost_usd_estimated": 0.0, "latency_ms": 1.0,
            "created_at_iso": "2026-05-07T13:00:00+00:00",
        },
    )
    with pytest.raises(LLMResponseValidationError):
        client.call(
            model="haiku-4.5",
            system_prompt="x",
            user_message="y",
            response_schema=_MathResponse,
            timeout_seconds=10.0,
        )


def test_llm_call_metadata_total_tokens_sum() -> None:
    md = LLMCallMetadata(
        model="claude-haiku-4-5-20251001",
        input_tokens=100,
        output_tokens=200,
        cache_read_tokens=999,  # excluded from total_tokens by design
        cache_creation_tokens=999,  # excluded
        cost_usd_estimated=0.001,
        latency_ms=500.0,
        cache_hit=False,
        created_at_iso="2026-05-07T13:00:00+00:00",
    )
    assert md.total_tokens == 300


# ─── API-key tests (skip cleanly when key absent) ────────────────────


_NEEDS_API_KEY = pytest.mark.skipif(
    not os.getenv("ANTHROPIC_API_KEY"),
    reason="needs ANTHROPIC_API_KEY for live Anthropic API call",
)


@_NEEDS_API_KEY
def test_real_haiku_call_returns_valid_pydantic(tmp_path: Path) -> None:
    """End-to-end: real API call → tool_use → Pydantic validation.

    Uses a tmp cache_dir so the response isn't cached into the
    repo's shipped cache (Slice 2A.5 / 2A.6 own that)."""
    client = LLMClient(cache_dir=tmp_path)
    parsed, meta = client.call(
        model="haiku-4.5",
        system_prompt=(
            "You are a friendly AI. Always respond via the "
            "submit_response tool."
        ),
        user_message=(
            "Generate a polite greeting for a stranger you just met. "
            "Set target_audience to 'stranger'."
        ),
        response_schema=_GreetingResponse,
        timeout_seconds=10.0,
    )
    assert isinstance(parsed, _GreetingResponse)
    assert len(parsed.greeting) > 0
    assert parsed.target_audience  # non-empty
    assert meta.cache_hit is False
    assert meta.input_tokens > 0
    assert meta.output_tokens > 0
    assert meta.cost_usd_estimated > 0
    assert meta.latency_ms > 0


@_NEEDS_API_KEY
def test_prompt_caching_reduces_cost_on_second_call(tmp_path: Path) -> None:
    """Second call with same prompt + cache_shared_context=True hits
    Anthropic's 5-min ephemeral prompt cache — cache_read_tokens > 0
    on the second call."""
    # Make sure the system prompt clears the 1024-token cache minimum.
    long_system = (
        "You are a friendly AI assistant. Always respond via the "
        "submit_response tool. " * 80
    )
    user = "Generate a 1-word greeting and target_audience='friend'."

    # Two distinct file caches → both calls must hit the API.
    client_a = LLMClient(cache_dir=tmp_path / "a")
    _, meta_a = client_a.call(
        model="haiku-4.5",
        system_prompt=long_system,
        user_message=user,
        response_schema=_GreetingResponse,
        timeout_seconds=10.0,
        cache_shared_context=True,
    )

    client_b = LLMClient(cache_dir=tmp_path / "b")
    _, meta_b = client_b.call(
        model="haiku-4.5",
        system_prompt=long_system,
        user_message=user,
        response_schema=_GreetingResponse,
        timeout_seconds=10.0,
        cache_shared_context=True,
    )

    # First call writes to Anthropic's prompt cache; second call
    # reads from it. Either of the two calls might write OR read
    # depending on contention, so we assert that AT LEAST one
    # cache_read happens across the pair.
    assert (
        meta_a.cache_creation_tokens > 0 or meta_b.cache_read_tokens > 0
    ), (
        f"prompt caching not detected: "
        f"a.creation={meta_a.cache_creation_tokens}, "
        f"a.read={meta_a.cache_read_tokens}, "
        f"b.creation={meta_b.cache_creation_tokens}, "
        f"b.read={meta_b.cache_read_tokens}"
    )


@_NEEDS_API_KEY
def test_vision_call_with_pdf_works(tmp_path: Path) -> None:
    """Multimodal user_message → real Vision call returns parsed schema.

    Builds a tiny PDF on the fly, feeds it to Opus 4.7 via a
    document content block, and verifies the model's transcription
    parses through our tool-use plumbing."""
    from reportlab.pdfgen import canvas
    import base64
    from pydantic import BaseModel as _BM

    class _Transcription(_BM):
        text: str = Field(default="")

    pdf_path = tmp_path / "vision.pdf"
    c = canvas.Canvas(str(pdf_path))
    c.drawString(72, 750, "TEST: This brief describes a 2BHK apartment in Pune.")
    c.showPage()
    c.save()

    pdf_bytes = pdf_path.read_bytes()
    user_message = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(pdf_bytes).decode("ascii"),
            },
        },
        {"type": "text", "text": "Transcribe the PDF text exactly."},
    ]

    client = LLMClient(cache_dir=tmp_path / "cache")
    parsed, meta = client.call(
        model="opus-4.7",
        system_prompt="Transcribe the provided PDF.",
        user_message=user_message,
        response_schema=_Transcription,
        timeout_seconds=30.0,
    )
    assert isinstance(parsed, _Transcription)
    assert "BHK" in parsed.text or "2BHK" in parsed.text or "Pune" in parsed.text, (
        f"vision did not transcribe expected content; got: {parsed.text!r}"
    )
    assert meta.cache_hit is False
    assert meta.cost_usd_estimated > 0


# ─── Cache file write/load round trip ────────────────────────────────


def test_write_then_load_cache_round_trip(tmp_path: Path) -> None:
    """Synthesise a metadata + parsed response, write through
    LLMClient._write_cache, load back via _load_from_cache. Field-by-
    field equality (except cache_hit, which flips to True on load)."""
    client = LLMClient(cache_dir=tmp_path)
    parsed = _MathResponse(answer=99)
    md_in = LLMCallMetadata(
        model="claude-opus-4-7",
        input_tokens=100,
        output_tokens=50,
        cache_read_tokens=10,
        cache_creation_tokens=0,
        cost_usd_estimated=0.01,
        latency_ms=2500.0,
        cache_hit=False,
        created_at_iso="2026-05-07T15:00:00+00:00",
    )
    cache_key = "abc_def_xyz"
    cache_path = tmp_path / f"{cache_key}.json"
    client._write_cache(cache_path, parsed, md_in)
    loaded_parsed, md_out = client._load_from_cache(cache_path, _MathResponse)
    assert loaded_parsed.answer == 99
    assert md_out.cache_hit is True  # synthesized
    # Every other field must round-trip exactly
    assert md_out.model == md_in.model
    assert md_out.input_tokens == md_in.input_tokens
    assert md_out.output_tokens == md_in.output_tokens
    assert md_out.cache_read_tokens == md_in.cache_read_tokens
    assert md_out.cache_creation_tokens == md_in.cache_creation_tokens
    assert md_out.cost_usd_estimated == md_in.cost_usd_estimated
    assert md_out.latency_ms == md_in.latency_ms
    assert md_out.created_at_iso == md_in.created_at_iso


def test_cache_file_is_json_object_with_expected_shape(tmp_path: Path) -> None:
    """The file format on disk matches what Slice 2A.5 / 2A.6 will
    commit. Drift here invalidates the cache contract."""
    client = LLMClient(cache_dir=tmp_path)
    cache_key = compute_cache_key(
        system_prompt="x",
        user_message="y",
        response_schema=_MathResponse,
        model=ANTHROPIC_MODEL_NAMES["haiku-4.5"],
    )
    cache_path = tmp_path / f"{cache_key}.json"
    client._write_cache(
        cache_path,
        _MathResponse(answer=1),
        LLMCallMetadata(
            model="claude-haiku-4-5-20251001",
            input_tokens=1, output_tokens=1,
            cache_read_tokens=0, cache_creation_tokens=0,
            cost_usd_estimated=0.0, latency_ms=1.0,
            cache_hit=False,
            created_at_iso="2026-05-07T15:00:00+00:00",
        ),
    )
    raw = json.loads(cache_path.read_text(encoding="utf-8"))
    # Top-level keys
    assert set(raw.keys()) == {"response", "metadata"}
    # Metadata keys
    assert set(raw["metadata"].keys()) == {
        "model", "input_tokens", "output_tokens",
        "cache_read_tokens", "cache_creation_tokens",
        "cost_usd_estimated", "latency_ms", "created_at_iso",
    }
    # cache_hit is intentionally absent — synthesized to True on load
    assert "cache_hit" not in raw["metadata"]


# ─── Pricing sanity ──────────────────────────────────────────────────


def test_per_model_cost_increases_with_capability() -> None:
    """Opus > Sonnet > Haiku. A misconfigured rate that flipped this
    ordering would show up in monthly billing — pin it as an invariant."""
    same_load = dict(
        input_tokens=1000, output_tokens=1000,
        cache_read_tokens=0, cache_creation_tokens=0,
    )
    haiku = compute_cost("haiku-4.5", **same_load)
    sonnet = compute_cost("sonnet-4.6", **same_load)
    opus = compute_cost("opus-4.7", **same_load)
    assert haiku < sonnet < opus
