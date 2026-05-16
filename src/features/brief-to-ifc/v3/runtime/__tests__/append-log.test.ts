/**
 * Tests for `appendLog` (Phase v3 §D4).
 *
 * The function never throws — these tests prove the contract holds in
 * all four scenarios:
 *   1. happy DB + Pusher → `persisted` + `streamed` both true
 *   2. DB fails, Pusher fine → `persisted=false`, `streamed=true`
 *   3. message > 4096 chars → truncated with "..." suffix
 *   4. metadata=undefined doesn't crash the Prisma `create` call
 */

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { appendLog, logChannel, LOG_EVENT_NAME } from "../append-log";

// Mock the pusher-server module before importing the SUT — the
// production module reads env at construction time and warns.
vi.mock("@/lib/pusher-server", () => ({
  pusherTrigger: vi.fn(async () => {
    /* swallowed in production too */
  }),
}));

function stubPrisma(opts: { failCreate?: boolean } = {}) {
  const captured: Array<{ data: Record<string, unknown> }> = [];
  const create = vi.fn(async (args: { data: unknown }) => {
    captured.push({ data: args.data as Record<string, unknown> });
    if (opts.failCreate) throw new Error("simulated db failure");
    return { id: `log-${captured.length}` };
  });
  const prisma = {
    executionLog: { create },
  } as unknown as PrismaClient;
  return { prisma, captured, create };
}

describe("appendLog — happy path", () => {
  it("persists to DB and reports persisted+streamed both true", async () => {
    const { prisma, captured } = stubPrisma();
    const result = await appendLog(prisma, {
      executionId: "run-1",
      level: "INFO",
      source: "GENERATE",
      message: "agent turn 1 finished",
      metadata: { turn: 1, cost_usd: 0.12 },
    });
    expect(result.persisted).toBe(true);
    expect(result.streamed).toBe(true);
    expect(result.logId).toBe("log-1");
    expect(captured).toHaveLength(1);
    expect(captured[0].data.level).toBe("INFO");
    expect(captured[0].data.source).toBe("GENERATE");
    expect(captured[0].data.executionId).toBe("run-1");
    expect(captured[0].data.message).toBe("agent turn 1 finished");
  });
});

describe("appendLog — DB failure is swallowed (Rule 14: never block the work loop)", () => {
  it("returns persisted=false but does NOT throw", async () => {
    const { prisma } = stubPrisma({ failCreate: true });
    const result = await appendLog(prisma, {
      executionId: "run-2",
      level: "ERROR",
      source: "SANDBOX",
      message: "sandbox crashed",
    });
    expect(result.persisted).toBe(false);
    expect(result.logId).toBeNull();
    // Pusher path is still attempted — defence in depth.
    expect(result.streamed).toBe(true);
  });
});

describe("appendLog — long messages are truncated, not rejected", () => {
  it("truncates a 10_000-char message to 4096 with ... suffix", async () => {
    const { prisma, captured } = stubPrisma();
    const huge = "x".repeat(10_000);
    await appendLog(prisma, {
      executionId: "run-3", level: "DEBUG", source: "TOOL_CALL", message: huge,
    });
    const persisted = captured[0].data.message as string;
    expect(persisted.length).toBe(4096);
    expect(persisted.endsWith("...")).toBe(true);
  });
});

describe("appendLog — metadata is optional", () => {
  it("omits the metadata column when caller doesn't supply it", async () => {
    const { prisma, captured } = stubPrisma();
    await appendLog(prisma, {
      executionId: "run-4", level: "INFO", source: "LIFECYCLE", message: "x",
    });
    // Prisma `undefined` means "don't set this column" — distinct
    // from `null` (set to SQL NULL). For Json? fields both behaviours
    // produce a NULL row value; the test asserts we didn't pass a
    // garbage shape.
    expect(captured[0].data.metadata).toBeUndefined();
  });
  it("forwards an explicit metadata object", async () => {
    const { prisma, captured } = stubPrisma();
    await appendLog(prisma, {
      executionId: "run-5", level: "INFO", source: "GENERATE", message: "x",
      metadata: { entityCount: 100 },
    });
    expect(captured[0].data.metadata).toEqual({ entityCount: 100 });
  });
});

describe("appendLog — channel + event naming convention", () => {
  it("Pusher channel uses the private-bf-v3- prefix", () => {
    expect(logChannel("abc123")).toBe("private-bf-v3-abc123");
  });
  it("event name is stable", () => {
    expect(LOG_EVENT_NAME).toBe("execution-log:appended");
  });
});
