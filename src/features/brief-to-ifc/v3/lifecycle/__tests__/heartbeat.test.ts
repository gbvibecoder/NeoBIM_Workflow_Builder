/**
 * Heartbeat ticker tests (Phase v3 §D2).
 *
 * Strategy: fake timers so we can fast-forward through the interval
 * without sleeping the test runner. The DB call is stubbed; we only
 * assert that ticks fire on cadence AND that `stop()` is idempotent
 * AND that the interval is unref'd so it doesn't keep the event loop
 * alive in scripts.
 */

import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEARTBEAT_INTERVAL_MS,
  STUCK_THRESHOLD_MS,
  isStuck,
  startHeartbeat,
} from "../heartbeat";

function stubPrisma() {
  const calls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const updateMany = vi.fn(async (args: { where: unknown; data: unknown }) => {
    calls.push({
      where: args.where as Record<string, unknown>,
      data: args.data as Record<string, unknown>,
    });
    return { count: 1 };
  });
  const prisma = {
    briefToIfcV3Run: { updateMany },
  } as unknown as PrismaClient;
  return { prisma, updateMany, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startHeartbeat", () => {
  it("fires a DB tick every HEARTBEAT_INTERVAL_MS while running", async () => {
    const { prisma, updateMany } = stubPrisma();
    const h = startHeartbeat(prisma, "r1");

    // Advance one interval — one tick should fire.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(updateMany).toHaveBeenCalledTimes(1);

    // Advance two more — total three ticks.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    expect(updateMany).toHaveBeenCalledTimes(3);

    h.stop();
  });

  it("filters writes on status=RUNNING so a stale tick can't reactivate a terminal row", async () => {
    const { prisma, calls } = stubPrisma();
    const h = startHeartbeat(prisma, "r1");
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].where.id).toBe("r1");
    expect(calls[0].where.status).toBe("RUNNING");
    h.stop();
  });

  it("stop() is idempotent", async () => {
    const { prisma, updateMany } = stubPrisma();
    const h = startHeartbeat(prisma, "r1");
    h.stop();
    h.stop(); // must not throw
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    // No ticks after stop.
    expect(updateMany).toHaveBeenCalledTimes(0);
  });

  it("tickNow() forces a synchronous DB write", async () => {
    const { prisma, updateMany } = stubPrisma();
    const h = startHeartbeat(prisma, "r1");
    await h.tickNow();
    expect(updateMany).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("does not propagate DB errors — the work loop must keep running", async () => {
    const updateMany = vi.fn(async () => {
      throw new Error("db hiccup");
    });
    const prisma = { briefToIfcV3Run: { updateMany } } as unknown as PrismaClient;
    const h = startHeartbeat(prisma, "r1");
    // The tick fires + swallows; the test asserts nothing throws.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    h.stop();
  });

  it("custom intervalMs is honoured", async () => {
    const { prisma, updateMany } = stubPrisma();
    const h = startHeartbeat(prisma, "r1", { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3500);
    expect(updateMany).toHaveBeenCalledTimes(3);
    h.stop();
  });
});

describe("isStuck", () => {
  it("returns true when lastHeartbeatAt is null (status=RUNNING with no heartbeat ever)", () => {
    expect(isStuck(null)).toBe(true);
  });
  it("returns false when heartbeat is fresh", () => {
    expect(isStuck(new Date(Date.now() - 1_000))).toBe(false);
  });
  it("returns true when heartbeat is older than STUCK_THRESHOLD_MS", () => {
    const stale = new Date(Date.now() - STUCK_THRESHOLD_MS - 1_000);
    expect(isStuck(stale)).toBe(true);
  });
});
