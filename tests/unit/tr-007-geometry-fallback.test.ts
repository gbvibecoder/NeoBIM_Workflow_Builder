/**
 * Regression test for Fix #2 — Geometry fallback in TR-007.
 *
 * When IFC elements have grossArea=0 and volume=0 (common with text-parser
 * fallback or IfcFacetedBrep geometry), TR-007 now estimates area/volume from
 * element type × count using standard Indian construction dimensions.
 *
 * Tests the exported estimateGeometryFromType() helper directly.
 * Full TR-007 handler integration is impractical to mock (requires web-ifc WASM).
 */
import { describe, it, expect } from "vitest";
import { estimateGeometryFromType } from "@/app/api/execute-node/handlers/tr-007";

describe("Fix #2 — Geometry fallback from element type", () => {
  // ── Case 1: Wall with zero area + zero volume + count=45 ──
  it("Wall: 45 × 18m² = 810 m²", () => {
    const result = estimateGeometryFromType("IfcWall", 45);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(810);
    expect(result!.unit).toBe("m²");
  });

  // ── Case 2: Slab with zero area + zero volume + count=10 ──
  it("Slab: 10 × 36m² = 360 m²", () => {
    const result = estimateGeometryFromType("IfcSlab", 10);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(360);
    expect(result!.unit).toBe("m²");
  });

  // ── Case 3: Column with zero area + zero volume + count=20 ──
  it("Column: 20 × 0.48m³ = 9.6 m³", () => {
    const result = estimateGeometryFromType("IfcColumn", 20);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(9.6);
    expect(result!.unit).toBe("m³");
  });

  // ── Case 4: Door with zero area + count=29 → matches user's observed value ──
  it("Door: 29 × 1.89m² = 54.81 m² (matches user's observed Excel value)", () => {
    const result = estimateGeometryFromType("IfcDoor", 29);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(54.81);
    expect(result!.unit).toBe("m²");
  });

  // ── Case 5: Wall with REAL area → fallback not called (handled by cascade) ──
  // This tests that the function itself doesn't guard against real data —
  // the cascade in TR-007 only calls estimateGeometryFromType when area=0 AND volume=0.
  it("function returns estimate regardless (cascade guards the call)", () => {
    // estimateGeometryFromType doesn't know about real area — it's the
    // cascade that decides when to call it. This test just confirms the
    // math for a wall with count=45 is always 810.
    const result = estimateGeometryFromType("IfcWall", 45);
    expect(result!.quantity).toBe(810);
  });

  // ── Case 6: IfcFlowTerminal → null (no fallback, count is correct unit) ──
  it("IfcFlowTerminal: returns null (MEP terminals stay as EA count)", () => {
    const result = estimateGeometryFromType("IfcFlowTerminal", 16);
    expect(result).toBeNull();
  });

  // ── Case 7: IfcBuildingElementProxy → null (no fallback) ──
  it("IfcBuildingElementProxy: returns null (proxies stay as EA count)", () => {
    const result = estimateGeometryFromType("IfcBuildingElementProxy", 3);
    expect(result).toBeNull();
  });

  // ── Case 8: Unknown type → null ──
  it("Unknown IFC type: returns null", () => {
    const result = estimateGeometryFromType("IfcSpaceBoundary", 5);
    expect(result).toBeNull();
  });

  // ── Beam and Footing volume checks ──
  it("Beam: 50 × 0.675m³ = 33.75 m³", () => {
    const result = estimateGeometryFromType("IfcBeam", 50);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(33.75);
    expect(result!.unit).toBe("m³");
  });

  it("Footing: 75 × 0.675m³ = 50.63 m³", () => {
    const result = estimateGeometryFromType("IfcFooting", 75);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(50.63);
    expect(result!.unit).toBe("m³");
  });

  // ── Stair and CurtainWall ──
  it("StairFlight: 3 × 4.8m² = 14.4 m²", () => {
    const result = estimateGeometryFromType("IfcStairFlight", 3);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(14.4);
    expect(result!.unit).toBe("m²");
  });

  it("CurtainWall: 675 × 4.5m² = 3037.5 m²", () => {
    const result = estimateGeometryFromType("IfcCurtainWall", 675);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(3037.5);
    expect(result!.unit).toBe("m²");
  });

  // ── Window matches text-parser constant ──
  it("Window: 23 × 1.8m² = 41.4 m² (matches user's observed value)", () => {
    const result = estimateGeometryFromType("IfcWindow", 23);
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(41.4);
    expect(result!.unit).toBe("m²");
  });

  // ── WallStandardCase uses same factor as IfcWall ──
  it("WallStandardCase: same factor as IfcWall", () => {
    const wall = estimateGeometryFromType("IfcWall", 10);
    const wallStd = estimateGeometryFromType("IfcWallStandardCase", 10);
    expect(wall!.quantity).toBe(wallStd!.quantity);
    expect(wall!.unit).toBe(wallStd!.unit);
  });
});
