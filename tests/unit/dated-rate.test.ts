/**
 * Tests for the DatedRate time-aware escalation system (Phase B).
 */
import { describe, it, expect } from "vitest";
import {
  escalateRate,
  escalateValue,
  getStalenessLevel,
  makeRate,
  IS1200_BASELINE,
  ESCALATION_CURVES,
} from "@/features/boq/lib/dated-rate";
import type { DatedRate } from "@/features/boq/lib/dated-rate";

describe("DatedRate — escalateRate()", () => {
  const rccSlab = makeRate(6750, "INR/m³", "2026-04-01", "CPWD DSR 2025-26", "construction-cpi-india");

  it("returns baseline value when project date = baseline date", () => {
    const r = escalateRate(rccSlab, new Date("2026-04-01"));
    expect(r.value).toBe(6750);
    expect(r.confidence).toBe("fresh");
    expect(r.escalationApplied).toBe(1);
  });

  it("escalates ~26% over 4 years at 6% CAGR", () => {
    const r = escalateRate(rccSlab, new Date("2030-04-01"));
    // 6750 × 1.06^4 = 6750 × 1.2625 ≈ 8522
    expect(r.value).toBeGreaterThan(8400);
    expect(r.value).toBeLessThan(8650);
    // Exactly 4 years = boundary → "expired" (>= 4yr threshold)
    expect(r.confidence).toBe("expired");
    expect(r.escalationApplied).toBeGreaterThan(1.25);
    expect(r.escalationApplied).toBeLessThan(1.27);
  });

  it("returns fresh confidence within 1 year", () => {
    const r = escalateRate(rccSlab, new Date("2026-10-01")); // 6 months
    expect(r.confidence).toBe("fresh");
  });

  it("returns escalated confidence at 1-2 years", () => {
    const r = escalateRate(rccSlab, new Date("2027-10-01")); // 18 months
    expect(r.confidence).toBe("escalated");
  });

  it("returns stale confidence at 2-4 years", () => {
    const r = escalateRate(rccSlab, new Date("2029-04-01")); // 3 years
    expect(r.confidence).toBe("stale");
    expect(r.warning).toContain("years old");
  });

  it("returns expired confidence after 4 years", () => {
    const r = escalateRate(rccSlab, new Date("2031-04-01")); // 5 years
    expect(r.confidence).toBe("expired");
    expect(r.warning).toContain("years old");
  });

  it("does not escalate when project date is before baseline", () => {
    const r = escalateRate(rccSlab, new Date("2025-01-01"));
    expect(r.value).toBe(6750);
    expect(r.confidence).toBe("fresh");
    expect(r.escalationApplied).toBe(1);
  });

  it("respects validUntil hard expiry", () => {
    const expiring: DatedRate = { ...rccSlab, validUntil: "2028-04-01" };
    const r = escalateRate(expiring, new Date("2029-01-01"));
    expect(r.confidence).toBe("expired");
    expect(r.warning).toContain("expired");
  });

  it("uses correct CAGR for labor (9%/yr)", () => {
    const mason = makeRate(950, "INR/day", "2026-04-01", "CPWD DSR 2025-26", "labor-mason");
    const r = escalateRate(mason, new Date("2030-04-01"));
    // 950 × 1.09^4 = 950 × 1.4116 ≈ 1341
    expect(r.value).toBeGreaterThan(1300);
    expect(r.value).toBeLessThan(1400);
  });

  it("static curve produces zero escalation", () => {
    const factor = makeRate(1.18, "multiplier", "2024-01-01", "CPWD", "static");
    const r = escalateRate(factor, new Date("2030-01-01"));
    expect(r.value).toBe(1.18);
    expect(r.escalationApplied).toBe(1);
  });
});

describe("DatedRate — escalateValue()", () => {
  it("escalates a raw number", () => {
    const v = escalateValue(5000, "construction-cpi-india", IS1200_BASELINE, new Date("2030-04-01"));
    // 5000 × 1.06^4 ≈ 6312
    expect(v).toBeGreaterThan(6200);
    expect(v).toBeLessThan(6400);
  });

  it("returns original for same-day project", () => {
    const v = escalateValue(5000, "construction-cpi-india", "2026-04-01", new Date("2026-04-01"));
    expect(v).toBe(5000);
  });
});

describe("DatedRate — getStalenessLevel()", () => {
  it("ok for project date within 2 years", () => {
    const s = getStalenessLevel("2026-04-01", new Date("2027-10-01"));
    expect(s.severity).toBe("ok");
  });

  it("warning for 2-4 years", () => {
    const s = getStalenessLevel("2026-04-01", new Date("2029-04-01"));
    expect(s.severity).toBe("warning");
    expect(s.message).toContain("escalated");
  });

  it("critical for >4 years", () => {
    const s = getStalenessLevel("2026-04-01", new Date("2031-06-01"));
    expect(s.severity).toBe("critical");
    expect(s.message).toContain("Class 5");
  });
});

describe("ESCALATION_CURVES sanity", () => {
  it("all curves are between 0 and 0.15", () => {
    for (const [name, rate] of Object.entries(ESCALATION_CURVES)) {
      expect(rate, `${name}`).toBeGreaterThanOrEqual(0);
      expect(rate, `${name}`).toBeLessThanOrEqual(0.15);
    }
  });

  it("static curve is exactly 0", () => {
    expect(ESCALATION_CURVES.static).toBe(0);
  });
});
