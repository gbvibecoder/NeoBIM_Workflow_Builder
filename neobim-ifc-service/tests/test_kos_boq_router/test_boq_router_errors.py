"""Error-path tests for kos_boq_router.

Coverage:
- 422 for malformed body (missing fields, wrong types, bad JSON)
- 500 for BOQInvariantError (with invariant_id in response)
- Error response shape: {"error_code", "message", "hint"} flat
- No stack traces in response
"""

from __future__ import annotations

from unittest.mock import patch


# ──────────────────────────────────────────────────────────────────────────────
# 422 — input validation errors
# ──────────────────────────────────────────────────────────────────────────────


def test_empty_body_returns_422(client) -> None:
    response = client.post("/boq/generate", json={})
    assert response.status_code == 422


def test_missing_mapper_output_returns_422_with_boq_input_invalid_code(
    client, p_int_8_request_body,
) -> None:
    body = {"context": p_int_8_request_body["context"]}
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error_code"] == "BOQ_INPUT_INVALID"
    assert "mapper_output" in response.json()["message"]


def test_missing_context_returns_422_with_boq_input_invalid_code(
    client, p_int_8_request_body,
) -> None:
    body = {"mapper_output": p_int_8_request_body["mapper_output"]}
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error_code"] == "BOQ_INPUT_INVALID"
    assert "context" in response.json()["message"]


def test_mapper_output_not_dict_returns_422(
    client, p_int_8_request_body,
) -> None:
    body = {
        "mapper_output": "not-a-dict",
        "context": p_int_8_request_body["context"],
    }
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error_code"] == "BOQ_INPUT_INVALID"


def test_context_not_dict_returns_422(
    client, p_int_8_request_body,
) -> None:
    body = {
        "mapper_output": p_int_8_request_body["mapper_output"],
        "context": [1, 2, 3],
    }
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422


def test_mapper_output_missing_required_fields_returns_422(
    client, p_int_8_request_body,
) -> None:
    """Required mapper field missing → deserializer raises → BOQInputError."""
    bad_mapper = {"project_name": "X"}  # missing 99% of required fields
    body = {
        "mapper_output": bad_mapper,
        "context": p_int_8_request_body["context"],
    }
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error_code"] == "BOQ_INPUT_INVALID"


def test_context_missing_required_fields_returns_422(
    client, p_int_8_request_body,
) -> None:
    """Required context field missing → BOQContext constructor raises."""
    body = {
        "mapper_output": p_int_8_request_body["mapper_output"],
        "context": {},  # missing project_id + quote_date (required)
    }
    response = client.post("/boq/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error_code"] == "BOQ_INPUT_INVALID"


def test_invalid_json_returns_422_via_fastapi_default(client) -> None:
    """Malformed JSON triggers FastAPI's RequestValidationError → 422.

    The response shape comes from FastAPI's default (not our BOQ handler),
    so we just check the status code.
    """
    response = client.post(
        "/boq/generate",
        content="{not valid json",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422


# ──────────────────────────────────────────────────────────────────────────────
# Error response structure (flat shape; no detail wrapping)
# ──────────────────────────────────────────────────────────────────────────────


def test_422_error_response_has_error_code(client) -> None:
    body = client.post("/boq/generate", json={}).json()
    assert "error_code" in body
    assert body["error_code"] == "BOQ_INPUT_INVALID"


def test_422_error_response_has_message(client) -> None:
    body = client.post("/boq/generate", json={}).json()
    assert "message" in body
    assert isinstance(body["message"], str)
    assert len(body["message"]) > 0


def test_422_error_response_has_hint_field(client) -> None:
    """hint field exists (may be None)."""
    body = client.post("/boq/generate", json={}).json()
    assert "hint" in body


def test_422_error_response_is_flat_not_detail_wrapped(client) -> None:
    """PR 6 contract: NO {'detail': {...}} wrapping."""
    body = client.post("/boq/generate", json={}).json()
    assert "detail" not in body or not isinstance(body.get("detail"), dict)
    assert "error_code" in body  # top-level, not under detail


def test_error_response_does_not_leak_stack_trace(client) -> None:
    """Error responses must NOT contain 'traceback' or 'Traceback'."""
    body = client.post("/boq/generate", json={}).json()
    body_repr = repr(body)
    assert "Traceback" not in body_repr
    assert "traceback" not in body_repr
    assert ".py" not in body_repr  # No file paths leaked


# ──────────────────────────────────────────────────────────────────────────────
# 500 — BOQInvariantError via monkeypatch
# ──────────────────────────────────────────────────────────────────────────────


def test_invariant_violation_returns_500_with_invariant_id(
    client, p_int_8_request_body,
) -> None:
    """BOQInvariantError → 500 with invariant_id in flat response.

    Patches orchestrator's local reference to validate_boq_output to
    force a hard-invariant failure.
    """
    from app.services.kos_boq_generator.exceptions import BOQInvariantError

    def fake_validate(**kwargs):
        raise BOQInvariantError("B-99 FAIL: test trigger", invariant_id="B-99")

    with patch(
        "app.services.kos_boq_generator.orchestrator.validate_boq_output",
        side_effect=fake_validate,
    ):
        response = client.post("/boq/generate", json=p_int_8_request_body)

    assert response.status_code == 500
    body = response.json()
    assert body["error_code"] == "BOQ_OUTPUT_INVARIANT_VIOLATED"
    assert body["invariant_id"] == "B-99"
    assert "B-99 FAIL" in body["message"]


def test_invariant_violation_500_response_has_all_required_fields(
    client, p_int_8_request_body,
) -> None:
    """500 BOQInvariantError response shape: error_code + invariant_id + message + hint."""
    from app.services.kos_boq_generator.exceptions import BOQInvariantError

    def fake_validate(**kwargs):
        raise BOQInvariantError(
            "B-99 FAIL: test trigger",
            invariant_id="B-99",
            hint="diagnostic hint",
        )

    with patch(
        "app.services.kos_boq_generator.orchestrator.validate_boq_output",
        side_effect=fake_validate,
    ):
        response = client.post("/boq/generate", json=p_int_8_request_body)

    body = response.json()
    assert {"error_code", "invariant_id", "message", "hint"} <= set(body.keys())
    assert body["hint"] == "diagnostic hint"
