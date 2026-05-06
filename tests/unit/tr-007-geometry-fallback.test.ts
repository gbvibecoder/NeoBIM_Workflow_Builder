/**
 * Regression test for Fix #2 + Fix #2.1 — Geometry fallback in TR-007.
 *
 * When IFC elements have grossArea=0 and volume=0 (common with text-parser
 * fallback or IfcFacetedBrep geometry), TR-007 estimates area AND volume from
 * element type × count using standard Indian construction dimensions.
 *
 * Fix #2.1 upgraded the fallback to dual-output: elements like walls now emit
 * BOTH estArea (for plaster/paint/formwork) AND estVolume (for RCC/rebar),
 * fixing the 45-qty bug where TR-008 saw zero volume for estimated walls.
 */
import { describe, it, expect } from "vitest";
import { estimateGeometryFromType } from "@/app/api/execute-node/handlers/tr-007";

describe("Fix #2.1 — Dual-output geometry fallback", () => {
  // ── 1. Wall: BOTH area and volume ──
  it("Wall count=45 → primaryQty=810 m², estArea=810, estVolume=186.30", () => {
    const r = estimateGeometryFromType("IfcWall", 45)!;
    expect(r).not.toBeNull();
    expect(r.primaryQty).toBe(810);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(810);
    expect(r.estVolume).toBe(186.3);  // 45 × 4.14
  });

  // ── 2. Slab: BOTH area and volume ──
  it("Slab count=10 → primaryQty=360 m², estArea=360, estVolume=54", () => {
    const r = estimateGeometryFromType("IfcSlab", 10)!;
    expect(r.primaryQty).toBe(360);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(360);
    expect(r.estVolume).toBe(54);  // 10 × 5.4
  });

  // ── 3. Column: BOTH area and volume ──
  it("Column count=20 → primaryQty=9.6 m³, estArea=96, estVolume=9.6", () => {
    const r = estimateGeometryFromType("IfcColumn", 20)!;
    expect(r.primaryQty).toBe(9.6);
    expect(r.unit).toBe("m³");
    expect(r.estArea).toBe(96);     // 20 × 4.80
    expect(r.estVolume).toBe(9.6);  // 20 × 0.48
  });

  // ── 4. Beam: BOTH area and volume ──
  it("Beam count=30 → primaryQty=20.25 m³, estArea=225, estVolume=20.25", () => {
    const r = estimateGeometryFromType("IfcBeam", 30)!;
    expect(r.primaryQty).toBe(20.25);
    expect(r.unit).toBe("m³");
    expect(r.estArea).toBe(225);      // 30 × 7.5
    expect(r.estVolume).toBe(20.25);  // 30 × 0.675
  });

  // ── 5. Footing: volume only (underground, no plaster surface) ──
  it("Footing count=12 → primaryQty=8.1 m³, estArea=undefined, estVolume=8.1", () => {
    const r = estimateGeometryFromType("IfcFooting", 12)!;
    expect(r.primaryQty).toBe(8.1);
    expect(r.unit).toBe("m³");
    expect(r.estArea).toBeUndefined();
    expect(r.estVolume).toBe(8.1);  // 12 × 0.675
  });

  // ── 6. Door: area only (no concrete volume) ──
  it("Door count=29 → primaryQty=54.81 m², estArea=54.81, estVolume=undefined", () => {
    const r = estimateGeometryFromType("IfcDoor", 29)!;
    expect(r.primaryQty).toBe(54.81);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(54.81);
    expect(r.estVolume).toBeUndefined();
  });

  // ── 7. CurtainWall: area only ──
  it("CurtainWall count=675 → primaryQty=3037.5 m², estArea=3037.5, estVolume=undefined", () => {
    const r = estimateGeometryFromType("IfcCurtainWall", 675)!;
    expect(r.primaryQty).toBe(3037.5);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(3037.5);
    expect(r.estVolume).toBeUndefined();
  });

  // ── 8. IfcFlowTerminal: null (no fallback) ──
  it("IfcFlowTerminal → null (stays as EA count)", () => {
    expect(estimateGeometryFromType("IfcFlowTerminal", 16)).toBeNull();
  });

  // ── 9. IfcBuildingElementProxy: null ──
  it("IfcBuildingElementProxy → null (stays as EA count)", () => {
    expect(estimateGeometryFromType("IfcBuildingElementProxy", 3)).toBeNull();
  });

  // ── 10. Unknown type: null ──
  it("Unknown IFC type → null", () => {
    expect(estimateGeometryFromType("IfcSpaceBoundary", 5)).toBeNull();
  });

  // ── Additional: StairFlight gets both ──
  it("StairFlight count=3 → area=14.4, volume=2.16", () => {
    const r = estimateGeometryFromType("IfcStairFlight", 3)!;
    expect(r.primaryQty).toBe(14.4);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(14.4);
    expect(r.estVolume).toBe(2.16);  // 3 × 0.72
  });

  // ── Window: area only ──
  it("Window count=23 → 41.4 m², no volume", () => {
    const r = estimateGeometryFromType("IfcWindow", 23)!;
    expect(r.primaryQty).toBe(41.4);
    expect(r.estArea).toBe(41.4);
    expect(r.estVolume).toBeUndefined();
  });

  // ── WallStandardCase same as IfcWall ──
  it("WallStandardCase: same factors as IfcWall", () => {
    const w = estimateGeometryFromType("IfcWall", 10)!;
    const ws = estimateGeometryFromType("IfcWallStandardCase", 10)!;
    expect(w.primaryQty).toBe(ws.primaryQty);
    expect(w.estArea).toBe(ws.estArea);
    expect(w.estVolume).toBe(ws.estVolume);
  });

  // ── Covering: area only, no volume ──
  it("Covering count=86 → 86 m², no volume", () => {
    const r = estimateGeometryFromType("IfcCovering", 86)!;
    expect(r.primaryQty).toBe(86);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(86);
    expect(r.estVolume).toBeUndefined();
  });

  // ── Roof: same factors as slab ──
  it("Roof count=1 → area=36, volume=5.4", () => {
    const r = estimateGeometryFromType("IfcRoof", 1)!;
    expect(r.estArea).toBe(36);
    expect(r.estVolume).toBe(5.4);
  });
});
