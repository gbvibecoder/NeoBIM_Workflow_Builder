/**
 * Unit tests for template-access helpers.
 *
 * The two helpers (canAccessTemplate / getUpgradeTargetForTemplate) are the
 * SSOT for "can this user use this template" — both the templates page and
 * the server route /api/workflows/from-template route through them, so
 * regressions here flow into UX + the security boundary at once.
 */
import { describe, it, expect } from "vitest";
import {
  canAccessTemplate,
  getUpgradeTargetForTemplate,
} from "@/features/billing/lib/template-access";

describe("canAccessTemplate", () => {
  it("returns true for templates with no requiredTier (legacy templates)", () => {
    expect(canAccessTemplate("FREE", undefined)).toBe(true);
    expect(canAccessTemplate(undefined, undefined)).toBe(true);
  });

  it("treats requiredTier=FREE as universally accessible", () => {
    expect(canAccessTemplate("FREE", "FREE")).toBe(true);
    expect(canAccessTemplate(undefined, "FREE")).toBe(true);
  });

  it("blocks anonymous users on any non-FREE tier", () => {
    expect(canAccessTemplate(undefined, "MINI")).toBe(false);
    expect(canAccessTemplate(null, "PRO")).toBe(false);
  });

  it("permits exact-match tier", () => {
    expect(canAccessTemplate("MINI", "MINI")).toBe(true);
    expect(canAccessTemplate("STARTER", "STARTER")).toBe(true);
    expect(canAccessTemplate("PRO", "PRO")).toBe(true);
  });

  it("permits a higher-tier user against a lower-tier template", () => {
    expect(canAccessTemplate("PRO", "MINI")).toBe(true);
    expect(canAccessTemplate("STARTER", "MINI")).toBe(true);
    expect(canAccessTemplate("PRO", "STARTER")).toBe(true);
  });

  it("blocks a lower-tier user against a higher-tier template", () => {
    expect(canAccessTemplate("FREE", "MINI")).toBe(false);
    expect(canAccessTemplate("FREE", "PRO")).toBe(false);
    expect(canAccessTemplate("MINI", "STARTER")).toBe(false);
    expect(canAccessTemplate("STARTER", "PRO")).toBe(false);
  });

  it("treats template tier 'TEAM' as the TEAM_ADMIN role rank", () => {
    expect(canAccessTemplate("PRO", "TEAM")).toBe(false);
    expect(canAccessTemplate("TEAM_ADMIN", "TEAM")).toBe(true);
  });

  it("admin roles bypass any tier requirement", () => {
    expect(canAccessTemplate("PLATFORM_ADMIN", "TEAM")).toBe(true);
    expect(canAccessTemplate("PLATFORM_ADMIN", "PRO")).toBe(true);
    expect(canAccessTemplate("TEAM_ADMIN", "PRO")).toBe(true);
  });
});

describe("getUpgradeTargetForTemplate", () => {
  it("returns null when the user already has access", () => {
    expect(getUpgradeTargetForTemplate("PRO", "MINI")).toBeNull();
    expect(getUpgradeTargetForTemplate("FREE", "FREE")).toBeNull();
    expect(getUpgradeTargetForTemplate("FREE", undefined)).toBeNull();
    expect(getUpgradeTargetForTemplate("PLATFORM_ADMIN", "TEAM")).toBeNull();
  });

  it("returns the required tier label + price for a locked-out user", () => {
    const proTarget = getUpgradeTargetForTemplate("FREE", "PRO");
    expect(proTarget).not.toBeNull();
    expect(proTarget?.tier).toBe("PRO");
    expect(proTarget?.label).toBe("Pro");
    expect(proTarget?.price).toBeGreaterThan(0);
    expect(proTarget?.currency).toBe("₹");

    const miniTarget = getUpgradeTargetForTemplate("FREE", "MINI");
    expect(miniTarget?.tier).toBe("MINI");
    expect(miniTarget?.label).toBe("Mini");

    const starterTarget = getUpgradeTargetForTemplate("MINI", "STARTER");
    expect(starterTarget?.tier).toBe("STARTER");
    expect(starterTarget?.label).toBe("Starter");
  });

  it("uses STRIPE_PLANS pricing as SSOT", async () => {
    // Sanity check the helper isn't inventing a number.
    const { STRIPE_PLANS } = await import("@/features/billing/lib/plan-data");
    const target = getUpgradeTargetForTemplate("FREE", "PRO");
    expect(target?.price).toBe(STRIPE_PLANS.PRO.price);
  });
});
