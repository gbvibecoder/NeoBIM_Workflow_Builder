/**
 * Regression tests for the OAuth-signup browser↔server CAPI dedup fix.
 *
 * The 332-event CompleteRegistration gap (browser > server in Meta Events
 * Manager) was traced to two bugs:
 *   1. The Google CTA on /register fired the Meta Pixel at button-click,
 *      counting every consent-screen cancellation and returning-user sign-in.
 *   2. Browser and server used different event_id formats, so even successful
 *      Google signups never deduped.
 *
 * These tests pin the fix:
 *   - The browser fire lives on /onboard (OnboardSignupTracking) behind the
 *     same double-gate Google Ads already uses.
 *   - Both fires use the literal same string from getOauthSignupEventId.
 *   - Server CAPI calls are wrapped in `after()` so Vercel suspension does
 *     not kill the in-flight Graph API POST.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");

// ─── Helpers — browser stub (vitest env: 'node') ───────────────────────────

interface BrowserStub {
  fbqCalls: unknown[][];
  gtagCalls: unknown[][];
  dataLayer: unknown[];
  sessionStore: Record<string, string>;
  setCookieRaw: (s: string) => void;
  getCookieRaw: () => string;
}

function installBrowserStub(): BrowserStub {
  const fbqCalls: unknown[][] = [];
  const gtagCalls: unknown[][] = [];
  const dataLayer: unknown[] = [];
  const sessionStore: Record<string, string> = {};
  let cookieString = "";

  const win: Record<string, unknown> = {
    fbq: (...args: unknown[]) => fbqCalls.push(args),
    gtag: (...args: unknown[]) => gtagCalls.push(args),
    dataLayer,
    sessionStorage: {
      getItem: (k: string) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k: string, v: string) => {
        sessionStore[k] = v;
      },
      removeItem: (k: string) => {
        delete sessionStore[k];
      },
      clear: () => {
        for (const k of Object.keys(sessionStore)) delete sessionStore[k];
      },
      length: 0,
      key: () => null,
    },
  };

  // document.cookie getter/setter mimicking browser semantics for our two
  // operations: append a fresh cookie, or delete via Max-Age=0.
  const doc = {} as { cookie: string };
  Object.defineProperty(doc, "cookie", {
    get: () => cookieString,
    set: (raw: string) => {
      const firstPair = raw.split(";")[0];
      const name = firstPair.split("=")[0].trim();
      const isClear = /(?:^|;\s*)Max-Age=0/i.test(raw);
      const remaining = cookieString
        .split("; ")
        .filter((c) => c && !c.startsWith(`${name}=`))
        .join("; ");
      if (isClear) {
        cookieString = remaining;
      } else {
        cookieString = remaining ? `${remaining}; ${firstPair}` : firstPair;
      }
    },
  });

  Object.defineProperty(globalThis, "window", {
    value: win,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: doc,
    writable: true,
    configurable: true,
  });

  return {
    fbqCalls,
    gtagCalls,
    dataLayer,
    sessionStore,
    setCookieRaw: (s: string) => {
      cookieString = s;
    },
    getCookieRaw: () => cookieString,
  };
}

function clearBrowserStub() {
  // @ts-expect-error intentionally clearing for next test
  delete globalThis.window;
  // @ts-expect-error intentionally clearing for next test
  delete globalThis.document;
}

// ─── getOauthSignupEventId — single source of truth for browser↔server ─────

describe("getOauthSignupEventId — deterministic event_id for OAuth signup dedup", () => {
  it("returns the literal `signup_oauth_${userId}` string", async () => {
    const { getOauthSignupEventId } = await import("@/lib/oauth-signup-event-id");
    expect(getOauthSignupEventId("abc123")).toBe("signup_oauth_abc123");
  });

  it("is byte-for-byte stable across calls (no embedded randomness)", async () => {
    const { getOauthSignupEventId } = await import("@/lib/oauth-signup-event-id");
    expect(getOauthSignupEventId("u1")).toBe(getOauthSignupEventId("u1"));
  });
});

// ─── runOnboardSignupTracking — behavioural test of the gate logic ─────────

describe("runOnboardSignupTracking — fire-once gated by sessionStorage + cookie", () => {
  let stub: BrowserStub;

  beforeEach(() => {
    clearBrowserStub();
    stub = installBrowserStub();
    vi.resetModules();
  });

  afterEach(() => {
    clearBrowserStub();
  });

  it("fires Meta Pixel CompleteRegistration with eventID=signup_oauth_<userId> when both gates pass", async () => {
    stub.sessionStore["pending_google_signup_conversion"] = "1";
    stub.setCookieRaw("bf_signup_just_created=1");

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );
    runOnboardSignupTracking({
      id: "abc123",
      email: "user@example.com",
      name: "Govind Bhujbal",
    });

    const completeRegistrationCalls = stub.fbqCalls.filter(
      (c) => c[0] === "track" && c[1] === "CompleteRegistration"
    );
    expect(completeRegistrationCalls.length).toBe(1);

    const [, , params, options] = completeRegistrationCalls[0] as [
      string,
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(options).toEqual({ eventID: "signup_oauth_abc123" });
    expect(params).toMatchObject({
      content_name: "google_signup",
      value: 1,
      currency: "EUR",
      user_email: "user@example.com",
      user_name: "Govind Bhujbal",
    });
  });

  it("REGRESSION: returning-user Google sign-in (no sessionStorage flag) does NOT fire", async () => {
    // Cookie set but no sessionStorage flag → user came from /login, not the
    // /register Google CTA. Returning sign-ins must not count as registrations.
    stub.setCookieRaw("bf_signup_just_created=1");

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );
    runOnboardSignupTracking({ id: "u1", email: "x@y.com", name: null });

    expect(stub.fbqCalls.length).toBe(0);
  });

  it("REGRESSION: existing user re-clicking Continue with Google (no createUser cookie) does NOT fire", async () => {
    // sessionStorage flag set but cookie missing → user clicked Continue with
    // Google on /register but PrismaAdapter did NOT create a new row (account
    // already existed). Must not fire.
    stub.sessionStore["pending_google_signup_conversion"] = "1";

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );
    runOnboardSignupTracking({ id: "u1", email: "x@y.com", name: null });

    expect(stub.fbqCalls.length).toBe(0);
  });

  it("clears both gates on read — refresh / re-mount does NOT replay the fire", async () => {
    stub.sessionStore["pending_google_signup_conversion"] = "1";
    stub.setCookieRaw("bf_signup_just_created=1");

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );

    runOnboardSignupTracking({ id: "u1", email: "x@y.com", name: null });
    expect(stub.fbqCalls.length).toBe(1);

    // Second invocation (simulating refresh / strict-mode double-mount) must
    // be a no-op because the flag clearing on first read closed the gate.
    runOnboardSignupTracking({ id: "u1", email: "x@y.com", name: null });
    expect(stub.fbqCalls.length).toBe(1);

    expect(stub.sessionStore["pending_google_signup_conversion"]).toBeUndefined();
    expect(stub.getCookieRaw()).not.toContain("bf_signup_just_created=1");
  });

  it("omits user_email and user_name when session has neither (no undefined leaks to Meta)", async () => {
    stub.sessionStore["pending_google_signup_conversion"] = "1";
    stub.setCookieRaw("bf_signup_just_created=1");

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );
    runOnboardSignupTracking({ id: "u1", email: null, name: null });

    const [, , params] = stub.fbqCalls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(params).not.toHaveProperty("user_email");
    expect(params).not.toHaveProperty("user_name");
    expect(params.value).toBe(1);
    expect(params.currency).toBe("EUR");
  });

  it("also pushes sign_up_complete to dataLayer (GA4 / GTM consistency)", async () => {
    stub.sessionStore["pending_google_signup_conversion"] = "1";
    stub.setCookieRaw("bf_signup_just_created=1");

    const { runOnboardSignupTracking } = await import(
      "@/app/onboard/OnboardSignupTracking"
    );
    runOnboardSignupTracking({ id: "u1", email: "x@y.com", name: "X" });

    const signUpComplete = stub.dataLayer.find(
      (d) => (d as Record<string, unknown>).event === "sign_up_complete"
    );
    expect(signUpComplete).toMatchObject({
      event: "sign_up_complete",
      method: "google",
    });
  });
});

// ─── Source-shape regression guards ────────────────────────────────────────
//
// Behavioural mocks can drift; source-shape regex tests pin the contract
// against the file content itself. Same pattern as the existing
// `TrackingScripts.tsx` / `layout.tsx` guards in `meta-pixel.test.ts`.

describe("source-shape — register/page.tsx Google CTA does NOT fire CompleteRegistration", () => {
  const src = readFileSync(
    resolve(repoRoot, "src/app/(auth)/register/page.tsx"),
    "utf8"
  );

  function extractHandleGoogleBody(source: string): string {
    // Match from `async function handleGoogle(` through the matching closing
    // brace. Brace-counting because the body has nested blocks (try / catch).
    const start = source.indexOf("async function handleGoogle(");
    if (start === -1) return "";
    let depth = 0;
    let firstBrace = -1;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") {
        if (firstBrace === -1) firstBrace = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && firstBrace !== -1) {
          return source.slice(firstBrace, i + 1);
        }
      }
    }
    return "";
  }

  const handleGoogleBody = extractHandleGoogleBody(src);

  it("handleGoogle body was successfully extracted (sanity check)", () => {
    expect(handleGoogleBody.length).toBeGreaterThan(50);
    expect(handleGoogleBody).toContain("signIn(\"google\"");
  });

  it("REGRESSION: handleGoogle MUST NOT call trackCompleteRegistration (caused the 332-event gap)", () => {
    expect(handleGoogleBody).not.toMatch(/trackCompleteRegistration\s*\(/);
  });

  it("REGRESSION: handleGoogle MUST NOT mint a `signup_google_` event_id (browser↔server dedup uses signup_oauth_)", () => {
    expect(handleGoogleBody).not.toContain("signup_google_");
  });

  it("handleGoogle still sets the pending_google_signup_conversion flag (one half of the /onboard double-gate)", () => {
    expect(handleGoogleBody).toContain(
      'sessionStorage.setItem("pending_google_signup_conversion", "1")'
    );
  });
});

describe("source-shape — OnboardSignupTracking.tsx is the canonical OAuth signup fire site", () => {
  const src = readFileSync(
    resolve(repoRoot, "src/app/onboard/OnboardSignupTracking.tsx"),
    "utf8"
  );

  it("imports getOauthSignupEventId — single source of truth for the event_id format", () => {
    expect(src).toContain(
      'import { getOauthSignupEventId } from "@/lib/oauth-signup-event-id"'
    );
  });

  it("calls trackCompleteRegistration with content_name 'google_signup'", () => {
    expect(src).toContain("trackCompleteRegistration(");
    expect(src).toContain('content_name: "google_signup"');
  });

  it("uses getOauthSignupEventId for the eventID option (browser↔server dedup)", () => {
    expect(src).toMatch(
      /eventID:\s*getOauthSignupEventId\(\s*user\.id\s*\)/
    );
  });

  it("checks the sessionStorage gate + cookie gate before firing", () => {
    expect(src).toContain('"pending_google_signup_conversion"');
    expect(src).toContain('"bf_signup_just_created"');
  });
});

describe("source-shape — auth.ts events.createUser uses getOauthSignupEventId", () => {
  const src = readFileSync(resolve(repoRoot, "src/lib/auth.ts"), "utf8");

  it("imports getOauthSignupEventId — same helper the browser uses", () => {
    expect(src).toContain(
      'import { getOauthSignupEventId } from "@/lib/oauth-signup-event-id"'
    );
  });

  it("constructs the CAPI event_id via getOauthSignupEventId(user.id)", () => {
    expect(src).toMatch(/getOauthSignupEventId\(\s*user\.id\s*\)/);
  });

  it("REGRESSION: must NOT use the legacy `signup_oauth_${user.id}` inline template (drift risk)", () => {
    expect(src).not.toMatch(/`signup_oauth_\$\{user\.id\}`/);
  });
});

describe("source-shape — register/route.ts wraps trackServerSignup in after()", () => {
  const src = readFileSync(
    resolve(repoRoot, "src/app/api/auth/register/route.ts"),
    "utf8"
  );

  it("imports `after` from next/server", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*["']next\/server["']/);
  });

  it("wraps the trackServerSignup call inside after(...)", () => {
    // Scan from the after( opener for its trackServerSignup body.
    const afterIdx = src.indexOf("after(async () =>");
    expect(afterIdx).toBeGreaterThan(-1);
    const slice = src.slice(afterIdx, afterIdx + 1500);
    expect(slice).toContain("trackServerSignup(");
  });

  it("REGRESSION: must NOT use the old fire-and-forget shape `}).catch(err => console.warn(\"[meta-capi]\"`", () => {
    // The bare fire-and-forget pattern is killed by Vercel function suspension
    // after NextResponse.json returns. after() keeps the function alive.
    expect(src).not.toMatch(
      /\}\s*\)\.catch\(\s*err\s*=>\s*console\.warn\(\s*["']\[meta-capi\]["']/
    );
  });
});

describe("source-shape — auth.ts events.createUser wraps trackServerSignup in after()", () => {
  const src = readFileSync(resolve(repoRoot, "src/lib/auth.ts"), "utf8");

  it("imports `after` from next/server", () => {
    expect(src).toMatch(/import\s*\{\s*after\s*\}\s*from\s*["']next\/server["']/);
  });

  it("wraps trackServerSignup inside after(...) in events.createUser", () => {
    const afterIdx = src.indexOf("after(async () =>");
    expect(afterIdx).toBeGreaterThan(-1);
    const slice = src.slice(afterIdx, afterIdx + 800);
    expect(slice).toContain("trackServerSignup(");
  });

  it("trackServerSignup appears ONLY inside an after() callback, never as a top-level await", () => {
    // Strategy: every trackServerSignup( occurrence must have an `after(`
    // somewhere earlier in the file with no intervening function-boundary
    // markers that could un-scope it. We approximate by requiring `after(`
    // to be the nearest preceding scheduler call.
    const beforeFirstTrack = src.slice(0, src.indexOf("trackServerSignup("));
    expect(beforeFirstTrack).toContain("after(async () =>");
  });
});
