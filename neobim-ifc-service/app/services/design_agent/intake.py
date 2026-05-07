"""Phase 2A Slice 2A.3 — multi-input request intake.

Public entry point: :func:`parse_design_request`. Takes the raw JSON
body the route handler received, strips documented ``_comment`` keys
(test-fixture annotations carried over from Phase 0/1 fixture
conventions), stamps a server-generated ``build_id`` if the client
omitted one, validates against :class:`DesignRequest`, and then
asserts at-least-one-input — at least one of ``brief_pdf_url``,
``brief_pdf_text``, ``brief_form`` (with at least one explicit field),
or ``brief_text`` must be present.

Failures
--------
Every failure path raises ``fastapi.HTTPException(status_code=422)``
with a structured ``detail`` payload::

    {
        "code": <string>,
        "message": <human-readable>,
        "validation_errors": [<pydantic-error-shape>, ...]   # only on schema failures
    }

Codes:

* ``DESIGN_NO_INPUT`` — request had no PDF / form / text content.
* ``DESIGN_VALIDATION_ERROR`` — Pydantic schema validation failed.
  ``validation_errors`` carries the per-field ``loc`` / ``msg`` /
  ``type`` so the client can fix the request without log archaeology.

The intake layer is sync — it does no I/O. PDF text extraction (which
does have I/O) lives in :mod:`pdf_extractor` and is invoked by the
route handler downstream of intake.

Design choices documented here for review
-----------------------------------------
* **`_comment` handling.** Stripped at both the top level (where Phase
  0/1 fixtures place it) and inside ``brief_form`` (Slice 2A.3
  user-spec'd ambiguity — we picked strip-not-422 so a client can
  paste a documented form snippet directly without first cleaning it).
  The strip is surgical: only the literal key ``"_comment"`` is
  removed; nothing else is rewritten.
* **`extra="forbid"` on DesignRequest.** Any unknown top-level key
  other than ``_comment`` lands in
  ``DESIGN_VALIDATION_ERROR`` rather than being silently dropped.
  ``BriefForm`` keeps the default ``extra="ignore"`` for forward-
  compat reasons documented in :class:`DesignRequest` — adding form
  fields server-side should not break older clients.
* **`build_id` stamping.** If the client omits ``build_id`` (or sends
  an empty string), intake stamps a UUID4. If the client supplies a
  ``build_id``, intake honours it — useful for client-side
  idempotency keys and retries.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from app.services.design_agent.types import DesignRequest


log = logging.getLogger(__name__)


# Error codes — kept as module constants so route handlers and tests
# can reference them without string-typing them inline.
ERROR_CODE_NO_INPUT: str = "DESIGN_NO_INPUT"
ERROR_CODE_VALIDATION: str = "DESIGN_VALIDATION_ERROR"


def parse_design_request(raw_body: dict[str, Any]) -> DesignRequest:
    """Validate + normalise an incoming design-request body.

    Returns a fully-populated :class:`DesignRequest` (with a guaranteed
    non-empty ``build_id``). Raises :class:`fastapi.HTTPException` with
    status 422 and a structured detail payload on any failure.
    """
    if not isinstance(raw_body, dict):
        raise HTTPException(
            status_code=422,
            detail={
                "code": ERROR_CODE_VALIDATION,
                "message": (
                    "Request body must be a JSON object, got "
                    f"{type(raw_body).__name__}."
                ),
                "validation_errors": [],
            },
        )

    cleaned = _strip_comments(raw_body)
    cleaned = _stamp_build_id_if_missing(cleaned)

    try:
        request = DesignRequest(**cleaned)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": ERROR_CODE_VALIDATION,
                "message": "Request payload failed schema validation.",
                "validation_errors": _format_validation_errors(exc),
            },
        ) from exc

    if not _has_any_input(request):
        raise HTTPException(
            status_code=422,
            detail={
                "code": ERROR_CODE_NO_INPUT,
                "message": (
                    "At least one of brief_pdf_url, brief_pdf_text, "
                    "brief_form (with at least one explicit field), or "
                    "brief_text must be provided."
                ),
                "validation_errors": [],
            },
        )

    return request


# ─── Helpers ──────────────────────────────────────────────────────────


def _strip_comments(raw_body: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy with ``_comment`` keys removed top-level + brief_form.

    Phase 0/1 fixture convention: every JSON test fixture carries a
    leading ``_comment`` describing the test's purpose. The Phase 1
    request schema whitelisted this via ``model_validator(mode="before")``;
    Phase 2A's intake centralises the strip so the same convention works
    for design-agent fixtures (Slices 2A.5 / 2A.6) without duplicating
    the whitelist on every Pydantic model.

    The strip is surgical: only the literal key ``"_comment"`` is
    removed at the documented locations (top level + ``brief_form``).
    Other unknown top-level keys still trip ``extra="forbid"`` on
    :class:`DesignRequest`.
    """
    out = {k: v for k, v in raw_body.items() if k != "_comment"}
    form = out.get("brief_form")
    if isinstance(form, dict):
        out["brief_form"] = {k: v for k, v in form.items() if k != "_comment"}
    return out


def _stamp_build_id_if_missing(cleaned: dict[str, Any]) -> dict[str, Any]:
    """Stamp a server-generated UUID4 ``build_id`` when the client omitted one.

    Honours an explicit non-empty client-supplied ``build_id`` (useful
    for idempotency keys). Treats an empty-string ``build_id`` as
    missing — the schema's ``Field(min_length=1)`` would reject it
    otherwise, and a client almost certainly meant "please generate".
    """
    if "build_id" not in cleaned or not cleaned.get("build_id"):
        cleaned["build_id"] = str(uuid.uuid4())
    return cleaned


def _has_any_input(request: DesignRequest) -> bool:
    """At-least-one-input check.

    A ``BriefForm`` with no explicitly-set fields (``model_fields_set``
    empty) does not count — it carries no actual user signal even
    though the field is structurally present. Mirrors the classifier's
    parametric-signal logic (Slice 2A.2) so the two layers agree on
    what "an empty form" means.
    """
    if request.brief_pdf_url:
        return True
    if request.brief_pdf_text:
        return True
    if request.brief_text:
        return True
    if request.brief_form is not None and request.brief_form.model_fields_set:
        return True
    return False


def _format_validation_errors(exc: ValidationError) -> list[dict[str, Any]]:
    """Format a Pydantic v2 ValidationError into a JSON-safe list."""
    out: list[dict[str, Any]] = []
    for err in exc.errors():
        out.append(
            {
                "loc": list(err.get("loc", [])),
                "msg": err.get("msg", ""),
                "type": err.get("type", ""),
            }
        )
    return out


__all__ = [
    "parse_design_request",
    "ERROR_CODE_NO_INPUT",
    "ERROR_CODE_VALIDATION",
]
