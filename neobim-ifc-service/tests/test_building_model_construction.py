"""Phase 1 Slice 1 — BuildingModel construction & invariant tests.

Covers the 12 Phase-1 invariants (R2). Each invariant gets at least one
passing fixture (the minimal valid BuildingModel constructs without
raising) and at least one failing fixture (a targeted mutation triggers
exactly the expected `rule_id`).

The pattern is deliberate: every test starts from `_valid_dict()` (a
fresh deep copy of a known-good template), mutates one or two fields to
exercise a single failure mode, and asserts the raised
`BuildingModelValidationError.rule_id`. This keeps tests independent
and the failure attribution unambiguous.

Pydantic-level field constraints (e.g. `min_length=1` on
`connects_room_ids`) raise `pydantic.ValidationError` at parse time
instead of `BuildingModelValidationError` — those branches are tested
separately when applicable.
"""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from app.domain.building_model import (
    BuildingModel,
    BuildingModelValidationError,
)


# ─── Shared fixture template ─────────────────────────────────────────


def _valid_dict() -> dict:
    """Return a fresh deep copy of a known-good minimal BuildingModel dict.

    Layout: 2 storeys (0m, 3m). Storey 0 has a 5×5 room enclosed by 4 walls
    (200mm thick) plus a stair (14 risers × 0.2m == 2.8m structural rise),
    1 floor slab, 1 opening on the south wall with a door connecting the
    room to "Outside". Storey 1 has 1 floor slab. One column rises through
    storey 0 supporting one beam on storey 1. Foundation has one footing
    under the column. One HVAC MEP system: source → seg1 → seg2 → terminal
    (clean acyclic chain, all endpoints share x/y/z within 5mm tolerance).

    All polygons are CCW with ≥3 distinct vertices. Numbers are chosen so
    every invariant has slack — single-field mutations in tests reliably
    break exactly one rule.
    """
    return copy.deepcopy(_TEMPLATE)


_TEMPLATE: dict = {
    "project": {
        "id": "p1",
        "name": "Test Project",
        "site": {
            "id": "site-1",
            "building": {
                "id": "b1",
                "name": "Test Building",
                "envelope_polygon": [
                    {"x": 0, "y": 0},
                    {"x": 5, "y": 0},
                    {"x": 5, "y": 5},
                    {"x": 0, "y": 5},
                ],
                "structural_system": {
                    "columns": [
                        {
                            "id": "c1",
                            "host_storey_id": "s0",
                            "location": {"x": 1, "y": 1},
                            "profile": {"name": "300x300", "profile_type": "rectangle"},
                            "material": "concrete",
                            "base_z": 0.0,
                            "top_z": 3.0,
                        }
                    ],
                    "beams": [
                        {
                            "id": "bm1",
                            "host_storey_id": "s1",
                            "supported_by_column_ids": ["c1"],
                            "profile": {
                                "name": "200x400",
                                "profile_type": "rectangle",
                            },
                            "material": "concrete",
                            "start_point": {"x": 1, "y": 1, "z": 3.0},
                            "end_point": {"x": 4, "y": 1, "z": 3.0},
                            "top_z": 3.0,
                        }
                    ],
                },
                "mep_systems": [
                    {
                        "id": "sys-hvac",
                        "system_kind": "HVAC",
                        "source": {
                            "id": "ahu-1",
                            "system_kind": "HVAC",
                            "predefined_type": "AIRHANDLER",
                            "location": {"x": 1, "y": 1, "z": 2.5},
                        },
                        "distribution": [
                            {
                                "id": "sg1",
                                "system_kind": "HVAC",
                                "predefined_type": "RIGIDSEGMENT",
                                "start_point": {"x": 1, "y": 1, "z": 2.5},
                                "end_point": {"x": 3, "y": 1, "z": 2.5},
                            },
                            {
                                "id": "sg2",
                                "system_kind": "HVAC",
                                "predefined_type": "RIGIDSEGMENT",
                                "start_point": {"x": 3, "y": 1, "z": 2.5},
                                "end_point": {"x": 3, "y": 3, "z": 2.5},
                            },
                        ],
                        "terminals": [
                            {
                                "id": "t1",
                                "system_kind": "HVAC",
                                "predefined_type": "DIFFUSER",
                                "location": {"x": 3, "y": 3, "z": 2.5},
                            }
                        ],
                    }
                ],
                "storeys": [
                    {
                        "id": "s0",
                        "name": "Ground",
                        "elevation": 0.0,
                        "actual_height": 3.0,
                        "index": 0,
                        "walls": [
                            {
                                "id": "w_s",
                                "host_storey_ids": ["s0"],
                                "axis_points": [{"x": 0, "y": 0}, {"x": 5, "y": 0}],
                                "base_z": 0.0,
                                "top_z": 3.0,
                                "thickness": 0.2,
                                "is_external": True,
                                "is_load_bearing": True,
                            },
                            {
                                "id": "w_e",
                                "host_storey_ids": ["s0"],
                                "axis_points": [{"x": 5, "y": 0}, {"x": 5, "y": 5}],
                                "base_z": 0.0,
                                "top_z": 3.0,
                                "thickness": 0.2,
                                "is_external": True,
                                "is_load_bearing": True,
                            },
                            {
                                "id": "w_n",
                                "host_storey_ids": ["s0"],
                                "axis_points": [{"x": 5, "y": 5}, {"x": 0, "y": 5}],
                                "base_z": 0.0,
                                "top_z": 3.0,
                                "thickness": 0.2,
                                "is_external": True,
                                "is_load_bearing": True,
                            },
                            {
                                "id": "w_w",
                                "host_storey_ids": ["s0"],
                                "axis_points": [{"x": 0, "y": 5}, {"x": 0, "y": 0}],
                                "base_z": 0.0,
                                "top_z": 3.0,
                                "thickness": 0.2,
                                "is_external": True,
                                "is_load_bearing": True,
                            },
                        ],
                        "slabs": [
                            {
                                "id": "sl0",
                                "host_storey_id": "s0",
                                "footprint_polygon": [
                                    {"x": 0, "y": 0},
                                    {"x": 5, "y": 0},
                                    {"x": 5, "y": 5},
                                    {"x": 0, "y": 5},
                                ],
                                "top_z": 0.0,
                                "bottom_z": -0.2,
                                "predefined_type": "FLOOR",
                            }
                        ],
                        "rooms": [
                            {
                                "id": "r1",
                                "name": "Living",
                                "usage": "living",
                                "footprint_polygon": [
                                    {"x": 0.1, "y": 0.1},
                                    {"x": 4.9, "y": 0.1},
                                    {"x": 4.9, "y": 4.9},
                                    {"x": 0.1, "y": 4.9},
                                ],
                                "bounding_edges": [
                                    {"wall_id": "w_s", "side": "left"},
                                    {"wall_id": "w_e", "side": "left"},
                                    {"wall_id": "w_n", "side": "left"},
                                    {"wall_id": "w_w", "side": "left"},
                                ],
                            }
                        ],
                        "stairs": [
                            {
                                "id": "st1",
                                "host_storey_id": "s0",
                                "riser_count": 14,
                                "riser_height": 0.2,
                                "tread_depth": 0.28,
                                "plan_polygon": [
                                    {"x": 2, "y": 2},
                                    {"x": 3, "y": 2},
                                    {"x": 3, "y": 4},
                                    {"x": 2, "y": 4},
                                ],
                            }
                        ],
                        "openings": [
                            {
                                "id": "op1",
                                "in_wall_id": "w_s",
                                "distance_along_wall": 1.5,
                                "sill_z": 0.0,
                                "width": 1.0,
                                "height": 2.1,
                                "predefined_type": "DOOR",
                            }
                        ],
                    },
                    {
                        "id": "s1",
                        "name": "Level 1",
                        "elevation": 3.0,
                        "actual_height": 3.0,
                        "index": 1,
                        "slabs": [
                            {
                                "id": "sl1",
                                "host_storey_id": "s1",
                                "footprint_polygon": [
                                    {"x": 0, "y": 0},
                                    {"x": 5, "y": 0},
                                    {"x": 5, "y": 5},
                                    {"x": 0, "y": 5},
                                ],
                                "top_z": 3.0,
                                "bottom_z": 2.8,
                                "predefined_type": "FLOOR",
                            }
                        ],
                    },
                ],
                "doors": [
                    {
                        "id": "d1",
                        "in_opening_id": "op1",
                        "connects_room_ids": ["r1", "Outside"],
                        "swing": "inward",
                        "handedness": "right",
                    }
                ],
                "foundation": {
                    "id": "f1",
                    "footings": [
                        {
                            "id": "ft1",
                            "supports_column_id": "c1",
                            "location": {"x": 1, "y": 1},
                            "top_z": -0.5,
                            "bottom_z": -1.0,
                            "footprint_polygon": [
                                {"x": 0.5, "y": 0.5},
                                {"x": 1.5, "y": 0.5},
                                {"x": 1.5, "y": 1.5},
                                {"x": 0.5, "y": 1.5},
                            ],
                            "material": "concrete",
                        }
                    ],
                },
            },
        },
        "metadata": {
            "provenance": {
                "input_contract_version": "BuildingModel-1.0.0",
                "target_fidelity": "design-development",
                "generated_at": "2026-05-06T12:00:00Z",
                "build_id": "test-1",
                "source_contract": "BuildingModel",
            },
        },
    }
}


# ─── Sanity ──────────────────────────────────────────────────────────


def test_minimal_valid_construction():
    bm = BuildingModel.build(_valid_dict())
    assert bm.project.name == "Test Project"
    assert len(bm.project.site.building.storeys) == 2


def test_models_are_frozen():
    bm = BuildingModel.build(_valid_dict())
    with pytest.raises(ValidationError):
        bm.project.site.building.storeys[0].walls[0].thickness = 0.5  # type: ignore[misc]


# ─── 1. STOREY_CONTINUITY ────────────────────────────────────────────


def test_storey_continuity_passes():
    BuildingModel.build(_valid_dict())  # ok if not raised


def test_storey_continuity_fails_when_storeys_dont_abut():
    d = _valid_dict()
    # storey 1's elevation should be 3.0 (top of storey 0); set to 5.0 ⇒ 2m gap
    d["project"]["site"]["building"]["storeys"][1]["elevation"] = 5.0
    with pytest.raises(BuildingModelValidationError) as exc_info:
        BuildingModel.build(d)
    assert exc_info.value.rule_id == "STOREY_CONTINUITY"
    assert exc_info.value.node_id == "s1"


# ─── 2. WALL_HOSTED ──────────────────────────────────────────────────


def test_wall_hosted_passes():
    BuildingModel.build(_valid_dict())


def test_wall_hosted_fails_unknown_storey():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["walls"][0][
        "host_storey_ids"
    ] = ["s_does_not_exist"]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "WALL_HOSTED"
    assert "s_does_not_exist" in exc.value.actual


# ─── 3. WALL_BASE_VALID ──────────────────────────────────────────────


def test_wall_base_valid_passes():
    BuildingModel.build(_valid_dict())


def test_wall_base_valid_fails_below_storey_floor():
    d = _valid_dict()
    # host storey s0 elevation=0; tolerance 5mm; setting base_z to -1.0 fails
    d["project"]["site"]["building"]["storeys"][0]["walls"][0]["base_z"] = -1.0
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "WALL_BASE_VALID"


def test_wall_base_valid_fails_above_storey_top():
    d = _valid_dict()
    # host storey s0 top = 0+3 = 3m; tolerance 5mm; setting top_z to 5.0 fails
    d["project"]["site"]["building"]["storeys"][0]["walls"][0]["top_z"] = 5.0
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "WALL_BASE_VALID"


# ─── 4. OPENING_IN_WALL ──────────────────────────────────────────────


def test_opening_in_wall_passes():
    BuildingModel.build(_valid_dict())


def test_opening_in_wall_fails_unknown_wall():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["openings"][0][
        "in_wall_id"
    ] = "ghost_wall"
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "OPENING_IN_WALL"


def test_opening_in_wall_fails_too_close_to_wall_start():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["openings"][0][
        "distance_along_wall"
    ] = 0.05  # < 100mm clearance
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "OPENING_IN_WALL"


def test_opening_in_wall_fails_extends_past_wall_end():
    d = _valid_dict()
    # wall length = 5m. opening at distance 4.5m + width 1m = 5.5 > 4.9 (5 - 100mm)
    d["project"]["site"]["building"]["storeys"][0]["openings"][0][
        "distance_along_wall"
    ] = 4.5
    d["project"]["site"]["building"]["storeys"][0]["openings"][0]["width"] = 1.0
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "OPENING_IN_WALL"


# ─── 5. DOOR_IN_OPENING ──────────────────────────────────────────────


def test_door_in_opening_passes():
    BuildingModel.build(_valid_dict())


def test_door_in_opening_fails_unknown_opening():
    d = _valid_dict()
    d["project"]["site"]["building"]["doors"][0]["in_opening_id"] = "ghost_op"
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "DOOR_IN_OPENING"


# ─── 6. DOOR_CONNECTS_ROOMS ──────────────────────────────────────────


def test_door_connects_rooms_passes_exterior():
    BuildingModel.build(_valid_dict())  # ['r1', 'Outside']


def test_door_connects_rooms_fails_duplicate_room_id():
    d = _valid_dict()
    d["project"]["site"]["building"]["doors"][0]["connects_room_ids"] = [
        "r1",
        "r1",
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "DOOR_CONNECTS_ROOMS"


def test_door_connects_rooms_fails_unknown_room_id():
    d = _valid_dict()
    d["project"]["site"]["building"]["doors"][0]["connects_room_ids"] = [
        "r_ghost",
        "Outside",
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "DOOR_CONNECTS_ROOMS"


def test_door_connects_rooms_pydantic_rejects_zero_or_three_ids():
    """Pydantic Field(min_length=1, max_length=2) catches list-length violations
    before BuildingModelValidationError can fire — they surface as
    pydantic.ValidationError. This test pins that contract."""
    d = _valid_dict()
    d["project"]["site"]["building"]["doors"][0]["connects_room_ids"] = []
    with pytest.raises(ValidationError):
        BuildingModel.build(d)
    d = _valid_dict()
    d["project"]["site"]["building"]["doors"][0]["connects_room_ids"] = [
        "r1",
        "Outside",
        "third",
    ]
    with pytest.raises(ValidationError):
        BuildingModel.build(d)


# ─── 7. BEAM_SUPPORTED ───────────────────────────────────────────────


def test_beam_supported_passes_via_column():
    BuildingModel.build(_valid_dict())  # bm1 supported_by_column_ids=['c1']


def test_beam_supported_passes_via_moment_connection():
    d = _valid_dict()
    beam = d["project"]["site"]["building"]["structural_system"]["beams"][0]
    beam["supported_by_column_ids"] = []
    beam["has_moment_connection"] = True
    beam["moment_connection_target_id"] = "w_s"  # a real wall id
    BuildingModel.build(d)


def test_beam_supported_fails_unknown_column():
    d = _valid_dict()
    d["project"]["site"]["building"]["structural_system"]["beams"][0][
        "supported_by_column_ids"
    ] = ["c_ghost"]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "BEAM_SUPPORTED"


def test_beam_supported_fails_no_support_no_moment():
    d = _valid_dict()
    beam = d["project"]["site"]["building"]["structural_system"]["beams"][0]
    beam["supported_by_column_ids"] = []
    beam["has_moment_connection"] = False
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "BEAM_SUPPORTED"


def test_beam_supported_fails_moment_target_not_found():
    d = _valid_dict()
    beam = d["project"]["site"]["building"]["structural_system"]["beams"][0]
    beam["supported_by_column_ids"] = []
    beam["has_moment_connection"] = True
    beam["moment_connection_target_id"] = "ghost_target"
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "BEAM_SUPPORTED"


# ─── 8. COLUMN_AXIS_VALID ────────────────────────────────────────────


def test_column_axis_valid_passes_when_vertical():
    BuildingModel.build(_valid_dict())  # top_location=None ⇒ vertical


def test_column_axis_valid_passes_when_slanted_allowed():
    d = _valid_dict()
    d["project"]["site"]["building"]["structural_system"]["allows_slanted"] = True
    d["project"]["site"]["building"]["structural_system"]["columns"][0][
        "top_location"
    ] = {"x": 2, "y": 2}  # 1.4m horizontal offset, allowed
    BuildingModel.build(d)


def test_column_axis_valid_fails_slanted_not_allowed():
    d = _valid_dict()
    # allows_slanted defaults False; introduce a non-vertical top_location
    d["project"]["site"]["building"]["structural_system"]["columns"][0][
        "top_location"
    ] = {"x": 2, "y": 2}
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "COLUMN_AXIS_VALID"


# ─── 9. ROOM_BOUNDED ─────────────────────────────────────────────────


def test_room_bounded_passes_with_4_walls():
    BuildingModel.build(_valid_dict())


def test_room_bounded_fails_too_few_edges():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["rooms"][0][
        "bounding_edges"
    ] = [{"wall_id": "w_s", "side": "left"}, {"wall_id": "w_e", "side": "left"}]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "ROOM_BOUNDED"


def test_room_bounded_fails_unknown_wall_in_edge():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["rooms"][0]["bounding_edges"][
        0
    ]["wall_id"] = "wall_ghost"
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "ROOM_BOUNDED"


def test_room_bounded_fails_consecutive_collinear_walls():
    """Two consecutive bounding edges referencing parallel walls produce
    parallel offset axes — the corner intersection is undefined."""
    d = _valid_dict()
    storey0 = d["project"]["site"]["building"]["storeys"][0]
    # Add a second wall collinear with w_s (same direction, just offset along x)
    storey0["walls"].append(
        {
            "id": "w_s_extra",
            "host_storey_ids": ["s0"],
            "axis_points": [{"x": 5, "y": 0}, {"x": 6, "y": 0}],
            "base_z": 0.0,
            "top_z": 3.0,
            "thickness": 0.2,
        }
    )
    # Replace bounding_edges with a sequence where two consecutive walls are
    # collinear (w_s then w_s_extra, both axis along +X).
    storey0["rooms"][0]["bounding_edges"] = [
        {"wall_id": "w_s", "side": "left"},
        {"wall_id": "w_s_extra", "side": "left"},
        {"wall_id": "w_e", "side": "left"},
        {"wall_id": "w_n", "side": "left"},
        {"wall_id": "w_w", "side": "left"},
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "ROOM_BOUNDED"


# ─── 10. MEP_TERMINATES ──────────────────────────────────────────────


def test_mep_terminates_passes_with_clean_chain():
    BuildingModel.build(_valid_dict())


def test_mep_terminates_fails_no_source_no_terminal():
    d = _valid_dict()
    sys = d["project"]["site"]["building"]["mep_systems"][0]
    sys["source"] = None
    sys["terminals"] = []
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "MEP_TERMINATES"


def test_mep_terminates_fails_on_cycle():
    d = _valid_dict()
    sys = d["project"]["site"]["building"]["mep_systems"][0]
    # 3 segments forming a triangle (1,1)-(3,1)-(3,3)-(1,1)
    sys["distribution"] = [
        {
            "id": "sg1",
            "system_kind": "HVAC",
            "predefined_type": "RIGIDSEGMENT",
            "start_point": {"x": 1, "y": 1, "z": 2.5},
            "end_point": {"x": 3, "y": 1, "z": 2.5},
        },
        {
            "id": "sg2",
            "system_kind": "HVAC",
            "predefined_type": "RIGIDSEGMENT",
            "start_point": {"x": 3, "y": 1, "z": 2.5},
            "end_point": {"x": 3, "y": 3, "z": 2.5},
        },
        {
            "id": "sg3",
            "system_kind": "HVAC",
            "predefined_type": "RIGIDSEGMENT",
            "start_point": {"x": 3, "y": 3, "z": 2.5},
            "end_point": {"x": 1, "y": 1, "z": 2.5},  # closes the loop
        },
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "MEP_TERMINATES"


def test_mep_terminates_fails_on_orphan_branch():
    d = _valid_dict()
    sys = d["project"]["site"]["building"]["mep_systems"][0]
    # sg1 + sg2 connect to source/terminal already; add an orphan segment far away
    sys["distribution"].append(
        {
            "id": "sg_orphan",
            "system_kind": "HVAC",
            "predefined_type": "RIGIDSEGMENT",
            "start_point": {"x": 100, "y": 100, "z": 2.5},
            "end_point": {"x": 101, "y": 100, "z": 2.5},
        }
    )
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "MEP_TERMINATES"


# ─── 11. STAIR_RISE_MATCHES ──────────────────────────────────────────


def test_stair_rise_matches_passes():
    BuildingModel.build(_valid_dict())  # 14 * 0.2 = 2.8m == structural rise


def test_stair_rise_matches_fails_on_count_mismatch():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["stairs"][0]["riser_count"] = 10
    # 10 * 0.2 = 2.0m != 2.8m structural rise
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "STAIR_RISE_MATCHES"


def test_stair_rise_matches_fails_when_no_storey_above():
    d = _valid_dict()
    # Move stair to storey 1 (the topmost storey) — no storey above for slab_above
    d["project"]["site"]["building"]["storeys"][0]["stairs"] = []
    d["project"]["site"]["building"]["storeys"][1]["stairs"] = [
        {
            "id": "st1",
            "host_storey_id": "s1",
            "riser_count": 14,
            "riser_height": 0.2,
            "tread_depth": 0.28,
            "plan_polygon": [
                {"x": 2, "y": 2},
                {"x": 3, "y": 2},
                {"x": 3, "y": 4},
                {"x": 2, "y": 4},
            ],
        }
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "STAIR_RISE_MATCHES"


def test_stair_rise_matches_fails_when_zero_slabs_on_storey():
    d = _valid_dict()
    # Remove the slab on s1 — no slab_above can be picked
    d["project"]["site"]["building"]["storeys"][1]["slabs"] = []
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "STAIR_RISE_MATCHES"


# ─── 12. FOOTPRINT_VALID ─────────────────────────────────────────────


def test_footprint_valid_passes():
    BuildingModel.build(_valid_dict())


def test_footprint_valid_fails_when_clockwise():
    d = _valid_dict()
    # Reverse the building envelope (CCW → CW)
    d["project"]["site"]["building"]["envelope_polygon"] = [
        {"x": 0, "y": 0},
        {"x": 0, "y": 5},
        {"x": 5, "y": 5},
        {"x": 5, "y": 0},
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "FOOTPRINT_VALID"


def test_footprint_valid_fails_when_self_intersecting():
    d = _valid_dict()
    # Bowtie: (0,0)-(5,5)-(5,0)-(0,5) self-intersects
    d["project"]["site"]["building"]["envelope_polygon"] = [
        {"x": 0, "y": 0},
        {"x": 5, "y": 5},
        {"x": 5, "y": 0},
        {"x": 0, "y": 5},
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "FOOTPRINT_VALID"


def test_footprint_valid_fails_with_too_few_distinct_vertices():
    """Slab footprint with all near-identical points (within 1mm) ⇒ <3 distinct."""
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["slabs"][0][
        "footprint_polygon"
    ] = [
        {"x": 1.0, "y": 1.0},
        {"x": 1.0001, "y": 1.0},
        {"x": 1.0, "y": 1.0001},
        {"x": 1.0001, "y": 1.0001},
    ]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "FOOTPRINT_VALID"


# ─── Defense-in-depth: duplicate-id detection ────────────────────────


def test_duplicate_storey_index_caught_by_validation_context():
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][1]["index"] = 0  # same as s0
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "DUPLICATE_STOREY_INDEX"


def test_duplicate_wall_id_caught():
    d = _valid_dict()
    storey0 = d["project"]["site"]["building"]["storeys"][0]
    # Append a wall with the same id as an existing one
    storey0["walls"].append(
        {
            "id": "w_s",  # collision
            "host_storey_ids": ["s0"],
            "axis_points": [{"x": 0, "y": 0}, {"x": 1, "y": 0}],
            "base_z": 0.0,
            "top_z": 3.0,
            "thickness": 0.2,
        }
    )
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    assert exc.value.rule_id == "DUPLICATE_WALL_ID"


# ─── Error shape contract ────────────────────────────────────────────


def test_error_carries_structured_fields():
    """Every BuildingModelValidationError must carry the 5 spec'd attributes
    so downstream consumers (lift warnings, builder error handlers) can
    surface specific messages instead of generic ones."""
    d = _valid_dict()
    d["project"]["site"]["building"]["storeys"][0]["walls"][0][
        "host_storey_ids"
    ] = ["does-not-exist"]
    with pytest.raises(BuildingModelValidationError) as exc:
        BuildingModel.build(d)
    err = exc.value
    assert err.rule_id == "WALL_HOSTED"
    assert err.node_id == "w_s"
    assert isinstance(err.expected, str) and err.expected
    assert isinstance(err.actual, str) and err.actual
    assert isinstance(err.hint, str) and err.hint
    # Message should include all four for human readability
    msg = str(err)
    assert "WALL_HOSTED" in msg
    assert "w_s" in msg
