/**
 * Unit tests for src/features/billing/lib/role-transitions.ts.
 *
 * applyImmediateDowngrade is the single function permitted to write
 * role='FREE' under the new flag-on flow. These tests pin its contract:
 *
 *   - No-op when the user is already FREE.
 *   - No-op for admin roles (TEAM_ADMIN, PLATFORM_ADMIN).
 *   - Downgrades paid roles, touching ONLY role, invalidating cache,
 *     emitting the structured metric.
 *   - Returns silently if the user can't be found.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  invalidateUserRoleCache: vi.fn(),
}));

const metricsMocks = vi.hoisted(() => ({
  billingRoleDowngraded: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: prismaMocks.findUnique,
      update: prismaMocks.update,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  invalidateUserRoleCache: cacheMocks.invalidateUserRoleCache,
}));

vi.mock("@/features/billing/lib/metrics", () => ({
  billingRoleDowngraded: metricsMocks.billingRoleDowngraded,
}));

// Mock the per-provider helpers to keep this unit test isolated from env vars.
vi.mock("@/features/billing/lib/razorpay", () => ({
  getRoleByRazorpayPlanId: vi.fn(),
}));
vi.mock("@/features/billing/lib/stripe", () => ({
  getPlanByPriceId: vi.fn(),
}));

import { applyImmediateDowngrade } from "@/features/billing/lib/role-transitions";

describe("applyImmediateDowngrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when user role is already FREE", async () => {
    prismaMocks.findUnique.mockResolvedValue({ id: "u1", role: "FREE", email: "a@b.c" });

    await applyImmediateDowngrade({ userId: "u1", reason: "r", triggeredBy: "cron" });

    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(cacheMocks.invalidateUserRoleCache).not.toHaveBeenCalled();
    expect(metricsMocks.billingRoleDowngraded).not.toHaveBeenCalled();
  });

  it("no-ops when user role is TEAM_ADMIN", async () => {
    prismaMocks.findUnique.mockResolvedValue({ id: "u1", role: "TEAM_ADMIN", email: "a@b.c" });

    await applyImmediateDowngrade({ userId: "u1", reason: "r", triggeredBy: "cron" });

    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(metricsMocks.billingRoleDowngraded).not.toHaveBeenCalled();
  });

  it("no-ops when user role is PLATFORM_ADMIN", async () => {
    prismaMocks.findUnique.mockResolvedValue({ id: "u1", role: "PLATFORM_ADMIN", email: "a@b.c" });

    await applyImmediateDowngrade({ userId: "u1", reason: "r", triggeredBy: "cron" });

    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(metricsMocks.billingRoleDowngraded).not.toHaveBeenCalled();
  });

  it("downgrades STARTER → FREE: updates ONLY role, invalidates cache, emits metric", async () => {
    prismaMocks.findUnique.mockResolvedValue({ id: "u1", role: "STARTER", email: "a@b.c" });
    prismaMocks.update.mockResolvedValue({});

    await applyImmediateDowngrade({
      userId: "u1",
      reason: "grace_period_ended",
      triggeredBy: "cron",
      providerEventId: "evt_xyz",
    });

    expect(prismaMocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "FREE" },
    });
    expect(cacheMocks.invalidateUserRoleCache).toHaveBeenCalledWith("u1");
    expect(metricsMocks.billingRoleDowngraded).toHaveBeenCalledWith({
      userId: "u1",
      fromRole: "STARTER",
      toRole: "FREE",
      reason: "grace_period_ended",
      triggeredBy: "cron",
      providerEventId: "evt_xyz",
    });
  });

  it("downgrades MINI → FREE without providerEventId when not given", async () => {
    prismaMocks.findUnique.mockResolvedValue({ id: "u2", role: "MINI", email: "x@y.z" });
    prismaMocks.update.mockResolvedValue({});

    await applyImmediateDowngrade({
      userId: "u2",
      reason: "grace_period_ended",
      triggeredBy: "cron",
    });

    expect(metricsMocks.billingRoleDowngraded).toHaveBeenCalledWith({
      userId: "u2",
      fromRole: "MINI",
      toRole: "FREE",
      reason: "grace_period_ended",
      triggeredBy: "cron",
      providerEventId: undefined,
    });
  });

  it("returns silently when user is not found", async () => {
    prismaMocks.findUnique.mockResolvedValue(null);

    await applyImmediateDowngrade({ userId: "missing", reason: "r", triggeredBy: "cron" });

    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(cacheMocks.invalidateUserRoleCache).not.toHaveBeenCalled();
    expect(metricsMocks.billingRoleDowngraded).not.toHaveBeenCalled();
  });
});
