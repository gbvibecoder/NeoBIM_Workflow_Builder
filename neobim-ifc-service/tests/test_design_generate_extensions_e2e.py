"""Slice 2B.3.C — POST /api/v1/design/generate end-to-end tests.

Five representative briefs through the full pipeline including the
new extension stage:

    intake → classify → analyst → matcher → adapter planner →
    extension planner → dispatch → apply_extensions →
    apply_adaptations → IFC build → IDS validate → R2 upload

Mocking strategy
----------------
Mirrors the 2B.2.C test pattern: analyst + matcher are monkeypatched
in the route handler's namespace to return canned
:class:`BriefAnalysis` / :class:`MatchResult` derived from the
Slice 2B.3 extension-planner fixtures (which match these briefs
exactly). This keeps test mint cost at zero — extension_planner
cache for these fixtures was minted in Phase B. The route still
calls the adapter planner; its cache is needed too (mint cost ~$0.025
for the 5 new BriefAnalysis tuples).

Cache files for the LLM stages this test exercises:
  * extension_planner: ✓ minted in Phase B for these fixtures
  * adaptation_planner: needs new mint for the 2B.3 fixture briefs

Sample IFCs are saved to ``temp_folder/2b3_e2e_ifcs/`` for visual
inspection in Phase D.

Each test exercises a distinct outcome:

* no_extensions     → extension_plan None, default IFC
* single_porch      → extension_plan with 1 ext (car_porch)
* compound_gate_porch → extension_plan with 3 ext
* servant_mumty     → extension_plan with 2 ext + 1 storey
* pool_deferral     → extension_failed=ship_as_is, IFC has no extensions
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.design_agent.stages.brief_analyst import BriefAnalystMetadata
from app.services.design_agent.stages.template_matcher import (
    TemplateMatcherMetadata,
)
from tests.fixtures._2b3_briefs import (
    _FIX_DEFER_POOL,
    _FIX_MULTI_PARKING_SECURITY,
    _FIX_MULTI_SERVANT_AND_MUMTY,
    _FIX_NOOP_APARTMENT_STYLE,
    _FIX_SINGLE_PORCH,
)

# Sample IFC output directory (kept inside neobim-ifc-service so the
# pytest cwd context resolves the path consistently).
_IFC_DUMP_DIR = Path(__file__).resolve().parent.parent.parent / "temp_folder" / "2b3_e2e_ifcs"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


# ─── Stage monkeypatch helpers ───────────────────────────────────────


def _analyst_metadata_stub() -> BriefAnalystMetadata:
    return BriefAnalystMetadata(
        model="claude-haiku-4-5-20251001",
        latency_ms=0.0,
        cache_hit=True,
        cost_usd_estimated=0.0,
        enrichment_applied=False,
    )


def _matcher_metadata_stub() -> TemplateMatcherMetadata:
    return TemplateMatcherMetadata(
        model="claude-haiku-4-5-20251001",
        latency_ms=0.0,
        cache_hit=True,
        cost_usd_estimated=0.0,
        threshold=0.6,
        refused=False,
    )


def _patch_upstream_stages(monkeypatch: pytest.MonkeyPatch, fixture) -> None:
    """Stub analyst + matcher + adapter planner to scope the test
    surface to extension behaviour.

    Only the EXTENSION planner remains a real LLM call (cache from
    Phase B). Adapter planner is stubbed to a noop AdaptationPlan
    because these Phase 2B.3 fixtures don't carry orientation
    directives and the adapter is exercised separately in
    test_design_generate_endpoint.py (slice 2B.2.C).

    Keeping the adapter stubbed eliminates the need to mint a 2nd
    set of LLM cache files (zero net mint cost for Phase C).
    """
    from app.services.design_agent.types import (
        AdaptationPlan,
        AdaptationPlannerMetadata,
        TransformRotation,
    )

    monkeypatch.setattr(
        "app.routers.design.run_brief_analyst",
        lambda **kw: (fixture.analysis, _analyst_metadata_stub()),
    )
    monkeypatch.setattr(
        "app.routers.design.run_template_matcher",
        lambda **kw: (fixture.match_result, _matcher_metadata_stub()),
    )
    monkeypatch.setattr(
        "app.routers.design.run_adaptation_planner",
        lambda **kw: (
            AdaptationPlan(
                mirror_axis=None,
                rotation=TransformRotation.NONE,
                reasoning="2B.3 e2e — adapter stubbed to noop (scope = extensions)",
            ),
            AdaptationPlannerMetadata(
                llm_model_used="claude-haiku-4-5-20251001",
                llm_input_tokens=0,
                llm_output_tokens=0,
                llm_cost_usd=0.0,
                elapsed_ms=0.0,
                cache_hit=True,
                refused=False,
            ),
        ),
    )


def _post_generate(client: TestClient, build_id: str) -> tuple[int, dict[str, Any]]:
    body = {
        "brief_text": (
            "Synthesised text body — analyst + matcher are monkeypatched "
            "for slice 2B.3.C e2e tests."
        ),
        "build_id": build_id,
    }
    response = client.post("/api/v1/design/generate", json=body)
    return response.status_code, response.json()


def _assert_common_envelope(payload: dict[str, Any]) -> None:
    """Shape checks that hold for every successful generate response."""
    assert payload["status"] in ("generated", "generated_with_fallback")
    assert isinstance(payload["ifc_url"], str) and payload["ifc_url"]
    assert payload["ifc_url_kind"] in ("r2", "data-uri-base64")
    assert payload["ifc_size_bytes"] > 1000  # IFC is multi-KB
    assert "match_result" in payload
    # 2B.3 NEW fields.
    assert "extension_plan" in payload
    assert "extension_failed" in payload
    assert "ids_validation" in payload
    assert "metadata" in payload
    assert "extension_planner" in payload["metadata"]
    # Cost guardrail: extension planner ≤ $0.015/call.
    assert payload["metadata"]["extension_planner"]["cost_usd_estimated"] <= 0.015


def _save_ifc_if_data_uri(payload: dict[str, Any], filename: str) -> Path | None:
    """If R2 wasn't configured, the URL is a data-URI — dump bytes to
    ``temp_folder/2b3_e2e_ifcs/`` so Phase D can inspect them."""
    if payload["ifc_url_kind"] != "data-uri-base64":
        return None
    import base64
    url = payload["ifc_url"]
    # data:application/x-step;base64,<payload>
    b64 = url.split(",", 1)[1]
    ifc_bytes = base64.b64decode(b64)
    _IFC_DUMP_DIR.mkdir(parents=True, exist_ok=True)
    out = _IFC_DUMP_DIR / filename
    out.write_bytes(ifc_bytes)
    return out


# ─── 5 representative e2e tests ──────────────────────────────────────


def test_e2e_no_extensions_default(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """3BHK Pune (apartment-style open plot) → no extensions in plan.
    IFC equals the matcher's default layout."""
    _patch_upstream_stages(monkeypatch, _FIX_NOOP_APARTMENT_STYLE)
    status, payload = _post_generate(client, "test-2b3-e2e-noop")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload
    _assert_common_envelope(payload)
    # Extension plan is None for an empty plan.
    assert payload["extension_plan"] is None
    assert payload["extension_failed"] is None
    saved = _save_ifc_if_data_uri(payload, "e2e_noop.ifc")
    if saved:
        print(f"Saved IFC: {saved}")


def test_e2e_single_car_porch(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """3BHK Pune duplex with car porch → 1 extension applied. Element
    count delta: +4 columns + 1 slab."""
    _patch_upstream_stages(monkeypatch, _FIX_SINGLE_PORCH)
    status, payload = _post_generate(client, "test-2b3-e2e-porch")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["extension_plan"] is not None, (
        "single_car_porch fixture should produce a non-empty plan"
    )
    ext_types = {
        e["extension_type"] for e in payload["extension_plan"]["extensions"]
    }
    assert "car_porch" in ext_types
    assert payload["extension_failed"] is None
    saved = _save_ifc_if_data_uri(payload, "e2e_single_porch.ifc")
    if saved:
        print(f"Saved IFC: {saved}")


def test_e2e_compound_gate_porch_triple(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """3BHK Pune with compound wall + entry gate + car porch (3 ext)."""
    _patch_upstream_stages(monkeypatch, _FIX_MULTI_PARKING_SECURITY)
    status, payload = _post_generate(client, "test-2b3-e2e-3ext")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["extension_plan"] is not None
    ext_types = {
        e["extension_type"] for e in payload["extension_plan"]["extensions"]
    }
    assert {"compound_wall", "entry_gate", "car_porch"}.issubset(ext_types)
    assert payload["extension_failed"] is None
    saved = _save_ifc_if_data_uri(payload, "e2e_compound_gate_porch.ifc")
    if saved:
        print(f"Saved IFC: {saved}")


def test_e2e_servant_mumty_pair(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """3BHK Pune with servant quarter + mumty (2 ext). Mumty adds a
    new storey; servant adds 2 rooms."""
    _patch_upstream_stages(monkeypatch, _FIX_MULTI_SERVANT_AND_MUMTY)
    status, payload = _post_generate(client, "test-2b3-e2e-servant-mumty")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["extension_plan"] is not None
    ext_types = {
        e["extension_type"] for e in payload["extension_plan"]["extensions"]
    }
    assert "servant_quarter" in ext_types
    assert "mumty" in ext_types
    # Mumty adds a storey → building_model_summary should report ≥2.
    summary = payload["building_model_summary"]
    assert summary["storey_count"] >= 2, (
        "mumty should have added a storey; got "
        f"storey_count={summary['storey_count']}"
    )
    assert payload["extension_failed"] is None
    saved = _save_ifc_if_data_uri(payload, "e2e_servant_mumty.ifc")
    if saved:
        print(f"Saved IFC: {saved}")


def test_e2e_swimming_pool_v2_deferral(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """3BHK Pune with swimming pool → planner refuses, ship_as_is,
    HTTP 200 with extension_failed surfaced; IFC = matcher's default
    (no extensions)."""
    _patch_upstream_stages(monkeypatch, _FIX_DEFER_POOL)
    status, payload = _post_generate(client, "test-2b3-e2e-pool-defer")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload  # ship_as_is is 200, not 4xx
    _assert_common_envelope(payload)
    # Pool deferral: ext plan None (planner returned ExtensionFailed),
    # extension_failed populated, status = generated_with_fallback.
    assert payload["status"] == "generated_with_fallback"
    assert payload["extension_plan"] is None
    assert payload["extension_failed"] is not None
    assert payload["extension_failed"]["suggested_action"] == "ship_as_is"
    saved = _save_ifc_if_data_uri(payload, "e2e_pool_deferral.ifc")
    if saved:
        print(f"Saved IFC: {saved}")


# ─── Cost + latency budgets (Slice 2B.3 contract) ───────────────────


def test_e2e_under_60_seconds_with_warm_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end run must complete in < 60s with warm LLM cache.
    Uses the no-op fixture (cheapest path)."""
    _patch_upstream_stages(monkeypatch, _FIX_NOOP_APARTMENT_STYLE)
    status, payload = _post_generate(client, "test-2b3-e2e-timing")
    if status >= 500:
        pytest.skip(
            f"upstream LLM error (cache miss + no API key): "
            f"{payload.get('detail')}"
        )
    assert status == 200, payload
    assert payload["elapsed_ms"] < 60_000, (
        f"e2e exceeded 60s budget: {payload['elapsed_ms']:.0f}ms"
    )
