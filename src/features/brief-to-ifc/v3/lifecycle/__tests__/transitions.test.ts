/**
 * Tests for the BriefToIfcV3Run status state-machine (Phase v3 §D2).
 *
 * Strategy: stub `prisma.briefToIfcV3Run.updateMany` so we don't need
 * a live DB. The transition's correctness is in:
 *   1. The static `isValidTransition` table
 *   2. The payload-invariant checks
 *   3. The atomic-claim guard (count===0 → throw)
 *
 * All three are exercised here without ever opening a DB connection.
 */

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  InvalidStatusTransitionError,
  InvariantViolationError,
  TransitionRaceLostError,
  isTerminal,
  isValidTransition,
  transitionStatus,
} from "../transitions";

/** Build a stub Prisma client whose `briefToIfcV3Run.updateMany`
 *  returns a known count. Captures the call args for assertion. */
function stubPrisma(updateManyCount: number) {
  const calls: Array<{ where: unknown; data: unknown }> = [];
  const prisma = {
    briefToIfcV3Run: {
      updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
        calls.push(args);
        return { count: updateManyCount };
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

describe("isValidTransition + isTerminal", () => {
  it("PENDING -> RUNNING is valid", () => {
    expect(isValidTransition("PENDING", "RUNNING")).toBe(true);
  });
  it("RUNNING -> COMPLETED is valid", () => {
    expect(isValidTransition("RUNNING", "COMPLETED")).toBe(true);
  });
  it("RUNNING -> FAILED is valid", () => {
    expect(isValidTransition("RUNNING", "FAILED")).toBe(true);
  });
  it("PENDING -> COMPLETED is invalid (must pass through RUNNING)", () => {
    expect(isValidTransition("PENDING", "COMPLETED")).toBe(false);
  });
  it("COMPLETED -> RUNNING is invalid (terminal)", () => {
    expect(isValidTransition("COMPLETED", "RUNNING")).toBe(false);
  });
  it("FAILED is terminal — no transitions out", () => {
    expect(isValidTransition("FAILED", "RUNNING")).toBe(false);
    expect(isValidTransition("FAILED", "COMPLETED")).toBe(false);
    expect(isValidTransition("FAILED", "CANCELLED")).toBe(false);
  });
  it("isTerminal classifies the three terminal states", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("PENDING")).toBe(false);
    expect(isTerminal("RUNNING")).toBe(false);
  });
});

describe("transitionStatus — invalid transitions are refused statically", () => {
  it("throws InvalidStatusTransitionError on PENDING -> COMPLETED", async () => {
    const { prisma } = stubPrisma(1);
    await expect(
      transitionStatus(prisma, "r1", "PENDING", {
        to: "COMPLETED",
        payload: { ifcUrl: "x", entityCount: 1 },
      }),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });
  it("throws InvalidStatusTransitionError on COMPLETED -> RUNNING", async () => {
    const { prisma } = stubPrisma(1);
    await expect(
      transitionStatus(prisma, "r1", "COMPLETED", { to: "RUNNING" }),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });
});

describe("transitionStatus — payload invariants are enforced", () => {
  it("RUNNING -> COMPLETED without ifcUrl throws InvariantViolationError", async () => {
    const { prisma } = stubPrisma(1);
    await expect(
      transitionStatus(prisma, "r1", "RUNNING", {
        to: "COMPLETED",
        // @ts-expect-error — intentionally missing ifcUrl to trip the invariant
        payload: { entityCount: 100 },
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
  it("RUNNING -> COMPLETED with negative entityCount throws", async () => {
    const { prisma } = stubPrisma(1);
    await expect(
      transitionStatus(prisma, "r1", "RUNNING", {
        to: "COMPLETED",
        payload: { ifcUrl: "https://x", entityCount: -1 },
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
  it("RUNNING -> FAILED with unknown errorCode throws", async () => {
    const { prisma } = stubPrisma(1);
    await expect(
      transitionStatus(prisma, "r1", "RUNNING", {
        to: "FAILED",
        payload: {
          // not a member of BRIEF_TO_IFC_V3_ERROR_CODES — caught at boundary.
          errorCode: "MADE_UP_CODE" as never,
          errorMessage: "x",
        },
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});

describe("transitionStatus — happy path writes", () => {
  it("PENDING -> RUNNING writes the right fields", async () => {
    const { prisma, calls } = stubPrisma(1);
    const status = await transitionStatus(prisma, "r1", "PENDING", { to: "RUNNING" });
    expect(status).toBe("RUNNING");
    expect(calls).toHaveLength(1);
    const data = calls[0].data as Record<string, unknown>;
    expect(data.status).toBe("RUNNING");
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.lastHeartbeatAt).toBeInstanceOf(Date);
  });
  it("RUNNING -> COMPLETED writes success fields AND clears error fields", async () => {
    const { prisma, calls } = stubPrisma(1);
    const status = await transitionStatus(prisma, "r1", "RUNNING", {
      to: "COMPLETED",
      payload: { ifcUrl: "https://x.ifc", entityCount: 1234, turns: 7 },
    });
    expect(status).toBe("COMPLETED");
    const data = calls[0].data as Record<string, unknown>;
    expect(data.status).toBe("COMPLETED");
    expect(data.ifcUrl).toBe("https://x.ifc");
    expect(data.entityCount).toBe(1234);
    expect(data.turns).toBe(7);
    expect(data.errorCode).toBeNull();
    expect(data.errorMessage).toBeNull();
    expect(data.completedAt).toBeInstanceOf(Date);
  });
  it("RUNNING -> FAILED writes errorCode + errorMessage AND clears success fields", async () => {
    const { prisma, calls } = stubPrisma(1);
    const status = await transitionStatus(prisma, "r1", "RUNNING", {
      to: "FAILED",
      payload: { errorCode: "ANTHROPIC_API_ERROR", errorMessage: "rate limited" },
    });
    expect(status).toBe("FAILED");
    const data = calls[0].data as Record<string, unknown>;
    expect(data.status).toBe("FAILED");
    expect(data.errorCode).toBe("ANTHROPIC_API_ERROR");
    expect(data.errorMessage).toBe("rate limited");
    expect(data.ifcUrl).toBeNull();
    expect(data.entityCount).toBeNull();
  });
  it("RUNNING -> CANCELLED pins errorCode to CANCELLED_BY_USER", async () => {
    const { prisma, calls } = stubPrisma(1);
    await transitionStatus(prisma, "r1", "RUNNING", { to: "CANCELLED" });
    const data = calls[0].data as Record<string, unknown>;
    expect(data.errorCode).toBe("CANCELLED_BY_USER");
  });
});

describe("transitionStatus — atomic-claim race", () => {
  it("throws TransitionRaceLostError when updateMany matches 0 rows", async () => {
    const { prisma } = stubPrisma(0);
    await expect(
      transitionStatus(prisma, "r1", "RUNNING", {
        to: "FAILED",
        payload: { errorCode: "UNKNOWN", errorMessage: "" },
      }),
    ).rejects.toBeInstanceOf(TransitionRaceLostError);
  });
  it("the where clause filters on id + status (so a stale read can't stomp a fresh terminal)", async () => {
    const { prisma, calls } = stubPrisma(1);
    await transitionStatus(prisma, "r1", "RUNNING", {
      to: "COMPLETED",
      payload: { ifcUrl: "x", entityCount: 1 },
    });
    const where = calls[0].where as Record<string, unknown>;
    expect(where.id).toBe("r1");
    expect(where.status).toBe("RUNNING");
  });
});
