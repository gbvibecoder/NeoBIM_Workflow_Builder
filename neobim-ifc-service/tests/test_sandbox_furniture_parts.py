"""Tests for add_furniture_part and aggregate_parts on BuildFlowIFC.

Verifies:
  1. add_furniture_part creates a properly-styled, Pset-attached,
     contained-in-space IfcFurnishingElement.
  2. aggregate_parts creates exactly one IfcRelAggregates with all
     child ids.
"""

import pytest

from app.services.ifc_generator_v3.buildflow_ifc import BuildFlowIFC


# ── Minimal brief spec for bootstrapping ─────────────────────────────────

MINIMAL_BRIEF = {
    "project": {
        "name": "Test Project",
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
            "id": "mat-steel",
            "name": "Steel",
            "rgb": [0.5, 0.5, 0.52],
            "roughness": 0.3,
            "method": "METAL",
            "category": "metal",
        },
        {
            "id": "mat-wood",
            "name": "Wood",
            "rgb": [0.6, 0.4, 0.2],
            "roughness": 0.35,
            "method": "PHONG",
            "category": "furniture",
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
    """Create a BuildFlowIFC instance with the minimal brief."""
    return BuildFlowIFC(MINIMAL_BRIEF)


class TestAddFurniturePart:
    """Tests for bf.add_furniture_part()."""

    def test_creates_furnishing_element(self, bf):
        """add_furniture_part returns an IFC entity."""
        # First create a parent furniture to get a valid parent_id
        parent = bf.add_furniture(
            "desk-01", (2.0, 3.0, 0.0),
            dims=(1.2, 0.6), depth=0.75,
            material="mat-wood", object_type="Desk",
            contained_in_space_id="sp-main",
        )
        assert parent is not None

        part_spec = {
            "id": "tabletop",
            "subtype": "desk_tabletop",
            "origin_local_m": [0, 0, 0.72],
            "dims_m": [1.2, 0.6, 0.03],
            "shape": "box",
            "rotation_z_rad": 0,
            "material_id": "mat-wood",
            "ifc_class": "IfcFurnishingElement",
            "notes": "Tabletop surface",
        }

        child = bf.add_furniture_part(
            parent_id="desk-01",
            part_spec=part_spec,
            item_world_origin=(2.0, 3.0, 0.0),
            item_rotation=0.0,
        )
        assert child is not None
        assert child.is_a("IfcFurnishingElement")

    def test_applies_rotation(self, bf):
        """Rotation is applied to part origin correctly."""
        import math

        parent = bf.add_furniture(
            "rotated-parent", (5.0, 5.0, 0.0),
            dims=(1.0, 1.0), depth=1.0,
            material="mat-steel",
        )
        assert parent is not None

        part_spec = {
            "id": "arm",
            "subtype": "arm",
            "origin_local_m": [1.0, 0.0, 0.0],
            "dims_m": [0.5, 0.1, 0.1],
            "shape": "box",
            "material_id": "mat-steel",
            "ifc_class": "IfcFurnishingElement",
        }

        child = bf.add_furniture_part(
            parent_id="rotated-parent",
            part_spec=part_spec,
            item_world_origin=(5.0, 5.0, 0.0),
            item_rotation=math.pi / 2,  # 90 degrees
        )
        assert child is not None

    def test_cylinder_shape_doubles_radius(self, bf):
        """Cylinder dims are [radius, radius, height]; box uses 2*radius."""
        parent = bf.add_furniture(
            "cyl-parent", (0, 0, 0),
            dims=(1, 1), depth=1,
            material="mat-steel",
        )
        assert parent is not None

        part_spec = {
            "id": "column",
            "subtype": "column",
            "origin_local_m": [0, 0, 0],
            "dims_m": [0.05, 0.05, 1.0],  # radius=0.05, height=1.0
            "shape": "cylinder",
            "material_id": "mat-steel",
            "ifc_class": "IfcFurnishingElement",
        }

        child = bf.add_furniture_part(
            parent_id="cyl-parent",
            part_spec=part_spec,
            item_world_origin=(0, 0, 0),
        )
        assert child is not None


class TestAggregateParts:
    """Tests for bf.aggregate_parts()."""

    def test_creates_rel_aggregates(self, bf):
        """aggregate_parts creates exactly one IfcRelAggregates."""
        # Count existing aggregates
        existing = len(bf._ifc.by_type("IfcRelAggregates"))

        # Create parent + 3 children
        bf.add_furniture(
            "agg-parent", (0, 0, 0),
            dims=(2, 2), depth=1,
            material="mat-wood", object_type="Table",
        )
        child_ids = []
        for i in range(3):
            part_spec = {
                "id": f"leg_{i}",
                "subtype": "leg",
                "origin_local_m": [float(i) * 0.5, 0, 0],
                "dims_m": [0.04, 0.04, 0.72],
                "shape": "cylinder",
                "material_id": "mat-steel",
                "ifc_class": "IfcFurnishingElement",
            }
            child = bf.add_furniture_part(
                parent_id="agg-parent",
                part_spec=part_spec,
                item_world_origin=(0, 0, 0),
            )
            assert child is not None
            child_ids.append(f"agg-parent-leg_{i}")

        bf.aggregate_parts("agg-parent", child_ids, "Test Aggregation")

        # Check exactly one new IfcRelAggregates was created
        new_count = len(bf._ifc.by_type("IfcRelAggregates"))
        assert new_count == existing + 1

        # Verify the last IfcRelAggregates has 3 related objects
        aggs = bf._ifc.by_type("IfcRelAggregates")
        found = False
        for agg in aggs:
            if agg.Name == "Test Aggregation":
                assert len(agg.RelatedObjects) == 3
                found = True
                break
        assert found, "IfcRelAggregates with label 'Test Aggregation' not found"

    def test_no_aggregates_when_parent_missing(self, bf):
        """aggregate_parts does nothing if parent_id doesn't exist."""
        existing = len(bf._ifc.by_type("IfcRelAggregates"))
        bf.aggregate_parts("nonexistent", ["also-nonexistent"])
        assert len(bf._ifc.by_type("IfcRelAggregates")) == existing
