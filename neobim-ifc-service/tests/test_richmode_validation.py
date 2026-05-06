"""Phase 1 — Pydantic validation tests for richMode.

Locks two contracts:

  1. `richMode` is a Literal — garbage values now 422.
  2. `ExportOptions` and `ExportIFCRequest` use `extra="forbid"` — unknown
     fields on the control plane fail loudly instead of being silently
     dropped (the bug Phase 1 was scoped to fix).

Driven via the FastAPI TestClient so the assertions exercise the whole
HTTP envelope (middleware, validation handler, response shape) — not
just the bare Pydantic model.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.request import ExportIFCRequest, ExportOptions


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "simple_box.json"


@pytest.fixture(scope="module")
def fixture_payload() -> dict:
    raw = json.loads(FIXTURE_PATH.read_text())
    raw.pop("_comment", None)
    return raw


@pytest.fixture(scope="module")
def client() -> TestClient:
    # No API key configured in dev (settings.api_key=""), so the auth
    # middleware short-circuits and the request reaches the handler. If
    # someone runs the test with API_KEY set, the auth middleware would
    # 401 — which would be a configuration bug, not a code bug.
    return TestClient(app)


# ── richMode Literal validation ────────────────────────────────────────


def test_export_options_rejects_garbage_richmode():
    """Pydantic Literal ➜ ValidationError on any non-whitelisted string."""
    with pytest.raises(ValidationError) as exc_info:
        ExportOptions.model_validate({"richMode": "garbage"})
    msg = str(exc_info.value)
    assert "rich_mode" in msg or "richMode" in msg
    assert "garbage" in msg


def test_export_options_accepts_each_valid_richmode():
    for mode in ("off", "arch-only", "mep", "structural", "full"):
        opts = ExportOptions.model_validate({"richMode": mode})
        assert opts.rich_mode == mode


def test_export_options_accepts_missing_richmode():
    """Backward compat — payloads without richMode still validate (None)."""
    opts = ExportOptions.model_validate({"projectName": "Test"})
    assert opts.rich_mode is None


def test_post_export_ifc_garbage_richmode_returns_422(client: TestClient, fixture_payload: dict):
    """Acceptance criterion #3: POST with richMode='garbage' must 422."""
    payload = json.loads(json.dumps(fixture_payload))  # deep copy
    payload["options"]["richMode"] = "garbage"
    resp = client.post("/api/v1/export-ifc", json=payload)
    assert resp.status_code == 422, f"expected 422, got {resp.status_code}: {resp.text[:200]}"
    body = resp.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    # The Pydantic loc must point at the offending field — operator-debuggable.
    locs = [tuple(e["loc"]) for e in body["errors"]]
    assert any("rich_mode" in loc or "richMode" in loc for loc in locs), (
        f"expected rich_mode loc in errors, got {locs}"
    )


# ── extra="forbid" on the control plane ──────────────────────────────


def test_export_options_rejects_unknown_field():
    """`extra="forbid"` on ExportOptions → unknown field 422s."""
    with pytest.raises(ValidationError) as exc_info:
        ExportOptions.model_validate({"projectName": "Test", "totallyMadeUp": True})
    msg = str(exc_info.value)
    assert "totallyMadeUp" in msg or "totally_made_up" in msg


def test_export_ifc_request_rejects_unknown_top_level_field(fixture_payload: dict):
    """`extra="forbid"` on ExportIFCRequest → unknown top-level field 422s."""
    payload = json.loads(json.dumps(fixture_payload))
    payload["typoField"] = "this should fail"
    with pytest.raises(ValidationError) as exc_info:
        ExportIFCRequest.model_validate(payload)
    assert "typoField" in str(exc_info.value)


def test_post_with_unknown_options_field_returns_422(client: TestClient, fixture_payload: dict):
    payload = json.loads(json.dumps(fixture_payload))
    payload["options"]["unknownThing"] = "should-fail"
    resp = client.post("/api/v1/export-ifc", json=payload)
    assert resp.status_code == 422, resp.text[:200]


# ── Inner geometry models stay loose ─────────────────────────────────


def test_geometry_inner_models_still_accept_unknown_fields(fixture_payload: dict):
    """Phase 1 deliberately keeps inner geometry models loose so the TS
    massing-generator can emit experimental fields without 422'ing the
    request. Only ExportOptions + ExportIFCRequest are locked down."""
    payload = json.loads(json.dumps(fixture_payload))
    # Sneak an unknown field into the geometry envelope.
    payload["geometry"]["experimentalField"] = "should not 422"
    # And one into a single element's properties.
    payload["geometry"]["storeys"][0]["elements"][0]["properties"]["futureField"] = "ok"
    # This must validate (Pydantic should silently drop the extras).
    req = ExportIFCRequest.model_validate(payload)
    assert req.geometry.floors == 1
