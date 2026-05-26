"""THE MASTER HTTP E2E TEST (PR 6).

End-to-end byte-equal contract: P_INT_8 BOQInput sent as JSON over HTTP
produces a JSON response field-by-field equal to the PR 1 golden BOQ.

If the MASTER test fails:

* Serialization difference → check ``boq_output_to_dict`` + FastAPI encoder
  (pre-flight B Part 2 confirmed equivalence — investigate regression)
* Content drift → PR 5 contract broken; STOP and investigate
* Per-Tier mismatch → the failing tier's algorithm has drifted

This test exercises the FULL pipeline through HTTP:
    json → router → _dict_to_dataclass → BOQInput → generate_boq →
    BOQGeneratorOutput → asdict → JSONResponse → response.json()
"""

from __future__ import annotations

import pytest


# ──────────────────────────────────────────────────────────────────────────────
# THE MASTER HTTP E2E TEST — FIRST in this file (PR 6 anti-pattern #93)
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_http_response_byte_equal_to_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    """🚨 MASTER HTTP E2E TEST — response JSON matches golden byte-equal."""
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    body = response.json()
    response_keys = set(body.keys())
    golden_keys = set(p_int_8_boq_canonical_json.keys())

    if response_keys != golden_keys:
        only_in_response = sorted(response_keys - golden_keys)
        only_in_golden = sorted(golden_keys - response_keys)
        pytest.fail(
            "Top-level field set mismatch.\n"
            f"  Only in response: {only_in_response}\n"
            f"  Only in golden:   {only_in_golden}"
        )

    diffs: list[str] = []
    for key in sorted(golden_keys):
        if body[key] != p_int_8_boq_canonical_json[key]:
            c_repr = repr(body[key])
            g_repr = repr(p_int_8_boq_canonical_json[key])
            if len(c_repr) > 400 or len(g_repr) > 400:
                diffs.append(f"  {key}: <large value differs>")
            else:
                diffs.append(
                    f"  {key}:\n"
                    f"    response={c_repr}\n"
                    f"    golden  ={g_repr}"
                )

    if diffs:
        pytest.fail(
            f"HTTP MASTER E2E reproduction FAILED ({len(diffs)} field(s) differ):\n"
            + "\n".join(diffs)
        )


# ──────────────────────────────────────────────────────────────────────────────
# Per-field byte-equal HTTP reproductions
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_http_response_boq_id_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["boq_id"] == p_int_8_boq_canonical_json["boq_id"]
    assert response.json()["boq_id"] == "fd9d8a26-97e4-50e2-a623-47327379d185"


def test_p_int_8_http_response_mapper_output_hash_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    expected = p_int_8_boq_canonical_json["audit_trail"]["mapper_output_hash"]
    assert response.json()["audit_trail"]["mapper_output_hash"] == expected
    assert (
        response.json()["audit_trail"]["mapper_output_hash"]
        == "2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588"
    )


def test_p_int_8_http_response_generated_at_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["generated_at"] == p_int_8_boq_canonical_json["generated_at"]


def test_p_int_8_http_response_schema_version_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["schema_version"] == p_int_8_boq_canonical_json["schema_version"]


def test_p_int_8_http_response_tier1_summary_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_1_summary"] == p_int_8_boq_canonical_json["tier_1_summary"]


def test_p_int_8_http_response_tier2_categories_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_2_categories"] == p_int_8_boq_canonical_json["tier_2_categories"]


def test_p_int_8_http_response_tier3_sku_types_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_3_sku_types"] == p_int_8_boq_canonical_json["tier_3_sku_types"]


def test_p_int_8_http_response_tier4_sku_details_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_4_sku_details"] == p_int_8_boq_canonical_json["tier_4_sku_details"]


def test_p_int_8_http_response_tier5_wall_segments_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_5_wall_segments"] == p_int_8_boq_canonical_json["tier_5_wall_segments"]


def test_p_int_8_http_response_tier6_panel_pieces_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["tier_6_panel_pieces"] == p_int_8_boq_canonical_json["tier_6_panel_pieces"]


def test_p_int_8_http_response_commercial_terms_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["commercial_terms"] == p_int_8_boq_canonical_json["commercial_terms"]


def test_p_int_8_http_response_audit_trail_matches_golden(
    client, p_int_8_request_body, p_int_8_boq_canonical_json,
) -> None:
    response = client.post("/boq/generate", json=p_int_8_request_body)
    assert response.status_code == 200
    assert response.json()["audit_trail"] == p_int_8_boq_canonical_json["audit_trail"]
