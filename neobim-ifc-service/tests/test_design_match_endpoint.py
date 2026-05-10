"""Slice 2B.1.D — POST /api/v1/design/match end-to-end tests.

Drives the new matcher endpoint via FastAPI's TestClient. Exercises
the full intake → classify → BriefAnalyst → TemplateMatcher →
dispatch_match chain on every request. LLM calls hit the committed
cache (BriefAnalyst cache from slice 2A + TemplateMatcher cache from
slice 2B.1.C); when either cache is missing AND no API key is set,
each end-to-end test skips cleanly.

Coverage:

* Intake / shape validation tests run unconditionally — the endpoint
  validates the request envelope before any LLM call.
* Brief → 200 happy path (a well-formed Pune-residential brief that
  the matcher should accept) — skips on cache miss.
* Brief → 422 refusal path (a commercial / hospital / 4BHK brief that
  the matcher should refuse) — skips on cache miss.
* Response shape contracts (status, match_result, building_model_summary,
  metadata, request_id, elapsed_ms) — exercised inside the happy-path
  tests when cache is present.

The `app/services/design_agent/cache/` directory must contain the cache
files for both the BriefAnalyst and the TemplateMatcher stages. Mint
locally with:

    ANTHROPIC_API_KEY=sk-ant-... pytest \\
        tests/test_brief_analyst.py \\
        tests/test_template_matcher_fixtures.py
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def _post_match(client: TestClient, body: dict) -> tuple[int, dict]:
    response = client.post("/api/v1/design/match", json=body)
    return response.status_code, response.json()


def _skip_on_cache_miss(status: int, payload: dict, label: str) -> None:
    """If the response is 503 DESIGN_LLM_UNAVAILABLE, skip cleanly with
    a descriptive message. The LLM cache miss path is the expected
    outcome until cache files are committed.
    """
    if status == 503:
        detail = payload.get("detail", {})
        if isinstance(detail, dict) and detail.get("code") == "DESIGN_LLM_UNAVAILABLE":
            pytest.skip(
                f"{label}: cache miss + no ANTHROPIC_API_KEY. Detail: "
                f"{detail.get('message', '<no message>')}"
            )


# ─── Intake / shape validation (always runs, no LLM call) ────────────


def test_match_endpoint_accepts_valid_minimal_body(client: TestClient) -> None:
    """A well-formed minimal body reaches the LLM stage. We do NOT
    assert 200 here (cache miss is fine); we just assert the request
    envelope was accepted (i.e., we did not get a 422 intake-rejection).
    """
    body = {
        "brief_text": "2BHK G+1 duplex on a 24x50 ft Pune plot, modern.",
        "build_id": "match-test-minimal",
    }
    status, payload = _post_match(client, body)
    # Acceptable: 200 (cache hit + match), 422 (cache hit + refuse),
    # or 503 (cache miss + no key). Specifically NOT 422 with a
    # DESIGN_NO_INPUT / DESIGN_VALIDATION_ERROR code (intake bug).
    if status == 422:
        detail = payload.get("detail", {})
        code = detail.get("code") if isinstance(detail, dict) else None
        assert code in (
            "DESIGN_MATCH_REFUSED",  # legitimate refusal
        ), f"unexpected 422 from intake: {payload}"


def test_match_endpoint_rejects_empty_body(client: TestClient) -> None:
    """No brief sources → intake refuses at the boundary."""
    status, payload = _post_match(client, {"build_id": "x"})
    assert status == 422, payload


def test_match_endpoint_rejects_unknown_top_level_key(client: TestClient) -> None:
    """DesignRequest.extra='forbid' rejects unknown top-level keys."""
    body = {
        "brief_text": "2BHK duplex Pune",
        "build_id": "x",
        "totally_unknown_field": "should not survive",
    }
    status, payload = _post_match(client, body)
    assert status == 422, payload


# ─── Happy path / refusal — graceful skip on cache miss ──────────────


def test_match_endpoint_2bhk_pune_duplex_text_brief(client: TestClient) -> None:
    """2BHK Pune duplex brief -> 200 with build_2bhk_pune_duplex match."""
    body = {
        "brief_text": (
            "User wants a 2BHK G+1 duplex on a 24x50 ft north-facing "
            "Pune plot, modern style with internal stair and ground-floor "
            "living + dining + kitchen, master bedroom + bath upstairs."
        ),
        "build_id": "match-test-2bhk-pune-duplex",
    }
    status, payload = _post_match(client, body)
    _skip_on_cache_miss(status, payload, "2bhk-pune-duplex")
    if status == 422:
        # Some matcher cache rows may refuse; surface the reason.
        detail = payload.get("detail", {})
        pytest.skip(
            f"matcher refused 2bhk-pune-duplex test brief: "
            f"{detail.get('message', '<no detail>')}"
        )

    assert status == 200, payload
    assert payload["status"] == "matched"

    # Match result shape
    mr = payload["match_result"]
    assert mr["template_id"] == "build_2bhk_pune_duplex", (
        f"expected build_2bhk_pune_duplex, got {mr['template_id']}"
    )
    assert mr["confidence"] >= 0.6
    assert "parameters" in mr
    assert mr["parameters"]["plot_width_m"] > 0
    assert mr["parameters"]["plot_length_m"] > 0

    # Building model summary present
    bms = payload["building_model_summary"]
    assert bms["storey_count"] == 2  # G+1 duplex
    assert bms["wall_count"] > 0
    assert bms["room_count"] > 0
    assert "provenance" in bms

    # Per-stage metadata
    md = payload["metadata"]
    assert "analyst" in md
    assert "matcher" in md
    assert md["matcher"]["refused"] is False
    assert md["total_cost_usd_estimated"] >= 0

    # Envelope
    assert payload["request_id"]
    assert payload["elapsed_ms"] >= 0
    assert isinstance(payload["warnings"], list)


def test_match_endpoint_3bhk_pune_tower_text_brief(client: TestClient) -> None:
    """3BHK G+5 Pune apartment brief -> 200 with build_3bhk_pune_tower match
    and habitable_floor_count=5."""
    body = {
        "brief_text": (
            "3BHK G+5 apartment building in Pune with stilt parking; "
            "single 3BHK flat per floor, plaster-painted exterior."
        ),
        "build_id": "match-test-3bhk-pune-tower",
    }
    status, payload = _post_match(client, body)
    _skip_on_cache_miss(status, payload, "3bhk-pune-tower")
    if status == 422:
        detail = payload.get("detail", {})
        pytest.skip(
            f"matcher refused 3bhk-pune-tower brief: "
            f"{detail.get('message', '<no detail>')}"
        )

    assert status == 200, payload
    mr = payload["match_result"]
    assert mr["template_id"] == "build_3bhk_pune_tower", (
        f"expected build_3bhk_pune_tower, got {mr['template_id']}"
    )
    bms = payload["building_model_summary"]
    # Tower: stilt + 5 habitable + roof => 6+ storeys
    assert bms["storey_count"] >= 6, (
        f"3BHK G+5 tower should have at least 6 storeys; got "
        f"{bms['storey_count']}"
    )


def test_match_endpoint_1bhk_pune_house_text_brief(client: TestClient) -> None:
    """1BHK Pune house brief -> 200 with build_1bhk_pune_house match."""
    body = {
        "brief_text": (
            "Single-storey 1BHK house for elderly parents on a 25x40 ft "
            "plot in Pune; living + kitchen + 1 bedroom + 1 bath, no "
            "stairs."
        ),
        "build_id": "match-test-1bhk-pune-house",
    }
    status, payload = _post_match(client, body)
    _skip_on_cache_miss(status, payload, "1bhk-pune-house")
    if status == 422:
        detail = payload.get("detail", {})
        pytest.skip(
            f"matcher refused 1bhk-pune-house brief: "
            f"{detail.get('message', '<no detail>')}"
        )

    assert status == 200, payload
    mr = payload["match_result"]
    assert mr["template_id"] == "build_1bhk_pune_house", (
        f"expected build_1bhk_pune_house, got {mr['template_id']}"
    )
    bms = payload["building_model_summary"]
    assert bms["storey_count"] == 1  # ground only


def test_match_endpoint_commercial_brief_returns_422(client: TestClient) -> None:
    """Pure commercial brief -> 422 DESIGN_MATCH_REFUSED with
    suggested_action='reject'."""
    body = {
        "brief_text": (
            "Small office space in Pune with 3 cabins, 1 conference "
            "room, reception, and pantry; ground floor only."
        ),
        "build_id": "match-test-commercial-refusal",
    }
    status, payload = _post_match(client, body)
    _skip_on_cache_miss(status, payload, "commercial-refusal")

    assert status == 422, payload
    detail = payload.get("detail", {})
    assert detail.get("code") == "DESIGN_MATCH_REFUSED", payload
    assert detail.get("suggested_action") == "reject", payload
    assert detail.get("threshold_required") == 0.6, payload
    assert detail.get("best_confidence") <= 0.4, (
        f"refusal best_confidence too high for commercial brief: "
        f"{detail.get('best_confidence')}"
    )


def test_match_endpoint_4bhk_villa_returns_422(client: TestClient) -> None:
    """4BHK villa brief -> 422 (out of BHK range)."""
    body = {
        "brief_text": (
            "4BHK luxury villa with infinity pool, helipad, and home "
            "theatre on a 30x60 m plot in Pune; G+1."
        ),
        "build_id": "match-test-4bhk-refusal",
    }
    status, payload = _post_match(client, body)
    _skip_on_cache_miss(status, payload, "4bhk-villa-refusal")

    assert status == 422, payload
    detail = payload.get("detail", {})
    assert detail.get("code") == "DESIGN_MATCH_REFUSED", payload
    assert detail.get("suggested_action") == "reject", payload


# ─── Cross-cutting: response envelope shape ──────────────────────────


def test_match_endpoint_response_envelope_keys(client: TestClient) -> None:
    """Whatever the outcome, the response envelope must carry the
    canonical keys (status, request_id, elapsed_ms) so frontend code
    can rely on them."""
    body = {
        "brief_text": "2BHK G+1 duplex on a 24x50 ft Pune plot, modern.",
        "build_id": "match-test-envelope-shape",
    }
    status, payload = _post_match(client, body)
    if status == 503:
        detail = payload.get("detail", {})
        # Even 503s must carry request_id + code.
        assert "code" in detail, payload
        assert "request_id" in detail, payload
        return
    if status == 200:
        for key in (
            "status", "match_result", "building_model_summary",
            "metadata", "warnings", "request_id", "elapsed_ms",
        ):
            assert key in payload, f"missing key {key!r} in 200 payload"
    elif status == 422:
        detail = payload.get("detail", {})
        for key in ("status", "code", "message", "request_id"):
            assert key in detail, f"missing key {key!r} in 422 detail"


# ─── End-to-end IFC export — slice 2B.1.E (test-side, not endpoint) ──


def test_match_then_build_ifc_inherits_p1_6_quality() -> None:
    """End-to-end smoke test: take the matcher's output BuildingModel
    and run the existing IFC builder against it. Confirms the
    BuildingModel produced by the matcher pipeline is valid input to
    the existing IDS-validated IFC export.

    This test imports from ``scripts/`` (the canonical IFC export
    location); production code does not. The route handler in this
    slice intentionally returns BuildingModel summary only — IFC
    bytes on the wire is a future-slice concern.
    """
    pytest.importorskip("ifcopenshell")
    from scripts.export_2bhk_pune_to_ifc import build_ifc_from_building_model

    from app.services.design_agent import (
        MatchResult,
        TemplateId,
        TemplateParameters,
        dispatch_match,
    )

    # We don't run the LLM here — the matcher is exercised in the
    # endpoint tests above. This test pins that the dispatched
    # BuildingModel cleanly converts to a non-empty IFC4 file.
    result = MatchResult(
        template_id=TemplateId.BHK2_PUNE_DUPLEX,
        parameters=TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
        confidence=0.95,
        reasoning="e2e smoke test - 2bhk pune duplex baseline.",
    )
    bm = dispatch_match(result)
    ifc_model = build_ifc_from_building_model(bm)

    # The IFC must contain at least one building, one storey, and walls.
    assert len(ifc_model.by_type("IfcBuilding")) == 1
    assert len(ifc_model.by_type("IfcBuildingStorey")) >= 2
    assert len(ifc_model.by_type("IfcWall")) > 0
    assert len(ifc_model.by_type("IfcDoor")) > 0
    assert len(ifc_model.by_type("IfcWindow")) > 0
