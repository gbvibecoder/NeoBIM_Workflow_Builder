"""Phase 2A Slice 2A.4 — Anthropic API wrapper for the design agent.

Public surface
--------------
* :class:`LLMClient` — the wrapper. ``client.call(...)`` is the only
  entry point Phase 2A's BriefAnalyst (Slice 2A.5), ProgramArchitect
  (Slice 2A.6), and vision-fallback PDF extractor (Slice 2A.4) reach
  into.
* :class:`LLMCallMetadata` — frozen dataclass returned alongside the
  parsed response. Stable shape so Slice 2A.7 can aggregate per-call
  cost / latency / cache-hit metrics into Pset_BuildFlow_Provenance.
* Custom error taxonomy: :class:`LLMUnavailableError`,
  :class:`CircuitBreakerTripped`, :class:`LLMResponseValidationError`,
  :class:`LLMRateLimited`, :class:`LLMAPIError`. The route handler in
  Slice 2A.7 catches these to emit specific 5xx responses (per the
  "errors must always be specific" feedback rule).

Architectural goals
-------------------
1. **Deterministic, cached.** Same (system_prompt, user_message,
   schema, model) tuple yields the same response on every call. The
   cache key is a SHA-256 of the canonicalised inputs; the cache
   directory ships in the repo so CI can replay BriefAnalyst /
   ProgramArchitect tests with no API key.
2. **Per-model circuit breakers.** Caller passes a desired timeout
   but the wrapper clamps to the per-model wallclock ceiling
   (Haiku 10s / Sonnet 20s / Opus 30s) so a misbehaving handler
   cannot stall a route forever. Timeout fires
   :class:`CircuitBreakerTripped` carrying ``model``,
   ``configured_timeout``, ``elapsed`` for forensics.
3. **Prompt caching.** When ``cache_shared_context=True`` (the
   default) the wrapper attaches Anthropic's ``cache_control:
   ephemeral`` to the system prompt block so a long shared system
   prompt across BriefAnalyst calls is billed once + dirt-cheap reads
   thereafter. The 1024-token cache minimum is documented; system
   prompts shorter than that get no cache benefit even with the flag
   set. Phase 2A's prompts (~2-3k tokens for BriefAnalyst, ~1.5-2.5k
   for ProgramArchitect) clear the bar.
4. **Structured tool-use output.** The Pydantic schema is rendered
   as a tool definition; tool_choice forces the model to call the
   tool; the response is parsed back via
   ``schema.model_validate(tool_input)``. Pydantic validation
   failures wrap as :class:`LLMResponseValidationError` carrying the
   original error so callers can pinpoint per-field drift between
   the schema and the model's output.
5. **Multimodal support.** ``user_message`` accepts a string OR a
   list of content blocks (the same list the SDK accepts). The
   vision-fallback PDF extractor (:func:`vision_extract_pdf` in
   ``pdf_extractor.py``) passes a ``[document_block, text_block]``
   list to push the PDF into Opus 4.7.
6. **Cost tracking.** Per-call cost is computed from per-model
   published rates (see :data:`ANTHROPIC_PRICING`) and stamped on
   :class:`LLMCallMetadata.cost_usd_estimated`. The "estimated"
   suffix is deliberate — Anthropic's per-MTok rates change over
   time, so this is a best-effort accounting figure, not a billing
   ground truth. Verify pricing against docs.claude.com before
   using these numbers in any user-facing ledger.

Layering rules (mirrors Phase 1)
--------------------------------
* This module imports stdlib + ``pydantic`` + ``anthropic``. The
  SDK import is deferred to the cache-miss path so cache-only mode
  works even if the SDK is somehow not installed.
* No imports from ``app.routers``, ``app.services.ifc_*``, or
  ``app.domain``. The LLM client is a leaf utility.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, Type

from pydantic import BaseModel, ValidationError

log = logging.getLogger(__name__)


# ─── Public types + constants ────────────────────────────────────────


ModelKey = Literal["haiku-4.5", "sonnet-4.6", "opus-4.7"]


# Canonical Anthropic model identifiers. Verified against docs.claude.com
# at Phase 2A authoring time (2026-05). If Anthropic publishes a new
# canonical ID, update this map and bump the cache key (so old cache
# files become invalid for the new model). Stale model strings are
# the Phase 0 lesson — they break production silently when older
# aliases stop resolving.
ANTHROPIC_MODEL_NAMES: dict[ModelKey, str] = {
    "haiku-4.5": "claude-haiku-4-5-20251001",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.7": "claude-opus-4-7",
}


# Per-model wallclock ceiling. The caller's ``timeout_seconds`` is
# clamped to this value so a single LLM call cannot block a route
# handler longer than the spec'd ceiling: Haiku 10s, Sonnet 20s,
# Opus 30s.
MODEL_MAX_TIMEOUT: dict[ModelKey, float] = {
    "haiku-4.5": 10.0,
    "sonnet-4.6": 20.0,
    "opus-4.7": 30.0,
}


# Per-model pricing in USD per million tokens. Approximate as of
# 2026-05; verify against docs.claude.com before relying on these
# figures for user-facing billing. The cache-write rate (ephemeral
# cache) is ~1.25× the input rate; the cache-read rate is ~1/10×
# the input rate, per Anthropic's published structure.
ANTHROPIC_PRICING: dict[ModelKey, dict[str, float]] = {
    "haiku-4.5": {
        "input": 1.0,
        "output": 5.0,
        "cache_read": 0.10,
        "cache_creation": 1.25,
    },
    "sonnet-4.6": {
        "input": 3.0,
        "output": 15.0,
        "cache_read": 0.30,
        "cache_creation": 3.75,
    },
    "opus-4.7": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.50,
        "cache_creation": 18.75,
    },
}


# Default cache directory. Tests pass an explicit ``cache_dir`` to
# avoid polluting this shared location.
CACHE_DIR: Path = Path(__file__).parent / "cache"


# Anthropic's ephemeral prompt cache requires a minimum of 1024 input
# tokens before any cache hit can be recorded. System prompts shorter
# than that get no benefit from ``cache_control: ephemeral``. Surfaced
# as a docstring constant for slice 2A.5 / 2A.6 prompt authors.
PROMPT_CACHE_MIN_INPUT_TOKENS: int = 1024


# Default ``max_tokens`` for the ``messages.create`` call. 4096 covers
# every Phase 2A-shaped response (BriefAnalysis ~ 1500 tokens,
# RoomProgram ~ 3000 tokens with 8-12 rooms). Increase only when a
# specific stage needs a larger ceiling.
_DEFAULT_MAX_TOKENS: int = 4096


# ─── Custom errors ───────────────────────────────────────────────────


class LLMUnavailableError(RuntimeError):
    """Raised on cache miss when no ``ANTHROPIC_API_KEY`` is set.

    Cache-only mode is the supported path for CI (and any environment
    where calling the API is undesirable). When the cache file the
    caller's request maps to is absent AND the env var is missing,
    there is no path forward — the wrapper raises this error rather
    than silently returning a fabricated response.
    """


class CircuitBreakerTripped(RuntimeError):
    """The LLM call exceeded the per-model wallclock ceiling.

    Carries ``.model`` (the ModelKey we attempted), ``.configured_timeout``
    (the clamped value actually passed to the SDK), and ``.elapsed``
    (real wallclock at the point the SDK raised). Useful for pinpointing
    timeouts in mixed-model pipelines.
    """

    def __init__(
        self, model: ModelKey, configured_timeout: float, elapsed: float
    ) -> None:
        super().__init__(
            f"LLM call to {model} timed out after {elapsed:.2f}s "
            f"(circuit-breaker ceiling: {configured_timeout:.1f}s)"
        )
        self.model: ModelKey = model
        self.configured_timeout: float = configured_timeout
        self.elapsed: float = elapsed


class LLMResponseValidationError(RuntimeError):
    """The model's tool-use output failed Pydantic validation.

    Wraps the original :class:`pydantic.ValidationError` so callers
    can introspect per-field drift between the schema and the model's
    output. We do NOT retry on this — same input + same prompt + same
    schema deterministically yields the same output, so retrying just
    burns tokens. Either fix the schema, fix the prompt, or both.
    """

    def __init__(self, original: ValidationError, raw_input: dict) -> None:
        super().__init__(
            f"LLM tool-use output failed Pydantic validation: "
            f"{len(original.errors())} error(s); "
            f"first: {original.errors()[0]}"
        )
        self.original: ValidationError = original
        self.raw_input: dict = raw_input


class LLMRateLimited(RuntimeError):
    """Anthropic 429 after our 1-retry-with-backoff has been spent.

    Callers should treat as a transient hard failure. The route
    handler in Slice 2A.7 retries at the request level (or falls
    back to a cached response if available).
    """


class LLMAPIError(RuntimeError):
    """Other API failure modes (5xx other than rate-limited, 4xx
    other than auth / rate-limited)."""


# ─── Metadata ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class LLMCallMetadata:
    """Per-call accounting record returned alongside the parsed response.

    Frozen + slotted shape so callers can aggregate across calls
    without worrying about mutation. Slice 2A.7 sums ``cost_usd_estimated``,
    ``latency_ms``, and cache-hit counts onto Pset_BuildFlow_Provenance
    so provenance carries the LLM accounting alongside the IDS
    validation accounting.
    """

    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    cost_usd_estimated: float
    latency_ms: float
    cache_hit: bool
    created_at_iso: str

    @property
    def total_tokens(self) -> int:
        """Sum of fresh input + output tokens. Cache-read tokens are
        excluded because they're billed at a discount and conceptually
        represent a different unit of work."""
        return self.input_tokens + self.output_tokens


# ─── Public helpers (also used by tests) ─────────────────────────────


def canonicalize_user_message(user_message: str | list[dict[str, Any]]) -> str:
    """Return a deterministic string representation of ``user_message``
    for cache-key derivation.

    Strings are returned verbatim. List-of-content-blocks (the SDK's
    multimodal shape) is JSON-serialised with ``sort_keys=True`` so a
    map ``{"type": "text", "text": "..."}`` and the same map with the
    keys re-ordered yield identical hashes. Everything else raises
    TypeError so an accidental ``dict`` or ``bytes`` doesn't silently
    cache-collide with itself.
    """
    if isinstance(user_message, str):
        return user_message
    if isinstance(user_message, list):
        return json.dumps(user_message, sort_keys=True, ensure_ascii=False)
    raise TypeError(
        f"user_message must be str or list[dict], got {type(user_message).__name__}"
    )


def hash_response_schema(schema: Type[BaseModel]) -> str:
    """SHA-256-16 hash of a Pydantic schema's canonical JSON shape.

    ``json.dumps(..., sort_keys=True)`` ensures identical schemas
    declared in different field orders produce the same hash.
    """
    raw = json.dumps(
        schema.model_json_schema(), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def compute_cache_key(
    *,
    system_prompt: str,
    user_message: str | list[dict[str, Any]],
    response_schema: Type[BaseModel],
    model: str,
) -> str:
    """Derive the canonical cache key for a single LLM call.

    Shape: ``{prompt_hash}_{schema_hash}_{model}`` where each hash is
    a 16-hex-char SHA-256 prefix. The model token is included
    verbatim so a Haiku call and an Opus call with the same prompt
    don't share a cache file.
    """
    canonical_user = canonicalize_user_message(user_message)
    prompt_hash = hashlib.sha256(
        (system_prompt + canonical_user).encode("utf-8")
    ).hexdigest()[:16]
    schema_hash = hash_response_schema(response_schema)
    return f"{prompt_hash}_{schema_hash}_{model}"


def compute_cost(
    model: ModelKey,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_creation_tokens: int,
) -> float:
    """USD cost estimate from per-model rates and per-bucket token counts.

    Anthropic's modern usage shape reports ``input_tokens`` excluding
    cache-read + cache-creation tokens (those are buckets of their
    own). We trust that contract: each bucket is multiplied by its
    own rate and summed.
    """
    rates = ANTHROPIC_PRICING[model]
    cost = (
        input_tokens * rates["input"]
        + output_tokens * rates["output"]
        + cache_read_tokens * rates["cache_read"]
        + cache_creation_tokens * rates["cache_creation"]
    ) / 1_000_000.0
    return round(cost, 6)


# ─── LLMClient ───────────────────────────────────────────────────────


class LLMClient:
    """File-cached, circuit-broken Anthropic wrapper for the design agent.

    See module docstring for the full design. Tests pass
    ``cache_dir=tmp_path`` to avoid polluting the shipped cache
    directory. Production code uses the default
    :data:`CACHE_DIR` (the package's ``cache/`` directory).
    """

    def __init__(self, *, cache_dir: Optional[Path] = None) -> None:
        self._cache_dir: Path = cache_dir or CACHE_DIR
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # ---- public API ------------------------------------------------

    def call(
        self,
        *,
        model: ModelKey,
        system_prompt: str,
        user_message: str | list[dict[str, Any]],
        response_schema: Type[BaseModel],
        timeout_seconds: float,
        cache_shared_context: bool = True,
    ) -> tuple[BaseModel, LLMCallMetadata]:
        """Make a single LLM call with caching, circuit-breaker, retry.

        See module docstring for design. The flow:

        1. Compute cache key. If a cache file exists, return its
           contents (cache_hit=True in metadata).
        2. Cache miss: load API key from env. No key → raise
           :class:`LLMUnavailableError`.
        3. Clamp ``timeout_seconds`` to per-model ceiling.
        4. Build messages/system/tools params and dispatch via the
           Anthropic SDK with 1 retry on rate-limit / 5xx (no retry
           on validation / timeout).
        5. Parse the tool_use block via the response schema.
        6. Write cache file (atomic via tmp + rename).
        """
        cache_key = compute_cache_key(
            system_prompt=system_prompt,
            user_message=user_message,
            response_schema=response_schema,
            model=ANTHROPIC_MODEL_NAMES[model],
        )
        cache_path = self._cache_dir / f"{cache_key}.json"
        if cache_path.exists():
            return self._load_from_cache(cache_path, response_schema)

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise LLMUnavailableError(
                f"ANTHROPIC_API_KEY not set; cache miss for key {cache_key}. "
                f"Either set the env var or pre-populate the cache file at "
                f"{cache_path}."
            )

        effective_timeout = min(timeout_seconds, MODEL_MAX_TIMEOUT[model])
        start = time.monotonic()
        raw_response = self._invoke_anthropic_with_retries(
            api_key=api_key,
            model=model,
            system_prompt=system_prompt,
            user_message=user_message,
            response_schema=response_schema,
            timeout_seconds=effective_timeout,
            cache_shared_context=cache_shared_context,
            start_time=start,
        )
        latency_ms = (time.monotonic() - start) * 1000.0

        parsed, _tool_input = self._parse_tool_use(raw_response, response_schema)
        metadata = self._build_metadata(raw_response, model, latency_ms)
        self._write_cache(cache_path, parsed, metadata)
        return parsed, metadata

    # ---- cache I/O -------------------------------------------------

    def _load_from_cache(
        self, cache_path: Path, response_schema: Type[BaseModel]
    ) -> tuple[BaseModel, LLMCallMetadata]:
        try:
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LLMAPIError(
                f"Failed to read / parse cache file {cache_path}: "
                f"{type(exc).__name__}: {exc}"
            ) from exc
        try:
            parsed = response_schema.model_validate(raw["response"])
        except ValidationError as exc:
            raise LLMResponseValidationError(exc, raw.get("response", {})) from exc
        md = raw["metadata"]
        metadata = LLMCallMetadata(
            model=md["model"],
            input_tokens=md["input_tokens"],
            output_tokens=md["output_tokens"],
            cache_read_tokens=md["cache_read_tokens"],
            cache_creation_tokens=md["cache_creation_tokens"],
            cost_usd_estimated=md.get("cost_usd_estimated", 0.0),
            latency_ms=md["latency_ms"],
            cache_hit=True,  # synthesized; never written to file
            created_at_iso=md["created_at_iso"],
        )
        return parsed, metadata

    def _write_cache(
        self,
        cache_path: Path,
        parsed: BaseModel,
        metadata: LLMCallMetadata,
    ) -> None:
        """Atomic write: dump to ``.tmp`` sibling then rename.

        ``cache_hit`` is intentionally NOT written; it is synthesized
        to True on every load. This keeps cache files identical across
        every read of the same row.
        """
        payload = {
            "response": parsed.model_dump(mode="json"),
            "metadata": {
                "model": metadata.model,
                "input_tokens": metadata.input_tokens,
                "output_tokens": metadata.output_tokens,
                "cache_read_tokens": metadata.cache_read_tokens,
                "cache_creation_tokens": metadata.cache_creation_tokens,
                "cost_usd_estimated": metadata.cost_usd_estimated,
                "latency_ms": metadata.latency_ms,
                "created_at_iso": metadata.created_at_iso,
            },
        }
        tmp = cache_path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(cache_path)

    # ---- API call --------------------------------------------------

    def _invoke_anthropic_with_retries(
        self,
        *,
        api_key: str,
        model: ModelKey,
        system_prompt: str,
        user_message: str | list[dict[str, Any]],
        response_schema: Type[BaseModel],
        timeout_seconds: float,
        cache_shared_context: bool,
        start_time: float,
    ) -> Any:
        """Make the SDK call. 1 retry on rate-limit / 5xx; no retry
        on timeout (circuit-breaker fires instead) or validation."""
        # Defer the SDK import so cache-only mode works even if
        # anthropic is somehow not installed in a stripped-down env.
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

        system_param = self._build_system_param(system_prompt, cache_shared_context)
        messages_param = [{"role": "user", "content": user_message}]
        tool_param = {
            "name": "submit_response",
            "description": (
                "Submit the structured response. The schema is the "
                "Pydantic model the caller supplied; every field "
                "constraint must be honoured."
            ),
            "input_schema": response_schema.model_json_schema(),
        }
        tool_choice_param = {"type": "tool", "name": "submit_response"}

        for attempt in range(2):  # max 2 attempts (1 retry)
            try:
                return client.messages.create(
                    model=ANTHROPIC_MODEL_NAMES[model],
                    max_tokens=_DEFAULT_MAX_TOKENS,
                    system=system_param,
                    messages=messages_param,
                    tools=[tool_param],
                    tool_choice=tool_choice_param,
                    timeout=timeout_seconds,
                )
            except anthropic.APITimeoutError as exc:
                elapsed = time.monotonic() - start_time
                raise CircuitBreakerTripped(
                    model=model,
                    configured_timeout=timeout_seconds,
                    elapsed=elapsed,
                ) from exc
            except anthropic.RateLimitError as exc:
                if attempt < 1:
                    log.warning(
                        "anthropic_rate_limited_retrying",
                        extra={"model": model, "attempt": attempt},
                    )
                    time.sleep(2.0)
                    continue
                raise LLMRateLimited(
                    f"Anthropic rate-limited after retry: {exc}"
                ) from exc
            except anthropic.APIStatusError as exc:
                if 500 <= exc.status_code < 600 and attempt < 1:
                    log.warning(
                        "anthropic_5xx_retrying",
                        extra={
                            "model": model,
                            "attempt": attempt,
                            "status_code": exc.status_code,
                        },
                    )
                    time.sleep(1.0)
                    continue
                if exc.status_code == 429:
                    raise LLMRateLimited(str(exc)) from exc
                raise LLMAPIError(
                    f"Anthropic API status {exc.status_code}: {exc}"
                ) from exc
            except anthropic.APIError as exc:
                # Other generic API errors — no retry.
                raise LLMAPIError(f"Anthropic API error: {exc}") from exc

        # Defensive — should be unreachable; the loop either returns
        # or raises on every path.
        raise LLMAPIError("Anthropic call exhausted retries without resolving")

    @staticmethod
    def _build_system_param(
        system_prompt: str, cache_shared_context: bool
    ) -> Any:
        """Build the SDK's ``system`` parameter shape.

        With caching: list of one text block carrying
        ``cache_control: ephemeral``. Without: a plain string. The
        SDK accepts both.
        """
        if cache_shared_context:
            return [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        return system_prompt

    @staticmethod
    def _parse_tool_use(
        response: Any, response_schema: Type[BaseModel]
    ) -> tuple[BaseModel, dict]:
        """Find the first ``tool_use`` content block and validate via
        the response schema."""
        tool_input: Optional[dict] = None
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                tool_input = block.input
                break
        if tool_input is None:
            content_types = [getattr(b, "type", None) for b in response.content]
            raise LLMAPIError(
                f"LLM response did not contain a tool_use block. "
                f"Got content types: {content_types}. "
                f"This usually means tool_choice was rejected — verify the "
                f"schema is valid JSON Schema and tool_choice forces the "
                f"submit_response tool."
            )
        try:
            return response_schema.model_validate(tool_input), tool_input
        except ValidationError as exc:
            raise LLMResponseValidationError(exc, tool_input) from exc

    @staticmethod
    def _build_metadata(
        response: Any, model: ModelKey, latency_ms: float
    ) -> LLMCallMetadata:
        """Build :class:`LLMCallMetadata` from an SDK response."""
        usage = response.usage
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
        return LLMCallMetadata(
            model=ANTHROPIC_MODEL_NAMES[model],
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=cache_read,
            cache_creation_tokens=cache_creation,
            cost_usd_estimated=compute_cost(
                model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_read_tokens=cache_read,
                cache_creation_tokens=cache_creation,
            ),
            latency_ms=latency_ms,
            cache_hit=False,
            created_at_iso=datetime.now(timezone.utc).isoformat(),
        )


__all__ = [
    # Types
    "LLMClient",
    "LLMCallMetadata",
    "ModelKey",
    # Errors
    "LLMUnavailableError",
    "CircuitBreakerTripped",
    "LLMResponseValidationError",
    "LLMRateLimited",
    "LLMAPIError",
    # Constants
    "ANTHROPIC_MODEL_NAMES",
    "MODEL_MAX_TIMEOUT",
    "ANTHROPIC_PRICING",
    "CACHE_DIR",
    "PROMPT_CACHE_MIN_INPUT_TOKENS",
    # Helpers
    "canonicalize_user_message",
    "hash_response_schema",
    "compute_cache_key",
    "compute_cost",
]
