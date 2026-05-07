/**
 * Unit tests for the billing-grace-window-sweep cron.
 *
 * Asserts:
 *   - Flag OFF: no DB queries, returns skipped, emits flag-off metric.
 *   - Flag ON, no expired users: returns 0 downgraded.
 *   - Flag ON, expired users: applyImmediateDowngrade called per user.
 *   - Flag ON, applyImmediateDowngrade throws: counted as failed, sweep
 *     keeps going for the rest.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

const flagState = vi.hoisted(() => ({ value: false }));

const metricsMocks = vi.hoisted(() => ({
  billingGraceWindowFlagOff: vi.fn(),
}));

const downgradeMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: prismaMocks.findMany,
    },
  },
}));

vi.mock("@/features/billing/lib/feature-flags", () => ({
  billingFeatureFlags: {
    get graceWindowEnabled() {
      return flagState.value;
    },
  },
}));

vi.mock("@/features/billing/lib/metrics", () => ({
  billingGraceWindowFlagOff: metricsMocks.billingGraceWindowFlagOff,
}));

vi.mock("@/features/billing/lib/role-transitions", () => ({
  applyImmediateDowngrade: downgradeMock.fn,
}));

import { runGraceWindowSweep } from "@/app/api/cron/billing-grace-window-sweep/run";

describe("runGraceWindowSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagState.value = false;
  });

  it("flag OFF: no DB calls, emits flag-off metric, returns skipped report", async () => {
    flagState.value = false;

    const report = await runGraceWindowSweep();

    expect(prismaMocks.findMany).not.toHaveBeenCalled();
    expect(downgradeMock.fn).not.toHaveBeenCalled();
    expect(metricsMocks.billingGraceWindowFlagOff).toHaveBeenCalledWith({
      handler: "cron.billing_grace_window_sweep",
      userId: null,
      event: "tick",
    });
    expect(report).toMatchObject({
      skipped: true,
      reason: "flag_off",
      candidates: 0,
      downgraded: 0,
      failed: 0,
    });
  });

  it("flag ON + no expired users: returns 0 downgraded", async () => {
    flagState.value = true;
    prismaMocks.findMany.mockResolvedValue([]);

    const report = await runGraceWindowSweep();

    expect(prismaMocks.findMany).toHaveBeenCalledTimes(1);
    expect(downgradeMock.fn).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      skipped: false,
      candidates: 0,
      downgraded: 0,
      failed: 0,
    });
  });

  it("flag ON + 2 expired users: applyImmediateDowngrade called per user", async () => {
    flagState.value = true;
    prismaMocks.findMany.mockResolvedValue([
      { id: "u1", email: "a@b.c", role: "STARTER", stripeCurrentPeriodEnd: new Date(Date.now() - 1000) },
      { id: "u2", email: "x@y.z", role: "PRO", stripeCurrentPeriodEnd: new Date(Date.now() - 5000) },
    ]);
    downgradeMock.fn.mockResolvedValue(undefined);

    const report = await runGraceWindowSweep();

    expect(downgradeMock.fn).toHaveBeenCalledTimes(2);
    expect(downgradeMock.fn).toHaveBeenCalledWith({
      userId: "u1",
      reason: "grace_period_ended",
      triggeredBy: "cron",
    });
    expect(downgradeMock.fn).toHaveBeenCalledWith({
      userId: "u2",
      reason: "grace_period_ended",
      triggeredBy: "cron",
    });
    expect(report).toMatchObject({
      skipped: false,
      candidates: 2,
      downgraded: 2,
      failed: 0,
    });
  });

  it("flag ON + downgrade throws for one user: counts as failed, continues sweep", async () => {
    flagState.value = true;
    prismaMocks.findMany.mockResolvedValue([
      { id: "u1", email: "a@b.c", role: "STARTER", stripeCurrentPeriodEnd: new Date(Date.now() - 1000) },
      { id: "u2", email: "x@y.z", role: "PRO", stripeCurrentPeriodEnd: new Date(Date.now() - 5000) },
      { id: "u3", email: "p@q.r", role: "MINI", stripeCurrentPeriodEnd: new Date(Date.now() - 9000) },
    ]);
    downgradeMock.fn
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce(undefined);

    const report = await runGraceWindowSweep();

    expect(downgradeMock.fn).toHaveBeenCalledTimes(3);
    expect(report.candidates).toBe(3);
    expect(report.downgraded).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ userId: "u2", error: "DB connection lost" });
  });

  it("flag ON + query filter excludes admin and FREE roles", async () => {
    flagState.value = true;
    prismaMocks.findMany.mockResolvedValue([]);

    await runGraceWindowSweep();

    const callArg = prismaMocks.findMany.mock.calls[0][0];
    expect(callArg.where.role).toEqual({ notIn: ["FREE", "TEAM_ADMIN", "PLATFORM_ADMIN"] });
    expect(callArg.where.OR).toEqual([
      { razorpaySubscriptionId: { not: null } },
      { stripeSubscriptionId: { not: null } },
    ]);
  });
});
