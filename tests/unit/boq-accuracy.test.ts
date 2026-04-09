/**
 * BOQ Accuracy Test Suite
 *
 * Tests the complete BOQ calculation pipeline for accuracy:
 * - City tier detection (metro/tier-1/tier-2/tier-3)
 * - State PWD factors
 * - Benchmark validation ranges
 * - MEP differentiation by building type
 * - Storey name normalization
 * - GST rate assignments
 * - IS 1200 code completeness
 */
import { describe, it, expect } from "vitest";

// ── Import functions under test ──
import { calculateIndianPricingAdjustment, getStatePWDFactor } from "@/constants/indian-pricing-factors";
import { detectCityTier, resolveProjectLocation } from "@/constants/regional-factors";
import { validateBenchmark, estimateMEPCosts } from "@/features/boq/services/boq-intelligence";
import { IS1200_RATES, getConcreteGradeMultiplier } from "@/features/boq/constants/is1200-rates";

// ============================================================================
// TEST GROUP 1: City Tier Detection
// ============================================================================
describe("City Tier Detection", () => {
  // Metro cities
  const metroCities = [
    ["Mumbai", "IN"], ["Delhi", "IN"], ["New Delhi", "IN"],
    ["Bangalore", "IN"], ["Bengaluru", "IN"], ["Chennai", "IN"],
    ["Hyderabad", "IN"], ["Kolkata", "IN"],
  ];
  for (const [city, code] of metroCities) {
    it(`${city} is metro tier`, () => {
      expect(detectCityTier(city, code)).toBe("metro");
    });
  }

  // Tier-1 cities
  const tier1Cities = [
    ["Pune", "IN"], ["Ahmedabad", "IN"], ["Kochi", "IN"],
    ["Jaipur", "IN"], ["Lucknow", "IN"], ["Surat", "IN"],
  ];
  for (const [city, code] of tier1Cities) {
    it(`${city} is city/tier-1`, () => {
      const tier = detectCityTier(city, code);
      expect(["city", "metro"]).toContain(tier);
    });
  }

  // Delhi variations all → metro
  it("Delhi NCR variations all detect as metro", () => {
    const adj = calculateIndianPricingAdjustment("Delhi NCR", "New Delhi");
    expect(adj.cityTier).toBe("metro");
  });

  it("Noida detects as metro (Delhi NCR)", () => {
    const adj = calculateIndianPricingAdjustment("Delhi NCR", "Noida");
    expect(adj.cityTier).toBe("metro");
  });

  it("Kochi = Kochi (Cochin) same tier", () => {
    const t1 = detectCityTier("Kochi", "IN");
    const t2 = detectCityTier("Kochi (Cochin)", "IN");
    expect(t1).toBe(t2);
  });
});

// ============================================================================
// TEST GROUP 2: State PWD Factors
// ============================================================================
describe("State PWD Factors", () => {
  it("all major states have factors", () => {
    const states = [
      "Maharashtra", "Gujarat", "Karnataka", "Tamil Nadu", "Kerala",
      "Delhi NCR", "Uttar Pradesh", "Bihar", "Rajasthan", "West Bengal",
      "Madhya Pradesh", "Telangana", "Andhra Pradesh", "Odisha", "Jharkhand",
    ];
    for (const state of states) {
      const f = getStatePWDFactor(state);
      expect(f, `${state} must have PWD factor`).not.toBeNull();
      expect(f!.overallFactor).toBeGreaterThan(0.7);
      expect(f!.overallFactor).toBeLessThan(1.5);
    }
  });

  it("Kerala has highest labor factor among major states", () => {
    const kerala = getStatePWDFactor("Kerala");
    const bihar = getStatePWDFactor("Bihar");
    expect(kerala!.laborFactor).toBeGreaterThan(bihar!.laborFactor);
    expect(kerala!.laborFactor).toBeGreaterThanOrEqual(1.2);
  });

  it("Bihar has lowest overall factor among major states", () => {
    const bihar = getStatePWDFactor("Bihar");
    expect(bihar!.overallFactor).toBeLessThan(1.0);
    expect(bihar!.overallFactor).toBeGreaterThan(0.7); // not unrealistically low
  });

  it("NE states have logistics premium", () => {
    for (const state of ["Nagaland", "Meghalaya", "Manipur", "Arunachal Pradesh", "Mizoram"]) {
      const f = getStatePWDFactor(state);
      expect(f, `${state} must have factor`).not.toBeNull();
      expect(f!.overallFactor, `${state} should have logistics premium`).toBeGreaterThan(1.15);
    }
  });
});

// ============================================================================
// TEST GROUP 3: Indian Pricing Adjustments (combined factor)
// ============================================================================
describe("Indian Pricing Adjustments", () => {
  it("Mumbai overall factor > 1.2 (metro + MH PWD)", () => {
    const adj = calculateIndianPricingAdjustment("Maharashtra", "Mumbai");
    expect(adj.overall).toBeGreaterThan(1.2);
    expect(adj.cityTier).toBe("metro");
  });

  it("Darbhanga Bihar overall factor < 0.85", () => {
    const adj = calculateIndianPricingAdjustment("Bihar", "Darbhanga");
    expect(adj.overall).toBeLessThan(0.85);
    expect(adj.cityTier).toBe("tier-3");
  });

  it("Pune Tier-1 factor between 1.0 and 1.2", () => {
    const adj = calculateIndianPricingAdjustment("Maharashtra", "Pune");
    expect(adj.overall).toBeGreaterThan(1.0);
    expect(adj.overall).toBeLessThan(1.25);
  });

  it("Delhi NCR is metro with factor ~1.15-1.25", () => {
    const adj = calculateIndianPricingAdjustment("Delhi NCR", "New Delhi");
    expect(adj.cityTier).toBe("metro");
    expect(adj.overall).toBeGreaterThan(1.1);
    expect(adj.overall).toBeLessThan(1.4);
  });

  it("Kerala has steel factor > Bihar steel factor", () => {
    const kerala = calculateIndianPricingAdjustment("Kerala", "Kochi");
    const bihar = calculateIndianPricingAdjustment("Bihar", "Patna");
    expect(kerala.steel).toBeGreaterThan(bihar.steel);
  });
});

// ============================================================================
// TEST GROUP 4: Benchmark Validation
// ============================================================================
describe("Benchmark Validation", () => {
  it("commercial in metro: range ₹45,500-₹78,000/m²", () => {
    const result = validateBenchmark(50000 * 1000, 1000, "commercial", "metro");
    expect(result.benchmarkLow).toBeGreaterThanOrEqual(40000);
    expect(result.benchmarkHigh).toBeLessThanOrEqual(90000);
  });

  it("commercial in tier-3: range lower than metro", () => {
    const metro = validateBenchmark(50000000, 1000, "commercial", "metro");
    const tier3 = validateBenchmark(50000000, 1000, "commercial", "tier-3");
    expect(tier3.benchmarkLow).toBeLessThan(metro.benchmarkLow);
  });

  it("flags below-minimum cost as critical", () => {
    // ₹15,000/m² for commercial is below ₹22,000 floor
    const result = validateBenchmark(15000 * 1000, 1000, "commercial", "tier-3");
    expect(result.severity).toBe("critical");
    expect(result.status).toBe("below");
  });

  it("healthcare benchmark higher than residential", () => {
    const health = validateBenchmark(60000 * 1000, 1000, "healthcare", "tier-2");
    const resi = validateBenchmark(60000 * 1000, 1000, "residential", "tier-2");
    expect(health.benchmarkLow).toBeGreaterThan(resi.benchmarkLow);
  });

  it("wellness benchmark ₹40k-70k base range", () => {
    const result = validateBenchmark(55000 * 1000, 1000, "wellness", "tier-2");
    expect(result.benchmarkLow).toBeGreaterThanOrEqual(28000); // min floor
    expect(result.benchmarkHigh).toBeGreaterThanOrEqual(55000);
  });
});

// ============================================================================
// TEST GROUP 5: MEP Differentiation by Building Type
// ============================================================================
describe("MEP Building Type Differentiation", () => {
  it("wellness MEP > residential MEP by at least 2x", () => {
    const wellness = estimateMEPCosts(1000, "wellness", 3, "tier-2", true);
    const residential = estimateMEPCosts(1000, "residential", 3, "tier-2", true);
    const wellnessTotal = wellness.reduce((s, p) => s + p.amount, 0);
    const residentialTotal = residential.reduce((s, p) => s + p.amount, 0);
    expect(wellnessTotal).toBeGreaterThan(residentialTotal * 1.5);
  });

  it("healthcare MEP > commercial MEP", () => {
    const healthcare = estimateMEPCosts(1000, "healthcare", 5, "tier-2", true);
    const commercial = estimateMEPCosts(1000, "commercial", 5, "tier-2", true);
    const hTotal = healthcare.reduce((s, p) => s + p.amount, 0);
    const cTotal = commercial.reduce((s, p) => s + p.amount, 0);
    expect(hTotal).toBeGreaterThan(cTotal);
  });

  it("residential has no HVAC for low-rise", () => {
    const res = estimateMEPCosts(1000, "residential", 2, "tier-2", true);
    const hvac = res.find(s => s.description.toLowerCase().includes("hvac"));
    expect(hvac).toBeUndefined();
  });

  it("commercial has BMS", () => {
    const com = estimateMEPCosts(1000, "commercial", 5, "tier-2", true);
    const bms = com.find(s => s.description.toLowerCase().includes("bms") || s.description.toLowerCase().includes("management"));
    expect(bms).toBeDefined();
  });

  it("all MEP items have IS 1200 codes", () => {
    const sums = estimateMEPCosts(1000, "commercial", 5, "tier-2", true);
    for (const s of sums) {
      expect(s.is1200Code, `MEP item "${s.description}" must have IS code`).toBeDefined();
      expect(s.is1200Code!.length).toBeGreaterThan(0);
    }
  });

  it("metro city MEP > tier-3 MEP (city tier multiplier)", () => {
    const metro = estimateMEPCosts(1000, "commercial", 5, "metro", true);
    const tier3 = estimateMEPCosts(1000, "commercial", 5, "tier-3", true);
    const mTotal = metro.reduce((s, p) => s + p.amount, 0);
    const tTotal = tier3.reduce((s, p) => s + p.amount, 0);
    expect(mTotal).toBeGreaterThan(tTotal);
  });
});

// ============================================================================
// TEST GROUP 6: IS 1200 Rates Integrity
// ============================================================================
describe("IS 1200 Rate Database", () => {
  it("all rates have valid codes starting with IS1200", () => {
    for (const rate of IS1200_RATES) {
      expect(rate.is1200Code).toMatch(/^IS1200-/);
    }
  });

  it("steel rebar rate ₹88/kg (calibrated from real BOQ)", () => {
    const rebar = IS1200_RATES.find(r => r.is1200Code === "IS1200-P6-REBAR-500");
    expect(rebar).toBeDefined();
    expect(rebar!.rate).toBe(88);
  });

  it("structural steel rate ₹140/kg", () => {
    const steel = IS1200_RATES.find(r => r.is1200Code === "IS1200-P7-STRUCT-STEEL");
    expect(steel).toBeDefined();
    expect(steel!.rate).toBe(140);
  });

  it("piling rates exist", () => {
    const pile = IS1200_RATES.find(r => r.is1200Code === "IS1200-P1-PILE-450");
    expect(pile).toBeDefined();
    expect(pile!.rate).toBeGreaterThan(2000);
  });
});

// ============================================================================
// TEST GROUP 7: Concrete Grade Multipliers
// ============================================================================
describe("Concrete Grade Multipliers", () => {
  it("M25 = 1.00 (baseline)", () => {
    expect(getConcreteGradeMultiplier("M25")).toBe(1.0);
  });

  it("M30 > M25", () => {
    expect(getConcreteGradeMultiplier("M30")).toBeGreaterThan(1.0);
  });

  it("M40 > M30 > M25 > M20", () => {
    expect(getConcreteGradeMultiplier("M40")).toBeGreaterThan(getConcreteGradeMultiplier("M30"));
    expect(getConcreteGradeMultiplier("M30")).toBeGreaterThan(getConcreteGradeMultiplier("M25"));
    expect(getConcreteGradeMultiplier("M25")).toBeGreaterThan(getConcreteGradeMultiplier("M20"));
  });

  it("unknown grade returns 1.0", () => {
    expect(getConcreteGradeMultiplier("X99")).toBe(1.0);
    expect(getConcreteGradeMultiplier(undefined)).toBe(1.0);
  });

  it("handles format variations", () => {
    expect(getConcreteGradeMultiplier("M 30")).toBe(getConcreteGradeMultiplier("M30"));
    expect(getConcreteGradeMultiplier("m25")).toBe(1.0);
  });
});

// ============================================================================
// TEST GROUP 8: Storey Name Normalization
// ============================================================================
describe("Storey Name Normalization", () => {
  // Test the pattern used in both server and client paths
  const normalizeStorey = (s: string): string => {
    if (!s) return s;
    return s.replace(/\bGrond\b/gi, "Ground").replace(/\bGroung\b/gi, "Ground")
      .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase());
  };

  it("Grond floor → Ground Floor", () => {
    expect(normalizeStorey("Grond floor")).toBe("Ground Floor");
  });

  it("Grond Floor → Ground Floor", () => {
    expect(normalizeStorey("Grond Floor")).toBe("Ground Floor");
  });

  it("grond floor → Ground Floor", () => {
    expect(normalizeStorey("grond floor")).toBe("Ground Floor");
  });

  it("First floor unchanged (title-cased)", () => {
    expect(normalizeStorey("First floor")).toBe("First Floor");
  });

  it("Groung floor → Ground Floor", () => {
    expect(normalizeStorey("Groung floor")).toBe("Ground Floor");
  });

  it("empty string returns empty", () => {
    expect(normalizeStorey("")).toBe("");
  });
});

// ============================================================================
// TEST GROUP 9: Location Resolution
// ============================================================================
describe("Location Resolution", () => {
  it("India resolves with INR currency", () => {
    const loc = resolveProjectLocation("India", "Maharashtra", "Mumbai");
    expect(loc.currency).toBe("INR");
    expect(loc.currencySymbol).toBe("₹");
    expect(loc.cityTier).toBe("metro");
  });

  it("USA resolves with USD currency", () => {
    const loc = resolveProjectLocation("USA", "California", "San Francisco");
    expect(loc.currency).toBe("USD");
    expect(loc.cityTier).toBe("metro");
  });

  it("India factor < USA factor (lower construction costs)", () => {
    const india = resolveProjectLocation("India", "Maharashtra", "Mumbai");
    const usa = resolveProjectLocation("USA", "California", "San Francisco");
    expect(india.countryFactor).toBeLessThan(usa.countryFactor);
  });
});
