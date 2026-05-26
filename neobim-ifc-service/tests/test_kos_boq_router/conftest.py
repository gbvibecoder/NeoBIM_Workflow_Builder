"""TestClient + PR 5 fixture re-exports for kos_boq_router tests.

Mounts a BARE FastAPI app with ONLY the BOQ router + its 4 exception
handlers. This follows the project convention established by
``tests/test_kos_panel_grid_mapper/test_router_kos_panel_mapper.py`` —
isolating the router from auth / CORS / RequestId / ifcopenshell self-test
and other ``app.main`` infrastructure.

PR 5 fixtures (P_INT_8 + 90VR-MR mapper outputs and contexts) live in
``tests/test_kos_boq_generator/conftest.py``. pytest does NOT share fixtures
across sibling test packages, so we re-export them explicitly here.

Source: PR 6 (justified deviation from prompt anti-pattern #97 — bare-app
isolation matches project convention; documented in PR6_REPORT.md).
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.kos_boq_router import register_boq_exception_handlers, router

# Re-export PR 5 fixtures (pytest does not auto-share across sibling test packages)
from tests.test_kos_boq_generator.conftest import (  # noqa: F401
    boq_context_p_int_8,
    expected_boq_id_for_p_int_8,
    expected_mapper_output_hash_for_p_int_8,
    ninety_vr_mr_input,
    ninety_vr_mr_mapper_output,
    p_int_8_boq_canonical_json,
    p_int_8_input,
    p_int_8_mapper_output,
)


@pytest.fixture(scope="session")
def app() -> FastAPI:
    """Bare FastAPI app with ONLY the BOQ router + handlers. No auth/CORS."""
    test_app = FastAPI()
    test_app.include_router(router)
    register_boq_exception_handlers(test_app)
    return test_app


@pytest.fixture(scope="session")
def client(app) -> TestClient:
    """TestClient bound to the bare BOQ app. Session-scoped (single client)."""
    return TestClient(app)


@pytest.fixture
def p_int_8_request_body(p_int_8_input) -> dict[str, Any]:
    """P_INT_8 BOQInput serialized as HTTP request body.

    Goes through ``json.dumps`` + ``json.loads`` so tuples become lists,
    matching what an actual HTTP client would send.
    """
    return {
        "mapper_output": json.loads(
            json.dumps(dataclasses.asdict(p_int_8_input.mapper_output))
        ),
        "context": json.loads(json.dumps(dataclasses.asdict(p_int_8_input.context))),
    }


@pytest.fixture
def ninety_vr_mr_request_body(ninety_vr_mr_input) -> dict[str, Any]:
    """90VR-MR BOQInput serialized as HTTP request body."""
    return {
        "mapper_output": json.loads(
            json.dumps(dataclasses.asdict(ninety_vr_mr_input.mapper_output))
        ),
        "context": json.loads(json.dumps(dataclasses.asdict(ninety_vr_mr_input.context))),
    }
