"""Slice 2B.2.C — byte-identity regression for the script→service move.

Pins the discipline introduced in slice 2B.2 Phase C: the
``build_ifc_from_building_model`` implementation is canonical at
``app.services.ifc_from_building_model``; the legacy script path
(``scripts.export_2bhk_pune_to_ifc``) re-exports it. Both call sites
must produce byte-identical IFC content (timestamp stripped) on a
representative BuildingModel — drift here means the move accidentally
inserted divergent behaviour somewhere.

What "byte-identical" means here
--------------------------------
The IFC4 ``HEADER`` block embeds an ISO timestamp in
``FILE_NAME(...)`` that drifts second-by-second between calls; this
is a property of the IfcOpenShell writer, not of our function. We
strip the entire ``FILE_NAME(...);`` line before hashing, so the
test compares the IFC ``DATA`` section + the rest of the header
(``FILE_DESCRIPTION``, ``FILE_SCHEMA``).

Pre-existing first-call non-determinism
---------------------------------------
A separate property: the very first call to
``build_ifc_from_building_model`` within a Python process produces
different output than subsequent calls (some module-level cache —
likely material library or type registry — warms up on first call).
This is unrelated to the script→service move and predates it. The
test below runs a warm-up call before measuring, so it asserts the
"steady-state" byte-identity contract that's actually meaningful.

If a future slice fixes the warm-up non-determinism, this test
should still pass — it's robust to either behaviour.
"""

from __future__ import annotations

import hashlib
import re
import tempfile
from pathlib import Path

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")

from app.services.ifc_from_building_model import (  # noqa: E402
    build_ifc_from_building_model as service_fn,
)
from app.templates import build_3bhk_pune_tower  # noqa: E402
from scripts.export_2bhk_pune_to_ifc import (  # noqa: E402
    build_ifc_from_building_model as legacy_fn,
)


# IFC4 FILE_NAME entry payload runs from ``FILE_NAME(`` to the trailing
# ``;`` on the same line. The bracket matching version
# ``FILE_NAME\([^)]*\);`` does NOT work because the payload contains
# nested ``(...)`` — see slice 2B.2.C diagnostic notes.
_FILE_NAME_RE = re.compile(rb"FILE_NAME\([^;]*\);")


def _content_hash(ifc) -> str:
    """Write the IFC to a temp file, read bytes, strip the FILE_NAME
    timestamp line, return SHA-256 of the result."""
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as f:
        ifc.write(f.name)
        path = f.name
    try:
        with open(path, "rb") as fp:
            data = fp.read()
    finally:
        Path(path).unlink(missing_ok=True)
    stripped = _FILE_NAME_RE.sub(b"FILE_NAME(STRIPPED);", data)
    return hashlib.sha256(stripped).hexdigest()


def test_legacy_script_reexports_service_function() -> None:
    """The script-path import and the service-path import must
    resolve to the SAME function object — otherwise we have two
    copies of the implementation and they will drift."""
    assert legacy_fn is service_fn


def test_service_and_legacy_produce_identical_content() -> None:
    """Steady-state byte-identity: after a single warm-up call to
    flush module caches, subsequent calls through the service path
    and the legacy script path produce SHA-256-equal IFC content
    on the 3BHK G+5 tower (the largest fixture — 89 walls / 59
    rooms / 5 stairs, the densest exercise of every emitter)."""
    bm = build_3bhk_pune_tower(habitable_floor_count=5)

    # Warm up — first call in a process exercises lazy module
    # initialisation paths in the IFC builders. Discard.
    _ = service_fn(bm)

    h_service = _content_hash(service_fn(bm))
    h_legacy = _content_hash(legacy_fn(bm))
    assert h_service == h_legacy, (
        f"byte-identity broken between service path and legacy "
        f"script path: service={h_service}, legacy={h_legacy}. "
        f"The two import sites must resolve to the same code."
    )


def test_steady_state_calls_are_idempotent_byte_identical() -> None:
    """A self-check: after warm-up, repeated calls of the service
    function on the same input produce the same hash. If this ever
    fails, the function has acquired a non-deterministic side
    effect (random GUID, timestamp, RNG seed) that needs hunting
    down at the service level."""
    bm = build_3bhk_pune_tower(habitable_floor_count=5)
    _ = service_fn(bm)  # warm up
    h1 = _content_hash(service_fn(bm))
    h2 = _content_hash(service_fn(bm))
    h3 = _content_hash(service_fn(bm))
    assert h1 == h2 == h3, (
        f"steady-state determinism broken: {h1} / {h2} / {h3}"
    )
