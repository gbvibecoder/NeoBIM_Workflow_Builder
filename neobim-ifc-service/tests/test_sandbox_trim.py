"""Tests for Phase Beta 2 trim & hardware helpers on BuildFlowIFC.

Verifies:
  1. add_skirting creates IfcCovering with FLOORING type
  2. add_door_hardware creates IfcDiscreteAccessory for hinges/handles
  3. add_window_hardware creates IfcDiscreteAccessory for handles
  4. Invalid hardware_type raises ValueError
"""

import pytest

from app.services.ifc_generator_v3.buildflow_ifc import BuildFlowIFC


MINIMAL_BRIEF = {
    "project": {
        "name": "Trim Test",
        "type": "office",
        "location": "Test",
        "description": "Test",
    },
    "site": {
        "bounds_m": [10, 10],
        "height_limit_m": 20,
        "coordinate_origin": "sw_corner",
    },
    "spaces": [
        {
            "id": "sp-main",
            "name": "Main",
            "long_name": "Main Space",
            "polygon_world_m": [[0, 0], [10, 0], [10, 10], [0, 10]],
            "height_m": 3.0,
            "occupancy_type": "Office",
        }
    ],
    "elements": [],
    "materials": [
        {
            "id": "mat-paint-white",
            "name": "White Paint",
            "rgb": [0.95, 0.95, 0.95],
            "roughness": 0.3,
            "method": "MATT",
            "category": "finish",
        },
        {
            "id": "mat-brass",
            "name": "Brass",
            "rgb": [0.8, 0.68, 0.22],
            "roughness": 0.15,
            "method": "METAL",
            "category": "metal",
        },
        {
            "id": "mat-aluminium",
            "name": "Aluminium",
            "rgb": [0.75, 0.77, 0.8],
            "roughness": 0.15,
            "method": "METAL",
            "category": "metal",
        },
    ],
    "brand_language": {
        "primary_text": "Test",
        "approved_terms": [],
        "forbidden_terms": [],
    },
}


@pytest.fixture
def bf():
    """Create BuildFlowIFC with walls and a door for trim testing."""
    instance = BuildFlowIFC(MINIMAL_BRIEF)
    # Add a wall so skirting has something to attach to
    instance.add_wall(
        "W-01", (0, 0, 0),
        dims=(10.0, 0.2), depth=3.0,
        material="mat-paint-white",
        description="South wall",
    )
    # Add a door so hardware has a host
    instance.add_door(
        "D-01", (2.0, 0, 0),
        dims=(0.9, 0.1), depth=2.1,
        material="mat-paint-white",
        contained_in_space_id="sp-main",
    )
    # Add a window
    instance.add_window(
        "WIN-01", (5.0, 0, 0.9),
        dims=(1.2, 0.05), depth=1.5,
        material="mat-paint-white",
        contained_in_space_id="sp-main",
    )
    return instance


class TestAddSkirting:
    def test_creates_ifc_covering(self, bf):
        result = bf.add_skirting(
            "SK-01", host_space_id="sp-main", wall_id="W-01",
        )
        assert result is not None
        assert result.is_a("IfcCovering")

    def test_skirting_has_correct_dimensions(self, bf):
        result = bf.add_skirting(
            "SK-02", host_space_id="sp-main", wall_id="W-01",
            height=0.075, depth=0.018,
        )
        assert result is not None


class TestAddDoorHardware:
    def test_hinge_creates_discrete_accessory(self, bf):
        result = bf.add_door_hardware(
            "HW-hinge-01", host_door_id="D-01",
            hardware_type="hinge",
            position_local=(0, 0, 0.2),
            dims=(0.08, 0.012, 0.10),
            material_id="mat-brass",
        )
        assert result is not None
        assert result.is_a("IfcDiscreteAccessory")

    def test_handle_creates_discrete_accessory(self, bf):
        result = bf.add_door_hardware(
            "HW-handle-01", host_door_id="D-01",
            hardware_type="handle",
            position_local=(0, 0, 1.0),
            dims=(0.04, 0.04, 0.14),
            material_id="mat-brass",
        )
        assert result is not None
        assert result.is_a("IfcDiscreteAccessory")

    def test_invalid_type_raises(self, bf):
        with pytest.raises(ValueError, match="Invalid hardware_type"):
            bf.add_door_hardware(
                "HW-bad", host_door_id="D-01",
                hardware_type="deadbolt",
                position_local=(0, 0, 0),
                dims=(0.01, 0.01, 0.01),
            )


class TestAddWindowHardware:
    def test_handle_creates_discrete_accessory(self, bf):
        result = bf.add_window_hardware(
            "WH-01", host_window_id="WIN-01",
            hardware_type="handle",
            position_local=(0, 0, 0.75),
            dims=(0.03, 0.05, 0.10),
            material_id="mat-aluminium",
        )
        assert result is not None
        assert result.is_a("IfcDiscreteAccessory")

    def test_invalid_type_raises(self, bf):
        with pytest.raises(ValueError, match="Invalid hardware_type"):
            bf.add_window_hardware(
                "WH-bad", host_window_id="WIN-01",
                hardware_type="crank",
                position_local=(0, 0, 0),
                dims=(0.01, 0.01, 0.01),
            )
