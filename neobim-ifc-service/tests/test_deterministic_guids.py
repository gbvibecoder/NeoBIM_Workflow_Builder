"""Phase 2 / Fix 5 — deterministic UUID v5 GUID tests.

Pins the four guarantees the deterministic GUID derivation provides:

  1. Same input → same GUIDs across re-runs.
  2. Different element names → different GUIDs.
  3. Output is exactly 22 characters from the buildingSMART base-64 alphabet.
  4. Generated IFC parses back round-trip and every GlobalId resolves.
"""

from __future__ import annotations

import json
import re
import string
import tempfile
from pathlib import Path

import ifcopenshell
import pytest

from app.models.request import ExportIFCRequest
from app.services.ifc_builder import build_multi_discipline
from app.utils.guid import (
    BUILDINGSMART_NAMESPACE,
    derive_guid,
    set_project_namespace,
    reset_project_namespace,
    reset_new_guid_counter,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"

# buildingSMART base-64 alphabet — 64 chars in `_IFC_B64`.
_IFC_B64_ALPHABET = set(
    string.digits + string.ascii_uppercase + string.ascii_lowercase + "_$"
)

GUID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")


def _build_full_combined(fixture_name: str) -> bytes:
    raw = json.loads((FIXTURE_DIR / f"{fixture_name}.json").read_text())
    raw.pop("_comment", None)
    raw["options"]["richMode"] = "full"
    raw["options"]["disciplines"] = ["combined"]
    req = ExportIFCRequest.model_validate(raw)
    return build_multi_discipline(req)["combined"][0]


def _guid_set(ifc_bytes: bytes) -> set[str]:
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        m = ifcopenshell.open(t.name)
    return {
        getattr(inst, "GlobalId", None)
        for inst in m
        if hasattr(inst, "GlobalId") and getattr(inst, "GlobalId", None)
    }


# ── (1) Same input → same GUIDs ───────────────────────────────────────


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_same_input_produces_identical_guid_set(fixture: str):
    bytes_a = _build_full_combined(fixture)
    bytes_b = _build_full_combined(fixture)
    guids_a = _guid_set(bytes_a)
    guids_b = _guid_set(bytes_b)
    assert guids_a == guids_b, (
        f"{fixture}: GUID sets differ across re-runs — "
        f"symmetric difference has {len(guids_a.symmetric_difference(guids_b))} entries"
    )
    assert len(guids_a) > 0


# ── (2) Different inputs → different GUIDs ────────────────────────────


def test_different_element_names_get_different_guids():
    set_project_namespace("test-project")
    reset_new_guid_counter()
    a = derive_guid("IfcWall", "wall-id-1")
    b = derive_guid("IfcWall", "wall-id-2")
    assert a != b


def test_different_namespaces_get_different_guids():
    reset_new_guid_counter()
    set_project_namespace("project-a")
    a = derive_guid("IfcWall", "wall-id")
    set_project_namespace("project-b")
    b = derive_guid("IfcWall", "wall-id")
    assert a != b
    reset_project_namespace()


def test_same_inputs_idempotent():
    set_project_namespace("idempotent-test")
    a = derive_guid("IfcWall", "wall-id-1")
    b = derive_guid("IfcWall", "wall-id-1")
    assert a == b


# ── (3) Output format ─────────────────────────────────────────────────


def test_derive_guid_returns_22_chars_from_buildingsmart_alphabet():
    set_project_namespace("test-project")
    g = derive_guid("IfcWall", "test-id")
    assert len(g) == 22, f"GUID length {len(g)} != 22: {g!r}"
    assert GUID_RE.match(g) is not None, f"GUID outside buildingSMART alphabet: {g!r}"
    assert all(ch in _IFC_B64_ALPHABET for ch in g)


def test_namespace_constant_matches_spec():
    """The buildingSMART OID UUID is the published namespace seed.
    Changing this would invalidate every previously-generated GUID."""
    assert str(BUILDINGSMART_NAMESPACE) == "6ba7b810-9dad-11d1-80b4-00c04fd430c8"


# ── (4) Round-trip ────────────────────────────────────────────────────


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_every_guid_in_output_matches_buildingsmart_format(fixture: str):
    """Walks the entire emitted file; every GlobalId is 22-char buildingSMART
    base-64. Catches any leftover random or malformed GUID."""
    ifc_bytes = _build_full_combined(fixture)
    guids = _guid_set(ifc_bytes)
    bad = [g for g in guids if not GUID_RE.match(g)]
    assert not bad, f"{fixture}: {len(bad)} malformed GUIDs (e.g. {bad[:3]})"


@pytest.mark.parametrize("fixture", ["simple_box", "multistorey_residential", "non_rectangular"])
def test_unique_guids_no_collisions(fixture: str):
    """Within a single build, every GUID is unique."""
    ifc_bytes = _build_full_combined(fixture)
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False, mode="wb") as t:
        t.write(ifc_bytes)
        t.flush()
        m = ifcopenshell.open(t.name)
    seen: dict[str, str] = {}
    for inst in m:
        gid = getattr(inst, "GlobalId", None)
        if gid is None:
            continue
        if gid in seen:
            pytest.fail(
                f"{fixture}: GUID collision {gid} between {seen[gid]} and {inst.is_a()}"
            )
        seen[gid] = inst.is_a()
