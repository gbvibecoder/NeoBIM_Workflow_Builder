"""PR 6: tests for kos_formwork_router via FastAPI TestClient.

🚨 BOQ uses FLAT error shape — body is `{"error_code", "message", "hint"}` directly,
NOT wrapped under FastAPI's "detail". Tests verify FLAT shape.

🚨 SECURITY tests inject synthetic secrets via monkeypatch and verify the response
body does NOT echo them. FormworkError catch-all uses generic message.
"""
from __future__ import annotations

import dataclasses
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _build_request(mapper_output, context):
    return {
        "mapper_output": dataclasses.asdict(mapper_output),
        "context": dataclasses.asdict(context),
    }


# ═════════════════════════════════════════════════════════════════════
# ROUTER REGISTRATION
# ═════════════════════════════════════════════════════════════════════


class TestRouterRegistration:
    def test_generate_endpoint_registered(self):
        paths = [route.path for route in app.routes]
        assert "/formwork/generate" in paths

    def test_health_endpoint_registered(self):
        paths = [route.path for route in app.routes]
        assert "/formwork/health" in paths


# ═════════════════════════════════════════════════════════════════════
# HEALTH
# ═════════════════════════════════════════════════════════════════════


class TestHealthEndpoint:
    def test_health_returns_200(self):
        response = client.get("/formwork/health")
        assert response.status_code == 200

    def test_health_response_shape(self):
        response = client.get("/formwork/health")
        body = response.json()
        assert body["status"] == "ok"
        assert body["service"] == "kos_formwork_generator"
        assert "schema_version" in body


# ═════════════════════════════════════════════════════════════════════
# HAPPY PATH
# ═════════════════════════════════════════════════════════════════════


class TestGenerateEndpointHappyPath:
    def test_p_int_8_returns_200(self, p_int_8_mapper_output, formwork_context_p_int_8):
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 200, f"Got {response.status_code}: {response.text[:300]}"

    def test_p_int_8_response_is_json(self, p_int_8_mapper_output, formwork_context_p_int_8):
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        assert "application/json" in response.headers.get("content-type", "")
        assert isinstance(response.json(), dict)

    def test_p_int_8_response_has_formwork_id(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        import uuid
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        result = response.json()
        assert "formwork_id" in result
        uuid.UUID(result["formwork_id"])

    def test_p_int_8_byte_equal_vs_golden(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 200
        result = response.json()
        for k, expected in p_int_8_formwork_golden.items():
            assert result.get(k) == expected, (
                f"E2E HTTP byte-equal FAIL on field {k!r}\n"
                f"  expected: {expected!r}\n"
                f"  actual: {result.get(k)!r}"
            )


# ═════════════════════════════════════════════════════════════════════
# 422 — INPUT VALIDATION
# ═════════════════════════════════════════════════════════════════════


class TestErrorMapping_422:
    def test_missing_mapper_output_returns_422(self, formwork_context_p_int_8):
        body = {"context": dataclasses.asdict(formwork_context_p_int_8)}
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        # FLAT shape
        assert result["error_code"] == "FORMWORK_INPUT_INVALID"
        assert "mapper_output" in result["message"]

    def test_missing_context_returns_422(self, p_int_8_mapper_output):
        body = {"mapper_output": dataclasses.asdict(p_int_8_mapper_output)}
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["error_code"] == "FORMWORK_INPUT_INVALID"
        assert "context" in result["message"]

    def test_empty_body_returns_422(self):
        response = client.post("/formwork/generate", json={})
        assert response.status_code == 422

    def test_mapper_output_not_dict_returns_422(self, formwork_context_p_int_8):
        body = {
            "mapper_output": "not a dict",
            "context": dataclasses.asdict(formwork_context_p_int_8),
        }
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["error_code"] == "FORMWORK_INPUT_INVALID"

    def test_invalid_seismic_zone_returns_422(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        """FormworkInputError from IV-F-3 → 422."""
        ctx_dict = dataclasses.asdict(formwork_context_p_int_8)
        ctx_dict["seismic_zone"] = "VII"  # not in allowed set
        body = {
            "mapper_output": dataclasses.asdict(p_int_8_mapper_output),
            "context": ctx_dict,
        }
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["error_code"] == "FORMWORK_INPUT_INVALID"
        assert "IV-F-3" in result["message"]

    def test_negative_pour_rate_returns_422(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        ctx_dict = dataclasses.asdict(formwork_context_p_int_8)
        ctx_dict["pour_rate_m_per_hr"] = -1.0
        body = {
            "mapper_output": dataclasses.asdict(p_int_8_mapper_output),
            "context": ctx_dict,
        }
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["error_code"] == "FORMWORK_INPUT_INVALID"
        assert "IV-F-4" in result["message"]

    def test_empty_project_id_returns_422(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        ctx_dict = dataclasses.asdict(formwork_context_p_int_8)
        ctx_dict["project_id"] = ""
        body = {
            "mapper_output": dataclasses.asdict(p_int_8_mapper_output),
            "context": ctx_dict,
        }
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 422
        result = response.json()
        assert "IV-F-1" in result["message"]


# ═════════════════════════════════════════════════════════════════════
# 500 — INVARIANT VIOLATION
# ═════════════════════════════════════════════════════════════════════


class TestErrorMapping_InvariantViolation:
    def test_invariant_violation_returns_500_with_invariant_id(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """Force FormworkInvariantError via monkeypatch → 500 with invariant_id in body."""
        from app.services.kos_formwork_generator import orchestrator as orch
        from app.services.kos_formwork_generator import FormworkInvariantError

        def fake_validator(output):
            raise FormworkInvariantError("synthetic violation", invariant_id="F-99")

        monkeypatch.setattr(orch, "validate_formwork_output", fake_validator)

        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 500
        result = response.json()
        assert result["error_code"] == "FORMWORK_OUTPUT_INVARIANT_VIOLATED"
        assert result["invariant_id"] == "F-99"
        # Message is orchestrator-controlled (synthetic) — safe to echo
        assert "synthetic violation" in result["message"]


# ═════════════════════════════════════════════════════════════════════
# 500 — SECURITY (FormworkError catch-all uses GENERIC message)
# ═════════════════════════════════════════════════════════════════════


class TestSecurityNoSecretsInBody:
    def test_formwork_error_returns_500_with_generic_message(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """🚨 FormworkError wrapping a RuntimeError with secrets → 500 with GENERIC message.

        The orchestrator wraps Phase-1 RuntimeError as
        ``FormworkError(f"Phase X failed: ...{e}")``. The router MUST NOT echo this
        message to the client (str(e) may contain secrets/paths/tracebacks).
        """
        from app.services.kos_formwork_generator import orchestrator as orch

        SECRET_TOKEN = "API_KEY=abc123XYZ_secret_token"
        SECRET_PATH = "/internal/secret/path.py"

        def fake_count_corners(walls):
            raise RuntimeError(f"failure at {SECRET_PATH}, line 42, with {SECRET_TOKEN}")

        monkeypatch.setattr(orch, "count_corners", fake_count_corners)

        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        assert response.status_code == 500
        result = response.json()
        body_str = json.dumps(result)

        # 🚨 SECURITY ASSERTIONS — wrapped exception details must NOT leak
        assert SECRET_TOKEN not in body_str, f"Secret token leaked: {body_str}"
        assert "API_KEY" not in body_str, f"Key name leaked: {body_str}"
        assert "abc123XYZ" not in body_str
        assert SECRET_PATH not in body_str
        assert "/internal/" not in body_str
        assert "line 42" not in body_str
        assert "Phase 1" not in body_str  # phase tag from orchestrator also internal
        assert "RuntimeError" not in body_str

        # Generic message
        assert result["error_code"] == "FORMWORK_UNSPECIFIED"
        assert result["message"] == "An error occurred during formwork generation."

    def test_no_traceback_in_any_error_body(
        self, p_int_8_mapper_output, formwork_context_p_int_8, monkeypatch,
    ):
        """No error body contains 'Traceback', 'line N', or file paths."""
        from app.services.kos_formwork_generator import orchestrator as orch

        def fake_fn(*args, **kwargs):
            raise RuntimeError(
                "File '/secret/path.py', line 99, in func\nTraceback inner"
            )

        monkeypatch.setattr(orch, "count_corners", fake_fn)

        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        response = client.post("/formwork/generate", json=body)
        result = response.json()
        body_str = json.dumps(result)
        assert "Traceback" not in body_str
        assert "line 99" not in body_str
        assert "/secret/" not in body_str


# ═════════════════════════════════════════════════════════════════════
# SYNTHETIC TRIGGERS VIA HTTP
# ═════════════════════════════════════════════════════════════════════


class TestSyntheticTriggersViaHTTP:
    def test_curved_wall_returns_custom_quote(
        self, p_int_8_mapper_output, formwork_context_p_int_8, curved_wall,
    ):
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        response = client.post(
            "/formwork/generate",
            json=_build_request(mapper, formwork_context_p_int_8),
        )
        assert response.status_code == 200
        result = response.json()
        assert any(
            r["reason"] == "inherited_curved_wall" for r in result["custom_quote_items"]
        )

    def test_zone_v_triggers_both_handlers(
        self, p_int_8_mapper_output, seismic_v_context,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, seismic_v_context),
        )
        assert response.status_code == 200
        result = response.json()
        assert result["custom_quote_items"]
        assert result["operator_review_items"]
        assert result["audit_trail"]["custom_quote_review_required"] is True
        assert result["audit_trail"]["operator_review_required"] is True

    def test_pour_override_triggers_operator_review(
        self, p_int_8_mapper_output, pour_override_context,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, pour_override_context),
        )
        assert response.status_code == 200
        result = response.json()
        assert any(
            r["review_type"] == "pour_rate_override" for r in result["operator_review_items"]
        )


# ═════════════════════════════════════════════════════════════════════
# LOGGING
# ═════════════════════════════════════════════════════════════════════


class TestRequestLogging:
    def test_success_logged_with_formwork_id(
        self, p_int_8_mapper_output, formwork_context_p_int_8, caplog,
    ):
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        with caplog.at_level(logging.INFO):
            client.post("/formwork/generate", json=body)
        text = caplog.text
        assert "SUCCESS" in text
        assert "formwork_id" in text

    def test_request_body_not_in_logs(
        self, p_int_8_mapper_output, formwork_context_p_int_8, caplog,
    ):
        """Full request body / mapper_output contents must NOT appear in logs."""
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        with caplog.at_level(logging.INFO):
            client.post("/formwork/generate", json=body)
        text = caplog.text
        # Router shouldn't log full dataclass repr
        assert "WallSegment(" not in text
        assert "wall_segments=(" not in text


# ═════════════════════════════════════════════════════════════════════
# RESPONSE INTEGRITY
# ═════════════════════════════════════════════════════════════════════


class TestResponseIntegrity:
    def test_response_is_json_safe_types_only(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        result = response.json()

        def check_safe(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    check_safe(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    check_safe(v, f"{path}[{i}]")
            elif obj is None or isinstance(obj, (str, int, float, bool)):
                pass
            else:
                pytest.fail(f"Non-JSON-safe type at {path}: {type(obj).__name__}")

        check_safe(result)
