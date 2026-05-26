"""90VR-MR HTTP E2E — real customer data through the full HTTP pipeline.

573 panels, 37 custom quote items, 6 operator-review orphans. Exercises
the validator, custom-quote handler, operator-review handler, and all 6
tiers end-to-end through HTTP.
"""

from __future__ import annotations

import time


def test_90vr_mr_http_response_status_200(
    client, ninety_vr_mr_request_body,
) -> None:
    """90VR-MR generates successfully — implies all 24 invariants pass."""
    response = client.post("/boq/generate", json=ninety_vr_mr_request_body)
    assert response.status_code == 200, response.text


def test_90vr_mr_http_response_grand_total_positive(
    client, ninety_vr_mr_request_body,
) -> None:
    """Grand total is a positive INR amount."""
    body = client.post("/boq/generate", json=ninety_vr_mr_request_body).json()
    assert body["tier_1_summary"]["grand_total_inr"] > 1_000_000


def test_90vr_mr_http_response_grand_total_formatted_with_rupee_prefix(
    client, ninety_vr_mr_request_body,
) -> None:
    """Indian-comma formatted total starts with ₹."""
    body = client.post("/boq/generate", json=ninety_vr_mr_request_body).json()
    assert body["tier_1_summary"]["grand_total_inr_formatted"].startswith("₹")


def test_90vr_mr_http_response_custom_count_37(
    client, ninety_vr_mr_request_body,
) -> None:
    """🚨 CONTEXT_CONFIRMED Q2: 37 custom items on 90VR-MR."""
    body = client.post("/boq/generate", json=ninety_vr_mr_request_body).json()
    assert len(body["custom_quote_items"]) == 37


def test_90vr_mr_http_response_operator_review_count_6(
    client, ninety_vr_mr_request_body,
) -> None:
    """🚨 CONTEXT_CONFIRMED: 6 orphan operator-review items on 90VR-MR."""
    body = client.post("/boq/generate", json=ninety_vr_mr_request_body).json()
    assert len(body["operator_review_items"]) == 6


def test_90vr_mr_http_response_review_flags_both_true(
    client, ninety_vr_mr_request_body,
) -> None:
    """Both review_required flags True (since 90VR has customs + orphans)."""
    body = client.post("/boq/generate", json=ninety_vr_mr_request_body).json()
    audit = body["audit_trail"]
    assert audit["custom_quote_review_required"] is True
    assert audit["operator_review_required"] is True


def test_90vr_mr_http_response_passes_all_24_invariants(
    client, ninety_vr_mr_request_body,
) -> None:
    """200 status implies validator did not raise on any of the 24 invariants."""
    response = client.post("/boq/generate", json=ninety_vr_mr_request_body)
    assert response.status_code == 200


def test_90vr_mr_http_response_completes_under_5_seconds(
    client, ninety_vr_mr_request_body,
) -> None:
    """Full HTTP request completes <5s (verified separately in test_boq_router.py)."""
    start = time.monotonic()
    response = client.post("/boq/generate", json=ninety_vr_mr_request_body)
    elapsed = time.monotonic() - start
    assert response.status_code == 200
    assert elapsed < 5.0, f"90VR-MR HTTP took {elapsed:.3f}s, expected <5s"
