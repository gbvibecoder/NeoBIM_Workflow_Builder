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

describe("Brief-to-Renders canary — master gate", () => {
  it("returns false when PIPELINE_BRIEF_RENDERS is unset", () => {
    expect(isBriefRendersMasterEnabled()).toBe(false);
  });

  it("returns false when PIPELINE_BRIEF_RENDERS is 'false'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "false";
    expect(isBriefRendersMasterEnabled()).toBe(false);
  });

  it("returns true only when PIPELINE_BRIEF_RENDERS is exactly 'true'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    expect(isBriefRendersMasterEnabled()).toBe(true);
  });

  it("rejects truthy-looking values that aren't the literal string 'true'", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "1";
    expect(isBriefRendersMasterEnabled()).toBe(false);
    process.env.PIPELINE_BRIEF_RENDERS = "TRUE";
    expect(isBriefRendersMasterEnabled()).toBe(false);
    process.env.PIPELINE_BRIEF_RENDERS = "yes";
    expect(isBriefRendersMasterEnabled()).toBe(false);
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
  it("returns false for everyone when master switch is off", () => {
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS = "admin@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(false);
    expect(shouldUserSeeBriefRenders("admin@example.com", "u-2")).toBe(false);
  });

  it("returns false when master switch is on but user is not on either list", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders("eve@example.com", "u-3")).toBe(false);
  });

  it("returns true when master is on and user is in the beta allowlist", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(true);
  });

  it("returns true when master is on and user is in the admin override list", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS = "admin@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders("admin@example.com", "u-2")).toBe(true);
  });

  it("returns false for null email even when master is on", () => {
    process.env.PIPELINE_BRIEF_RENDERS = "true";
    process.env.BRIEF_RENDERS_BETA_EMAILS = "alice@example.com";
    _resetBriefRendersCanaryCache();
    expect(shouldUserSeeBriefRenders(null, "u-anon")).toBe(false);
    expect(shouldUserSeeBriefRenders(undefined, "u-anon")).toBe(false);
  });

  it("Phase 1 default (no env vars set) — every user gets false", () => {
    // Phase 1 ships with the master switch off and empty allowlists.
    // The expected behavior in this state is "feature is invisible
    // to absolutely everyone, including admins."
    expect(shouldUserSeeBriefRenders("alice@example.com", "u-1")).toBe(false);
    expect(shouldUserSeeBriefRenders("admin@example.com", "u-2")).toBe(false);
    expect(shouldUserSeeBriefRenders(null, "")).toBe(false);
  });
});
