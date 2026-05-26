"""Verify FastAPI app routes are correctly registered.

This test file exists to catch silent router-registration gaps — the kind
of bug HOTFIX-3 addresses. The mapper router file
(``app/routers/kos_panel_mapper.py``) was imported in ``app/main.py`` but
never wired via ``app.include_router(...)``, leaving
``POST /kos/generate-panel-layout`` silently unreachable.

These tests inspect ``app.routes`` DIRECTLY (no HTTP requests). That avoids
``ApiKeyMiddleware`` interactions and tests routing configuration only.

Source: HOTFIX-3 (post-PR-6 BOQ Generator slice).
"""

from __future__ import annotations

from app.main import app


def _registered_paths() -> set[str]:
    """Return the set of all route paths registered in app.main.app."""
    return {route.path for route in app.routes if hasattr(route, "path")}


def _registered_methods_for_path(path: str) -> set[str]:
    """Return HTTP methods registered for a given path."""
    for route in app.routes:
        if hasattr(route, "path") and route.path == path:
            return set(getattr(route, "methods", set()))
    return set()


# ─────────────────────────────────────────────────────────────────────────────
# Mapper router registration (the bug HOTFIX-3 fixes)
# ─────────────────────────────────────────────────────────────────────────────


def test_mapper_router_is_registered_in_main_app() -> None:
    """🚨 HOTFIX-3 CONTRACT: at least one mapper route registered in app.main.app.

    Before HOTFIX-3, mapper router was imported (module-level) but never
    included via app.include_router(). This test guards against regression.
    """
    paths = _registered_paths()
    mapper_paths = [
        p for p in paths
        if "generate-panel-layout" in p or "panel-grid" in p.lower()
        or "mapper" in p.lower()
    ]
    assert mapper_paths, (
        "No mapper routes registered in app.main.app. "
        "HOTFIX-3 registration is missing or broken.\n"
        f"All registered paths: {sorted(paths)}"
    )


def test_mapper_router_endpoints_match_pre_flight_discovery() -> None:
    """Verify mapper endpoint discovered in pre-flight Part 3 is registered.

    Pre-flight identified exactly ONE mapper endpoint:
      POST /kos/generate-panel-layout (router prefix /kos + path /generate-panel-layout)
    """
    paths = _registered_paths()

    # From pre-flight Part 3 (HOTFIX_3_PREFLIGHT.txt) — supplemented by manual
    # grep because the auto-discovery regex didn't match the multi-line
    # @router.post(...) decorator. Verified via `grep -n "@router\." +
    # `sed -n '185,200p' app/routers/kos_panel_mapper.py`.
    EXPECTED_MAPPER_PATHS: set[str] = {"/kos/generate-panel-layout"}

    assert EXPECTED_MAPPER_PATHS, (
        "EXPECTED_MAPPER_PATHS is empty — population from pre-flight failed."
    )

    missing = EXPECTED_MAPPER_PATHS - paths
    assert not missing, (
        f"Mapper paths missing from app.routes:\n"
        f"  Expected: {sorted(EXPECTED_MAPPER_PATHS)}\n"
        f"  Missing:  {sorted(missing)}\n"
        f"  All registered: {sorted(paths)}"
    )


def test_mapper_generate_panel_layout_supports_post() -> None:
    """POST is the registered method for /kos/generate-panel-layout."""
    methods = _registered_methods_for_path("/kos/generate-panel-layout")
    assert "POST" in methods, (
        f"POST not registered for /kos/generate-panel-layout. "
        f"HOTFIX-3 contract broken.\n"
        f"Methods registered: {methods}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# PR 6 baseline preservation (regression checks for HOTFIX-3)
# ─────────────────────────────────────────────────────────────────────────────


def test_boq_router_still_registered() -> None:
    """PR 6 baseline: BOQ router paths must remain registered after HOTFIX-3."""
    paths = _registered_paths()
    assert "/boq/generate" in paths, (
        f"BOQ /boq/generate route lost. HOTFIX-3 broke PR 6 baseline.\n"
        f"All paths: {sorted(paths)}"
    )
    assert "/boq/health" in paths, (
        f"BOQ /boq/health route lost. HOTFIX-3 broke PR 6 baseline.\n"
        f"All paths: {sorted(paths)}"
    )


def test_boq_generate_supports_post() -> None:
    """PR 6 baseline: POST /boq/generate still accepts POST."""
    methods = _registered_methods_for_path("/boq/generate")
    assert "POST" in methods, (
        f"POST not registered for /boq/generate. PR 6 contract broken.\n"
        f"Methods registered: {methods}"
    )


def test_boq_health_supports_get() -> None:
    """PR 6 baseline: GET /boq/health still accepts GET."""
    methods = _registered_methods_for_path("/boq/health")
    assert "GET" in methods, (
        f"GET not registered for /boq/health. PR 6 contract broken.\n"
        f"Methods registered: {methods}"
    )
