/**
 * Tests for the shared geometry-fallback module — single source of truth.
 */
import { describe, it, expect } from "vitest";
import {
  GEOMETRY_FALLBACKS,
  estimateGeometryFromType,
  shouldUseGeometryFallback,
} from "@/features/boq/lib/geometry-fallback";

describe("geometry-fallback shared module", () => {
  it("has IfcWall with correct factors", () => {
    expect(GEOMETRY_FALLBACKS.IfcWall).toEqual({
      areaFactor: 18, volumeFactor: 4.14, primaryUnit: "m²",
    });
  });

  it("has IfcWallStandardCase identical to IfcWall", () => {
    expect(GEOMETRY_FALLBACKS.IfcWallStandardCase).toEqual(GEOMETRY_FALLBACKS.IfcWall);
  });

  it("has all 13 element types", () => {
    const keys = Object.keys(GEOMETRY_FALLBACKS);
    expect(keys).toContain("IfcWall");
    expect(keys).toContain("IfcSlab");
    expect(keys).toContain("IfcColumn");
    expect(keys).toContain("IfcBeam");
    expect(keys).toContain("IfcFooting");
    expect(keys).toContain("IfcDoor");
    expect(keys).toContain("IfcWindow");
    expect(keys).toContain("IfcCurtainWall");
    expect(keys.length).toBe(13);
  });

  it("estimateGeometryFromType: 45 walls → 810 m² + 186.30 m³", () => {
    const r = estimateGeometryFromType("IfcWall", 45)!;
    expect(r.primaryQty).toBe(810);
    expect(r.unit).toBe("m²");
    expect(r.estArea).toBe(810);
    expect(r.estVolume).toBe(186.3);
  });

  it("estimateGeometryFromType: unknown type → null", () => {
    expect(estimateGeometryFromType("IfcSomethingExotic", 5)).toBeNull();
  });

  it("shouldUseGeometryFallback: both zero → true", () => {
    expect(shouldUseGeometryFallback({
      elementType: "IfcWall", count: 45, grossArea: 0, volume: 0,
    })).toBe(true);
  });

  it("shouldUseGeometryFallback: sparse partial extraction → true", () => {
    expect(shouldUseGeometryFallback({
      elementType: "IfcWall", count: 45, grossArea: 5, volume: 1,
    })).toBe(true);
  });

  it("shouldUseGeometryFallback: real geometry → false", () => {
    expect(shouldUseGeometryFallback({
      elementType: "IfcWall", count: 45, grossArea: 810, volume: 186,
    })).toBe(false);
  });

  it("shouldUseGeometryFallback: unknown type → false", () => {
    expect(shouldUseGeometryFallback({
      elementType: "IfcFlowTerminal", count: 16, grossArea: 0, volume: 0,
    })).toBe(false);
  });
});
