/**
 * Tests for Phase C — TR-015 auto-fire, strike counter, confidence mapping.
 *
 * Full TR-008 handler integration is impractical (requires Prisma + web-ifc).
 * Tests the strike counter directly and validates confidence mapping logic.
 */
import { describe, it, expect } from "vitest";
import {
  recordStrike,
  clearStrikes,
  getStrikeCount,
  isBlocked,
} from "@/features/boq/services/market-intelligence-strike";

describe("Phase C — Strike counter", () => {
  const userId = "test-user-" + Math.random().toString(36).slice(2);
  const city = "test-city";

  it("starts at 0 strikes", async () => {
    const count = await getStrikeCount(userId, city);
    expect(count).toBe(0);
    expect(isBlocked(count)).toBe(false);
  });

  it("increments on recordStrike", async () => {
    const r1 = await recordStrike(userId, city);
    expect(r1.count).toBe(1);
    expect(r1.blocked).toBe(false);

    const r2 = await recordStrike(userId, city);
    expect(r2.count).toBe(2);
    expect(r2.blocked).toBe(false);
  });

  it("blocks at 3 strikes", async () => {
    const r3 = await recordStrike(userId, city);
    expect(r3.count).toBe(3);
    expect(r3.blocked).toBe(true);
    expect(isBlocked(r3.count)).toBe(true);
  });

  it("getStrikeCount reflects current state", async () => {
    const count = await getStrikeCount(userId, city);
    expect(count).toBe(3);
  });

  it("clearStrikes resets to 0", async () => {
    await clearStrikes(userId, city);
    const count = await getStrikeCount(userId, city);
    expect(count).toBe(0);
    expect(isBlocked(count)).toBe(false);
  });
});

describe("Phase C — isBlocked utility", () => {
  it("false for 0, 1, 2 strikes", () => {
    expect(isBlocked(0)).toBe(false);
    expect(isBlocked(1)).toBe(false);
    expect(isBlocked(2)).toBe(false);
  });

  it("true for 3+ strikes", () => {
    expect(isBlocked(3)).toBe(true);
    expect(isBlocked(4)).toBe(true);
    expect(isBlocked(10)).toBe(true);
  });
});

describe("Phase C — Confidence mapping logic", () => {
  function mapConfidence(status: string, searches: number): string {
    if (status === "success" && searches > 0) return "live";
    if (status === "success") return "cached";
    if (status === "partial") return "cached";
    return "static";
  }

  it("success + searches > 0 → live", () => {
    expect(mapConfidence("success", 2)).toBe("live");
  });

  it("success + searches = 0 → cached (Redis hit)", () => {
    expect(mapConfidence("success", 0)).toBe("cached");
  });

  it("partial → cached", () => {
    expect(mapConfidence("partial", 0)).toBe("cached");
  });

  it("fallback → static", () => {
    expect(mapConfidence("fallback", 0)).toBe("static");
  });
});
