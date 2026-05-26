"""BOQ ID generator + audit trail builder + mapper output hash.

Sources:

* 02_ALGORITHMS.md Problem 10 — BOQ ID + audit trail
* POLICY-DETERMINISM (PR 1 + 4): only this module + ``generator.py`` (PR 5)
  may touch ``uuid.uuid4()`` and ``datetime.now()``. All other production
  modules are pure transformers.

Three byte-equal contracts established here (verified by pre-flight B + C):

1. ``mint_boq_id(ctx)`` — when ``ctx.deterministic_id_seed`` is set,
   returns ``str(uuid.uuid5(_BOQ_UUID_NAMESPACE, ctx.deterministic_id_seed))``.
   When None, returns fresh ``uuid.uuid4()`` per call.
2. ``compute_mapper_output_hash(mapper_output)`` — SHA-256 hex of
   ``json.dumps(asdict(mapper_output), sort_keys=True, separators=(",", ":"))``.
   ``generated_at`` field IS included (P_INT_8 fixture pins it to fixed value).
3. ``compute_generated_at(ctx)`` — when override is set, used verbatim;
   else current UTC, microsecond-truncated for stability.

Verified contract values for P_INT_8 (pre-flight B + C):

* seed = ``"p_int_8_test_seed"``, namespace = ``_BOQ_UUID_NAMESPACE``
  → ``fd9d8a26-97e4-50e2-a623-47327379d185``
* canonical mapper JSON → SHA-256 =
  ``2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588``

ARCHITECTURAL NOTE (anti-pattern #46 / divergence from prompt):

The prompt's §5.2 example showed a 3-argument signature
``generate_boq_id(project_id, quote_date, mapper_output_hash)``.
PR 1's actual BOQContext design uses a single ``deterministic_id_seed: Optional[str]``
field — the seed is the string itself, NOT a pdh-concat. Pre-flight C verified
exactly one match: ``uuid.uuid5(_BOQ_UUID_NAMESPACE, ctx.deterministic_id_seed)``.

PR 4 follows PR 1's actual contract (audit-first discipline). The prompt's
example signature would have produced a DIFFERENT UUID5 and broken the golden
byte-equal test. Documented as PR 4 Discrepancy.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import uuid
from datetime import datetime, timezone

from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

from .constants import (
    BOQ_CALCULATION_VERSION,
    KARTHIK_PRICING_VERSION,
    _BOQ_UUID_NAMESPACE,
)
from .types import (
    BOQAuditTrail,
    BOQContext,
    CustomQuoteLineItem,
    OperatorReviewItem,
)


# Pipeline-version pairs (audit trail). Tuple-of-pairs for immutability +
# determinism (matches BOQAuditTrail.pipeline_versions schema from PR 1).
# Versions sorted alphabetically by component name (anti-pattern #20 carry).
_PIPELINE_VERSIONS_DEFAULT: tuple[tuple[str, str], ...] = (
    ("boq", "v1.0"),
    ("mapper", "v1.0"),
    ("mapper_hotfix_1", "splitter-short-segment-hardening"),
    ("mapper_hotfix_2", "opening-consumer-wiring"),
    ("parser", "v1.0"),
)


# ──────────────────────────────────────────────────────────────────────────────
# BOQ ID minting (UUID5 deterministic / UUID4 fresh)
# ──────────────────────────────────────────────────────────────────────────────


def mint_boq_id(context: BOQContext) -> str:
    """Mint a UUID for the BOQ output.

    Determinism contract (POLICY-BOQ-AUDIT-TRAIL):

    * When ``context.deterministic_id_seed`` is not None → produces
      ``uuid.uuid5(_BOQ_UUID_NAMESPACE, context.deterministic_id_seed)``.
      Same seed always produces same UUID (golden-test reproducibility).
    * When None → fresh ``uuid.uuid4()`` (production path; each BOQ
      generation event gets its own random UUID).

    Pre-flight C verified the byte-equal contract:
      ``mint_boq_id(BOQContext(..., deterministic_id_seed="p_int_8_test_seed"))``
      → ``"fd9d8a26-97e4-50e2-a623-47327379d185"`` (golden value).
    """
    if context.deterministic_id_seed is not None:
        return str(uuid.uuid5(_BOQ_UUID_NAMESPACE, context.deterministic_id_seed))
    return str(uuid.uuid4())


# ──────────────────────────────────────────────────────────────────────────────
# generated_at computation (override or current UTC, microsecond-truncated)
# ──────────────────────────────────────────────────────────────────────────────


def compute_generated_at(context: BOQContext) -> str:
    """Compute the ``generated_at`` ISO-8601 UTC timestamp.

    Determinism contract:

    * When ``context.generated_at_override`` is not None → used verbatim
      (golden tests pin this to ``"2026-05-25T00:00:00Z"`` for byte-equality).
    * When None → current UTC, microsecond-truncated for CI/environment
      stability (sub-second resolution isn't commercially relevant for a BOQ).

    ASSUMPTION-BOQ-21: microsecond truncation removes machine-specific
    clock-precision differences that would otherwise destabilize fresh
    UUID4 ``generated_at`` pairings across environments.
    """
    if context.generated_at_override is not None:
        return context.generated_at_override
    # Current UTC, microsecond-truncated to whole seconds.
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ──────────────────────────────────────────────────────────────────────────────
# Mapper output hash (SHA-256 of canonical JSON serialization)
# ──────────────────────────────────────────────────────────────────────────────


def compute_mapper_output_hash(mapper_output: PanelGridMapperOutput) -> str:
    """SHA-256 hex digest of the canonical JSON serialization of mapper output.

    Canonicalization (verified by pre-flight B against golden):

    * ``dataclasses.asdict(mapper_output)`` — recursive dict conversion
    * ``json.dumps(d, sort_keys=True, separators=(",", ":"))`` — compact
      ASCII (escaped) JSON with sorted keys for deterministic ordering
    * UTF-8 encoded, hashed via ``hashlib.sha256(...).hexdigest()``

    ``default=str`` is included as a defensive safety net for future schema
    additions that might introduce non-JSON-serializable types. It produces
    identical output for the current schema (verified empirically).

    ``mapper_output.generated_at`` IS included in the hash. P_INT_8 fixture
    pins this field to a fixed value (``"2026-05-24T00:00:00Z"``) for
    byte-equality. Production runs include the live timestamp; each BOQ
    generation will see a unique mapper hash.

    Pre-flight B verified the byte-equal contract:
      ``compute_mapper_output_hash(p_int_8_mapper_output)``
      → ``"2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"``
      (golden value).
    """
    d = dataclasses.asdict(mapper_output)
    canonical_json = json.dumps(
        d,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


# ──────────────────────────────────────────────────────────────────────────────
# Audit trail builder
# ──────────────────────────────────────────────────────────────────────────────


def build_audit_trail(
    mapper_output: PanelGridMapperOutput,
    custom_quote_items: tuple[CustomQuoteLineItem, ...],
    operator_review_items: tuple[OperatorReviewItem, ...],
) -> BOQAuditTrail:
    """Assemble the BOQ audit trail.

    Components:

    * ``mapper_output_hash`` — SHA-256 of canonical mapper JSON (this module)
    * ``boq_calculation_version`` — from PR 1 constants (``v1.0``)
    * ``karthik_pricing_version`` — from PR 1 constants
    * ``custom_quote_review_required`` — True when any custom items present
    * ``operator_review_required`` — True when any operator review items present
    * ``pipeline_versions`` — frozen tuple-of-pairs (sorted alphabetically by
      component name)
    """
    return BOQAuditTrail(
        mapper_output_hash=compute_mapper_output_hash(mapper_output),
        boq_calculation_version=BOQ_CALCULATION_VERSION,
        karthik_pricing_version=KARTHIK_PRICING_VERSION,
        custom_quote_review_required=len(custom_quote_items) > 0,
        operator_review_required=len(operator_review_items) > 0,
        pipeline_versions=_PIPELINE_VERSIONS_DEFAULT,
    )
