"""Router behavior tests for kos_boq_router (POST /boq/generate + GET /boq/health).

Coverage:
- Health endpoint contract
- Generate endpoint happy path
- Response structure (16 fields, sub-shapes)
- Determinism through HTTP
- Performance
- Method semantics (HTTP verb routing, prefix routing)
"""

from __future__ import annotations

import time


# ──────────────────────────────────────────────────────────────────────────────
# Health endpoint
# ──────────────────────────────────────────────────────────────────────────────


def test_health_endpoint_returns_200(client) -> None:
    response = client.get("/boq/health")
    assert response.status_code == 200


def test_health_response_includes_service_name(client) -> None:
    body = client.get("/boq/health").json()
    assert body["service"] == "kos_boq_generator"


def test_health_response_includes_schema_version(client) -> None:
    """schema_version sourced from BOQ_SCHEMA_VERSION constant (not hardcoded)."""
    from app.services.kos_boq_generator import BOQ_SCHEMA_VERSION
    body = client.get("/boq/health").json()
    assert body["schema_version"] == BOQ_SCHEMA_VERSION


def test_health_response_has_correct_content_type(client) -> None:
    response = client.get("/boq/health")
    assert response.headers["content-type"].startswith("application/json")


def test_health_response_has_status_ok(client) -> None:
    assert client.get("/boq/health").json()["status"] == "ok"


# ──────────────────────────────────────────────────────────────────────────────
# Generate endpoint — happy path
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_endpoint_returns_200_on_valid_input(
    client, p_int_8_request_body,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200, response.text


def test_generate_response_is_json(client, p_int_8_request_body) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.headers["content-type"].startswith("application/json")


def test_generate_response_includes_all_16_fields(
    client, p_int_8_request_body,
) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    expected = {
        "boq_id", "generated_at", "schema_version",
        "tier_1_summary", "tier_2_categories", "tier_3_sku_types",
        "tier_4_sku_details", "tier_5_wall_segments", "tier_6_panel_pieces",
        "custom_quote_items", "operator_review_items",
        "commercial_terms", "audit_trail",
        "warnings", "assumptions_made", "pending_karthik",
    }
    assert set(body.keys()) == expected


def test_generate_response_includes_boq_id(client, p_int_8_request_body) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    assert "boq_id" in body
    assert len(body["boq_id"]) == 36  # UUID length


def test_generate_response_includes_mapper_output_hash(
    client, p_int_8_request_body,
) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    assert "mapper_output_hash" in body["audit_trail"]
    assert len(body["audit_trail"]["mapper_output_hash"]) == 64  # SHA-256 hex


# ──────────────────────────────────────────────────────────────────────────────
# Sub-shape structural tests
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_response_tier1_summary_has_expected_keys(
    client, p_int_8_request_body,
) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    t1 = body["tier_1_summary"]
    for key in (
        "quote_number", "quote_date", "quote_validity_until",
        "grand_total_inr", "grand_total_inr_formatted",
        "tax_inr", "discount_inr",
    ):
        assert key in t1, f"Tier 1 missing key: {key}"


def test_generate_response_audit_trail_has_expected_keys(
    client, p_int_8_request_body,
) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    audit = body["audit_trail"]
    for key in (
        "mapper_output_hash", "boq_calculation_version",
        "karthik_pricing_version", "custom_quote_review_required",
        "operator_review_required", "pipeline_versions",
    ):
        assert key in audit, f"audit_trail missing key: {key}"


def test_generate_response_commercial_terms_has_expected_keys(
    client, p_int_8_request_body,
) -> None:
    body = client.post("/boq/generate", json=p_int_8_request_body).json()
    ct = body["commercial_terms"]
    for key in ("payment_terms", "delivery_terms", "quote_validity_until", "notes"):
        assert key in ct, f"commercial_terms missing key: {key}"


# ──────────────────────────────────────────────────────────────────────────────
# Determinism
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_endpoint_deterministic_with_override(
    client, p_int_8_request_body,
) -> None:
    """With deterministic_id_seed + generated_at_override set, two calls produce
    identical responses."""
    a = client.post("/boq/generate", json=p_int_8_request_body).json()
    b = client.post("/boq/generate", json=p_int_8_request_body).json()
    assert a == b


def test_two_identical_requests_produce_identical_responses(
    client, p_int_8_request_body,
) -> None:
    """Same body sent twice — full response equality."""
    r1 = client.post("/boq/generate", json=p_int_8_request_body)
    r2 = client.post("/boq/generate", json=p_int_8_request_body)
    assert r1.json() == r2.json()


# ──────────────────────────────────────────────────────────────────────────────
# Performance
# ──────────────────────────────────────────────────────────────────────────────


def test_generate_endpoint_under_5_seconds_for_90vr_mr(
    client, ninety_vr_mr_request_body,
) -> None:
    """90VR-MR (573 panels) over HTTP completes <5s."""
    start = time.monotonic()
    response = client.post("/boq/generate", json=ninety_vr_mr_request_body)
    elapsed = time.monotonic() - start
    assert response.status_code == 200
    assert elapsed < 5.0, f"90VR-MR HTTP took {elapsed:.3f}s, expected <5s"


def test_generate_endpoint_under_1_second_for_p_int_8(
    client, p_int_8_request_body,
) -> None:
    """Small fixture (9 panels) HTTP completes <1s."""
    start = time.monotonic()
    response = client.post("/boq/generate", json=p_int_8_request_body)
    elapsed = time.monotonic() - start
    assert response.status_code == 200
    assert elapsed < 1.0, f"P_INT_8 HTTP took {elapsed:.3f}s, expected <1s"


# ──────────────────────────────────────────────────────────────────────────────
# HTTP verb + path semantics
# ──────────────────────────────────────────────────────────────────────────────


def test_health_endpoint_uses_get(client) -> None:
    """GET /boq/health returns 200; POST should return 405."""
    assert client.get("/boq/health").status_code == 200
    assert client.post("/boq/health").status_code == 405


def test_generate_endpoint_uses_post(client) -> None:
    """POST /boq/generate is supported; GET should return 405."""
    assert client.get("/boq/generate").status_code == 405


def test_endpoint_paths_are_under_boq_prefix(app) -> None:
    """Both endpoints are mounted under /boq/."""
    paths = [r.path for r in app.routes if hasattr(r, "path")]
    boq_paths = sorted(p for p in paths if p.startswith("/boq"))
    assert "/boq/generate" in boq_paths
    assert "/boq/health" in boq_paths
