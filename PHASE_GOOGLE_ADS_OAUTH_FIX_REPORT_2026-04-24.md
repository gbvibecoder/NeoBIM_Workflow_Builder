# Google Ads Signup Conversion — OAuth Premature-Fire Fix

**Date:** 2026-04-24
**Branch:** main (no commits, per instruction — Rutik handles git)
**Scope:** Fix Google OAuth signup conversion firing on button click (pre-OAuth) instead of on post-OAuth new-user confirmation.

---

## 1. PHASE A — Audit findings

### Onboard route
- **Path:** `/onboard` → `src/app/onboard/page.tsx`
- **Type:** **Server Component** (`async function OnboardPage()`)
- **Nested layout:** `src/app/onboard/layout.tsx` (passthrough — just sets metadata)
- `export const dynamic = "force-dynamic"` — always SSR, never prerendered
- Body calls `await auth()` then queries `prisma.userSurvey` to decide whether to render `<SurveyShell />` or redirect

### Returning-user routing to `/onboard`
Per `src/app/onboard/page.tsx`:

| User state on arrival | Server-side action | Does `/onboard` HTML reach the browser? |
|---|---|---|
| No session | `redirect("/login?callbackUrl=/onboard")` | No |
| Session + `UserSurvey.completedAt` or `skippedAt` set | `redirect("/dashboard")` | No |
| Session + `UserSurvey` missing OR incomplete | Renders `<SurveyShell />` | **Yes** |

**Consequence:** Returning Google users who never finished the onboarding survey CAN reach `/onboard`. A `sessionStorage`-only strategy would fire for them when they come back via `/register → Continue with Google → existing account`. Double-gate is required.

### Auth.js `isNewUser` exposure on the client
- Current session shape (from `src/lib/auth.config.ts:23-39`): `{ id, email, name, image, role, emailVerified, phoneNumber, phoneVerified }`.
- `createdAt` is **not** on the session. Not exposed via Auth.js callbacks.
- Auth.js v5 does offer `isNewUser` on `events.signIn`, but it is redundant once `events.createUser` is used (which fires ONLY for new users).
- Adding `createdAt` to the session would require editing `auth.config.ts` / `auth.ts` JWT + session callbacks and reshape the runtime `Session` type — larger blast radius than a single cookie.

### Current `events.createUser` / `events.signIn` handlers in `auth.ts`
- **`events.createUser`: NOT CONFIGURED** (no `events` block in `src/lib/auth.ts` prior to this PR)
- **`events.signIn`: NOT CONFIGURED**
- There is a `callbacks.signIn` at `src/lib/auth.ts:103-112` which fires on every sign-in (returning + new) and calls `trackLogin(user.id)` from `@/lib/analytics` (internal JSONL analytics, NOT Google Ads).

### Login page
- `src/app/(auth)/login/page.tsx`: imports `trackLogin` (not signup-related), no `trackAdsConversion` call, no `sign_up_complete` datalayer push. **Already safe; regression guard passes.**

---

## 2. Strategy chosen

**PREFERRED: server-set cookie + client sessionStorage double-gate.**

### Justification
1. **sessionStorage alone is unsafe** — returning users who haven't finished the survey land on `/onboard` and the onboard component would fire on them if they originated from `/register → Continue with Google` (see Returning-user routing table above).
2. **Session `createdAt` fallback rejected** — field not on the session; adding it would require editing `auth.config.ts` and two JWT/session callbacks (broader scope than a cookie).
3. **`events.createUser` is the authoritative signal** — with JWT session strategy + `PrismaAdapter`, it fires **exclusively** when a new user row is inserted. Credentials signups go through `/api/auth/register` with direct Prisma calls and do NOT trigger the adapter, so there is zero risk of the cookie firing for credentials signups (whose Google Ads conversion is already fired server-confirmed on the email/phone path, unchanged by this PR).

### Gate logic
Both conditions must hold at `/onboard` mount for the conversion to fire:

| Gate | Source | What it proves |
|---|---|---|
| `sessionStorage["pending_google_signup_conversion"] === "1"` | set by `/register` "Continue with Google" handler | user originated from the signup CTA, not `/login` |
| `document.cookie` has `bf_signup_just_created=1` | set by `events.createUser` in `src/lib/auth.ts` | PrismaAdapter just created a NEW user row |

Both gates are cleared on read (sessionStorage via `removeItem`, cookie via `Max-Age=0`) so refresh / back-navigation cannot replay the fire.

---

## 3. Files edited + line counts

| File | Status | Lines |
|---|---|---|
| `src/app/(auth)/register/page.tsx` | modified | +6 / -8 |
| `src/lib/auth.ts` | modified | +25 / -0 |
| `src/app/onboard/page.tsx` | modified | +7 / -1 |
| `src/app/onboard/GoogleAdsSignupFire.tsx` | **new** | 54 lines |

Files NOT touched (per strict scope): `login/page.tsx`, `thank-you/subscription/page.tsx`, `lib/meta-pixel.ts`, `lib/gtm.ts`, `lib/server-conversions.ts`, `api/auth/register/route.ts`, `TrackingScripts.tsx`, `layout.tsx`, `.env.example`, `middleware.ts`, `next.config.ts`, any stripe/razorpay file, any IFC/VIP/enhance file.

---

## 4. Verification outputs

### `npx tsc --noEmit`
```
(exit code 0, no output)
```

### `npx eslint` on the 4 changed files
```
/Users/rutikerole/NeoBIM_Workflow_Builder/src/app/(auth)/register/page.tsx
  47:9  warning  'router' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```
Single warning is **pre-existing** on `main` (unused `router` variable added in an earlier refactor, unrelated to this change).

### `npm run build` (last 10 lines)
```
├ ○ /reset-password
├ ƒ /share/[slug]
├ ○ /sitemap.xml
├ ○ /templates
├ ● /templates/[slug]
├ ○ /terms
├ ○ /thank-you/subscription
├ ○ /verify-email
└ ○ /workflows

ƒ Proxy (Middleware)
```
Exit code 0. `/register` still compiles as `○ (Static)`, `/onboard` correctly compiles as `ƒ (Dynamic)` (expected — it uses `auth()` at request time).

### SSR smoke test (dev server, curl + grep)

```
=== /register ===
Has sign_up_complete+method:google in HTML (should=0):   0   ← previously would contain this, now removed
Has AW-18089516768 (root layout):                        1   ← tracking infra untouched
Has GTM-MD563HH5:                                        2
Has 'Continue with Google' button:                       1   ← functional UI intact

=== /login ===
Has trackAdsConversion reference:                        0
Has sign_up_complete:                                    0
Has AW-18089516768:                                      1
Has GTM-MD563HH5:                                        2

=== / (landing) ===
Has AW-18089516768:                                      1
Has gtag/js loader URL:                                  1
Has GTM-MD563HH5:                                        2
Has ad_storage denied (Consent Mode v2):                 2
```

---

## 5. Diff excerpt — email/phone path UNCHANGED

Source-verified via grep on `src/app/(auth)/register/page.tsx`:

```
11:import { trackAdsConversion, trackCompleteRegistration, trackRegisterPageView } from "@/lib/meta-pixel";
155:      // this conversion event using transaction_id as the join key.
158:        trackAdsConversion(signupAdsLabel, {
159:          transaction_id: signupEventId,
197:      sessionStorage.setItem("pending_google_signup_conversion", "1");
```

The `trackAdsConversion(signupAdsLabel, { transaction_id: signupEventId })` call on the email/phone path remains at lines 158-160, completely untouched. The `transaction_id: signupEventId` param is preserved for Enhanced Conversions join.

`git diff` of the register page shows the only change is inside the `handleGoogle()` handler — 8 lines removed (premature datalayer push + premature trackAdsConversion + their comment block), 6 lines added (new comment + `sessionStorage.setItem`).

---

## 6. Risks / regressions considered

| Risk | Mitigation |
|---|---|
| **Returning Google user lands on `/onboard`** (didn't finish survey first time) | Cookie gate fails — `events.createUser` only fires for NEW user rows. Sessions for returning users do not trigger the adapter's createUser, so `bf_signup_just_created` is absent → no fire. |
| **User cancels at Google consent screen** | Both gates fail: no cookie is set (no createUser event), and sessionStorage flag just sits there unread. Next time the user reaches `/onboard` via any other path, the flag is cleared unconditionally on mount (before the fire check), so it can't leak into a future session. |
| **Refresh on `/onboard`** | Fire component's `useEffect` clears both gates on first mount. On refresh, both gates are already cleared → no duplicate fire. |
| **User closes tab before `/onboard` loads** | sessionStorage is scoped to the tab — closing the tab discards the flag automatically. Cookie expires after 120s. Neither can leak into a future session. |
| **Ad blocker strips client gtag** | Acceptable degraded path — `trackAdsConversion()` is a no-op when `window.gtag` is missing (guard at `src/lib/meta-pixel.ts:92`). Meta CAPI server-side signup tracking in `src/app/api/auth/register/route.ts:131` is unaffected (credentials path only). Google Ads modeled conversions from Consent Mode v2 cookieless pings still provide baseline signal. |
| **Credentials signup accidentally sets the cookie** | Cannot happen — credentials users are created by `/api/auth/register` via direct `prisma.user.create()`, which bypasses the PrismaAdapter. `events.createUser` never fires for them. Verified by reading the credentials flow in `auth.ts` and `/api/auth/register/route.ts`. |
| **User signs in via `/register → Google` with an existing account** | sessionStorage flag set, but Google returns an existing user → no createUser event → no cookie → gate fails → no fire. Correct. |
| **User signs up via `/register → Google` (new account)** | Both gates pass: flag is set pre-redirect, cookie is set by events.createUser during callback processing, both present on `/onboard` mount → fires once, both cleared. Correct. |
| **`cookies().set()` throwing outside request context** | Wrapped in try/catch — sign-in never blocks on cookie failure. Worst case: the conversion doesn't fire (same as ad-blocker outcome). |
| **Cookie readable by other scripts on same origin** | Accepted tradeoff — `HttpOnly: false` is required so the client component can read it. Value is a dumb `"1"` flag with no sensitive info; leaking it only allows a malicious script to… not fire a Google Ads conversion. No auth material or PII in the cookie. |
| **Cookie Max-Age=120 too short if OAuth bounces slowly** | 120s is 4x typical Google OAuth redirect+callback roundtrip (~15-30s). If Google is unusually slow (>2min), we lose one conversion attribution — acceptable edge-case cost vs. unbounded replay window. |

---

## 7. What marketing/ops still needs (unchanged from previous PR)

The conversion label env var `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL` must still be set in `.env.local` (documented in `.env.example` from commit `1948ad4`). Until it is, the `trackAdsConversion` call inside `GoogleAdsSignupFire` is a no-op — but the gate logic still runs cleanly and the flags still clear, so adding the label later is zero-code-change.

---

## 8. Summary

- **The bug**: Google OAuth signup conversion was firing on the `/register` Continue-with-Google button click, counting cancels, errors, and returning users as signups. Shipped in commit `1948ad4`.
- **The fix**: Strip the two premature fires (`pushToDataLayer("sign_up_complete", { method: "google" })` and `trackAdsConversion(signupAdsLabel)`), defer to `/onboard`, gate the deferred fire on (a) a sessionStorage flag proving the user came from the signup CTA, and (b) an httpOnly=false cookie set by Auth.js `events.createUser` proving the PrismaAdapter just created a new user row.
- **Scope discipline**: Email/phone signup path, purchase conversion, login page, Meta Pixel helpers, CAPI server-side, and the whole tracking infrastructure are untouched.
- **Verification**: tsc 0 errors, eslint 0 errors, production build clean, SSR smoke test confirms the premature fires are gone from `/register` HTML and the root-layout tracking stack (`AW-18089516768`, `GTM-MD563HH5`, Consent Mode v2) is intact on every public page including `/register`, `/login`, `/`.
- **No commits, no pushes, no branch creation.** Changes sit in the working tree on `main` awaiting Rutik's review.
