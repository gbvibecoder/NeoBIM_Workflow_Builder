"""Slice 2B.3 Phase A.1 — Door.predefined_type tests.

Schema-level checks. The IFC builder mapping (Door.predefined_type →
IfcDoor.PredefinedType) is exercised in Phase C end-to-end tests; this
file is purely the Pydantic enum contract.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.domain.building_model import Door


def test_door_default_predefined_type_is_DOOR() -> None:
    """Default value preserves byte-identity for every pre-2B.3 fixture."""
    d = Door(
        id="d-1",
        in_opening_id="o-1",
        connects_room_ids=["Outside"],
        swing="inward",
        handedness="left",
    )
    assert d.predefined_type == "DOOR"


def test_door_accepts_GATE_predefined_type() -> None:
    """The new GATE value supports the entry-gate extension."""
    d = Door(
        id="d-gate-1",
        in_opening_id="o-gate-1",
        connects_room_ids=["Outside"],
        swing="sliding",
        handedness="left",
        predefined_type="GATE",
    )
    assert d.predefined_type == "GATE"


def test_door_accepts_GARAGE_DOOR_predefined_type() -> None:
    """Reserved for a future garage extension."""
    d = Door(
        id="d-g-1",
        in_opening_id="o-g-1",
        connects_room_ids=["Outside"],
        swing="folding",
        handedness="left",
        predefined_type="GARAGE_DOOR",
    )
    assert d.predefined_type == "GARAGE_DOOR"


def test_door_rejects_unknown_predefined_type() -> None:
    with pytest.raises(ValidationError):
        Door(
            id="d-x",
            in_opening_id="o-x",
            connects_room_ids=["Outside"],
            swing="inward",
            handedness="left",
            predefined_type="ROLLING_SHUTTER",  # not in enum
        )
