/**
 * Phase gamma.1 — Agent Turn Budget tests.
 *
 * Verifies the turn budget constants and their usage in driver/routes.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  AGENT_MAX_TURNS_DIRECT_MODE,
  AGENT_MAX_TURNS_LEGACY,
  AGENT_DEFAULT_COST_CAP_USD,
  RENDER_PREVIEW_BUDGET,
} from "../constants";

describe("Agent Turn Budget (Phase gamma.1)", () => {
  it("AGENT_MAX_TURNS_DIRECT_MODE is 200", () => {
    expect(AGENT_MAX_TURNS_DIRECT_MODE).toBe(200);
  });

  it("AGENT_MAX_TURNS_LEGACY is 50 (preserved for reference)", () => {
    expect(AGENT_MAX_TURNS_LEGACY).toBe(50);
  });

  it("AGENT_DEFAULT_COST_CAP_USD is 5.0", () => {
    expect(AGENT_DEFAULT_COST_CAP_USD).toBe(5.0);
  });

  it("RENDER_PREVIEW_BUDGET is 10", () => {
    expect(RENDER_PREVIEW_BUDGET).toBe(10);
  });

  it("driver.ts uses AGENT_MAX_TURNS_DIRECT_MODE (200) as DEFAULT_MAX_TURNS", async () => {
    // Read driver source to verify the constant is used
    const driverSrc = fs.readFileSync(
      path.join(__dirname, "..", "generator", "driver.ts"),
      "utf-8",
    );
    expect(driverSrc).toContain("AGENT_MAX_TURNS_DIRECT_MODE");
    expect(driverSrc).toContain("const DEFAULT_MAX_TURNS = AGENT_MAX_TURNS_DIRECT_MODE");
  });

  it("runAgentBuild defaults to 200 turns when no maxTurns passed", () => {
    // This is verified by the constant being the default,
    // plus the body only includes max_turns when explicitly set
    const driverSrc = fs.readFileSync(
      path.join(__dirname, "..", "generator", "driver.ts"),
      "utf-8",
    );
    // The maxTurns fallback in runGenerator uses DEFAULT_MAX_TURNS
    expect(driverSrc).toMatch(/args\.maxTurns\s*\?\?\s*DEFAULT_MAX_TURNS/);
  });

  it("maxDuration on execute-node route is >= 900", () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app", "api", "execute-node", "route.ts"),
      "utf-8",
    );
    const match = routeSrc.match(/export const maxDuration\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(900);
  });

  it("maxDuration on runs route is >= 900", () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app", "api", "brief-to-ifc", "v3", "runs", "route.ts"),
      "utf-8",
    );
    const match = routeSrc.match(/export const maxDuration\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(900);
  });
});
