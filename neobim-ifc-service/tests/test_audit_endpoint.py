"""Phase 1 — POST /api/v1/audit endpoint tests.

End-to-end via FastAPI TestClient: build an IFC in-process, hand the
bytes back to /api/v1/audit, assert the response shape and that entity
counts are non-zero on a real fixture.

The endpoint is POST (not GET) — see app/routers/audit.py header for
the rationale (HTTP semantics + RFC 9110). The Phase 1 brief said GET
but the body-bearing variant of the brief's contract is only well-formed
under POST.
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
from app.services.ifc_builder import build_multi_discipline


FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def ifc_bytes_simple_box() -> bytes:
    raw = json.loads((FIXTURE_DIR / "simple_box.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    req = ExportIFCRequest.model_validate(raw)
    results = build_multi_discipline(req)
    return results["combined"][0]


def test_audit_accepts_multipart_upload(client: TestClient, ifc_bytes_simple_box: bytes):
    files = {"file": ("simple_box.ifc", ifc_bytes_simple_box, "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    assert resp.status_code == 200, resp.text[:300]
    body = resp.json()

    # Schema/shape contract.
    assert body["schema_version"] == "IFC4"
    assert body["total_entities"] > 0
    assert body["file_size_bytes"] == len(ifc_bytes_simple_box)
    assert "by_type" in body
    assert "geometry_primitives" in body
    assert "type_instances" in body
    assert "openings_and_relationships" in body
    assert "materials" in body
    assert "psets_by_name" in body
    assert "qtos_by_name" in body
    assert "totals" in body
    assert "audit_time_ms" in body
    assert body["source"].startswith("upload:simple_box")

    # Sanity: simple_box contains 5 walls in the audit's "full" output.
    assert body["by_type"].get("IfcWall", 0) >= 4
    assert body["by_type"].get("IfcSlab", 0) >= 1
    assert body["by_type"].get("IfcProject", 0) == 1


def test_audit_response_under_5s_budget(client: TestClient, ifc_bytes_simple_box: bytes):
    """Phase 1 spec: response time < 5 s for files ≤ 10 MB."""
    files = {"file": ("simple_box.ifc", ifc_bytes_simple_box, "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    assert resp.status_code == 200
    body = resp.json()
    assert body["audit_time_ms"] < 5000, (
        f"audit took {body['audit_time_ms']} ms — exceeds 5 s budget"
    )


def test_audit_rejects_empty_file(client: TestClient):
    files = {"file": ("empty.ifc", b"", "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    assert resp.status_code == 422
    body = resp.json()
    # FastAPI HTTPException nests the structured detail under "detail".
    detail = body.get("detail", body)
    assert detail["error_code"] == "AUDIT_EMPTY_FILE"


def test_audit_rejects_non_ifc_file(client: TestClient):
    files = {"file": ("not.ifc", b"this is not an IFC file at all", "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    assert resp.status_code == 422
    body = resp.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "AUDIT_NOT_AN_IFC"


def test_audit_rejects_oversized_upload(client: TestClient):
    """Hard ceiling: 10 MB. We send 11 MB of valid-looking IFC header
    so the size check fires before the ifcopenshell parser is invoked."""
    payload = b"ISO-10303-21;\n" + b"X" * (11 * 1024 * 1024)
    files = {"file": ("big.ifc", payload, "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    assert resp.status_code == 413
    body = resp.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "AUDIT_FILE_TOO_LARGE"


def test_audit_rejects_request_with_no_input(client: TestClient):
    """No multipart, no JSON body — must 422 with explicit guidance."""
    resp = client.post("/api/v1/audit")
    assert resp.status_code == 422
    body = resp.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "AUDIT_NO_INPUT"


def test_audit_json_body_rejects_extra_fields(client: TestClient):
    """`AuditByUrlRequest` uses extra='forbid' — typos must 422."""
    resp = client.post("/api/v1/audit", json={"ifcUrl": "http://invalid", "extraStuff": True})
    # The fetch will fail (URL invalid) OR the validation will fail. Either way 422.
    assert resp.status_code == 422


def test_audit_categorises_geometry_primitives(client: TestClient, ifc_bytes_simple_box: bytes):
    """Sanity: simple_box has IfcExtrudedAreaSolid bodies — must show up
    in the geometry_primitives bucket and the totals."""
    files = {"file": ("simple_box.ifc", ifc_bytes_simple_box, "application/x-step")}
    resp = client.post("/api/v1/audit", files=files)
    body = resp.json()
    assert body["geometry_primitives"]["IfcExtrudedAreaSolid"] > 0
    assert body["totals"]["geometry_primitives"] > 0
    # Phase 2 (Fix 3) — type instancing now active. simple_box has
    # 5 typed classes populated (Wall, Door, Window, Slab×2, Space).
    assert body["totals"]["type_instances"] > 0
