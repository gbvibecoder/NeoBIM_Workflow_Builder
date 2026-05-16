"""Tests for the v3 generator sandbox + session store.

The sandbox runs agent-authored Python in a restricted namespace. These
tests pin:
  • Whitelisted imports work (ifcopenshell, numpy, math, json).
  • Blocked imports raise (os, subprocess, socket, urllib).
  • `bf` is pre-bound and reachable.
  • print() output is captured + cap-enforced.
  • Tracebacks come back as structured strings, not raised exceptions.
  • Session store rejects path-traversal session ids.
  • save_state → load_state survives a round-trip.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from app.services.ifc_generator_v3 import (
    BuildFlowIFC,
    Sandbox,
    SessionStore,
)


def _minimal_brief() -> dict:
    return {
        "project": {"name": "T", "type": "exhibition_booth",
                    "location": "X", "description": ""},
        "site": {"bounds_m": [4.0, 4.0], "height_limit_m": 3.0,
                 "coordinate_origin": "sw_corner"},
        "spaces": [], "elements": [],
        "materials": [{
            "id": "mat-concrete", "name": "Concrete",
            "rgb": [0.6, 0.6, 0.6], "roughness": 0.8,
            "method": "MATT", "category": "concrete",
        }],
        "brand_language": {"primary_text": "T",
                           "approved_terms": [], "forbidden_terms": []},
    }


def _bf() -> BuildFlowIFC:
    return BuildFlowIFC(_minimal_brief())


# ── Sandbox basics ────────────────────────────────────────────────────


def test_sandbox_runs_simple_print():
    sb = Sandbox(_bf())
    r = sb.execute("print('hello sandbox')")
    assert r.ok
    assert "hello sandbox" in r.stdout
    assert r.error_type is None


def test_sandbox_exposes_bf_global():
    sb = Sandbox(_bf())
    r = sb.execute(
        "print(type(bf).__name__)\n"
        "bf.add_space('SP-01', [(0,0),(3,0),(3,3),(0,3)], 3.0)\n"
        "print(len(bf._spaces_by_id))"
    )
    assert r.ok, r.error_traceback
    assert "BuildFlowIFC" in r.stdout
    assert r.stdout.strip().endswith("1")


def test_sandbox_blocks_os_import():
    sb = Sandbox(_bf())
    r = sb.execute("import os\nprint(os.getcwd())")
    assert not r.ok
    assert r.error_type == "ImportError"
    assert "blocked by v3 sandbox" in (r.error_message or "")


def test_sandbox_blocks_subprocess_import():
    sb = Sandbox(_bf())
    r = sb.execute("import subprocess\nsubprocess.run(['echo', 'x'])")
    assert not r.ok
    assert r.error_type == "ImportError"


def test_sandbox_blocks_socket_import():
    sb = Sandbox(_bf())
    r = sb.execute("import socket")
    assert not r.ok
    assert r.error_type == "ImportError"


def test_sandbox_blocks_urllib_import():
    sb = Sandbox(_bf())
    r = sb.execute("import urllib.request")
    assert not r.ok
    assert r.error_type == "ImportError"


def test_sandbox_blocks_open_builtin():
    sb = Sandbox(_bf())
    r = sb.execute("f = open('/etc/passwd')")
    assert not r.ok
    # `open` is not in restricted_builtins → NameError when referenced.
    assert r.error_type == "NameError"


def test_sandbox_blocks_exec_builtin():
    sb = Sandbox(_bf())
    r = sb.execute("exec('print(1)')")
    assert not r.ok
    assert r.error_type == "NameError"


def test_sandbox_allows_math_import():
    sb = Sandbox(_bf())
    r = sb.execute("import math\nprint(math.sqrt(16))")
    assert r.ok, r.error_traceback
    assert "4.0" in r.stdout


def test_sandbox_allows_ifcopenshell_import():
    sb = Sandbox(_bf())
    r = sb.execute("import ifcopenshell\nprint(ifcopenshell.version[:3])")
    assert r.ok, r.error_traceback


def test_sandbox_captures_traceback_without_raising():
    sb = Sandbox(_bf())
    r = sb.execute("1 / 0")
    assert not r.ok
    assert r.error_type == "ZeroDivisionError"
    assert "ZeroDivisionError" in (r.error_traceback or "")


def test_sandbox_print_output_is_capped():
    """Spam a print loop > capture cap; output must be truncated, not
    OOM the FastAPI process."""
    sb = Sandbox(_bf())
    r = sb.execute("for i in range(50000): print('xxxxxxxxxx')")
    assert r.ok
    assert len(r.stdout) <= 20_000  # 16 KB cap + truncation marker
    assert "truncated" in r.stdout


# ── Session store basics ──────────────────────────────────────────────


def test_session_store_rejects_path_traversal():
    store = SessionStore()
    with pytest.raises(ValueError):
        store.get("../etc")
    with pytest.raises(ValueError):
        store.get("/etc/passwd")
    with pytest.raises(ValueError):
        store.get("a" * 256)


def test_session_store_new_session_returns_valid_handle():
    store = SessionStore()
    h = store.new_session()
    assert os.path.isdir(h.path)
    assert h.session_id
    assert not h.has_state  # fresh — nothing on disk yet
    store.discard(h)


def test_state_save_load_roundtrip_via_store():
    store = SessionStore()
    h = store.new_session()
    try:
        bf = BuildFlowIFC(_minimal_brief())
        bf.add_space(
            "SP-01", polygon=[(0, 0), (3, 0), (3, 3), (0, 3)], height=3.0,
        )
        bf.save_state(h.path)
        assert h.has_state

        # Resolve the same session from a new store instance — simulates
        # the cross-request flow.
        store2 = SessionStore()
        h2 = store2.get(h.session_id)
        assert h2.has_state
        bf2 = BuildFlowIFC.load_state(h2.path)
        # The space tag must survive the round-trip.
        assert "SP-01" in bf2._spaces_by_id
    finally:
        store.discard(h)


def test_session_store_purge_stale_is_safe_on_empty_root():
    """No sessions → no purges → no crashes (defensive — called from a
    cron endpoint that might fire before any session exists)."""
    store = SessionStore(root=tempfile.mkdtemp())
    assert store.purge_stale() == []


# ── bootstrap_session + summary edge case (Phase v3 completion §D6) ──


def _brief_with_two_spaces() -> dict:
    """Same shape as `_minimal_brief()` but with two spaces materialised
    so the bootstrap-summary roundtrip has data to assert against."""
    return {
        "project": {"name": "T", "type": "exhibition_booth",
                    "location": "X", "description": ""},
        "site": {"bounds_m": [10.0, 10.0], "height_limit_m": 3.0,
                 "coordinate_origin": "sw_corner"},
        "spaces": [
            {
                "id": "SP-A",
                "name": "SP-A",
                "long_name": "Lounge A",
                "polygon_world_m": [[0, 0], [5, 0], [5, 5], [0, 5]],
                "height_m": 2.8,
                "occupancy_type": "Lounge",
            },
            {
                "id": "SP-B",
                "name": "SP-B",
                "long_name": "Disc B",
                # Test the circular-space path too.
                "polygon_world_m": None,
                "circular_centre_radius": [7.5, 7.5, 1.5],
                "height_m": 2.8,
                "occupancy_type": "Coffee Hub",
            },
        ],
        "elements": [],
        "materials": [{
            "id": "mat-concrete", "name": "Concrete",
            "rgb": [0.6, 0.6, 0.6], "roughness": 0.8,
            "method": "MATT", "category": "concrete",
        }],
        "brand_language": {"primary_text": "T",
                           "approved_terms": [], "forbidden_terms": []},
    }


def test_summary_works_before_first_exec():
    """The session's `state.ifc` MUST exist immediately after
    `bootstrap_session` returns, so the agent's first tool call —
    typically `read_ifc_summary` — has data to read. Closes the
    `read_ifc_summary on turn 1 returns null` edge case (prior phase
    report §XII.7)."""
    from app.services.ifc_generator_v3 import summarize_ifc_file

    store = SessionStore()
    brief = _brief_with_two_spaces()
    handle, _bf = store.bootstrap_session(brief)
    try:
        # State file MUST exist after bootstrap, before any /exec.
        assert handle.has_state, (
            "bootstrap_session must write state.ifc immediately so /summary "
            "works before any /exec call"
        )

        # Summary reads back the on-disk file (NOT the in-memory bf) —
        # this is what the /summary endpoint does.
        summary = summarize_ifc_file(handle.state_ifc_path)
        assert summary["schema"] == "IFC2X3"
        # Every brief-declared space materialised in the bootstrap.
        space_names = {s["name"] for s in summary["spaces"]}
        for sp in brief["spaces"]:
            assert sp["id"] in space_names, (
                f"brief space {sp['id']} missing from bootstrapped IFC — "
                f"got: {sorted(space_names)}"
            )
        # The bootstrapped IFC is a real IFC2X3 with the four-level
        # spatial hierarchy — not just a placeholder.
        assert "IfcSite" in summary["products_by_class"]
        assert "IfcBuilding" in summary["products_by_class"]
        assert "IfcBuildingStorey" in summary["products_by_class"]
    finally:
        store.discard(handle)


def test_summarize_session_helper_returns_same_shape():
    """The convenience `SessionStore.summarize_session(sid)` wrapper
    must agree with the direct `summarize_ifc_file(path)` call — it's
    the only API the v3 router uses to back `/summary`."""
    from app.services.ifc_generator_v3 import summarize_ifc_file

    store = SessionStore()
    handle, _bf = store.bootstrap_session(_brief_with_two_spaces())
    try:
        via_helper = store.summarize_session(handle.session_id)
        via_direct = summarize_ifc_file(handle.state_ifc_path)
        assert via_helper["schema"] == via_direct["schema"]
        assert via_helper["entity_count_total"] == via_direct["entity_count_total"]
        assert sorted(s["name"] for s in via_helper["spaces"]) == sorted(
            s["name"] for s in via_direct["spaces"]
        )
    finally:
        store.discard(handle)
