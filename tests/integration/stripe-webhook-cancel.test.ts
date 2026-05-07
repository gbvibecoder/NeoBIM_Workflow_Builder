/**
 * Integration tests for Stripe webhook cancel-class events.
 *
 * Targets handleStripeSubscriptionDeleted and handleStripeSubscriptionStatusEvent
 * (exported from route.ts for test access). Mocks the entire dependency
 * graph so route.ts module load doesn't try to initialise the Stripe SDK
 * or open a Redis connection.
 *
 * Asserted scenarios (per spec):
 *   - customer.subscription.deleted + flag ON + period_end future → role preserved
 *   - customer.subscription.updated status='past_due' + flag ON → role preserved,
 *     past_due metric emitted
 *   - customer.subscription.updated status='canceled' + flag ON + future → role preserved
 *   - customer.subscription.updated status='unpaid' + flag ON + past → applyImmediateDowngrade
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

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
  billingPastDuePreserved: vi.fn(),
}));

const downgradeMock = vi.hoisted(() => ({ fn: vi.fn() }));

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

vi.mock("@/lib/admin-server", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
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
  billingPastDuePreserved: metricsMocks.billingPastDuePreserved,
}));

vi.mock("@/features/billing/lib/role-transitions", () => ({
  applyImmediateDowngrade: downgradeMock.fn,
}));

vi.mock("@/features/billing/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { retrieve: vi.fn() },
  },
  getPlanByPriceId: vi.fn(),
}));

vi.mock("@/shared/services/email", () => ({
  // mockResolvedValue: legacy code does `sendXxx(...).catch(...)` so the
  // mock must return a Promise, not undefined.
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendSubscriptionCanceledEmail: vi.fn().mockResolvedValue(undefined),
  sendPlanChangedEmail: vi.fn().mockResolvedValue(undefined),
  sendPaidSubscriptionNotification: vi.fn().mockResolvedValue(undefined),
}));

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

import {
  handleStripeSubscriptionDeleted,
  handleStripeSubscriptionStatusEvent,
} from "@/app/api/stripe/webhook/route";

// ─── Helpers ────────────────────────────────────────────────────────

const FUTURE_UNIX = Math.floor(Date.now() / 1000) + 7 * 86400;
const PAST_UNIX = Math.floor(Date.now() / 1000) - 7 * 86400;

function makeStripeSubscription(opts: {
  id: string;
  status: Stripe.Subscription.Status;
  currentPeriodEnd: number | null;
}): Stripe.Subscription {
  return {
    id: opts.id,
    status: opts.status,
    items: {
      data: opts.currentPeriodEnd
        ? [{ current_period_end: opts.currentPeriodEnd } as Stripe.SubscriptionItem]
        : [],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
  } as unknown as Stripe.Subscription;
}

// ─── Tests: customer.subscription.deleted ──────────────────────────

describe("handleStripeSubscriptionDeleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagState.value = false;
    prismaMocks.findFirst.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Test User",
      role: "STARTER",
    });
    prismaMocks.update.mockResolvedValue({});
  });

  it("flag ON + period_end in future → role preserved, period_end refreshed", async () => {
    flagState.value = true;
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "canceled",
      currentPeriodEnd: FUTURE_UNIX,
    });

    await handleStripeSubscriptionDeleted("cus_1", sub, "evt_1");

    expect(downgradeMock.fn).not.toHaveBeenCalled();
    expect(prismaMocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { stripeCurrentPeriodEnd: new Date(FUTURE_UNIX * 1000) },
    });
    expect(metricsMocks.billingRolePreservedInGrace).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "stripe",
        eventType: "customer.subscription.deleted",
      }),
    );
  });

  it("flag ON + period_end in past → applyImmediateDowngrade called", async () => {
    flagState.value = true;
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "canceled",
      currentPeriodEnd: PAST_UNIX,
    });

    await handleStripeSubscriptionDeleted("cus_1", sub, "evt_1");

    expect(downgradeMock.fn).toHaveBeenCalledWith({
      userId: "u1",
      reason: "cancel_event_grace_already_past",
      triggeredBy: "webhook",
      providerEventId: "evt_1",
    });
  });

  it("flag OFF → flag-off metric, legacy path called", async () => {
    flagState.value = false;
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "canceled",
      currentPeriodEnd: FUTURE_UNIX,
    });

    await handleStripeSubscriptionDeleted("cus_1", sub, "evt_1");

    expect(metricsMocks.billingGraceWindowFlagOff).toHaveBeenCalledWith({
      handler: "stripe.customer.subscription.deleted",
      userId: "u1",
      event: "customer.subscription.deleted",
    });
    // Legacy path nukes everything
    expect(prismaMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "FREE",
          stripeSubscriptionId: null,
          stripeCurrentPeriodEnd: null,
        }),
      }),
    );
  });
});

// ─── Tests: customer.subscription.updated (status events) ──────────

describe("handleStripeSubscriptionStatusEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagState.value = true;
    prismaMocks.findFirst.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Test User",
      role: "PRO",
    });
    prismaMocks.update.mockResolvedValue({});
  });

  it("flag ON + status='past_due' → role preserved, past_due metric, no DB write", async () => {
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "past_due",
      currentPeriodEnd: FUTURE_UNIX,
    });

    await handleStripeSubscriptionStatusEvent("cus_1", sub, "evt_1");

    expect(metricsMocks.billingPastDuePreserved).toHaveBeenCalledWith({
      userId: "u1",
      provider: "stripe",
    });
    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(downgradeMock.fn).not.toHaveBeenCalled();
  });

  it("flag ON + status='canceled' + period_end future → role preserved", async () => {
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "canceled",
      currentPeriodEnd: FUTURE_UNIX,
    });

    await handleStripeSubscriptionStatusEvent("cus_1", sub, "evt_1");

    expect(downgradeMock.fn).not.toHaveBeenCalled();
    expect(prismaMocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { stripeCurrentPeriodEnd: new Date(FUTURE_UNIX * 1000) },
    });
    expect(metricsMocks.billingRolePreservedInGrace).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "stripe",
        eventType: "customer.subscription.updated.canceled",
      }),
    );
  });

  it("flag ON + status='unpaid' + period_end past → applyImmediateDowngrade called", async () => {
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "unpaid",
      currentPeriodEnd: PAST_UNIX,
    });

    await handleStripeSubscriptionStatusEvent("cus_1", sub, "evt_1");

    expect(downgradeMock.fn).toHaveBeenCalledWith({
      userId: "u1",
      reason: "cancel_event_grace_already_past",
      triggeredBy: "webhook",
      providerEventId: "evt_1",
    });
    expect(prismaMocks.update).not.toHaveBeenCalled();
    expect(metricsMocks.billingPastDuePreserved).not.toHaveBeenCalled();
  });

  it("flag ON + status='canceled' + period_end missing → alert metric, no-op", async () => {
    const sub = makeStripeSubscription({
      id: "sub_1",
      status: "canceled",
      currentPeriodEnd: null,
    });

    await handleStripeSubscriptionStatusEvent("cus_1", sub, "evt_1");

    expect(metricsMocks.billingCancelWithNoPeriodEnd).toHaveBeenCalledWith({
      provider: "stripe",
      eventType: "customer.subscription.updated.canceled",
      userId: "u1",
      subscriptionId: "sub_1",
    });
    expect(downgradeMock.fn).not.toHaveBeenCalled();
    expect(prismaMocks.update).not.toHaveBeenCalled();
  });
});
