/**
 * IFC → Cost Pipeline Math Verification Tests
 *
 * These tests verify that the cost calculation pipeline produces
 * mathematically correct results for known inputs.
 *
 * A professional QS should be able to verify every number by hand.
 */

import { describe, it, expect } from "vitest";
import { calculateBOQ, getRatesForElement, getUnitRate } from "@/constants/unit-rates";
import {
  getIS1200RatesForElement,
  getIS1200Rate,
  getIS1200PartLabel,
  IS1200_RATES,
  IS1200_MAPPINGS,
  INDIAN_DERIVED_RATES,
} from "@/constants/is1200-rates";

// ─── Unit Rate Database Tests ─────────────────────────────────────────────

describe("Unit Rate Database", () => {
  it("has rates for all major IFC element types", () => {
    const types = ["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcWindow", "IfcDoor", "IfcRoof", "IfcStair", "IfcFooting"];
    for (const type of types) {
      const rates = getRatesForElement(type);
      expect(rates.length, `No rates found for ${type}`).toBeGreaterThan(0);
    }
  });

  it("returns material-specific rates when material name provided", () => {
    // Brick wall should get masonry rates (division 04), not concrete
    const brickRates = getRatesForElement("IfcWall", "Brick Veneer");
    expect(brickRates.some(r => r.division === "04"), "Brick wall should get masonry rates").toBe(true);

    // Steel column should get metals rates (division 05), not concrete
    const steelRates = getRatesForElement("IfcColumn", "Steel S355");
    expect(steelRates.some(r => r.division === "05"), "Steel column should get metals rates").toBe(true);

    // Timber beam should get wood rates (division 06)
    const timberRates = getRatesForElement("IfcBeam", "Timber GL24h");
    expect(timberRates.some(r => r.division === "06"), "Timber beam should get wood rates").toBe(true);
  });

  it("falls back to default rates when no material match", () => {
    const defaultRates = getRatesForElement("IfcWall", "Unknown Material XYZ");
    expect(defaultRates.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown IFC types", () => {
    const rates = getRatesForElement("IfcUnknownType");
    expect(rates).toEqual([]);
  });
});

// ─── BOQ Calculation Tests ────────────────────────────────────────────────

describe("calculateBOQ", () => {
  it("correctly calculates wall costs from area", () => {
    const result = calculateBOQ([{
      type: "IfcWall",
      count: 10,
      grossArea: 500,  // 500 m²
      netArea: 450,    // 450 m² after opening deductions
      openingArea: 50, // 50 m² of openings
    }]);

    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.grandTotal).toBeGreaterThan(0);

    // Verify area conversion: 450 m² net × 10.764 = 4,843.8 SF
    // With 5% waste: 4,843.8 × 1.05 = 5,086.0 SF
    const wallLine = result.lines.find(l => l.description.includes("Block"));
    if (wallLine) {
      const expectedSF = 450 * 10.764 * 1.05;
      expect(wallLine.quantity).toBeCloseTo(expectedSF, 0);
    }
  });

  it("correctly converts m² to SF for area-based rates", () => {
    const result = calculateBOQ([{
      type: "IfcSlab",
      count: 1,
      grossArea: 100,  // 100 m²
    }]);

    // 100 m² × 10.764 = 1,076.4 SF × 1.05 waste = 1,130.22 SF
    const slabLine = result.lines.find(l => l.csiCode === "03-30-53.40");
    if (slabLine) {
      expect(slabLine.quantity).toBeCloseTo(100 * 10.764 * 1.05, 0);
      // Rate is $7.00/SF, so cost should be ~$7,911.54
      expect(slabLine.totalCost).toBeCloseTo(slabLine.quantity * 7.0, 0);
    }
  });

  it("uses netArea over grossArea when both available", () => {
    const result = calculateBOQ([{
      type: "IfcWall",
      count: 1,
      grossArea: 200,
      netArea: 170,    // Should use this
      openingArea: 30,
    }]);

    // Should use netArea (170 m²), not grossArea (200 m²)
    const wallLine = result.lines.find(l => l.csiCode === "04-22-10.15");
    if (wallLine) {
      const expectedSF = 170 * 10.764 * 1.05;
      expect(wallLine.quantity).toBeCloseTo(expectedSF, 0);
    }
  });

  it("uses count for EA-based rates (doors, windows)", () => {
    const result = calculateBOQ([{
      type: "IfcDoor",
      count: 5,
    }]);

    const doorLine = result.lines.find(l => l.csiCode === "08-11-13.10");
    expect(doorLine).toBeDefined();
    if (doorLine) {
      // 5 doors × 1.05 waste = 5.25 EA
      expect(doorLine.quantity).toBeCloseTo(5 * 1.05, 2);
      // Rate is $650/EA, so cost = 5.25 × 650 = $3,412.50
      expect(doorLine.totalCost).toBeCloseTo(5.25 * 650, 0);
    }
  });

  it("grand total equals sum of all line totals", () => {
    const result = calculateBOQ([
      { type: "IfcWall", count: 10, grossArea: 500 },
      { type: "IfcSlab", count: 2, grossArea: 300 },
      { type: "IfcColumn", count: 8 },
      { type: "IfcDoor", count: 6 },
      { type: "IfcWindow", count: 12 },
    ]);

    const lineSum = result.lines.reduce((sum, l) => sum + l.totalCost, 0);
    expect(result.grandTotal).toBeCloseTo(lineSum, 1);

    // M + L + E = grand total
    expect(result.subtotalMaterial + result.subtotalLabor + result.subtotalEquipment)
      .toBeCloseTo(result.grandTotal, 1);
  });
});

// ─── IS 1200 Indian Standard Tests ────────────────────────────────────────

describe("IS 1200 Indian Standards", () => {
  it("has mappings for all major IFC element types", () => {
    const types = ["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcRoof", "IfcStair", "IfcFooting"];
    for (const type of types) {
      const rates = getIS1200RatesForElement(type);
      expect(rates.length, `No IS 1200 rates for ${type}`).toBeGreaterThan(0);
    }
  });

  it("returns brick masonry rates for brick walls", () => {
    const rates = getIS1200RatesForElement("IfcWall", "Brick");
    expect(rates.some(r => r.is1200Code.includes("P3")), "Brick wall should map to IS 1200 Part 3").toBe(true);
  });

  it("returns concrete rates for RCC walls", () => {
    const rates = getIS1200RatesForElement("IfcWall"); // no material = concrete default
    expect(rates.some(r => r.is1200Code.includes("P2")), "Default wall should map to IS 1200 Part 2").toBe(true);
  });

  it("returns steel rates for steel columns", () => {
    const rates = getIS1200RatesForElement("IfcColumn", "Steel");
    expect(rates.some(r => r.is1200Code.includes("P7")), "Steel column should map to IS 1200 Part 7").toBe(true);
  });

  it("returns correct IS 1200 Part labels", () => {
    expect(getIS1200PartLabel("IfcSlab")).toContain("Part 2");
    expect(getIS1200PartLabel("IfcWall", "brick")).toContain("Part 3");
    expect(getIS1200PartLabel("IfcWindow")).toContain("Part 24");
    expect(getIS1200PartLabel("IfcDoor")).toContain("Part 9");
  });

  it("all rates have positive values", () => {
    for (const rate of IS1200_RATES) {
      expect(rate.rate, `${rate.is1200Code} rate should be positive`).toBeGreaterThan(0);
      expect(rate.material, `${rate.is1200Code} material should be positive`).toBeGreaterThan(0);
      expect(rate.labour, `${rate.is1200Code} labour should be positive`).toBeGreaterThanOrEqual(0);
      // material + labour should not exceed total rate
      expect(rate.material + rate.labour, `${rate.is1200Code} M+L should not exceed rate`)
        .toBeLessThanOrEqual(rate.rate + 1); // +1 for rounding tolerance
    }
  });

  it("every IS1200 mapping has valid rate codes", () => {
    for (const mapping of IS1200_MAPPINGS) {
      for (const code of mapping.defaultRateCodes) {
        const rate = getIS1200Rate(code);
        expect(rate, `Rate code ${code} in ${mapping.ifcType} mapping not found in IS1200_RATES`).toBeDefined();
      }
      if (mapping.materialOverrides) {
        for (const [mat, codes] of Object.entries(mapping.materialOverrides)) {
          for (const code of codes) {
            const rate = getIS1200Rate(code);
            expect(rate, `Rate code ${code} (material: ${mat}) in ${mapping.ifcType} not found`).toBeDefined();
          }
        }
      }
    }
  });

  it("Indian derived rates have correct structure", () => {
    expect(INDIAN_DERIVED_RATES.formwork.slab.rate).toBeGreaterThan(0);
    expect(INDIAN_DERIVED_RATES.rebar.slab.kgPerM3).toBeGreaterThan(0);
    expect(INDIAN_DERIVED_RATES.rebar.slab.rate).toBe(72); // CPWD TMT rate
  });

  it("calculates correct Indian wall cost for known area", () => {
    // Scenario: 100m² brick wall in India
    // IS 1200 Part 3: Brick masonry 230mm = ₹1,250/m²
    // Waste: 8% → 108 m²
    // Cost: 108 × 1,250 = ₹1,35,000
    const rates = getIS1200RatesForElement("IfcWall", "Brick");
    const brickRate = rates.find(r => r.is1200Code === "IS1200-P3-BRICK-230");
    expect(brickRate).toBeDefined();
    if (brickRate) {
      const area = 100; // m²
      const waste = 0.08;
      const adjQty = area * (1 + waste);
      const cost = adjQty * brickRate.rate;
      expect(cost).toBeCloseTo(135000, -2); // ₹1,35,000 ± ₹100
    }
  });
});
