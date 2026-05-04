/**
 * Regression test for the production bug observed 2026-05-04.
 *
 * Production evidence: BIMcollab IFC with 1284 elements, 9 with area, 2849 FacetedBrep.
 * All walls/slabs/columns show qty=count, unit=EA despite geometry fallback being "fixed."
 *
 * Root cause: Vercel deployment stale (code in git is correct but hasn't deployed).
 * This test validates that the LOCAL code produces correct results for the exact
 * production input shape.
 */
import { describe, it, expect } from "vitest";
import { estimateGeometryFromType } from "@/app/api/execute-node/handlers/tr-007";

describe("Production bug 2026-05-04 — exact production input", () => {
  // These replicate the EXACT aggregated groups from the production diagnostics
  const productionGroups = [
    { elementType: "IfcWall", count: 45, grossArea: 0, volume: 0, storey: "01 First Floor" },
    { elementType: "IfcWall", count: 57, grossArea: 0, volume: 0, storey: "00 Ground Floor" },
    { elementType: "IfcWall", count: 25, grossArea: 0, volume: 0, storey: "02 Second Floor" },
    { elementType: "IfcWall", count: 23, grossArea: 0, volume: 0, storey: "-01 Foundation" },
    { elementType: "IfcWall", count: 21, grossArea: 0, volume: 0, storey: "03 Roof" },
    { elementType: "IfcSlab", count: 1, grossArea: 0, volume: 0, storey: "00 Ground Floor" },
    { elementType: "IfcSlab", count: 2, grossArea: 0, volume: 0, storey: "01 First Floor" },
    { elementType: "IfcFooting", count: 75, grossArea: 0, volume: 0, storey: "-01 Foundation" },
    { elementType: "IfcColumn", count: 19, grossArea: 0, volume: 0, storey: "00 Ground Floor" },
    { elementType: "IfcBeam", count: 50, grossArea: 0, volume: 0, storey: "00 Ground Floor" },
  ];

  it("estimateGeometryFromType returns non-null for every structural type", () => {
    for (const g of productionGroups) {
      const fb = estimateGeometryFromType(g.elementType, g.count);
      expect(fb, `${g.elementType} (${g.count}) should have fallback`).not.toBeNull();
      // primaryQty is in m² or m³ — may be less than count for volume-based types (e.g., footing 0.675m³/ea)
      expect(fb!.primaryQty, `${g.elementType} (${g.count}) qty should differ from raw count`).not.toBe(g.count);
    }
  });

  it("IfcWall 45 → primaryQty=810 m², NOT 45 EA", () => {
    const fb = estimateGeometryFromType("IfcWall", 45)!;
    expect(fb.primaryQty).toBe(810);
    expect(fb.unit).toBe("m²");
    expect(fb.estArea).toBe(810);
    expect(fb.estVolume).toBe(186.3);
  });

  it("IfcSlab 1 → primaryQty=36 m²", () => {
    const fb = estimateGeometryFromType("IfcSlab", 1)!;
    expect(fb.primaryQty).toBe(36);
    expect(fb.unit).toBe("m²");
  });

  it("IfcFooting 75 → primaryQty=50.63 m³", () => {
    const fb = estimateGeometryFromType("IfcFooting", 75)!;
    expect(fb.primaryQty).toBe(50.63);
    expect(fb.unit).toBe("m³");
    expect(fb.estArea).toBeUndefined(); // footings have no surface area
  });

  it("IfcColumn 19 → primaryQty=9.12 m³", () => {
    const fb = estimateGeometryFromType("IfcColumn", 19)!;
    expect(fb.primaryQty).toBe(9.12);
    expect(fb.unit).toBe("m³");
    expect(fb.estArea).toBe(91.2);
    expect(fb.estVolume).toBe(9.12);
  });

  it("IfcBeam 50 → primaryQty=33.75 m³", () => {
    const fb = estimateGeometryFromType("IfcBeam", 50)!;
    expect(fb.primaryQty).toBe(33.75);
    expect(fb.unit).toBe("m³");
  });

  // Test the cascade logic inline (replicates Mode 1 cascade from tr-007.ts:242-268)
  it("cascade logic: grossArea=0, volume=0 → fallback fires (NOT count fallback)", () => {
    const GEOMETRY_FALLBACKS_LOCAL: Record<string, { areaFactor?: number; volumeFactor?: number; primaryUnit: string }> = {
      IfcWall: { areaFactor: 18, volumeFactor: 4.14, primaryUnit: "m²" },
    };

    const agg = { elementType: "IfcWall", count: 45, grossArea: 0, volume: 0 };

    // Replicate cascade logic exactly
    const fb = GEOMETRY_FALLBACKS_LOCAL[agg.elementType] ? estimateGeometryFromType(agg.elementType, agg.count) : null;
    const areaIsSparse = fb?.estArea && agg.grossArea > 0 && agg.count > 1 && (agg.grossArea / agg.count) < (fb.estArea / agg.count * 0.2);
    const volumeIsSparse = fb?.estVolume && agg.volume > 0 && agg.count > 1 && (agg.volume / agg.count) < (fb.estVolume / agg.count * 0.2);
    const useGeometryFallback = (agg.grossArea === 0 && agg.volume === 0) || (areaIsSparse && volumeIsSparse);

    expect(useGeometryFallback).toBe(true); // grossArea=0 && volume=0 → true
    expect(fb).not.toBeNull();

    // Simulate cascade
    let primaryQty: number;
    let unit: string;
    let estimatedFromCount = false;

    if (!useGeometryFallback && agg.grossArea > 0) {
      primaryQty = agg.grossArea; unit = "m²";
    } else if (!useGeometryFallback && agg.volume > 0) {
      primaryQty = agg.volume; unit = "m³";
    } else if (fb) {
      primaryQty = fb.primaryQty; unit = fb.unit; estimatedFromCount = true;
    } else {
      primaryQty = agg.count; unit = "EA";
    }

    expect(primaryQty).toBe(810);     // NOT 45
    expect(unit).toBe("m²");          // NOT "EA"
    expect(estimatedFromCount).toBe(true);
  });
});
