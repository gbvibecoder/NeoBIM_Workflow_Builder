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
    _polygon_is_rectangular,
    validate_door_window_typing,
    validate_ifc_file,
    validate_polygon_footprint,
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


# ── Bug 5 (visual collapse): unit declaration must be METRE ──────────


def test_length_unit_is_metre_not_millimetre():
    """Regression for the 2026-05-16 visual-collapse bug.

    The bootstrap previously called `unit.assign_unit(file)` with no
    args, which ifcopenshell silently defaults to MILLI.METRE — every
    metre-valued brief coordinate then rendered 1000x smaller in
    viewers. forensics/diagnosis.md has the trail.

    This test re-opens a written IFC and asserts the LENGTHUNIT
    IfcSIUnit has no prefix and is METRE. AREAUNIT / VOLUMEUNIT must
    likewise be base SI (no prefix → SQUARE_METRE, CUBIC_METRE).
    """
    bf = BuildFlowIFC(_minimal_brief())
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "units.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        units_by_type: dict[str, ifcopenshell.entity_instance] = {}
        for ua in f.by_type("IfcUnitAssignment"):
            for u in ua.Units or []:
                if u.is_a("IfcSIUnit"):
                    units_by_type[u.UnitType] = u

        length = units_by_type.get("LENGTHUNIT")
        assert length is not None, "LENGTHUNIT IfcSIUnit missing from file"
        assert length.Prefix is None, (
            f"LENGTHUNIT prefix should be None (METRE) but got {length.Prefix!r}. "
            "If this is MILLI, the unit-declaration regression has returned — "
            "see forensics/diagnosis.md."
        )
        assert length.Name == "METRE"

        area = units_by_type.get("AREAUNIT")
        assert area is not None
        assert area.Prefix is None and area.Name == "SQUARE_METRE"

        vol = units_by_type.get("VOLUMEUNIT")
        assert vol is not None
        assert vol.Prefix is None and vol.Name == "CUBIC_METRE"


def _world_bbox_of(element, settings) -> tuple[float, float, float, float, float, float]:
    """Compute world (xmin,ymin,zmin,xmax,ymax,zmax) of `element` via
    ifcopenshell.geom — mirrors `scripts/forensics/ifc-inspect.py`."""
    import ifcopenshell.geom
    import ifcopenshell.util.shape
    import numpy as np

    shape = ifcopenshell.geom.create_shape(settings, element)
    verts = ifcopenshell.util.shape.get_vertices(shape.geometry)
    arr = np.asarray(verts, dtype=float).reshape(-1, 3)
    return (
        float(arr[:, 0].min()), float(arr[:, 1].min()), float(arr[:, 2].min()),
        float(arr[:, 0].max()), float(arr[:, 1].max()), float(arr[:, 2].max()),
    )


def test_wall_world_bbox_matches_brief_dimensions():
    """A 4m-long, 0.1m-thick, 2.8m-tall wall must render at those
    dimensions in world coordinates. This is the load-bearing test for
    the unit-fix — if MILLIMETRE creeps back in, this fails by 1000x."""
    import ifcopenshell.geom

    bf = BuildFlowIFC(_minimal_brief())
    wall = bf.add_wall(
        "W-001", origin=(1.0, 2.0, 0.05),
        dims=(4.0, 0.1), depth=2.8, material="mat-concrete",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "wall.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        walls = f.by_type("IfcWall")
        assert len(walls) == 1
        xmin, ymin, zmin, xmax, ymax, zmax = _world_bbox_of(walls[0], settings)
        # 4m length on X (within 0.05 tolerance)
        assert 3.95 < (xmax - xmin) < 4.05, f"wall X-extent {xmax-xmin}"
        # 0.1m thickness on Y
        assert 0.05 < (ymax - ymin) < 0.15, f"wall Y-extent {ymax-ymin}"
        # 2.8m height on Z
        assert 2.75 < (zmax - zmin) < 2.85, f"wall Z-extent {zmax-zmin}"
        # World origin shifted by (1, 2, 0.05)
        assert 0.95 < xmin < 1.05, f"wall x_min {xmin}"
        assert 1.95 < ymin < 2.05, f"wall y_min {ymin}"


def test_slab_world_bbox_matches_brief_dimensions():
    """A 5x5x0.2m slab at world origin must read back at those dims."""
    import ifcopenshell.geom

    bf = BuildFlowIFC(_minimal_brief())
    bf.add_slab(
        "S-001", origin=(0.0, 0.0, 0.0),
        dims=(5.0, 5.0), depth=0.2, material="mat-concrete",
        predefined_type="FLOOR",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "slab.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        slabs = f.by_type("IfcSlab")
        xmin, ymin, zmin, xmax, ymax, zmax = _world_bbox_of(slabs[0], settings)
        assert 4.95 < (xmax - xmin) < 5.05
        assert 4.95 < (ymax - ymin) < 5.05
        assert 0.15 < (zmax - zmin) < 0.25


def test_space_world_bbox_matches_polygon():
    """A 4x5m IfcSpace polygon extruded 2.7m must read back at those dims."""
    import ifcopenshell.geom

    bf = BuildFlowIFC(_minimal_brief())
    bf.add_space(
        "SP-01", polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 5.0), (0.0, 5.0)],
        height=2.7, long_name="Bedroom",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "space.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        spaces = f.by_type("IfcSpace")
        xmin, ymin, zmin, xmax, ymax, zmax = _world_bbox_of(spaces[0], settings)
        assert 3.95 < (xmax - xmin) < 4.05, f"space X-extent {xmax-xmin}"
        assert 4.95 < (ymax - ymin) < 5.05, f"space Y-extent {ymax-ymin}"
        assert 2.65 < (zmax - zmin) < 2.75, f"space Z-extent {zmax-zmin}"


def test_full_residential_bedroom_brief_world_bbox():
    """End-to-end: take the residential-bedroom brief (smallest real brief
    in our eval set), run it through the helper, and assert the aggregate
    world bbox matches the brief site bounds within 10% per axis.

    This is the integration test that would have caught the original bug —
    yesterday's prod-eval-outputs/residential-bedroom.ifc rendered at
    0.0059 x 0.0075 x 0.0027 m, ratio ~0.0015. With the fix, the same
    brief must produce ~4 x 5 x 2.8 m."""
    import ifcopenshell.geom
    import numpy as np

    brief = _minimal_brief()
    brief["spaces"] = [{
        "id": "SP-BEDROOM",
        "name": "SP-BEDROOM",
        "long_name": "Master Bedroom",
        "polygon_world_m": [[0.0, 0.0], [4.0, 0.0], [4.0, 5.0], [0.0, 5.0]],
        "height_m": 2.7,
        "occupancy_type": "PrivateLiving",
    }]
    bf = BuildFlowIFC(brief)
    # Manually bootstrap the space (sandbox runner normally does this).
    bf.add_space(
        "SP-BEDROOM",
        polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 5.0), (0.0, 5.0)],
        height=2.7, long_name="Master Bedroom",
    )
    # 4 walls + 1 floor — abbreviated from the real brief.
    bf.add_slab("FLOOR", origin=(0.0, 0.0, 0.0), dims=(4.0, 5.0),
                depth=0.05, material="mat-concrete")
    bf.add_wall("WALL-N", origin=(0.0, 4.9, 0.05), dims=(4.0, 0.1),
                depth=2.65, material="mat-concrete")
    bf.add_wall("WALL-S", origin=(0.0, 0.0, 0.05), dims=(4.0, 0.1),
                depth=2.65, material="mat-concrete")
    bf.add_wall("WALL-E", origin=(3.9, 0.0, 0.05), dims=(0.1, 5.0),
                depth=2.65, material="mat-concrete")
    bf.add_wall("WALL-W", origin=(0.0, 0.0, 0.05), dims=(0.1, 5.0),
                depth=2.65, material="mat-concrete")

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "bedroom.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)

        # Compute aggregate world bbox across walls + slab.
        bboxes = []
        for ifc_class in ("IfcWall", "IfcSlab"):
            for e in f.by_type(ifc_class):
                bboxes.append(_world_bbox_of(e, settings))
        assert bboxes, "no geometric elements in file"
        xmin = min(b[0] for b in bboxes)
        ymin = min(b[1] for b in bboxes)
        zmin = min(b[2] for b in bboxes)
        xmax = max(b[3] for b in bboxes)
        ymax = max(b[4] for b in bboxes)
        zmax = max(b[5] for b in bboxes)
        xext, yext, zext = xmax - xmin, ymax - ymin, zmax - zmin

        # Expected: 4m x 5m floorplate + 2.7m height (-0.05 slab thickness).
        # Tolerance: ±10% on each axis (generous to allow rounding /
        # wall-corner overlap).
        assert 3.6 < xext < 4.4, f"aggregate X {xext} not in [3.6, 4.4]"
        assert 4.5 < yext < 5.5, f"aggregate Y {yext} not in [4.5, 5.5]"
        assert 2.4 < zext < 3.0, f"aggregate Z {zext} not in [2.4, 3.0]"


# ── Gap B: Typed openings (IfcDoor / IfcWindow) ──────────────────────────
#
# Multi-brief forensic audit (2026-05-17, commit d0b4b7ac) showed that
# every door + window in every test brief was emitted as
# IfcFurnishingElement or IfcBuildingElementProxy — never as the typed
# IfcDoor / IfcWindow classes. Downstream BIM tools (Revit, Solibri,
# IDS validators) filter by class, so those models showed zero doors
# and zero windows. These tests pin the typed emission so future
# refactors can't silently regress to proxy fallbacks.


def test_add_door_emits_ifc_door_class():
    """`add_door` must emit IfcDoor — NOT a proxy or furniture."""
    bf = BuildFlowIFC(_minimal_brief())
    door = bf.add_door(
        "D-001", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete", object_type="entrance-door",
        description="Main entry", tag="D-001",
    )
    assert door.is_a("IfcDoor"), f"expected IfcDoor, got {door.is_a()}"
    # Tag preserved for downstream brief-element correlation.
    assert door.Tag == "D-001"
    assert door.Name == "D-001"


def test_add_door_appears_in_summary_under_typed_class():
    """The bf.summary() products_by_class must list IfcDoor, not a proxy."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_door(
        "D-001", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete",
    )
    summary = bf.summary()
    assert summary["products_by_class"].get("IfcDoor", 0) == 1
    # And the door is NOT counted under any proxy / furniture fallback.
    assert summary["products_by_class"].get("IfcBuildingElementProxy", 0) == 0
    assert summary["products_by_class"].get("IfcFurnishingElement", 0) == 0


def test_add_window_emits_ifc_window_class():
    """`add_window` must emit IfcWindow — NOT a proxy or furniture."""
    bf = BuildFlowIFC(_minimal_brief())
    window = bf.add_window(
        "W-001", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete", object_type="fixed-window",
        description="South-wall window", tag="W-001",
    )
    assert window.is_a("IfcWindow"), f"expected IfcWindow, got {window.is_a()}"
    assert window.Tag == "W-001"


def test_add_window_appears_in_summary_under_typed_class():
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_window(
        "W-001", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete",
    )
    summary = bf.summary()
    assert summary["products_by_class"].get("IfcWindow", 0) == 1
    assert summary["products_by_class"].get("IfcBuildingElementProxy", 0) == 0
    assert summary["products_by_class"].get("IfcFurnishingElement", 0) == 0


def test_door_and_window_coexist_with_furniture_without_collision():
    """Adding doors + windows alongside furniture should produce 3
    distinct typed classes (the test sentinel for "no proxy fallback")."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_furniture(
        "F-bed", origin=(1.0, 1.0, 0.0), dims=(2.0, 1.5),
        depth=0.5, material="mat-concrete",
    )
    bf.add_door(
        "D-entry", origin=(0.0, 2.5, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete",
    )
    bf.add_window(
        "W-south", origin=(2.5, 0.0, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete",
    )
    summary = bf.summary()
    pbc = summary["products_by_class"]
    assert pbc.get("IfcFurnishingElement", 0) == 1
    assert pbc.get("IfcDoor", 0) == 1
    assert pbc.get("IfcWindow", 0) == 1
    # Zero proxies (the regression sentinel).
    assert pbc.get("IfcBuildingElementProxy", 0) == 0


def test_door_round_trips_through_write_and_open():
    """End-to-end: write the IFC, reopen via ifcopenshell, IfcDoor still present."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_door(
        "D-001", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete",
    )
    bf.add_window(
        "W-001", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "doors.ifc")
        bf.write(path)
        f = ifcopenshell.open(path)
        assert len(f.by_type("IfcDoor")) == 1
        assert len(f.by_type("IfcWindow")) == 1
        # Re-verify the regression: zero proxies on disk too.
        assert len(f.by_type("IfcBuildingElementProxy")) == 0


# ── Gap-B validator: door/window typing ──────────────────────────────────


def _brief_with_door_window_elements() -> dict:
    """Mock brief with one door + one window element (the canonical
    Gap-B reproduction case)."""
    brief = _minimal_brief()
    brief["elements"] = [
        {
            "id": "D-001", "type": "door",
            "origin_world_m": [2.5, 0.0, 0.0],
            "dims_m": [0.9, 0.1, 2.1],
            "material_id": "mat-concrete",
            "description": "entrance", "object_type": "entrance-door",
            "tag": "D-001",
        },
        {
            "id": "W-001", "type": "window",
            "origin_world_m": [1.0, 2.5, 1.0],
            "dims_m": [1.2, 0.05, 1.5],
            "material_id": "mat-concrete",
            "description": "south window", "object_type": "fixed-window",
            "tag": "W-001",
        },
    ]
    return brief


def test_validator_door_window_typing_passes_when_typed_classes_used():
    """Happy path: agent used bf.add_door + bf.add_window → validator OK."""
    brief = _brief_with_door_window_elements()
    bf = BuildFlowIFC(brief)
    bf.add_door(
        "D-001", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete",
    )
    bf.add_window(
        "W-001", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete",
    )
    result = validate_door_window_typing(bf._ifc, brief)
    assert result["verdict"] == "OK"
    assert result["actual_door_count"] == 1
    assert result["actual_window_count"] == 1


def test_validator_door_window_typing_fails_on_proxy_fallback():
    """Regression sentinel: agent routes doors through add_proxy →
    validator catches it (the v6 failure mode)."""
    brief = _brief_with_door_window_elements()
    bf = BuildFlowIFC(brief)
    # SIMULATE the v6 failure: emit door + window as proxies.
    bf.add_proxy(
        "D-001", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1),
        depth=2.1, material="mat-concrete", composition="ELEMENT",
    )
    bf.add_proxy(
        "W-001", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05),
        depth=1.5, material="mat-concrete", composition="ELEMENT",
    )
    result = validate_door_window_typing(bf._ifc, brief)
    assert result["verdict"] == "FAILED"
    assert result["actual_door_count"] == 0
    assert result["actual_window_count"] == 0
    # Failure messages name both classes.
    failure_blob = " ".join(result["failures"])
    assert "door" in failure_blob.lower()
    assert "window" in failure_blob.lower()


def test_validator_door_window_typing_skips_when_brief_has_no_openings():
    """SOL booth and other openingless briefs must not regress."""
    brief = _minimal_brief()  # no door/window elements
    bf = BuildFlowIFC(brief)
    result = validate_door_window_typing(bf._ifc, brief)
    assert result["verdict"] == "OK"
    assert result.get("skipped") is True


# ── Gap-A validator: polygon footprint ──────────────────────────────────


def test_polygon_is_rectangular_recognises_axis_aligned_rect():
    """Pure helper: rectangle detection."""
    rect = [(0.0, 0.0), (10.0, 0.0), (10.0, 4.0), (0.0, 4.0)]
    assert _polygon_is_rectangular(rect) is True


def test_polygon_is_rectangular_rejects_l_shape():
    l_shape = [(0.0, 0.0), (10.0, 0.0), (10.0, 4.0), (4.0, 4.0), (4.0, 8.0), (0.0, 8.0)]
    assert _polygon_is_rectangular(l_shape) is False


def test_polygon_is_rectangular_rejects_rotated_rect():
    """A 45-degree-rotated rectangle has diagonal edges → not axis-aligned."""
    rotated = [(0.0, 0.0), (2.0, 2.0), (0.0, 4.0), (-2.0, 2.0)]
    assert _polygon_is_rectangular(rotated) is False


def _brief_with_l_shape_polygon() -> dict:
    """Mock brief with an L-shape footprint — the canonical Gap-A
    reproduction case."""
    brief = _minimal_brief()
    brief["site"]["bounds_m"] = [10.0, 8.0]
    brief["spaces"] = [
        {
            "id": "SP-L", "name": "L-shape office",
            "long_name": "L-shape open office", "height_m": 3.2,
            "occupancy_type": "office",
            "polygon_world_m": [
                [0.0, 0.0], [10.0, 0.0], [10.0, 4.0],
                [4.0, 4.0], [4.0, 8.0], [0.0, 8.0],
            ],
        }
    ]
    return brief


def test_validator_polygon_footprint_passes_when_walls_cover_polygon():
    """Happy path: agent built 6 perimeter walls along L-shape edges."""
    brief = _brief_with_l_shape_polygon()
    bf = BuildFlowIFC(brief)
    # Six edges of the L-shape → six walls. We can use add_wall directly
    # since the helper accepts rotation in radians.
    edges = [
        ((0.0, 0.0), (10.0, 0.0)),
        ((10.0, 0.0), (10.0, 4.0)),
        ((10.0, 4.0), (4.0, 4.0)),
        ((4.0, 4.0), (4.0, 8.0)),
        ((4.0, 8.0), (0.0, 8.0)),
        ((0.0, 8.0), (0.0, 0.0)),
    ]
    import math
    for i, (a, b) in enumerate(edges):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.sqrt(dx * dx + dy * dy)
        rot = math.atan2(dy, dx)
        bf.add_wall(
            f"W-perim-{i}", origin=(a[0], a[1], 0.0),
            dims=(length, 0.1), depth=3.2,
            material="mat-concrete", rotation=rot,
        )
    result = validate_polygon_footprint(bf._ifc, brief)
    assert result["verdict"] == "OK"
    assert result["irregular_space_count"] == 1
    assert result["actual_wall_count"] >= 6


def test_validator_polygon_footprint_fails_on_aabb_unfolding():
    """Regression sentinel: agent collapses L-shape to 4-wall AABB → validator catches it."""
    brief = _brief_with_l_shape_polygon()
    bf = BuildFlowIFC(brief)
    # SIMULATE the v6 failure: 4 walls along the AABB, not 6 along the L.
    bf.add_wall("W-N", origin=(0, 8, 0), dims=(10, 0.1), depth=3.2, material="mat-concrete")
    bf.add_wall("W-S", origin=(0, 0, 0), dims=(10, 0.1), depth=3.2, material="mat-concrete")
    bf.add_wall("W-E", origin=(10, 0, 0), dims=(0.1, 8), depth=3.2, material="mat-concrete")
    bf.add_wall("W-W", origin=(0, 0, 0), dims=(0.1, 8), depth=3.2, material="mat-concrete")
    result = validate_polygon_footprint(bf._ifc, brief)
    assert result["verdict"] == "FAILED"
    assert result["irregular_space_count"] == 1
    assert result["polygon_edge_total"] == 6
    assert result["actual_wall_count"] == 4
    assert any("collapsed" in f.lower() or "rectangular" in f.lower() for f in result["failures"])


def test_validator_polygon_footprint_skips_for_rectangular_briefs():
    """Rectangular briefs (most cases) should be skipped — no regression."""
    brief = _minimal_brief()
    brief["spaces"] = [
        {
            "id": "SP-R", "name": "Office", "long_name": "Rect office",
            "height_m": 3.0, "occupancy_type": "office",
            "polygon_world_m": [[0, 0], [5, 0], [5, 5], [0, 5]],
        }
    ]
    bf = BuildFlowIFC(brief)
    result = validate_polygon_footprint(bf._ifc, brief)
    assert result["verdict"] == "OK"
    assert result.get("skipped") is True
