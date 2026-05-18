"""Verify detect_overreach() correctly flags unfaithful spec enrichment.

Tests the faithfulness rule: elements in the spec that were NOT mentioned
in the brief are flagged as overreach.
"""

from __future__ import annotations


def test_flags_reception_desk_when_brief_has_none():
    """A thin brief about walls and a door should flag a reception desk."""
    from app.services.ifc_generator_v3.spec_validator import detect_overreach

    brief = "10x4m office, 4 walls, 1 door, 2 windows."
    spec = {
        "elements": [
            {"id": "w1", "type": "wall", "description": "Wall"},
            {"id": "d1", "type": "door", "description": "Door"},
        ],
        "furniture": [
            {"id": "f1", "type": "reception desk", "description": "Reception desk near entry"},
        ],
        "spaces": [],
        "lighting": {},
    }
    flags = detect_overreach(spec, brief)
    assert "reception" in flags, f"Expected 'reception' flagged, got {flags}"


def test_no_false_positive_when_brief_mentions_reception():
    """If the brief explicitly says 'reception desk', don't flag it."""
    from app.services.ifc_generator_v3.spec_validator import detect_overreach

    brief = "Small office with a reception desk near the entrance."
    spec = {
        "elements": [],
        "furniture": [
            {"id": "f1", "type": "reception desk", "description": "Reception at entry"},
        ],
        "spaces": [],
        "lighting": {},
    }
    flags = detect_overreach(spec, brief)
    assert "reception" not in flags, f"False positive: 'reception' flagged but brief mentions it"


def test_flags_ceiling_fan_in_classroom_when_brief_silent():
    """A classroom brief that doesn't mention fans should flag ceiling fan."""
    from app.services.ifc_generator_v3.spec_validator import detect_overreach

    brief = "Small classroom, 30 students, whiteboard, 5 windows."
    spec = {
        "elements": [],
        "furniture": [
            {"id": "f1", "type": "ceiling fan", "description": "Ceiling fan"},
        ],
        "spaces": [{"id": "s1", "name": "classroom", "occupancy_type": "classroom"}],
        "lighting": {},
    }
    flags = detect_overreach(spec, brief)
    assert "ceiling fan" in flags


def test_empty_spec_no_flags():
    """An empty spec should never flag anything."""
    from app.services.ifc_generator_v3.spec_validator import detect_overreach

    flags = detect_overreach(
        {"elements": [], "furniture": [], "spaces": [], "lighting": {}},
        "anything",
    )
    assert flags == []
