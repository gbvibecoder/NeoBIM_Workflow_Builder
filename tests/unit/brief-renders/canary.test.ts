/**
 * Brief-to-Renders canary — unit tests for the master gate + allowlist
 * logic. Mirrors the shape of VIP's canary tests.
 *
 * The canary module caches its allowlist sets at module load, so each
 * test that mutates env vars must call `_resetBriefRendersCanaryCache()`
 * (or, equivalently, `vi.resetModules()` and re-import) so the next
 * call observes the new env state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  shouldUserSeeBriefRenders,
  isBriefRendersMasterEnabled,
  isUserInBriefRendersBeta,
  isBriefRendersAdminOverride,
  _resetBriefRendersCanaryCache,
} from "@/features/brief-renders/services/brief-pipeline/canary";

const originalEnv = { ...process.env };

beforeEach(() => {
  // Clean slate every test — no flag, no allowlists.
  delete process.env.PIPELINE_BRIEF_RENDERS;
  delete process.env.BRIEF_RENDERS_BETA_EMAILS;
  delete process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS;
  _resetBriefRendersCanaryCache();
});

afterEach(() => {
  // Restore process.env so the test setup file's defaults survive.
  process.env = { ...originalEnv };
  _resetBriefRendersCanaryCache();
});

describe("Brief-to-Renders canary — master kill switch", () => {
  it("returns true when PIPELINE_BRIEF_RENDERS is unset (default-on)", () => {
    expect(isBriefRendersMasterEnabled()).toBe(true);
  });

  it("returns false when PIPELINE_BRIEF_RENDERS is exactly 'false'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "false";
    expect(isBriefRendersMasterEnabled()).toBe(false);
  });

  it("returns true when PIPELINE_BRIEF_RENDERS is 'true'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    expect(isBriefRendersMasterEnabled()).toBe(true);
  });

  it("treats every non-'false' value as enabled", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "1";
    expect(isBriefRendersMasterEnabled()).toBe(true);
    process.env.PIPELINE_BRIEF_RENDERS = "TRUE";
    expect(isBriefRendersMasterEnabled()).toBe(true);
    process.env.PIPELINE_BRIEF_RENDERS = "";
    expect(isBriefRendersMasterEnabled()).toBe(true);
  });
});

describe("Brief-to-Renders canary — beta allowlist", () => {
  it("returns false for empty allowlist", () => {
    expect(isUserInBriefRendersBeta("alice@example.com")).toBe(false);
  });

  it("matches case-insensitively", () => {
    process.env.BRIEF_RENDERS_BETA_EMAILS = "Alice@Example.COM,bob@example.com";
    _resetBriefRendersCanaryCache();
    expect(isUserInBriefRendersBeta("alice@example.com")).toBe(true);
    expect(isUserInBriefRendersBeta("ALICE@EXAMPLE.COM")).toBe(true);
    expect(isUserInBriefRendersBeta("bob@example.com")).toBe(true);
  });

  it("returns false for emails not in the list", () => {
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    _resetBriefRendersCanaryCache();
    expect(isUserInBriefRendersBeta("eve@example.com")).toBe(false);
  });

  it("returns false for null/undefined emails", () => {
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    _resetBriefRendersCanaryCache();
    expect(isUserInBriefRendersBeta(null)).toBe(false);
    expect(isUserInBriefRendersBeta(undefined)).toBe(false);
  });

  it("trims whitespace and ignores empty entries", () => {
    process.env.BRIEF_RENDERS_BETA_EMAILS = " alice@example.com ,, bob@example.com ";
    _resetBriefRendersCanaryCache();
    expect(isUserInBriefRendersBeta("alice@example.com")).toBe(true);
    expect(isUserInBriefRendersBeta("bob@example.com")).toBe(true);
  });
});

describe("Brief-to-Renders canary — admin override", () => {
  it("returns false for empty override list", () => {
    expect(isBriefRendersAdminOverride("admin@example.com")).toBe(false);
  });

  it("matches case-insensitively", () => {
    process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS = "Admin@Example.COM";
    _resetBriefRendersCanaryCache();
    expect(isBriefRendersAdminOverride("admin@example.com")).toBe(true);
  });
});

describe("Brief-to-Renders canary — composite shouldUserSeeBriefRenders", () => {
  it("returns false for everyone when the kill switch is flipped to 'false'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "false";
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS = "admin@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(false);
    expect(shouldUserSeeBriefRenders("admin@example.com", "u-2")).toBe(false);
    expect(shouldUserSeeBriefRenders("eve@example.com", "u-3")).toBe(false);
    expect(shouldUserSeeBriefRenders(null, "u-anon")).toBe(false);
  });

  it("returns true for any user when the kill switch is unset (GA default)", () => {
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(true);
    expect(shouldUserSeeBriefRenders("eve@example.com", "u-2")).toBe(true);
    expect(shouldUserSeeBriefRenders(null, "u-anon")).toBe(true);
    expect(shouldUserSeeBriefRenders(undefined, "")).toBe(true);
  });

  it("returns true regardless of allowlist membership when enabled", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS = "admin@example.com";
    _resetBriefRendersCanaryCache();
    // Allowlists are no longer consulted post-GA — every user sees it.
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(true);
    expect(shouldUserSeeBriefRenders("admin@example.com", "u-2")).toBe(true);
    expect(shouldUserSeeBriefRenders("eve@example.com", "u-3")).toBe(true);
  });
});
