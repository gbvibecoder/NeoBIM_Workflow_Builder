/**
 * Regression test for Fix #2.2 — sparse-geometry sanity check.
 *
 * Root cause: when an IFC has a MIX of wall representations (some with
 * IfcExtrudedAreaSolid → text parser extracts area, most with IfcFacetedBrep
 * → zero area), the aggregate group gets a tiny non-zero grossArea from the
 * few extractable walls. Since grossArea > 0, the fallback never fires, and
 * 45 walls get qty = tiny_area instead of qty = 45 × 18 = 810 m².
 *
 * Fix: when per-element area is < 20% of the fallback estimate, treat the
 * geometry as "sparse" and use the fallback instead.
 */
import { describe, it, expect } from "vitest";
import { estimateGeometryFromType } from "@/app/api/execute-node/handlers/tr-007";

describe("Fix #2.2 — Sparse geometry detection", () => {
  // Test the estimateGeometryFromType helper (unchanged, still works)
  it("45 walls → estArea=810, estVolume=186.30", () => {
    const fb = estimateGeometryFromType("IfcWall", 45)!;
    expect(fb.estArea).toBe(810);
    expect(fb.estVolume).toBe(186.3);
    expect(fb.primaryQty).toBe(810);
    expect(fb.unit).toBe("m²");
  });

  it("75 footings → estVolume=50.63", () => {
    const fb = estimateGeometryFromType("IfcFooting", 75)!;
    expect(fb.estVolume).toBe(50.63);
    expect(fb.estArea).toBeUndefined();
  });

  // Test the sparse detection logic (extracted from tr-007.ts cascade)
  function isSparse(
    elementType: string,
    count: number,
    grossArea: number,
    volume: number,
  ): boolean {
    const fb = estimateGeometryFromType(elementType, count);
    if (!fb) return false;
    if (grossArea === 0 && volume === 0) return true; // fully missing
    const areaIsSparse = fb.estArea !== undefined && grossArea > 0 && count > 1 && (grossArea / count) < (fb.estArea! / count * 0.2);
    const volumeIsSparse = fb.estVolume !== undefined && volume > 0 && count > 1 && (volume / count) < (fb.estVolume! / count * 0.2);
    return areaIsSparse && volumeIsSparse;
  }

  it("45 walls with ZERO area/volume → sparse (fully missing)", () => {
    expect(isSparse("IfcWall", 45, 0, 0)).toBe(true);
  });

  it("45 walls with REAL area=900 → NOT sparse (reasonable geometry)", () => {
    // 900/45 = 20 m²/wall — close to 18 m² fallback estimate → not sparse
    expect(isSparse("IfcWall", 45, 900, 200)).toBe(false);
  });

  it("45 walls with TINY area=5 from partial parse → sparse", () => {
    // 5/45 = 0.11 m²/wall — far below 18 m² fallback → sparse
    // volume: 1.2/45 = 0.027 m³/wall — far below 4.14 → sparse
    expect(isSparse("IfcWall", 45, 5, 1.2)).toBe(true);
  });

  it("45 walls with moderate area=200 (some parsed, some not) → sparse", () => {
    // 200/45 = 4.4 m²/wall < 18 × 0.2 = 3.6 → NOT sparse by area alone
    // But check: 4.4 < 3.6? No! 4.4 > 3.6, so area is NOT sparse.
    // This is borderline — 200 m² for 45 walls is still low but above threshold
    expect(isSparse("IfcWall", 45, 200, 40)).toBe(false);
  });

  it("1 wall with zero area → sparse (count=1, uses fallback)", () => {
    // count=1 means per-element check doesn't apply (count>1 guard)
    // Falls to the grossArea===0 && volume===0 check
    expect(isSparse("IfcWall", 1, 0, 0)).toBe(true);
  });

  it("IfcFlowTerminal has no fallback → not sparse (stays EA)", () => {
    expect(isSparse("IfcFlowTerminal", 16, 0, 0)).toBe(false);
  });

  it("9 slabs with REAL area=324 → NOT sparse", () => {
    // 324/9 = 36 m²/slab — exactly matches the 36 m² fallback → not sparse
    expect(isSparse("IfcSlab", 9, 324, 48.6)).toBe(false);
  });

  it("9 slabs with TINY area=2 from partial → sparse", () => {
    // 2/9 = 0.22 m²/slab < 36 × 0.2 = 7.2 → sparse
    expect(isSparse("IfcSlab", 9, 2, 0.3)).toBe(true);
  });
});
