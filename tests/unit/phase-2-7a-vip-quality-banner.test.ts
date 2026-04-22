/**
 * Phase 2.7A — unit tests for the VIP quality banner.
 *
 * Three layers exercised here:
 *   1. `deriveQualityRecommendation` (stage-7-deliver) — thresholds
 *      applied at stamp time.
 *   2. `vipQualityBannerState` / `vipQualityTone` (lib/vip-quality-tone)
 *      — the pure decision function the viewer renders from.
 *   3. `useFloorPlanStore.setVipQualityResults` — store action that
 *      populates the banner's backing state.
 *
 * Together these lock in the contract: Stage 6's verdict is never
 * hidden from the user, the banner tone is deterministic given a score,
 * and the legacy flags path is still reachable for non-VIP jobs.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  deriveQualityRecommendation,
} from "@/features/floor-plan/lib/vip-pipeline/stage-7-deliver";
import {
  vipQualityTone,
  vipQualityBannerState,
} from "@/features/floor-plan/lib/vip-quality-tone";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";

describe("deriveQualityRecommendation — Stage 7 stamp thresholds", () => {
  it("returns 'pass' for score >= 80", () => {
    expect(deriveQualityRecommendation(100)).toBe("pass");
    expect(deriveQualityRecommendation(88)).toBe("pass");
    expect(deriveQualityRecommendation(80)).toBe("pass");
  });

  it("returns 'retry' for 65 <= score < 80", () => {
    expect(deriveQualityRecommendation(79.9)).toBe("retry");
    expect(deriveQualityRecommendation(72)).toBe("retry");
    expect(deriveQualityRecommendation(65)).toBe("retry");
  });

  it("returns 'fail' for score < 65", () => {
    expect(deriveQualityRecommendation(64.9)).toBe("fail");
    expect(deriveQualityRecommendation(42)).toBe("fail");
    expect(deriveQualityRecommendation(0)).toBe("fail");
  });

  it("returns 'fail' for any non-finite input (defensive)", () => {
    // Safer than trusting Infinity >= 80 — a broken or mocked score should
    // never silently render as green. Number.isFinite excludes NaN and ±Infinity.
    expect(deriveQualityRecommendation(Number.NaN)).toBe("fail");
    expect(deriveQualityRecommendation(Number.POSITIVE_INFINITY)).toBe("fail");
    expect(deriveQualityRecommendation(Number.NEGATIVE_INFINITY)).toBe("fail");
  });
});

describe("vipQualityTone — banner tone decision", () => {
  it("returns 'red' when recommendation is 'fail' regardless of score", () => {
    expect(vipQualityTone(95, "fail")).toBe("red");
    expect(vipQualityTone(null, "fail")).toBe("red");
  });

  it("returns 'red' when score < 65 even if recommendation disagrees", () => {
    expect(vipQualityTone(42, null)).toBe("red");
    expect(vipQualityTone(42, "pass")).toBe("red"); // harsher signal wins
  });

  it("returns 'yellow' for retry recommendation", () => {
    expect(vipQualityTone(null, "retry")).toBe("yellow");
  });

  it("returns 'yellow' for 65 <= score < 80", () => {
    expect(vipQualityTone(65, null)).toBe("yellow");
    expect(vipQualityTone(79, null)).toBe("yellow");
  });

  it("returns 'green' for score >= 80 with pass recommendation", () => {
    expect(vipQualityTone(80, "pass")).toBe("green");
    expect(vipQualityTone(92, "pass")).toBe("green");
  });
});

describe("vipQualityBannerState — headline text", () => {
  it("uses 'Quality check FAILED' for red tone with score", () => {
    const s = vipQualityBannerState(42, "fail");
    expect(s.tone).toBe("red");
    expect(s.headline).toMatch(/FAILED/);
    expect(s.headline).toMatch(/42/);
  });

  it("uses 'Quality below target' for yellow tone", () => {
    const s = vipQualityBannerState(72, "retry");
    expect(s.tone).toBe("yellow");
    expect(s.headline).toMatch(/below target/);
    expect(s.headline).toMatch(/72/);
  });

  it("uses 'Quality passed' for green tone", () => {
    const s = vipQualityBannerState(88, "pass");
    expect(s.tone).toBe("green");
    expect(s.headline).toMatch(/passed/);
    expect(s.headline).toMatch(/88/);
  });

  it("omits the score suffix when score is null", () => {
    const s = vipQualityBannerState(null, "retry");
    expect(s.tone).toBe("yellow");
    expect(s.headline).not.toMatch(/\d+\/100/);
  });
});

describe("useFloorPlanStore.setVipQualityResults", () => {
  beforeEach(() => {
    // Start each test from the default-initialised store state.
    useFloorPlanStore.getState().setVipQualityResults(null);
  });

  it("updates all three VIP quality fields atomically", () => {
    useFloorPlanStore.getState().setVipQualityResults({
      score: 42,
      weakAreas: ["bedroomPrivacy", "vastuCompliance"],
      recommendation: "fail",
    });
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBe(42);
    expect(s.vipWeakAreas).toEqual(["bedroomPrivacy", "vastuCompliance"]);
    expect(s.vipQualityRecommendation).toBe("fail");
  });

  it("clears the VIP quality surface when passed null (e.g. loading a saved project)", () => {
    // Seed it first.
    useFloorPlanStore.getState().setVipQualityResults({
      score: 88,
      weakAreas: [],
      recommendation: "pass",
    });
    expect(useFloorPlanStore.getState().vipQualityScore).toBe(88);

    // Now clear.
    useFloorPlanStore.getState().setVipQualityResults(null);
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBeNull();
    expect(s.vipWeakAreas).toEqual([]);
    expect(s.vipQualityRecommendation).toBeNull();
  });

  it("startGeneration resets the VIP quality surface", () => {
    useFloorPlanStore.getState().setVipQualityResults({
      score: 88,
      weakAreas: ["x"],
      recommendation: "pass",
    });
    useFloorPlanStore.getState().startGeneration("3bhk in pune");
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBeNull();
    expect(s.vipWeakAreas).toEqual([]);
    expect(s.vipQualityRecommendation).toBeNull();
  });

  it("resetToWelcome resets the VIP quality surface", () => {
    useFloorPlanStore.getState().setVipQualityResults({
      score: 42,
      weakAreas: ["x"],
      recommendation: "fail",
    });
    useFloorPlanStore.getState().resetToWelcome();
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBeNull();
    expect(s.vipWeakAreas).toEqual([]);
    expect(s.vipQualityRecommendation).toBeNull();
  });
});

describe("Legacy / VIP banner precedence (contract-level sanity)", () => {
  beforeEach(() => {
    useFloorPlanStore.getState().setVipQualityResults(null);
    useFloorPlanStore.getState().setQualityResults(null, [], []);
  });

  it("VIP banner is latched when vipQualityScore is set, regardless of legacy flags", () => {
    // A legacy gen could leave flags behind; a subsequent VIP completion
    // must still show the truthful VIP banner.
    useFloorPlanStore.getState().setQualityResults(null, [
      { severity: "warning", code: "SOME_FLAG", message: "legacy flag leftover" },
    ] as unknown as Parameters<ReturnType<typeof useFloorPlanStore.getState>["setQualityResults"]>[1], []);
    useFloorPlanStore.getState().setVipQualityResults({
      score: 42, weakAreas: [], recommendation: "fail",
    });
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBe(42);
    // Banner render gate in FloorPlanViewer checks vipQualityScore !== null
    // first, so the VIP red banner wins even though a legacy flag exists.
    expect(s.vipQualityScore !== null).toBe(true);
  });

  it("Legacy path remains reachable: vipQualityScore stays null, legacy flags drive the banner", () => {
    useFloorPlanStore.getState().setQualityResults(null, [
      { severity: "critical", code: "FOO", message: "bar" },
    ] as unknown as Parameters<ReturnType<typeof useFloorPlanStore.getState>["setQualityResults"]>[1], []);
    const s = useFloorPlanStore.getState();
    expect(s.vipQualityScore).toBeNull();
    expect(s.lastQualityFlags.length).toBe(1);
  });
});
