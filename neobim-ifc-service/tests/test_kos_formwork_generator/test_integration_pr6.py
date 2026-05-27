"""PR 6: E2E HTTP integration tests — POST → byte-equal response.

🎉 STAGE B CLOSURE TEST FILE: customer flow end-to-end.
"""
from __future__ import annotations

import dataclasses
import json

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
# E2E BYTE-EQUAL — closes the customer contract
# ═════════════════════════════════════════════════════════════════════


class TestE2EByteEqual:
    def test_full_p_int_8_byte_equal_via_http(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        """🎯 THE customer contract: POST P_INT_8 → response body == PR 1 golden EXACTLY."""
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        assert response.status_code == 200
        result = response.json()
        for k, expected in p_int_8_formwork_golden.items():
            assert result.get(k) == expected, (
                f"E2E HTTP byte-equal FAIL on field {k!r}\n"
                f"  expected: {expected!r}\n"
                f"  actual: {result.get(k)!r}"
            )

    def test_response_audit_trail_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        assert response.json()["audit_trail"] == p_int_8_formwork_golden["audit_trail"]

    def test_response_all_tiers_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        result = response.json()
        for tier_key in (
            "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
            "tier_4_sku_details", "tier_5_wall_segments", "tier_6_components",
        ):
            assert result[tier_key] == p_int_8_formwork_golden[tier_key], (
                f"{tier_key} diverged via HTTP"
            )

    def test_response_handler_outputs_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        result = response.json()
        assert result["custom_quote_items"] == p_int_8_formwork_golden["custom_quote_items"]
        assert result["operator_review_items"] == p_int_8_formwork_golden["operator_review_items"]

    def test_response_orchestrator_fields_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8, p_int_8_formwork_golden,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        result = response.json()
        assert result["warnings"] == p_int_8_formwork_golden["warnings"]
        assert result["assumptions_made"] == p_int_8_formwork_golden["assumptions_made"]
        assert result["pending_karthik"] == p_int_8_formwork_golden["pending_karthik"]


# ═════════════════════════════════════════════════════════════════════
# E2E DETERMINISM
# ═════════════════════════════════════════════════════════════════════


class TestE2EDeterminism:
    def test_repeated_http_requests_byte_equal(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        body = _build_request(p_int_8_mapper_output, formwork_context_p_int_8)
        results = []
        for _ in range(3):
            response = client.post("/formwork/generate", json=body)
            assert response.status_code == 200
            results.append(response.json())
        for r in results[1:]:
            assert r == results[0]


# ═════════════════════════════════════════════════════════════════════
# E2E SYNTHETIC TRIGGERS
# ═════════════════════════════════════════════════════════════════════


class TestE2ESyntheticTriggers:
    def test_curved_wall_e2e(
        self, p_int_8_mapper_output, formwork_context_p_int_8, curved_wall,
    ):
        mapper = dataclasses.replace(p_int_8_mapper_output, wall_segments=(curved_wall,))
        response = client.post(
            "/formwork/generate",
            json=_build_request(mapper, formwork_context_p_int_8),
        )
        assert response.status_code == 200
        result = response.json()
        assert result["custom_quote_items"]
        assert result["audit_trail"]["custom_quote_review_required"] is True

    def test_zone_v_e2e(self, p_int_8_mapper_output, seismic_v_context):
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


# ═════════════════════════════════════════════════════════════════════
# E2E RESPONSE SERIALIZATION
# ═════════════════════════════════════════════════════════════════════


class TestE2EResponseSerialization:
    def test_response_round_trips_through_json(
        self, p_int_8_mapper_output, formwork_context_p_int_8,
    ):
        response = client.post(
            "/formwork/generate",
            json=_build_request(p_int_8_mapper_output, formwork_context_p_int_8),
        )
        raw = response.json()
        serialized = json.dumps(raw)
        parsed = json.loads(serialized)
        assert parsed == raw
