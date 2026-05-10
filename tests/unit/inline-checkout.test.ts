// @vitest-environment happy-dom
/**
 * Unit tests for openInlineUpgradeCheckout.
 *
 * The helper is the single client-side entry point into the lock-to-checkout
 * flow. These tests pin the contract every locked-card click depends on:
 *
 *   • E14 re-entry guard: rapid double-click → second call returns
 *     {kind:"already-in-flight"} without firing a second create-subscription
 *   • E1 session expired: getSession() returns null → redirect to /login
 *     and store the pending-upgrade intent in sessionStorage
 *   • E15 / E3 server cold-start: 5xx on /api/razorpay/checkout →
 *     {kind:"create-failed"} with the server's error message
 *   • E4 script blocked: loadRazorpay rejects → {kind:"script-blocked"}
 *     with the user-facing fallback copy
 *   • Success path: server creates sub → script loads → Razorpay handler
 *     fires → /api/razorpay/verify returns success → role updated, telemetry
 *     emitted, broadcast posted
 *   • Dismiss path: modal.ondismiss fires → {kind:"dismissed"}, no charge
 *   • Telemetry: every transition emits the matching track() event so the
 *     funnel dashboard isn't flying blind
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────
const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("next-auth/react", () => ({ getSession: getSessionMock }));

const loadRazorpayMock = vi.hoisted(() => vi.fn());
const RazorpayLoadErrorClass = vi.hoisted(() => {
  class E extends Error {
    constructor(public reason: string, message: string) {
      super(message);
      this.name = "RazorpayLoadError";
    }
  }
  return E;
});
vi.mock("@/features/billing/lib/load-razorpay", () => ({
  loadRazorpay: loadRazorpayMock,
  RazorpayLoadError: RazorpayLoadErrorClass,
}));

const trackMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/track", () => ({ track: trackMock }));

import { openInlineUpgradeCheckout } from "@/features/billing/lib/inline-checkout";

// ── Test scaffolding ──────────────────────────────────────────────────────

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (response?: unknown) => void) => void;
}

interface MockRazorpayCallbacks {
  handler?: (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => void;
  ondismiss?: () => void;
  paymentFailed?: (resp?: unknown) => void;
}

function makeRazorpayMock(): { ctor: ReturnType<typeof vi.fn>; instance: RazorpayInstance; cbs: MockRazorpayCallbacks } {
  const cbs: MockRazorpayCallbacks = {};
  const instance: RazorpayInstance = {
    open: vi.fn(),
    on: vi.fn((event: string, cb: (resp?: unknown) => void) => {
      if (event === "payment.failed") cbs.paymentFailed = cb;
    }),
  };
  // NOTE: must be a regular `function`, not an arrow — arrow functions
  // can't be constructors, and the helper calls `new Razorpay({...})`.
  const ctor = vi.fn(function (this: unknown, opts: Record<string, unknown>) {
    cbs.handler = opts.handler as MockRazorpayCallbacks["handler"];
    const modal = opts.modal as { ondismiss?: () => void } | undefined;
    cbs.ondismiss = modal?.ondismiss;
    return instance;
  });
  return { ctor, instance, cbs };
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_LOCATION = window.location;

// happy-dom's Response constructor doesn't always expose `.ok` cleanly, so
// helpers below build a plain Response-shaped object that the helper code
// reads (status, ok, json()).
function mkRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: signed-in user
  getSessionMock.mockResolvedValue({
    user: { id: "u1", email: "u@x.com", name: "Rutik" },
  });
  // Default: Razorpay loads cleanly
  const { ctor } = makeRazorpayMock();
  loadRazorpayMock.mockResolvedValue(ctor);
  // Each test customises window.location below.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...ORIGINAL_LOCATION,
      pathname: "/dashboard/templates",
      search: "",
      href: "http://localhost/dashboard/templates",
    },
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("openInlineUpgradeCheckout — session gate (E1)", () => {
  it("redirects to /login with intent + next when session is null", async () => {
    getSessionMock.mockResolvedValue(null);
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/templates",
        search: "?foo=bar",
        get href() { return "http://localhost/dashboard/templates?foo=bar"; },
        set href(v: string) { hrefSetter(v); },
      },
    });

    const result = await openInlineUpgradeCheckout({
      targetTier: "PRO",
      templateId: "wf-08",
    });

    expect(result.kind).toBe("session-expired");
    expect(hrefSetter).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
    expect(hrefSetter).toHaveBeenCalledWith(expect.stringContaining("intent=upgrade-PRO"));
    // Pending intent stashed for resume after login
    expect(sessionStorage.getItem("buildflow:pending-upgrade")).toContain("wf-08");
  });
});

describe("openInlineUpgradeCheckout — re-entry guard (E14)", () => {
  it("second concurrent call returns already-in-flight without firing a server request", async () => {
    // First call hangs forever on the create-subscription fetch — simulating
    // a slow server. Second call should short-circuit.
    let resolveFetch: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as typeof fetch;

    const first = openInlineUpgradeCheckout({ targetTier: "PRO", templateId: "wf-08" });
    // Yield the microtask queue so the first call captures the in-flight slot.
    await new Promise((r) => setTimeout(r, 0));
    const second = await openInlineUpgradeCheckout({ targetTier: "PRO", templateId: "wf-08" });

    expect(second.kind).toBe("already-in-flight");
    // Resolve the first promise so the test cleans up.
    resolveFetch?.(mkRes(500, { error: { code: "X", message: "x" } }));
    await first;
  });
});

describe("openInlineUpgradeCheckout — create-subscription failure (E3/E15)", () => {
  it("returns create-failed with server error message on 5xx", async () => {
    globalThis.fetch = vi.fn(async () =>
      mkRes(503, { error: { code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Razorpay is down" } }),
    ) as typeof fetch;

    const result = await openInlineUpgradeCheckout({ targetTier: "PRO" });
    expect(result.kind).toBe("create-failed");
    if (result.kind === "create-failed") {
      expect(result.userMessage).toBe("Razorpay is down");
      expect(result.errorCode).toBe("PAYMENT_SERVICE_UNAVAILABLE");
    }
    expect(trackMock).toHaveBeenCalledWith(
      "razorpay_checkout_failed",
      expect.objectContaining({ stage: "create" }),
    );
  });

  it("returns create-failed with retry message on 429", async () => {
    globalThis.fetch = vi.fn(async () => mkRes(429, {})) as typeof fetch;
    const result = await openInlineUpgradeCheckout({ targetTier: "PRO" });
    expect(result.kind).toBe("create-failed");
    if (result.kind === "create-failed") {
      expect(result.userMessage).toMatch(/wait/i);
    }
  });
});

describe("openInlineUpgradeCheckout — Razorpay script blocked (E4)", () => {
  it("returns script-blocked with fallback copy when loadRazorpay rejects", async () => {
    globalThis.fetch = vi.fn(async () => mkRes(200, { subscriptionId: "sub_1", razorpayKeyId: "rzp_test" })) as typeof fetch;
    loadRazorpayMock.mockRejectedValue(
      new RazorpayLoadErrorClass("timeout", "blocked"),
    );

    const result = await openInlineUpgradeCheckout({ targetTier: "PRO" });
    expect(result.kind).toBe("script-blocked");
    if (result.kind === "script-blocked") {
      expect(result.userMessage).toMatch(/network|payment provider/i);
    }
    expect(trackMock).toHaveBeenCalledWith(
      "razorpay_checkout_failed",
      expect.objectContaining({ stage: "script-load" }),
    );
  });
});

describe("openInlineUpgradeCheckout — happy path", () => {
  it("creates sub → opens widget → verifies → returns success", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.endsWith("/api/razorpay/checkout")) {
        return mkRes(200, {
          subscriptionId: "sub_abc",
          razorpayKeyId: "rzp_test_xyz",
          email: "u@x.com",
          name: "Rutik",
        });
      }
      if (url.endsWith("/api/razorpay/verify")) {
        return mkRes(200, { success: true, role: "PRO", previousRole: "FREE" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { ctor, cbs } = makeRazorpayMock();
    loadRazorpayMock.mockResolvedValue(ctor);

    const checkoutPromise = openInlineUpgradeCheckout({
      targetTier: "PRO",
      templateId: "wf-08",
      currentTier: "FREE",
    });

    // Wait for create + script-load + ctor to fire
    await vi.waitFor(() => {
      expect(ctor).toHaveBeenCalled();
    }, { timeout: 1000 });
    expect(cbs.handler).toBeTypeOf("function");

    // Simulate Razorpay calling our handler with a successful payment
    cbs.handler?.({
      razorpay_payment_id: "pay_1",
      razorpay_subscription_id: "sub_abc",
      razorpay_signature: "sig_1",
    });

    const result = await checkoutPromise;
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.role).toBe("PRO");
      expect(result.previousRole).toBe("FREE");
    }
    expect(calls.some((u) => u.endsWith("/api/razorpay/checkout"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/razorpay/verify"))).toBe(true);
    expect(trackMock).toHaveBeenCalledWith(
      "razorpay_checkout_completed",
      expect.objectContaining({ targetTier: "PRO" }),
    );
  });
});

describe("openInlineUpgradeCheckout — dismissed", () => {
  it("returns dismissed when user closes the modal", async () => {
    globalThis.fetch = vi.fn(async () => mkRes(200, { subscriptionId: "sub_1", razorpayKeyId: "rzp_test" })) as typeof fetch;
    const { ctor, cbs } = makeRazorpayMock();
    loadRazorpayMock.mockResolvedValue(ctor);

    const promise = openInlineUpgradeCheckout({ targetTier: "PRO" });
    await new Promise((r) => setTimeout(r, 10));
    cbs.ondismiss?.();

    const result = await promise;
    expect(result.kind).toBe("dismissed");
    expect(trackMock).toHaveBeenCalledWith(
      "razorpay_checkout_dismissed",
      expect.objectContaining({ subscriptionId: "sub_1" }),
    );
  });
});

describe("openInlineUpgradeCheckout — payment.failed event", () => {
  it("settles with payment-failed when Razorpay fires payment.failed", async () => {
    globalThis.fetch = vi.fn(async () => mkRes(200, { subscriptionId: "sub_1", razorpayKeyId: "rzp_test" })) as typeof fetch;
    const { ctor, cbs } = makeRazorpayMock();
    loadRazorpayMock.mockResolvedValue(ctor);

    const promise = openInlineUpgradeCheckout({ targetTier: "PRO" });
    await new Promise((r) => setTimeout(r, 10));
    cbs.paymentFailed?.({
      error: { description: "Card was declined", reason: "card_declined" },
    });

    const result = await promise;
    expect(result.kind).toBe("payment-failed");
    if (result.kind === "payment-failed") {
      expect(result.userMessage).toBe("Card was declined");
    }
  });
});
