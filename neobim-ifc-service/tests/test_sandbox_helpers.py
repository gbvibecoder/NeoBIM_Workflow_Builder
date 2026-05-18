"""Verify the 6 helpers exposed by the sandbox are importable and callable.

If any helper is missing or non-callable, this test FAILS — catching the
deployment bug before the agent tries to call it at runtime.

Requires ifcopenshell: skip on machines where it's not installed.
Run on Railway via: pytest tests/test_sandbox_helpers.py -v
"""

from __future__ import annotations

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell", reason="ifcopenshell not installed")


def test_load_helpers_returns_all_six():
    """Sandbox._load_helpers() must return a dict with 6 callable entries."""
    from app.services.ifc_generator_v3.sandbox import Sandbox

    helpers = Sandbox._load_helpers()

    expected_names = [
        "resolve_material",
        "compose_furniture",
        "apply_naming_convention",
        "add_site_context",
        "validate_brief_spec",
        "run_preflight",
    ]
    for name in expected_names:
        assert name in helpers, f"Helper '{name}' missing from sandbox namespace"
        assert callable(helpers[name]), f"Helper '{name}' is not callable"


def test_resolve_material_returns_string():
    """resolve_material must return a material id string."""
    from app.services.ifc_generator_v3.material_library import resolve_material

    result = resolve_material("teak wood", "office", "IfcDoor")
    assert isinstance(result, str)
    assert len(result) > 0


def test_validate_brief_spec_returns_result():
    """validate_brief_spec on a minimal spec returns a result with .ok."""
    from app.services.ifc_generator_v3.spec_validator import validate_brief_spec

    result = validate_brief_spec({
        "spaces": [{"id": "sp1", "polygon_world_m": [[0, 0], [4, 0], [4, 3], [0, 3]], "height_m": 3.0}],
        "elements": [],
        "materials": [{"id": "m1"}],
        "openings": [],
        "furniture": [],
        "lighting": {},
        "global_parameters": {},
    })
    assert hasattr(result, "ok")
    assert isinstance(result.errors, list)
