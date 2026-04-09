import { describe, it, expect } from "vitest";
import {
  WASTE_FACTORS,
  REGIONAL_FACTORS,
  PROJECT_TYPE_MULTIPLIERS,
  getWasteFactor,
  getCostBreakdown,
  applyRegionalFactor,
  calculateEscalation,
  calculateLineItemCost,
  CONCRETE_RATES,
} from "@/features/boq/lib/cost-database";

describe("Cost Database — Waste Factors", () => {
  it("should return correct waste factor for Concrete (7%)", () => {
    expect(getWasteFactor("Concrete")).toBe(0.07);
  });

  it("should return correct waste factor for Steel (10%)", () => {
    expect(getWasteFactor("Steel")).toBe(0.10);
  });

  it("should return correct waste factor for Finishes (12%)", () => {
    expect(getWasteFactor("Finishes")).toBe(0.12);
  });

  it("should fallback to 10% for unknown subcategory", () => {
    expect(getWasteFactor("UnknownMaterial")).toBe(0.10);
  });

  it("should have all waste factors between 0 and 1", () => {
    for (const [, v] of Object.entries(WASTE_FACTORS)) {
      expect(v.factor).toBeGreaterThan(0);
      expect(v.factor).toBeLessThan(1);
    }
  });
});

describe("Cost Database — Regional Multipliers", () => {
  it("should find NYC with multiplier > 1", () => {
    const result = applyRegionalFactor(100, "New York");
    expect(result.multiplier).toBeGreaterThan(1);
    expect(result.adjustedRate).toBeGreaterThan(100);
  });

  it("should find India with multiplier < 1", () => {
    const result = applyRegionalFactor(100, "Mumbai");
    expect(result.multiplier).toBeLessThan(1);
    expect(result.adjustedRate).toBeLessThan(100);
  });

  it("should fallback to 1.0 for unknown region", () => {
    const result = applyRegionalFactor(100, "Atlantis");
    expect(result.multiplier).toBe(1.0);
    expect(result.adjustedRate).toBe(100);
  });

  it("should have all regional multipliers > 0", () => {
    for (const r of REGIONAL_FACTORS) {
      expect(r.multiplier).toBeGreaterThan(0);
    }
  });
});

describe("Cost Database — Escalation", () => {
  it("should calculate escalation factor correctly (6% annual, 6 months)", () => {
    const result = calculateEscalation(100000);
    expect(result.factor).toBeGreaterThan(1);
    expect(result.amount).toBeGreaterThan(0);
    expect(result.annualRate).toBe(0.06);
    expect(result.months).toBe(6);
  });

  it("should return 0 escalation for 0 base cost", () => {
    const result = calculateEscalation(0);
    expect(result.amount).toBe(0);
  });

  it("should increase with longer time periods", () => {
    const short = calculateEscalation(100000, 0.06, 6);
    const long = calculateEscalation(100000, 0.06, 24);
    expect(long.amount).toBeGreaterThan(short.amount);
  });

  it("should increase with higher rates", () => {
    const low = calculateEscalation(100000, 0.03, 12);
    const high = calculateEscalation(100000, 0.10, 12);
    expect(high.amount).toBeGreaterThan(low.amount);
  });
});

describe("Cost Database — Project Type Multipliers", () => {
  it("should return 0.85 for residential", () => {
    expect(PROJECT_TYPE_MULTIPLIERS["residential"].multiplier).toBe(0.85);
  });

  it("should return 1.0 for commercial (baseline)", () => {
    expect(PROJECT_TYPE_MULTIPLIERS["commercial"].multiplier).toBe(1.0);
  });

  it("should return > 1.0 for healthcare", () => {
    expect(PROJECT_TYPE_MULTIPLIERS["healthcare"].multiplier).toBeGreaterThan(1);
  });

  it("should have all multipliers > 0", () => {
    for (const [, v] of Object.entries(PROJECT_TYPE_MULTIPLIERS)) {
      expect(v.multiplier).toBeGreaterThan(0);
    }
  });
});

describe("Cost Database — calculateLineItemCost", () => {
  const concreteRate = CONCRETE_RATES[0]; // Concrete Foundation

  it("should calculate line total correctly", () => {
    const result = calculateLineItemCost(concreteRate, 100, "Atlantis"); // unknown region = 1.0
    expect(result.lineTotal).toBeGreaterThan(0);
    expect(result.totalQty).toBeGreaterThan(100); // waste adds quantity
    expect(result.wasteFactor).toBe(0.07);
  });

  it("should handle zero quantity gracefully", () => {
    const result = calculateLineItemCost(concreteRate, 0, "Atlantis");
    expect(result.lineTotal).toBe(0);
    expect(result.totalQty).toBe(0);
    expect(result.materialCost).toBe(0);
  });

  it("should handle negative quantity gracefully (returns negative cost)", () => {
    const result = calculateLineItemCost(concreteRate, -10, "Atlantis");
    expect(result.lineTotal).toBeLessThan(0);
  });

  it("should apply project type multiplier", () => {
    const baseline = calculateLineItemCost(concreteRate, 100, "Atlantis");
    const healthcare = calculateLineItemCost(concreteRate, 100, "Atlantis", "healthcare");
    expect(healthcare.lineTotal).toBeGreaterThan(baseline.lineTotal);
    expect(healthcare.projectMultiplier).toBeGreaterThan(1);
  });

  it("should sum M/L/E to approximately the line total", () => {
    const result = calculateLineItemCost(concreteRate, 50, "Atlantis");
    const mleSum = result.materialCost + result.laborCost + result.equipmentCost;
    // Allow small rounding difference
    expect(Math.abs(mleSum - result.lineTotal)).toBeLessThan(1);
  });
});

describe("Cost Database — Cost Breakdown", () => {
  it("should return valid breakdown for Concrete", () => {
    const b = getCostBreakdown("Concrete");
    expect(b.material + b.labor + b.equipment).toBeCloseTo(1.0, 2);
  });

  it("should fallback for unknown subcategory", () => {
    const b = getCostBreakdown("Unknown");
    expect(b.material).toBe(0.45);
    expect(b.labor).toBe(0.48);
    expect(b.equipment).toBe(0.07);
  });
});
