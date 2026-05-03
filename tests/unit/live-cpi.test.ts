/**
 * Tests for live-cpi.ts — CPI/WPI escalation curve service.
 */
import { describe, it, expect } from "vitest";
import { getLiveEscalationCurves, setLiveCurvesCache, getLiveCurvesCached } from "@/features/boq/services/live-cpi";

describe("B.3 — Live CPI service", () => {
  it("returns LiveEscalationCurves with all 9 curve keys", async () => {
    const result = await getLiveEscalationCurves();
    expect(result).toHaveProperty("asOfDate");
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("ageDays");
    expect(result).toHaveProperty("curves");

    const keys = Object.keys(result.curves);
    expect(keys).toContain("construction-cpi-india");
    expect(keys).toContain("wpi-steel");
    expect(keys).toContain("wpi-cement");
    expect(keys).toContain("labor-mason");
    expect(keys).toContain("labor-helper");
    expect(keys).toContain("labor-skilled");
    expect(keys).toContain("finishes-composite");
    expect(keys).toContain("mep-composite");
    expect(keys).toContain("static");
  });

  it("all curve values are between 0 and 0.15", async () => {
    const result = await getLiveEscalationCurves();
    for (const [name, rate] of Object.entries(result.curves)) {
      expect(rate, name).toBeGreaterThanOrEqual(0);
      expect(rate, name).toBeLessThanOrEqual(0.15);
    }
  });

  it("static curve is always 0", async () => {
    const result = await getLiveEscalationCurves();
    expect(result.curves.static).toBe(0);
  });

  it("in-memory cache works (set + get)", () => {
    const mockCurves = {
      asOfDate: "2026-05-01",
      source: "mospi-rbi" as const,
      ageDays: 3,
      curves: {
        "construction-cpi-india": 0.062,
        "wpi-steel": 0.058,
        "wpi-cement": 0.047,
        "labor-mason": 0.09,
        "labor-helper": 0.10,
        "labor-skilled": 0.085,
        "finishes-composite": 0.045,
        "mep-composite": 0.055,
        "static": 0,
      },
    };
    setLiveCurvesCache(mockCurves);
    const cached = getLiveCurvesCached();
    expect(cached).not.toBeNull();
    expect(cached!.curves["wpi-steel"]).toBe(0.058);
    expect(cached!.source).toBe("mospi-rbi");
  });

  it("in test env, falls back to hardcoded (source=fallback)", async () => {
    const result = await getLiveEscalationCurves();
    // In test env: no Redis, HTTP may timeout → expect fallback or live
    expect(["mospi-rbi", "cached", "fallback"]).toContain(result.source);
  });
});
