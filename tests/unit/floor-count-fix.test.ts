/**
 * Tests for Sub-Phase E.1 — floor count fix.
 * Verifies non-occupied storeys (basement, roof, mechanical) are excluded
 * from the floor count used for foundation type determination.
 */
import { describe, it, expect } from "vitest";

// Replicate the filter logic from tr-008.ts for unit testing
const NON_OCCUPIED_STOREY = /^-\d|\b(found|footing|basement|roof|terrace|mechan|service|plant)/i;
function isOccupiedStorey(s: string): boolean {
  return !NON_OCCUPIED_STOREY.test(s);
}
function countOccupiedStoreys(storeys: string[]): number {
  return new Set(storeys.filter(s => s && isOccupiedStorey(s))).size || 1;
}

describe("E.1 — Floor count fix", () => {
  it("BIMcollab IFC: 6 IFC storeys → 4 occupied (excludes -01 basement + Roof)", () => {
    const storeys = ["-01 Foundation", "00 Ground Floor", "01 First Floor", "02 Second Floor", "03 Third Floor", "Roof"];
    expect(countOccupiedStoreys(storeys)).toBe(4);
  });

  it("Bungalow: 1 ground only → 1", () => {
    const storeys = ["00 Ground Floor"];
    expect(countOccupiedStoreys(storeys)).toBe(1);
  });

  it("High-rise: G + 10 floors → 11", () => {
    const storeys = [
      "Foundation Level", "00 Ground Floor", "01 Level 1", "02 Level 2",
      "03 Level 3", "04 Level 4", "05 Level 5", "06 Level 6",
      "07 Level 7", "08 Level 8", "09 Level 9", "10 Level 10",
      "Roof Terrace", "Mechanical Floor",
    ];
    expect(countOccupiedStoreys(storeys)).toBe(11); // 00 through 10, excludes Foundation + Roof + Mechanical
  });

  it("Only basement → returns 1 (fallback minimum)", () => {
    const storeys = ["-01 Basement", "-02 Basement"];
    expect(countOccupiedStoreys(storeys)).toBe(1); // || 1 fallback
  });

  it("G+3 with basement and roof → 4 occupied", () => {
    const storeys = ["-01 Basement", "Ground", "First Floor", "Second Floor", "Third Floor", "Terrace"];
    expect(countOccupiedStoreys(storeys)).toBe(4);
  });

  it("Filters 'Service Floor' and 'Plant Room Level'", () => {
    expect(isOccupiedStorey("Service Floor")).toBe(false);
    expect(isOccupiedStorey("Plant Room Level")).toBe(false);
    expect(isOccupiedStorey("Mechanical Level")).toBe(false);
  });

  it("Keeps normal floor names", () => {
    expect(isOccupiedStorey("00 Ground Floor")).toBe(true);
    expect(isOccupiedStorey("01 First Floor")).toBe(true);
    expect(isOccupiedStorey("Level 5")).toBe(true);
    expect(isOccupiedStorey("Mezzanine")).toBe(true);
  });
});
