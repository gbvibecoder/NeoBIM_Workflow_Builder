import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Helpers — install a fake `window.fbq` / `window.gtag` / `window.dataLayer`
// before each test. vitest runs in 'node' env, so we have to construct
// globalThis.window ourselves (matches the pattern in cookie-consent.test.ts).
// ────────────────────────────────────────────────────────────────────────────

type FbqCall = unknown[];

interface PixelStub {
  fbqCalls: FbqCall[];
  gtagCalls: FbqCall[];
  dataLayer: unknown[];
}

function installPixelStub(): PixelStub {
  const fbqCalls: FbqCall[] = [];
  const gtagCalls: FbqCall[] = [];
  const dataLayer: unknown[] = [];

  const win: Record<string, unknown> = {
    fbq: (...args: FbqCall) => fbqCalls.push(args),
    gtag: (...args: FbqCall) => gtagCalls.push(args),
    dataLayer,
  };

  Object.defineProperty(globalThis, "window", {
    value: win,
    writable: true,
    configurable: true,
  });

  return { fbqCalls, gtagCalls, dataLayer };
}

function clearWindow() {
  // @ts-expect-error intentionally clearing for next test
  delete globalThis.window;
}

// ────────────────────────────────────────────────────────────────────────────
// meta-pixel.ts — helper functions dispatch the right fbq events
// ────────────────────────────────────────────────────────────────────────────

describe("meta-pixel — track helpers", () => {
  let stub: PixelStub;
  let mod: typeof import("@/lib/meta-pixel");

  beforeEach(async () => {
    clearWindow();
    stub = installPixelStub();
    vi.resetModules();
    mod = await import("@/lib/meta-pixel");
  });

  afterEach(() => {
    clearWindow();
  });

  it("exports the canonical Pixel ID expected by Meta's verifier", () => {
    expect(mod.META_PIXEL_ID).toBe("2072969213494487");
  });

  it("trackLead → fbq('track','Lead') + dataLayer 'generate_lead'", () => {
    mod.trackLead({ value: 10, currency: "USD" });
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "Lead",
      { value: 10, currency: "USD" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "generate_lead",
      value: 10,
      currency: "USD",
    });
  });

  it("trackCompleteRegistration forwards eventID for server-side dedup", () => {
    mod.trackCompleteRegistration(
      { content_name: "BuildFlow Signup" },
      { eventID: "evt-123" }
    );
    // Wrapper auto-enriches with value + currency so Meta's diagnostic
    // cannot fail even if the caller forgot to pass them.
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "CompleteRegistration",
      { value: 1, currency: "EUR", content_name: "BuildFlow Signup" },
      { eventID: "evt-123" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "sign_up",
      content_name: "BuildFlow Signup",
      event_id: "evt-123",
    });
  });

  it("trackContact → fbq('track','Contact') + dataLayer 'contact_form'", () => {
    mod.trackContact({ source: "contact-page" });
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "Contact",
      { value: 1, currency: "EUR", source: "contact-page" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "contact_form",
      source: "contact-page",
    });
  });

  it("trackViewContent → fbq('track','ViewContent') + dataLayer 'view_item'", () => {
    mod.trackViewContent({ content_id: "wf-001" });
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "ViewContent",
      { content_id: "wf-001" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({ event: "view_item" });
  });

  it("trackRegisterPageView → fbq('track','ViewRegisterPage')", () => {
    mod.trackRegisterPageView();
    expect(stub.fbqCalls[0]).toEqual(["track", "ViewRegisterPage", {}]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "view_register_page",
    });
  });

  it("trackPurchase forwards eventID to both fbq and dataLayer", () => {
    mod.trackPurchase(
      { value: 79, currency: "USD" },
      { eventID: "purchase-abc" }
    );
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "Purchase",
      { value: 79, currency: "USD" },
      { eventID: "purchase-abc" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "purchase",
      value: 79,
      event_id: "purchase-abc",
    });
  });

  it("trackInitiateCheckout → fbq('track','InitiateCheckout') + 'begin_checkout'", () => {
    mod.trackInitiateCheckout({ plan: "PRO" });
    // Revenue event: only currency is defaulted; value must come from caller
    // (here this is a partial test fixture, so no value is asserted).
    expect(stub.fbqCalls[0]).toEqual([
      "track",
      "InitiateCheckout",
      { currency: "EUR", plan: "PRO" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "begin_checkout",
      plan: "PRO",
    });
  });

  it("trackLogin uses trackCustom (Login is not a Meta standard event)", () => {
    mod.trackLogin({ method: "google" });
    expect(stub.fbqCalls[0]).toEqual([
      "trackCustom",
      "Login",
      { method: "google" },
    ]);
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "login",
      method: "google",
    });
  });

  it("trackAdsConversion routes to gtag, not fbq", () => {
    mod.trackAdsConversion("AW-123/abc", { value: 5 });
    expect(stub.gtagCalls[0]).toEqual([
      "event",
      "conversion",
      { send_to: "AW-123/abc", value: 5 },
    ]);
    expect(stub.fbqCalls.length).toBe(0);
  });

  it("trackAdsConversion no-ops when gtag is unavailable", () => {
    delete (globalThis.window as unknown as Record<string, unknown>).gtag;
    expect(() => mod.trackAdsConversion("AW-123/abc")).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// meta-pixel — SSR / ad-blocker safety: helpers must no-op when fbq absent
// ────────────────────────────────────────────────────────────────────────────

describe("meta-pixel — no-op when window.fbq is undefined", () => {
  beforeEach(() => {
    clearWindow();
    // Install a window WITHOUT fbq (simulates ad blocker that strips fbq)
    Object.defineProperty(globalThis, "window", {
      value: { dataLayer: [] },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => clearWindow());

  it("does not throw if fbq is missing (ad blocker, SSR snapshot)", async () => {
    vi.resetModules();
    const { trackLead, trackPurchase } = await import("@/lib/meta-pixel");
    expect(() => trackLead({ value: 1 })).not.toThrow();
    expect(() => trackPurchase({ value: 1 }, { eventID: "x" })).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// cookie-consent — must call dataProcessingOptions, NOT consent grant/revoke
// (regression guard for the exact bug that broke Meta's verifier)
// ────────────────────────────────────────────────────────────────────────────

describe("cookie-consent — Meta privacy uses LDU toggle", () => {
  let setTrackingConsent: typeof import("@/lib/cookie-consent").setTrackingConsent;
  let stub: PixelStub;
  const mockStorage: Record<string, string> = {};

  beforeEach(async () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    clearWindow();
    stub = installPixelStub();

    const mockLocalStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {},
      length: 0,
      key: () => null,
    };
    Object.defineProperty(globalThis.window, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.window, "dispatchEvent", {
      value: () => true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    const mod = await import("@/lib/cookie-consent");
    setTrackingConsent = mod.setTrackingConsent;
  });

  afterEach(() => clearWindow());

  it("Accept clears LDU (full data use)", () => {
    setTrackingConsent("accepted");
    const fbqCall = stub.fbqCalls.find((c) => c[0] === "dataProcessingOptions");
    expect(fbqCall).toEqual(["dataProcessingOptions", [], 0, 0]);

    const gtagConsent = stub.gtagCalls.find(
      (c) => c[0] === "consent" && c[1] === "update"
    );
    expect(gtagConsent?.[2]).toMatchObject({
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
  });

  it("Reject re-applies LDU (limited data use)", () => {
    setTrackingConsent("rejected");
    const fbqCall = stub.fbqCalls.find((c) => c[0] === "dataProcessingOptions");
    expect(fbqCall).toEqual(["dataProcessingOptions", ["LDU"], 0, 0]);

    const gtagConsent = stub.gtagCalls.find(
      (c) => c[0] === "consent" && c[1] === "update"
    );
    expect(gtagConsent?.[2]).toMatchObject({
      analytics_storage: "denied",
      ad_storage: "denied",
    });
  });

  it("REGRESSION: must NOT call fbq('consent','revoke') or fbq('consent','grant')", () => {
    setTrackingConsent("accepted");
    setTrackingConsent("rejected");
    const consentCalls = stub.fbqCalls.filter((c) => c[0] === "consent");
    expect(consentCalls).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Source-shape regression guards — read the actual source files and assert
// the Meta Pixel snippet is structured correctly. Catches accidental edits
// that would re-introduce the verifier bug without anyone noticing.
// ────────────────────────────────────────────────────────────────────────────

const repoRoot = resolve(__dirname, "../..");

/** Extract just the inline JS inside the <Script id="meta-pixel"> block. */
function extractMetaPixelInlineScript(src: string): string {
  // Match the block from `id="meta-pixel"` to its closing </Script>
  const block = src.match(/id="meta-pixel"[\s\S]*?<\/Script>/)?.[0] ?? "";
  // Then extract the template-literal content (inside the {` ... `})
  const inline = block.match(/\{`([\s\S]*?)`\}/)?.[1] ?? "";
  return inline;
}

describe("TrackingScripts.tsx — Meta Pixel snippet shape", () => {
  const src = readFileSync(
    resolve(repoRoot, "src/shared/components/TrackingScripts.tsx"),
    "utf8"
  );
  const inline = extractMetaPixelInlineScript(src);

  it("the inline <Script id=\"meta-pixel\"> block is non-empty", () => {
    expect(inline.length).toBeGreaterThan(100);
  });

  it("REGRESSION: inline script must NOT call fbq('consent', 'revoke')", () => {
    expect(inline).not.toMatch(
      /fbq\(\s*['"]consent['"]\s*,\s*['"]revoke['"]\s*\)/
    );
  });

  it("calls fbq('init', PIXEL_ID) before fbq('track', 'PageView')", () => {
    const initIdx = inline.indexOf("fbq('init',");
    const pvIdx = inline.indexOf("fbq('track', 'PageView')");
    expect(initIdx).toBeGreaterThan(-1);
    expect(pvIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeLessThan(pvIdx);
  });

  it("applies dataProcessingOptions(['LDU'], 0, 0) between init and PageView", () => {
    const initIdx = inline.indexOf("fbq('init',");
    const lduIdx = inline.indexOf(
      "fbq('dataProcessingOptions', ['LDU'], 0, 0)"
    );
    const pvIdx = inline.indexOf("fbq('track', 'PageView')");
    expect(lduIdx).toBeGreaterThan(initIdx);
    expect(lduIdx).toBeLessThan(pvIdx);
  });

  it("loads fbevents.js from connect.facebook.net", () => {
    expect(inline).toContain(
      "https://connect.facebook.net/en_US/fbevents.js"
    );
  });
});

describe("layout.tsx — <noscript> Meta Pixel fallback", () => {
  const src = readFileSync(
    resolve(repoRoot, "src/app/layout.tsx"),
    "utf8"
  );

  it("contains a noscript img pointing at facebook.com/tr with the canonical Pixel ID", () => {
    expect(src).toMatch(
      /<noscript>[\s\S]*facebook\.com\/tr\?id=\$\{META_PIXEL_ID\}&ev=PageView&noscript=1[\s\S]*<\/noscript>/
    );
  });

  it("imports META_PIXEL_ID from the canonical module", () => {
    expect(src).toContain('import { META_PIXEL_ID } from "@/lib/meta-pixel"');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CSP — the security headers must allow Facebook's pixel domains
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Value/currency contract — regression guard for the Meta diagnostic
// "Send valid price and currency information for website CompleteRegistration
// events" (100% missing value+currency). Every Lead/CompleteRegistration fire
// MUST carry a numeric value > 0 and currency = "EUR".
// ────────────────────────────────────────────────────────────────────────────

describe("meta-pixel — value/currency contract (Meta diagnostic guard)", () => {
  let mod: typeof import("@/lib/meta-pixel");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("@/lib/meta-pixel");
  });

  it("META_CURRENCY is EUR (ad-platform reporting currency)", () => {
    expect(mod.META_CURRENCY).toBe("EUR");
  });

  it("META_EVENT_VALUE.LEAD is a positive number (Meta requires value > 0)", () => {
    expect(typeof mod.META_EVENT_VALUE.LEAD).toBe("number");
    expect(mod.META_EVENT_VALUE.LEAD).toBeGreaterThan(0);
  });

  it("META_EVENT_VALUE.REGISTRATION is a positive number (Meta requires value > 0)", () => {
    expect(typeof mod.META_EVENT_VALUE.REGISTRATION).toBe("number");
    expect(mod.META_EVENT_VALUE.REGISTRATION).toBeGreaterThan(0);
  });

  it("REGRESSION: no legacy LEAD_INR / REGISTRATION_INR keys exist on META_EVENT_VALUE", () => {
    const keys = Object.keys(mod.META_EVENT_VALUE);
    expect(keys).not.toContain("LEAD_INR");
    expect(keys).not.toContain("REGISTRATION_INR");
  });

  it("META_EVENT_VALUE.CONTACT is a positive number (Contact is the next event Meta would flag)", () => {
    expect(typeof mod.META_EVENT_VALUE.CONTACT).toBe("number");
    expect(mod.META_EVENT_VALUE.CONTACT).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// FIRE-TIME REGRESSION GUARDS — these prove the wrapper itself enriches every
// fire with value+currency. They are the assertions that catch the failure
// mode the constants-only tests above CAN'T catch: a future caller that
// passes empty / partial params and would otherwise re-introduce Meta's
// "Send valid price and currency information" diagnostic.
// ────────────────────────────────────────────────────────────────────────────

describe("meta-pixel — wrapper enriches every fire (diagnostic immunity)", () => {
  let stub: PixelStub;
  let mod: typeof import("@/lib/meta-pixel");

  beforeEach(async () => {
    clearWindow();
    stub = installPixelStub();
    vi.resetModules();
    mod = await import("@/lib/meta-pixel");
  });

  afterEach(() => clearWindow());

  it("trackLead() with NO params still fires with value + currency", () => {
    mod.trackLead();
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params).toBeTruthy();
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
  });

  it("trackLead({}) with empty params still fires with value + currency", () => {
    mod.trackLead({});
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
  });

  it("trackLead({content_name:'x'}) — caller content_name preserved, defaults still applied", () => {
    mod.trackLead({ content_name: "newsletter" });
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
    expect(params.content_name).toBe("newsletter");
  });

  it("trackLead — caller-supplied value+currency override the defaults (no clobber)", () => {
    mod.trackLead({ value: 25, currency: "USD" });
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(25);
    expect(params.currency).toBe("USD");
  });

  it("trackCompleteRegistration() with NO params still fires with value + currency", () => {
    mod.trackCompleteRegistration();
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
  });

  it("trackContact() with NO params still fires with value + currency", () => {
    mod.trackContact();
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
  });

  it("trackPurchase — revenue event defaults currency to EUR (value is caller's responsibility)", () => {
    mod.trackPurchase({ value: 20 }, { eventID: "p-1" });
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(20);
    expect(params.currency).toBe("EUR");
  });

  it("trackInitiateCheckout — revenue event defaults currency to EUR (value caller-supplied)", () => {
    mod.trackInitiateCheckout({ value: 8 });
    const params = stub.fbqCalls[0]?.[2] as Record<string, unknown>;
    expect(params.value).toBe(8);
    expect(params.currency).toBe("EUR");
  });

  it("dataLayer push also carries enriched value+currency (GTM/GA4 consistency)", () => {
    mod.trackLead();
    expect(stub.dataLayer.at(-1)).toMatchObject({
      event: "generate_lead",
      value: 1,
      currency: "EUR",
    });
  });
});

describe("plan-pricing — getPlanValueEUR (Purchase value contract)", () => {
  it("maps each paid plan to its locked EUR ad-reporting value", async () => {
    const { getPlanValueEUR } = await import("@/lib/plan-pricing");
    expect(getPlanValueEUR("FREE")).toBe(0);
    expect(getPlanValueEUR("MINI")).toBe(1);
    expect(getPlanValueEUR("STARTER")).toBe(8);
    expect(getPlanValueEUR("PRO")).toBe(20);
    // TEAM is custom-priced (sales-negotiated) — ad-platform value = 0
    expect(getPlanValueEUR("TEAM")).toBe(0);
    expect(getPlanValueEUR("TEAM_ADMIN")).toBe(0);
  });

  it("returns 0 for unknown / null / undefined roles (never throws, never NaN)", async () => {
    const { getPlanValueEUR } = await import("@/lib/plan-pricing");
    expect(getPlanValueEUR(null)).toBe(0);
    expect(getPlanValueEUR(undefined)).toBe(0);
    expect(getPlanValueEUR("BOGUS")).toBe(0);
  });
});

describe("plan-pricing — getPurchaseEventId (browser↔CAPI dedup contract)", () => {
  it("derives a deterministic, case-insensitive id from userId + plan", async () => {
    const { getPurchaseEventId } = await import("@/lib/plan-pricing");
    expect(getPurchaseEventId("u1", "PRO")).toBe("purchase_u1_PRO");
    expect(getPurchaseEventId("u1", "pro")).toBe("purchase_u1_PRO");
  });

  it("REGRESSION: collapses the TEAM / TEAM_ADMIN alias to ONE canonical id", async () => {
    // The browser thank-you redirect carries `?plan=TEAM` (the dashboard
    // normalizes TEAM_ADMIN → TEAM for display), but the Stripe/Razorpay
    // webhooks resolve the role to `TEAM_ADMIN`. If these two produced
    // different event_ids, Meta could not dedupe the browser pixel against
    // the server CAPI fire and would DOUBLE-COUNT every Team purchase.
    // Both aliases MUST map to the same id.
    const { getPurchaseEventId } = await import("@/lib/plan-pricing");
    const browserId = getPurchaseEventId("u1", "TEAM");       // from ?plan=TEAM
    const serverId = getPurchaseEventId("u1", "TEAM_ADMIN");  // from webhook role
    expect(browserId).toBe(serverId);
    expect(browserId).toBe("purchase_u1_TEAM_ADMIN");
  });
});

describe("next.config.ts — CSP allows Meta Pixel domains", () => {
  const src = readFileSync(resolve(repoRoot, "next.config.ts"), "utf8");

  it("script-src allows connect.facebook.net (fbevents.js)", () => {
    expect(src).toContain("https://connect.facebook.net");
  });

  it("img-src allows facebook.com (the /tr pixel hit)", () => {
    expect(src).toContain("https://www.facebook.com");
  });

  it("connect-src allows facebook.com + connect.facebook.net for ajax pings", () => {
    const connectLine = src.match(/connect-src[^;]+;/)?.[0] ?? "";
    expect(connectLine).toContain("https://www.facebook.com");
    expect(connectLine).toContain("https://connect.facebook.net");
  });
});
