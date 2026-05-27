"""ID + hash + audit_trail generation for 5F Formwork Quantities Generator.

🚨 MIRROR BOQ id_generator.py EXACTLY (same algorithms, distinct namespace).

Reference: 5F-DESIGN v2 doc 02 §16-§17 (Problem 14-15).

POLICY-DETERMINISM (PR 3 + PR 5): only this module + PR 5 orchestrator may touch
``uuid.uuid4()`` and ``datetime.now()``. All other production modules are pure
transformers operating on (input, context) → output.

Three byte-equal contracts established here (verified against PR 1 golden for P_INT_8):

1. ``mint_formwork_id(ctx)`` — when ``ctx.deterministic_id_seed is not None``,
   returns ``str(uuid.uuid5(_FORMWORK_UUID_NAMESPACE, ctx.deterministic_id_seed))``.
   When None, returns fresh ``uuid.uuid4()`` per call.
   P_INT_8 target: ``"8fad4da7-12da-5686-9373-a1c252f2b1ba"`` (seed='p_int_8_formwork_test_seed').

2. ``compute_mapper_output_hash(mapper_output)`` — SHA-256 hex of canonical JSON:
   ``json.dumps(asdict(mapper_output), sort_keys=True, separators=(",", ":"), default=str)``.
   P_INT_8 target: ``"2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"``.
   This MUST match BOQ's hash for the same mapper_output (different generator, same input).

3. ``compute_context_hash(context)`` — SHA-256 hex of canonical FormworkContext JSON.
   Same algorithm as mapper_output_hash. dataclasses.asdict() converts tuple to list,
   so ``wall_type_overrides=()`` serializes to ``[]``.
   P_INT_8 target: ``"1ca9e2049ae72129f2958354b205f052295cfa6d3843264a7b2650228dccd727"``.

4. ``compute_generated_at(ctx)`` — when override is set, used verbatim;
   else current UTC, microsecond-truncated via ``.isoformat()`` (returns ``+00:00`` suffix).
   P_INT_8 target: ``"2026-05-25T00:00:00Z"`` (verbatim from override).

5. ``build_audit_trail(...)`` — assembles FormworkAuditTrail (7 fields).
   pipeline_versions uses PIPELINE_VERSIONS_DEFAULT constant (3 entries; matches golden).
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Final, Tuple

from app.services.kos_formwork_generator.constants import (
    FIELD_RULE_BOOK_VERSION,
    FORMWORK_CALCULATION_VERSION,
    PIPELINE_VERSIONS_DEFAULT,
)
from app.services.kos_formwork_generator.types import (
    FormworkAuditTrail,
    FormworkContext,
    FormworkCustomQuoteRequest,
    FormworkOperatorReviewItem,
)
from app.services.kos_panel_grid_mapper.types import PanelGridMapperOutput

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# UUID NAMESPACE (5F-specific; distinct from BOQ's a5b8c2d1-...)
# ═════════════════════════════════════════════════════════════════════

#: 5F UUID5 namespace per DESIGN v2 doc 02 §16.
#: Verified via P_INT_8: uuid5(NS, "p_int_8_formwork_test_seed") = "8fad4da7-12da-5686-9373-a1c252f2b1ba".
_FORMWORK_UUID_NAMESPACE: Final[uuid.UUID] = uuid.UUID(
    "b6c9d3e2-5f70-8901-2345-678901abcdef"
)


# ═════════════════════════════════════════════════════════════════════
# UUID5 / UUID4 minting (mirrors BOQ id_generator.mint_boq_id)
# ═════════════════════════════════════════════════════════════════════


def mint_formwork_id(context: FormworkContext) -> str:
    """Mint a UUID for the formwork output.

    Determinism contract:

    * When ``context.deterministic_id_seed is not None`` → produces
      ``uuid.uuid5(_FORMWORK_UUID_NAMESPACE, context.deterministic_id_seed)``.
      Same seed always produces same UUID (golden-test reproducibility).
    * When None → fresh ``uuid.uuid4()`` (production path).

    Seed-check uses ``is not None`` (mirrors BOQ) — empty string is treated as
    a valid (zero-length) deterministic seed, not as "no seed".

    Verified P_INT_8 contract:
        seed='p_int_8_formwork_test_seed' → '8fad4da7-12da-5686-9373-a1c252f2b1ba'
    """
    logger.debug(
        "mint_formwork_id: deterministic_id_seed=%r",
        context.deterministic_id_seed,
    )
    if context.deterministic_id_seed is not None:
        result = str(uuid.uuid5(_FORMWORK_UUID_NAMESPACE, context.deterministic_id_seed))
    else:
        result = str(uuid.uuid4())
    logger.debug("mint_formwork_id: → %s", result)
    return result


# ═════════════════════════════════════════════════════════════════════
# generated_at timestamp (mirrors BOQ compute_generated_at)
# ═════════════════════════════════════════════════════════════════════


def compute_generated_at(context: FormworkContext) -> str:
    """Compute the ``generated_at`` ISO-8601 UTC timestamp.

    Determinism contract:

    * When ``context.generated_at_override is not None`` → used verbatim
      (golden tests pin this to ``"2026-05-25T00:00:00Z"`` for byte-equality).
    * When None → current UTC, microsecond-truncated, with ``'Z'`` suffix
      (matches the golden format + F-20 invariant regex).

    Microsecond truncation removes machine-specific clock-precision differences
    that would destabilize otherwise-deterministic outputs.

    Z-suffix normalization is applied here at source (2026-05-27 post-cleanup;
    previously the orchestrator did this in Phase 6 as a workaround). Doing it
    here means any caller — orchestrator, tests, or future direct callers — gets
    a format that round-trips with the golden + passes F-20 without depending on
    orchestrator-level normalization.
    """
    if context.generated_at_override is not None:
        return context.generated_at_override
    return (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        .replace("+00:00", "Z")
    )


# ═════════════════════════════════════════════════════════════════════
# Hash computation (mirrors BOQ compute_mapper_output_hash + adds context_hash)
# ═════════════════════════════════════════════════════════════════════


def _canonical_json_hash(obj: object) -> str:
    """Compute SHA-256 hex of canonical JSON serialization of a dataclass.

    Canonicalization (matches BOQ id_generator.py):

    * ``dataclasses.asdict(obj)`` — recursive dict conversion (tuple→list).
    * ``json.dumps(d, sort_keys=True, separators=(",", ":"), default=str)`` —
      compact ASCII (escaped) JSON with sorted keys for deterministic ordering.
    * UTF-8 encoded, hashed via ``hashlib.sha256(...).hexdigest()``.

    ``default=str`` is included as a defensive safety net for future schema
    additions that might introduce non-JSON-serializable types.
    """
    if not dataclasses.is_dataclass(obj):
        raise TypeError(
            f"_canonical_json_hash requires a dataclass instance, got {type(obj).__name__}"
        )
    d = dataclasses.asdict(obj)
    canonical_json = json.dumps(
        d,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def compute_mapper_output_hash(mapper_output: PanelGridMapperOutput) -> str:
    """SHA-256 hex digest of canonical mapper output JSON.

    Verified P_INT_8 contract:
        compute_mapper_output_hash(p_int_8_mapper_output)
        = "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"

    This MUST match BOQ's mapper_output_hash for the same input — same algorithm,
    different generator. Identical hash proves the byte-equal contract holds.
    """
    return _canonical_json_hash(mapper_output)


def compute_context_hash(context: FormworkContext) -> str:
    """SHA-256 hex digest of canonical FormworkContext JSON.

    Verified P_INT_8 contract:
        compute_context_hash(formwork_context_p_int_8)
        = "1ca9e2049ae72129f2958354b205f052295cfa6d3843264a7b2650228dccd727"

    Note: ``dataclasses.asdict()`` converts ``wall_type_overrides`` tuple to a list.
    The empty tuple ``()`` serializes to ``[]`` in canonical JSON.
    """
    return _canonical_json_hash(context)


# ═════════════════════════════════════════════════════════════════════
# Audit trail builder
# ═════════════════════════════════════════════════════════════════════


def build_audit_trail(
    mapper_output: PanelGridMapperOutput,
    context: FormworkContext,
    custom_quote_items: Tuple[FormworkCustomQuoteRequest, ...] = (),
    operator_review_items: Tuple[FormworkOperatorReviewItem, ...] = (),
) -> FormworkAuditTrail:
    """Assemble the FormworkAuditTrail (7 fields).

    Fields:
      * mapper_output_hash             — SHA-256 of canonical mapper_output JSON
      * context_hash                   — SHA-256 of canonical FormworkContext JSON
      * formwork_calculation_version   — FORMWORK_CALCULATION_VERSION constant
      * field_rule_book_version        — FIELD_RULE_BOOK_VERSION constant
      * custom_quote_review_required   — True iff len(custom_quote_items) > 0
      * operator_review_required       — True iff len(operator_review_items) > 0
      * pipeline_versions              — PIPELINE_VERSIONS_DEFAULT tuple-of-pairs
    """
    logger.debug(
        "build_audit_trail: %d custom, %d review items",
        len(custom_quote_items), len(operator_review_items),
    )
    return FormworkAuditTrail(
        mapper_output_hash=compute_mapper_output_hash(mapper_output),
        context_hash=compute_context_hash(context),
        formwork_calculation_version=FORMWORK_CALCULATION_VERSION,
        field_rule_book_version=FIELD_RULE_BOOK_VERSION,
        custom_quote_review_required=len(custom_quote_items) > 0,
        operator_review_required=len(operator_review_items) > 0,
        pipeline_versions=PIPELINE_VERSIONS_DEFAULT,
    )
