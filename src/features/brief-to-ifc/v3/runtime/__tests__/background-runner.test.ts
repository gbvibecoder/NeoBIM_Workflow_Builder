/**
 * Tests for `runBackground` — the lifecycle wrapper (Phase v3 §D3).
 *
 * Strategy: stub the entire Prisma surface used by transitions +
 * heartbeat + appendLog so the runner exercises end-to-end without a
 * live DB. The four required cases per the spec:
 *
 *   1. Happy path → status flows PENDING -> RUNNING -> COMPLETED + result persisted
 *   2. Throwing function → status becomes FAILED + errorCode set
 *   3. Timeout → status becomes FAILED with EXECUTION_TIMEOUT
 *   4. Heartbeat fires at least once during a slow function
 */

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { runBackground } from "../background-runner";

interface PrismaCallLog {
  updateMany: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  createLog: Array<{
    data: { level: string; source: string; message: string };
  }>;
}

/** Build a stub Prisma client + a call log. The stub:
 *   - returns count=1 for every `updateMany` (so transitions land)
 *   - captures every `executionLog.create` invocation
 *   - captures every `briefToIfcV3Run.updateMany` arg pair */
function stubPrismaWithLog() {
  const log: PrismaCallLog = { updateMany: [], createLog: [] };
  const prisma = {
    briefToIfcV3Run: {
      updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
        log.updateMany.push({
          where: args.where as Record<string, unknown>,
          data: args.data as Record<string, unknown>,
        });
        return { count: 1 };
      }),
    },
    executionLog: {
      create: vi.fn(async (args: { data: unknown }) => {
        log.createLog.push({
          data: args.data as { level: string; source: string; message: string },
        });
        return { id: `log-${log.createLog.length}` };
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, log };
}

const TINY_TIMEOUT_MS = 200;
const TINY_HEARTBEAT_MS = 25;

describe("runBackground — case 1 — happy path", () => {
  it("transitions PENDING -> RUNNING -> COMPLETED and persists the success payload", async () => {
    const { prisma, log } = stubPrismaWithLog();

    const result = await runBackground({
      prisma,
      runId: "r-happy",
      fn: async () => ({ url: "https://x.ifc", count: 99 }),
      toCompletedPayload: (r) => ({ ifcUrl: r.url, entityCount: r.count }),
    });

    expect(result.terminalStatus).toBe("COMPLETED");
    expect(result.errorCode).toBeNull();

    // Two transitions landed: PENDING->RUNNING + RUNNING->COMPLETED.
    const transitions = log.updateMany.filter(
      (c) => c.where.id === "r-happy" && typeof c.data.status === "string",
    );
    expect(transitions[0].where.status).toBe("PENDING");
    expect(transitions[0].data.status).toBe("RUNNING");
    const completedTransition = transitions.find(
      (c) => c.data.status === "COMPLETED",
    );
    expect(completedTransition).toBeDefined();
    expect(completedTransition!.where.status).toBe("RUNNING");
    expect(completedTransition!.data.ifcUrl).toBe("https://x.ifc");
    expect(completedTransition!.data.entityCount).toBe(99);
  });
});

describe("runBackground — case 2 — throwing function", () => {
  it("catches the throw, transitions to FAILED, persists errorCode + message", async () => {
    const { prisma, log } = stubPrismaWithLog();

    const result = await runBackground({
      prisma,
      runId: "r-throw",
      fn: async () => {
        throw new Error("synthetic agent error");
      },
      toCompletedPayload: () => ({ ifcUrl: "", entityCount: 0 }),
    });

    expect(result.terminalStatus).toBe("FAILED");
    expect(result.errorCode).toBe("UNKNOWN");

    const failedTransition = log.updateMany.find(
      (c) => c.data.status === "FAILED",
    );
    expect(failedTransition).toBeDefined();
    expect(failedTransition!.where.status).toBe("RUNNING");
    expect(failedTransition!.data.errorCode).toBe("UNKNOWN");
    expect(failedTransition!.data.errorMessage).toBe("synthetic agent error");

    // The final log line carries the error context.
    const errorLog = log.createLog.find(
      (c) => c.data.level === "ERROR" && c.data.message.includes("UNKNOWN"),
    );
    expect(errorLog).toBeDefined();
  });

  it("coerces a thrown object with a known .code to that errorCode", async () => {
    const { prisma, log } = stubPrismaWithLog();

    await runBackground({
      prisma,
      runId: "r-coerce",
      fn: async () => {
        throw { code: "ANTHROPIC_API_ERROR", message: "429" };
      },
      toCompletedPayload: () => ({ ifcUrl: "", entityCount: 0 }),
    });

    const failed = log.updateMany.find((c) => c.data.status === "FAILED");
    expect(failed!.data.errorCode).toBe("ANTHROPIC_API_ERROR");
  });
});

describe("runBackground — case 3 — timeout", () => {
  it("transitions to FAILED with EXECUTION_TIMEOUT when fn outlives timeoutMs", async () => {
    const { prisma, log } = stubPrismaWithLog();

    const result = await runBackground({
      prisma,
      runId: "r-timeout",
      timeoutMs: TINY_TIMEOUT_MS,
      heartbeatIntervalMs: TINY_HEARTBEAT_MS,
      // fn never resolves within the test budget.
      fn: () => new Promise(() => { /* never resolves */ }),
      toCompletedPayload: () => ({ ifcUrl: "", entityCount: 0 }),
    });

    expect(result.terminalStatus).toBe("FAILED");
    expect(result.errorCode).toBe("EXECUTION_TIMEOUT");

    const failed = log.updateMany.find((c) => c.data.status === "FAILED");
    expect(failed!.data.errorCode).toBe("EXECUTION_TIMEOUT");
  });
});

describe("runBackground — case 4 — heartbeat fires during slow fn", () => {
  it("the heartbeat ticker writes at least once before the function returns", async () => {
    const { prisma, log } = stubPrismaWithLog();

    const SLOW_MS = 120;
    await runBackground({
      prisma,
      runId: "r-slow",
      timeoutMs: 60_000,
      heartbeatIntervalMs: 25, // tight cadence — ~4 ticks in 120ms
      fn: () => new Promise((resolve) => setTimeout(() => resolve(null), SLOW_MS)),
      toCompletedPayload: () => ({ ifcUrl: "x", entityCount: 1 }),
    });

    // A heartbeat tick is a `updateMany` whose `data` has ONLY
    // `lastHeartbeatAt` (not a status change).
    const heartbeatTicks = log.updateMany.filter(
      (c) =>
        c.where.status === "RUNNING" &&
        c.data.lastHeartbeatAt instanceof Date &&
        c.data.status === undefined,
    );
    expect(heartbeatTicks.length).toBeGreaterThan(0);
  });
});
