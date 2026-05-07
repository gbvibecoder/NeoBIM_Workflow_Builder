/**
 * Integration tests for Razorpay webhook cancel-class events.
 *
 * Targets handleRazorpaySubscriptionTermination (exported from route.ts for
 * test access). Mocks the entire dependency graph so route.ts module load
 * doesn't try to initialise the Razorpay SDK or open a Redis connection.
 *
 * Asserted scenarios (per spec):
 *   - flag OFF + subscription.cancelled → legacy path called, flag-off metric
 *   - flag ON + currentEnd in the future → role NOT updated, period_end refreshed,
 *     preserved metric (covers cancelled / halted / completed / expired)
 *   - flag ON + currentEnd in the past → applyImmediateDowngrade called
 *   - flag ON + currentEnd missing → no-op, alert metric emitted
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────

const prismaMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

const flagState = vi.hoisted(() => ({ value: false }));

const metricsMocks = vi.hoisted(() => ({
  billingGraceWindowFlagOff: vi.fn(),
  billingRolePreservedInGrace: vi.fn(),
  billingCancelWithNoPeriodEnd: vi.fn(),
}));

const downgradeMock = vi.hoisted(() => ({ fn: vi.fn() }));

const emailMocks = vi.hoisted(() => ({
  // mockResolvedValue: legacy code does `sendXxx(...).catch(...)` so the
  // mock must return a Promise, not undefined.
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendSubscriptionCanceledEmail: vi.fn().mockResolvedValue(undefined),
  sendPaidSubscriptionNotification: vi.fn().mockResolvedValue(undefined),
}));

// ─── Module mocks ───────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: prismaMocks.findFirst,
      update: prismaMocks.update,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  invalidateUserRoleCache: vi.fn(),
}));

vi.mock("@/lib/user-errors", () => ({
  formatErrorResponse: vi.fn((x: unknown) => x),
  UserErrors: { UNAUTHORIZED: { code: "AUTH_001" }, INTERNAL_ERROR: { code: "INT_001" } },
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
  billingRolePreservedInGrace: metricsMocks.billingRolePreservedInGrace,
  billingCancelWithNoPeriodEnd: metricsMocks.billingCancelWithNoPeriodEnd,
}));

vi.mock("@/features/billing/lib/role-transitions", () => ({
  applyImmediateDowngrade: downgradeMock.fn,
}));

vi.mock("@/features/billing/lib/razorpay", () => ({
  razorpay: {
    subscriptions: { fetch: vi.fn() },
    invoices: { all: vi.fn() },
    payments: { fetch: vi.fn() },
  },
  verifyWebhookSignature: vi.fn(),
  getRoleByRazorpayPlanId: vi.fn(),
}));

vi.mock("@/shared/services/email", () => emailMocks);

vi.mock("@/lib/webhook-idempotency", () => ({
  checkWebhookIdempotency: vi.fn(),
  clearWebhookIdempotency: vi.fn(),
}));

vi.mock("@/lib/server-conversions", () => ({
  trackServerPurchase: vi.fn(),
}));

vi.mock("@/lib/plan-pricing", () => ({
  getPlanValueINR: vi.fn().mockReturnValue(0),
}));

vi.mock("@prisma/client", () => ({
  Prisma: { DbNull: "__DbNull__" },
}));

// ─── Imports under test ─────────────────────────────────────────────

import { handleRazorpaySubscriptionTermination } from "@/app/api/razorpay/webhook/route";

// ─── Helpers ────────────────────────────────────────────────────────

function makeEvent(subscriptionId: string, currentEnd: number | null) {
  return {
    payload: {
      subscription: {
        entity: {
          id: subscriptionId,
          ...(currentEnd !== null ? { current_end: currentEnd } : {}),
        },
      },
    },
  };
}

const FUTURE_UNIX = Math.floor(Date.now() / 1000) + 7 * 86400;
const PAST_UNIX = Math.floor(Date.now() / 1000) - 7 * 86400;

// ─── Tests ──────────────────────────────────────────────────────────

describe("handleRazorpaySubscriptionTermination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagState.value = false;
    // Default user lookup returns a paid user. Individual tests override.
    prismaMocks.findFirst.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Test User",
      role: "STARTER",
    });
    prismaMocks.update.mockResolvedValue({});
  });

  describe("flag OFF", () => {
    beforeEach(() => {
      flagState.value = false;
    });

    it("subscription.cancelled → legacy path runs (full nuke), flag-off metric emitted", async () => {
      await handleRazorpaySubscriptionTermination(
        makeEvent("sub_1", FUTURE_UNIX),
        "subscription.cancelled",
        "evt_1",
      );

      expect(metricsMocks.billingGraceWindowFlagOff).toHaveBeenCalledWith({
        handler: "razorpay.subscription.cancelled",
        userId: "u1",
        event: "subscription.cancelled",
      });
      // Legacy path nukes role + clears subscription fields
      expect(prismaMocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: "FREE",
            razorpaySubscriptionId: null,
            stripeCurrentPeriodEnd: null,
          }),
        }),
      );
      expect(downgradeMock.fn).not.toHaveBeenCalled();
      expect(metricsMocks.billingRolePreservedInGrace).not.toHaveBeenCalled();
    });
  });

  describe("flag ON", () => {
    beforeEach(() => {
      flagState.value = true;
    });

    it("subscription.cancelled + currentEnd in future → role preserved, period_end refreshed", async () => {
      await handleRazorpaySubscriptionTermination(
        makeEvent("sub_1", FUTURE_UNIX),
        "subscription.cancelled",
        "evt_1",
      );

      expect(downgradeMock.fn).not.toHaveBeenCalled();
      expect(prismaMocks.update).toHaveBeenCalledTimes(1);
      expect(prismaMocks.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { stripeCurrentPeriodEnd: new Date(FUTURE_UNIX * 1000) },
      });
      expect(metricsMocks.billingRolePreservedInGrace).toHaveBeenCalledWith({
        userId: "u1",
        provider: "razorpay",
        eventType: "subscription.cancelled",
        graceUntilIso: new Date(FUTURE_UNIX * 1000).toISOString(),
      });
    });

    it("subscription.cancelled + currentEnd in past → applyImmediateDowngrade called", async () => {
      await handleRazorpaySubscriptionTermination(
        makeEvent("sub_1", PAST_UNIX),
        "subscription.cancelled",
        "evt_1",
      );

      expect(downgradeMock.fn).toHaveBeenCalledWith({
        userId: "u1",
        reason: "cancel_event_grace_already_past",
        triggeredBy: "webhook",
        providerEventId: "evt_1",
      });
      expect(prismaMocks.update).not.toHaveBeenCalled();
      expect(metricsMocks.billingRolePreservedInGrace).not.toHaveBeenCalled();
    });

    it("subscription.cancelled + currentEnd missing → no-op, alert metric emitted", async () => {
      await handleRazorpaySubscriptionTermination(
        makeEvent("sub_1", null),
        "subscription.cancelled",
        "evt_1",
      );

      expect(metricsMocks.billingCancelWithNoPeriodEnd).toHaveBeenCalledWith({
        provider: "razorpay",
        eventType: "subscription.cancelled",
        userId: "u1",
        subscriptionId: "sub_1",
      });
      expect(downgradeMock.fn).not.toHaveBeenCalled();
      expect(prismaMocks.update).not.toHaveBeenCalled();
    });

    it.each(["subscription.halted", "subscription.completed", "subscription.expired"])(
      "%s + currentEnd in future → role preserved",
      async (eventType) => {
        await handleRazorpaySubscriptionTermination(
          makeEvent("sub_1", FUTURE_UNIX),
          eventType,
          "evt_1",
        );

        expect(downgradeMock.fn).not.toHaveBeenCalled();
        expect(prismaMocks.update).toHaveBeenCalledWith({
          where: { id: "u1" },
          data: { stripeCurrentPeriodEnd: new Date(FUTURE_UNIX * 1000) },
        });
        expect(metricsMocks.billingRolePreservedInGrace).toHaveBeenCalledWith(
          expect.objectContaining({ eventType }),
        );
      },
    );

    it("user not found → no DB writes, no metric", async () => {
      prismaMocks.findFirst.mockResolvedValue(null);

      await handleRazorpaySubscriptionTermination(
        makeEvent("sub_orphan", FUTURE_UNIX),
        "subscription.cancelled",
        "evt_1",
      );

      expect(prismaMocks.update).not.toHaveBeenCalled();
      expect(downgradeMock.fn).not.toHaveBeenCalled();
      expect(metricsMocks.billingRolePreservedInGrace).not.toHaveBeenCalled();
      expect(metricsMocks.billingCancelWithNoPeriodEnd).not.toHaveBeenCalled();
    });
  });
});
