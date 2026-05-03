/**
 * Plan Consistency — Single Source of Truth enforcement.
 *
 * STRIPE_PLANS in src/features/billing/lib/stripe.ts is the canonical
 * source for every plan limit, price, and credit count.  These tests
 * ensure that NO other file re-introduces hardcoded plan numbers.
 *
 * If this test fails after your change, you almost certainly hardcoded a
 * plan limit somewhere.  Use the helpers in plan-helpers.ts or read
 * directly from STRIPE_PLANS instead.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { STRIPE_PLANS } from "../../src/features/billing/lib/plan-data";
import {
  toPlanKey,
  getPlanConfig,
  getPlanLimits,
  getPlanCredits,
  getPlanCreditsTotal,
  formatPlanLimit,
  interpolatePlanString,
} from "../../src/features/billing/lib/plan-helpers";

// ── Helper: read a source file relative to repo root ──────────────────────

function readSrc(relPath: string): string {
  return readFileSync(resolve(__dirname, "../../src", relPath), "utf8");
}

// ── A. STRIPE_PLANS schema completeness ───────────────────────────────────

describe("STRIPE_PLANS schema", () => {
  const REQUIRED_LIMIT_KEYS = [
    "runsPerMonth",
    "maxWorkflows",
    "maxNodesPerWorkflow",
    "videoPerMonth",
    "modelsPerMonth",
    "rendersPerMonth",
    "briefRendersPerMonth",
  ] as const;

  for (const [planName, plan] of Object.entries(STRIPE_PLANS)) {
    it(`${planName} has all required limit fields`, () => {
      for (const key of REQUIRED_LIMIT_KEYS) {
        expect(plan.limits).toHaveProperty(key);
        expect(typeof plan.limits[key]).toBe("number");
      }
    });

    it(`${planName} has name, price, currency`, () => {
      expect(typeof plan.name).toBe("string");
      expect(typeof plan.price).toBe("number");
      expect(plan.currency).toBe("₹");
    });
  }
});

// ── B. No hardcoded plan-limit numbers in UI files ────────────────────────

describe("No hardcoded plan limits in UI components", () => {
  // Pattern: detects assignments like `renders: 5`, `videos: 1`, `threeD: 2`
  // in contexts that look like plan-metadata objects (not general code).
  const PLAN_META_PATTERN = /\b(renders|videos|threeD|modelsPerMonth|videoPerMonth|rendersPerMonth)\s*[:=]\s*\d+/;

  // Pattern: detects hardcoded nodeCredits `value: "2"` etc. (but allows "0" since
  // formatPlanLimit(0) also produces "0" — the key check is that it comes from the helper).
  const HARDCODED_CREDIT_VALUE = /value:\s*"[1-9]\d*"/;

  const UI_FILES = [
    "features/dashboard/components/settings/PlanTab.tsx",
    "features/landing/components/PricingSection.tsx",
    "app/dashboard/billing/page.tsx",
  ];

  for (const file of UI_FILES) {
    it(`${file} has no hardcoded PLAN_META-style assignments`, () => {
      const src = readSrc(file);
      // Filter out import lines and comments
      const codeLines = src.split("\n").filter(
        (l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.includes("import ")
      );
      const codeOnly = codeLines.join("\n");
      expect(codeOnly).not.toMatch(PLAN_META_PATTERN);
    });
  }

  it("PlanTab.tsx does not define PLAN_META", () => {
    const src = readSrc("features/dashboard/components/settings/PlanTab.tsx");
    expect(src).not.toContain("PLAN_META");
  });
});

// ── C. Billing page limitMap replaced ─────────────────────────────────────

describe("Billing page uses STRIPE_PLANS for limits", () => {
  it("does not contain hardcoded limitMap", () => {
    const src = readSrc("app/dashboard/billing/page.tsx");
    expect(src).not.toMatch(/limitMap\s*[:=]/);
  });

  it("does not contain hardcoded limit: 3", () => {
    const src = readSrc("app/dashboard/billing/page.tsx");
    // Look for `limit: 3` but not inside strings or comments
    const codeLines = src.split("\n").filter(
      (l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")
    );
    const codeOnly = codeLines.join("\n");
    expect(codeOnly).not.toMatch(/\blimit:\s*3\b/);
  });
});

// ── D. plan-helpers.ts correctness ────────────────────────────────────────

describe("plan-helpers", () => {
  it("toPlanKey maps roles correctly", () => {
    expect(toPlanKey("FREE")).toBe("FREE");
    expect(toPlanKey("MINI")).toBe("MINI");
    expect(toPlanKey("STARTER")).toBe("STARTER");
    expect(toPlanKey("PRO")).toBe("PRO");
    expect(toPlanKey("TEAM_ADMIN")).toBe("TEAM");
    expect(toPlanKey("PLATFORM_ADMIN")).toBe("TEAM");
    expect(toPlanKey(null)).toBe("FREE");
    expect(toPlanKey(undefined)).toBe("FREE");
    expect(toPlanKey("UNKNOWN")).toBe("FREE");
  });

  it("getPlanConfig returns the correct plan", () => {
    expect(getPlanConfig("MINI").name).toBe("Mini");
    expect(getPlanConfig("PRO").price).toBe(1999);
  });

  it("getPlanLimits returns limits sub-object", () => {
    const limits = getPlanLimits("STARTER");
    expect(limits.runsPerMonth).toBe(30);
    expect(limits.videoPerMonth).toBe(2);
  });

  it("formatPlanLimit handles unlimited and zero", () => {
    expect(formatPlanLimit(-1)).toBe("\u221E");
    expect(formatPlanLimit(0)).toBe("0");
    expect(formatPlanLimit(10)).toBe("10");
  });

  it("getPlanCredits returns three credits", () => {
    const credits = getPlanCredits("PRO");
    expect(credits).toHaveLength(3);
    expect(credits[0].kind).toBe("video");
    expect(credits[1].kind).toBe("model");
    expect(credits[2].kind).toBe("render");
    expect(credits[0].value).toBe(STRIPE_PLANS.PRO.limits.videoPerMonth);
  });

  it("getPlanCreditsTotal computes correctly", () => {
    // TEAM: 20+30+60 = 110 (no longer has unlimited renders)
    expect(getPlanCreditsTotal("TEAM")).toBe("110");
    // PRO: 7 + 10 + 25 = 42
    expect(getPlanCreditsTotal("PRO")).toBe("42");
  });

  it("interpolatePlanString replaces all tokens", () => {
    const template = "{executions} runs, {renders} renders, {videos} videos, {models} models, {workflows} workflows";
    const result = interpolatePlanString(template, "STARTER");
    expect(result).toBe("30 runs, 8 renders, 2 videos, 2 models, 15 workflows");
  });

  it("interpolatePlanString handles large values", () => {
    const result = interpolatePlanString("{executions} runs", "TEAM");
    expect(result).toBe("300 runs");
  });
});

// ── E. Parameterized i18n consumers must call interpolatePlanString ────────

describe("Parameterized i18n strings — all consumers interpolate", () => {
  // Every file that reads a parameterized i18n key (landing.*Features,
  // billing.*Feature*, survey.scene4.*.f*) MUST call interpolatePlanString
  // before rendering.  This test catches the LightPricing.tsx miss from P1.

  const CONSUMER_FILES = [
    "features/landing/components/PricingSection.tsx",
    "features/landing/components/light/LightPricing.tsx",
    "app/dashboard/billing/page.tsx",
    "features/onboarding-survey/components/scenes/Scene4_Pricing.tsx",
  ];

  for (const file of CONSUMER_FILES) {
    it(`${file} imports interpolatePlanString`, () => {
      const src = readSrc(file);
      expect(src).toContain("interpolatePlanString");
    });
  }

  it("LightPricing.tsx calls interpolatePlanString on tArray results", () => {
    const src = readSrc("features/landing/components/light/LightPricing.tsx");
    // The tArray call should be followed by .map(... interpolatePlanString ...)
    expect(src).toMatch(/tArray\([^)]+\)\.map\([^)]*interpolatePlanString/);
  });
});

// ── F. check-execution-eligibility uses STRIPE_PLANS ──────────────────────

describe("check-execution-eligibility uses STRIPE_PLANS", () => {
  it("does not contain hardcoded limit: 3", () => {
    const src = readSrc("app/api/check-execution-eligibility/route.ts");
    // Look for `limit: 3` or `>= 3` or `- lifetimeCount` with a 3
    const codeLines = src.split("\n").filter(
      (l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")
    );
    const codeOnly = codeLines.join("\n");
    // Should NOT have raw `3 -` or `>= 3` or `limit: 3`
    expect(codeOnly).not.toMatch(/\b3\s*-\s*lifetimeCount/);
    expect(codeOnly).not.toMatch(/\blimit:\s*3\b/);
  });

  it("references getEffectiveLimits for grandfathering", () => {
    const src = readSrc("app/api/check-execution-eligibility/route.ts");
    expect(src).toContain("getEffectiveLimits");
  });
});
