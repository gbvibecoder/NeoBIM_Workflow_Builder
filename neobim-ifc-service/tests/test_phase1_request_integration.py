"""Phase 1 Slice 6 — request/response integration tests.

Covers:
  * `_comment` whitelist at the request top level (so Phase 0 fixtures
    that author a `_comment` field don't trip extra="forbid").
  * `building_model` field accepted on the request (typed Optional[dict];
    full Phase 2 design-agent integration is pending).
  * `building_model_json` populated on the response when
    `useParametricPipeline=true`.
  * Provenance Pset re-stamping post-Stage-2.5 carries the real
    ids_rules_passed / ids_rules_failed counts (not zeros).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import ifcopenshell
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.request import ExportIFCRequest


_FIXTURE_DIR = Path(__file__).parent / "fixtures"
_client = TestClient(app)


def _load_fixture_dict(name: str) -> dict:
    with open(_FIXTURE_DIR / f"{name}.json") as fp:
        return json.load(fp)


# ─── _comment whitelist ──────────────────────────────────────────────


def test_request_accepts_underscore_comment():
    """Phase 0 fixtures all carry a top-level `_comment` field. The
    Slice 6 model_validator(mode="before") strips it so extra='forbid'
    doesn't 422 the request."""
    d = _load_fixture_dict("simple_box")
    assert "_comment" in d, "Sanity: simple_box fixture should have _comment"
    # ExportIFCRequest must accept the dict as-is, _comment included
    req = ExportIFCRequest.model_validate(d)
    assert req.geometry.building_type  # constructed successfully


def test_request_still_rejects_other_unknown_top_level_keys():
    """The whitelist is exact: only `_comment` is stripped. Any other
    unknown top-level field should still 422."""
    d = _load_fixture_dict("simple_box")
    d["random_unknown_key"] = "should be rejected"
    with pytest.raises(Exception):  # pydantic ValidationError
        ExportIFCRequest.model_validate(d)


# ─── building_model field ────────────────────────────────────────────


def test_request_accepts_optional_building_model_field():
    """The Phase 2 design agent will produce BuildingModel directly;
    Slice 6 declares the field so callers can send it."""
    d = _load_fixture_dict("simple_box")
    d["buildingModel"] = {"some": "future-shape"}  # typed as Optional[dict]
    # Should not raise
    req = ExportIFCRequest.model_validate(d)
    assert req.building_model == {"some": "future-shape"}


# ─── building_model_json + provenance re-stamp through the API ───────


def test_api_populates_building_model_json_when_parametric():
    """End-to-end: POST /api/v1/export-ifc with useParametricPipeline=true
    returns building_model_json in metadata."""
    pytest.importorskip("ifctester")
    d = _load_fixture_dict("simple_box")
    d.setdefault("options", {})["useParametricPipeline"] = True
    response = _client.post("/api/v1/export-ifc", json=d)
    assert response.status_code == 200, response.text
    body = response.json()
    bm_json = body["metadata"].get("building_model_json")
    assert bm_json is not None, "building_model_json missing in parametric response"
    assert "project" in bm_json
    assert bm_json["project"]["metadata"]["provenance"]["source_contract"] in {
        "MassingGeometry-lifted", "BuildingModel"
    }


def test_api_omits_building_model_json_when_legacy():
    """useParametricPipeline=false (default) should leave building_model_json null."""
    pytest.importorskip("ifctester")
    d = _load_fixture_dict("simple_box")
    response = _client.post("/api/v1/export-ifc", json=d)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["metadata"].get("building_model_json") is None


def test_api_provenance_restamped_with_ids_counts():
    """After Stage 2.5, the IFC's Pset_BuildFlow_Provenance must carry
    the real ids_rules_passed / ids_rules_failed (not zeros from the
    initial stamp)."""
    pytest.importorskip("ifctester")
    d = _load_fixture_dict("simple_box")
    d.setdefault("options", {})["useParametricPipeline"] = True
    response = _client.post("/api/v1/export-ifc", json=d)
    assert response.status_code == 200, response.text
    body = response.json()
    # Find the combined IFC's URL and inspect it
    combined_url = next(
        f["download_url"] for f in body["files"] if f["discipline"] == "combined"
    )
    if combined_url.startswith("data:"):
        import base64
        b64 = combined_url.split(",", 1)[1]
        ifc_bytes = base64.b64decode(b64)
    else:
        # If R2 is configured the URL is a HTTP URL; for tests we expect data URI.
        pytest.skip("R2 returned URL — test assumes base64 fallback in CI")
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as tmp:
        tmp.write(ifc_bytes)
        path = tmp.name
    m = ifcopenshell.open(path)
    project = m.by_type("IfcProject")[0]
    pset = next(
        rel.RelatingPropertyDefinition
        for rel in (project.IsDefinedBy or [])
        if rel.is_a("IfcRelDefinesByProperties")
        and rel.RelatingPropertyDefinition.Name == "Pset_BuildFlow_Provenance"
    )
    props = {p.Name: p.NominalValue.wrappedValue for p in pset.HasProperties}
    # Slice 6 — counts must be set (sum > 0 implies Stage 2.5 actually ran
    # AND the re-stamp happened post-validation).
    total = props["IdsRulesPassed"] + props["IdsRulesFailed"]
    assert total > 0, (
        f"Pset still has zero IDS counts after re-stamp "
        f"(passed={props['IdsRulesPassed']}, failed={props['IdsRulesFailed']})"
    )
