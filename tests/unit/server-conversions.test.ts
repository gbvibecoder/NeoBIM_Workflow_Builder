import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// ────────────────────────────────────────────────────────────────────────────
// Mock plan-pricing so we control deterministic event_ids for dedup tests.
// ────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/plan-pricing", () => ({
  getPurchaseEventId: (userId: string, plan: string) =>
    `purchase_${userId}_${plan}`,
}));

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function sha256Lower(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

interface CaptureFetch {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function installFetchSpy(): { calls: CaptureFetch[] } {
  const calls: CaptureFetch[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({
      url,
      init: init ?? {},
      body: JSON.parse((init?.body as string) ?? "{}"),
    });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls };
}

// ────────────────────────────────────────────────────────────────────────────

describe("server-conversions — Meta CAPI", () => {
  let mod: typeof import("@/lib/server-conversions");

  beforeEach(async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-capi-token";
    vi.resetModules();
    mod = await import("@/lib/server-conversions");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.META_CAPI_ACCESS_TOKEN;
  });

  it("sendMetaConversion silently no-ops when META_CAPI_ACCESS_TOKEN is unset", async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    vi.resetModules();
    const fresh = await import("@/lib/server-conversions");
    const fetchSpy = installFetchSpy();

    await fresh.sendMetaConversion({
      eventName: "Lead",
      eventId: "evt-1",
      userData: { email: "x@y.com" },
    });

    expect(fetchSpy.calls.length).toBe(0);
  });

  it("posts to Facebook Graph v21 endpoint with the canonical Pixel ID", async () => {
    const fetchSpy = installFetchSpy();
    await mod.sendMetaConversion({
      eventName: "Lead",
      eventId: "evt-1",
      userData: { email: "test@example.com" },
    });

    expect(fetchSpy.calls.length).toBe(1);
    expect(fetchSpy.calls[0].url).toContain(
      "https://graph.facebook.com/v21.0/2072969213494487/events"
    );
    expect(fetchSpy.calls[0].url).toContain("access_token=test-capi-token");
    expect(fetchSpy.calls[0].init.method).toBe("POST");
  });

  it("hashes email + phone + firstName with SHA-256 (lowercased, trimmed)", async () => {
    const fetchSpy = installFetchSpy();
    await mod.sendMetaConversion({
      eventName: "CompleteRegistration",
      eventId: "evt-2",
      userData: {
        email: "  Test@Example.com  ",
        phone: "+1 (555) 123-4567",
        firstName: " Govind ",
      },
    });

    const userData = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0]
      .user_data as Record<string, string>;

    expect(userData.em).toBe(sha256Lower("Test@Example.com"));
    // phone: digits only, then sha256 lowered — verify against the same
    // transformation that the production code performs
    expect(userData.ph).toBe(sha256Lower("15551234567"));
    expect(userData.fn).toBe(sha256Lower("Govind"));
  });

  it("forwards event_id for client-side pixel dedup", async () => {
    const fetchSpy = installFetchSpy();
    await mod.sendMetaConversion({
      eventName: "Purchase",
      eventId: "purchase_user-abc_pro",
      userData: { email: "x@y.com" },
    });

    const event = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0];
    expect(event.event_id).toBe("purchase_user-abc_pro");
    expect(event.event_name).toBe("Purchase");
    expect(event.action_source).toBe("website");
  });

  it("forwards _fbp / _fbc cookies and IP/UA when provided", async () => {
    const fetchSpy = installFetchSpy();
    await mod.sendMetaConversion({
      eventName: "Lead",
      eventId: "evt-3",
      userData: {
        email: "x@y.com",
        clientIpAddress: "1.2.3.4",
        clientUserAgent: "Mozilla/5.0",
        fbc: "fb.1.123.abc",
        fbp: "fb.1.456.xyz",
      },
    });

    const userData = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0]
      .user_data as Record<string, string>;
    expect(userData.client_ip_address).toBe("1.2.3.4");
    expect(userData.client_user_agent).toBe("Mozilla/5.0");
    expect(userData.fbc).toBe("fb.1.123.abc");
    expect(userData.fbp).toBe("fb.1.456.xyz");
  });

  it("does not throw on Facebook 4xx — failures are logged, not propagated", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error": "bad token"}', { status: 401 })
    ) as unknown as typeof fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      mod.sendMetaConversion({
        eventName: "Lead",
        eventId: "evt-4",
        userData: { email: "x@y.com" },
      })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("does not throw on network error — silently logs", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND graph.facebook.com");
    }) as unknown as typeof fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      mod.sendMetaConversion({
        eventName: "Lead",
        eventId: "evt-5",
        userData: { email: "x@y.com" },
      })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  // ── Convenience wrappers ────────────────────────────────────────────────

  it("trackServerSignup posts CompleteRegistration with event_source_url=/register", async () => {
    const fetchSpy = installFetchSpy();
    await mod.trackServerSignup({
      email: "new@user.com",
      firstName: "Asha",
      ip: "9.9.9.9",
      userAgent: "Test/1.0",
      eventId: "signup-deterministic",
    });

    const event = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0];
    expect(event.event_name).toBe("CompleteRegistration");
    expect(event.event_id).toBe("signup-deterministic");
    expect(event.event_source_url).toBe("https://trybuildflow.in/register");
    expect((event.custom_data as Record<string, string>).content_name).toBe(
      "BuildFlow Signup"
    );
  });

  it("trackServerSignup mints a UUID-shaped eventId when none is given", async () => {
    const fetchSpy = installFetchSpy();
    await mod.trackServerSignup({ email: "new@user.com" });

    const event = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0];
    expect(event.event_id).toMatch(/^signup_[0-9a-f-]{36}$/);
  });

  it("trackServerPurchase derives a deterministic eventId via getPurchaseEventId", async () => {
    const fetchSpy = installFetchSpy();
    await mod.trackServerPurchase({
      userId: "u1",
      email: "buyer@user.com",
      plan: "PRO",
      currency: "INR",
      value: 999,
    });

    const event = (fetchSpy.calls[0].body.data as Array<Record<string, unknown>>)[0];
    expect(event.event_name).toBe("Purchase");
    // Deterministic via mocked getPurchaseEventId
    expect(event.event_id).toBe("purchase_u1_PRO");
    expect(event.event_source_url).toBe(
      "https://trybuildflow.in/thank-you/subscription"
    );
    expect(event.custom_data).toMatchObject({
      content_name: "BuildFlow PRO Plan",
      currency: "INR",
      value: 999,
    });
  });

  it("hashForConversions matches the SHA-256 lowercased+trimmed contract used by Meta", () => {
    expect(mod.hashForConversions("  Test@Example.com  ")).toBe(
      sha256Lower("Test@Example.com")
    );
  });
});
