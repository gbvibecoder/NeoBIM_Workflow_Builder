"""Python side of the Track C TS→Python boundary contract.

Mirror of tests/integration/ifc-track-c-boundary.test.ts. Feeds a JSON
payload containing every new Track C camelCase field + every new type/ifcType
literal and asserts Pydantic preserves them all (no silent drops via
extra='ignore').

If either this file or the TS sibling test drifts from the other, the boundary
has desynced — update whichever side changed, or rename a field in both.

Related: docs/ifc-phase-1-subplan.md § C6.
"""

from __future__ import annotations

import json

import pytest

from app.models.request import ElementProperties, GeometryElement


ARCH_FIELDS = [
    ("wallType", "exterior"),
    ("loadBearing", True),
    ("fireRating", "2HR"),
    ("acousticRating", "STC-50"),
    ("uValue", 0.35),
    ("glazingType", "double-low-e"),
    ("frameMaterial", "aluminum"),
    ("operationType", "casement"),
    ("handedness", "left"),
    ("finishMaterial", "paint"),
    ("occupancyType", "office"),
]

STRUCT_FIELDS = [
    ("structuralMaterial", "concrete"),
    ("materialGrade", "C30/37"),
    ("sectionProfile", "W12x26"),
    ("rebarRatio", 85),
    ("concreteStrength", 30),
    ("memberRole", "primary"),
    ("axialLoad", 1200),
    ("spanLength", 7.5),
]

MEP_FIELDS = [
    ("mepSystem", "hvac-supply"),
    ("flowRate", 0.25),
    ("pressure", 250),
    ("voltage", 240),
    ("powerRating", 1500),
    ("insulationThickness", 0.025),
    ("connectionSize", 100),
]

NEW_TYPES = [
    "railing", "ramp", "covering-ceiling", "covering-floor", "furniture",
    "plate", "member", "footing", "curtain-wall",
    "sanitary-terminal", "light-fixture", "air-terminal", "flow-terminal",
]

NEW_IFC_TYPES = [
    "IfcRamp", "IfcFurniture", "IfcPlate", "IfcMember", "IfcCurtainWall",
    "IfcSanitaryTerminal", "IfcLightFixture", "IfcAirTerminal",
]


def _max_props_payload() -> dict:
    payload = {"name": "boundary-test", "storeyIndex": 0}
    for key, value in ARCH_FIELDS + STRUCT_FIELDS + MEP_FIELDS:
        payload[key] = value
    return payload


def test_element_properties_accepts_every_track_c_field():
    payload = _max_props_payload()
    props = ElementProperties.model_validate(payload)

    # Assert each field survived the TS→Python alias mapping.
    for wire_name, expected in ARCH_FIELDS + STRUCT_FIELDS + MEP_FIELDS:
        # Python uses snake_case; map wire name → attribute name.
        # Pydantic's `alias` handles the lookup — we access via the Python name.
        py_name = _camel_to_snake(wire_name)
        actual = getattr(props, py_name)
        assert actual == expected, f"{wire_name} → {py_name}: expected {expected!r}, got {actual!r}"


def test_field_counts_match_contract():
    assert len(ARCH_FIELDS) + len(STRUCT_FIELDS) + len(MEP_FIELDS) == 26, (
        "Track C promised 26 new ElementProperties fields — adjust "
        "both this test and the TS sibling if you change the contract."
    )


def test_json_serialization_uses_camel_case_aliases():
    payload = _max_props_payload()
    props = ElementProperties.model_validate(payload)

    # Emit back with aliases — this is what the Python builder or a
    # downstream re-export would produce. Must match TS camelCase.
    emitted = json.loads(props.model_dump_json(by_alias=True))
    for wire_name, _ in ARCH_FIELDS + STRUCT_FIELDS + MEP_FIELDS:
        assert wire_name in emitted, f"alias {wire_name} missing from serialized output"


@pytest.mark.parametrize("type_literal", NEW_TYPES)
def test_geometry_element_accepts_new_type_literal(type_literal):
    el = GeometryElement.model_validate(
        {
            "id": f"el-{type_literal}",
            "type": type_literal,
            "vertices": [],
            "faces": [],
            "ifcType": "IfcBuildingElementProxy",
            "properties": {"name": type_literal, "storeyIndex": 0},
        }
    )
    assert el.type == type_literal


@pytest.mark.parametrize("ifc_type_literal", NEW_IFC_TYPES)
def test_geometry_element_accepts_new_ifc_type_literal(ifc_type_literal):
    el = GeometryElement.model_validate(
        {
            "id": f"el-{ifc_type_literal}",
            "type": "equipment",
            "vertices": [],
            "faces": [],
            "ifcType": ifc_type_literal,
            "properties": {"name": ifc_type_literal, "storeyIndex": 0},
        }
    )
    assert el.ifc_type == ifc_type_literal


def test_new_type_literal_count():
    assert len(NEW_TYPES) == 13


def test_new_ifc_type_literal_count():
    assert len(NEW_IFC_TYPES) == 8


# ── Helpers ────────────────────────────────────────────────────────────


def _camel_to_snake(name: str) -> str:
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i > 0:
            out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch.lower())
    return "".join(out)
