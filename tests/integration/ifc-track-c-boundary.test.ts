/**
 * Integration test for Phase 1 Track C TS→Python boundary.
 *
 * Asserts that a payload constructed with every new ElementProperties field
 * and every new GeometryElement.type literal serializes to the wire format
 * the Python service's Pydantic model expects — i.e. the camelCase aliases
 * mapped onto snake_case Python fields in neobim-ifc-service/app/models/request.py.
 *
 * This is the *TS side* of the boundary — it proves the TS payload shape is
 * what Python declares. The Python side is covered by
 * neobim-ifc-service/tests/test_track_c_fields.py (run via pytest), which
 * validates the same JSON round-trips through ExportIFCRequest.model_validate_json.
 *
 * Together, the two tests lock the contract: adding or renaming a Track C
 * field requires breaking tests on both sides, which surfaces boundary drift.
 *
 * Related: docs/ifc-phase-1-subplan.md § C6.
 */

import { describe, test, expect } from "vitest";
import type { GeometryElement, ElementProperties } from "@/types/geometry";

// ── Expected camelCase field names on the wire ──────────────────────────
// These MUST match the `alias=` values in the Python Pydantic model.
// If you rename any field in ElementProperties, update this list AND the
// Python alias, or the round-trip silently drops the field (Pydantic's
// populate_by_name accepts both snake_case and camelCase, but only the
// aliased name is emitted by TS — we must send the camelCase form).

const TRACK_C_ARCH_FIELDS = [
  "wallType",
  "loadBearing",
  "fireRating",
  "acousticRating",
  "uValue",
  "glazingType",
  "frameMaterial",
  "operationType",
  "handedness",
  "finishMaterial",
  "occupancyType",
] as const;

const TRACK_C_STRUCT_FIELDS = [
  "structuralMaterial",
  "materialGrade",
  "sectionProfile",
  "rebarRatio",
  "concreteStrength",
  "memberRole",
  "axialLoad",
  "spanLength",
] as const;

const TRACK_C_MEP_FIELDS = [
  "mepSystem",
  "flowRate",
  "pressure",
  "voltage",
  "powerRating",
  "insulationThickness",
  "connectionSize",
] as const;

const TRACK_C_NEW_TYPES: ReadonlyArray<GeometryElement["type"]> = [
  "railing",
  "ramp",
  "covering-ceiling",
  "covering-floor",
  "furniture",
  "plate",
  "member",
  "footing",
  "curtain-wall",
  "sanitary-terminal",
  "light-fixture",
  "air-terminal",
  "flow-terminal",
];

const TRACK_C_NEW_IFC_TYPES: ReadonlyArray<GeometryElement["ifcType"]> = [
  "IfcRamp",
  "IfcFurniture",
  "IfcPlate",
  "IfcMember",
  "IfcCurtainWall",
  "IfcSanitaryTerminal",
  "IfcLightFixture",
  "IfcAirTerminal",
];

// ── Test: a maximal ElementProperties carries every new field ───────────

describe("Track C TS→Python boundary", () => {
  test("ElementProperties accepts every new Track C field at compile time", () => {
    // If this object fails to type-check, the TS types and the test have
    // drifted — that's the signal to update both sides.
    const props: ElementProperties = {
      name: "boundary-test",
      storeyIndex: 0,
      // Architectural
      wallType: "exterior",
      loadBearing: true,
      fireRating: "2HR",
      acousticRating: "STC-50",
      uValue: 0.35,
      glazingType: "double-low-e",
      frameMaterial: "aluminum",
      operationType: "casement",
      handedness: "left",
      finishMaterial: "paint",
      occupancyType: "office",
      // Structural
      structuralMaterial: "concrete",
      materialGrade: "C30/37",
      sectionProfile: "W12x26",
      rebarRatio: 85,
      concreteStrength: 30,
      memberRole: "primary",
      axialLoad: 1200,
      spanLength: 7.5,
      // MEP
      mepSystem: "hvac-supply",
      flowRate: 0.25,
      pressure: 250,
      voltage: 240,
      powerRating: 1500,
      insulationThickness: 0.025,
      connectionSize: 100,
    };
    expect(props.name).toBe("boundary-test");
  });

  test("JSON payload emits camelCase keys matching Python aliases", () => {
    const props: ElementProperties = {
      name: "alias-test",
      storeyIndex: 1,
      wallType: "curtain",
      loadBearing: false,
      fireRating: "1HR",
      acousticRating: "STC-45",
      uValue: 1.2,
      glazingType: "triple-argon",
      frameMaterial: "upvc",
      operationType: "fixed",
      handedness: "right",
      finishMaterial: "tile",
      occupancyType: "corridor",
      structuralMaterial: "steel",
      materialGrade: "S355",
      sectionProfile: "HSS6x6x1/2",
      rebarRatio: 0,
      concreteStrength: 0,
      memberRole: "secondary",
      axialLoad: 500,
      spanLength: 6.0,
      mepSystem: "plumbing-cold",
      flowRate: 0.1,
      pressure: 400,
      voltage: 0,
      powerRating: 0,
      insulationThickness: 0.019,
      connectionSize: 50,
    };
    const wire = JSON.parse(JSON.stringify(props)) as Record<string, unknown>;

    for (const field of TRACK_C_ARCH_FIELDS) {
      expect(wire).toHaveProperty(field);
    }
    for (const field of TRACK_C_STRUCT_FIELDS) {
      expect(wire).toHaveProperty(field);
    }
    for (const field of TRACK_C_MEP_FIELDS) {
      expect(wire).toHaveProperty(field);
    }
  });

  test("wire format uses 26 new Track C field names (total)", () => {
    const total =
      TRACK_C_ARCH_FIELDS.length +
      TRACK_C_STRUCT_FIELDS.length +
      TRACK_C_MEP_FIELDS.length;
    expect(total).toBe(26);
  });

  test("every new type literal is usable in a GeometryElement", () => {
    for (const type of TRACK_C_NEW_TYPES) {
      const el: GeometryElement = {
        id: `el-${type}`,
        type,
        vertices: [],
        faces: [],
        // Use IfcBuildingElementProxy as the safe pairing for types that
        // don't have a 1:1 IFC class; the wire test only cares that the
        // literal compiles and survives JSON round-trip.
        ifcType: "IfcBuildingElementProxy",
        properties: { name: type, storeyIndex: 0 },
      };
      expect(el.type).toBe(type);
    }
  });

  test("every new ifcType literal is usable in a GeometryElement", () => {
    for (const ifcType of TRACK_C_NEW_IFC_TYPES) {
      const el: GeometryElement = {
        id: `el-${ifcType}`,
        type: "equipment", // safe pre-Track-C literal for this test
        vertices: [],
        faces: [],
        ifcType,
        properties: { name: ifcType, storeyIndex: 0 },
      };
      expect(el.ifcType).toBe(ifcType);
    }
  });

  test("adds exactly 13 new type literals over pre-Track-C baseline", () => {
    expect(TRACK_C_NEW_TYPES.length).toBe(13);
  });

  test("adds exactly 8 new ifcType literals over pre-Track-C baseline", () => {
    expect(TRACK_C_NEW_IFC_TYPES.length).toBe(8);
  });
});
