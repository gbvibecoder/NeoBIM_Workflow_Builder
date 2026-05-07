"""Phase 2A Slice 2A.1 — schema + reference-data verification tests.

Covers the foundation layer landed in Slice 1:

* Every Pydantic schema in ``app.services.design_agent.types`` constructs,
  is frozen, and unwraps invariant errors via the canonical ``.build()``
  classmethod (mirroring Phase 1's ``BuildingModel.build``).
* Every invariant declared in the module docstring fires on a targeted
  mutation.
* The NBC / IS 1893 / IS 875 reference tables cover the canonical
  ``RoomUsage`` literals, return ``None`` cleanly on missing inputs, and
  agree with the lookups documented in the prompt's R12 smoke test
  ("Bangalore is Zone II", etc.).

Tests are deliberately small and independent: each starts from a fresh
copy of ``_valid_program_dict()`` / ``_valid_context_dict()`` and mutates
one or two fields to exercise a single invariant. Same pattern as
``tests/test_building_model_construction.py``.
"""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from app.services.design_agent import (
    BriefAnalysis,
    BriefForm,
    BriefStyleWeights,
    BuildingClass,
    CirculationSpec,
    DesignContext,
    DesignContextValidationError,
    DesignRequest,
    FidelityHint,
    ProgramConstraints,
    RoomProgram,
    RoomSpec,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    fidelity_hint_for,
)
from app.services.design_agent.reference_data import (
    DEFAULT_RERA_RATIOS,
    NBC_MIN_AREAS_SQM,
    NBC_MIN_LINEAR,
    assert_room_usage_coverage,
    get_nbc_min_area_sqm,
    lookup_basic_wind_speed_mps,
    lookup_seismic_zone,
    lookup_wind_zone,
    lookup_zone_factor,
)


# ─── Shared dict templates ────────────────────────────────────────────


def _valid_request_dict() -> dict:
    return {
        "brief_text": "30m circular futuristic building in Bangalore, 5 floors",
        "target_fidelity": "design-development",
        "build_id": "build-test-0001",
    }


def _valid_room_dict(rid: str = "r-living-01", floor: int = 0) -> dict:
    return {
        "id": rid,
        "name": "Living Room",
        "usage": "living",
        "target_area_sqm": 14.0,
        "nbc_min_area_sqm": 9.5,
        "aspect_ratio_min": 1.0,
        "aspect_ratio_max": 2.5,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
        "floor_index": floor,
    }


def _valid_program_dict() -> dict:
    return {
        "rooms": [
            _valid_room_dict("r-living-01", 0),
            {
                "id": "r-kitchen-01",
                "name": "Kitchen",
                "usage": "kitchen",
                "target_area_sqm": 8.0,
                "nbc_min_area_sqm": 5.0,
                "aspect_ratio_min": 1.0,
                "aspect_ratio_max": 2.0,
                "natural_light_required": True,
                "natural_ventilation_required": True,
                "privacy_level": "semi_private",
                "floor_index": 0,
                "adjacency_required": ["r-living-01"],
            },
            {
                "id": "r-bedroom-01",
                "name": "Master Bedroom",
                "usage": "master_bedroom",
                "target_area_sqm": 12.0,
                "nbc_min_area_sqm": 9.5,
                "aspect_ratio_min": 1.0,
                "aspect_ratio_max": 1.8,
                "natural_light_required": True,
                "natural_ventilation_required": True,
                "privacy_level": "private",
                "floor_index": 1,
            },
        ],
        "rooms_per_floor": {0: ["r-living-01", "r-kitchen-01"], 1: ["r-bedroom-01"]},
        "circulation": {
            "corridor_min_width_m": 1.2,
            "stair_count": 1,
            "lift_count": 0,
            "egress_paths_required": 1,
        },
        "constraints": {
            "total_carpet_area_sqm_min": 30.0,
            "total_carpet_area_sqm_max": 60.0,
            "max_floors": 2,
        },
        "summary": "Two-floor 1BHK with kitchen+living on ground, bedroom upstairs.",
    }


def _valid_analysis_dict() -> dict:
    return {
        "building_class": {
            "primary_type": "residential",
            "sub_type": "apartment",
            "nbc_group": "A-4",
            "nbc_subdivision": "Multi-family residential",
        },
        "site_context": {
            "plot_width_m": 7.32,
            "plot_length_m": 15.24,
            "location_city": "pune",
            "seismic_zone": "III",
            "wind_zone": 2,
        },
        "style_intent": {
            "architectural_style": "modern",
        },
        "structural_intent": {
            "system": "rcc_frame",
            "seismic_design_required": True,
            "wind_design_required": True,
        },
        "fidelity_hint": {
            "rebar_required": False,
            "mep_routing_required": True,
            "cobie_required": False,
        },
        "floors_above_ground": 2,
        "floors_below_ground": 0,
        "raw_brief_summary": "2BHK on a 24x50 ft Pune plot with modern style.",
    }


def _valid_weights_dict() -> dict:
    return {
        "floor_plan": 0.7,
        "narrative": 0.1,
        "parametric": 0.2,
        "confidence": 0.85,
        "rationale": "Explicit dimensions detected.",
    }


# ─── Schema construction (happy path) ────────────────────────────────


def test_design_request_constructs_with_text_only() -> None:
    req = DesignRequest(**_valid_request_dict())
    assert req.brief_text.startswith("30m")
    assert req.target_fidelity == "design-development"
    # frozen=True
    with pytest.raises(ValidationError):
        req.target_fidelity = "concept"  # type: ignore[misc]


def test_brief_form_all_fields_optional() -> None:
    form = BriefForm()
    assert form.plot_dimensions_m is None
    assert form.structural_system == "auto"  # field default


def test_brief_form_with_all_fields() -> None:
    form = BriefForm(
        plot_dimensions_m=(7.32, 15.24),
        plot_area_sqft=1200,
        floors=3,
        bhk_count=2,
        building_type="residential",
        style="modern",
        structural_system="rcc",
        parking_required=True,
        site_orientation="N",
        location_city="Pune",
        budget_inr_lakhs=80.0,
        site_constraints=["setback_5m_front"],
        user_notes="Vastu compliant",
    )
    assert form.bhk_count == 2
    assert form.location_city == "Pune"


def test_room_spec_constructs_and_is_frozen() -> None:
    room = RoomSpec(**_valid_room_dict())
    assert room.usage == "living"
    with pytest.raises(ValidationError):
        room.target_area_sqm = 99.0  # type: ignore[misc]


def test_room_program_constructs() -> None:
    program = RoomProgram.build(_valid_program_dict())
    assert len(program.rooms) == 3
    assert set(program.rooms_per_floor.keys()) == {0, 1}


def test_brief_analysis_constructs() -> None:
    analysis = BriefAnalysis(**_valid_analysis_dict())
    assert analysis.building_class.nbc_group == "A-4"
    assert analysis.site_context.seismic_zone == "III"


def test_brief_style_weights_constructs() -> None:
    w = BriefStyleWeights.build(_valid_weights_dict())
    assert abs(w.floor_plan + w.narrative + w.parametric - 1.0) < 1e-9


def test_design_context_full_assembly() -> None:
    ctx = DesignContext(
        request=DesignRequest(**_valid_request_dict()),
        style_weights=BriefStyleWeights.build(_valid_weights_dict()),
        analysis=BriefAnalysis(**_valid_analysis_dict()),
        program=RoomProgram.build(_valid_program_dict()),
    )
    assert ctx.classifier_metadata == {}
    assert len(ctx.program.rooms) == 3


# ─── fidelity_hint_for() mapping ─────────────────────────────────────


def test_fidelity_hint_concept_disables_all() -> None:
    h = fidelity_hint_for("concept")
    assert h == FidelityHint(
        rebar_required=False,
        mep_routing_required=False,
        cobie_required=False,
    )


def test_fidelity_hint_design_dev_enables_mep() -> None:
    h = fidelity_hint_for("design-development")
    assert h.mep_routing_required is True
    assert h.rebar_required is False
    assert h.cobie_required is False


def test_fidelity_hint_tender_ready_enables_all() -> None:
    h = fidelity_hint_for("tender-ready")
    assert h.rebar_required is True
    assert h.mep_routing_required is True
    assert h.cobie_required is True


# ─── Invariant: BRIEF_STYLE_WEIGHTS_NORMALIZED ───────────────────────


def test_weights_must_sum_to_one() -> None:
    bad = _valid_weights_dict()
    bad["floor_plan"] = 0.5  # 0.5 + 0.1 + 0.2 = 0.8
    with pytest.raises(DesignContextValidationError) as exc:
        BriefStyleWeights.build(bad)
    assert exc.value.rule_id == "BRIEF_STYLE_WEIGHTS_NORMALIZED"
    assert "0.800" in exc.value.actual or "0.8" in exc.value.actual


def test_weights_can_be_dominant_single_style() -> None:
    """A 0.95 / 0.025 / 0.025 distribution is valid (high-confidence)."""
    w = BriefStyleWeights.build(
        {
            "floor_plan": 0.95,
            "narrative": 0.025,
            "parametric": 0.025,
            "confidence": 0.95,
            "rationale": "Strong floor-plan signal.",
        }
    )
    assert w.floor_plan == 0.95


# ─── Invariant: ROOM_AREA_RESPECTS_NBC ───────────────────────────────


def test_room_target_below_nbc_min_rejected() -> None:
    bad = _valid_room_dict()
    bad["target_area_sqm"] = 5.0  # less than nbc_min 9.5
    with pytest.raises(DesignContextValidationError) as exc:
        RoomSpec.build(bad)
    assert exc.value.rule_id == "ROOM_AREA_RESPECTS_NBC"
    assert "9.50" in exc.value.expected


def test_room_target_at_nbc_min_accepted() -> None:
    """Boundary: target == nbc_min must pass."""
    d = _valid_room_dict()
    d["target_area_sqm"] = d["nbc_min_area_sqm"]
    room = RoomSpec.build(d)
    assert room.target_area_sqm == room.nbc_min_area_sqm


# ─── Invariant: ROOM_ASPECT_VALID ────────────────────────────────────


def test_room_aspect_inverted_rejected() -> None:
    bad = _valid_room_dict()
    bad["aspect_ratio_min"] = 3.0
    bad["aspect_ratio_max"] = 1.5
    with pytest.raises(DesignContextValidationError) as exc:
        RoomSpec.build(bad)
    assert exc.value.rule_id == "ROOM_ASPECT_VALID"


# ─── Invariant: PROGRAM_AREA_RANGE_VALID ─────────────────────────────


def test_program_area_range_inverted_rejected() -> None:
    bad = _valid_program_dict()
    bad["constraints"]["total_carpet_area_sqm_min"] = 100.0
    bad["constraints"]["total_carpet_area_sqm_max"] = 50.0
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "PROGRAM_AREA_RANGE_VALID"


# ─── Invariant: ROOM_FLOORS_CONSISTENT ───────────────────────────────


def test_program_dangling_room_id_rejected() -> None:
    bad = _valid_program_dict()
    bad["rooms_per_floor"] = {0: ["r-living-01", "r-ghost"], 1: ["r-bedroom-01"]}
    # r-kitchen-01 also drops out — but the dangling reference is detected first
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_FLOORS_CONSISTENT"
    assert "r-ghost" in exc.value.actual or "r-ghost" in str(exc.value)


def test_program_room_floor_index_mismatch_rejected() -> None:
    bad = _valid_program_dict()
    # r-bedroom-01 has floor_index=1 but is moved to floor 0
    bad["rooms_per_floor"] = {0: ["r-living-01", "r-kitchen-01", "r-bedroom-01"]}
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_FLOORS_CONSISTENT"


def test_program_room_listed_twice_rejected() -> None:
    bad = _valid_program_dict()
    bad["rooms_per_floor"][1].append("r-living-01")
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_FLOORS_CONSISTENT"


def test_program_room_missing_from_floor_map_rejected() -> None:
    bad = _valid_program_dict()
    bad["rooms_per_floor"] = {0: ["r-living-01", "r-kitchen-01"]}  # bedroom dropped
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_FLOORS_CONSISTENT"


def test_program_duplicate_room_ids_rejected() -> None:
    bad = _valid_program_dict()
    dup = copy.deepcopy(bad["rooms"][0])
    bad["rooms"].append(dup)
    bad["rooms_per_floor"][0].append(dup["id"])
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_FLOORS_CONSISTENT"
    assert "appears more than once" in exc.value.actual


# ─── Invariant: ROOM_ADJACENCY_REFERENCES_VALID ──────────────────────


def test_program_dangling_adjacency_rejected() -> None:
    bad = _valid_program_dict()
    bad["rooms"][0]["adjacency_required"] = ["r-ghost"]
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_ADJACENCY_REFERENCES_VALID"


def test_program_outside_adjacency_accepted() -> None:
    """The literal 'Outside' sentinel is permitted."""
    d = _valid_program_dict()
    d["rooms"][0]["adjacency_required"] = ["Outside"]
    program = RoomProgram.build(d)
    assert program.rooms[0].adjacency_required == ["Outside"]


def test_program_self_adjacency_rejected() -> None:
    bad = _valid_program_dict()
    bad["rooms"][0]["adjacency_required"] = ["r-living-01"]
    with pytest.raises(DesignContextValidationError) as exc:
        RoomProgram.build(bad)
    assert exc.value.rule_id == "ROOM_ADJACENCY_REFERENCES_VALID"


# ─── Pydantic field-level constraints (parse-time errors) ────────────


def test_design_request_requires_build_id() -> None:
    with pytest.raises(ValidationError):
        DesignRequest(brief_text="hello")


def test_brief_form_floors_out_of_range() -> None:
    with pytest.raises(ValidationError):
        BriefForm(floors=51)


def test_room_spec_empty_id_rejected() -> None:
    bad = _valid_room_dict()
    bad["id"] = ""
    with pytest.raises(ValidationError):
        RoomSpec(**bad)


# ─── Reference data: NBC ─────────────────────────────────────────────


def test_nbc_covers_every_room_usage() -> None:
    """Every literal in RoomUsage must have an entry in NBC_MIN_AREAS_SQM."""
    assert_room_usage_coverage()


def test_nbc_min_areas_use_correct_floors() -> None:
    """Spot-check the headline residential numbers from NBC India 2016 Part 4."""
    assert NBC_MIN_AREAS_SQM["living"] == 9.5
    assert NBC_MIN_AREAS_SQM["master_bedroom"] == 9.5
    assert NBC_MIN_AREAS_SQM["bedroom"] == 7.5
    assert NBC_MIN_AREAS_SQM["kitchen"] == 5.0
    assert NBC_MIN_AREAS_SQM["bathroom"] == 1.8
    assert NBC_MIN_AREAS_SQM["powder_room"] == 1.1


def test_nbc_min_linear_dimensions() -> None:
    assert NBC_MIN_LINEAR.corridor_residential_width_m == 1.2
    assert NBC_MIN_LINEAR.corridor_commercial_width_m == 1.5
    assert NBC_MIN_LINEAR.stair_tread_min_m == 0.25
    assert NBC_MIN_LINEAR.stair_riser_max_m == 0.19
    assert NBC_MIN_LINEAR.habitable_room_min_height_m == 2.75


def test_nbc_default_rera_ratios() -> None:
    assert DEFAULT_RERA_RATIOS == (1.0, 1.15, 1.30)


def test_nbc_helper_falls_back_to_one_for_unknown() -> None:
    assert get_nbc_min_area_sqm("does_not_exist") == 1.0


# ─── Reference data: IS 1893 seismic ─────────────────────────────────


@pytest.mark.parametrize(
    "city,zone",
    [
        ("Bangalore", "II"),
        ("bengaluru", "II"),
        ("Hyderabad", "II"),
        ("Mumbai", "III"),
        ("Pune", "III"),
        ("Chennai", "III"),
        ("Kolkata", "III"),
        ("Ahmedabad", "III"),
        ("Goa", "III"),
        ("Delhi", "IV"),
        ("New Delhi", "IV"),
        ("Chandigarh", "IV"),
        ("Patna", "IV"),
        ("Srinagar", "V"),
        ("Guwahati", "V"),
        ("Bhuj", "V"),
    ],
)
def test_seismic_zone_canonical_lookups(city: str, zone: str) -> None:
    """Spot-check the headline IS 1893 zone assignments."""
    assert lookup_seismic_zone(city) == zone


def test_seismic_zone_handles_whitespace_and_case() -> None:
    assert lookup_seismic_zone("  Pune  ") == "III"
    assert lookup_seismic_zone("MUMBAI") == "III"


def test_seismic_zone_unknown_returns_none() -> None:
    assert lookup_seismic_zone("Atlantis") is None


def test_seismic_zone_empty_returns_none() -> None:
    assert lookup_seismic_zone("") is None
    assert lookup_seismic_zone(None) is None


def test_zone_factor_lookup() -> None:
    assert lookup_zone_factor("II") == 0.10
    assert lookup_zone_factor("III") == 0.16
    assert lookup_zone_factor("IV") == 0.24
    assert lookup_zone_factor("V") == 0.36
    assert lookup_zone_factor(None) is None


# ─── Reference data: IS 875 wind ─────────────────────────────────────


@pytest.mark.parametrize(
    "city,zone",
    [
        ("Bangalore", 1),
        ("Pune", 2),
        ("Hyderabad", 2),
        ("Ahmedabad", 2),
        ("Mumbai", 3),
        ("Delhi", 4),
        ("Chennai", 5),
        ("Kolkata", 5),
        ("Bhuj", 6),
    ],
)
def test_wind_zone_canonical_lookups(city: str, zone: int) -> None:
    assert lookup_wind_zone(city) == zone


def test_wind_zone_unknown_returns_none() -> None:
    assert lookup_wind_zone("Atlantis") is None
    assert lookup_wind_zone(None) is None
    assert lookup_wind_zone("") is None


def test_wind_zone_basic_speeds() -> None:
    assert lookup_basic_wind_speed_mps(1) == 33
    assert lookup_basic_wind_speed_mps(3) == 44
    assert lookup_basic_wind_speed_mps(6) == 55
    assert lookup_basic_wind_speed_mps(None) is None


# ─── Cross-table coverage sanity ──────────────────────────────────────


def test_seismic_and_wind_share_major_metros() -> None:
    """Every top-12 Indian metro appears in both the seismic + wind tables.

    A drift here means the BriefAnalyst will enrich one zone but not the
    other, surfacing an asymmetric SiteContext to downstream stages.
    """
    metros = [
        "mumbai", "delhi", "bangalore", "hyderabad", "chennai",
        "kolkata", "pune", "ahmedabad", "surat", "jaipur",
        "lucknow", "kanpur",
    ]
    for m in metros:
        assert lookup_seismic_zone(m) is not None, f"missing seismic: {m}"
        assert lookup_wind_zone(m) is not None, f"missing wind: {m}"
