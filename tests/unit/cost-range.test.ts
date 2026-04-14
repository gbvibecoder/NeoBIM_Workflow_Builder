import { describe, it, expect } from "vitest";
import {
  calculateLineRange,
  calculateBOQRange,
  getAACEDescription,
  formatRangeINR,
} from "@/features/boq/lib/cost-range";
import type { BOQLineItem } from "@/features/boq/components/types";

function makeLine(overrides: Partial<BOQLineItem> = {}): BOQLineItem {
  return {
    id: "test-1",
    division: "Structural",
    isCode: "IS1200-P2",
    description: "RCC Slab",
    unit: "m³",
    quantity: 100,
    wasteFactor: 0.05,
    adjustedQty: 105,
    materialRate: 5000,
    laborRate: 2000,
    equipmentRate: 500,
    unitRate: 7500,
    materialCost: 525000,
    laborCost: 210000,
    equipmentCost: 52500,
    totalCost: 787500,
    source: "ifc-geometry",
    confidence: 85,
    steelSensitivity: 0,
    cementSensitivity: 0,
    masonSensitivity: 0,
    bricksSensitivity: 0,
    sandSensitivity: 0,
    timberSensitivity: 0,
    ...overrides,
  };
}

describe("Cost Range - Line Level", () => {
  it("should give tight range for high confidence", () => {
    const range = calculateLineRange(100000, 95);
    expect(range.low).toBe(95000);
    expect(range.high).toBe(105000);
    expect(range.uncertaintyPercent).toBe(5);
  });

  it("should give wide range for low confidence", () => {
    const range = calculateLineRange(100000, 30);
    expect(range.low).toBe(40000);
    expect(range.high).toBe(160000);
    expect(range.uncertaintyPercent).toBe(60);
  });

  it("should give medium range for medium confidence", () => {
    const range = calculateLineRange(100000, 70);
    expect(range.low).toBe(75000);
    expect(range.high).toBe(125000);
    expect(range.uncertaintyPercent).toBe(25);
  });

  it("should handle zero cost", () => {
    const range = calculateLineRange(0, 80);
    expect(range.low).toBe(0);
    expect(range.high).toBe(0);
    expect(range.best).toBe(0);
  });
});

describe("Cost Range - BOQ Level", () => {
  it("should calculate total range with diversification", () => {
    const lines = [
      makeLine({ totalCost: 500000, confidence: 85 }),
      makeLine({ id: "2", totalCost: 300000, confidence: 70 }),
      makeLine({ id: "3", totalCost: 200000, confidence: 50 }),
    ];

    const result = calculateBOQRange(lines);
    expect(result.total.best).toBe(1000000);
    expect(result.total.low).toBeLessThan(1000000);
    expect(result.total.high).toBeGreaterThan(1000000);
    // Diversification means total range is tighter than sum of individual ranges
    expect(result.total.uncertaintyPercent).toBeLessThan(40);
  });

  it("should include soft costs in total range", () => {
    const lines = [makeLine({ totalCost: 1000000, confidence: 80 })];
    const withSoft = calculateBOQRange(lines, 0.44); // 44% soft cost ratio
    const withoutSoft = calculateBOQRange(lines, 0);

    expect(withSoft.total.best).toBeGreaterThan(withoutSoft.total.best);
    expect(withSoft.total.best).toBeCloseTo(1440000, -3);
  });

  it("should track confidence breakdown", () => {
    const lines = [
      makeLine({ confidence: 90 }), // high
      makeLine({ id: "2", confidence: 90 }), // high
      makeLine({ id: "3", confidence: 65 }), // medium
      makeLine({ id: "4", confidence: 40 }), // low
    ];

    const result = calculateBOQRange(lines);
    expect(result.confidenceBreakdown.highCount).toBe(2);
    expect(result.confidenceBreakdown.mediumCount).toBe(1);
    expect(result.confidenceBreakdown.lowCount).toBe(1);
    expect(result.confidenceBreakdown.highPercent).toBe(50);
  });

  it("should handle empty lines", () => {
    const result = calculateBOQRange([]);
    expect(result.total.best).toBe(0);
    expect(result.total.uncertaintyPercent).toBe(0);
  });
});

describe("AACE Descriptions", () => {
  it("should return correct descriptions for each class", () => {
    expect(getAACEDescription("Class 1")).toContain("±3-5%");
    expect(getAACEDescription("Class 3")).toContain("±10-20%");
    expect(getAACEDescription("Class 4")).toContain("±25-30%");
    expect(getAACEDescription("Class 5")).toContain("±30-50%");
  });

  it("should default to Class 4 for unknown", () => {
    expect(getAACEDescription(undefined)).toContain("±25-30%");
    expect(getAACEDescription("Class 99")).toContain("±25-30%");
  });
});

describe("Format Range INR", () => {
  it("should format crores", () => {
    const result = formatRangeINR({ low: 72000000, high: 107000000, best: 89500000, uncertaintyPercent: 20 });
    expect(result).toContain("7.2 Cr");
    expect(result).toContain("10.7 Cr");
  });

  it("should format lakhs", () => {
    const result = formatRangeINR({ low: 500000, high: 800000, best: 650000, uncertaintyPercent: 20 });
    expect(result).toContain("L");
  });
});
