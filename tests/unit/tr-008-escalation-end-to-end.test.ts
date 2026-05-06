/**
 * End-to-end escalation test — proves that changing projectDate
 * produces proportionally higher costs using the DatedRate system.
 *
 * Tests escalation at the utility level (escalateValue) since full
 * TR-008 handler requires Prisma/web-ifc. The utility is what TR-008
 * calls at every rate consumption point.
 */
import { describe, it, expect } from "vitest";
import {
  escalateValue,
  getEscalationFactor,
  getCurvesForSubcategory,
  IS1200_BASELINE,
  MEP_BASELINE,
  BENCHMARK_BASELINE,
  ESCALATION_CURVES,
} from "@/features/boq/lib/dated-rate";

describe("Phase B.1 — End-to-end rate escalation", () => {
  // ── Core escalation at 4-year intervals ──
  it("RCC M25 Slab (₹6750): 2026 → 2030 = ~1.26×, 2034 = ~1.59×", () => {
    const base = 6750;
    const v2026 = escalateValue(base, "construction-cpi-india", IS1200_BASELINE, new Date("2026-05-03"));
    const v2028 = escalateValue(base, "construction-cpi-india", IS1200_BASELINE, new Date("2028-05-03"));
    const v2030 = escalateValue(base, "construction-cpi-india", IS1200_BASELINE, new Date("2030-05-03"));
    const v2034 = escalateValue(base, "construction-cpi-india", IS1200_BASELINE, new Date("2034-05-03"));

    // Near baseline — minimal escalation
    expect(v2026).toBeGreaterThan(6750);
    expect(v2026).toBeLessThan(6850);

    // 2 years → ~12%
    expect(v2028 / base).toBeGreaterThan(1.10);
    expect(v2028 / base).toBeLessThan(1.15);

    // 4 years → ~26%
    expect(v2030 / base).toBeGreaterThan(1.24);
    expect(v2030 / base).toBeLessThan(1.28);

    // 8 years → ~59%
    expect(v2034 / base).toBeGreaterThan(1.56);
    expect(v2034 / base).toBeLessThan(1.63);
  });

  // ── Steel escalates at wpi-steel (6%/yr) ──
  it("Steel TMT (₹75,000/T): wpi-steel curve matches construction CPI", () => {
    const steelFactor = getEscalationFactor("wpi-steel", IS1200_BASELINE, new Date("2030-05-03"));
    const cpiFactor = getEscalationFactor("construction-cpi-india", IS1200_BASELINE, new Date("2030-05-03"));
    // Both are 6%/yr — should be nearly identical
    expect(Math.abs(steelFactor - cpiFactor)).toBeLessThan(0.001);
  });

  // ── Labor escalates FASTER (9%/yr vs 6%/yr) ──
  it("Mason labor escalates faster than concrete material", () => {
    const laborFactor = getEscalationFactor("labor-mason", IS1200_BASELINE, new Date("2030-05-03"));
    const materialFactor = getEscalationFactor("wpi-cement", IS1200_BASELINE, new Date("2030-05-03"));
    // Mason 9%/yr for 4yr ≈ 1.41, Cement 4.5%/yr for 4yr ≈ 1.19
    expect(laborFactor).toBeGreaterThan(materialFactor * 1.15);
  });

  // ── MEP escalates at 5.5%/yr from MEP_BASELINE (earlier than IS1200) ──
  it("MEP provisional escalation accounts for earlier baseline", () => {
    const mepFactor = getEscalationFactor("mep-composite", MEP_BASELINE, new Date("2030-05-03"));
    const is1200Factor = getEscalationFactor("construction-cpi-india", IS1200_BASELINE, new Date("2030-05-03"));
    // MEP baseline is 2024-06, IS1200 is 2026-04 → MEP has ~2 more years of escalation
    // Even though MEP curve (5.5%) is lower than CPI (6%), the extra 2 years compensate
    expect(mepFactor).toBeGreaterThan(is1200Factor);
  });

  // ── Curve mapping for subcategories ──
  it("Concrete subcategory maps to cement material + mason labour", () => {
    const c = getCurvesForSubcategory("Concrete");
    expect(c.material).toBe("wpi-cement");
    expect(c.labour).toBe("labor-mason");
    expect(c.total).toBe("construction-cpi-india");
  });

  it("Steel subcategory maps to wpi-steel for both total and material", () => {
    const c = getCurvesForSubcategory("Steel");
    expect(c.total).toBe("wpi-steel");
    expect(c.material).toBe("wpi-steel");
  });

  it("Finishes subcategory maps to finishes-composite", () => {
    const c = getCurvesForSubcategory("Finishes");
    expect(c.total).toBe("finishes-composite");
    expect(c.material).toBe("finishes-composite");
    expect(c.labour).toBe("labor-mason");
  });

  it("Unknown subcategory falls back to construction-cpi-india", () => {
    const c = getCurvesForSubcategory("SomethingNew");
    expect(c.total).toBe("construction-cpi-india");
    expect(c.labour).toBe("labor-mason");
  });

  // ── Benchmark ranges escalate too ──
  it("Benchmark range (₹35,000-60,000 commercial) escalates from BENCHMARK_BASELINE", () => {
    const low2030 = escalateValue(35000, "construction-cpi-india", BENCHMARK_BASELINE, new Date("2030-05-03"));
    const low2026 = escalateValue(35000, "construction-cpi-india", BENCHMARK_BASELINE, new Date("2026-05-03"));
    // BENCHMARK_BASELINE is 2024-06, so by 2030 = 6 years → factor ~1.42
    expect(low2030).toBeGreaterThan(low2026 * 1.15);
  });

  // ── Min cost floor escalates ──
  it("Min cost floor (₹22,000 commercial) escalates with project date", () => {
    const floor2026 = escalateValue(22000, "construction-cpi-india", BENCHMARK_BASELINE, new Date("2026-05-03"));
    const floor2030 = escalateValue(22000, "construction-cpi-india", BENCHMARK_BASELINE, new Date("2030-05-03"));
    expect(floor2030).toBeGreaterThan(floor2026 * 1.20);
  });

  // ── All CAGR rates are positive and < 15% ──
  it("all escalation curves are between 0% and 15%", () => {
    for (const [name, rate] of Object.entries(ESCALATION_CURVES)) {
      expect(rate, name).toBeGreaterThanOrEqual(0);
      expect(rate, name).toBeLessThanOrEqual(0.15);
    }
  });
});
