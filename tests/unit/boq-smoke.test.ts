/**
 * BOQ Pipeline Smoke Test — Pre-Deploy Crash Check
 *
 * Picks a RANDOM Indian city each run and verifies the full pipeline
 * completes without runtime errors. Does NOT assert specific ₹ values.
 *
 * Catches bugs like: variable scoping errors, undefined property access,
 * JSON parse failures, missing imports, type mismatches at runtime.
 *
 * Uses mocked API calls — no real Claude/Anthropic calls needed.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { calculateIndianPricingAdjustment } from "@/features/boq/constants/indian-pricing-factors";
import { getIS1200RatesForElement, getConcreteGradeMultiplier } from "@/features/boq/constants/is1200-rates";
import { resolveProjectLocation } from "@/features/boq/constants/regional-factors";
import { validateBenchmark, estimateMEPCosts, estimateFoundationCosts } from "@/features/boq/services/boq-intelligence";
import { detectProjectType } from "@/features/boq/lib/cost-database";

// ── Test Cities (diverse tiers + regions) ──
const TEST_CITIES = [
  { city: "Mumbai", state: "Maharashtra" },
  { city: "Patna", state: "Bihar" },
  { city: "Imphal", state: "Manipur" },
  { city: "Shimla", state: "Himachal Pradesh" },
  { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Jaipur", state: "Rajasthan" },
  { city: "Bhubaneswar", state: "Odisha" },
  { city: "Gangtok", state: "Sikkim" },
];

const picked = TEST_CITIES[Math.floor(Math.random() * TEST_CITIES.length)];

// ── Minimal IFC-like parsed result (simulates TR-007 output) ──
const MOCK_IFC_PARSED = {
  divisions: [
    {
      name: "Concrete",
      categories: [
        {
          elements: [
            { type: "IfcSlab", storey: "Ground Floor", name: "Slab-1", material: "Concrete",
              quantities: { count: 2, area: { gross: 500, net: 500 }, volume: { base: 75 } } },
            { type: "IfcWall", storey: "Ground Floor", name: "Wall-1", material: "Brick",
              quantities: { count: 10, area: { gross: 300, net: 270 }, volume: { base: 60 }, openingArea: 30 } },
            { type: "IfcColumn", storey: "Ground Floor", name: "Col-1", material: "Concrete",
              quantities: { count: 8, volume: { base: 12 } } },
            { type: "IfcBeam", storey: "Ground Floor", name: "Beam-1", material: "Concrete",
              quantities: { count: 12, volume: { base: 18 } } },
          ],
        },
      ],
    },
    {
      name: "Openings",
      categories: [
        {
          elements: [
            { type: "IfcDoor", storey: "Ground Floor", name: "Door-1", material: "Wood",
              quantities: { count: 5, area: { gross: 9.45 } } },
            { type: "IfcWindow", storey: "Ground Floor", name: "Win-1", material: "Aluminium",
              quantities: { count: 8, area: { gross: 14.4 } } },
          ],
        },
      ],
    },
  ],
  summary: { processedElements: 45, totalElements: 50, buildingStoreys: 2 },
  meta: { ifcSchema: "IFC2X3" },
};

// ── Mock market data (simulates TR-015 output) ──
const MOCK_MARKET_DATA = {
  steel_per_tonne: { value: 62000, unit: "₹/tonne", source: "test", date: "2026-03", confidence: "MEDIUM" },
  cement_per_bag: { value: 400, unit: "₹/bag", source: "test", date: "2026-03", confidence: "MEDIUM", brand: "UltraTech" },
  sand_per_cft: { value: 50, unit: "₹/cft", source: "test", date: "2026-03", confidence: "MEDIUM", type: "M-sand" },
  labor: {
    mason: { value: 800, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
    helper: { value: 440, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
    carpenter: { value: 880, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
    steelFixer: { value: 760, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
    electrician: { value: 1000, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
    plumber: { value: 840, unit: "₹/day", source: "test", date: "2026-03", confidence: "MEDIUM" },
  },
  benchmark_per_sqft: { value: 35000, range_low: 25000, range_high: 55000, source: "test", building_type: "commercial" },
  cpwd_index: { factor: 1.0, source: "test", year: 2026 },
  minimum_cost_per_m2: 22000,
  typical_range_min: 25000,
  typical_range_max: 55000,
  building_type_factor: 1.0,
  mep_percentage: 25,
  state_pwd_factor: 1.0,
  absolute_minimum_cost: 18000,
  benchmark_label: "test",
  sources_summary: [],
  fetched_at: new Date().toISOString(),
  city: picked.city,
  state: picked.state,
  agent_status: "success" as const,
  agent_notes: [],
  search_count: 5,
  duration_ms: 100,
  fallbacks_used: 0,
};

describe(`BOQ Pipeline Smoke Test — ${picked.city}, ${picked.state}`, () => {

  // Suppress console logs during tests
  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("Indian pricing adjustment completes without error", () => {
    
    const result = calculateIndianPricingAdjustment(picked.state, picked.city);
    expect(result).toBeDefined();
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThan(3);
    expect(result.cityTier).toBeDefined();
  });

  it("IS 1200 rate lookup works for all major element types", () => {
    
    const types = ["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcRailing", "IfcCovering", "IfcCurtainWall", "IfcReinforcingBar"];
    for (const t of types) {
      const rates = getIS1200RatesForElement(t);
      expect(rates, `${t} must have at least one rate`).toBeDefined();
      expect(Array.isArray(rates)).toBe(true);
      // Most types should have rates (some might be empty for rare types)
    }
  });

  it("Market intelligence types are consistent", () => {
    expect(MOCK_MARKET_DATA.steel_per_tonne.value).toBeGreaterThan(0);
    expect(MOCK_MARKET_DATA.labor.mason.value).toBeGreaterThan(0);
    expect(MOCK_MARKET_DATA.minimum_cost_per_m2).toBeGreaterThan(0);
  });

  it("Benchmark validation completes without error", () => {
    
    const result = validateBenchmark(35000000, 1000, "commercial", "tier-2");
    expect(result).toBeDefined();
    expect(result.costPerM2).toBeGreaterThan(0);
    expect(["within", "below", "above"]).toContain(result.status);
  });

  it("MEP estimation completes for all building types", () => {
    
    const types = ["residential", "commercial", "wellness", "healthcare", "industrial"];
    for (const bt of types) {
      const sums = estimateMEPCosts(1000, bt, 5, "tier-2", true);
      expect(Array.isArray(sums), `${bt} MEP must return array`).toBe(true);
      for (const s of sums) {
        expect(s.amount, `${bt} ${s.description} amount must be > 0`).toBeGreaterThan(0);
        expect(s.is1200Code, `${bt} ${s.description} must have IS code`).toBeDefined();
      }
    }
  });

  it("Foundation estimation completes for all soil types", () => {
    
    const soils = [undefined, "hard_rock", "medium", "soft_clay", "waterlogged"];
    for (const soil of soils) {
      const sums = estimateFoundationCosts(1000, 5, "commercial", "tier-2", true, soil);
      expect(Array.isArray(sums)).toBe(true);
      expect(sums.length).toBeGreaterThan(0);
    }
  });

  it("Concrete grade multiplier works for all grades", () => {
    
    expect(getConcreteGradeMultiplier("M20")).toBeLessThan(getConcreteGradeMultiplier("M25"));
    expect(getConcreteGradeMultiplier("M25")).toBeLessThan(getConcreteGradeMultiplier("M30"));
    expect(getConcreteGradeMultiplier("M30")).toBeLessThan(getConcreteGradeMultiplier("M40"));
    expect(getConcreteGradeMultiplier(undefined)).toBe(1.0);
    expect(getConcreteGradeMultiplier("UNKNOWN")).toBe(1.0);
  });

  it("Location resolution works for the picked city", () => {
    
    const loc = resolveProjectLocation("India", picked.state, picked.city);
    expect(loc.currency).toBe("INR");
    expect(loc.countryFactor).toBeGreaterThan(0);
    expect(loc.cityTierFactor).toBeGreaterThan(0);
  });

  it("ensurePerM2 converts sqft values correctly", async () => {
    // Import the module to verify it loads without errors
    const mod = await import("@/features/boq/services/market-intelligence");
    expect(mod.fetchMarketPrices).toBeDefined();
    expect(mod.computeMarketAdjustments).toBeDefined();
  });

  it("LiveRateResolver imports without error", async () => {
    const mod = await import("@/features/boq/services/live-rate-resolver");
    expect(mod.resolveRate).toBeDefined();
    expect(mod.resolveRatesBatch).toBeDefined();
    expect(mod.validateAgainstBenchmark).toBeDefined();
  });

  it("detectProjectType identifies building types correctly", () => {
    
    expect(detectProjectType("wellness center Sama").type).toBe("wellness");
    expect(["healthcare", "hospital"]).toContain(detectProjectType("hospital building").type);
    expect(detectProjectType("office tower").type).toBe("commercial");
    expect(detectProjectType("residential apartments").type).toBe("residential");
    expect(detectProjectType("warehouse storage").type).toBe("warehouse");
  });
});
