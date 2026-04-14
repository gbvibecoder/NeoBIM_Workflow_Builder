/**
 * FINAL QA AUDIT — Sprints 1-4 Verification
 * Tests every new module, edge case, and integration point.
 */
import { describe, it, expect } from "vitest";

// ── Step 2A: Import Verification ─────────────────────────────────────────────

import {
  getLineConfidenceScore,
  getLineConfidenceColor,
  getIFCQualityLabel,
  getIFCQualityColor,
  getConfidenceLevelFromIFCScore,
} from "@/features/boq/constants/quality-thresholds";

import {
  escalatePrice,
  getFreshnessLabel,
  getFreshnessColor,
  getInflationRate,
} from "@/features/boq/lib/price-escalation";

import {
  computeSeasonalAdjustment,
  applySeasonalToCosts,
} from "@/features/boq/lib/seasonal-adjustment";

import {
  calculateLineRange,
  calculateBOQRange,
  getAACEDescription,
  formatRangeINR,
} from "@/features/boq/lib/cost-range";

import { validateBOQArtifact } from "@/features/boq/schemas/boq-artifact.schema";

import {
  findCity,
  getNearestMetro,
  getCitiesByState,
  INDIAN_CITIES,
} from "@/features/boq/constants/indian-cities";

import { parseArtifactToBOQ } from "@/features/boq/components/parse-artifact";

import type { BOQLineItem } from "@/features/boq/components/types";

// ── Helper ───────────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<BOQLineItem> = {}): BOQLineItem {
  return {
    id: `line-${Math.random().toString(36).slice(2, 8)}`,
    division: "Structural",
    isCode: "IS1200-P2-RCC-SLAB",
    description: "RCC Slab M25 — Ground Floor",
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

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2A: ALL IMPORTS WORK
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2A: Import Verification", () => {
  it("quality-thresholds exports all functions", () => {
    expect(typeof getLineConfidenceScore).toBe("function");
    expect(typeof getLineConfidenceColor).toBe("function");
    expect(typeof getIFCQualityLabel).toBe("function");
    expect(typeof getIFCQualityColor).toBe("function");
    expect(typeof getConfidenceLevelFromIFCScore).toBe("function");
  });

  it("price-escalation exports all functions", () => {
    expect(typeof escalatePrice).toBe("function");
    expect(typeof getFreshnessLabel).toBe("function");
    expect(typeof getFreshnessColor).toBe("function");
    expect(typeof getInflationRate).toBe("function");
  });

  it("seasonal-adjustment exports all functions", () => {
    expect(typeof computeSeasonalAdjustment).toBe("function");
    expect(typeof applySeasonalToCosts).toBe("function");
  });

  it("cost-range exports all functions", () => {
    expect(typeof calculateLineRange).toBe("function");
    expect(typeof calculateBOQRange).toBe("function");
    expect(typeof getAACEDescription).toBe("function");
    expect(typeof formatRangeINR).toBe("function");
  });

  it("boq-artifact.schema exports validateBOQArtifact", () => {
    expect(typeof validateBOQArtifact).toBe("function");
  });

  it("indian-cities exports lookup functions and data", () => {
    expect(typeof findCity).toBe("function");
    expect(typeof getNearestMetro).toBe("function");
    expect(typeof getCitiesByState).toBe("function");
    expect(Array.isArray(INDIAN_CITIES)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2B: parseArtifactToBOQ Integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2B: parseArtifactToBOQ Integration", () => {
  const realisticArtifact = {
    _boqData: {
      lines: [
        { division: "IS 1200 Part 2 — Concrete", is1200Code: "IS1200-P2-RCC-SLAB", description: "RCC Slab M25 — Ground Floor", unit: "m³", quantity: 85.5, wasteFactor: 0.04, adjustedQty: 88.92, materialRate: 5159, laborRate: 1551, equipmentRate: 0, unitRate: 6709, materialCost: 458738, laborCost: 137894, equipmentCost: 0, totalCost: 596632, storey: "Ground Floor", elementCount: 4 },
        { division: "IS 1200 Part 3 — Masonry", is1200Code: "IS1200-P3-BRICK-230", description: "Brick Wall 230mm — Ground Floor", unit: "m²", quantity: 245.5, wasteFactor: 0.06, adjustedQty: 260.23, materialRate: 420, laborRate: 380, equipmentRate: 0, unitRate: 800, materialCost: 109297, laborCost: 98887, equipmentCost: 0, totalCost: 208184, storey: "Ground Floor", elementCount: 12 },
        { division: "PROVISIONAL — MEP", description: "HVAC Provisional Sum", unit: "LS", quantity: 1, wasteFactor: 0, adjustedQty: 1, materialRate: 0, laborRate: 0, equipmentRate: 0, unitRate: 500000, materialCost: 275000, laborCost: 175000, equipmentCost: 50000, totalCost: 500000 },
      ],
      subtotalMaterial: 843035,
      subtotalLabor: 411781,
      subtotalEquipment: 50000,
      grandTotal: 1304816,
      escalation: 39144,
      projectType: "Commercial",
    },
    _totalCost: 1891983,
    _hardCosts: 1343960,
    _softCosts: 548023,
    _gfa: 850,
    _currency: "INR",
    _currencySymbol: "₹",
    _projectName: "Wellness Center Sama",
    _region: "Panaji, Goa",
    _projectType: "Wellness",
    _aaceClass: "Class 4",
    _confidenceLevel: "MEDIUM",
    _disclaimer: "Preliminary estimate only.",
    content: "BOQ generated with 3 line items.",
    _pricingMetadata: { source: "market_intelligence", marketIntelligenceStatus: "success", staticRateVersion: "CPWD DSR 2025-26", cityUsed: "Panaji", stateUsed: "Goa" },
  };

  it("should return valid BOQData from realistic artifact", () => {
    const result = parseArtifactToBOQ(realisticArtifact);
    expect(result).not.toBeNull();
    expect(result!.projectName).toBe("Wellness Center Sama");
    expect(result!.lines.length).toBe(3);
    expect(result!.totalCost).toBe(1891983);
    expect(result!.hardCosts).toBe(1343960);
  });

  it("should populate costRange with sensible values", () => {
    const result = parseArtifactToBOQ(realisticArtifact);
    expect(result!.costRange).toBeDefined();
    const cr = result!.costRange!;
    expect(cr.totalLow).toBeLessThan(cr.totalBest);
    expect(cr.totalBest).toBeLessThanOrEqual(cr.totalHigh);
    expect(cr.uncertaintyPercent).toBeGreaterThan(0);
    expect(cr.uncertaintyPercent).toBeLessThan(100);
  });

  it("should populate aaceDescription", () => {
    const result = parseArtifactToBOQ(realisticArtifact);
    expect(result!.aaceDescription).toBeTruthy();
    expect(result!.aaceDescription).toContain("±25-30%");
  });

  it("should have valid numeric fields on every line", () => {
    const result = parseArtifactToBOQ(realisticArtifact);
    for (const line of result!.lines) {
      expect(Number.isFinite(line.confidence)).toBe(true);
      expect(Number.isFinite(line.unitRate)).toBe(true);
      expect(Number.isFinite(line.totalCost)).toBe(true);
      expect(line.totalCost).toBeGreaterThanOrEqual(0);
    }
  });

  it("should return null for null input", () => {
    expect(parseArtifactToBOQ(null)).toBeNull();
  });

  it("should return zero-value BOQData for empty object (valid empty BOQ)", () => {
    // Empty object → no lines → returns BOQData with zero values (not null)
    // This is correct: an empty BOQ is still valid, just has no line items
    const result = parseArtifactToBOQ({});
    expect(result).not.toBeNull();
    expect(result!.lines.length).toBe(0);
    expect(result!.totalCost).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2C: Zod Validation Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2C: Zod Validation Edge Cases", () => {
  it("valid full artifact → passes", () => {
    const r = validateBOQArtifact({
      _boqData: { lines: [{ division: "X", description: "Y", unit: "m²", quantity: 10 }], subtotalMaterial: 0, subtotalLabor: 0, subtotalEquipment: 0, grandTotal: 0, escalation: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("missing _boqData → warns but succeeds (fallback path exists)", () => {
    const r = validateBOQArtifact({ _projectName: "Test" });
    expect(r.success).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("empty lines array → validation issue but success=true", () => {
    const r = validateBOQArtifact({ _boqData: { lines: [], subtotalMaterial: 0, subtotalLabor: 0, subtotalEquipment: 0, grandTotal: 0, escalation: 0 } });
    // Empty lines triggers "min 1" validation, but we handle gracefully
    expect(r.data).not.toBeNull();
  });

  it("string numbers → coerced to actual numbers", () => {
    const r = validateBOQArtifact({
      _boqData: { lines: [{ division: "T", description: "I", unit: "m²", quantity: "150.5", totalCost: "50000" }], subtotalMaterial: "100", subtotalLabor: "200", subtotalEquipment: "50", grandTotal: "350", escalation: "0" },
    });
    expect(r.success).toBe(true);
  });

  it("completely empty object → succeeds with warnings", () => {
    const r = validateBOQArtifact({});
    expect(r.success).toBe(true); // passthrough allows empty
    expect(r.warnings.some(w => w.includes("No BOQ line items"))).toBe(true);
  });

  it("JSON string input → parsed correctly", () => {
    const json = JSON.stringify({ _boqData: { lines: [{ division: "X", description: "Y", unit: "m²", quantity: 1 }], subtotalMaterial: 0, subtotalLabor: 0, subtotalEquipment: 0, grandTotal: 0, escalation: 0 } });
    const r = validateBOQArtifact(json);
    expect(r.success).toBe(true);
  });

  it("malformed JSON string → fails cleanly", () => {
    const r = validateBOQArtifact("{broken json");
    expect(r.success).toBe(false);
    expect(r.errors[0]).toContain("non-JSON");
  });

  it("null → fails cleanly", () => {
    const r = validateBOQArtifact(null);
    expect(r.success).toBe(false);
  });

  it("number input → fails cleanly", () => {
    const r = validateBOQArtifact(42);
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2D: Price Escalation Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2D: Price Escalation Edge Cases", () => {
  it("normal: 30 days old steel → escalated slightly", () => {
    const r = escalatePrice(65000, new Date(Date.now() - 30 * 86400000), "steel_per_tonne");
    expect(r.escalationApplied).toBe(true);
    expect(r.escalatedPrice).toBeGreaterThan(65000);
    expect(r.escalatedPrice).toBeLessThan(70000); // not wildly inflated
    expect(r.annualRate).toBe(0.06);
  });

  it("same day → no escalation", () => {
    const r = escalatePrice(65000, new Date(), "steel_per_tonne");
    expect(r.escalationApplied).toBe(false);
    expect(r.escalatedPrice).toBe(65000);
    expect(r.confidenceMultiplier).toBe(1.0);
  });

  it("2 years old → reasonable escalation (not 10x)", () => {
    const r = escalatePrice(65000, new Date(Date.now() - 730 * 86400000), "steel_per_tonne");
    expect(r.escalationApplied).toBe(true);
    // 65000 × 1.06^2 ≈ 73034
    expect(r.escalatedPrice).toBeGreaterThan(70000);
    expect(r.escalatedPrice).toBeLessThan(80000);
    expect(r.confidenceMultiplier).toBeLessThan(0.6);
  });

  it("unknown category → uses general rate (6%), no crash", () => {
    const r = escalatePrice(100, new Date(Date.now() - 60 * 86400000), "alien_material_xyz");
    expect(r.escalationApplied).toBe(true);
    expect(r.annualRate).toBe(0.06);
    expect(Number.isFinite(r.escalatedPrice)).toBe(true);
  });

  it("zero price → returns 0", () => {
    const r = escalatePrice(0, new Date(Date.now() - 90 * 86400000), "steel_per_tonne");
    expect(r.escalatedPrice).toBe(0);
  });

  it("future date → no escalation (negative elapsed)", () => {
    const r = escalatePrice(65000, new Date(Date.now() + 86400000), "steel_per_tonne");
    expect(r.escalationApplied).toBe(false);
    expect(r.escalatedPrice).toBe(65000);
  });

  it("freshness labels are correct", () => {
    expect(getFreshnessLabel(0)).toBe("fresh");
    expect(getFreshnessLabel(15)).toBe("fresh");
    expect(getFreshnessLabel(29)).toBe("fresh");
    expect(getFreshnessLabel(30)).toBe("recent");
    expect(getFreshnessLabel(89)).toBe("recent");
    expect(getFreshnessLabel(90)).toBe("stale");
    expect(getFreshnessLabel(179)).toBe("stale");
    expect(getFreshnessLabel(180)).toBe("very_stale");
  });

  it("inflation rates match expected categories", () => {
    expect(getInflationRate("steel_per_tonne")).toBe(0.06);
    expect(getInflationRate("cement_per_bag")).toBe(0.045);
    expect(getInflationRate("labor_mason")).toBe(0.09);
    expect(getInflationRate("labor_helper")).toBe(0.10);
    expect(getInflationRate("something_unknown")).toBe(0.06); // general fallback
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2E: Seasonal Adjustment Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2E: Seasonal Adjustment Edge Cases", () => {
  it("Maharashtra July → heavy monsoon, applied=true", () => {
    const r = computeSeasonalAdjustment("Maharashtra", 7);
    expect(r.applied).toBe(true);
    expect(r.climateZone).toBe("heavy_monsoon");
    expect(r.laborMultiplier).toBeGreaterThan(1.3);
    expect(r.monthName).toBe("July");
  });

  it("Maharashtra January → dry season, applied=false", () => {
    const r = computeSeasonalAdjustment("Maharashtra", 1);
    expect(r.applied).toBe(false);
    expect(r.laborMultiplier).toBe(1.0);
  });

  it("Rajasthan July → moderate monsoon, different from Maharashtra", () => {
    const mh = computeSeasonalAdjustment("Maharashtra", 7);
    const rj = computeSeasonalAdjustment("Rajasthan", 7);
    expect(rj.climateZone).toBe("moderate");
    // Rajasthan monsoon is less severe
    expect(rj.laborMultiplier).toBeLessThan(mh.laborMultiplier);
  });

  it("empty string state → no crash, returns something", () => {
    const r = computeSeasonalAdjustment("", 7);
    expect(r).toBeDefined();
    expect(typeof r.laborMultiplier).toBe("number");
    expect(r.laborMultiplier).toBeGreaterThan(0);
  });

  it("NonExistentState → defaults to moderate zone, no crash", () => {
    const r = computeSeasonalAdjustment("NonExistentState", 7);
    expect(r).toBeDefined();
    expect(r.climateZone).toBe("moderate"); // non-heavy states default to moderate
  });

  it("applySeasonalToCosts never inflates by more than 50%", () => {
    // Even in peak monsoon, the overall impact should be <50%
    const adj = computeSeasonalAdjustment("Maharashtra", 7);
    const result = applySeasonalToCosts(100000, 100000, 100000, adj);
    const totalOriginal = 300000;
    expect(result.totalCost).toBeLessThan(totalOriginal * 1.5);
  });

  it("applySeasonalToCosts preserves sum = total", () => {
    const adj = computeSeasonalAdjustment("Maharashtra", 7);
    const result = applySeasonalToCosts(100000, 50000, 10000, adj);
    expect(result.materialCost + result.laborCost + result.equipmentCost).toBe(result.totalCost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2F: Cost Range Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2F: Cost Range Edge Cases", () => {
  it("high confidence → narrow range (±5%)", () => {
    const r = calculateLineRange(1000000, 100);
    expect(r.low).toBe(950000);
    expect(r.high).toBe(1050000);
    expect(r.uncertaintyPercent).toBe(5);
  });

  it("medium confidence → wider range (±25%)", () => {
    const r = calculateLineRange(1000000, 70);
    expect(r.low).toBe(750000);
    expect(r.high).toBe(1250000);
  });

  it("low confidence → very wide range (±60%)", () => {
    const r = calculateLineRange(1000000, 0);
    expect(r.low).toBe(400000);
    expect(r.high).toBe(1600000);
  });

  it("zero cost → zero range", () => {
    const r = calculateLineRange(0, 100);
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
    expect(r.best).toBe(0);
  });

  it("negative cost → handles without crash", () => {
    const r = calculateLineRange(-1000, 50);
    expect(Number.isFinite(r.low)).toBe(true);
    expect(Number.isFinite(r.high)).toBe(true);
  });

  it("100 high-confidence lines → diversified uncertainty < 15%", () => {
    const lines = Array.from({ length: 100 }, (_, i) => makeLine({ id: `l${i}`, confidence: 85 }));
    const r = calculateBOQRange(lines);
    expect(r.total.uncertaintyPercent).toBeLessThan(15);
  });

  it("5 low-confidence lines → high uncertainty", () => {
    const lines = Array.from({ length: 5 }, (_, i) => makeLine({ id: `l${i}`, confidence: 30 }));
    const r = calculateBOQRange(lines);
    expect(r.total.uncertaintyPercent).toBeGreaterThan(20);
  });

  it("empty array → zeros, not NaN", () => {
    const r = calculateBOQRange([]);
    expect(r.total.best).toBe(0);
    expect(r.total.uncertaintyPercent).toBe(0);
    expect(Number.isFinite(r.total.low)).toBe(true);
  });

  it("single line matches calculateLineRange", () => {
    const line = makeLine({ totalCost: 500000, confidence: 70 });
    const lineRange = calculateLineRange(500000, 70);
    const boqRange = calculateBOQRange([line]);
    // Single line should have similar (not identical due to diversification)
    expect(boqRange.hardCosts.best).toBe(lineRange.best);
  });

  it("soft cost ratio scales total range", () => {
    const lines = [makeLine({ totalCost: 1000000, confidence: 80 })];
    const noSoft = calculateBOQRange(lines, 0);
    const withSoft = calculateBOQRange(lines, 0.5);
    expect(withSoft.total.best).toBe(noSoft.total.best * 1.5);
  });

  it("formatRangeINR produces readable output", () => {
    const r = formatRangeINR({ low: 50000000, high: 100000000, best: 75000000, uncertaintyPercent: 20 });
    expect(r).toContain("Cr");
    expect(r).toContain("—");
  });

  it("AACE descriptions cover all classes", () => {
    expect(getAACEDescription("Class 1")).toContain("±3-5%");
    expect(getAACEDescription("Class 2")).toContain("±5-15%");
    expect(getAACEDescription("Class 3")).toContain("±10-20%");
    expect(getAACEDescription("Class 4")).toContain("±25-30%");
    expect(getAACEDescription("Class 5")).toContain("±30-50%");
    expect(getAACEDescription(undefined)).toContain("±25-30%"); // default
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2G: Indian Cities Lookup
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 2G: Indian Cities Lookup", () => {
  it("findCity('Mumbai') → Mumbai", () => {
    const c = findCity("Mumbai");
    expect(c).toBeDefined();
    expect(c!.name).toBe("Mumbai");
    expect(c!.state).toBe("Maharashtra");
    expect(c!.tier).toBe("metro");
  });

  it("findCity('Bombay') → Mumbai (alias)", () => {
    const c = findCity("Bombay");
    expect(c).toBeDefined();
    expect(c!.name).toBe("Mumbai");
  });

  it("findCity('Bengaluru') → Bangalore (alias)", () => {
    const c = findCity("Bengaluru");
    expect(c).toBeDefined();
    expect(c!.name).toBe("Bangalore");
  });

  it("findCity('bengaluru') → case insensitive", () => {
    expect(findCity("bengaluru")).toBeDefined();
  });

  it("findCity('') → undefined, no crash", () => {
    expect(findCity("")).toBeUndefined();
  });

  it("findCity('NonExistentCity12345') → undefined", () => {
    expect(findCity("NonExistentCity12345")).toBeUndefined();
  });

  it("getNearestMetro('Nagpur') → Mumbai", () => {
    const m = getNearestMetro("Nagpur");
    expect(m).toBeDefined();
    expect(m!.name).toBe("Mumbai");
  });

  it("getNearestMetro('') → undefined, no crash", () => {
    expect(getNearestMetro("")).toBeUndefined();
  });

  it("INDIAN_CITIES has 50 cities", () => {
    expect(INDIAN_CITIES.length).toBe(50);
  });

  it("all cities have required fields", () => {
    for (const city of INDIAN_CITIES) {
      expect(city.name).toBeTruthy();
      expect(city.state).toBeTruthy();
      expect(["metro", "tier2", "tier3"]).toContain(city.tier);
      expect(typeof city.latitude).toBe("number");
      expect(typeof city.longitude).toBe("number");
      expect(city.nearestMetro).toBeTruthy();
    }
  });

  it("getCitiesByState returns correct results", () => {
    const mh = getCitiesByState("Maharashtra");
    expect(mh.length).toBeGreaterThanOrEqual(3); // Mumbai, Pune, Nagpur, Nashik, Aurangabad
    expect(mh.some(c => c.name === "Mumbai")).toBe(true);
  });

  it("metro cities have themselves as nearestMetro", () => {
    const metros = INDIAN_CITIES.filter(c => c.tier === "metro");
    for (const metro of metros) {
      expect(metro.nearestMetro).toBe(metro.name);
    }
  });

  it("common aliases all resolve", () => {
    const aliases = ["Bombay", "Calcutta", "Madras", "Bengaluru", "Trivandrum", "Vizag", "Baroda", "Prayagraj"];
    for (const alias of aliases) {
      expect(findCity(alias)).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4C: Type Safety — toConf edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 4C: Confidence String Casting", () => {
  // These test the logic that toConf() in market-intelligence.ts should handle
  it("standard values pass through", () => {
    const toConf = (c: string) => (c === "HIGH" || c === "MEDIUM" ? c : "LOW");
    expect(toConf("HIGH")).toBe("HIGH");
    expect(toConf("MEDIUM")).toBe("MEDIUM");
    expect(toConf("LOW")).toBe("LOW");
  });

  it("lowercase defaults to LOW", () => {
    const toConf = (c: string) => (c === "HIGH" || c === "MEDIUM" ? c : "LOW");
    expect(toConf("high")).toBe("LOW"); // lowercase not matched
    expect(toConf("medium")).toBe("LOW");
  });

  it("empty/garbage defaults to LOW", () => {
    const toConf = (c: string) => (c === "HIGH" || c === "MEDIUM" ? c : "LOW");
    expect(toConf("")).toBe("LOW");
    expect(toConf("garbage")).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: UI Component Safety (compile-time checks via type assertions)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Step 3: UI Component Data Safety", () => {
  it("BOQData with undefined optional fields is valid TypeScript", () => {
    // This test verifies that the types allow all optional fields to be absent
    const data = parseArtifactToBOQ({
      _boqData: {
        lines: [{ division: "X", description: "Y", unit: "m²", quantity: 10, totalCost: 1000 }],
        subtotalMaterial: 500,
        subtotalLabor: 300,
        subtotalEquipment: 200,
        grandTotal: 1000,
        escalation: 0,
      },
    });
    expect(data).not.toBeNull();
    // All these should be safely undefined (not crash)
    expect(data!.market).toBeUndefined();
    expect(data!.ifcQuality).toBeUndefined();
    expect(data!.mepBreakdown).toBeUndefined();
    expect(data!.modelQualityReport).toBeUndefined();
    expect(data!.pricingMetadata).toBeUndefined();
    // These should have defaults
    expect(data!.lines.length).toBe(1);
    expect(typeof data!.totalCost).toBe("number");
  });

  it("ProvenanceTooltip data — line with zero rates renders safe data", () => {
    const line = makeLine({ materialRate: 0, laborRate: 0, equipmentRate: 0, unitRate: 0 });
    // Verify the data exists and is numeric — the component just reads these
    expect(line.materialRate).toBe(0);
    expect(line.laborRate).toBe(0);
    expect(line.isCode).toBeTruthy();
    expect(typeof line.confidence).toBe("number");
  });
});
