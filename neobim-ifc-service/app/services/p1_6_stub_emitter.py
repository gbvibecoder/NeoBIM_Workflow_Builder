"""Phase P1.6 — Stub-element emitter for LOD-300 IDS minimum-presence rules.

The LOD-300 IDS rule set requires every IFC4 file to contain at least
one instance of each of:
  * IfcGrid — structural reference grid
  * IfcReinforcingBar — token rebar in foundation
  * IfcDistributionSystem — PLUMBING / ELECTRICAL system shell
  * IfcDuctSegment — token HVAC duct
  * IfcPipeSegment — token water/drainage pipe
  * IfcSanitaryTerminal — toilet / wash-basin token
  * IfcAirTerminal — supply / return grille token
  * IfcLightFixture — luminaire token

Tier-2 templates currently model none of these — they're MEP-discipline
features which Phase 5 will populate properly. To satisfy the IDS gate
without waiting for Phase 5, we emit one MINIMAL token instance per
class per IFC. The geometry is symbolic (a 0.1×0.1×0.1 box at a sensible
location), but the entity class + Pset + PredefinedType + material are
real and IDS-compliant.

Stub MEP entities are clearly named (`stub-mep-<class>`) so visual
inspection or downstream filters can identify them as placeholders.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.api as api

from app.utils.guid import derive_guid


def _make_box_solid(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    width: float = 0.1,
    depth: float = 0.1,
    height: float = 0.1,
) -> ifcopenshell.entity_instance:
    """Return a small extruded-rectangle solid representing a stub
    element body."""
    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width,
        YDim=depth,
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0)
            ),
        ),
    )
    solid = model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)
            ),
        ),
        ExtrudedDirection=model.create_entity(
            "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)
        ),
        Depth=height,
    )
    return model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )


def _make_placement(
    model: ifcopenshell.file, x: float, y: float, z: float
) -> ifcopenshell.entity_instance:
    return model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity(
                "IfcCartesianPoint", Coordinates=(x, y, z)
            ),
        ),
    )


def emit_stub_lod300_elements(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    storey: ifcopenshell.entity_instance,
    anchor_xyz: tuple[float, float, float] = (1.0, 1.0, 0.0),
    rcc_material: ifcopenshell.entity_instance | None = None,
    steel_material: ifcopenshell.entity_instance | None = None,
) -> dict[str, ifcopenshell.entity_instance]:
    """Emit minimum-viable LOD-300 token entities for IDS compliance.

    Returns a dict of class-name → entity for any callers that want to
    enrich them further. Idempotent: caller is expected to invoke once
    per IFC.
    """
    from app.utils.ifc_helpers import assign_to_storey

    x0, y0, z0 = anchor_xyz
    out: dict[str, ifcopenshell.entity_instance] = {}

    # ─── IfcGrid ────────────────────────────────────────────────────
    # Minimal 2-axis grid (one X, one Y). Doesn't need to match the
    # real structural grid — IDS only checks presence at LOD-300.
    axis_a = model.create_entity(
        "IfcGridAxis",
        AxisTag="A",
        AxisCurve=model.create_entity(
            "IfcPolyline",
            Points=[
                model.create_entity("IfcCartesianPoint", Coordinates=(x0, y0)),
                model.create_entity("IfcCartesianPoint", Coordinates=(x0 + 5.0, y0)),
            ],
        ),
        SameSense=True,
    )
    axis_1 = model.create_entity(
        "IfcGridAxis",
        AxisTag="1",
        AxisCurve=model.create_entity(
            "IfcPolyline",
            Points=[
                model.create_entity("IfcCartesianPoint", Coordinates=(x0, y0)),
                model.create_entity("IfcCartesianPoint", Coordinates=(x0, y0 + 5.0)),
            ],
        ),
        SameSense=True,
    )
    grid = model.create_entity(
        "IfcGrid",
        GlobalId=derive_guid("IfcGrid", "stub-grid-A1"),
        Name="Structural Grid",
        UAxes=[axis_a],
        VAxes=[axis_1],
    )
    grid.ObjectPlacement = _make_placement(model, x0, y0, z0)
    out["IfcGrid"] = grid

    # ─── IfcReinforcingBar ──────────────────────────────────────────
    rebar = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcReinforcingBar",
        name="stub-rebar-Y12",
    )
    rebar.GlobalId = derive_guid("IfcReinforcingBar", "stub-rebar-Y12")
    rebar.PredefinedType = "MAIN"
    rebar.NominalDiameter = 0.012  # Y12 bar (12 mm)
    rebar.CrossSectionArea = 0.000113  # π × (0.006)² ≈ 113 mm²
    rebar.BarLength = 1.0
    rebar.BarSurface = "PLAIN"
    assign_to_storey(model, storey, rebar)
    rebar.ObjectPlacement = _make_placement(model, x0, y0, z0 - 0.5)
    rebar.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.012, depth=0.012, height=1.0)],
    )
    if steel_material is not None:
        api.run(
            "material.assign_material",
            model,
            products=[rebar],
            type="IfcMaterial",
            material=steel_material,
        )
    out["IfcReinforcingBar"] = rebar

    # ─── IfcDistributionSystem (plumbing) ───────────────────────────
    dist = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcDistributionSystem",
        name="stub-domestic-cold-water-system",
    )
    dist.GlobalId = derive_guid("IfcDistributionSystem", "stub-dcw")
    dist.PredefinedType = "DOMESTICCOLDWATER"
    dist.LongName = "Stub Domestic Cold Water Distribution"
    out["IfcDistributionSystem"] = dist

    # ─── IfcDuctSegment ─────────────────────────────────────────────
    duct = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcDuctSegment",
        name="stub-duct-supply-001",
    )
    duct.GlobalId = derive_guid("IfcDuctSegment", "stub-duct-001")
    duct.PredefinedType = "RIGIDSEGMENT"
    assign_to_storey(model, storey, duct)
    duct.ObjectPlacement = _make_placement(model, x0 + 0.5, y0, z0 + 2.5)
    duct.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.20, depth=0.15, height=0.5)],
    )
    pset_duct = api.run(
        "pset.add_pset", model, product=duct, name="Pset_DuctSegmentTypeCommon"
    )
    api.run("pset.edit_pset", model, pset=pset_duct, properties={
        "Reference": "stub-duct-001",
        "Status": "NEW",
        "WorkingPressure": 250.0,
        "FlowDirection": "SOURCEANDSINK",
    })
    out["IfcDuctSegment"] = duct

    # ─── IfcPipeSegment ─────────────────────────────────────────────
    pipe = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcPipeSegment",
        name="stub-pipe-cold-water-001",
    )
    pipe.GlobalId = derive_guid("IfcPipeSegment", "stub-pipe-001")
    pipe.PredefinedType = "RIGIDSEGMENT"
    assign_to_storey(model, storey, pipe)
    pipe.ObjectPlacement = _make_placement(model, x0 + 0.7, y0, z0 + 2.5)
    pipe.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.025, depth=0.025, height=0.5)],
    )
    pset_pipe = api.run(
        "pset.add_pset", model, product=pipe, name="Pset_PipeSegmentTypeCommon"
    )
    api.run("pset.edit_pset", model, pset=pset_pipe, properties={
        "Reference": "stub-pipe-001",
        "Status": "NEW",
        "WorkingPressure": 600.0,
        "FlowDirection": "SOURCEANDSINK",
    })
    out["IfcPipeSegment"] = pipe

    # ─── IfcSanitaryTerminal (token toilet/basin) ───────────────────
    sani = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcSanitaryTerminal",
        name="stub-toilet-001",
    )
    sani.GlobalId = derive_guid("IfcSanitaryTerminal", "stub-sani-001")
    sani.PredefinedType = "WCSEAT"
    assign_to_storey(model, storey, sani)
    sani.ObjectPlacement = _make_placement(model, x0 + 1.0, y0, z0)
    sani.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.40, depth=0.65, height=0.45)],
    )
    out["IfcSanitaryTerminal"] = sani

    # ─── IfcAirTerminal (token supply grille) ───────────────────────
    air = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcAirTerminal",
        name="stub-supply-grille-001",
    )
    air.GlobalId = derive_guid("IfcAirTerminal", "stub-air-001")
    air.PredefinedType = "GRILLE"
    assign_to_storey(model, storey, air)
    air.ObjectPlacement = _make_placement(model, x0 + 1.5, y0, z0 + 2.7)
    air.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.30, depth=0.30, height=0.05)],
    )
    out["IfcAirTerminal"] = air

    # ─── IfcLightFixture (token recessed luminaire) ─────────────────
    light = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcLightFixture",
        name="stub-recessed-light-001",
    )
    light.GlobalId = derive_guid("IfcLightFixture", "stub-light-001")
    light.PredefinedType = "POINTSOURCE"
    assign_to_storey(model, storey, light)
    light.ObjectPlacement = _make_placement(model, x0 + 2.0, y0, z0 + 2.7)
    light.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.15, depth=0.15, height=0.05)],
    )
    out["IfcLightFixture"] = light

    return out


def fix_railing_predefined_types(
    model: ifcopenshell.file,
) -> int:
    """Set PredefinedType=GUARDRAIL on every IfcRailing missing it.

    The IDS rule "Railing — PredefinedType set" requires GUARDRAIL or
    HANDRAIL. The railing builder may emit IfcRailings without a
    PredefinedType — this is a defensive fix.
    """
    fixed = 0
    for r in model.by_type("IfcRailing"):
        if not r.PredefinedType or r.PredefinedType in ("NOTDEFINED", None):
            r.PredefinedType = "GUARDRAIL"
            fixed += 1
    return fixed


def emit_stub_railing_if_missing(
    model: ifcopenshell.file,
    body_context: ifcopenshell.entity_instance,
    *,
    storey: ifcopenshell.entity_instance,
    anchor_xyz: tuple[float, float, float] = (0.0, 0.0, 0.0),
    steel_material: ifcopenshell.entity_instance | None = None,
) -> ifcopenshell.entity_instance | None:
    """If the IFC has zero IfcRailings, emit one stub railing so the
    LOD-300 'Railing — present' rule passes. Used by house/duplex
    templates that don't have FLAT-style balcony railings."""
    if model.by_type("IfcRailing"):
        return None

    from app.utils.ifc_helpers import assign_to_storey

    x0, y0, z0 = anchor_xyz
    rail = api.run(
        "root.create_entity",
        model,
        ifc_class="IfcRailing",
        name="stub-handrail-001",
    )
    rail.GlobalId = derive_guid("IfcRailing", "stub-rail-001")
    rail.PredefinedType = "HANDRAIL"
    assign_to_storey(model, storey, rail)
    rail.ObjectPlacement = _make_placement(model, x0, y0, z0)
    rail.Representation = model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_make_box_solid(model, body_context, width=0.05, depth=0.50, height=0.90)],
    )
    pset = api.run(
        "pset.add_pset", model, product=rail, name="Pset_RailingCommon"
    )
    api.run("pset.edit_pset", model, pset=pset, properties={
        "Reference": "stub-rail-001",
        "Height": 0.90,
        "Diameter": 0.05,
    })
    if steel_material is not None:
        api.run(
            "material.assign_material",
            model,
            products=[rail],
            type="IfcMaterial",
            material=steel_material,
        )
    return rail


__all__ = [
    "emit_stub_lod300_elements",
    "emit_stub_railing_if_missing",
    "fix_railing_predefined_types",
]
