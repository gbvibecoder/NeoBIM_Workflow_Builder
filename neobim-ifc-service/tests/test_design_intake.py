"""Phase 2A Slice 2A.3 — multi-input intake tests.

Covers :func:`parse_design_request`. Every test constructs a fresh
``raw_body`` dict inline (no shared fixture) so failures pin to a
single combination of input shape — same independent-test discipline
as the Phase 1 ``test_building_model_construction.py`` and the
Slice 2A.1 / 2A.2 test files.

Topics covered (15+ tests):
* PDF-only routes (URL string, pre-extracted text)
* Form-only with explicit fields
* Text-only
* Every 2-of-3 combination + all-3 combination
* No-input → 422 ``DESIGN_NO_INPUT``
* Schema-validation failure → 422 ``DESIGN_VALIDATION_ERROR`` with
  per-field ``loc`` / ``msg`` / ``type`` triples
* ``_comment`` strip at top level
* ``_comment`` strip inside nested ``brief_form``
* Unknown top-level key → 422 (extra="forbid" preserved)
* Empty / missing ``build_id`` stamped with UUID4
* Client-supplied ``build_id`` honoured (idempotency-key contract)
* Non-dict body → 422 with structured detail
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import pytest
from fastapi import HTTPException

from app.services.design_agent import DesignRequest, parse_design_request
from app.services.design_agent.intake import (
    ERROR_CODE_NO_INPUT,
    ERROR_CODE_VALIDATION,
)


# ─── Helpers ──────────────────────────────────────────────────────────


_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def _detail(exc: HTTPException) -> dict[str, Any]:
    """Unpack an HTTPException's structured detail dict."""
    assert isinstance(exc.detail, dict), f"detail not a dict: {exc.detail!r}"
    return exc.detail


# ─── Single-source happy paths ────────────────────────────────────────


def test_intake_accepts_pdf_url_only() -> None:
    req = parse_design_request({"brief_pdf_url": "https://example.com/brief.pdf"})
    assert req.brief_pdf_url == "https://example.com/brief.pdf"
    assert req.brief_text is None


def test_intake_accepts_pdf_text_only() -> None:
    req = parse_design_request({"brief_pdf_text": "extracted text"})
    assert req.brief_pdf_text == "extracted text"


def test_intake_accepts_form_only() -> None:
    req = parse_design_request(
        {"brief_form": {"floors": 3, "bhk_count": 2}}
    )
    assert req.brief_form is not None
    assert req.brief_form.floors == 3


def test_intake_accepts_text_only() -> None:
    req = parse_design_request({"brief_text": "modern 2BHK"})
    assert req.brief_text == "modern 2BHK"


# ─── Combined-source happy paths (every 2-of-3 + all 3) ───────────────


def test_intake_accepts_text_plus_form() -> None:
    req = parse_design_request(
        {"brief_text": "modern", "brief_form": {"floors": 3}}
    )
    assert req.brief_text == "modern"
    assert req.brief_form is not None and req.brief_form.floors == 3


def test_intake_accepts_text_plus_pdf() -> None:
    req = parse_design_request(
        {"brief_text": "modern", "brief_pdf_text": "page 1 text"}
    )
    assert req.brief_text == "modern"
    assert req.brief_pdf_text == "page 1 text"


def test_intake_accepts_form_plus_pdf() -> None:
    req = parse_design_request(
        {
            "brief_form": {"floors": 3},
            "brief_pdf_url": "https://example.com/x.pdf",
        }
    )
    assert req.brief_pdf_url is not None
    assert req.brief_form is not None


def test_intake_accepts_all_three_sources() -> None:
    req = parse_design_request(
        {
            "brief_text": "modern apartment",
            "brief_pdf_url": "https://example.com/x.pdf",
            "brief_form": {"floors": 4, "bhk_count": 3},
        }
    )
    assert req.brief_text is not None
    assert req.brief_pdf_url is not None
    assert req.brief_form is not None


# ─── Failure paths ────────────────────────────────────────────────────


def test_intake_no_input_raises_422_design_no_input() -> None:
    with pytest.raises(HTTPException) as ei:
        parse_design_request({})
    assert ei.value.status_code == 422
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_NO_INPUT
    assert "brief_pdf_url" in detail["message"]


def test_intake_empty_form_alone_does_not_satisfy_at_least_one() -> None:
    """An untouched ``BriefForm`` has no explicit fields → no input.

    Mirrors the classifier's parametric-signal logic so both layers
    agree on what "an empty form" means.
    """
    with pytest.raises(HTTPException) as ei:
        parse_design_request({"brief_form": {}})
    assert ei.value.status_code == 422
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_NO_INPUT


def test_intake_malformed_body_yields_validation_errors() -> None:
    """Wrong field type → 422 DESIGN_VALIDATION_ERROR with structured rows."""
    with pytest.raises(HTTPException) as ei:
        parse_design_request({"brief_form": {"floors": "not-a-number"}})
    assert ei.value.status_code == 422
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_VALIDATION
    errs = detail["validation_errors"]
    assert isinstance(errs, list) and errs
    # Per-field loc identifies the failing field path
    assert any(e["loc"][-1] == "floors" for e in errs), errs


def test_intake_extra_top_level_key_rejected_by_extra_forbid() -> None:
    """Unknown top-level key → 422 (extra='forbid' on DesignRequest)."""
    with pytest.raises(HTTPException) as ei:
        parse_design_request(
            {"brief_text": "modern", "totally_unknown_key": "x"}
        )
    assert ei.value.status_code == 422
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_VALIDATION


def test_intake_non_dict_body_yields_structured_422() -> None:
    """A list / string / None body → 422 with a clear message."""
    with pytest.raises(HTTPException) as ei:
        parse_design_request(["not", "a", "dict"])  # type: ignore[arg-type]
    assert ei.value.status_code == 422
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_VALIDATION


def test_intake_target_fidelity_invalid_literal_rejected() -> None:
    """Bad target_fidelity → schema validation 422."""
    with pytest.raises(HTTPException) as ei:
        parse_design_request(
            {"brief_text": "x", "target_fidelity": "totally-bogus-tier"}
        )
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_VALIDATION


# ─── _comment whitelist ───────────────────────────────────────────────


def test_intake_strips_top_level_comment_key() -> None:
    """Top-level ``_comment`` is stripped — extra='forbid' does not fire."""
    req = parse_design_request(
        {
            "_comment": "This is a Phase 0/1 fixture-style annotation.",
            "brief_text": "modern",
        }
    )
    assert req.brief_text == "modern"


def test_intake_strips_nested_brief_form_comment_key() -> None:
    """Nested ``_comment`` inside ``brief_form`` also stripped — picked
    strip-not-422 per Slice 2A.3 design-choice documentation."""
    req = parse_design_request(
        {
            "brief_form": {
                "_comment": "fixture annotation",
                "floors": 4,
            }
        }
    )
    assert req.brief_form is not None
    assert req.brief_form.floors == 4


def test_intake_comment_only_top_level_does_not_satisfy_at_least_one() -> None:
    """``_comment`` alone is just metadata — no actual brief content."""
    with pytest.raises(HTTPException) as ei:
        parse_design_request({"_comment": "annotated"})
    detail = _detail(ei.value)
    assert detail["code"] == ERROR_CODE_NO_INPUT


# ─── build_id stamping ────────────────────────────────────────────────


def test_intake_stamps_build_id_when_missing() -> None:
    """Client omitted ``build_id`` → server stamps a UUID4."""
    req = parse_design_request({"brief_text": "modern"})
    assert _UUID4_RE.match(req.build_id), f"not uuid4: {req.build_id}"


def test_intake_stamps_build_id_when_empty_string() -> None:
    """Empty-string ``build_id`` is treated as missing — schema would
    otherwise reject via ``min_length=1``."""
    req = parse_design_request({"brief_text": "modern", "build_id": ""})
    assert _UUID4_RE.match(req.build_id)


def test_intake_preserves_explicit_build_id_for_idempotency() -> None:
    """Client supplied a build_id → preserved (idempotency-key contract)."""
    explicit = "client-id-2026-05-07-abc123"
    req = parse_design_request(
        {"brief_text": "modern", "build_id": explicit}
    )
    assert req.build_id == explicit


def test_intake_each_call_generates_unique_build_id() -> None:
    """Two consecutive missing-build_id calls → distinct UUIDs."""
    a = parse_design_request({"brief_text": "modern"})
    b = parse_design_request({"brief_text": "modern"})
    assert a.build_id != b.build_id
    assert _UUID4_RE.match(a.build_id)
    assert _UUID4_RE.match(b.build_id)


# ─── Returned object shape ───────────────────────────────────────────


def test_intake_returns_design_request_instance() -> None:
    req = parse_design_request({"brief_text": "x"})
    assert isinstance(req, DesignRequest)


def test_intake_returns_default_target_fidelity_when_omitted() -> None:
    req = parse_design_request({"brief_text": "x"})
    assert req.target_fidelity == "design-development"


def test_intake_honours_explicit_target_fidelity() -> None:
    req = parse_design_request(
        {"brief_text": "x", "target_fidelity": "tender-ready"}
    )
    assert req.target_fidelity == "tender-ready"


# ─── auto_vision_retry flag (Slice 2A.3 follow-up) ───────────────────


def test_intake_auto_vision_retry_defaults_false() -> None:
    """Default behaviour: surface VISION_REQUIRED warning, do not auto-retry."""
    req = parse_design_request({"brief_text": "x"})
    assert req.auto_vision_retry is False


def test_intake_auto_vision_retry_explicit_true_honoured() -> None:
    """Client opts in to auto-retry → flag preserved."""
    req = parse_design_request(
        {"brief_text": "x", "auto_vision_retry": True}
    )
    assert req.auto_vision_retry is True
