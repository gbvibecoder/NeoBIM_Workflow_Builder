"""Slice T2.0.4 — stair clearance + lift cabin visual-correctness tests.

Two layers of regression guard for the visible-IFC fixes shipped in
this slice:

* **Phase A — stair shaft clearance** (3 tests). Pins that
  `STAIR_FLIGHT_CLEARANCE_M = 0.150` lateral inset is applied inside
  `create_stair_parametric` so every IfcStairFlight clears at least
  140 mm from the lateral shaft walls (south + north). Run-direction
  overhang is intentionally out of scope for this slice — the fix
  there requires a BuildingModel-level edit to plan_polygon length.

* **Phase B — lift cabin + sliding doors** (lands in §B; this file is
  the stable home).

Tests run against the dispatcher-built BuildingModel → IFC pipeline
already exercised by the P1.6 inheritance suite. We pick the
2BHK G+5 tower as the canonical fixture: smallest tower with all 6
storeys (stilt + 5 habitable + roof), and the same template Govind
inspected in the screenshots that motivated this slice.
"""

from __future__ import annotations

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")
import ifcopenshell.geom  # noqa: E402

from app.services.design_agent import (  # noqa: E402
    TemplateId,
    TemplateParameters,
    dispatch_template,
)
from app.services.lift_cabin_emitter import (  # noqa: E402
    CABIN_DEPTH_M,
    CABIN_HEIGHT_M,
    CABIN_WIDTH_M,
    LIFT_CABIN_MATERIAL_NAME,
    LIFT_CAPACITY_PEOPLE,
    LIFT_CAPACITY_WEIGHT_KG,
)
from app.services.stair_builder import STAIR_FLIGHT_CLEARANCE_M  # noqa: E402
from scripts.export_2bhk_pune_to_ifc import (  # noqa: E402
    build_ifc_from_building_model,
)


# ─── Fixtures + helpers ──────────────────────────────────────────────


@pytest.fixture(scope="module")
def tower_2bhk_g5_ifc():
    """Build a 2BHK G+5 tower BuildingModel and export to IFC4 once
    per module run. The IFC sits in memory only — no temp file."""
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=7.32,
            plot_length_m=15.24,
            habitable_floor_count=5,
        ),
    )
    return build_ifc_from_building_model(bm)


def _world_bbox(entity, settings):
    """World-space bbox (x_min, y_min, z_min, x_max, y_max, z_max) or None."""
    try:
        shape = ifcopenshell.geom.create_shape(settings, entity)
    except Exception:
        return None
    verts = shape.geometry.verts
    if not verts:
        return None
    xs = verts[0::3]
    ys = verts[1::3]
    zs = verts[2::3]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def _axis_separation(amin, amax, bmin, bmax):
    """Signed gap on one axis: positive = clear, zero = touching,
    negative = penetration."""
    if amax < bmin:
        return bmin - amax
    if bmax < amin:
        return amin - bmax
    return -(min(amax, bmax) - max(amin, bmin))


def _flight_lateral_walls(flight_bbox, wall_bboxes):
    """Walls that bound the flight's lateral (Y) footprint — south +
    north shaft partitions. These are the walls the T2.0.4.A inset
    targets.

    Identification (in our run=X convention):
    1. Wall must overlap the flight on the run-axis (X) so it sits in
       front of / behind the lateral edge.
    2. Wall must overlap the flight on the storey Z-band.
    3. Wall must NOT fully enclose the flight's Y range — that's the
       signature of a run-direction wall (e.g. the stair/lift
       partition or the building's external east/west walls), which
       runs parallel to the flight and is NOT what the inset targets.
    """
    fx0, fy0, fz0, fx1, fy1, fz1 = flight_bbox
    laterals = []
    for w, wbb in wall_bboxes:
        wx0, wy0, wz0, wx1, wy1, wz1 = wbb
        x_overlap = max(0.0, min(fx1, wx1) - max(fx0, wx0))
        z_overlap = max(0.0, min(fz1, wz1) - max(fz0, wz0))
        if x_overlap < 0.1 or z_overlap < 0.1:
            continue
        # Wall fully encloses flight on Y → run-direction wall, not
        # lateral. Tolerance 10 mm.
        encloses_y = (wy0 <= fy0 + 0.01) and (wy1 >= fy1 - 0.01)
        if encloses_y:
            continue
        laterals.append((w, wbb))
    return laterals


# ─── Phase A — stair clearance ───────────────────────────────────────


def test_stair_flight_clearance_constant_pinned() -> None:
    """STAIR_FLIGHT_CLEARANCE_M is the spec-mandated 150 mm. Drift
    here would silently change the inset and the lateral-clearance
    assertion below. Tunable but pinned — change deliberately."""
    assert STAIR_FLIGHT_CLEARANCE_M == 0.150, (
        f"STAIR_FLIGHT_CLEARANCE_M = {STAIR_FLIGHT_CLEARANCE_M} m; "
        f"expected 0.150 (spec §3 Phase A)"
    )


def test_stair_flight_lateral_clearance_from_shaft_walls(
    tower_2bhk_g5_ifc,
) -> None:
    """Every IfcStairFlight clears at least 140 mm from each lateral
    shaft wall (10 mm tolerance below the 150 mm inset).

    Lateral walls are those that overlap the flight on the run-axis
    AND on the storey Z-band — i.e., the south + north shaft walls.
    Run-axis walls (front + back) are NOT tested here: their clearance
    depends on plan_polygon length vs riser_count × tread_depth which
    is a BuildingModel concern, deferred to a future slice.
    """
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    model = tower_2bhk_g5_ifc
    flights = model.by_type("IfcStairFlight")
    walls = model.by_type("IfcWall")
    assert len(flights) >= 1, "expected at least one IfcStairFlight"

    wall_bboxes = []
    for w in walls:
        bb = _world_bbox(w, settings)
        if bb is not None:
            wall_bboxes.append((w, bb))

    failures: list[str] = []
    for flight in flights:
        fbb = _world_bbox(flight, settings)
        if fbb is None:
            continue
        fy0, fy1 = fbb[1], fbb[4]
        for w, wbb in _flight_lateral_walls(fbb, wall_bboxes):
            wy0, wy1 = wbb[1], wbb[4]
            gap_y = _axis_separation(fy0, fy1, wy0, wy1)
            if gap_y < 0.140:  # 10 mm tolerance below the 150 mm inset
                failures.append(
                    f"flight {flight.Name or flight.GlobalId[:8]} → "
                    f"wall {w.Name or w.GlobalId[:8]}: "
                    f"lateral gap_y = {gap_y * 1000:+.1f} mm "
                    f"(need ≥ 140 mm)"
                )

    assert not failures, (
        "stair flight clearance regression — these (flight, wall) pairs "
        "have <140 mm lateral clearance after the T2.0.4.A fix:\n  "
        + "\n  ".join(failures)
    )


def test_stair_flight_width_respects_clearance(tower_2bhk_g5_ifc) -> None:
    """The flight's lateral bbox extent equals
    plan_polygon_min_dim − 2 × CLEARANCE. We can't reach the
    BuildingModel from here (the IFC has been built and serialized),
    but we can verify the flight Y extent is within ±10 mm of the
    expected reduced width — and never exceeds the pre-inset width.

    For 2BHK G+5 the plan_polygon shorter dim is 1.365 m; expected
    width 1.065 m. A regression that drops the inset would surface
    here as Y extent ≈ 1.365 m.
    """
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    model = tower_2bhk_g5_ifc

    expected_width_m = 1.365 - 2.0 * STAIR_FLIGHT_CLEARANCE_M  # 1.065 m
    tolerance_m = 0.010

    flights = model.by_type("IfcStairFlight")
    for flight in flights:
        fbb = _world_bbox(flight, settings)
        if fbb is None:
            continue
        y_extent = fbb[4] - fbb[1]
        assert abs(y_extent - expected_width_m) < tolerance_m, (
            f"flight {flight.Name or flight.GlobalId[:8]}: lateral Y "
            f"extent = {y_extent:.3f} m; expected "
            f"{expected_width_m:.3f} ± {tolerance_m} m (1.365 − 2·{STAIR_FLIGHT_CLEARANCE_M})"
        )


def test_stair_flight_position_respects_clearance(tower_2bhk_g5_ifc) -> None:
    """The flight's lateral start (south edge) is offset by ≥ CLEARANCE
    from the south shaft partition wall. We compute this as: the gap
    between the flight's y_min and the y_max of any wall whose name
    contains 'Lobby' (the south partition between lobby and stair shaft
    in T2.0.3 layout).
    """
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    model = tower_2bhk_g5_ifc

    flights = model.by_type("IfcStairFlight")
    walls = model.by_type("IfcWall")

    # Find the south-side lobby/north-partition walls (their y_max is
    # the south boundary of the stair shaft).
    lobby_walls = [
        w for w in walls
        if w.Name and ("Lobby" in w.Name or "lobby" in w.Name)
    ]
    if not lobby_walls:
        pytest.skip(
            "no Lobby-named walls in 2BHK G+5 fixture — layout drift; "
            "test will need fixture update"
        )

    lobby_y_maxes: list[float] = []
    for w in lobby_walls:
        bb = _world_bbox(w, settings)
        if bb is None:
            continue
        lobby_y_maxes.append(bb[4])
    south_boundary = max(lobby_y_maxes)

    for flight in flights:
        fbb = _world_bbox(flight, settings)
        if fbb is None:
            continue
        flight_south_edge = fbb[1]
        gap = flight_south_edge - south_boundary
        assert gap >= 0.140, (
            f"flight {flight.Name or flight.GlobalId[:8]}: south edge "
            f"y = {flight_south_edge:.3f} m; lobby north boundary "
            f"y = {south_boundary:.3f} m; gap = {gap * 1000:+.1f} mm "
            f"(need ≥ 140 mm per CLEARANCE inset)"
        )


# ─── Phase B — lift cabin (IfcTransportElement) + sliding doors ──────


@pytest.fixture(scope="module")
def tower_3bhk_g5_ifc():
    """3BHK G+5 tower BuildingModel → IFC4 file. The 3BHK G+5 is the
    canonical Phase B fixture — it's what Govind inspected in the
    screenshots that motivated this slice."""
    bm = dispatch_template(
        TemplateId.BHK3_PUNE_TOWER,
        TemplateParameters(
            plot_width_m=11.0,
            plot_length_m=20.0,
            habitable_floor_count=5,
        ),
    )
    return build_ifc_from_building_model(bm)


@pytest.fixture(scope="module")
def house_3bhk_ifc():
    """3BHK Pune house — non-tower, no lift rooms expected."""
    bm = dispatch_template(
        TemplateId.BHK3_PUNE_HOUSE,
        TemplateParameters(plot_width_m=11.0, plot_length_m=20.0),
    )
    return build_ifc_from_building_model(bm)


@pytest.fixture(scope="module")
def duplex_2bhk_ifc():
    """2BHK Pune duplex — non-tower, no lift rooms expected."""
    bm = dispatch_template(
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateParameters(plot_width_m=7.32, plot_length_m=15.24),
    )
    return build_ifc_from_building_model(bm)


def _bbox_of(entity, settings):
    return _world_bbox(entity, settings)


def test_every_lift_shaft_has_transport_element(tower_3bhk_g5_ifc) -> None:
    """One IfcTransportElement per Room with usage='lift'. The 3BHK
    G+5 tower has 6 lift rooms (stilt + 5 habitable + roof = 6
    storeys), so we expect 6 cabin entities."""
    model = tower_3bhk_g5_ifc
    lift_shafts = [
        s for s in model.by_type("IfcSpace") if s.Name and "Lift" in s.Name
    ]
    cabins = list(model.by_type("IfcTransportElement"))
    assert len(cabins) == len(lift_shafts), (
        f"expected one IfcTransportElement per lift shaft "
        f"({len(lift_shafts)}); got {len(cabins)}"
    )


def test_lift_cabin_predefined_type_is_elevator(tower_3bhk_g5_ifc) -> None:
    """Every cabin is PredefinedType=ELEVATOR (not a generic
    transport element)."""
    cabins = list(tower_3bhk_g5_ifc.by_type("IfcTransportElement"))
    assert cabins, "no cabins emitted"
    for c in cabins:
        assert getattr(c, "PredefinedType", None) == "ELEVATOR", (
            f"cabin {c.Name or c.GlobalId[:8]} has PredefinedType="
            f"{getattr(c, 'PredefinedType', None)!r}; expected ELEVATOR"
        )


def test_lift_cabin_material_is_steel_distinct_from_shaft(
    tower_3bhk_g5_ifc,
) -> None:
    """Cabin uses Lift-Cabin-Steel material; this is a distinct
    IfcMaterial entity from the shaft brick walls so the viewer can
    visually differentiate the cabin from the shaft."""
    model = tower_3bhk_g5_ifc
    cabins = list(model.by_type("IfcTransportElement"))
    assert cabins, "no cabins emitted"

    for c in cabins:
        material_names = []
        for rel in getattr(c, "HasAssociations", []) or []:
            if rel.is_a("IfcRelAssociatesMaterial") and rel.RelatingMaterial is not None:
                mat = rel.RelatingMaterial
                if mat.is_a("IfcMaterial"):
                    material_names.append(mat.Name)
        assert LIFT_CABIN_MATERIAL_NAME in material_names, (
            f"cabin {c.Name}: expected {LIFT_CABIN_MATERIAL_NAME!r} in "
            f"materials; got {material_names!r}"
        )

    # Distinctness: at least one wall in the IFC uses a different
    # material (we don't enforce a specific shaft-wall material name —
    # only that they differ from the cabin material).
    wall_materials: set[str] = set()
    for w in model.by_type("IfcWall"):
        for rel in getattr(w, "HasAssociations", []) or []:
            if rel.is_a("IfcRelAssociatesMaterial"):
                mat = rel.RelatingMaterial
                if mat is not None and mat.is_a("IfcMaterialLayerSetUsage"):
                    layer_set = mat.ForLayerSet
                    for layer in (layer_set.MaterialLayers or []):
                        if layer.Material is not None:
                            wall_materials.add(layer.Material.Name)
                elif mat is not None and mat.is_a("IfcMaterial"):
                    wall_materials.add(mat.Name)
    assert wall_materials, "no wall materials found in the IFC"
    assert LIFT_CABIN_MATERIAL_NAME not in wall_materials, (
        f"cabin material {LIFT_CABIN_MATERIAL_NAME!r} also assigned to "
        f"shaft walls — visual distinction lost. wall_materials="
        f"{wall_materials}"
    )


def test_lift_doors_use_sliding_operation(tower_3bhk_g5_ifc) -> None:
    """Every door whose name encodes a lift connection has
    OperationType='SLIDING_TO_LEFT' or 'SLIDING_TO_RIGHT'. The actual
    handedness depends on the BuildingModel's Door.handedness; we
    accept either as long as it's SLIDING."""
    doors = tower_3bhk_g5_ifc.by_type("IfcDoor")
    lift_doors = [d for d in doors if d.Name and "lift" in d.Name.lower()]
    assert lift_doors, "no lift doors found in 3BHK G+5 fixture"
    for d in lift_doors:
        op = getattr(d, "OperationType", None) or ""
        assert "SLIDING" in op, (
            f"door {d.Name}: OperationType={op!r}; expected "
            f"SLIDING_TO_LEFT or SLIDING_TO_RIGHT"
        )


def test_stair_doors_remain_swinging(tower_3bhk_g5_ifc) -> None:
    """Counter-test for the lift-door override: doors that connect
    to the STAIR shaft (corridor / fire egress doors) must STAY as
    SWING. Override should be lift-only, not all core doors."""
    doors = tower_3bhk_g5_ifc.by_type("IfcDoor")
    stair_doors = [
        d for d in doors
        if d.Name and "stair" in d.Name.lower() and "lift" not in d.Name.lower()
    ]
    if not stair_doors:
        pytest.skip("no stair-only doors in fixture")
    for d in stair_doors:
        op = getattr(d, "OperationType", None) or ""
        assert "SWING" in op, (
            f"door {d.Name}: OperationType={op!r}; expected SINGLE_SWING_*"
            f" — stair doors must NOT be sliding (they are corridor / "
            f"fire-egress doors)"
        )


def test_lift_cabin_dimensions(tower_3bhk_g5_ifc) -> None:
    """Cabin geometry is 1.2 × 1.2 × 2.2 m (within ±10 mm tolerance
    on each axis). A regression that drops the dimensions surfaces
    here."""
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    cabins = list(tower_3bhk_g5_ifc.by_type("IfcTransportElement"))
    assert cabins, "no cabins emitted"

    tolerance_m = 0.010
    for c in cabins:
        bb = _bbox_of(c, settings)
        assert bb is not None, f"cabin {c.Name}: no geometry"
        x_extent = bb[3] - bb[0]
        y_extent = bb[4] - bb[1]
        z_extent = bb[5] - bb[2]
        assert abs(x_extent - CABIN_WIDTH_M) < tolerance_m, (
            f"cabin {c.Name}: X extent {x_extent:.3f} m; expected "
            f"{CABIN_WIDTH_M} ± {tolerance_m} m"
        )
        assert abs(y_extent - CABIN_DEPTH_M) < tolerance_m, (
            f"cabin {c.Name}: Y extent {y_extent:.3f} m; expected "
            f"{CABIN_DEPTH_M} ± {tolerance_m} m"
        )
        assert abs(z_extent - CABIN_HEIGHT_M) < tolerance_m, (
            f"cabin {c.Name}: Z extent {z_extent:.3f} m; expected "
            f"{CABIN_HEIGHT_M} ± {tolerance_m} m"
        )


def test_lift_cabin_pset_transport_element_common(
    tower_3bhk_g5_ifc,
) -> None:
    """Every cabin carries Pset_TransportElementCommon with the
    spec'd defaults (CapacityPeople=6, CapacityWeight=408,
    Reference='stub-lift-cabin', Status='NEW')."""
    cabins = list(tower_3bhk_g5_ifc.by_type("IfcTransportElement"))
    assert cabins, "no cabins emitted"

    for c in cabins:
        psets = {}
        for rel in getattr(c, "IsDefinedBy", []) or []:
            if rel.is_a("IfcRelDefinesByProperties"):
                pset = rel.RelatingPropertyDefinition
                if pset.is_a("IfcPropertySet"):
                    props = {}
                    for p in pset.HasProperties or []:
                        if p.is_a("IfcPropertySingleValue") and p.NominalValue is not None:
                            props[p.Name] = p.NominalValue.wrappedValue
                    psets[pset.Name] = props

        assert "Pset_TransportElementCommon" in psets, (
            f"cabin {c.Name}: missing Pset_TransportElementCommon "
            f"(have: {sorted(psets)})"
        )
        common = psets["Pset_TransportElementCommon"]
        assert common.get("Reference") == "stub-lift-cabin", common
        assert common.get("Status") == "NEW", common
        assert common.get("CapacityPeople") == LIFT_CAPACITY_PEOPLE, common
        # Weight stored as float; compare with tolerance.
        weight = common.get("CapacityWeight")
        assert weight is not None and abs(weight - LIFT_CAPACITY_WEIGHT_KG) < 0.5, (
            f"CapacityWeight = {weight}; expected {LIFT_CAPACITY_WEIGHT_KG}"
        )


def test_house_template_has_no_transport_element(house_3bhk_ifc) -> None:
    """3BHK Pune house has no lift rooms → emit_lift_cabins must
    produce zero IfcTransportElement entities."""
    cabins = list(house_3bhk_ifc.by_type("IfcTransportElement"))
    assert cabins == [], (
        f"house template emitted {len(cabins)} IfcTransportElement(s); "
        f"expected 0 (no lift rooms in non-tower templates)"
    )


def test_duplex_template_has_no_transport_element(duplex_2bhk_ifc) -> None:
    """2BHK Pune duplex has no lift rooms → emit_lift_cabins must
    produce zero IfcTransportElement entities."""
    cabins = list(duplex_2bhk_ifc.by_type("IfcTransportElement"))
    assert cabins == [], (
        f"duplex template emitted {len(cabins)} IfcTransportElement(s); "
        f"expected 0 (no lift rooms in non-tower templates)"
    )


# ─── Cross-template: every tower template emits cabins ───────────────


@pytest.mark.parametrize(
    "template_id,plot_w,plot_l,habitable",
    [
        (TemplateId.BHK1_PUNE_TOWER, 7.32, 12.20, 5),
        (TemplateId.BHK2_PUNE_TOWER, 7.32, 15.24, 5),
        (TemplateId.BHK3_PUNE_TOWER, 11.0, 20.0, 5),
    ],
    ids=lambda v: str(v).split(".")[-1] if hasattr(v, "value") else str(v),
)
def test_all_tower_templates_have_lift_cabins(
    template_id, plot_w, plot_l, habitable
) -> None:
    """Every tower template (1BHK / 2BHK / 3BHK) emits ≥1 cabin per
    lift shaft. Drift here means the dispatcher / template lost the
    `usage="lift"` room and the cabin emitter silently no-ops."""
    bm = dispatch_template(
        template_id,
        TemplateParameters(
            plot_width_m=plot_w,
            plot_length_m=plot_l,
            habitable_floor_count=habitable,
        ),
    )
    model = build_ifc_from_building_model(bm)
    cabins = list(model.by_type("IfcTransportElement"))
    lift_shafts = [
        s for s in model.by_type("IfcSpace") if s.Name and "Lift" in s.Name
    ]
    assert len(lift_shafts) >= 1, (
        f"{template_id.value}: no lift IfcSpace entities — template "
        f"may have lost its lift room"
    )
    assert len(cabins) == len(lift_shafts), (
        f"{template_id.value}: cabins={len(cabins)} vs "
        f"lift_shafts={len(lift_shafts)}"
    )
    for c in cabins:
        assert c.PredefinedType == "ELEVATOR"


# ─── Constants pinned ─────────────────────────────────────────────────


def test_cabin_dimensions_constants_pinned() -> None:
    """Cabin geometry is 1.2 × 1.2 × 2.2 m per spec §3 Phase B.1.
    Drift in any axis would silently change the visual."""
    assert CABIN_WIDTH_M == 1.2
    assert CABIN_DEPTH_M == 1.2
    assert CABIN_HEIGHT_M == 2.2


def test_cabin_capacity_defaults_pinned() -> None:
    """6-person 408-kg defaults match Indian residential lift norms.
    Tunable but pinned by this test so a silent change surfaces."""
    assert LIFT_CAPACITY_PEOPLE == 6
    assert LIFT_CAPACITY_WEIGHT_KG == 408
