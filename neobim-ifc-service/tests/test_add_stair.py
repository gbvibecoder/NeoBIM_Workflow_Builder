"""
Phase δ.4 — add_stair geometry regression tests.

The CRITICAL acceptance test is `test_top_tread_lands_at_floor_height`
— it proves the stair PHYSICALLY CONNECTS two floors (the whole point
of δ.4). Every other test pins one of the geometry / assembly /
material / placement / persistence invariants.

The γ.10 door trap (placement frame mismatch causing a freestanding
slab) is the exact danger here for stairs spanning storeys. The
storey-placement test asserts the stair is properly parented so it
inherits the storey's world Z — which is what makes the top tread
land at the next storey's floor when total_rise = storey delta.
"""

from __future__ import annotations

import math
import os
import tempfile

import ifcopenshell
import pytest

from app.services.ifc_generator_v3 import BuildFlowIFC


def _minimal_brief() -> dict:
    return {
        "project": {
            "name": "Stair Test", "type": "residential",
            "location": "Test", "description": "δ.4 stair tests",
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


def _flight_of(stair) -> object:
    """Walk the IfcRelAggregates from a stair to its first flight."""
    for rel in stair.IsDecomposedBy or []:
        if rel.is_a("IfcRelAggregates"):
            for child in rel.RelatedObjects or []:
                if child.is_a("IfcStairFlight"):
                    return child
    raise AssertionError("stair has no aggregated IfcStairFlight")


def _flight_step_solids(flight) -> list:
    """Return the list of IfcExtrudedAreaSolid items inside the flight's
    Body representation."""
    rep = flight.Representation
    assert rep is not None, "flight has no Representation"
    solids = []
    for shape_rep in rep.Representations or []:
        for item in shape_rep.Items or []:
            if item.is_a("IfcExtrudedAreaSolid"):
                solids.append(item)
    return solids


# ── THE ACCEPTANCE TEST — stair physically connects floors ──────────


def test_top_tread_lands_at_floor_height():
    """The top of the highest step must reach EXACTLY total_rise above
    the stair's local origin Z. With a target storey at elevation
    `total_rise` and the stair's origin at oz=0, the stair's top tread
    lands on the next storey's floor. This is the connect-the-floors
    invariant — the whole point of δ.4.
    """
    bf = BuildFlowIFC(_minimal_brief())
    # 3.1 m floor-to-floor, residential default.
    stair = bf.add_stair(
        "stair-1",
        origin=(0.0, 0.0, 0.0),
        total_rise=3.1,
        width=1.0,
        material="mat-concrete",
    )
    assert stair is not None

    flight = _flight_of(stair)
    solids = _flight_step_solids(flight)
    assert len(solids) >= 2, "stair must have at least 2 steps"

    # Compute the highest top-Z across all step solids. Each step is
    # extruded along +Z; its top sits at Position.Z + Depth.
    top_z = max(s.Position.Location.Coordinates[2] + s.Depth for s in solids)

    # Must equal total_rise within float tolerance.
    assert math.isclose(top_z, 3.1, abs_tol=1e-9), (
        f"top of last step is at local z={top_z}, expected 3.1. "
        "The stair would not physically connect to the next floor."
    )


def test_top_tread_lands_at_floor_height_when_step_count_not_divisible():
    """Non-even rise / step division still keeps the top exact.
    riser_height = total_rise / step_count is computed exactly, so the
    Nth tread always sits at z = total_rise regardless of rounding.
    """
    bf = BuildFlowIFC(_minimal_brief())
    # Awkward floor-to-floor that doesn't divide evenly into 17 cm
    # risers (e.g. 2.73 m / 0.17 = 16.0588...).
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=2.73, width=1.0, material="mat-concrete",
    )
    flight = _flight_of(stair)
    solids = _flight_step_solids(flight)
    top_z = max(s.Position.Location.Coordinates[2] + s.Depth for s in solids)
    assert math.isclose(top_z, 2.73, abs_tol=1e-9)


# ── Step count / rise distribution ──────────────────────────────────


def test_step_count_auto_derived_targets_17cm_risers():
    """Auto-derivation: with no step_count override, the helper picks
    ~17 cm risers. 3.1 m / 0.17 ≈ 18.235 → rounds to 18 steps."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    solids = _flight_step_solids(_flight_of(stair))
    assert len(solids) == 18


def test_step_count_clamped_to_minimum_2():
    """A user override of step_count=1 (or 0) is clamped to 2 — a
    one-step stair isn't a stair, it's a kerb."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=0.5, width=1.0,
        step_count=1, material="mat-concrete",
    )
    solids = _flight_step_solids(_flight_of(stair))
    assert len(solids) >= 2


def test_step_count_override_honoured():
    """Caller-specified step_count beats the auto-derivation."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0,
        step_count=10, material="mat-concrete",
    )
    solids = _flight_step_solids(_flight_of(stair))
    assert len(solids) == 10
    # Riser height is total_rise / step_count.
    expected_riser = 3.1 / 10
    bottom_step_height = solids[0].Depth
    assert math.isclose(bottom_step_height, expected_riser, abs_tol=1e-9)


# ── IfcRelAggregates assembly (stair = parent, flight = child) ──────


def test_stair_aggregates_flight_via_ifcrelaggregates():
    """Real IFC stair semantics: IfcStair is the assembly, IfcStairFlight
    is aggregated under it via IfcRelAggregates. Downstream BIM tools
    that filter by IFC class see the stair as one element, not as N
    loose solids."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    rels = stair.IsDecomposedBy or []
    assert any(r.is_a("IfcRelAggregates") for r in rels), (
        "stair has no IfcRelAggregates — assembly composition broken"
    )
    # The aggregation must contain exactly one IfcStairFlight (δ.4
    # scope: single straight-run flight).
    flights = []
    for rel in rels:
        if rel.is_a("IfcRelAggregates"):
            for child in rel.RelatedObjects or []:
                if child.is_a("IfcStairFlight"):
                    flights.append(child)
    assert len(flights) == 1


# ── IFC class + PredefinedType (the schema-aware bit) ───────────────


def test_stair_is_ifcstair_class():
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    assert stair.is_a("IfcStair")
    assert not stair.is_a("IfcBuildingElementProxy")


def test_stair_predefined_type_set_in_ifc4():
    """IFC4 IfcStair carries PredefinedType. The default
    STRAIGHT_RUN_STAIR must be set."""
    bf = BuildFlowIFC(_minimal_brief(), schema="IFC4")
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    assert stair.PredefinedType == "STRAIGHT_RUN_STAIR"


def test_stair_predefined_type_set_in_ifc2x3():
    """IFC2X3 renamed PredefinedType → ShapeType on IfcStair. add_stair
    sets the right attribute per schema so downstream tools (Solibri,
    IDS validation) read the stair shape on both IFC2X3 and IFC4."""
    bf = BuildFlowIFC(_minimal_brief(), schema="IFC2X3")
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    assert stair.ShapeType == "STRAIGHT_RUN_STAIR"


# ── Material + styling (γ.5 discipline) ─────────────────────────────


def test_stair_carries_material_assignment():
    """The stair (and its flight) must have an IfcMaterial assigned per
    the γ.5 'no gray IFC' rule."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    flight = _flight_of(stair)
    # Walk IfcRelAssociatesMaterial inverse to find the assignment.
    associated = False
    for rel in bf._ifc.by_type("IfcRelAssociatesMaterial"):
        related = list(rel.RelatedObjects or [])
        if stair in related or flight in related:
            associated = True
            break
    assert associated, "stair has no IfcMaterial association"


# ── Storey placement (the γ.10 guard) ───────────────────────────────


def test_stair_storey_parented_with_oz_zero_means_at_storey_floor():
    """The stair's ObjectPlacement must be relative to the target
    storey's placement. With origin Z=0 the stair sits at the storey's
    floor. This is the connect-the-floors precondition — combined with
    `test_top_tread_lands_at_floor_height`, it proves the stair top
    lands at the NEXT storey's floor when total_rise = storey delta."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_storey("floor-1", "First Floor", 3.1)

    stair = bf.add_stair(
        "stair-1", origin=(2.0, 2.0, 0.0),
        total_rise=3.1, width=1.0,
        material="mat-concrete",
        storey_id=None,  # ground floor (default)
    )

    placement = stair.ObjectPlacement
    assert placement is not None
    # PlacementRelTo must point at the ground storey's placement.
    ground_storey = bf._storey
    assert placement.PlacementRelTo == ground_storey.ObjectPlacement, (
        "stair is NOT parented to the ground storey — γ.10-style frame "
        "mismatch would make the stair float free of the floor."
    )
    # Local origin Z = 0 → stair starts at the storey's floor.
    loc = placement.RelativePlacement.Location.Coordinates
    assert loc[0] == 2.0 and loc[1] == 2.0 and loc[2] == 0.0


def test_stair_routes_to_named_storey_when_storey_id_provided():
    """A stair on floor-1 going to floor-2 must be parented to floor-1,
    not the ground storey."""
    bf = BuildFlowIFC(_minimal_brief())
    floor_1 = bf.add_storey("floor-1", "First Floor", 3.1)
    bf.add_storey("floor-2", "Second Floor", 6.2)

    stair = bf.add_stair(
        "stair-1-to-2",
        origin=(0, 0, 0),
        total_rise=3.1,
        width=1.0,
        material="mat-concrete",
        storey_id="floor-1",
    )
    assert stair.ObjectPlacement.PlacementRelTo == floor_1.ObjectPlacement


# ── δ.0 telemetry — stair lands in built, not proxy ─────────────────


def test_telemetry_records_stair_as_built_not_proxy():
    """The whole point of δ.4: stairs move OUT of proxyFallbacks and
    INTO built_element_counts. After this ships telemetry shows
    IfcStair counts climbing on multi-storey briefs."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    tel = bf.get_telemetry()
    assert tel["proxy_fallbacks"] == [], (
        "stair must NOT record a proxy_fallback — that was the pre-δ.4 bug"
    )
    assert tel["built_element_counts"].get("IfcStair", 0) == 1
    assert tel["built_element_counts"].get("IfcStairFlight", 0) == 1


# ── Edge cases (Rule 9 — graceful degradation, never crash) ─────────


@pytest.mark.parametrize("rise,width", [
    (0, 1.0),
    (-1.0, 1.0),
    (3.1, 0),
    (3.1, -0.5),
    ("garbage", 1.0),
    (3.1, None),
])
def test_invalid_dims_skip_gracefully_with_telemetry(rise, width):
    """Missing / zero / non-numeric dims → graceful skip + dropped_element
    telemetry. NO IFC entity created. NO exception."""
    bf = BuildFlowIFC(_minimal_brief())
    result = bf.add_stair(
        "stair-bad", origin=(0, 0, 0),
        total_rise=rise, width=width, material="mat-concrete",
    )
    assert result is None
    tel = bf.get_telemetry()
    assert len(tel["dropped_elements"]) == 1
    assert tel["dropped_elements"][0]["type"] == "stair"
    assert tel["built_element_counts"].get("IfcStair", 0) == 0


def test_duplicate_id_raises():
    """Same id used twice → the canonical 'id already taken' error (matches
    every other add_* method)."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_stair("stair-1", origin=(0, 0, 0), total_rise=3.1, width=1.0)
    from app.services.ifc_generator_v3.buildflow_ifc import BuildFlowIFCError
    with pytest.raises(BuildFlowIFCError):
        bf.add_stair("stair-1", origin=(0, 0, 0), total_rise=3.1, width=1.0)


# ── Persistence (γ.8 storey + IfcRelAggregates round-trip) ──────────


def test_stair_survives_save_load_state_round_trip():
    """save_state → load_state must restore the IfcStair and its
    IfcRelAggregates relationship to the flight. The stair must remain
    addressable via _elements_by_id after restore (the agent's session
    can be saved + restored mid-build per the FastAPI request/response
    boundary — see save_state docstring)."""
    bf = BuildFlowIFC(_minimal_brief())
    bf.add_stair(
        "stair-1", origin=(2, 2, 0),
        total_rise=3.1, width=1.0, material="mat-concrete",
    )
    flight_before = _flight_of(bf._elements_by_id["stair-1"])
    solid_count_before = len(_flight_step_solids(flight_before))

    with tempfile.TemporaryDirectory() as tmp:
        bf.save_state(tmp)
        restored = BuildFlowIFC.load_state(tmp)

    # Stair entity restored + addressable.
    assert "stair-1" in restored._elements_by_id
    stair = restored._elements_by_id["stair-1"]
    assert stair.is_a("IfcStair")
    # Aggregation survived.
    flight_after = _flight_of(stair)
    assert flight_after.is_a("IfcStairFlight")
    # Geometry survived (same number of step solids).
    solid_count_after = len(_flight_step_solids(flight_after))
    assert solid_count_after == solid_count_before
    # Top tread still at the right Z.
    top_z = max(
        s.Position.Location.Coordinates[2] + s.Depth
        for s in _flight_step_solids(flight_after)
    )
    assert math.isclose(top_z, 3.1, abs_tol=1e-9)


# ── IfcStairFlight metadata (NumberOfRisers etc.) ───────────────────


def test_flight_carries_riser_tread_metadata():
    """Downstream tools read NumberOfRisers / RiserHeight / TreadLength
    from the IfcStairFlight to build schedules. These must be set."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, width=1.0,
        step_count=18, material="mat-concrete",
    )
    flight = _flight_of(stair)
    # IFC4 uses NumberOfRisers (plural); IFC2X3 uses NumberOfRiser
    # (singular). Pick whichever exists on this schema.
    if hasattr(flight, "NumberOfRisers"):
        assert flight.NumberOfRisers == 18
    elif hasattr(flight, "NumberOfRiser"):
        assert flight.NumberOfRiser == 18
    # Riser height matches total_rise / step_count.
    expected_riser = 3.1 / 18
    if hasattr(flight, "RiserHeight"):
        assert math.isclose(
            float(flight.RiserHeight), expected_riser, abs_tol=1e-6,
        )


# ── Spec→bf integration sanity: a stair element from the agent ──────


def test_stair_default_width_is_residential_grade():
    """Default width = 1.0 m matches residential stair standards. Confirm
    the default is honoured when the caller omits width."""
    bf = BuildFlowIFC(_minimal_brief())
    stair = bf.add_stair(
        "stair-1", origin=(0, 0, 0),
        total_rise=3.1, material="mat-concrete",
        # width omitted
    )
    flight = _flight_of(stair)
    solids = _flight_step_solids(flight)
    # Each step's profile is a rectangle with YDim = width.
    for s in solids:
        assert math.isclose(s.SweptArea.YDim, 1.0, abs_tol=1e-9)
