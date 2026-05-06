"""Phase 1 Slice 4 — wall_builder.create_wall_parametric tests.

Verifies that the new signature emits IfcWall entities equivalent to
the legacy `create_wall` for the simple_box fixture, and that the
parametric pipeline run end-to-end through `build_ifc` produces the
same total entity count + same per-wall dimensions.

Also pins the architectural property: the new builder consumes
`ResolvedPlacement` + `ResolvedGeometry` and never reaches into
BuildingModel fields it doesn't need (no `wall.base_z`, no
`wall.axis_points` direct access — the resolved values are
authoritative).
"""

from __future__ import annotations

import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.api as api
import pytest

from app.domain.building_model import BuildingModel
from app.models.request import ExportIFCRequest, ExportOptions, MassingGeometry
from app.services.geometry_resolver import resolve_geometries
from app.services.ifc_builder import build_ifc
from app.services.massing_to_building_model import lift
from app.services.placement_resolver import resolve_placements
from app.services.type_registry import TypeRegistry
from app.services.wall_builder import create_wall_parametric


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _make_minimal_ifc_with_storey():
    f = ifcopenshell.file(schema="IFC4")
    project = api.run("root.create_entity", f, ifc_class="IfcProject", name="T")
    api.run("unit.assign_unit", f, length={"is_metric": True, "raw": "METRE"})
    context = api.run("context.add_context", f, context_type="Model")
    body_context = api.run(
        "context.add_context",
        f,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=context,
    )
    site = api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    api.run("aggregate.assign_object", f, relating_object=project, products=[site])
    building = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="B")
    api.run("aggregate.assign_object", f, relating_object=site, products=[building])
    storey = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="L0")
    storey.Elevation = 0.0
    api.run("aggregate.assign_object", f, relating_object=building, products=[storey])
    return f, body_context, storey


def _lift_simple_box():
    with open(_FIXTURE_DIR / "simple_box.json") as fp:
        d = json.load(fp)
    geom = MassingGeometry.model_validate(d["geometry"])
    bm, _ = lift(geom, ExportOptions(), build_id="b", fixture_match="simple_box")
    placements = resolve_placements(bm)
    geometries = resolve_geometries(bm, placements)
    return bm, placements, geometries


# ─── Standalone create_wall_parametric ──────────────────────────────


def test_create_wall_parametric_returns_an_ifc_wall():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)

    wall = bm.project.site.building.storeys[0].walls[0]
    p = placements[wall.id]
    g = geometries[wall.id]
    ifc_wall = create_wall_parametric(wall, p, g, f, body_ctx, storey, type_registry)
    assert ifc_wall.is_a("IfcWall")
    assert ifc_wall.GlobalId is not None and len(ifc_wall.GlobalId) == 22
    # Slice 5: builder uses wall.name when lift preserved one, else wall.id.
    assert ifc_wall.Name == (wall.name if wall.name else wall.id)


def test_wall_predefined_type_partitioning_when_partition():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]
    # Synthesize a partition wall by mutating the wall in a fresh dict
    partition_wall = wall.model_copy(update={"type": "partition"})
    ifc_wall = create_wall_parametric(
        partition_wall,
        placements[wall.id],
        geometries[wall.id],
        f,
        body_ctx,
        storey,
        type_registry,
    )
    assert ifc_wall.PredefinedType == "PARTITIONING"


def test_wall_extrusion_dimensions_match_resolved_geometry():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)

    for wall in bm.project.site.building.storeys[0].walls:
        ifc_wall = create_wall_parametric(
            wall, placements[wall.id], geometries[wall.id], f, body_ctx, storey, type_registry
        )
        rep = ifc_wall.Representation.Representations[0]
        solid = rep.Items[0]
        assert solid.is_a("IfcExtrudedAreaSolid")
        profile = solid.SweptArea
        assert profile.is_a("IfcRectangleProfileDef")
        assert profile.XDim == pytest.approx(geometries[wall.id].profile_x_dim)
        assert profile.YDim == pytest.approx(geometries[wall.id].profile_y_dim)
        assert solid.Depth == pytest.approx(geometries[wall.id].extrusion_depth)


def test_wall_object_placement_origin_matches_resolved():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]
    ifc_wall = create_wall_parametric(
        wall, placements[wall.id], geometries[wall.id], f, body_ctx, storey, type_registry
    )
    place = ifc_wall.ObjectPlacement
    coords = place.RelativePlacement.Location.Coordinates
    p = placements[wall.id]
    assert coords[0] == pytest.approx(p.origin.x)
    assert coords[1] == pytest.approx(p.origin.y)
    assert coords[2] == pytest.approx(p.origin.z)


def test_wall_assigned_to_storey():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]
    ifc_wall = create_wall_parametric(
        wall, placements[wall.id], geometries[wall.id], f, body_ctx, storey, type_registry
    )
    # Storey containment is via IfcRelContainedInSpatialStructure
    rels = [
        r for r in f.by_type("IfcRelContainedInSpatialStructure")
        if r.RelatingStructure == storey
    ]
    assert any(ifc_wall in r.RelatedElements for r in rels)


def test_wall_has_swept_solid_body_representation():
    bm, placements, geometries = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]
    ifc_wall = create_wall_parametric(
        wall, placements[wall.id], geometries[wall.id], f, body_ctx, storey, type_registry
    )
    rep = ifc_wall.Representation.Representations[0]
    assert rep.RepresentationIdentifier == "Body"
    assert rep.RepresentationType == "SweptSolid"


# ─── Defensive guards ───────────────────────────────────────────────


def test_raises_on_non_swept_solid_geometry():
    """Builder rejects geometry with the wrong representation_type — keeps
    builders type-narrow per their contract."""
    from app.services.geometry_resolver import ResolvedGeometry
    bm, placements, _ = _lift_simple_box()
    f, body_ctx, storey = _make_minimal_ifc_with_storey()
    type_registry = TypeRegistry(f)
    wall = bm.project.site.building.storeys[0].walls[0]
    bad = ResolvedGeometry(
        node_id=wall.id,
        representation_type="Curve3D",  # wrong shape for a wall
    )
    with pytest.raises(ValueError, match="representation_type"):
        create_wall_parametric(wall, placements[wall.id], bad, f, body_ctx, storey, type_registry)


# ─── End-to-end pipeline parity (parametric vs legacy) ──────────────


def _build(use_param: bool):
    with open(_FIXTURE_DIR / "simple_box.json") as fp:
        d = json.load(fp)
    d.pop("_comment", None)  # R3 will whitelist this in Slice 6
    req = ExportIFCRequest.model_validate(d)
    return build_ifc(
        req.geometry,
        project_name=req.options.project_name,
        building_name=req.options.building_name,
        site_name=req.options.site_name,
        discipline="combined",
        rich_mode=req.options.rich_mode,
        use_parametric_pipeline=use_param,
    )


def test_parametric_pipeline_produces_same_total_entity_count():
    """Slice 5 update: parametric path now stamps Pset_BuildFlow_Provenance
    on every IfcProject, which adds ~17 entities (1 IfcPropertySet +
    1 IfcRelDefinesByProperties + 15 IfcPropertySingleValue). The
    spec'd ±5 tolerance from Slice 4 is updated to ±25 to absorb this
    expected delta. Anything beyond ±25 indicates a real builder
    divergence."""
    m_l, c_l, _f_l = _build(False)
    m_p, c_p, _f_p = _build(True)
    n_legacy = len(list(m_l))
    n_param = len(list(m_p))
    delta = abs(n_param - n_legacy)
    assert delta <= 25, (
        f"Parametric pipeline entity count {n_param} differs from legacy "
        f"{n_legacy} by {delta} (>25 tolerance — Slice 5 budget covers "
        "+17 for provenance Pset)"
    )


def test_parametric_pipeline_emits_same_wall_count():
    _m_l, c_l, _f_l = _build(False)
    _m_p, c_p, _f_p = _build(True)
    assert c_p.IfcWall == c_l.IfcWall


def test_parametric_pipeline_emits_no_failures_on_simple_box():
    _m, _c, failures = _build(True)
    assert failures == [], f"Parametric build had failures: {failures}"


def test_parametric_pipeline_per_wall_dimensions_match_legacy():
    """Compare XDim/YDim/Depth of every named-element wall (skip enrichment-
    added parapets which use IfcArbitraryProfileDef)."""
    m_l, _c_l, _f_l = _build(False)
    m_p, _c_p, _f_p = _build(True)

    def _rect_dims(model):
        out = {}
        for w in model.by_type("IfcWall"):
            rep = w.Representation.Representations[0] if w.Representation else None
            if rep is None or not rep.Items:
                continue
            solid = rep.Items[0]
            profile = solid.SweptArea
            if not profile.is_a("IfcRectangleProfileDef"):
                continue
            out[(round(profile.XDim, 4), round(profile.YDim, 4), round(solid.Depth, 4))] = True
        return out

    legacy_dims = _rect_dims(m_l)
    param_dims = _rect_dims(m_p)
    # The exact set of dimension tuples should match across both builds —
    # element-wall geometry is identical, only IfcWall.Name differs (legacy
    # uses props.name "Wall N", parametric uses elem.id "w-n"). That's a
    # documented Slice 4 cosmetic divergence.
    assert legacy_dims == param_dims
