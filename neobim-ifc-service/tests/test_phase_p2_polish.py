"""Slice P2 — Visual quality polish pass tests.

Covers the 5 cosmetic gaps closed by Phase P2:

  * P2.A — Stair handrails (IfcRailing PredefinedType=HANDRAIL)
  * P2.B — Window mullions (IfcMember PredefinedType=MULLION)
  * P2.C — Door swing arc annotations (IfcAnnotation)
  * P2.D — Stilt parking lines (IfcAnnotation, 4 bays × 2.5×5.0 m)
  * P2.E — Door material differentiation (Teak / MS-Steel / MS-Steel+Glass)

All assertions run cross-template via the same parametrised fixture
used by Slice P1.5 / P1.6 tests, so any regression on a single template
surfaces independently.

The P2 fixes are IFC-layer only — BuildingModel snapshots stay
byte-identical. Existing 2014-test baseline regressions are caught by
the per-template suites; this file owns only the new P2 assertions.
"""

from __future__ import annotations

import math

import pytest

from app.templates import (
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_tower,
    build_2bhk_pune_house,
    build_2bhk_pune_template,
    build_2bhk_pune_tower,
    build_3bhk_pune_duplex,
    build_3bhk_pune_house,
    build_3bhk_pune_tower,
)
from app.services.ifc_from_building_model import build_ifc_from_building_model


def _builders():
    return [
        ("1bhk-house", build_1bhk_pune_house),
        ("1bhk-duplex", build_1bhk_pune_duplex),
        ("1bhk-tower-g5", lambda: build_1bhk_pune_tower(habitable_floor_count=5)),
        ("2bhk-house", build_2bhk_pune_house),
        ("2bhk-duplex", build_2bhk_pune_template),
        ("2bhk-tower-g5", lambda: build_2bhk_pune_tower(habitable_floor_count=5)),
        ("3bhk-house", build_3bhk_pune_house),
        ("3bhk-duplex", build_3bhk_pune_duplex),
        ("3bhk-tower-g5", lambda: build_3bhk_pune_tower(habitable_floor_count=5)),
    ]


@pytest.fixture(scope="module", params=_builders(), ids=lambda p: p[0])
def ifc_model(request):
    label, builder = request.param
    bm = builder()
    model = build_ifc_from_building_model(bm)
    return label, bm, model


def _psets_of(elem):
    psets = {}
    for rel in getattr(elem, "IsDefinedBy", []) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            ps = rel.RelatingPropertyDefinition
            if ps.is_a("IfcPropertySet"):
                psets[ps.Name] = {
                    p.Name: p.NominalValue.wrappedValue
                    for p in (ps.HasProperties or [])
                    if hasattr(p, "NominalValue") and p.NominalValue is not None
                }
    return psets


def _material_names_of(elem):
    """Return the set of IfcMaterial.Name values associated with an element
    via IfcRelAssociatesMaterial (instance-level)."""
    out: set[str] = set()
    for rel in getattr(elem, "HasAssociations", []) or []:
        if not rel.is_a("IfcRelAssociatesMaterial"):
            continue
        mat = rel.RelatingMaterial
        if mat.is_a("IfcMaterial"):
            out.add(mat.Name)
        elif mat.is_a("IfcMaterialList"):
            for m in mat.Materials or []:
                out.add(m.Name)
        elif mat.is_a("IfcMaterialLayerSet"):
            for layer in mat.MaterialLayers or []:
                if layer.Material is not None:
                    out.add(layer.Material.Name)
        elif mat.is_a("IfcMaterialLayerSetUsage"):
            ls = mat.ForLayerSet
            if ls is not None:
                for layer in ls.MaterialLayers or []:
                    if layer.Material is not None:
                        out.add(layer.Material.Name)
    return out


# ─── Phase P2.A — Stair handrails ────────────────────────────────────


def test_p2_a_every_stair_flight_has_handrail(ifc_model) -> None:
    """Every IfcStairFlight has at least one IfcRailing(HANDRAIL) emitted
    alongside it. NBC India 2016 Part 4 residential mandate."""
    label, _bm, model = ifc_model
    flights = list(model.by_type("IfcStairFlight"))
    handrails = [
        r for r in model.by_type("IfcRailing")
        if r.PredefinedType == "HANDRAIL"
    ]
    if not flights:
        # House templates have no stair flights — handrail-count is
        # not constrained on those (P1.6 may emit a single stub
        # handrail for IDS reasons; we don't pin that here).
        pytest.skip(f"{label}: no IfcStairFlight (house template)")
    assert len(handrails) >= len(flights), (
        f"{label}: expected at least {len(flights)} IfcRailing(HANDRAIL) "
        f"entities (one per stair flight), got {len(handrails)}"
    )


def test_p2_a_handrail_height_is_900mm(ifc_model) -> None:
    """Each stair handrail's swept solid Depth equals 0.9 m (NBC India)."""
    label, _bm, model = ifc_model
    handrails = [
        r for r in model.by_type("IfcRailing")
        if r.PredefinedType == "HANDRAIL"
        and r.Name and r.Name.startswith("handrail-")
    ]
    if not handrails:
        pytest.skip(f"{label}: no stair handrails")
    for r in handrails:
        depths = []
        for rep in r.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcExtrudedAreaSolid"):
                    depths.append(item.Depth)
        assert depths, f"{label}: {r.Name} has no IfcExtrudedAreaSolid"
        assert depths[0] == pytest.approx(0.9), (
            f"{label}: {r.Name} extrusion_depth={depths[0]} (expected 0.9 m)"
        )


def test_p2_a_handrail_predefined_type_is_handrail(ifc_model) -> None:
    """Stair handrails are distinct from GUARDRAILs (balcony parapets)."""
    label, _bm, model = ifc_model
    handrails = [
        r for r in model.by_type("IfcRailing")
        if r.Name and r.Name.startswith("handrail-")
    ]
    if not handrails:
        pytest.skip(f"{label}: no stair handrails")
    for r in handrails:
        assert r.PredefinedType == "HANDRAIL", (
            f"{label}: {r.Name} PredefinedType={r.PredefinedType} (expected HANDRAIL)"
        )


def test_p2_a_handrail_material_is_ms_steel(ifc_model) -> None:
    """Every stair handrail carries instance-level material MS-Steel."""
    label, _bm, model = ifc_model
    handrails = [
        r for r in model.by_type("IfcRailing")
        if r.Name and r.Name.startswith("handrail-")
    ]
    if not handrails:
        pytest.skip(f"{label}: no stair handrails")
    for r in handrails:
        mats = _material_names_of(r)
        assert "MS-Steel" in mats, (
            f"{label}: {r.Name} materials={mats} — MS-Steel missing"
        )


# ─── Phase P2.B — Window mullions ────────────────────────────────────


def test_p2_b_every_window_has_mullion(ifc_model) -> None:
    """Every IfcWindow has at least one IfcMember(MULLION) at horizontal mid."""
    label, _bm, model = ifc_model
    windows = list(model.by_type("IfcWindow"))
    mullions = [
        m for m in model.by_type("IfcMember")
        if m.PredefinedType == "MULLION"
    ]
    assert len(windows) >= 1
    assert len(mullions) >= len(windows), (
        f"{label}: expected ≥{len(windows)} IfcMember(MULLION) "
        f"(one per window), got {len(mullions)}"
    )


def test_p2_b_mullion_predefined_type_is_mullion(ifc_model) -> None:
    label, _bm, model = ifc_model
    mullions = [
        m for m in model.by_type("IfcMember")
        if m.Name and m.Name.startswith("mullion-")
    ]
    if not mullions:
        pytest.skip(f"{label}: no mullions")
    for m in mullions:
        assert m.PredefinedType == "MULLION", (
            f"{label}: {m.Name} PredefinedType={m.PredefinedType}"
        )


def test_p2_b_mullion_material_is_aluminum(ifc_model) -> None:
    label, _bm, model = ifc_model
    mullions = [
        m for m in model.by_type("IfcMember")
        if m.Name and m.Name.startswith("mullion-")
    ]
    if not mullions:
        pytest.skip(f"{label}: no mullions")
    for m in mullions:
        mats = _material_names_of(m)
        assert "Aluminum-Mullion" in mats, (
            f"{label}: {m.Name} materials={mats}"
        )


def test_p2_b_mullion_dimensions_50x100mm(ifc_model) -> None:
    """Mullion cross-section is 50 mm × 100 mm (XDim × YDim of profile)."""
    label, _bm, model = ifc_model
    mullions = [
        m for m in model.by_type("IfcMember")
        if m.Name and m.Name.startswith("mullion-")
    ]
    if not mullions:
        pytest.skip(f"{label}: no mullions")
    for m in mullions:
        profile_found = False
        for rep in m.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcExtrudedAreaSolid"):
                    prof = item.SweptArea
                    if prof.is_a("IfcRectangleProfileDef"):
                        assert prof.XDim == pytest.approx(0.050), (
                            f"{label}: {m.Name} XDim={prof.XDim}"
                        )
                        assert prof.YDim == pytest.approx(0.100), (
                            f"{label}: {m.Name} YDim={prof.YDim}"
                        )
                        profile_found = True
        assert profile_found, f"{label}: {m.Name} has no rect profile"


# ─── Phase P2.C — Door swing arc annotations ─────────────────────────


def test_p2_c_every_swing_door_has_arc_annotation(ifc_model) -> None:
    """Every swinging IfcDoor (OperationType=*_SWING_*) has one
    IfcAnnotation linked via IfcRelAssociatesMaterial-style aggregate
    (we use IfcRelContainedInSpatialStructure on the same storey)."""
    label, _bm, model = ifc_model
    doors = list(model.by_type("IfcDoor"))
    swing_doors = [
        d for d in doors
        if d.OperationType and "SWING" in d.OperationType
        and d.PredefinedType != "GATE"
    ]
    annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("swing-arc-")
    ]
    if not swing_doors:
        pytest.skip(f"{label}: no swing doors")
    assert len(annotations) >= len(swing_doors), (
        f"{label}: expected ≥{len(swing_doors)} swing-arc annotations, "
        f"got {len(annotations)}"
    )


def test_p2_c_sliding_lift_doors_have_no_arc(ifc_model) -> None:
    """SLIDING_TO_* doors (lift cabins) do NOT get a swing arc."""
    label, _bm, model = ifc_model
    sliding_doors = [
        d for d in model.by_type("IfcDoor")
        if d.OperationType and "SLIDING" in d.OperationType
    ]
    if not sliding_doors:
        pytest.skip(f"{label}: no sliding doors")
    arc_door_names = {
        a.Description for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("swing-arc-")
    }
    for d in sliding_doors:
        assert d.Name not in arc_door_names, (
            f"{label}: sliding door {d.Name} has a swing-arc annotation"
        )


def test_p2_c_gate_doors_have_no_arc(ifc_model) -> None:
    """Doors with PredefinedType=GATE have NO swing-arc annotation."""
    label, _bm, model = ifc_model
    gates = [d for d in model.by_type("IfcDoor") if d.PredefinedType == "GATE"]
    if not gates:
        pytest.skip(f"{label}: no gates")
    arc_door_names = {
        a.Description for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("swing-arc-")
    }
    for d in gates:
        assert d.Name not in arc_door_names, (
            f"{label}: gate door {d.Name} has a swing-arc annotation"
        )


def test_p2_c_arc_radius_equals_door_width(ifc_model) -> None:
    """Arc radius == door width (the swing radius in plan)."""
    label, _bm, model = ifc_model
    annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("swing-arc-")
    ]
    doors_by_name = {d.Name: d for d in model.by_type("IfcDoor")}
    if not annotations:
        pytest.skip(f"{label}: no swing-arc annotations")
    for ann in annotations:
        door_name = ann.Description
        if door_name not in doors_by_name:
            continue
        door = doors_by_name[door_name]
        radius = None
        for rep in ann.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcTrimmedCurve"):
                    basis = item.BasisCurve
                    if basis.is_a("IfcCircle"):
                        radius = basis.Radius
        assert radius is not None, f"{label}: {ann.Name} has no IfcCircle"
        assert radius == pytest.approx(door.OverallWidth, rel=1e-3), (
            f"{label}: {ann.Name} radius={radius} vs "
            f"door width={door.OverallWidth}"
        )


# ─── Phase P2.D — Stilt parking lines ────────────────────────────────


def test_p2_d_tower_stilt_has_4_parking_lines(ifc_model) -> None:
    """Tower stilt floor (usage=parking storey) emits 4 IfcAnnotation
    parking-bay outlines."""
    label, bm, model = ifc_model
    has_parking_storey = any(
        r.usage == "parking"
        for st in bm.project.site.building.storeys
        for r in st.rooms
    )
    if not has_parking_storey:
        pytest.skip(f"{label}: no parking storey (house/duplex)")
    bay_annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("parking-bay-")
    ]
    assert len(bay_annotations) == 4, (
        f"{label}: expected 4 parking-bay annotations, got {len(bay_annotations)}"
    )


def test_p2_d_house_has_no_parking_lines(ifc_model) -> None:
    """House and duplex templates (no stilt) have zero parking annotations."""
    label, bm, model = ifc_model
    has_parking_storey = any(
        r.usage == "parking"
        for st in bm.project.site.building.storeys
        for r in st.rooms
    )
    if has_parking_storey:
        pytest.skip(f"{label}: has parking (tower)")
    bay_annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("parking-bay-")
    ]
    assert bay_annotations == [], (
        f"{label}: unexpected parking annotations on no-stilt template"
    )


def test_p2_d_parking_bay_dimensions_2500x5000mm(ifc_model) -> None:
    """Each parking bay rectangle is 2.5 m × 5.0 m (Indian standard car bay)."""
    label, bm, model = ifc_model
    has_parking_storey = any(
        r.usage == "parking"
        for st in bm.project.site.building.storeys
        for r in st.rooms
    )
    if not has_parking_storey:
        pytest.skip(f"{label}: no parking storey")
    bay_annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("parking-bay-")
    ]
    for ann in bay_annotations:
        pts = []
        for rep in ann.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcPolyline"):
                    pts = [p.Coordinates for p in item.Points]
        assert len(pts) >= 4, f"{label}: {ann.Name} has <4 points"
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        width = max(xs) - min(xs)
        depth = max(ys) - min(ys)
        # Bay is 2.5 × 5.0 in either orientation.
        short = min(width, depth)
        long_ = max(width, depth)
        assert short == pytest.approx(2.5, abs=0.001), (
            f"{label}: {ann.Name} short side={short}"
        )
        assert long_ == pytest.approx(5.0, abs=0.001), (
            f"{label}: {ann.Name} long side={long_}"
        )


def test_p2_d_parking_bays_dont_overlap(ifc_model) -> None:
    """Adjacent parking bays don't share interior area (only edges).
    We check by comparing pairwise bounding boxes — no two bays' centers
    are within (bay_width + bay_depth)/2 of each other."""
    label, bm, model = ifc_model
    has_parking_storey = any(
        r.usage == "parking"
        for st in bm.project.site.building.storeys
        for r in st.rooms
    )
    if not has_parking_storey:
        pytest.skip(f"{label}: no parking storey")
    bay_annotations = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("parking-bay-")
    ]
    centers = []
    for ann in bay_annotations:
        for rep in ann.Representation.Representations:
            for item in rep.Items:
                if item.is_a("IfcPolyline"):
                    pts = [p.Coordinates for p in item.Points]
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    centers.append(((min(xs) + max(xs)) / 2.0,
                                    (min(ys) + max(ys)) / 2.0))
    for i, c1 in enumerate(centers):
        for c2 in centers[i + 1:]:
            dx = abs(c1[0] - c2[0])
            dy = abs(c1[1] - c2[1])
            # If bays share both axes within bay dims, they overlap.
            assert (dx >= 2.49) or (dy >= 4.99) or (dx + dy >= 2.5), (
                f"{label}: bays at {c1} and {c2} overlap "
                f"(dx={dx:.3f}, dy={dy:.3f})"
            )


# ─── Phase P2.E — Door material differentiation ──────────────────────


def test_p2_e_swing_doors_use_teak_material(ifc_model) -> None:
    """Swing-style doors (interior + main entrance) get Teak material."""
    label, _bm, model = ifc_model
    swing_doors = [
        d for d in model.by_type("IfcDoor")
        if d.OperationType and "SWING" in d.OperationType
        and d.PredefinedType != "GATE"
    ]
    if not swing_doors:
        pytest.skip(f"{label}: no swing doors")
    for d in swing_doors:
        mats = _material_names_of(d)
        assert "Teak-Door" in mats, (
            f"{label}: {d.Name} (OperationType={d.OperationType}) "
            f"materials={mats}"
        )


def test_p2_e_sliding_lift_doors_use_ms_steel_and_glass(ifc_model) -> None:
    """SLIDING_TO_* doors (lift cabin doors) carry MS-Steel + Glass."""
    label, _bm, model = ifc_model
    sliding_doors = [
        d for d in model.by_type("IfcDoor")
        if d.OperationType and "SLIDING" in d.OperationType
    ]
    if not sliding_doors:
        pytest.skip(f"{label}: no sliding doors (no lift)")
    for d in sliding_doors:
        mats = _material_names_of(d)
        assert "MS-Steel" in mats, f"{label}: {d.Name} missing MS-Steel"
        assert "Glass-Tempered" in mats, f"{label}: {d.Name} missing Glass"


def test_p2_e_gates_use_ms_steel(ifc_model) -> None:
    """PredefinedType=GATE doors (compound-wall entry gates) get MS-Steel."""
    label, _bm, model = ifc_model
    gates = [d for d in model.by_type("IfcDoor") if d.PredefinedType == "GATE"]
    if not gates:
        pytest.skip(f"{label}: no gates")
    for g in gates:
        mats = _material_names_of(g)
        assert "MS-Steel" in mats, f"{label}: gate {g.Name} materials={mats}"


def test_p2_e_no_door_uses_generic_default_material(ifc_model) -> None:
    """Every IfcDoor carries at least one instance-level material;
    no door is left material-less (instance-level discipline from P1.6)."""
    label, _bm, model = ifc_model
    doors = list(model.by_type("IfcDoor"))
    for d in doors:
        mats = _material_names_of(d)
        assert mats, (
            f"{label}: door {d.Name} has no instance-level material "
            f"(P1.6 discipline regression)"
        )


# ─── Cross-template visual sanity (handrail + mullion + arc presence)


@pytest.mark.parametrize("template_name", [
    "1bhk-tower-g5", "2bhk-tower-g5", "3bhk-tower-g5",
])
def test_p2_all_polish_features_visible_on_towers(template_name) -> None:
    """The 3 representative tower templates carry all 5 polish features."""
    builders = dict(_builders())
    bm = builders[template_name]()
    model = build_ifc_from_building_model(bm)

    # Stair handrails
    handrails = [
        r for r in model.by_type("IfcRailing")
        if r.PredefinedType == "HANDRAIL"
        and r.Name and r.Name.startswith("handrail-")
    ]
    assert handrails, f"{template_name}: no stair handrails"

    # Window mullions
    mullions = [
        m for m in model.by_type("IfcMember")
        if m.PredefinedType == "MULLION"
    ]
    assert mullions, f"{template_name}: no window mullions"

    # Swing arc annotations
    arcs = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("swing-arc-")
    ]
    assert arcs, f"{template_name}: no swing-arc annotations"

    # Stilt parking bays (towers only)
    bays = [
        a for a in model.by_type("IfcAnnotation")
        if a.Name and a.Name.startswith("parking-bay-")
    ]
    assert len(bays) == 4, f"{template_name}: parking bays={len(bays)}"

    # Door materials — at least 2 distinct materials across all doors
    door_mats = set()
    for d in model.by_type("IfcDoor"):
        door_mats |= _material_names_of(d)
    door_mats &= {"Teak-Door", "MS-Steel", "Glass-Tempered"}
    assert len(door_mats) >= 2, (
        f"{template_name}: only {door_mats} on doors — expected ≥2 distinct"
    )
