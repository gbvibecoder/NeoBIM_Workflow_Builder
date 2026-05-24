"""PR 9 — Router tests for POST /kos/generate-panel-layout.

Mounts ONLY the `kos_panel_mapper.router` on a bare FastAPI app — deliberately
avoiding `app.main` so we don't pull in auth, CORS, RequestId, ifcopenshell
self-test, or any other global infrastructure. We're exercising the
router-level contract: serialization, error translation, and the asyncio
hand-off to `map_walls_to_panels`.

The happy-path payload is built by serialising the existing P_INT_8 dataclass
fixture (which is the same input the PR 8 byte-equal acid test uses), so we
get round-trip coverage: dataclass → asdict → JSON → router → Pydantic →
dict → dataclass → mapper → dataclass → asdict → JSON.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.kos_panel_mapper import router
from app.services.kos_panel_grid_mapper import ParserOutput, ProjectContext


# ── helpers / fixtures ──────────────────────────────────────────────────


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Bare app — only the panel-mapper router. No auth, no CORS, no IFC."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _payload(
    parser_output: ParserOutput, project_context: ProjectContext
) -> dict[str, Any]:
    """Convert the dataclass-shaped P_INT_8 fixture into the JSON request body."""
    return {
        "parser_output": dataclasses.asdict(parser_output),
        "project_context": {
            "project_name": project_context.project_name,
            "seismic_zone": project_context.seismic_zone,
            "application_hint": project_context.application_hint,
            "split_strategy": project_context.split_strategy,
            "wall_height_mm": project_context.wall_height_mm,
        },
    }


# ── 200 OK happy path ───────────────────────────────────────────────────


def test_post_generate_panel_layout_returns_200_with_valid_output(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """P_INT_8 → 200 + a structurally-valid PanelGridMapperOutput JSON.

    This is the integration acid test: the same input the PR 8 byte-equal
    test runs through the orchestrator, now exercised over HTTP."""
    resp = client.post(
        "/kos/generate-panel-layout",
        json=_payload(p_int_8_parser_output, p_int_8_project_context),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # PanelGridMapperOutput top-level keys
    for key in (
        "project_name",
        "seismic_zone",
        "split_strategy_used",
        "wall_height_mm",
        "wall_segments",
        "custom_quote_requests",
        "total_counts",
        "total_cost_inr",
        "total_weight_kg",
        "total_skin_kg",
        "total_rib_kg",
        "total_raw_kg",
        "total_waste_kg",
        "warnings",
        "schema_version",
        "generated_at",
        "waste_ratio",
        "downstream_ready",
        "duration_ms",
    ):
        assert key in body, f"missing top-level field: {key}"

    assert body["project_name"] == "VAMSHI RESIDENCE"
    assert body["seismic_zone"] == "III"
    assert body["split_strategy_used"] == "minimize_cuts"
    assert body["wall_height_mm"] == 3000

    # The P_INT_8 segment produces exactly 9 panels of one segment (DESIGN §8.1).
    assert len(body["wall_segments"]) == 1
    seg = body["wall_segments"][0]
    assert seg["system"] == "K4-110"
    # SimpleApplication bucket (not the granular 10-category Application hint).
    # P_INT_8's `application_hint="internal_partition"` collapses to "internal"
    # — matches `golden/p_int_8_canonical.json`.
    assert seg["inferred_application"] == "internal"
    assert len(seg["panels"]) == 9

    # No custom quotes for K4-110.
    assert body["custom_quote_requests"] == []

    # Totals should be positive floats.
    assert body["total_cost_inr"] > 0
    assert body["total_weight_kg"] > 0
    assert isinstance(body["duration_ms"], int)


def test_post_generate_panel_layout_total_counts_shape(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """The TotalCounts dict must serialise with all four roll-up keys."""
    resp = client.post(
        "/kos/generate-panel-layout",
        json=_payload(p_int_8_parser_output, p_int_8_project_context),
    )
    assert resp.status_code == 200
    tc = resp.json()["total_counts"]
    for key in ("by_sku", "by_type", "by_thickness", "grand_total", "by_segment"):
        assert key in tc
    assert tc["grand_total"] == 9
    assert len(tc["by_segment"]) == 1
    assert tc["by_segment"][0]["panel_count"] == 9


# ── 400: MapperInputError translation (IV-1 .. IV-5b) ───────────────────


def test_iv1_non_floor_plan_returns_400(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """IV-1: non-FLOOR_PLAN classification → MapperInputError → 400."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["parser_output"]["drawing_classification"] = "DETAIL"
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 400
    j = resp.json()
    assert j["error"] == "MAPPER_INPUT_INVALID"
    assert "IV-1" in j["message"]


def test_iv2_downstream_not_ready_returns_400(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """IV-2: parser flagged boq=False → 400."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["parser_output"]["downstream_ready"]["boq"] = False
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 400
    assert resp.json()["error"] == "MAPPER_INPUT_INVALID"
    assert "IV-2" in resp.json()["message"]


def test_iv3_empty_walls_returns_400(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """IV-3: zero walls → 400."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["parser_output"]["walls"] = []
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 400
    j = resp.json()
    assert j["error"] == "MAPPER_INPUT_INVALID"
    assert "IV-3" in j["message"]


# ── 422: Pydantic validation (FastAPI default handler) ──────────────────


def test_empty_project_name_returns_422(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """Pydantic's `min_length=1` rejects empty project_name BEFORE the mapper sees it."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["project_context"]["project_name"] = ""
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 422


def test_invalid_seismic_zone_returns_422(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """Literal['II','III','IV','V'] rejects 'I' (retired zone) at Pydantic layer."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["project_context"]["seismic_zone"] = "I"
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 422


def test_extra_field_in_project_context_returns_422(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """`extra='forbid'` rejects unknown keys (catches client/server drift)."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    body["project_context"]["unknown_field"] = "bogus"
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 422


# ── 400: dict→dataclass conversion failures ─────────────────────────────


def test_missing_parser_output_key_returns_400(
    client: TestClient,
    p_int_8_parser_output: ParserOutput,
    p_int_8_project_context: ProjectContext,
) -> None:
    """Removing a required key on the parser_output dict trips _api_to_dataclass."""
    body = _payload(p_int_8_parser_output, p_int_8_project_context)
    del body["parser_output"]["drawing_classification"]
    resp = client.post("/kos/generate-panel-layout", json=body)
    assert resp.status_code == 400
    assert resp.json()["error"] == "MAPPER_INPUT_CONVERSION_FAILED"


# ── Smoke: endpoint is reachable via the registered prefix ──────────────


def test_route_is_registered_under_kos_prefix(client: TestClient) -> None:
    """Hitting the path with no body should return 422 (empty body), proving
    the route exists at the expected URL."""
    resp = client.post("/kos/generate-panel-layout")
    assert resp.status_code == 422
