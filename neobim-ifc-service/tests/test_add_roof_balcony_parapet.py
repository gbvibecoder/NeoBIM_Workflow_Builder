"""
Phase ε.1 — add_roof / add_balcony / add_parapet geometry tests.

The pre-ε.1 state: these three building elements all fell through to
`add_proxy(object_type=...)` because no typed builders existed. δ.0
telemetry was explicitly recording the proxy_fallback events with
`requested_type` set to "roof"/"balcony"/"parapet" so we'd know which
to build next. ε.1 closes the gap.

The placement discipline mirrors δ.4's add_stair (the γ.10 trap
applies equally to each — a roof, balcony, or parapet placed in the
wrong frame would float free of the building). Each test asserts the
element is BUILT (not proxy), correctly placed, materialed, and
persists across save/load.
"""

from __future__ import annotations

import math
import tempfile

import pytest

from app.services.ifc_generator_v3 import BuildFlowIFC


def _brief() -> dict:
    return {
        "project": {
            "name": "ε.1 test", "type": "residential",
            "location": "Test", "description": "roof/balcony/parapet",
        },
        "site": {
            "bounds_m": [10.0, 10.0],
            "height_limit_m": 12.0,
            "coordinate_origin": "sw_corner",
        },
        "spaces": [],
        "elements": [],
        "materials": [
            {
                "id": "mat-concrete", "name": "Concrete",
                "rgb": [0.7, 0.7, 0.7], "roughness": 0.8,
                "method": "MATT", "category": "concrete",
            },
        ],
        "brand_language": {
            "primary_text": "", "approved_terms": [], "forbidden_terms": [],
        },
    }


# ─── add_balcony ────────────────────────────────────────────────────


def test_balcony_emits_ifcslab_userdefined_with_objecttype_balcony():
    """A balcony is an IfcSlab with PredefinedType=USERDEFINED and
    ObjectType='Balcony' (the standard IFC convention — there is no
    IfcBalcony class). Downstream tools filter by ObjectType."""
    bf = BuildFlowIFC(_brief())
    b = bf.add_balcony(
        "bal-1", origin=(0, 0, 0),
        length=4.0, projection=1.5, material="mat-concrete",
    )
    assert b is not None
    assert b.is_a("IfcSlab")
    assert b.PredefinedType == "USERDEFINED"
    assert b.ObjectType == "Balcony"


def test_balcony_telemetry_records_built_not_proxy():
    """The whole point of ε.1: balconies move OUT of proxy_fallbacks
    and INTO built_element_counts."""
    bf = BuildFlowIFC(_brief())
    bf.add_balcony(
        "bal-1", origin=(0, 0, 0),
        length=4.0, projection=1.5, material="mat-concrete",
    )
    tel = bf.get_telemetry()
    assert tel["proxy_fallbacks"] == [], (
        "balcony must NOT record a proxy_fallback — that was pre-ε.1"
    )
    assert tel["built_element_counts"].get("IfcSlab", 0) >= 1


def test_balcony_storey_parented_at_floor_z():
    """Balconies project from a specific floor. With storey-1 at
    elevation 3.1 and oz=0 in floor-1's frame, the balcony sits at
    world Z=3.1 (floor-1's floor)."""
    bf = BuildFlowIFC(_brief())
    floor_1 = bf.add_storey("floor-1", "First Floor", 3.1)
    b = bf.add_balcony(
        "bal-1", origin=(8, 0, 0),
        length=3.0, projection=1.2, material="mat-concrete",
        storey_id="floor-1",
    )
    assert b.ObjectPlacement.PlacementRelTo == floor_1.ObjectPlacement
    loc = b.ObjectPlacement.RelativePlacement.Location.Coordinates
    assert loc[2] == 0.0  # storey-relative


@pytest.mark.parametrize("length,projection", [
    (0, 1.0), (-1.0, 1.0), (3.0, 0), (3.0, -0.5),
    ("garbage", 1.0), (3.0, None),
])
def test_balcony_invalid_dims_skip_gracefully(length, projection):
    """Bad dims → dropped_element telemetry, returns None, no IFC entity."""
    bf = BuildFlowIFC(_brief())
    result = bf.add_balcony(
        "bal-bad", origin=(0, 0, 0),
        length=length, projection=projection, material="mat-concrete",
    )
    assert result is None
    tel = bf.get_telemetry()
    assert any(e["type"] == "balcony" for e in tel["dropped_elements"])


# ─── add_parapet ────────────────────────────────────────────────────


def test_parapet_emits_ifcwall_with_parapet_predefined_type_in_ifc4():
    """IFC4 IfcWall has PARAPET in its PredefinedType enum
    (canonical_psets.py:142). add_parapet must set it."""
    bf = BuildFlowIFC(_brief(), schema="IFC4")
    p = bf.add_parapet(
        "par-1", origin=(0, 0, 0),
        length=10.0, height=1.0, material="mat-concrete",
    )
    assert p.is_a("IfcWall")
    assert p.PredefinedType == "PARAPET"
    # ObjectType also set so IFC2X3 (which has no PredefinedType on
    # IfcWall) still has a discriminator.
    assert p.ObjectType == "Parapet"


def test_parapet_ifc2x3_uses_objecttype_only():
    """IFC2X3 IfcWall has NO PredefinedType slot. add_parapet must NOT
    crash; the ObjectType discriminator carries the semantics."""
    bf = BuildFlowIFC(_brief(), schema="IFC2X3")
    p = bf.add_parapet(
        "par-1", origin=(0, 0, 0),
        length=10.0, height=1.0, material="mat-concrete",
    )
    assert p.is_a("IfcWall")
    assert p.ObjectType == "Parapet"


def test_parapet_telemetry_records_built_not_proxy():
    bf = BuildFlowIFC(_brief())
    bf.add_parapet(
        "par-1", origin=(0, 0, 0),
        length=10.0, height=1.0, material="mat-concrete",
    )
    tel = bf.get_telemetry()
    assert tel["proxy_fallbacks"] == []
    assert tel["built_element_counts"].get("IfcWall", 0) >= 1


@pytest.mark.parametrize("length,height", [
    (0, 1.0), (-1.0, 1.0), (10.0, 0), (10.0, -0.5),
    ("garbage", 1.0), (10.0, None),
])
def test_parapet_invalid_dims_skip_gracefully(length, height):
    bf = BuildFlowIFC(_brief())
    result = bf.add_parapet(
        "par-bad", origin=(0, 0, 0),
        length=length, height=height, material="mat-concrete",
    )
    assert result is None
    tel = bf.get_telemetry()
    assert any(e["type"] == "parapet" for e in tel["dropped_elements"])


# ─── add_roof ───────────────────────────────────────────────────────


def _slab_of_roof(roof) -> object:
    for rel in roof.IsDecomposedBy or []:
        if rel.is_a("IfcRelAggregates"):
            for child in rel.RelatedObjects or []:
                if child.is_a("IfcSlab"):
                    return child
    raise AssertionError("roof has no aggregated IfcSlab")


def test_roof_emits_ifcroof_with_flat_roof_predefined_type():
    bf = BuildFlowIFC(_brief(), schema="IFC4")
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(10, 10), material="mat-concrete",
    )
    assert r.is_a("IfcRoof")
    assert r.PredefinedType == "FLAT_ROOF"


def test_roof_uses_shapetype_in_ifc2x3():
    """IFC2X3 renamed PredefinedType → ShapeType on IfcRoof (same lesson
    as δ.4's IfcStair)."""
    bf = BuildFlowIFC(_brief(), schema="IFC2X3")
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(10, 10), material="mat-concrete",
    )
    assert r.is_a("IfcRoof")
    assert r.ShapeType == "FLAT_ROOF"


def test_roof_aggregates_slab_via_ifcrelaggregates():
    """Real IFC roof semantics: IfcRoof (assembly) + IfcSlab
    (geometry) aggregated via IfcRelAggregates."""
    bf = BuildFlowIFC(_brief())
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(10, 10), material="mat-concrete",
    )
    slab = _slab_of_roof(r)
    assert slab.is_a("IfcSlab")
    assert slab.PredefinedType == "ROOF"


def test_roof_slab_has_correct_footprint_and_thickness():
    """Walk the slab geometry to assert (width × depth × thickness)
    match the inputs."""
    bf = BuildFlowIFC(_brief())
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(12.5, 7.5), thickness=0.2, material="mat-concrete",
    )
    slab = _slab_of_roof(r)
    rep = slab.Representation
    solid = rep.Representations[0].Items[0]
    assert solid.is_a("IfcExtrudedAreaSolid")
    # Profile dimensions match input dims.
    prof = solid.SweptArea
    assert math.isclose(prof.XDim, 12.5, abs_tol=1e-9)
    assert math.isclose(prof.YDim, 7.5, abs_tol=1e-9)
    # Extrusion depth = thickness.
    assert math.isclose(solid.Depth, 0.2, abs_tol=1e-9)


def test_roof_sits_on_top_storey_at_correct_world_z():
    """For a 2-storey building (storey-1 at 3.1m), the agent calls
    add_roof on storey-1 with oz=3.1 so the roof slab's base sits at
    world Z = storey-1 elevation + 3.1 = 6.2 (i.e. on top of the
    storey-1 ceiling). The top of the roof slab is at 6.2 + 0.15."""
    bf = BuildFlowIFC(_brief())
    floor_1 = bf.add_storey("floor-1", "First Floor", 3.1)
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 3.1),  # oz = ceiling height
        dims=(10, 10), thickness=0.15, material="mat-concrete",
        storey_id="floor-1",
    )
    # Roof is storey-parented.
    assert r.ObjectPlacement.PlacementRelTo == floor_1.ObjectPlacement
    # Local oz = 3.1 → world Z = 3.1 (storey-1 elevation) + 3.1 = 6.2.
    loc = r.ObjectPlacement.RelativePlacement.Location.Coordinates
    assert math.isclose(loc[2], 3.1, abs_tol=1e-9)
    # Bottom of slab at storey-local z=3.1 → world z = 6.2.
    # Top of slab at storey-local z=3.1 + 0.15 = 3.25 → world z = 6.35.


def test_roof_telemetry_records_built_not_proxy():
    """ε.1 closing condition: roof joins built_element_counts."""
    bf = BuildFlowIFC(_brief())
    bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(10, 10), material="mat-concrete",
    )
    tel = bf.get_telemetry()
    assert tel["proxy_fallbacks"] == []
    assert tel["built_element_counts"].get("IfcRoof", 0) == 1
    assert tel["built_element_counts"].get("IfcSlab", 0) >= 1


def test_roof_carries_material_assignment():
    """γ.5 discipline applies — both IfcRoof and IfcSlab must be
    materialed."""
    bf = BuildFlowIFC(_brief())
    r = bf.add_roof(
        "roof-1", origin=(0, 0, 0),
        dims=(10, 10), material="mat-concrete",
    )
    slab = _slab_of_roof(r)
    associated = False
    for rel in bf._ifc.by_type("IfcRelAssociatesMaterial"):
        related = list(rel.RelatedObjects or [])
        if r in related or slab in related:
            associated = True
            break
    assert associated


@pytest.mark.parametrize("dims", [
    (0, 5), (5, 0), (-1, 5), "garbage", (None, 5), (5,),
])
def test_roof_invalid_dims_skip_gracefully(dims):
    bf = BuildFlowIFC(_brief())
    result = bf.add_roof(
        "roof-bad", origin=(0, 0, 0),
        dims=dims, material="mat-concrete",
    )
    assert result is None
    tel = bf.get_telemetry()
    assert any(e["type"] == "roof" for e in tel["dropped_elements"])


def test_roof_duplicate_id_raises():
    bf = BuildFlowIFC(_brief())
    bf.add_roof("roof-1", origin=(0, 0, 0), dims=(10, 10))
    from app.services.ifc_generator_v3.buildflow_ifc import BuildFlowIFCError
    with pytest.raises(BuildFlowIFCError):
        bf.add_roof("roof-1", origin=(0, 0, 0), dims=(10, 10))


# ─── Persistence (save/load round-trip) ─────────────────────────────


def test_roof_balcony_parapet_survive_save_load():
    """All three element types must persist across save_state →
    load_state. The roof's IfcRelAggregates → IfcSlab is part of the
    IFC graph and persists automatically; the roof entity itself is
    registered in _elements_by_id with a Tag, restored on load."""
    bf = BuildFlowIFC(_brief())
    bf.add_balcony(
        "bal-1", origin=(5, 5, 0), length=4.0, projection=1.5,
        material="mat-concrete",
    )
    bf.add_parapet(
        "par-1", origin=(0, 0, 3.1), length=10.0, height=1.0,
        material="mat-concrete",
    )
    bf.add_roof(
        "roof-1", origin=(0, 0, 3.1), dims=(10, 10), thickness=0.15,
        material="mat-concrete",
    )

    with tempfile.TemporaryDirectory() as tmp:
        bf.save_state(tmp)
        restored = BuildFlowIFC.load_state(tmp)

    assert "bal-1" in restored._elements_by_id
    assert restored._elements_by_id["bal-1"].is_a("IfcSlab")
    assert "par-1" in restored._elements_by_id
    assert restored._elements_by_id["par-1"].is_a("IfcWall")
    assert "roof-1" in restored._elements_by_id
    roof = restored._elements_by_id["roof-1"]
    assert roof.is_a("IfcRoof")
    # Roof's aggregated slab still discoverable via IFC graph.
    slab = _slab_of_roof(roof)
    assert slab.is_a("IfcSlab")
    assert slab.PredefinedType == "ROOF"


# ─── Integration: a multi-storey villa with stair+balcony+roof+parapet ─


def test_multistorey_villa_all_built_zero_proxies():
    """The acceptance test of ε.1 + δ.4 together: a 2-storey villa
    brief produces a stair + balcony + roof + parapet, ALL real, ZERO
    proxy fallbacks. This is what the benchmark residential brief
    should look like after ε.1 ships."""
    bf = BuildFlowIFC(_brief())
    floor_1 = bf.add_storey("floor-1", "First Floor", 3.1)
    # Stair (δ.4)
    bf.add_stair(
        "stair-g-1", origin=(2, 2, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    # Balcony on floor-1
    bf.add_balcony(
        "bal-east", origin=(10, 3, 0),
        length=4.0, projection=1.2, material="mat-concrete",
        storey_id="floor-1",
    )
    # Roof above floor-1
    bf.add_roof(
        "roof-villa", origin=(0, 0, 3.1),
        dims=(10, 10), thickness=0.15, material="mat-concrete",
        storey_id="floor-1",
    )
    # Parapet around the roof
    bf.add_parapet(
        "par-N", origin=(0, 10, 3.25),  # on top of the roof slab
        length=10.0, height=1.0, material="mat-concrete",
        storey_id="floor-1",
    )

    tel = bf.get_telemetry()
    # The acceptance condition: ZERO proxy fallbacks for any of the
    # element types ε.1 + δ.4 cover.
    requested_proxy_types = {
        e["requested_type"] for e in tel["proxy_fallbacks"]
    }
    for t in ("stair", "balcony", "parapet", "roof"):
        assert t not in requested_proxy_types, (
            f"'{t}' fell back to proxy — ε.1/δ.4 should have caught it. "
            f"All proxy_fallbacks: {tel['proxy_fallbacks']}"
        )

    # And all four typed classes show up in built counts.
    built = tel["built_element_counts"]
    assert built.get("IfcStair", 0) >= 1
    assert built.get("IfcSlab", 0) >= 2  # balcony + roof slab
    assert built.get("IfcWall", 0) >= 1  # parapet
    assert built.get("IfcRoof", 0) == 1
    # Floor-1 storey was created; it's in self._storeys_by_id, not
    # built_element_counts (storeys are spatial, not built elements).
    assert floor_1 is not None
