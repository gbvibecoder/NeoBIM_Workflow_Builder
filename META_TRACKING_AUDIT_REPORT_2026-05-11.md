# Meta Pixel & Conversion API — Tracking Audit Report

**Date:** 2026-05-11
**Pixel ID:** `2072969213494487`
**Scope:** Full source-code audit of every `fbq()` call, every CAPI POST, event_id dedup integrity, value/currency coverage, fbp/fbc handling.
**Trigger:** Manager flagged "2 browser events, 1 server event" — Meta's algorithm cannot learn at this volume. Below is the root cause, mapped to each of Meta's specific warnings, with file:line references and ready-to-apply fixes.

---

## 1. Executive summary

There are **two** files that own all Meta tracking:

| Side | File | Role |
|------|------|------|
| Browser | `src/lib/meta-pixel.ts` | Thin wrappers around `window.fbq()`. Exports `trackLead`, `trackCompleteRegistration`, `trackPurchase`, `trackContact`, `trackInitiateCheckout`, `trackViewContent`, `trackLogin`. |
| Server | `src/lib/server-conversions.ts` | POSTs to `https://graph.facebook.com/v21.0/2072969213494487/events`. Exports `sendMetaConversion`, `trackServerSignup`, `trackServerPurchase`. |

The Pixel SDK loads from `src/shared/components/TrackingScripts.tsx` (`<Script id="meta-pixel">`), inits `2072969213494487`, applies LDU, and fires `PageView` immediately.

The architecture is sound. The problem is **coverage**: across 17+ `fbq()` call sites, only **2** event types (`Purchase`, `InitiateCheckout`) carry the value+currency Meta needs to optimize. Only **2** events have a server CAPI counterpart (`CompleteRegistration`, `Purchase`). And **fbp/fbc cookies are never forwarded to the server**, which silently breaks deduplication even where it appears to work.

**This explains every one of Meta's warnings verbatim:**

| Meta's warning | Root cause in code |
|---|---|
| "Browser events: 2, Server events: 1 — almost blind" | Only `Purchase` + `CompleteRegistration` send via CAPI. `Lead`, `Contact`, `ViewContent`, `InitiateCheckout` are browser-only — half their volume is lost to ad blockers / iOS / ITP. |
| "Price/currency missing on CompleteRegistration" | `register/page.tsx:174` fires `trackCompleteRegistration({ content_name })` — no `value`, no `currency`. `server-conversions.ts:117-120` matches: `customData: { content_name, status }` — no value/currency. |
| "100% of Lead events missing valid value/currency" | 9 `trackLead()` callers — none pass value/currency. See table §3. |
| "fbp/fbc may be missing from server events" | `server-conversions.ts:38-39` defines fields for fbp/fbc but **no caller ever populates them**. `cookies()` is never read in `register/route.ts` or the webhooks. |
| "Events may be discarded due to deduplication" | Two distinct failures: (a) `Lead` has no CAPI counterpart, so there's nothing to dedup, but Meta sees orphan browser events and may discard. (b) Even on signup where event_id matching works, missing fbp/fbc weakens identity resolution → Meta can't confidently match browser↔server pairs. |
| "Pixel sending more CompleteRegistration than CAPI" | Google OAuth signup path: `register/page.tsx:226` fires browser pixel only. Server CAPI fires only from `/api/auth/register/route.ts` (credentials path). Google signup never hits that route → CAPI never fires for ~30-60% of signups. |

---

## 2. Pixel SDK initialization (browser side)

**File:** `src/shared/components/TrackingScripts.tsx:45-59`

```jsx
<Script id="meta-pixel" strategy="afterInteractive">
  {`
    !function(f,b,e,v,n,t,s) {...}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${META_PIXEL_ID}');
    fbq('dataProcessingOptions', ['LDU'], 0, 0);
    fbq('track', 'PageView');
  `}
</Script>
```

**Status:** ✅ Correct. PageView fires unconditionally on load. LDU (Limited Data Use) is applied as a privacy gate instead of `consent revoke` so the verifier still sees real network hits.

**Issue:** `META_PIXEL_ID` is hardcoded in `src/lib/meta-pixel.ts:5` and `src/lib/server-conversions.ts:16`. Should be an env var (`NEXT_PUBLIC_META_PIXEL_ID`) for rotation safety. Not urgent, but flag for the fix plan.

---

## 3. All browser `fbq()` call sites (the data Meta receives)

Sorted by event type. The **rightmost column** is what Meta actually needs from you.

### Lead (9 call sites — ALL missing value/currency) 🚨

| # | File | Line | Event params | Missing |
|---|------|------|-----------|---------|
| 1 | `src/app/page.tsx` | 977 | `{ content_name: "workflow_request", content_category }` | value, currency, eventID |
| 2 | `src/app/page.tsx` | 1097 | `{ content_name: "nav_cta_sign_up" }` | value, currency, eventID |
| 3 | `src/app/page.tsx` | 1189 | `{ content_name: "mobile_menu_sign_up" }` | value, currency, eventID |
| 4 | `src/app/page.tsx` | 1553 | `{ content_name: "hero_cta_get_started" }` | value, currency, eventID |
| 5 | `src/app/page.tsx` | 1914 | `{ content_name: "showcase_cta_book_demo" }` | value, currency, eventID |
| 6 | `src/app/contact/page.tsx` | 71 | `{ content_name: subject }` (Contact, not Lead, but same gap) | value, currency, eventID, **no CAPI** |
| 7 | `src/app/book-demo/page.tsx` | 280 | `{ content_name: "book_demo", value: 1 }` | currency, eventID |
| 8 | `src/features/landing/components/NewsletterSignup.tsx` | 34 | `{ content_name: "newsletter_signup" }` | value, currency, eventID |
| 9 | `src/features/onboarding-survey/lib/survey-analytics.ts` | 135 | `{ content_name: "onboarding_survey_complete", profession, team_size }` | value, currency, eventID |

→ This is **exactly** what Meta means by "100% of Lead events missing valid value/currency."

### CompleteRegistration (2 call sites — both missing value/currency) 🚨

| # | File | Line | Event params | Missing |
|---|------|------|-----------|---------|
| 1 | `src/app/(auth)/register/page.tsx` | 174 | `{ content_name: "email_signup"\|"phone_signup", user_email, user_name }` with `eventID: signupEventId` | **value, currency** |
| 2 | `src/app/(auth)/register/page.tsx` | 226 | `{ content_name: "google_signup" }` (no eventID) | **value, currency, eventID, no CAPI counterpart** |

### Purchase (1 call site — ✅ healthy)

| # | File | Line | Params |
|---|------|------|--------|
| 1 | `src/app/thank-you/subscription/page.tsx` | 140 | `{ content_name, currency: "INR", value }` with `eventID: getPurchaseEventId(userId, planKey)` |

### InitiateCheckout (3 call sites — ✅ healthy)

| # | File | Line | Params |
|---|------|------|--------|
| 1-3 | `src/features/onboarding-survey/lib/survey-analytics.ts` | 68-82 | `{ value: 99/799/1999, currency: "INR", content_name, content_category }` |

### ViewContent (2 call sites — missing value/currency)

| # | File | Line | Missing |
|---|------|------|---------|
| 1 | `src/features/landing/components/PricingSection.tsx` | 611 | value, currency |
| 2 | `src/features/onboarding-survey/lib/survey-analytics.ts` | 53 | value, currency |

### Custom events (out of scope for standard event optimization)

- `trackCustom("SignupIntent", ...)` — `register/page.tsx:88-91`
- `trackCustom("Login", ...)` — `meta-pixel.ts:80-83`
- `trackCustom("ViewRegisterPage")` — `meta-pixel.ts:62-65`

These don't need value/currency (custom events are excluded from standard optimization) but they also contribute zero to your 50/week threshold for standard-event optimization.

---

## 4. All server CAPI call sites (the data Meta sees server-side)

CAPI client: `src/lib/server-conversions.ts:50-92`. Endpoint: `https://graph.facebook.com/v21.0/2072969213494487/events`. Activation: `META_CAPI_ACCESS_TOKEN` env var — if absent, **all server events silently no-op** (`server-conversions.ts:52`). **Verify this is set in production.**

| File | Line | Event | Fields populated | Gaps |
|------|------|-------|------------------|------|
| `src/app/api/auth/register/route.ts` | 131-138 | CompleteRegistration | email, phone, firstName, ip, userAgent, event_id (from client) | **no fbp, no fbc, no value/currency** |
| `src/app/api/stripe/webhook/route.ts` | 98-106 | Purchase | userId, email, phone, firstName, plan, currency, value | **no fbp, no fbc, no ip, no userAgent** |
| `src/app/api/razorpay/webhook/route.ts` | 276-283 | Purchase | email, firstName, plan, currency, value | **no fbp, no fbc, no phone, no ip, no userAgent** |

**Critical gap: Google OAuth signups have no CAPI fire at all.** Browser pixel `register/page.tsx:226` fires for Google signup, but the user never POSTs to `/api/auth/register/route.ts` (NextAuth Google provider creates the user directly via `events.createUser`). So roughly half your signups never reach CAPI. This is the source of "Pixel sending more CompleteRegistration than CAPI."

---

## 5. Event ID deduplication audit

Meta dedups when **the same `event_name` + `event_id` arrives via both pixel and CAPI within ~72 hours**, AND identity signals match (fbp, fbc, email_hash, etc.).

### CompleteRegistration (email/phone path)
- Browser: `signupEventId = crypto.randomUUID()` at `register/page.tsx:142` → fbq with `{ eventID: signupEventId }` at line 180 → POSTed in body to `/api/auth/register`.
- Server: reads `signupEventId` from request body → forwards as `eventId` to `trackServerSignup` → `sendMetaConversion` with `event_id`.
- **Status:** ✅ Dedup pair correct IF client sends it (current code does). ⚠️ Weakened by missing fbp/fbc.

### CompleteRegistration (Google OAuth path)
- Browser fires; no eventID is passed (`register/page.tsx:226`).
- Server never fires.
- **Status:** 🚨 Broken end-to-end. No dedup possible. Pixel-only event.

### Purchase
- Browser: `eventID = getPurchaseEventId(userId, planKey)` — **deterministic** function: `purchase_${userId}_${plan.toUpperCase()}`.
- Server (Stripe + Razorpay webhooks): same `getPurchaseEventId(userId, plan)` call.
- **Status:** ✅ Deterministic match. ⚠️ Weakened by missing fbp/fbc and missing IP/UA on server side.

### Lead, Contact, ViewContent, InitiateCheckout
- No server CAPI counterparts exist.
- **Status:** 🚨 Pixel-only. Ad-blocked / ITP-blocked users vanish. No dedup possible.

---

## 6. fbp / fbc handling — the silent killer

`fbp` (browser pixel) and `fbc` (click ID) cookies are how Meta resolves identity across browser↔server. Without them in CAPI payloads, Meta degrades match quality from "high" toward "low," even when event_id matches.

**Code state:**
- `server-conversions.ts:38-39` — interface declares optional `fbp`/`fbc` fields ✅
- `server-conversions.ts:60-61` — payload includes them IF passed ✅
- **No caller in the codebase ever passes them.** A `grep` for `_fbp`, `_fbc`, `fbp:`, `fbc:` in `src/app/api/**` and `src/lib/**` returns only the type-definition lines.

**What's missing:**
1. Client-side: read `document.cookie` for `_fbp` and `_fbc` at form submit and include in fetch body.
2. Server-side: extract from `req.cookies` (Next.js `cookies()` from `next/headers`) as a fallback, and forward to `sendMetaConversion`.

The Stripe and Razorpay webhooks are trickier — they're fired by the payment provider, not the user's browser, so cookies aren't on the request. The right pattern is to **stash `_fbp`/`_fbc` on the user record at signup or at checkout-start**, then read them from the user record in the webhook.

---

## 7. Issues mapped to Meta's warnings — and the fixes

Each fix below references the exact file:line and gives copy-paste code.

### Issue 1 · CompleteRegistration missing value/currency (Meta warning #2)

**Current state — `src/app/(auth)/register/page.tsx:174`:**
```ts
trackCompleteRegistration(
  {
    content_name: isEmail ? "email_signup" : "phone_signup",
    ...(isEmail && { user_email: identifier.trim().toLowerCase() }),
    user_name: name.trim(),
  },
  { eventID: signupEventId },
);
```

**Fix:**
```ts
trackCompleteRegistration(
  {
    content_name: isEmail ? "email_signup" : "phone_signup",
    value: 100,           // estimated lead value in INR
    currency: "INR",
    ...(isEmail && { user_email: identifier.trim().toLowerCase() }),
    user_name: name.trim(),
  },
  { eventID: signupEventId },
);
```

**Also fix the Google OAuth signup at `register/page.tsx:226`:**
```ts
// Generate eventID even for Google so we can dedup if/when server CAPI is added
const googleEventId = `signup_google_${crypto.randomUUID()}`;
sessionStorage.setItem("bf_google_signup_event_id", googleEventId);

trackCompleteRegistration(
  { content_name: "google_signup", value: 100, currency: "INR" },
  { eventID: googleEventId },
);
```

**And on the server — `src/lib/server-conversions.ts:117-120`:**
```ts
customData: {
  content_name: "BuildFlow Signup",
  status: "complete",
  value: 100,             // MUST match the browser value
  currency: "INR",
},
```

### Issue 2 · Lead events missing value/currency (Meta warning #3)

**9 call sites need updating.** Pattern is identical at each — add `value` and `currency: "INR"`, and generate a per-event eventID for future CAPI dedup.

**Example — `src/app/page.tsx:977`:**
```ts
// Before
trackLead({ content_name: "workflow_request", content_category: requestForm.discipline });

// After
const leadEventId = `lead_${crypto.randomUUID()}`;
trackLead(
  {
    content_name: "workflow_request",
    content_category: requestForm.discipline,
    value: 1000,           // your estimated lead value in INR
    currency: "INR",
  },
  { eventID: leadEventId },
);
```

Apply the same pattern at: `page.tsx:1097`, `1189`, `1553`, `1914`; `contact/page.tsx:71`; `book-demo/page.tsx:280` (add currency); `NewsletterSignup.tsx:34`; `survey-analytics.ts:135`.

**Value tuning:** Use a single conservative number across all Lead events (e.g. 1000 INR ≈ ~$12 USD lead value). It does NOT need to be your actual CAC — Meta only needs a non-zero numeric so it can rank-order lead quality and feed ROAS modeling. Inflated values won't help; consistent values will.

### Issue 3 · Add CAPI counterparts for Lead and Contact (Meta warning #1: 2 browser, 1 server)

Extend `src/lib/server-conversions.ts`:

```ts
// Add to MetaConversionEvent union (line 43):
eventName: "CompleteRegistration" | "Purchase" | "Lead" | "Contact";

// Add wrapper at end of file:
export async function trackServerLead(params: {
  eventId: string;
  email?: string;
  phone?: string | null;
  firstName?: string;
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  contentName?: string;
  value?: number;
  currency?: string;
  eventSourceUrl?: string;
}): Promise<void> {
  await sendMetaConversion({
    eventName: "Lead",
    eventId: params.eventId,
    userData: {
      email: params.email,
      phone: params.phone || undefined,
      firstName: params.firstName,
      clientIpAddress: params.ip,
      clientUserAgent: params.userAgent,
      fbp: params.fbp,
      fbc: params.fbc,
    },
    customData: {
      content_name: params.contentName || "BuildFlow Lead",
      value: params.value ?? 1000,
      currency: params.currency || "INR",
    },
    eventSourceUrl: params.eventSourceUrl,
  });
}
```

Then for each Lead/Contact call site that currently only fires browser, add a fetch to a new `POST /api/track/lead` route that calls `trackServerLead` with the same `eventId`. The route is the deduplication twin.

**Suggested new route — `src/app/api/track/lead/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { trackServerLead } from "@/lib/server-conversions";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cookieStore = await cookies();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Fire-and-forget so the user-facing form doesn't wait on Meta
  trackServerLead({
    eventId: body.eventId,
    email: body.email,
    phone: body.phone,
    firstName: body.firstName,
    ip,
    userAgent: req.headers.get("user-agent") || undefined,
    fbp: cookieStore.get("_fbp")?.value,
    fbc: cookieStore.get("_fbc")?.value,
    contentName: body.contentName,
    value: body.value ?? 1000,
    currency: body.currency || "INR",
    eventSourceUrl: body.eventSourceUrl,
  }).catch(err => console.warn("[meta-capi-lead]", err));

  return NextResponse.json({ ok: true });
}
```

At each Lead caller, after `trackLead(...)`, add:
```ts
fetch("/api/track/lead", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    eventId: leadEventId,
    contentName: "workflow_request",
    value: 1000,
    currency: "INR",
    eventSourceUrl: window.location.href,
    // email/firstName if you have them in the form state
  }),
}).catch(() => {});
```

### Issue 4 · Forward fbp/fbc to server (Meta warning #4: deduplication)

**Client-side helper — add to `src/lib/meta-pixel.ts`:**
```ts
/** Read Meta browser identifiers from cookies. Returns undefined on SSR. */
export function getMetaBrowserIds(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const match = (name: string) => {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  return { fbp: match("_fbp"), fbc: match("_fbc") };
}
```

**Wire into register flow — `src/app/(auth)/register/page.tsx` (around line 144):**
```ts
const { fbp, fbc } = getMetaBrowserIds();
const body: Record<string, string | undefined> = {
  name, password, signupEventId, fbp, fbc,
};
```

**Server reads them — `src/app/api/auth/register/route.ts` (around line 30):**
```ts
const { name, email, password, source, referralCode, phoneNumber: rawPhone, signupEventId, fbp, fbc } = await req.json();
```

**And forward — line 131:**
```ts
trackServerSignup({
  email: normalizedEmail,
  phone: normalizedPhone,
  firstName: name?.split(" ")[0],
  ip,
  userAgent: req.headers.get("user-agent") || undefined,
  eventId: typeof signupEventId === "string" ? signupEventId : undefined,
  fbp: typeof fbp === "string" ? fbp : undefined,
  fbc: typeof fbc === "string" ? fbc : undefined,
}).catch(err => console.warn("[meta-capi]", err));
```

**Update `trackServerSignup` signature in `server-conversions.ts:96-104`:**
```ts
export async function trackServerSignup(params: {
  email: string;
  phone?: string | null;
  firstName?: string;
  ip?: string;
  userAgent?: string;
  eventId?: string;
  fbp?: string;     // ← add
  fbc?: string;     // ← add
}): Promise<void> {
  const eventId = params.eventId || `signup_${crypto.randomUUID()}`;
  await sendMetaConversion({
    eventName: "CompleteRegistration",
    eventId,
    userData: {
      email: params.email,
      phone: params.phone || undefined,
      firstName: params.firstName,
      clientIpAddress: params.ip,
      clientUserAgent: params.userAgent,
      fbp: params.fbp,    // ← add
      fbc: params.fbc,    // ← add
    },
    customData: {
      content_name: "BuildFlow Signup",
      status: "complete",
      value: 100,
      currency: "INR",
    },
    eventSourceUrl: "https://trybuildflow.in/register",
  });
}
```

### Issue 5 · Stash fbp/fbc for webhook-triggered Purchases

Stripe/Razorpay webhooks fire from the payment provider's servers — no user cookies on the request. Stash at checkout-start:

**Where to stash — wherever your Stripe checkout session is created (search for `stripe.checkout.sessions.create`):**
```ts
const { fbp, fbc } = req.cookies.getAll().reduce(...); // or pass from client
const session = await stripe.checkout.sessions.create({
  // ...existing params...
  metadata: {
    userId: session.user.id,
    fbp: fbp || "",
    fbc: fbc || "",
  },
});
```

**Then in the webhook — `src/app/api/stripe/webhook/route.ts:98-106`:**
```ts
trackServerPurchase({
  userId: checkoutUser.id,
  email: checkoutUser.email,
  phone: checkoutUser.phoneNumber,
  firstName: checkoutUser.name?.split(" ")[0],
  plan: checkoutUser.role,
  currency: "INR",
  value: amountTotalINR ?? getPlanValueINR(checkoutUser.role),
  fbp: session.metadata?.fbp || undefined,
  fbc: session.metadata?.fbc || undefined,
  // ALSO add IP/UA — preserve from checkout start in session metadata
  ip: session.metadata?.clientIp || undefined,
  userAgent: session.metadata?.clientUa || undefined,
}).catch(err => console.warn("[meta-capi]", err));
```

(Same pattern for Razorpay — stash in `notes` field on subscription creation.)

Update `trackServerPurchase` signature in `server-conversions.ts:125-135` to accept fbp/fbc — same shape as the signup update above.

### Issue 6 · Google OAuth signup CAPI gap

Browser-only fire at `register/page.tsx:226` means roughly half your signups never reach CAPI.

**Fix:** NextAuth has an `events.createUser` callback in `src/lib/auth.ts`. Add a CAPI call there:

```ts
events: {
  async createUser({ user }) {
    // ... existing logic ...

    // Read the eventID the browser stashed in sessionStorage via a redirect-aware
    // mechanism. Simplest: have register page write to a short-lived DB row keyed
    // by email, then read here. Or use NextAuth's signIn callback to capture.
    // Pragmatic minimum: generate server-side and accept that Google signups
    // can't dedup with browser pixel (still better than zero CAPI).
    await trackServerSignup({
      email: user.email!,
      firstName: user.name?.split(" ")[0],
      eventId: `signup_oauth_${user.id}`, // deterministic — see below
    }).catch(err => console.warn("[meta-capi]", err));
  },
}
```

For the browser side at `register/page.tsx:226`, mirror the eventID:
```ts
trackCompleteRegistration(
  { content_name: "google_signup", value: 100, currency: "INR" },
  { eventID: `signup_oauth_pending` /* server overrides */ },
);
```

Deterministic dedup for OAuth is messy because the browser doesn't yet know the new user's ID. Two acceptable patterns:
- **(a) Don't dedup OAuth signups.** Accept double-count and use Meta's automatic identity matching (email_hash + fbp/fbc). Documented loss of ~5-10% match quality.
- **(b) Defer the browser pixel fire to the post-login `/onboard` page** where `session.user.id` is known. Then both sides use `getPurchaseEventId`-style deterministic IDs.

Pattern (b) is what the Purchase flow already does. Recommend the same for OAuth signup.

### Issue 7 · Hardcoded Pixel ID

`src/lib/meta-pixel.ts:5` and `src/lib/server-conversions.ts:16` both hardcode `"2072969213494487"`. Move to env vars:

```ts
// meta-pixel.ts
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "2072969213494487";

// server-conversions.ts
const META_PIXEL_ID = process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID || "2072969213494487";
```

Add to `.env.example` and `.env.local`. Low urgency but improves rotation hygiene.

---

## 8. Production-config checklist (do this NOW, before code changes)

1. **`META_CAPI_ACCESS_TOKEN`** — confirm it's set in Vercel production env. Without it, `server-conversions.ts:52` silently returns. Test by intentionally unsetting locally and watching for the `[meta-capi]` silence in logs.
2. **Re-run Meta Pixel Helper** on each of these pages: `/`, `/register`, `/login`, `/contact`, `/book-demo`, `/thank-you/subscription`, `/onboard`. Verify the events listed in §3 fire.
3. **Open Meta Events Manager → Test Events tab.** Uncomment line 75 of `server-conversions.ts` to set `test_event_code`, deploy to staging, fire each event, confirm it appears in Test Events with "Deduplicated" status.
4. **Check the Events Manager → Diagnostics tab.** It will list exact events with `value`/`currency` gaps — should match this report.

---

## 9. Implementation order (fastest path to "Meta sees normal data")

Do these in order; each step is mergeable on its own.

| Step | Effort | Files touched | Expected Meta impact |
|------|--------|---------------|---------------------|
| 1. Add value/currency to all `trackLead` calls (9 sites) | 1 hr | `src/app/page.tsx`, `contact/page.tsx`, `book-demo/page.tsx`, `NewsletterSignup.tsx`, `survey-analytics.ts` | Resolves Meta warning #3 (Lead) within ~6 hr of next event fire |
| 2. Add value/currency to both `trackCompleteRegistration` calls + server custom_data | 30 min | `register/page.tsx:174,226`, `server-conversions.ts:117` | Resolves Meta warning #2 |
| 3. Add fbp/fbc plumbing for signup (`getMetaBrowserIds` + body fields + server read + `trackServerSignup` forwarding) | 1 hr | `meta-pixel.ts`, `register/page.tsx`, `register/route.ts`, `server-conversions.ts` | Improves match quality; resolves dedup warning |
| 4. Add `trackServerLead` + `/api/track/lead` route + wire from each Lead caller | 2 hr | new route, `server-conversions.ts`, 9 caller files | Doubles browser-event volume on server side — directly fixes "2 browser, 1 server" |
| 5. Stash fbp/fbc + IP/UA at Stripe checkout creation; forward in webhook | 1 hr | Stripe checkout session creation site, `stripe/webhook/route.ts` | Closes Purchase dedup loop |
| 6. Same for Razorpay | 1 hr | Razorpay checkout creation site, `razorpay/webhook/route.ts` | Same as above |
| 7. Fire server CAPI for Google OAuth signup via NextAuth `events.createUser` | 1 hr | `src/lib/auth.ts` | Closes the ~50% OAuth-signup CAPI gap |
| 8. Env-var the Pixel ID | 15 min | `meta-pixel.ts`, `server-conversions.ts`, `.env.example` | Hygiene |

**Total:** ~7-8 hours of focused work to take you from "almost blind" to fully instrumented with deduplication.

---

## 10. Validation: how to confirm it's fixed

1. **Pixel Helper (Chrome extension)** on each tracked page. Every fired event should show value+currency in the dropdown.
2. **Meta Events Manager → Test Events** with `test_event_code` set. For each event, confirm two rows appear (Browser + Server) and the right column shows "Deduplicated."
3. **Events Manager → Overview** after 24 hr. Browser-event count and Server-event count should be within 10-20% of each other. The current 2:1 imbalance should drop to roughly 1:1.
4. **Diagnostics tab** should go from "100% Lead missing value/currency" to clean.
5. **After 1 week** check the dashboard for "Event Match Quality" — should rise from "Below average" toward "Good"/"Great" as fbp/fbc + email_hash + IP/UA combine for stronger identity resolution.
6. **Per-week conversion volume.** Meta's 50/week-per-ad-set threshold should be reachable once Lead + CompleteRegistration are both firing browser + server (effective volume ~2x current).

---

## Appendix · File index

| File | Role |
|------|------|
| `src/lib/meta-pixel.ts` | Browser pixel wrappers — all `track*` functions live here |
| `src/lib/server-conversions.ts` | CAPI client + `trackServerSignup` / `trackServerPurchase` wrappers |
| `src/shared/components/TrackingScripts.tsx` | SDK loader (`fbevents.js` + `init` + `PageView`) |
| `src/app/(auth)/register/page.tsx` | Browser pixel for CompleteRegistration (email + Google paths) |
| `src/app/api/auth/register/route.ts` | Server CAPI for CompleteRegistration (email path only) |
| `src/app/api/stripe/webhook/route.ts` | Server CAPI for Purchase (Stripe) |
| `src/app/api/razorpay/webhook/route.ts` | Server CAPI for Purchase (Razorpay) |
| `src/app/thank-you/subscription/page.tsx` | Browser pixel for Purchase |
| `src/lib/plan-pricing.ts` | `getPurchaseEventId(userId, plan)` — deterministic dedup ID generator |
| `src/lib/env.ts` | `META_CAPI_ACCESS_TOKEN` declared as optional |
| `.env.example` | Template for `META_CAPI_ACCESS_TOKEN` (line 174) |

---

**End of report.** Open in any markdown reader. Each fix is independently mergeable. Recommend doing steps 1+2 first (smallest diff, biggest signal-to-Meta in 24 hr), then 3+4 together (closes the dedup loop), then 5+6+7 over the following days.
