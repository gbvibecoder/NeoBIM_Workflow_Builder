import { describe, it, expect } from "vitest";
import { validateBOQArtifact } from "@/features/boq/schemas/boq-artifact.schema";
import { computeSeasonalAdjustment, applySeasonalToCosts } from "@/features/boq/lib/seasonal-adjustment";
import { escalatePrice, getFreshnessLabel } from "@/features/boq/lib/price-escalation";
import {
  getLineConfidenceScore,
  getIFCQualityLabel,
  getConfidenceLevelFromIFCScore,
} from "@/features/boq/constants/quality-thresholds";

// ── Zod Validation Tests ─────────────────────────────────────────────────────

describe("BOQ Artifact Validation", () => {
  it("should reject null/undefined input", () => {
    const result = validateBOQArtifact(null);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Artifact data is null/undefined");
  });

  it("should reject non-object input", () => {
    const result = validateBOQArtifact(42);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("number");
  });

  it("should accept valid BOQ data with lines", () => {
    const valid = {
      _boqData: {
        lines: [
          {
            division: "Structural",
            description: "RCC Slab M25",
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
          },
        ],
        subtotalMaterial: 525000,
        subtotalLabor: 210000,
        subtotalEquipment: 52500,
        grandTotal: 787500,
        escalation: 0,
      },
      _totalCost: 787500,
      _hardCosts: 787500,
      _softCosts: 0,
    };

    const result = validateBOQArtifact(valid);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should parse JSON string input", () => {
    const json = JSON.stringify({
      _boqData: {
        lines: [{ division: "Test", description: "Item", unit: "m²", quantity: 10 }],
        subtotalMaterial: 0,
        subtotalLabor: 0,
        subtotalEquipment: 0,
        grandTotal: 0,
        escalation: 0,
      },
    });
    const result = validateBOQArtifact(json);
    expect(result.success).toBe(true);
  });

  it("should warn when no line items found", () => {
    const result = validateBOQArtifact({ _projectName: "Test" });
    expect(result.success).toBe(true);
    expect(result.warnings.some(w => w.includes("No BOQ line items"))).toBe(true);
  });

  it("should coerce string numbers to actual numbers", () => {
    const data = {
      _boqData: {
        lines: [
          {
            division: "Test",
            description: "Coerced",
            unit: "m²",
            quantity: "150.5", // string instead of number
            totalCost: "50000", // string instead of number
          },
        ],
        subtotalMaterial: "10000",
        subtotalLabor: "5000",
        subtotalEquipment: "1000",
        grandTotal: "16000",
        escalation: "0",
      },
    };
    const result = validateBOQArtifact(data);
    expect(result.success).toBe(true);
  });

  it("should handle malformed JSON string gracefully", () => {
    const result = validateBOQArtifact("{not valid json");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("non-JSON string");
  });
});

// ── Seasonal Adjustment Tests ────────────────────────────────────────────────

describe("Seasonal Cost Adjustment", () => {
  it("should compute high impact for Mumbai in July (peak monsoon)", () => {
    const adj = computeSeasonalAdjustment("Maharashtra", 7);
    expect(adj.applied).toBe(true);
    expect(adj.climateZone).toBe("heavy_monsoon");
    expect(adj.laborMultiplier).toBeGreaterThan(1.3); // 1/0.72 ≈ 1.39
    expect(adj.overallImpactPercent).toBeGreaterThan(10);
    expect(adj.description).toContain("July");
  });

  it("should compute low impact for Rajasthan in March (optimal)", () => {
    const adj = computeSeasonalAdjustment("Rajasthan", 3);
    expect(adj.applied).toBe(false);
    expect(adj.laborMultiplier).toBe(1.0);
    expect(adj.overallImpactPercent).toBeLessThanOrEqual(2);
  });

  it("should apply costs correctly", () => {
    const adj = computeSeasonalAdjustment("Maharashtra", 7);
    const result = applySeasonalToCosts(100000, 50000, 10000, adj);

    expect(result.laborCost).toBeGreaterThan(50000); // monsoon increases labor
    expect(result.totalDelta).toBeGreaterThan(0); // total should increase
    expect(result.materialCost + result.laborCost + result.equipmentCost).toBe(result.totalCost);
  });

  it("should not apply when not significant", () => {
    const adj = computeSeasonalAdjustment("Rajasthan", 3);
    const result = applySeasonalToCosts(100000, 50000, 10000, adj);

    expect(result.totalDelta).toBe(0);
    expect(result.totalCost).toBe(160000);
  });

  it("should use current month when month not specified", () => {
    const adj = computeSeasonalAdjustment("Maharashtra");
    expect(adj.month).toBeGreaterThanOrEqual(1);
    expect(adj.month).toBeLessThanOrEqual(12);
    expect(adj.monthName).toBeTruthy();
  });
});

// ── Price Escalation Tests ───────────────────────────────────────────────────

describe("Price Escalation", () => {
  it("should not escalate fresh prices (<30 days)", () => {
    const result = escalatePrice(75000, new Date(Date.now() - 10 * 86400000), "steel_per_tonne");
    expect(result.escalationApplied).toBe(false);
    expect(result.escalatedPrice).toBe(75000);
    expect(result.confidenceMultiplier).toBe(1.0);
  });

  it("should escalate steel at 6%/yr for 1 year old data", () => {
    const oneYearAgo = new Date(Date.now() - 365 * 86400000);
    const result = escalatePrice(75000, oneYearAgo, "steel_per_tonne");
    expect(result.escalationApplied).toBe(true);
    expect(result.annualRate).toBe(0.06);
    // 75000 × 1.06 = 79500
    expect(result.escalatedPrice).toBeCloseTo(79500, -2);
    expect(result.confidenceMultiplier).toBeLessThan(1.0);
  });

  it("should escalate labor at 9%/yr", () => {
    const sixMonthsAgo = new Date(Date.now() - 183 * 86400000);
    const result = escalatePrice(950, sixMonthsAgo, "labor_mason");
    expect(result.escalationApplied).toBe(true);
    expect(result.annualRate).toBe(0.09);
    expect(result.escalatedPrice).toBeGreaterThan(950);
  });

  it("should use 'general' rate for unknown materials", () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 86400000);
    const result = escalatePrice(1000, twoMonthsAgo, "unknown_exotic_material");
    expect(result.escalationApplied).toBe(true);
    expect(result.annualRate).toBe(0.06); // general fallback
  });

  it("should classify freshness labels correctly", () => {
    expect(getFreshnessLabel(5)).toBe("fresh");
    expect(getFreshnessLabel(45)).toBe("recent");
    expect(getFreshnessLabel(120)).toBe("stale");
    expect(getFreshnessLabel(200)).toBe("very_stale");
  });
});

// ── Unified Threshold Tests ──────────────────────────────────────────────────

describe("Quality Thresholds (unified)", () => {
  it("should classify line confidence consistently", () => {
    expect(getLineConfidenceScore(90)).toBe("high");
    expect(getLineConfidenceScore(80)).toBe("high");
    expect(getLineConfidenceScore(79)).toBe("medium");
    expect(getLineConfidenceScore(55)).toBe("medium");
    expect(getLineConfidenceScore(54)).toBe("low");
    expect(getLineConfidenceScore(0)).toBe("low");
  });

  it("should classify IFC quality consistently", () => {
    expect(getIFCQualityLabel(90)).toBe("EXCELLENT");
    expect(getIFCQualityLabel(85)).toBe("GOOD"); // >85 not >=85
    expect(getIFCQualityLabel(86)).toBe("EXCELLENT");
    expect(getIFCQualityLabel(70)).toBe("GOOD");
    expect(getIFCQualityLabel(50)).toBe("FAIR");
    expect(getIFCQualityLabel(40)).toBe("LIMITED"); // >40 not >=40
    expect(getIFCQualityLabel(41)).toBe("FAIR");
  });

  it("should derive confidence level from IFC score", () => {
    expect(getConfidenceLevelFromIFCScore(85)).toBe("HIGH");
    expect(getConfidenceLevelFromIFCScore(60)).toBe("MEDIUM");
    expect(getConfidenceLevelFromIFCScore(40)).toBe("LOW");
  });
});
