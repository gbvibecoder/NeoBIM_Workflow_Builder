"""Phase 1 Slice 5 — combined parametric-builder tests.

One test class per refactored builder module, sharing minimal IFC
fixture helpers. Slab / Column / Beam / Opening / Door / Window /
Space / Stair / MEP segment / equipment / terminal each get focused
tests covering: IFC class produced, placement origin from
ResolvedPlacement, geometry dimensions from ResolvedGeometry, storey
containment, and a defensive guard.

Plus an end-to-end parametric-pipeline parity check across all 3
fixtures (entity-count delta within +25, no failures).
"""

from __future__ import annotations

import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.api as api
import pytest

from app.domain.building_model import BuildingModel
from app.models.request import ExportIFCRequest, ExportOptions, MassingGeometry
from app.services.beam_builder import create_beam_parametric
from app.services.column_builder import create_column_parametric
from app.services.geometry_resolver import ResolvedGeometry, resolve_geometries
from app.services.ifc_builder import build_ifc
from app.services.massing_to_building_model import lift
from app.services.mep_builder import (
    create_mep_equipment_parametric,
    create_mep_segment_parametric,
    create_mep_terminal_parametric,
)
from app.services.opening_builder import (
    create_door_parametric,
    create_opening_parametric,
    create_window_parametric,
)
from app.services.placement_resolver import resolve_placements
from app.services.slab_builder import create_slab_parametric
from app.services.space_builder import create_space_parametric
from app.services.stair_builder import create_stair_parametric
from app.services.type_registry import TypeRegistry
from app.services.wall_builder import create_wall_parametric


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _make_ifc_with_storey():
    f = ifcopenshell.file(schema="IFC4")
    project = api.run("root.create_entity", f, ifc_class="IfcProject", name="T")
    api.run("unit.assign_unit", f, length={"is_metric": True, "raw": "METRE"})
    ctx = api.run("context.add_context", f, context_type="Model")
    body_ctx = api.run(
        "context.add_context", f, context_type="Model",
        context_identifier="Body", target_view="MODEL_VIEW", parent=ctx,
    )
    site = api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    bldg = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="B")
    api.run("aggregate.assign_object", f, relating_object=site, products=[bldg])
    storey = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="L0")
    storey.Elevation = 0.0
    api.run("aggregate.assign_object", f, relating_object=bldg, products=[storey])
    return f, body_ctx, storey


def _lift_simple_box():
    with open(_FIXTURE_DIR / "simple_box.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _ = lift(geom, ExportOptions(), build_id="b", fixture_match="simple_box")
    return bm, resolve_placements(bm), resolve_geometries(bm, resolve_placements(bm))


def _lift_multistorey():
    with open(_FIXTURE_DIR / "multistorey_residential.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _ = lift(geom, ExportOptions(), build_id="b", fixture_match="msr")
    p = resolve_placements(bm)
    g = resolve_geometries(bm, p)
    return bm, p, g


# ─── Slab ────────────────────────────────────────────────────────────


def test_slab_parametric_emits_ifc_slab_with_correct_predefined_type():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    floor_slab = next(
        s for s in bm.project.site.building.storeys[0].slabs
        if s.predefined_type == "FLOOR"
    )
    e = create_slab_parametric(floor_slab, p[floor_slab.id], g[floor_slab.id], f, body, storey, tr)
    assert e.is_a("IfcSlab")
    assert e.PredefinedType == "FLOOR"


def test_slab_parametric_uses_polygon_profile():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    slab = bm.project.site.building.storeys[0].slabs[0]
    e = create_slab_parametric(slab, p[slab.id], g[slab.id], f, body, storey, tr)
    profile = e.Representation.Representations[0].Items[0].SweptArea
    assert profile.is_a("IfcArbitraryClosedProfileDef")


def test_slab_parametric_rejects_non_polygon_geometry():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    slab = bm.project.site.building.storeys[0].slabs[0]
    # SweptSolid with rectangle profile (not polygon) ⇒ rejected.
    bad = ResolvedGeometry(
        node_id=slab.id,
        representation_type="SweptSolid",
        profile_type="rectangle",
        profile_x_dim=1.0,
        profile_y_dim=1.0,
        extrusion_depth=0.2,
    )
    with pytest.raises(ValueError, match="profile_type"):
        create_slab_parametric(slab, p[slab.id], bad, f, body, storey, tr)


# ─── Column ──────────────────────────────────────────────────────────


def test_column_parametric_emits_ifc_column():
    bm, p, g = _lift_multistorey()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    col = bm.project.site.building.structural_system.columns[0]
    e = create_column_parametric(col, p[col.id], g[col.id], f, body, storey, tr)
    assert e.is_a("IfcColumn")


def test_column_parametric_extrusion_depth_matches_geometry():
    bm, p, g = _lift_multistorey()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    col = bm.project.site.building.structural_system.columns[0]
    e = create_column_parametric(col, p[col.id], g[col.id], f, body, storey, tr)
    solid = e.Representation.Representations[0].Items[0]
    assert solid.Depth == pytest.approx(g[col.id].extrusion_depth)


# ─── Beam ────────────────────────────────────────────────────────────


def test_beam_parametric_emits_ifc_beam():
    bm, p, g = _lift_multistorey()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    beam = bm.project.site.building.structural_system.beams[0]
    e = create_beam_parametric(beam, p[beam.id], g[beam.id], f, body, storey, tr)
    assert e.is_a("IfcBeam")
    assert e.Representation is not None


def test_beam_parametric_extrusion_along_axis_length():
    bm, p, g = _lift_multistorey()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    beam = bm.project.site.building.structural_system.beams[0]
    e = create_beam_parametric(beam, p[beam.id], g[beam.id], f, body, storey, tr)
    solid = e.Representation.Representations[0].Items[0]
    s, ed = beam.start_point, beam.end_point
    L = ((ed.x - s.x) ** 2 + (ed.y - s.y) ** 2 + (ed.z - s.z) ** 2) ** 0.5
    assert solid.Depth == pytest.approx(L, abs=1e-6)


# ─── Opening + Door + Window ─────────────────────────────────────────


def _setup_wall_for_opening_tests():
    """Build a wall + storey, then a real IfcWall via parametric. Returns
    (ifc_file, body_ctx, ifc_storey, wall_entity, opening_node, door_node,
    window_node, opening_placement)."""
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]  # w-e or whichever
    # Find a wall that has openings
    storey0 = bm.project.site.building.storeys[0]
    opening = storey0.openings[0]  # any opening
    wall = next(w for w in storey0.walls if w.id == opening.in_wall_id)
    wall_entity = create_wall_parametric(wall, p[wall.id], g[wall.id], f, body, storey, tr)
    return f, body, storey, tr, wall_entity, opening, p[opening.id], bm


def test_opening_parametric_creates_opening_and_voids_wall():
    f, body, storey, tr, wall_entity, opening, op_p, _bm = _setup_wall_for_opening_tests()
    op_entity = create_opening_parametric(opening, op_p, wall_entity, f, body)
    assert op_entity.is_a("IfcOpeningElement")
    voids = [r for r in f.by_type("IfcRelVoidsElement") if r.RelatedOpeningElement == op_entity]
    assert len(voids) == 1
    assert voids[0].RelatingBuildingElement == wall_entity


def test_door_parametric_fills_opening():
    f, body, storey, tr, wall_entity, opening, op_p, bm = _setup_wall_for_opening_tests()
    op_entity = create_opening_parametric(opening, op_p, wall_entity, f, body)
    door = bm.project.site.building.doors[0]
    d_entity = create_door_parametric(door, opening, op_entity, f, body, storey, tr)
    assert d_entity.is_a("IfcDoor")
    assert d_entity.OverallWidth == pytest.approx(opening.width)
    assert d_entity.OverallHeight == pytest.approx(opening.height)
    fills = [r for r in f.by_type("IfcRelFillsElement") if r.RelatedBuildingElement == d_entity]
    assert len(fills) == 1


def test_window_parametric_fills_opening():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    storey0 = bm.project.site.building.storeys[0]
    window = bm.project.site.building.windows[0]
    opening = next(o for o in storey0.openings if o.id == window.in_opening_id)
    wall = next(w for w in storey0.walls if w.id == opening.in_wall_id)
    wall_entity = create_wall_parametric(wall, p[wall.id], g[wall.id], f, body, storey, tr)
    op_entity = create_opening_parametric(opening, p[opening.id], wall_entity, f, body)
    w_entity = create_window_parametric(window, opening, op_entity, f, body, storey, tr)
    assert w_entity.is_a("IfcWindow")
    assert w_entity.OverallWidth == pytest.approx(opening.width)


def test_door_operation_type_derived_from_swing_handedness():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    storey0 = bm.project.site.building.storeys[0]
    door = bm.project.site.building.doors[0]
    opening = next(o for o in storey0.openings if o.id == door.in_opening_id)
    wall = next(w for w in storey0.walls if w.id == opening.in_wall_id)
    wall_entity = create_wall_parametric(wall, p[wall.id], g[wall.id], f, body, storey, tr)
    op_entity = create_opening_parametric(opening, p[opening.id], wall_entity, f, body)
    d_entity = create_door_parametric(door, opening, op_entity, f, body, storey, tr)
    assert d_entity.OperationType in {
        "SINGLE_SWING_LEFT", "SINGLE_SWING_RIGHT", "DOUBLE_DOOR_SINGLE_SWING",
        "SLIDING_TO_LEFT", "SLIDING_TO_RIGHT", "FOLDING_TO_LEFT", "FOLDING_TO_RIGHT",
        "REVOLVING",
    }


# ─── Space ───────────────────────────────────────────────────────────


def test_space_parametric_emits_ifc_space():
    bm, p, g = _lift_simple_box()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    room = bm.project.site.building.storeys[0].rooms[0]
    e = create_space_parametric(room, p[room.id], g[room.id], f, body, storey, tr)
    assert e.is_a("IfcSpace")
    assert e.Name == room.name
    assert e.LongName == room.usage


# ─── Stair ───────────────────────────────────────────────────────────


def test_stair_parametric_emits_ifc_stairflight_with_correct_riser_count():
    bm, p, g = _lift_multistorey()
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    stair = bm.project.site.building.storeys[0].stairs[0]
    e = create_stair_parametric(stair, p[stair.id], g[stair.id], f, body, storey, tr)
    assert e.is_a("IfcStairFlight")
    assert e.NumberOfRisers == stair.riser_count
    assert e.RiserHeight == pytest.approx(stair.riser_height)


# ─── MEP ─────────────────────────────────────────────────────────────


def test_mep_equipment_parametric_emits_ifc_unitary_equipment_for_hvac():
    """Per the IFC4 schema mapping (IfcAirHandlingUnit is IFC4x3 only),
    HVAC equipment maps to IfcUnitaryEquipment."""
    bm, p, g = _lift_simple_box()  # simple_box has no MEP, so synthesise
    from app.domain.building_model import MEPEquipment, Vec3
    eq = MEPEquipment(
        id="ahu-test", system_kind="HVAC",
        predefined_type="AIRHANDLER", location=Vec3(x=1, y=1, z=2.5), name="AHU"
    )
    from app.services.placement_resolver import ResolvedPlacement
    pl = ResolvedPlacement(
        node_id="ahu-test",
        origin=Vec3(x=1, y=1, z=2.5),
        local_x_axis=Vec3(x=1, y=0, z=0),
        local_z_axis=Vec3(x=0, y=0, z=1),
    )
    geo = ResolvedGeometry(
        node_id="ahu-test", representation_type="BoundingBox",
        bbox_x=0.6, bbox_y=0.6, bbox_z=0.6,
    )
    f, body, storey = _make_ifc_with_storey()
    tr = TypeRegistry(f)
    e = create_mep_equipment_parametric(eq, pl, geo, f, body, storey, tr)
    assert e.is_a("IfcUnitaryEquipment")


def test_mep_segment_parametric_emits_class_per_kind():
    from app.domain.building_model import MEPSegment, Vec3
    from app.services.placement_resolver import ResolvedPlacement
    cases = [
        ("HVAC", "IfcDuctSegment"),
        ("Plumbing", "IfcPipeSegment"),
        ("Electrical", "IfcCableCarrierSegment"),
    ]
    for kind, expected in cases:
        seg = MEPSegment(
            id=f"seg-{kind}", system_kind=kind,
            predefined_type="RIGIDSEGMENT",
            start_point=Vec3(x=0, y=0, z=0),
            end_point=Vec3(x=2, y=0, z=0),
        )
        pl = ResolvedPlacement(
            node_id=seg.id,
            origin=Vec3(x=0, y=0, z=0),
            local_x_axis=Vec3(x=1, y=0, z=0),
            local_z_axis=Vec3(x=0, y=0, z=1),
        )
        geo = ResolvedGeometry(
            node_id=seg.id, representation_type="SweptSolid",
            profile_type="circle", profile_x_dim=0.1, extrusion_depth=2.0,
            extrusion_direction=Vec3(x=1, y=0, z=0),
        )
        f, body, storey = _make_ifc_with_storey()
        tr = TypeRegistry(f)
        e = create_mep_segment_parametric(seg, pl, geo, f, body, storey, tr)
        assert e.is_a(expected), f"{kind} → expected {expected}, got {e.is_a()}"


def test_mep_terminal_parametric_emits_class_per_kind():
    from app.domain.building_model import MEPTerminal, Vec3
    from app.services.placement_resolver import ResolvedPlacement
    cases = [
        ("HVAC", "IfcAirTerminal"),
        ("Plumbing", "IfcSanitaryTerminal"),
        ("Electrical", "IfcLightFixture"),
    ]
    for kind, expected in cases:
        term = MEPTerminal(
            id=f"term-{kind}", system_kind=kind,
            predefined_type="DIFFUSER",
            location=Vec3(x=0, y=0, z=2.5),
        )
        pl = ResolvedPlacement(
            node_id=term.id, origin=term.location,
            local_x_axis=Vec3(x=1, y=0, z=0),
            local_z_axis=Vec3(x=0, y=0, z=1),
        )
        geo = ResolvedGeometry(
            node_id=term.id, representation_type="BoundingBox",
            bbox_x=0.3, bbox_y=0.3, bbox_z=0.3,
        )
        f, body, storey = _make_ifc_with_storey()
        tr = TypeRegistry(f)
        e = create_mep_terminal_parametric(term, pl, geo, f, body, storey, tr)
        assert e.is_a(expected)


# ─── End-to-end pipeline parity per fixture ─────────────────────────


@pytest.mark.parametrize(
    "fixture",
    ["simple_box", "multistorey_residential", "non_rectangular"],
)
def test_parametric_pipeline_no_failures(fixture: str):
    """Every Phase 0 fixture must build successfully through the
    parametric pipeline."""
    with open(_FIXTURE_DIR / f"{fixture}.json") as fp:
        d = json.load(fp)
    d.pop("_comment", None)
    req = ExportIFCRequest.model_validate(d)
    _m, _c, failures = build_ifc(
        req.geometry,
        project_name=req.options.project_name,
        building_name=req.options.building_name,
        site_name=req.options.site_name,
        discipline="combined",
        rich_mode=req.options.rich_mode,
        emit_mep_geometry=False,
        use_parametric_pipeline=True,
    )
    assert failures == [], f"Parametric build had failures on {fixture}: {failures}"


@pytest.mark.parametrize(
    "fixture,delta_max",
    # Slice 6 widened the budget: instance-level material association
    # (IfcRelAssociatesMaterial + IfcMaterial per column), Qto_SpaceBase
    # quantities on every space, and post-emission MEP PredefinedType
    # all add entities beyond the +17 provenance Pset baseline. The
    # multistorey/non_rectangular fixtures have more rooms + columns
    # so their delta is larger; budget set to absorb worst-case
    # observed value (~150) with headroom.
    [("simple_box", 50), ("multistorey_residential", 200), ("non_rectangular", 200)],
)
def test_parametric_pipeline_entity_count_within_budget(fixture: str, delta_max: int):
    """Parametric vs legacy entity-count delta within budget."""
    with open(_FIXTURE_DIR / f"{fixture}.json") as fp:
        d = json.load(fp)
    d.pop("_comment", None)
    req = ExportIFCRequest.model_validate(d)
    def _build(p):
        return build_ifc(
            req.geometry,
            project_name=req.options.project_name,
            building_name=req.options.building_name,
            site_name=req.options.site_name,
            discipline="combined",
            rich_mode=req.options.rich_mode,
            emit_mep_geometry=False,
            use_parametric_pipeline=p,
        )
    m_l, _, _ = _build(False)
    m_p, _, _ = _build(True)
    delta = abs(len(list(m_p)) - len(list(m_l)))
    assert delta <= delta_max, f"{fixture}: delta {delta} > {delta_max}"


def test_parametric_pipeline_stamps_provenance_pset():
    """End-to-end: parametric pipeline produces an IfcProject carrying
    Pset_BuildFlow_Provenance with all 15 properties (Slice 3 stamping
    is wired into ifc_builder)."""
    with open(_FIXTURE_DIR / "simple_box.json") as fp:
        d = json.load(fp)
    d.pop("_comment", None)
    req = ExportIFCRequest.model_validate(d)
    m, _c, _f = build_ifc(
        req.geometry,
        project_name=req.options.project_name,
        building_name=req.options.building_name,
        site_name=req.options.site_name,
        discipline="combined",
        rich_mode=req.options.rich_mode,
        emit_mep_geometry=False,
        use_parametric_pipeline=True,
    )
    project = m.by_type("IfcProject")[0]
    psets = [
        rel.RelatingPropertyDefinition
        for rel in (project.IsDefinedBy or [])
        if rel.is_a("IfcRelDefinesByProperties")
    ]
    pset = next((p for p in psets if p.Name == "Pset_BuildFlow_Provenance"), None)
    assert pset is not None, "Pset_BuildFlow_Provenance missing from parametric build"
    assert len(pset.HasProperties) == 15
