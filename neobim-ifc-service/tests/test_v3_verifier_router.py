"""
Phase ε.5 — verifier router smoke tests.

The forensic audit caught that build_verifier.check_build() had logic
since β.3+4 but was NEVER exposed as an HTTP endpoint, so the TS-side
hard-verifier silently 404'd on every production build → fell through
to the pessimistic heuristic → parts_coverage=0 always. ε.5 mounts
the router at /api/v3/verifier/check-build. These tests prove the
mount works AND the request/response shapes match what the TS client
sends + expects.

We use FastAPI TestClient when fastapi is available (CI environment)
and skip those tests when it isn't (some local dev environments). The
direct function-level tests run everywhere — they exercise the same
router code without the HTTP layer.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


# ─── Function-level tests (run everywhere — no HTTP layer needed) ──


def test_router_module_imports_cleanly():
    """The new module must import without errors — catches syntax /
    import / circular-dep bugs before they hit production."""
    from app.routers import v3_verifier  # noqa: F401
    assert hasattr(v3_verifier, "router")
    assert hasattr(v3_verifier, "check_build_endpoint")


def test_router_registers_check_build_route():
    """The router exposes a POST route at /check-build (which becomes
    /api/v3/verifier/check-build once mounted with the prefix in
    main.py). Catches refactors that accidentally rename / delete the
    route."""
    from app.routers.v3_verifier import router
    routes = [r for r in router.routes]
    check_build_routes = [
        r for r in routes
        if getattr(r, "path", "") == "/check-build"
    ]
    assert len(check_build_routes) == 1, (
        f"expected exactly 1 /check-build route, got {len(check_build_routes)}. "
        f"all routes: {[getattr(r, 'path', '?') for r in routes]}"
    )
    assert "POST" in check_build_routes[0].methods


def test_main_app_mounts_verifier_router_at_correct_prefix():
    """The endpoint must be reachable at /api/v3/verifier/check-build
    (the exact URL the TS client posts to). Catches the case where the
    router exists but isn't mounted, OR is mounted at the wrong
    prefix."""
    from app.main import app
    routes = [getattr(r, "path", "") for r in app.routes]
    expected = "/api/v3/verifier/check-build"
    assert expected in routes, (
        f"the verifier endpoint is NOT mounted at {expected} — the pre-ε.5 "
        f"production 404 will continue. Found routes containing 'verifier': "
        f"{[r for r in routes if 'verifier' in r.lower()]}"
    )


def test_endpoint_calls_check_build_with_request_body():
    """Direct function-level test: invoke the endpoint handler with a
    realistic request and assert `check_build` is called with the
    right args (ifc_url + spec + tolerance dict). This is the contract
    test for the TS-side hard-verifier."""
    from app.routers.v3_verifier import (
        CheckBuildRequest,
        VerifierTolerance,
        check_build_endpoint,
    )
    from app.services.ifc_generator_v3.build_verifier import VerifierReport

    request = CheckBuildRequest(
        ifc_url="https://r2.example/test.ifc",
        spec={"furniture": [{"id": "f1", "parts": [{"id": "p1"}]}]},
        tolerance=VerifierTolerance(dim_m=0.1, parts_min_fraction=0.7),
    )
    http_request_mock = type("Req", (), {"state": type("S", (), {"request_id": "rid-1"})()})

    with patch("app.routers.v3_verifier.check_build") as mock_check:
        mock_check.return_value = VerifierReport(
            verified=True,
            parts_coverage=0.95,
            trim_coverage=0.8,
            mismatches=[],
            summary="ok",
            verified_at="2026-05-21T00:00:00Z",
        )
        response = check_build_endpoint(request, http_request_mock)

    # check_build was called with the right shape.
    mock_check.assert_called_once()
    call_kwargs = mock_check.call_args.kwargs
    assert call_kwargs["ifc_url"] == "https://r2.example/test.ifc"
    assert call_kwargs["spec"]["furniture"][0]["id"] == "f1"
    assert call_kwargs["tolerance"] == {"dim_m": 0.1, "parts_min_fraction": 0.7}

    # Response shape matches verifierReportSchema (the TS side).
    assert response.verified is True
    assert response.parts_coverage == 0.95
    assert response.trim_coverage == 0.8
    assert isinstance(response.mismatches, list)
    assert response.summary == "ok"
    assert response.verified_at == "2026-05-21T00:00:00Z"


def test_tolerance_is_optional_and_passes_none_to_check_build():
    """The TS client always sends tolerance, but ad-hoc curl might
    omit it. Pydantic must accept the missing field; check_build must
    see tolerance=None and apply its internal defaults."""
    from app.routers.v3_verifier import CheckBuildRequest, check_build_endpoint
    from app.services.ifc_generator_v3.build_verifier import VerifierReport

    request = CheckBuildRequest(
        ifc_url="https://r2.example/test.ifc",
        spec={},
        # no tolerance
    )
    http_request_mock = type("Req", (), {"state": type("S", (), {"request_id": "rid-2"})()})

    with patch("app.routers.v3_verifier.check_build") as mock_check:
        mock_check.return_value = VerifierReport(
            verified=True, parts_coverage=1.0, trim_coverage=1.0,
            mismatches=[], summary="ok", verified_at="2026-05-21T00:00:00Z",
        )
        check_build_endpoint(request, http_request_mock)

    assert mock_check.call_args.kwargs.get("tolerance") is None


def test_tolerance_with_partial_keys_strips_none_values():
    """tolerance={"dim_m": 0.05} (no parts_min_fraction) must reach
    check_build as tolerance={"dim_m": 0.05} — not {"dim_m": 0.05,
    "parts_min_fraction": None} which would override check_build's
    default with None and crash on .get()."""
    from app.routers.v3_verifier import (
        CheckBuildRequest,
        VerifierTolerance,
        check_build_endpoint,
    )
    from app.services.ifc_generator_v3.build_verifier import VerifierReport

    request = CheckBuildRequest(
        ifc_url="https://r2.example/test.ifc",
        spec={},
        tolerance=VerifierTolerance(dim_m=0.05),
    )
    http_request_mock = type("Req", (), {"state": type("S", (), {"request_id": "rid-3"})()})

    with patch("app.routers.v3_verifier.check_build") as mock_check:
        mock_check.return_value = VerifierReport(
            verified=True, parts_coverage=1.0, trim_coverage=1.0,
            mismatches=[], summary="ok", verified_at="2026-05-21T00:00:00Z",
        )
        check_build_endpoint(request, http_request_mock)

    tol = mock_check.call_args.kwargs.get("tolerance")
    assert tol == {"dim_m": 0.05}
    assert "parts_min_fraction" not in tol


def test_empty_ifc_url_rejected_by_pydantic():
    """ifc_url has min_length=8 — guards against accidental empty
    strings tying up check_build on a nonexistent URL."""
    from app.routers.v3_verifier import CheckBuildRequest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        CheckBuildRequest(ifc_url="", spec={})


def test_response_shape_matches_ts_verifierReportSchema():
    """TS-side verifierReportSchema requires: verified, parts_coverage,
    trim_coverage, mismatches, summary, verified_at. The TS client THEN
    adds source="railway" before validating. This test pins the 6
    fields coming over the wire."""
    from app.routers.v3_verifier import CheckBuildResponse, check_build_endpoint
    from app.routers.v3_verifier import CheckBuildRequest
    from app.services.ifc_generator_v3.build_verifier import VerifierReport, Mismatch

    request = CheckBuildRequest(
        ifc_url="https://r2.example/test.ifc",
        spec={},
    )
    http_request_mock = type("Req", (), {"state": type("S", (), {"request_id": "rid-4"})()})

    with patch("app.routers.v3_verifier.check_build") as mock_check:
        mock_check.return_value = VerifierReport(
            verified=False,
            parts_coverage=0.4,
            trim_coverage=0.0,
            mismatches=[
                Mismatch(
                    type="missing_parts",
                    item_id="table-1",
                    item_type="cutting_table",
                    expected=3, actual=1,
                    severity="high",
                    description="Cutting table collapsed.",
                ),
            ],
            summary="2 of 5 parts",
            verified_at="2026-05-21T12:00:00Z",
        )
        response: CheckBuildResponse = check_build_endpoint(request, http_request_mock)

    # All 6 required fields present + correct types.
    assert isinstance(response.verified, bool) and response.verified is False
    assert isinstance(response.parts_coverage, float) and response.parts_coverage == 0.4
    assert isinstance(response.trim_coverage, float) and response.trim_coverage == 0.0
    assert isinstance(response.mismatches, list) and len(response.mismatches) == 1
    assert response.mismatches[0]["type"] == "missing_parts"
    assert isinstance(response.summary, str)
    assert isinstance(response.verified_at, str)
