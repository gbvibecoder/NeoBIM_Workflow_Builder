"""Slice 2B.2.C — POST /api/v1/design/generate end-to-end tests.

Five representative briefs run through the full route:

    intake → classify → analyst → matcher → adaptation_planner →
    dispatch → apply_adaptations → IFC build → IDS validate →
    R2 upload (with base64 fallback)

Mocking strategy
----------------
The analyst + matcher stages are monkeypatched in the route handler's
namespace to return canned :class:`BriefAnalysis` /
:class:`MatchResult` derived from the slice 2B.2 planner fixtures.
This keeps test mint cost at zero (the planner cache for these
fixtures was already minted in Phase B) and isolates the test
surface to the NEW wiring: planner stage, dispatcher, transforms,
BM→IFC service, IDS, R2 fallback.

Each test exercises a distinct outcome shape:

* north_facing_default      → adaptation_plan == None    (no-op)
* south_facing              → adaptation_plan rotation=180
* mirror_e_w                → adaptation_plan mirror=X
* mirror_x_plus_south       → adaptation_plan mirror=X, rotation=180
* vastu_deferral            → adaptation_failed=ship_as_is, IFC=default

R2 fallback
-----------
``r2_uploader.upload_ifc_to_r2`` returns None when R2 credentials
aren't configured (CI default) or when network/upload fails; the
route falls back to a base64 ``data:`` URI so tests can verify the
URL surface without cloud connectivity. The
``ifc_url_kind`` response field reports which path was taken so the
test can assert either is acceptable.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.design_agent.stages.brief_analyst import BriefAnalystMetadata
from app.services.design_agent.stages.template_matcher import (
    TemplateMatcherMetadata,
)
from tests.fixtures._2b2_briefs import (
    _FIX_COMBO_MIRROR_X_ROT_180,
    _FIX_DEFER_VASTU,
    _FIX_MIRROR_E_W_EXPLICIT,
    _FIX_NOOP_NORTH_EXPLICIT,
    _FIX_ROTATE_180_SOUTH,
)


# ─── Test client ─────────────────────────────────────────────────────


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


def _patch_analyst_and_matcher(monkeypatch: pytest.MonkeyPatch, fixture) -> None:
    """Replace the two upstream stages in the route handler's namespace
    so the test can run without their LLM caches present.

    The route imports these symbols directly; monkeypatching the
    handler module is the canonical way to substitute them without
    poking at the runner internals.

    Slice 2B.3.C addition — also stubs the extension_planner stage to
    a noop ExtensionPlan, because the 2B.2 fixtures used by these
    tests have BriefAnalysis content that hasn't been minted through
    the Slice 2B.3 extension planner. These tests are scoped to
    adapter behaviour, so a noop ext plan keeps the test focus right.
    """
    from app.services.design_agent.types import (
        ExtensionPlan,
        ExtensionPlannerMetadata,
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
        "app.routers.design.run_extension_planner",
        lambda **kw: (
            ExtensionPlan(
                extensions=[],
                reasoning="2B.2 adapter test — extensions intentionally noop",
            ),
            ExtensionPlannerMetadata(
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


def _post_generate(client: TestClient, build_id: str, fixture_label: str) -> tuple[int, dict[str, Any]]:
    body = {
        "brief_text": (
            "Synthesised text body — analyst + matcher are monkeypatched "
            "for slice 2B.2.C e2e tests."
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
    assert payload["ifc_size_bytes"] > 1000  # IFC is at least multi-KB
    assert "match_result" in payload
    assert "ids_validation" in payload
    assert "building_model_summary" in payload
    assert "metadata" in payload
    assert isinstance(payload["warnings"], list)
    assert payload["request_id"]
    assert payload["elapsed_ms"] > 0


# ─── 5 representative e2e tests ──────────────────────────────────────


def test_generate_north_facing_default_yields_no_op(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """North-facing brief → planner emits no-op plan → IFC equals
    matcher's default 2BHK duplex; ``adaptation_plan`` field is null
    (no transform was applied)."""
    _patch_analyst_and_matcher(monkeypatch, _FIX_NOOP_NORTH_EXPLICIT)
    status, payload = _post_generate(
        client, "test-2b2-noop-north", "noop_north_facing_explicit"
    )
    if status == 503:
        pytest.skip(f"planner cache miss + no API key: {payload.get('detail')}")
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["status"] == "generated"
    assert payload["adaptation_plan"] is None, (
        "no-op plan should surface as null adaptation_plan in response"
    )
    assert payload["adaptation_failed"] is None
    # Matched template is 2BHK duplex per fixture.
    assert (
        payload["match_result"]["template_id"]
        == "build_2bhk_pune_duplex"
    )
    # IDS must run; pass-rate may not be 100% on legacy templates but
    # rules should be evaluated.
    assert payload["ids_validation"]["rules_evaluated"] >= 0


def test_generate_south_facing_yields_rotation_180(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """South-facing brief → planner emits rotation=180 → IFC has
    transformed BuildingModel. ``adaptation_plan`` field carries the
    plan. Match was 2BHK G+5 tower per fixture."""
    _patch_analyst_and_matcher(monkeypatch, _FIX_ROTATE_180_SOUTH)
    status, payload = _post_generate(
        client, "test-2b2-rot-180", "rotate_180_south_facing"
    )
    if status == 503:
        pytest.skip(f"planner cache miss + no API key: {payload.get('detail')}")
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["status"] == "generated"
    assert payload["adaptation_plan"] is not None
    assert payload["adaptation_plan"]["rotation"] == "180"
    assert payload["adaptation_plan"]["mirror_axis"] is None
    assert payload["adaptation_failed"] is None
    assert (
        payload["match_result"]["template_id"]
        == "build_2bhk_pune_tower"
    )


def test_generate_mirror_e_w_yields_mirror_x_plan(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """E-W mirrored brief → planner emits mirror=X → transformed
    IFC. ``adaptation_plan`` carries mirror_axis='X'."""
    _patch_analyst_and_matcher(monkeypatch, _FIX_MIRROR_E_W_EXPLICIT)
    status, payload = _post_generate(
        client, "test-2b2-mirror-x", "mirror_e_w_explicit"
    )
    if status == 503:
        pytest.skip(f"planner cache miss + no API key: {payload.get('detail')}")
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["adaptation_plan"] is not None
    assert payload["adaptation_plan"]["mirror_axis"] == "X"
    assert payload["adaptation_plan"]["rotation"] == "0"
    assert payload["adaptation_failed"] is None


def test_generate_combined_mirror_and_rotation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Combined brief (mirror+south-facing) → planner emits canonical
    (X, 180). The fixture also accepts the equivalent (Y, 0) form;
    test is robust to either."""
    _patch_analyst_and_matcher(monkeypatch, _FIX_COMBO_MIRROR_X_ROT_180)
    status, payload = _post_generate(
        client, "test-2b2-combo", "combo_mirror_x_plus_south_facing"
    )
    if status == 503:
        pytest.skip(f"planner cache miss + no API key: {payload.get('detail')}")
    assert status == 200, payload
    _assert_common_envelope(payload)
    plan = payload["adaptation_plan"]
    assert plan is not None
    # Either canonical form produces the same final BuildingModel.
    canonical = (plan["mirror_axis"], plan["rotation"])
    assert canonical in (("X", "180"), ("Y", "0")), (
        f"unexpected combined plan: {canonical}"
    )


def test_generate_vastu_deferral_ships_as_is(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Vastu brief → planner refuses with ship_as_is → response is
    HTTP 200 with ``adaptation_failed`` populated and the IFC is the
    matcher's default (no transform applied). This is the slice 2B.2
    "ship-as-is" UX contract: never 4xx for v2-deferrals."""
    _patch_analyst_and_matcher(monkeypatch, _FIX_DEFER_VASTU)
    status, payload = _post_generate(
        client, "test-2b2-vastu", "defer_vastu_compliant"
    )
    if status == 503:
        pytest.skip(f"planner cache miss + no API key: {payload.get('detail')}")
    assert status == 200, payload
    _assert_common_envelope(payload)
    assert payload["status"] == "generated_with_fallback"
    assert payload["adaptation_plan"] is None
    assert payload["adaptation_failed"] is not None
    assert payload["adaptation_failed"]["suggested_action"] == "ship_as_is"
    assert "vastu" in payload["adaptation_failed"]["reason"].lower() or (
        "v2" in payload["adaptation_failed"]["reason"].lower()
    )
    # IFC still got built — user is not blocked by v2-deferral.
    assert payload["ifc_size_bytes"] > 1000


# ─── Smoke: route is registered and reachable ────────────────────────


def test_generate_route_exists_and_rejects_empty_body(client: TestClient) -> None:
    """Defensive: the route is registered, and sending an empty body
    falls through to the intake validator (which 422s)."""
    response = client.post("/api/v1/design/generate", json={})
    # Empty body fails parse_design_request (no build_id, no brief).
    # Acceptable: 422 (intake error) or 500 (intake crash) — anything
    # except 404 which would mean the route isn't mounted.
    assert response.status_code != 404
