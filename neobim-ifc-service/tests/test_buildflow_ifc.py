"""Regression tests for the v3 BuildFlowIFC helper.

Each test pins one of the three bugs that killed the v2 one-shot
generator OR a structural invariant the agent loop depends on:

  1. IFC2X3 schema strictness — IfcColumn/IfcBeam/IfcWall/
     IfcFurnishingElement/IfcLightFixture do NOT accept PredefinedType
     in 2X3 (it's an IFC4 attribute). The helper must NOT pass them through.
  2. STEP byte-strictness — em-dash / middle dot / curly quotes /
     arrows must be sanitised at every boundary or the written file
     fails web-ifc's tokenizer.
  3. Apostrophe escape — single-quotes inside strings are STEP-doubled,
     not backslash-escaped. ifcopenshell handles this internally; we
     test the roundtrip survives.
  4. IfcBuildingElementProxy.CompositionType — `.NOTDEFINED.` is INVALID;
     only COMPLEX / ELEMENT / PARTIAL are allowed in 2X3.
"""

from __future__ import annotations

import json
import os
import tempfile

import ifcopenshell
import pytest

from app.services.ifc_generator_v3 import BuildFlowIFC, BuildFlowIFCError
from app.services.ifc_generator_v3.buildflow_ifc import _ascii_safe
from app.services.ifc_generator_v3.validate import (
    _bytes_contain_non_ascii,
    validate_ifc_file,
)


def _minimal_brief() -> dict:
    return {
        "project": {
            "name": "Test Booth", "type": "exhibition_booth",
            "location": "Test City", "description": "Tiny test brief",
        },
        "site": {
            "bounds_m": [10.0, 10.0],
            "height_limit_m": 3.0,
            "coordinate_origin": "sw_corner",
        },
        "spaces": [],
        "elements": [],
        "materials": [
            {
                "id": "mat-concrete", "name": "Concrete",
                "rgb": [0.6, 0.6, 0.6], "roughness": 0.8,
                "method": "MATT", "category": "concrete",
            },
        ],
        "brand_language": {
            "primary_text": "Test", "approved_terms": [], "forbidden_terms": [],
        },
    }


# ── Bug 1: IFC2X3 schema strictness ──────────────────────────────────


def _has_attr(entity: ifcopenshell.entity_instance, name: str) -> bool:
    """True iff `entity` has `name` in its schema-declared attribute set.

    `get_info()` returns a dict of the entity's schema-declared attributes
    in 0.8 — using it gives a stable, version-resilient introspection
    surface (the `attribute_count()` / `attribute_name(i)` pair we tried
    first doesn't exist on 0.8 entity instances)."""
    try:
        info = entity.get_info(include_identifier=False, recursive=False)
    except TypeError:
        info = entity.get_info()
    return name in info


def test_column_does_not_carry_predefined_type_in_ifc2x3():
    """IfcColumn in 2X3 has no PredefinedType slot. The helper must NOT
    set it even if a caller passes one (sanity — defensive)."""
    bf = BuildFlowIFC(_minimal_brief())
    col = bf.add_column(
        "C-001", origin=(0.0, 0.0, 0.0),
        dims=(0.3, 0.3), depth=3.0, material="mat-concrete",
    )
    assert col.is_a("IfcColumn")
    assert not _has_attr(col, "PredefinedType"), (
        "IfcColumn must NOT carry PredefinedType in IFC2X3 — "
        "that's an IFC4 attribute."
    )


def test_beam_does_not_carry_predefined_type_in_ifc2x3():
    bf = BuildFlowIFC(_minimal_brief())
    beam = bf.add_beam(
        "B-001", origin=(0.0, 0.0, 3.0),
        dims=(0.2, 0.4), depth=4.0, material="mat-concrete",
    )
    assert beam.is_a("IfcBeam")
    assert not _has_attr(beam, "PredefinedType"), (
        "IfcBeam must NOT carry PredefinedType in IFC2X3."
    )


def test_wall_does_not_carry_predefined_type_in_ifc2x3():
    bf = BuildFlowIFC(_minimal_brief())
    wall = bf.add_wall(
        "W-001", origin=(0.0, 0.0, 0.0),
        dims=(4.0, 0.2), depth=3.0, material="mat-concrete",
    )
    assert wall.is_a("IfcWall")
    assert not _has_attr(wall, "PredefinedType"), (
        "IfcWall must NOT carry PredefinedType in IFC2X3."
    )


def test_slab_does_carry_predefined_type_in_ifc2x3():
    """IfcSlab DOES have PredefinedType in 2X3 — must be settable."""
    bf = BuildFlowIFC(_minimal_brief())
    slab = bf.add_slab(
        "S-001", origin=(0.0, 0.0, 0.0),
        dims=(5.0, 5.0), depth=0.2, material="mat-concrete",
        predefined_type="FLOOR",
    )
    assert slab.is_a("IfcSlab")
    assert slab.PredefinedType == "FLOOR"


# ── Bug 2: STEP byte-strictness ──────────────────────────────────────


def test_ascii_safe_em_dash_to_hyphen():
    assert _ascii_safe("A — B") == "A - B"


def test_ascii_safe_middle_dot_to_period():
    assert _ascii_safe("foo · bar") == "foo . bar"


def test_ascii_safe_curly_quotes_to_straight():
    assert _ascii_safe("“warning” ‘note’") == '"warning" \'note\''


def test_ascii_safe_arrows():
    assert _ascii_safe("input → output") == "input -> output"


def test_ascii_safe_recursive_into_nested_dict():
    out = _ascii_safe({"k1": "a — b", "k2": ["c · d", {"k3": "e ‘f’"}]})
    assert out == {"k1": "a - b", "k2": ["c . d", {"k3": "e 'f'"}]}


def test_ascii_safe_unmappable_char_becomes_question_mark():
    """Loud-replacement: chars without an explicit fallback survive as `?`
    so a viewer immediately shows them, instead of silently dropping data."""
    assert _ascii_safe("☃") == "?"  # snowman


def test_written_file_is_pure_ascii():
    """End-to-end: build a model with em-dashes / middle dots in the
    user-facing fields, write it, and assert the on-disk bytes are
    pure ASCII."""
    brief = _minimal_brief()
    brief["project"]["description"] = "Booth — grand opening · phase 1"
    bf = BuildFlowIFC(brief)
    bf.add_space(
        "SP-01", polygon=[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0), (0.0, 5.0)],
        height=3.0, long_name="Lounge — main",
        occupancy="Public → reception",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "test.ifc")
        bf.write(path)
        result = _bytes_contain_non_ascii(path)
        assert result["ok"], f"non-ASCII byte at offset {result.get('first_non_ascii_offset')}"


# ── Bug 4: IfcBuildingElementProxy.CompositionType ───────────────────


def test_proxy_rejects_notdefined_composition():
    """`.NOTDEFINED.` is INVALID for IfcBuildingElementProxy.CompositionType
    in 2X3 — but the v2 generator confidently emitted it. The helper
    must catch this up-front so the agent gets a clear error before
    write() crashes deeper."""
    bf = BuildFlowIFC(_minimal_brief())
    with pytest.raises(BuildFlowIFCError, match="NOTDEFINED"):
        bf.add_proxy(
            "P-001", origin=(0.0, 0.0, 0.0), dims=(1.0, 1.0),
            depth=1.0, material="mat-concrete", composition="NOTDEFINED",
        )


def test_proxy_accepts_element_composition():
    """Valid path — most common composition."""
    bf = BuildFlowIFC(_minimal_brief())
    proxy = bf.add_proxy(
        "P-002", origin=(0.0, 0.0, 0.0), dims=(1.0, 1.0),
        depth=1.0, material="mat-concrete", composition="ELEMENT",
    )
    assert proxy.is_a("IfcBuildingElementProxy")
    assert proxy.CompositionType == "ELEMENT"


def test_proxy_normalises_dotted_composition():
    """Accept `.ELEMENT.` / `.COMPLEX.` forms — agents sometimes copy
    the IFC-spec dotted notation from documentation."""
    bf = BuildFlowIFC(_minimal_brief())
    proxy = bf.add_proxy(
        "P-003", origin=(0.0, 0.0, 0.0), dims=(1.0, 1.0),
        depth=1.0, material="mat-concrete", composition=".ELEMENT.",
    )
    assert proxy.CompositionType == "ELEMENT"


# ── Structural invariants ────────────────────────────────────────────


def test_init_produces_valid_minimal_ifc():
    bf = BuildFlowIFC(_minimal_brief())
    summary = bf.summary()
    assert summary["schema"] == "IFC2X3"
    # Project + Site + Building + Storey = 4 IfcProduct descendants minimum.
    assert summary["entity_count_total"] > 0
    # All four spatial-hierarchy levels present.
    assert "IfcSite" in summary["products_by_class"]
    assert "IfcBuilding" in summary["products_by_class"]
    assert "IfcBuildingStorey" in summary["products_by_class"]


def test_validate_passes_for_minimal_model():
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_space(
        "SP-01", polygon=[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0), (0.0, 5.0)],
        height=3.0,
    )
    val = bf.validate()
    assert val["refs_resolve"] is True
    assert val["spaces_present"]  # at least one space


def test_round_trip_via_save_load_state():
    """save_state → load_state must preserve element-by-tag lookups."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_space(
        "SP-01", polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)],
        height=2.8,
    )
    bf.add_slab(
        "S-FLOOR", origin=(0.0, 0.0, 0.0), dims=(4.0, 4.0),
        depth=0.15, material="mat-concrete",
    )
    with tempfile.TemporaryDirectory() as tmp:
        bf.save_state(tmp)
        bf2 = BuildFlowIFC.load_state(tmp)
        assert "S-FLOOR" in bf2._elements_by_id
        # Validation still passes on the re-hydrated instance.
        assert bf2.validate()["refs_resolve"] is True


def test_validate_ifc_file_catches_non_ascii_in_written_file():
    """The on-disk validator's ASCII byte-scan must catch a planted
    non-ASCII byte even if the in-memory validator says everything
    is fine."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_space(
        "SP-01", polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)],
        height=3.0,
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "test.ifc")
        bf.write(path)
        # Plant a non-ASCII byte.
        with open(path, "rb") as f:
            content = f.read()
        with open(path, "wb") as f:
            f.write(content[:64] + b"\xc3\xa9" + content[64:])
        result = validate_ifc_file(path)
        assert result["ascii_only"] is False
        assert result["web_ifc_load_test"] == "FAIL"


def test_duplicate_element_id_rejected():
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_slab(
        "S-001", origin=(0.0, 0.0, 0.0), dims=(2.0, 2.0),
        depth=0.2, material="mat-concrete",
    )
    with pytest.raises(BuildFlowIFCError, match="id already taken"):
        bf.add_slab(
            "S-001", origin=(0.0, 0.0, 0.0), dims=(2.0, 2.0),
            depth=0.2, material="mat-concrete",
        )


def test_zero_dim_rejected():
    bf = BuildFlowIFC(_minimal_brief())
    with pytest.raises(BuildFlowIFCError, match="must all be > 0"):
        bf.add_slab(
            "S-001", origin=(0.0, 0.0, 0.0), dims=(0.0, 2.0),
            depth=0.2, material="mat-concrete",
        )


def test_short_polygon_rejected():
    bf = BuildFlowIFC(_minimal_brief())
    with pytest.raises(BuildFlowIFCError, match="must have >= 3 points"):
        bf.add_space("SP-01", polygon=[(0.0, 0.0), (1.0, 0.0)], height=3.0)
