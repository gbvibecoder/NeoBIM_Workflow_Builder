/**
 * F-1.1 regression test — thank-you page derives plan features from STRIPE_PLANS.
 *
 * Prior to this fix, src/app/thank-you/subscription/page.tsx hardcoded a
 * `PLANS` dictionary that drifted from STRIPE_PLANS during the §J pricing
 * migration. The page advertised pre-migration limits (PRO=100 runs vs
 * actual 45; MINI=10 vs actual 3) to every paying user immediately after
 * checkout. See F-1.1 in PROD_AUDIT_2026-05-10.md.
 *
 * These tests pin the derivation against STRIPE_PLANS so a future limit
 * change in the SSOT automatically updates the thank-you page — no
 * separate dictionary to maintain.
 *
 * Caveat noted in the issuing prompt: this is a UI-render bug; a unit
 * test cannot replace a real Razorpay test-mode checkout. The test
 * guards against derivation drift; the manual smoke is the final word
 * on rendered output.
 */
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { STRIPE_PLANS } from "@/features/billing/lib/plan-data";
import { getPlanDisplay } from "@/app/thank-you/subscription/page";

describe("getPlanDisplay — derives from STRIPE_PLANS", () => {
  it("MINI: runs/renders match STRIPE_PLANS.MINI.limits exactly", () => {
    const d = getPlanDisplay("MINI");
    expect(d).not.toBeNull();
    expect(d?.name).toBe("Mini");
    expect(d?.executions).toBe(`${STRIPE_PLANS.MINI.limits.runsPerMonth}/month`);
    expect(d?.features[0]).toContain(`${STRIPE_PLANS.MINI.limits.runsPerMonth} workflow executions`);
    expect(d?.features[1]).toContain(`${STRIPE_PLANS.MINI.limits.rendersPerMonth} concept renders`);
  });

  it("MINI: omits video/3D-model lines because limits are 0", () => {
    const d = getPlanDisplay("MINI");
    const text = d?.features.join("|") ?? "";
    expect(text).not.toMatch(/video walkthroughs/);
    expect(text).not.toMatch(/AI 3D models/);
  });

  it("STARTER: all limits match SSOT (15/8/2/2 + 5 floor plans)", () => {
    const d = getPlanDisplay("STARTER");
    const l = STRIPE_PLANS.STARTER.limits;
    expect(d?.name).toBe("Starter");
    expect(d?.features[0]).toContain(`${l.runsPerMonth} workflow executions`);
    expect(d?.features[1]).toContain(`${l.rendersPerMonth} concept renders`);
    expect(d?.features.some((f) => f.includes(`${l.videoPerMonth} video walkthroughs`))).toBe(true);
    expect(d?.features.some((f) => f.includes(`${l.modelsPerMonth} AI 3D models`))).toBe(true);
    expect(d?.features.some((f) => f.includes(`${l.floorPlansPerMonth} floor plans`))).toBe(true);
  });

  it("PRO: 45 runs (not 100) — the pre-§J drift bug must stay fixed", () => {
    const d = getPlanDisplay("PRO");
    expect(d?.features[0]).toContain(`${STRIPE_PLANS.PRO.limits.runsPerMonth} workflow executions`);
    // The pre-fix page advertised "100 workflow executions" — guard the regression.
    expect(d?.features[0]).not.toContain("100 workflow executions");
    expect(STRIPE_PLANS.PRO.limits.runsPerMonth).toBe(45);
  });

  it("PRO: maxNodesPerWorkflow is unlimited (-1 in SSOT)", () => {
    const d = getPlanDisplay("PRO");
    expect(d?.features.some((f) => f === "Unlimited nodes per workflow")).toBe(true);
    expect(STRIPE_PLANS.PRO.limits.maxNodesPerWorkflow).toBe(-1);
  });

  it("TEAM: 300 runs (not 'Unlimited') — the SSOT is finite", () => {
    const d = getPlanDisplay("TEAM");
    const runs = STRIPE_PLANS.TEAM.limits.runsPerMonth;
    expect(d?.executions).toBe(`${runs}/month`);
    expect(d?.features[0]).toContain(`${runs} workflow executions`);
    // Pre-fix page said "Unlimited executions" / "Unlimited renders" — both lies.
    expect(d?.features.join(" ")).not.toContain("Unlimited executions");
    expect(d?.features.join(" ")).not.toContain("Unlimited renders");
    expect(runs).toBe(300);
  });

  it("TEAM_ADMIN role normalizes to TEAM tier display", () => {
    expect(getPlanDisplay("TEAM_ADMIN")?.name).toBe("Team");
  });

  it("PLATFORM_ADMIN role normalizes to TEAM tier display", () => {
    expect(getPlanDisplay("PLATFORM_ADMIN")?.name).toBe("Team");
  });

  it("lowercase URL params normalize correctly", () => {
    // The page does `.toUpperCase()` on the URL param BEFORE calling
    // getPlanDisplay, so we test that uppercased flows resolve cleanly.
    expect(getPlanDisplay("PRO")?.name).toBe("Pro");
    expect(getPlanDisplay("STARTER")?.name).toBe("Starter");
  });

  it("unknown plan name → null (graceful, no crash)", () => {
    expect(getPlanDisplay("GIBBERISH")).toBeNull();
    expect(getPlanDisplay("ENTERPRISE")).toBeNull();
    expect(getPlanDisplay("")).toBeNull();
    expect(getPlanDisplay(null)).toBeNull();
    expect(getPlanDisplay(undefined)).toBeNull();
  });

  it("FREE plan → null (no thank-you card for free signups)", () => {
    expect(getPlanDisplay("FREE")).toBeNull();
  });
});

describe("getPlanDisplay — full SSOT round-trip", () => {
  // For every paid tier, every advertised number must trace back to STRIPE_PLANS.
  const paidTiers = ["MINI", "STARTER", "PRO", "TEAM"] as const;

  for (const tier of paidTiers) {
    it(`${tier}: every features line traces back to STRIPE_PLANS.${tier}.limits`, () => {
      const d = getPlanDisplay(tier);
      const l = STRIPE_PLANS[tier].limits;
      expect(d).not.toBeNull();
      const joined = d!.features.join("\n");

      // runs + renders always present
      expect(joined).toContain(`${l.runsPerMonth} workflow executions per month`);
      expect(joined).toContain(`${l.rendersPerMonth} concept renders`);

      // video / 3D model lines: present only when > 0
      if (l.videoPerMonth > 0) {
        expect(joined).toContain(`${l.videoPerMonth} video walkthroughs`);
      } else {
        expect(joined).not.toContain("video walkthroughs");
      }
      if (l.modelsPerMonth > 0) {
        expect(joined).toContain(`${l.modelsPerMonth} AI 3D models`);
      } else {
        expect(joined).not.toContain("AI 3D models");
      }

      // floor plans, maxWorkflows, maxNodes — always present
      if (l.floorPlansPerMonth > 0) {
        expect(joined).toContain(`${l.floorPlansPerMonth} floor plans`);
      }
      if (l.maxWorkflows < 0) {
        expect(joined).toContain("Unlimited saved workflows");
      } else {
        expect(joined).toContain(`Up to ${l.maxWorkflows} saved workflows`);
      }
      if (l.maxNodesPerWorkflow < 0) {
        expect(joined).toContain("Unlimited nodes per workflow");
      } else {
        expect(joined).toContain(`Up to ${l.maxNodesPerWorkflow} nodes per workflow`);
      }

      // executions pill
      expect(d!.executions).toBe(`${l.runsPerMonth}/month`);

      // name comes from SSOT, not a parallel dict
      expect(d!.name).toBe(STRIPE_PLANS[tier].name);
    });
  }
});
