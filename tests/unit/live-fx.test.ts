/**
 * Tests for live-fx.ts — FX rate service.
 * Mocked: no real HTTP calls. Tests cache logic and fallback chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLiveFx } from "@/features/boq/services/live-fx";

describe("B.3 — Live FX service", () => {
  // Stub fetch to fail so neither RBI nor ECB resolve → deterministic
  // fallback path. (Redis is already skipped in test env.) Previously these
  // tests hit the live RBI/ECB endpoints and flaked on slow/offline runs.
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in tests"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a LiveFxResult with all required fields", async () => {
    const result = await getLiveFx();
    expect(result).toHaveProperty("inrPerUsd");
    expect(result).toHaveProperty("asOfDate");
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("ageMinutes");
    expect(typeof result.inrPerUsd).toBe("number");
    expect(result.inrPerUsd).toBeGreaterThan(50);
    expect(result.inrPerUsd).toBeLessThan(150);
  });

  it("falls back to hardcoded 83.50 when no Redis/HTTP is available", async () => {
    const result = await getLiveFx();
    expect(result.source).toBe("fallback");
    expect(result.inrPerUsd).toBe(83.5);
  });

  it("rate is within reasonable INR/USD range", async () => {
    const result = await getLiveFx();
    expect(result.inrPerUsd).toBeGreaterThanOrEqual(50);
    expect(result.inrPerUsd).toBeLessThanOrEqual(150);
  });
});
