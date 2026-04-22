# Marketing / Tracking / Analytics Inventory

**Scope:** everything fires-, reports-, or captures-related in the trybuildflow.in codebase, after the `feat/attribution-v2` branch is merged.
**Audience:** founder (decision-maker) + marketing manager (implementer). Forwardable to manager as-is.
**Evidence rule:** every row below is backed by a `file:line` reference. If a claim lacks one, it's not in this doc.
**What this doc won't tell you:** what's configured inside the Google Tag Manager container (that lives on Google's servers, not in this repo). Section 11 lists what we can and cannot verify.

---

## Section 1 — Platforms Installed

| Platform | Purpose | Status | Location in Code | Env Var Required | Notes |
|---|---|---|---|---|---|
| Google Tag Manager | Loads every other tag configured inside the container (GA4, Ads, LinkedIn, etc.) | ✅ LIVE when `NEXT_PUBLIC_GTM_ID` set | `src/shared/components/TrackingScripts.tsx:25-35`, noscript iframe at `src/app/layout.tsx:276-285` | `NEXT_PUBLIC_GTM_ID` (e.g. `GTM-MD563HH5`) | What the container actually fires is NOT visible from code — Section 11. |
| Google Ads (gtag.js) | Conversion tracking via `gtag('event','conversion',...)` | 🟡 DARK — loaded + base tag firing pageviews, but NO conversion events fire until the kill switch flips | `TrackingScripts.tsx:86-101`, conversion helper at `src/lib/meta-pixel.ts:108-125` | `NEXT_PUBLIC_GOOGLE_ADS_ID` (e.g. `AW-18089516768`), `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL`, `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` | Kill switch defaults to `"false"` in `.env.example:204`. |
| Google Analytics 4 | Pageviews, funnels, audiences | ✅ LIVE when `NEXT_PUBLIC_GA_MEASUREMENT_ID` set (script loaded + `gtag config`) | `TrackingScripts.tsx:67-83` | `NEXT_PUBLIC_GA_MEASUREMENT_ID` (e.g. `G-XXXXXXXXXX`) | Also receives SPA `page_view` events on route change (`UTMCapture.tsx:31`). |
| Meta Pixel (browser) | Facebook / Instagram ads attribution via `fbq('track', ...)` | ✅ LIVE — pixel ID hardcoded, fires PageView + CompleteRegistration + Purchase + Lead + Contact + ViewContent + Login | `TrackingScripts.tsx:37-52` (init), all `fbq` calls in `src/lib/meta-pixel.ts` | Pixel ID **hardcoded** at `src/lib/meta-pixel.ts:5` (`2072969213494487`). ⚠️ |  |
| Meta Conversions API (server) | Server-side mirror of browser pixel, bypasses adblockers | ✅ LIVE when `META_CAPI_ACCESS_TOKEN` set. Fires for CompleteRegistration + Purchase with event_id dedup | `src/lib/server-conversions.ts:50-92` (core), 96-123 (signup), 125-155 (purchase) | `META_CAPI_ACCESS_TOKEN` | Silent skip if token unset (`server-conversions.ts:52`). Pixel ID + API version hardcoded `server-conversions.ts:16-17`. ⚠️ |
| Microsoft Clarity | Heatmaps, session recordings, user behaviour | ✅ LIVE when `NEXT_PUBLIC_CLARITY_PROJECT_ID` set | `TrackingScripts.tsx:55-65` | `NEXT_PUBLIC_CLARITY_PROJECT_ID` | Script-only — no explicit fires from our code. |
| Sentry | Error + performance monitoring | ⚠️ CONDITIONAL — only initialized when `NEXT_PUBLIC_SENTRY_DSN` set | `next.config.ts` (Sentry wrapper) + `src/lib/env-check.ts` | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Config wrapping is conditional (per CLAUDE.md). |
| Internal analytics (JSONL logs) | Server-side event log for founder-facing dashboard metrics | ⚠️ DEGRADED — writes to `analytics-logs/events-<date>.jsonl` on local filesystem, **does not survive Vercel deploys** | `src/lib/analytics.ts:141-154` | none | See Section 9 — not a replacement for paid-ad attribution. |
| Internal event queue (client→server) | Batched client events POSTed to `/api/analytics` → `trackEvent` → JSONL | ⚠️ DEGRADED — same fate as above | `src/lib/track.ts`, endpoint `src/app/api/analytics/route.ts:8-41` | none | Fires `workflow_executed`, `node_used`, `regeneration_used`. Non-critical. |

**Kill-switch status icon legend:** ✅ LIVE and firing · ⚠️ CONFIGURED BUT DEGRADED · 🟡 DARK (code ready, env toggle off) · ❌ CODE READY, NO ENV VAR SET · ❌ NOT INSTALLED

---

## Section 2 — Conversion Events Matrix

Grouped by funnel stage. `Goes To` columns: **GTM** = pushed to `window.dataLayer` for any GTM-configured tag; **Meta Px** = `fbq` browser pixel; **Meta CAPI** = server-to-Meta HTTP; **GA gtag** = direct `window.gtag('event',...)`; **Google Ads** = `gtag('event','conversion',...)`.

### 2.1 Page / View events

| Event | Fires Where | Fires When | GTM | Meta Px | Meta CAPI | GA gtag | Google Ads | Dedup event_id | Status | File:Line |
|---|---|---|---|---|---|---|---|---|---|---|
| `PageView` | `TrackingScripts.tsx:50` | Initial page load | — | ✅ | — | — | — | — | ✅ LIVE | `TrackingScripts.tsx:50` |
| `PageView` (SPA nav) | `UTMCapture.tsx:36` | Every client-side route change | — | ✅ | — | — | — | — | ✅ LIVE | `UTMCapture.tsx:36` |
| `page_view` (gtag) | `UTMCapture.tsx:31` | Every client-side route change | via gtag | — | — | ✅ | — | — | ✅ LIVE (when GA4 env set) | `UTMCapture.tsx:31-36` |
| `ViewRegisterPage` (fbq custom) | `meta-pixel.ts:64` | Register page mount | ✅ `view_register_page` | ✅ | — | — | — | — | ✅ LIVE | called from `register/page.tsx:65` |
| `view_item` (dataLayer + fbq ViewContent) | `meta-pixel.ts:57-60` | Pricing-plan CTA click; template view | ✅ | ✅ | — | — | — | — | ✅ LIVE | `landing/components/PricingSection.tsx:606`, `onboarding-survey/lib/survey-analytics.ts:53` |

### 2.2 Signup events

| Event | Fires Where | Fires When | GTM | Meta Px | Meta CAPI | GA gtag | Google Ads | Dedup event_id | Status | File:Line |
|---|---|---|---|---|---|---|---|---|---|---|
| `CompleteRegistration` (email signup) | `useSignupConversions.ts:55` → `meta-pixel.ts:46` | After `POST /api/auth/register` 201 success on credentials path | ✅ `sign_up` | ✅ `CompleteRegistration` | ✅ (via `/api/auth/register` route) | — | 🟡 `fireGoogleAdsSignupConversion(eventId)` — kill-switched | ✅ `signup_<uuid>` | ✅ LIVE for pixel + CAPI · 🟡 DARK for Google Ads | `register/page.tsx:140-145`, hook at `useSignupConversions.ts:30-66` |
| `CompleteRegistration` (OAuth signup) | `OAuthSignupConversionFire.tsx:42` → `useSignupConversions.ts:55` | `/onboard` first mount after Google OAuth returns, guarded by `session.user.signupEventId` + `localStorage.bf_oauth_signup_fired_<userId>` | ✅ `sign_up` | ✅ `CompleteRegistration` | ✅ (via `events.createUser` in `auth.ts`) | — | 🟡 kill-switched | ✅ `signup_<uuid>` (generated in `auth.ts:143`) | ✅ LIVE for pixel + CAPI · 🟡 DARK for Google Ads | `OAuthSignupConversionFire.tsx:36-46`, `auth.ts:140-183`, mount in `onboard/page.tsx:50` |
| `sign_up_complete` (dataLayer) | `useSignupConversions.ts:64` | Piggy-backs on both signup paths above | ✅ `{method, event_id}` | — | — | — | — | ✅ same `signup_<uuid>` | ✅ LIVE | `useSignupConversions.ts:64` |
| Internal `user_signup` | `analytics.ts:97-99` | `/api/auth/register` route line 152 | — | — | — | — | — | N/A | ⚠️ writes to ephemeral JSONL | `api/auth/register/route.ts:152` |
| Meta CAPI `CompleteRegistration` (email) | `server-conversions.ts:96-123` via `trackServerSignup` | `/api/auth/register` route line 156 | — | — | ✅ | — | — | ✅ `signup_<uuid>` from client body | ✅ LIVE when `META_CAPI_ACCESS_TOKEN` set | `api/auth/register/route.ts:156` |
| Meta CAPI `CompleteRegistration` (OAuth) | `server-conversions.ts:96-123` via `trackServerSignup` | `events.createUser` in `auth.ts:175-180` | — | — | ✅ | — | — | ✅ server-generated `signup_<uuid>` | ✅ LIVE when `META_CAPI_ACCESS_TOKEN` set | `auth.ts:175-180` |
| **Enhanced Conversion data push** | `gtm.ts:48-62` via `pushEnhancedConversionData` | Both signup paths AND thank-you page, BEFORE conversion event | ✅ `enhanced_conversion_data` | — | — | — | Consumed by GTM's EC tag if configured | N/A | ✅ LIVE | `useSignupConversions.ts:36-38`, `thank-you/subscription/page.tsx:229-232` |
| **OAuth click-time Meta fire** | `register/page.tsx:182-186` (OLD) | ~~OAuth button click before Google redirect~~ | — | — | — | — | — | — | ❌ **REMOVED** in commit `ccc9ee7` — was firing on every cancelled OAuth | See comment at `register/page.tsx:181-187` |

### 2.3 Login events

| Event | Fires Where | Fires When | GTM | Meta Px | Meta CAPI | GA gtag | Google Ads | Status | File:Line |
|---|---|---|---|---|---|---|---|---|---|
| `Login` (fbq trackCustom) | `meta-pixel.ts:81-84` | Successful credentials login | ✅ `login` | ✅ | — | — | — | ✅ LIVE | `(auth)/login/page.tsx:170` |
| Internal `user_login` | `analytics.ts:101-103` | Every `signIn` callback success | — | — | — | — | — | ⚠️ JSONL log | `auth.ts:123` |
| **Google OAuth login** | — | — | — | — | — | — | — | ❌ NO CLIENT-SIDE LOGIN EVENT for OAuth. OAuth redirect leaves the page; login page's `trackLogin` never runs for Google users. | Gap in Meta funnel. |

### 2.4 Micro-conversions

| Event | Fires Where | Fires When | GTM | Meta Px | Meta CAPI | GA gtag | Google Ads | Dedup event_id | Status | File:Line |
|---|---|---|---|---|---|---|---|---|---|---|
| `first_execution_success` | `useExecution.ts:2096` | Server atomic gate — `prisma.user.updateMany({ where: { firstExecutionAt: null } })` returns 1. Exactly once per user, ever. | ✅ `{event_id, user_id_hash, node_count}` | — | — | — | ❌ not wired — no label env var yet | ✅ `first_exec_<userId>` | ✅ LIVE (dataLayer only) | server: `api/executions/[id]/route.ts:87-109`, client: `useExecution.ts:2088-2100` |
| `workflow_executed` (internal) | `track.ts:52`, via `/api/analytics` → `trackEvent` | Every workflow completion | — | — | — | — | — | N/A | ⚠️ JSONL log | called at `useExecution.ts:2107` |
| `workflow_first_created` (internal) | `analytics.ts:105-111` | `POST /api/workflows` on user's 1st workflow | — | — | — | — | — | N/A | ⚠️ JSONL log | `api/workflows/route.ts:165` |
| `execution_first_run` (internal) | `analytics.ts:113-119` | `POST /api/executions` on user's 1st execution | — | — | — | — | — | N/A | ⚠️ JSONL log — note: fires on execution START, not success | `api/executions/route.ts:109` |
| `survey_start` | `survey-analytics.ts:11` | Survey shell mount | ✅ | — | — | — | — | — | ✅ LIVE | `onboarding-survey/components/SurveyShell.tsx` |
| `survey_scene_view` | `survey-analytics.ts:18` | Each survey scene render | ✅ `{scene_number, scene_name}` | — | — | — | — | — | ✅ LIVE |  |
| `survey_scene_complete` | `survey-analytics.ts:24,33,42` | Each scene advance | ✅ | — | — | — | — | — | ✅ LIVE |  |
| `survey_discovery` / `survey_profession` / `survey_team_size` / `survey_pricing` / `survey_skip` | `survey-analytics.ts:23,32,41,86,91` | Specific answer events | ✅ | — | — | — | — | — | ✅ LIVE |  |
| `pricing_view` | `survey-analytics.ts:51` | Survey reaches pricing scene | ✅ | ✅ `ViewContent` | — | — | — | — | ✅ LIVE | `survey-analytics.ts:51-55` |
| `pricing_cta_click` | `survey-analytics.ts:63` | User clicks a plan CTA in survey | ✅ `{plan}` | ✅ `InitiateCheckout` | — | — | — | — | ✅ LIVE | `survey-analytics.ts:63-76` |
| `survey_complete` | `survey-analytics.ts:121` | User finishes survey | ✅ `{profile}` | ✅ `Lead` (via `trackComplete` → `trackLead`) | — | — | — | — | ✅ LIVE | `survey-analytics.ts:113-128` |
| `user_properties_set` | `survey-analytics.ts:132` | Sets GA4 user properties | ✅ | — | — | — | — | — | ✅ LIVE |  |
| `generate_lead` (landing CTAs) | `meta-pixel.ts:39-42` via `trackLead` | Nav CTA, hero CTA, mobile menu, newsletter, book-demo, workflow request form | ✅ `generate_lead` | ✅ `Lead` | — | — | — | — | ✅ LIVE | `app/page.tsx:977,1097,1189,1553`, `book-demo/page.tsx:280`, `landing/components/NewsletterSignup.tsx:34` |
| `contact_form` | `meta-pixel.ts:51-54` via `trackContact` | Contact form submit | ✅ | ✅ `Contact` | — | — | — | — | ✅ LIVE | `contact/page.tsx:71` |

### 2.5 Purchase events

| Event | Fires Where | Fires When | GTM | Meta Px | Meta CAPI | GA gtag | Google Ads | Dedup event_id | Status | File:Line |
|---|---|---|---|---|---|---|---|---|---|---|
| `Purchase` (browser pixel) | `thank-you/subscription/page.tsx:230` via `trackPurchase` | `/thank-you/subscription` first mount, guarded by `localStorage.bf_purchase_fired_<eventID>` | ✅ `purchase` | ✅ | — | — | ❌ NOT WIRED — purchase label empty | ✅ `purchase_<userId>_<plan>` (deterministic via `getPurchaseEventId`) | ✅ LIVE for pixel · ❌ Google Ads not wired | `thank-you/subscription/page.tsx:201-246` |
| `purchase_complete` (dataLayer) | `thank-you/subscription/page.tsx:238` | Same as above | ✅ `{plan, currency, value, event_id}` | — | — | — | — | ✅ same event_id | ✅ LIVE | `thank-you/subscription/page.tsx:238-243` |
| `Purchase` (CAPI — Stripe path) | `server-conversions.ts:125-155` via `trackServerPurchase` | `checkout.session.completed` webhook, **gated** on plan resolved from `priceId !== 'FREE'` | — | — | ✅ | — | — | ✅ same `purchase_<userId>_<plan>` | ✅ LIVE when `META_CAPI_ACCESS_TOKEN` set | `api/stripe/webhook/route.ts:95-115` |
| `Purchase` (CAPI — Razorpay path) | `server-conversions.ts:125-155` via `trackServerPurchase` | `subscription.activated`/`charged`, gated on `previousRole === 'FREE' && newRole !== 'FREE'` | — | — | ✅ | — | — | ✅ same `purchase_<userId>_<plan>` | ✅ LIVE | `api/razorpay/webhook/route.ts:222-246` |
| `begin_checkout` (dataLayer) | `meta-pixel.ts:75-78` via `trackInitiateCheckout` | Survey pricing CTA click | ✅ | ✅ `InitiateCheckout` | — | — | — | — | ✅ LIVE | `survey-analytics.ts:68,75` |

### 2.6 Share / engagement events

| Event | Fires Where | GTM | Meta Px | GA gtag | Status | File:Line |
|---|---|---|---|---|---|---|
| `workflow_shared` (platform: twitter) | Canvas toolbar Share-on-X click | — | — | ✅ | ✅ LIVE | `CanvasToolbar.tsx:487` |
| `workflow_shared` (platform: linkedin) | Canvas toolbar Share-on-LinkedIn click | — | — | ✅ | ✅ LIVE | `CanvasToolbar.tsx:488` |
| `workflow_shared` (platform: copy) | Canvas toolbar Copy-link click | — | — | ✅ | ✅ LIVE | `CanvasToolbar.tsx:489` |
| `exit_intent_shown` | Exit-intent modal appears | — | — | ✅ | ✅ LIVE | `ExitIntentModal.tsx:36` |
| `exit_intent_dismissed` | Exit-intent modal closed | — | — | ✅ | ✅ LIVE | `ExitIntentModal.tsx:41` |
| `exit_intent_email_submitted` | Exit-intent email captured | — | — | ✅ | ✅ LIVE | `ExitIntentModal.tsx:115` |

### 2.7 Orphaned functions (defined but not called)

| Function | Location | Notes |
|---|---|---|
| `trackAdsConversion(sendTo, params)` | `meta-pixel.ts:91-94` | Defined from before attribution-v2. Zero callers — the `fireGoogleAdsSignupConversion` helper at line 108-125 replaces it with a kill-switched version. Harmless dead code. |

---

## Section 3 — Signup Funnel (full trace)

### 3.1 Email signup path

| # | Event | Location | Notes |
|---|---|---|---|
| 1 | User lands on site (ad click or direct) | `middleware.ts:11-14` | On first matched request, `captureAttributionCookie(req, res)` writes `bf_attribution` cookie (90d, first-touch, `sameSite=lax`, `httpOnly=false`, `secure` in prod). Writes only if cookie missing AND URL has at least one tracked param OR external referrer. |
| 2 | User navigates to `/register` | `register/page.tsx:65` | `trackRegisterPageView()` fires fbq `ViewRegisterPage` + dataLayer `view_register_page`. |
| 3 | User submits form | `register/page.tsx:112` | Client generates `signupEventId = "signup_" + crypto.randomUUID()` (deterministic per submission). |
| 4 | `POST /api/auth/register` | `api/auth/register/route.ts:18+` | Rate-limited per IP (5/min). Validates email, password complexity, phone format. Checks existing email/phone. |
| 5 | Read attribution cookie | `api/auth/register/route.ts:120` | `readServerAttributionCookie(req)` — zod-validated via `AttributionCookieSchema`. |
| 6 | Create user with attribution + signupEventId | `api/auth/register/route.ts:141-150` | `prisma.user.create` includes `signupEventId`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `utm*`, `referrer`, `landingPage`, `landedAt`. |
| 7 | Server-side analytics log | `api/auth/register/route.ts:152` | `trackSignup(user.id, source).catch(...)` — fire-and-forget JSONL write. |
| 8 | Meta CAPI fires | `api/auth/register/route.ts:156-163` | `trackServerSignup({email, phone, firstName, ip, userAgent, eventId: signupEventId})` — includes fbc/fbp not captured on this path (gap, see Section 9). |
| 9 | Referral claim (if code provided) | `api/auth/register/route.ts:166-170` | Awaited. |
| 10 | Response returns | `api/auth/register/route.ts:193` | `{user: {id, email, name}}` 201 Created. |
| 11 | Client-side conversion stack | `register/page.tsx:140-145` → `useSignupConversions.ts:30-66` | In order: (a) `pushEnhancedConversionData({email, firstName})` → dataLayer `enhanced_conversion_data` with SHA-256 email; (b) `trackCompleteRegistration({content_name: "email_signup" or "phone_signup", user_email, user_name}, {eventID: signupEventId})` → fbq `CompleteRegistration` + dataLayer `sign_up`; (c) `fireGoogleAdsSignupConversion(eventId)` — kill-switched, no-op unless env flipped; (d) dataLayer `sign_up_complete` with `{method: "credentials", event_id}`. |
| 12 | Auto-login + redirect | `register/page.tsx:148-159` | `signIn("credentials", ...)` with `callbackUrl: "/onboard"`. |

### 3.2 Google OAuth signup path

| # | Event | Location | Notes |
|---|---|---|---|
| 1 | Attribution cookie captured on landing | `middleware.ts:11-14` | Same as email path. |
| 2 | User views `/register` | `register/page.tsx:65` | `trackRegisterPageView` same as above. |
| 3 | User clicks "Continue with Google" | `register/page.tsx:172-190` | **No tracking fires here.** Previous click-time `trackCompleteRegistration` was removed in commit `ccc9ee7` — it used to double-count every cancelled OAuth. |
| 4 | NextAuth redirects to Google consent | standard Google OAuth flow | |
| 5 | Google OAuth returns to NextAuth callback | NextAuth adapter in `auth.ts` | `PrismaAdapter` creates new `User` row. |
| 6 | `events.createUser` fires | `auth.ts:140-183` | Generates `signupEventId = "signup_" + crypto.randomUUID()`; reads `bf_attribution` cookie via `cookies()` from `next/headers`; zod-validates via `safeParseAttributionCookie`; updates User with signupEventId + attribution fields. Fires Meta CAPI with `trackServerSignup` using the new event_id. |
| 7 | JWT callback runs | `auth.ts:53-84` | Reads `signupEventId` from DB (`prisma.user.findUnique`) and attaches to token. |
| 8 | Session exposes `signupEventId` | `auth.config.ts:32` | `(session.user as any).signupEventId = token.signupEventId`. |
| 9 | User lands on `/onboard` | `onboard/page.tsx:47-52` | Server-rendered page mounts `<OAuthSignupConversionFire />` + SurveyShell. |
| 10 | OAuth client-side conversion fires | `OAuthSignupConversionFire.tsx:22-50` | Reads `session.user.signupEventId` + `session.user.id`. Checks `localStorage.bf_oauth_signup_fired_<userId>`. If not fired yet, calls `useSignupConversions.fire({method: "google", eventId, email, name})` → same stack as step 11 of email path, with `content_name: "google_signup"`. Sets localStorage flag. |
| 11 | User completes or skips survey | `onboard/page.tsx` survey flow | Separate instrumentation via `survey-analytics.ts`. |

### 3.3 Existing user login

**Email / phone login:**
1. `/login` form submit → `signIn("credentials", ...)` — `login/page.tsx:142`
2. On success: `trackLogin({method: "email" or "phone"})` → fbq custom `Login` + dataLayer `login` — `login/page.tsx:170`
3. `signIn` callback in `auth.ts:119-128` → internal `trackLogin(user.id)` JSONL log

**Google login (existing user):**
1. "Continue with Google" button → `signIn("google", ...)` — `register/page.tsx` or `login/page.tsx`
2. OAuth completes → adapter finds existing User row → `events.createUser` does NOT fire (only fires on new row creation)
3. JWT callback runs → reads `signupEventId` from DB (already populated for OAuth users post-migration, null for pre-migration legacy users)
4. ❌ **No client-side `Login` fbq event.** OAuth redirect leaves `/login` before `trackLogin` runs. Gap — see Section 9.
5. `signIn` callback → internal `trackLogin(user.id)` JSONL log fires

---

## Section 4 — Purchase Funnel (full trace)

### 4.1 Stripe checkout → thank-you

| # | Event | Location | Notes |
|---|---|---|---|
| 1 | User clicks upgrade → Stripe Checkout | existing billing flow | Out of scope for attribution-v2. |
| 2 | Stripe fires webhook `checkout.session.completed` | `api/stripe/webhook/route.ts:58-98` | Signature verified, idempotent via `checkWebhookIdempotency`. |
| 3 | `updateUserSubscription` runs | `api/stripe/webhook/route.ts:75` → `:198-378` | Sets role, stripePriceId, stripeCurrentPeriodEnd. Has its own FREE-plan guard at line 285-320. |
| 4 | Welcome email fires | `api/stripe/webhook/route.ts:93` | Fire-and-forget. |
| 5 | **Purchase conversion FREE-plan gate** | `api/stripe/webhook/route.ts:95-102` | Resolves `purchasePlan = getPlanByPriceId(subscription.items.data[0].price.id)`. Skips if plan === "FREE" with `console.warn`. Does NOT gate on `checkoutUser.role` (which races with updateUserSubscription). |
| 6 | Meta CAPI `Purchase` fires | `api/stripe/webhook/route.ts:107-115` | `trackServerPurchase({...plan: purchasePlan, currency: "INR", value: amountTotalINR ?? getPlanValueINR(plan)})`. Uses deterministic `purchase_<userId>_<plan>` event_id. |
| 7 | Stripe redirects browser to `/thank-you/subscription?plan=...` | | |
| 8 | Thank-you page first mount | `thank-you/subscription/page.tsx:201-246` | Derives `eventID = getPurchaseEventId(userId, plan)` — deterministic. Checks `localStorage.bf_purchase_fired_<eventID>` one-shot guard. If set, returns. Else: sets in-memory firedRef, fires pixels, sets localStorage. |
| 9 | Client-side purchase stack | 229-243 | (a) `pushEnhancedConversionData({email, firstName})`; (b) `trackPurchase({content_name, currency: "INR", value}, {eventID})` → fbq `Purchase` + dataLayer `purchase`; (c) dataLayer `purchase_complete` with `{plan, currency, value, event_id}`. **No Google Ads conversion fires** — no purchase label env var wired. |
| 10 | Meta dedup | Meta's side | Browser pixel event_id + CAPI event_id match → Meta Events Manager reports DEDUPLICATED. |

### 4.2 Razorpay subscription → thank-you

| # | Event | Location | Notes |
|---|---|---|---|
| 1 | User completes Razorpay subscription | existing Razorpay flow | |
| 2 | Razorpay fires webhook (`subscription.activated` or `subscription.charged`) | `api/razorpay/webhook/route.ts:62-69` | Signature verified, idempotent. |
| 3 | `activateSubscription` runs | `api/razorpay/webhook/route.ts:145-246` | Finds user by subId or notes.userId; resolves `newRole = getRoleByRazorpayPlanId(planId)`. Has its own FREE-plan guard at line 184-209. |
| 4 | **Purchase conversion gated** | `api/razorpay/webhook/route.ts:222-246` | Only fires if `previousRole === 'FREE'` (true upgrade, not renewal) AND `newRole !== 'FREE'` (defensive — catches null planId falling past the earlier guard). |
| 5 | Meta CAPI `Purchase` fires | `api/razorpay/webhook/route.ts:238-244` | Same `purchase_<userId>_<plan>` event_id. Note: no phone captured here (email only). |
| 6 | Welcome email fires | `api/razorpay/webhook/route.ts:234` | Fire-and-forget. |
| 7 | Browser redirects to `/thank-you/subscription` | Same page as Stripe path, so same client-side events fire. | |

### 4.3 Purchase dedup matrix

| Scenario | Pixel fires? | CAPI fires? | Dedup? |
|---|---|---|---|
| Happy path — webhook + thank-you | ✅ | ✅ | ✅ via deterministic `purchase_<userId>_<plan>` |
| User reloads thank-you page | ❌ (localStorage guard) | — | N/A |
| User opens thank-you in 2 tabs | ❌ (localStorage guard — first tab wins) | — | N/A |
| Webhook retries (Stripe idempotency) | — | ❌ (checkWebhookIdempotency) | N/A |
| Subscription renewal (not first upgrade) | — | ❌ (previousRole === 'FREE' gate) | N/A |

---

## Section 5 — Attribution Data Captured

### 5.1 URL params & cookies

**Source URL params captured (via `extractAttributionParamsFromURL` at `utm.ts:34-60`):**
- `gclid` — Google Ads desktop/mobile click id
- `gbraid` — Google Ads iOS14+ click id
- `wbraid` — Google Ads iOS14+ in-app click id
- `fbclid` — Meta Ads click id
- `msclkid` — Bing / LinkedIn Ads click id
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`

Plus derived on landing:
- `referrer` — HTTP `Referer` header origin, only if external (`attribution.ts:103-113`)
- `landingPage` — `req.nextUrl.pathname + search` (`attribution.ts:120`)
- `landedAt` — `new Date().toISOString()` (`attribution.ts:121`)

**Special handling — NextAuth redirect-preserved params:** if URL has `callbackUrl=...`, the inner URL's params are also extracted so attribution survives the "unauth user bounces to /login" trip (`utm.ts:47-58`).

### 5.2 Cookie storage

| Field | Value |
|---|---|
| Name | `bf_attribution` (`attribution.ts:22`) |
| Value format | URL-encoded JSON, zod-validated via `AttributionCookieSchema` (`attribution.ts:27-42`) |
| Path | `/` (`attribution.ts:140`) |
| SameSite | `lax` (`attribution.ts:141`) |
| Secure | `process.env.NODE_ENV === "production"` (`attribution.ts:142`) |
| HttpOnly | `false` — client JS can read for dataLayer hydration (`attribution.ts:143`) |
| MaxAge | 90 days (`attribution.ts:24`) |
| Max length | 4000 bytes — oversized cookies silently rejected (`attribution.ts:25`) |
| Overwrite behaviour | **First touch wins** — existing valid cookie is never replaced (`attribution.ts:130-131`) |

### 5.3 Persisted on User row

| DB column | Source | Prisma schema | Populated by |
|---|---|---|---|
| `gclid` | URL param | `schema.prisma:40` | `/api/auth/register` data spread (`route.ts:124-134`), `events.createUser` (`auth.ts:148-163`) |
| `gbraid` | URL param | `schema.prisma:41` | same |
| `wbraid` | URL param | `schema.prisma:42` | same |
| `fbclid` | URL param | `schema.prisma:43` | same |
| `msclkid` | URL param | `schema.prisma:44` | same |
| `utmSource` | URL param | `schema.prisma:45` | same |
| `utmMedium` | URL param | `schema.prisma:46` | same |
| `utmCampaign` | URL param | `schema.prisma:47` | same |
| `utmTerm` | URL param | `schema.prisma:48` | same |
| `utmContent` | URL param | `schema.prisma:49` | same |
| `referrer` | HTTP Referer | `schema.prisma:50` | same |
| `landingPage` | `pathname + search` | `schema.prisma:51` | same |
| `landedAt` | `Date.now()` at cookie write | `schema.prisma:52` | same |
| `signupEventId` | UUID — client-generated on email path, server-generated on OAuth path | `schema.prisma:55` | `/api/auth/register` (`route.ts:147`) or `events.createUser` (`auth.ts:143, 169`) |
| `firstExecutionAt` | `Date.now()` on first successful execution | `schema.prisma:56` | atomic `updateMany` in `api/executions/[id]/route.ts:95-100` |

### 5.4 `UserSurvey` duplicate-attribution columns

`prisma/schema.prisma:82-115` — `UserSurvey` has its own `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`, `referrer`, `country`, `city`, `deviceType`, `userAgent` columns. These are populated by the onboarding survey flow only — users who skip the survey leave them null. The User-table columns above are the canonical source for paid-ads attribution.

---

## Section 6 — Consent Mode v2 Behaviour

### 6.1 Default state (before any user action)

At `layout.tsx:258-270`, **before any tracking script loads**:

```js
gtag('consent','default',{
  analytics_storage:   'denied',
  ad_storage:          'denied',
  ad_user_data:        'denied',
  ad_personalization:  'denied',
  wait_for_update: 500  // ms
});
```

- `wait_for_update: 500` — any gtag fire in the first 500ms of page load waits until user consent is resolved (up to that timeout).
- Meta Pixel equivalent: `fbq('consent', 'revoke')` at `TrackingScripts.tsx:48`.

### 6.2 Banner trigger logic

`CookieConsent.tsx:11-18` — banner appears only if `localStorage.buildflow-cookie-consent` is null (i.e. user has never chosen). 1.5-second delay prevents flash.

### 6.3 User accepts

`cookie-consent.ts:12-30` — `setTrackingConsent("accepted")`:
1. Writes `localStorage.buildflow-cookie-consent = "accepted"`
2. Fires `gtag('consent','update',{analytics_storage:"granted", ad_storage:"granted", ad_user_data:"granted", ad_personalization:"granted"})`
3. Fires `fbq('consent','grant')`
4. Dispatches `cookie-consent-change` custom event

### 6.4 User rejects

Same mechanism with `denied` + `fbq('consent','revoke')`.

### 6.5 Known edge cases

| Case | Behaviour |
|---|---|
| User signs up within 500 ms of landing | Gtag fires respect `wait_for_update`, so conversion may be delayed but not lost. |
| User signs up BEFORE interacting with cookie banner | Consent still `denied` at pixel fire time. Meta Pixel in this state uses cookieless pings for conversion modelling; Google Ads uses the same for basic conversion modelling. Data quality reduced but not zero. |
| User has `localStorage` blocked (private browsing) | `getTrackingConsent()` returns `null` → banner shows forever. Pixels fire in denied state. |
| Cookie consent accepted on one subdomain | `localStorage` is host-scoped — each `.trybuildflow.in` host sees a fresh banner. Not currently a problem (single host). |
| User revokes after accepting | `setTrackingConsent("rejected")` is called → all consent signals go back to denied. Existing events already fired remain logged in platforms. |

---

## Section 7 — Kill Switches & Feature Flags

| Env Var | Default (.env.example) | Effect when `"true"` | Effect when `"false"` or unset | Visible from code |
|---|---|---|---|---|
| `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` | `"false"` (`.env.example:204`) | `fireGoogleAdsSignupConversion` fires `gtag('event','conversion',{send_to,transaction_id})` — ONLY if `NEXT_PUBLIC_GOOGLE_ADS_ID` and `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL` are also set AND `window.gtag` is loaded (`meta-pixel.ts:108-125`) | Silent no-op — function returns immediately (`meta-pixel.ts:112`) | ✅ |
| `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL` | `""` (empty, `.env.example:211`) | Used as the conversion label suffix (`${AW-id}/${label}`) | `fireGoogleAdsSignupConversion` skips silently if missing (`meta-pixel.ts:114-115`) | ✅ |
| `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` | `""` (empty, `.env.example:214`) | Future use — not wired this branch | No path reads this yet | ⚠️ declared but unconsumed |
| `NEXT_PUBLIC_GOOGLE_ADS_FIRST_EXECUTION_LABEL` | `""` (empty, `.env.example:217`) | Future use — not wired this branch | No path reads this yet | ⚠️ declared but unconsumed |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | `"AW-XXXXXXXXXX"` placeholder (`.env.example:194`) | gtag.js loaded, conversion label composed | Google Ads base tag not loaded (`TrackingScripts.tsx:86`) | ✅ |
| `NEXT_PUBLIC_GTM_ID` | `"GTM-XXXXXXX"` placeholder (`.env.example:174`) | GTM container loaded | Container not loaded; raw fbq still fires; dataLayer still fillable | ✅ |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `"G-XXXXXXXXXX"` placeholder (`.env.example:187`) | GA4 loaded | GA4 not loaded | ✅ |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | `"vx5sglywjv"` (`.env.example:209`) | Clarity script loaded | No Clarity | ✅ |
| `NEXT_PUBLIC_SENTRY_DSN` | empty (`.env.example:220`) | Sentry active | No error tracking | ✅ |
| `META_CAPI_ACCESS_TOKEN` | empty (`.env.example:181`) | CAPI calls succeed | CAPI calls silently skipped (`server-conversions.ts:52`) | ✅ |

**Prod state from code:** we can only assert defaults. What's actually set in Vercel's prod env is not visible from this repo. Section 12 gives you the commands to verify.

---

## Section 8 — What's Working End-to-End

A row is "working end-to-end" only if:
- (a) event fires client-side (or server-side), AND
- (b) event reaches the platform — confirmed by CAPI response / server fire / tag verifier / event_id dedup

| Capability | Status | Evidence | Verification command |
|---|---|---|---|
| Meta Pixel base install + PageView | ✅ | `TrackingScripts.tsx:37-52` loads + fires PageView; Meta Events Manager shows PV | Meta Events Manager → Real-Time → pixel ID `2072969213494487` |
| Meta Pixel CompleteRegistration — email signup | ✅ | `useSignupConversions.ts:42-52` + `register/page.tsx:140-145`; server CAPI mirror via `api/auth/register/route.ts:156` | Section 12 — Meta Events Manager → Test Events |
| Meta CAPI CompleteRegistration — both paths | ✅ | server-conversions.ts:96-123; deduplicated against browser pixel via shared event_id | Meta Events Manager → Event → DEDUPLICATED indicator |
| Meta Pixel CompleteRegistration — OAuth signup (NEW) | ✅ (post-merge) | `OAuthSignupConversionFire.tsx:22-50`; matches email-path fidelity | Section 12 step 10 |
| Meta CAPI CompleteRegistration — OAuth signup (NEW) | ✅ (post-merge) | `auth.ts:175-180` events.createUser fires with shared event_id | Meta Events Manager |
| Meta Pixel Purchase | ✅ | `thank-you/subscription/page.tsx:230` fbq `Purchase` with deterministic event_id | Meta Events Manager after test subscription |
| Meta CAPI Purchase — Stripe | ✅ | `api/stripe/webhook/route.ts:107-115`; gated on plan !== FREE | Section 12 — test checkout |
| Meta CAPI Purchase — Razorpay | ✅ | `api/razorpay/webhook/route.ts:238-244`; gated on `previousRole === FREE && newRole !== FREE` | Section 12 |
| Meta Pixel Login (credentials) | ✅ | `login/page.tsx:170` fbq custom Login | Meta Events Manager |
| Meta Pixel Lead events | ✅ | `app/page.tsx:977+`, `book-demo/page.tsx:280`, `NewsletterSignup.tsx:34`, `survey-analytics.ts:128` | Meta Events Manager |
| Enhanced Conversion data push | ✅ | `gtm.ts:48-62` via `pushEnhancedConversionData`; dataLayer `enhanced_conversion_data` | `window.dataLayer.filter(x=>x.enhanced_conversion_data)` |
| GA4 pageviews + SPA route tracking | ✅ (when `NEXT_PUBLIC_GA_MEASUREMENT_ID` set) | `TrackingScripts.tsx:67-83` + `UTMCapture.tsx:31` | GA4 Realtime |
| Microsoft Clarity | ✅ (when env set) | `TrackingScripts.tsx:55-65` | Clarity dashboard |
| GTM dataLayer events (sign_up, purchase, first_execution_success, surveys, shares, exit_intent) | ✅ | 40+ pushToDataLayer/dataLayer.push sites (Section 2) | `window.dataLayer` in browser console |
| Consent Mode v2 gating | ✅ | `layout.tsx:258-270` default deny + `cookie-consent.ts:19-28` update | Chrome devtools → Application → Cookies / Storage |
| Attribution cookie (`bf_attribution`) capture + persistence | ✅ (post-merge) | `middleware.ts:11-14` → `attribution.ts:129-146`; persisted at `/api/auth/register:141-150` + `auth.ts:148-170` | Section 12 step 4 |
| First-execution micro-conversion (dataLayer only) | ✅ (post-merge) | Server-atomic gate `api/executions/[id]/route.ts:87-109` + client push `useExecution.ts:2088-2100` | Section 12 step 6 |
| Stripe purchase attribution hygiene — FREE-plan gate | ✅ (post-merge) | `api/stripe/webhook/route.ts:95-102` gates on resolved plan from priceId | Check prod logs for `[stripe-webhook] unrecognized priceId` warnings |
| Razorpay purchase attribution hygiene — FREE-plan gate | ✅ (post-merge) | `api/razorpay/webhook/route.ts:226-232` | Check prod logs for `[razorpay-webhook] newRole is FREE` warnings |

---

## Section 9 — What's Not Working / Gaps

Ranked by impact on marketing ROI (highest first).

| # | Gap | Impact | Evidence | Blocker to fix |
|---|---|---|---|---|
| 1 | **Google Ads signup conversion not yet firing (dark)** | Signups are not reported to Google Ads → smart bidding can't optimize → ad spend inefficient | Kill switch `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` defaults `"false"` (`.env.example:204`). `fireGoogleAdsSignupConversion` returns early (`meta-pixel.ts:112`) | (a) Marketing manager screenshots GTM container per `docs/attribution-v2-manager-checklist.md` Task 2; (b) verify no duplicate Ads conversion tag in GTM; (c) flip env var to `"true"` in Vercel; (d) set `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL = "mxJmCO3N-Z8cEOC94LFD"` |
| 2 | **No Google Ads Purchase conversion wired at all** | Paid subscriptions can't be tracked as Google Ads conversions → ROAS calculations broken → remarketing blind | `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` exists as an env declaration in `.env.example:214` but NO code reads it. No gtag conversion call in `thank-you/subscription/page.tsx` | Manager runs `docs/attribution-v2-manager-checklist.md` Task 3 → emails label → one-commit wiring job (~5 LOC) |
| 3 | **Google OAuth login has NO client-side Meta `Login` event** | Returning Google users aren't tracked as logins in Meta funnel reports | No fire point between OAuth redirect and dashboard land. `login/page.tsx:170` only runs on credentials path | Mirror the OAuthSignupConversionFire pattern — add a `<ReturningOAuthLoginFire />` that fires `trackLogin({method: "google"})` on /dashboard first mount with a localStorage flag that clears daily |
| 4 | **Meta CAPI on OAuth signup path lacks IP + user_agent** | Slightly lower Meta match quality for OAuth signups | `auth.ts:175-180` calls `trackServerSignup({email, firstName, eventId})` without `ip` or `userAgent` — events hook has no `Request` context | Pass through headers by capturing them via middleware and attaching to an additional cookie, OR switch the CAPI call to /onboard client component where fbc/fbp cookies are also available |
| 5 | **Meta CAPI on email signup path lacks fbc / fbp cookies** | Meta dedup against browser pixel via user_data is less precise (still works via event_id but match quality lower) | `api/auth/register/route.ts:156-163` passes `{email, phone, firstName, ip, userAgent, eventId}` but not `fbc`, `fbp` — Meta CAPI supports these (`server-conversions.ts:38-39`) | Read `_fbc` + `_fbp` cookies from `req.cookies` in the register route, pass to `trackServerSignup` |
| 6 | **Internal analytics logs to local filesystem — doesn't persist on Vercel** | Internal dashboards (`/api/analytics` GET) show stale/incorrect data | `analytics.ts:141-154` writes to `./analytics-logs/events-<date>.jsonl` — Vercel's filesystem is read-only at runtime and doesn't persist between deploys | Migrate `trackEvent` to write to a Prisma `Event` table or an external log sink (BigQuery / Axiom / PostHog) |
| 7 | **Meta Pixel ID hardcoded in two places** | Any rotation requires code deploy (manager can't rotate) | `meta-pixel.ts:5` + `server-conversions.ts:16` both hardcode `2072969213494487` | Promote to `NEXT_PUBLIC_META_PIXEL_ID` + `META_CAPI_URL` env vars |
| 8 | **`trackFirstExecution` (internal) fires on execution START, not success** | Internal "first execution" metric is misleading — counts abandoned/failed runs | `api/executions/route.ts:109` calls it at execution creation, not completion. The `first_execution_success` dataLayer event uses the correct atomic gate, but the internal JSONL still has the old semantics | Low priority — internal metric, not paid-ads. Fix by moving to `/api/executions/[id]/route.ts` PUT SUCCESS handler |
| 9 | **Meta API version `v21.0` hardcoded** | Graph API version drift — silently breaks when Meta deprecates v21 | `server-conversions.ts:17` | Move to env var or centralize version upgrade |
| 10 | **UTMs on `UserSurvey` are a duplicate data source** | Potential drift between User.utmSource (canonical now) and UserSurvey.utmSource (onboarding-populated) | `prisma/schema.prisma:95-100` | Document which is canonical in a CLAUDE.md section, or drop UserSurvey.utm* once confident |
| 11 | **No last-touch companion cookie** | When Google Ads OCI lookback-window becomes relevant, first-touch gclid may be stale (Google Ads matches on gclids within 90d of click) | Per-design — first-touch semantics in `attribution.ts:130-131` | Add `bf_attr_last` cookie that overwrites on every new ad-param landing. Future roadmap per `attribution-v2-plan.md` §12. |
| 12 | **No Bing Ads UET / LinkedIn Insight pixel** | msclkid captured but not reported; LinkedIn ROI blind | No Bing/LinkedIn script in `TrackingScripts.tsx` | When/if the manager starts spending on those platforms |
| 13 | **Pixel consent at first pageview can be "denied"** | Some conversions report in modelled-only mode | Consent Mode v2 default deny (`layout.tsx:258-270`) combined with `wait_for_update: 500` | Acceptable by design. Could show banner sooner (currently 1.5s delay in `CookieConsent.tsx:14`) |
| 14 | **`trackAdsConversion` is dead code** | Minor code hygiene | `meta-pixel.ts:91-94` — zero callers | Delete during next cleanup |
| 15 | **Click-time OAuth conversion fires were a live bug pre-merge** | Pre-merge: every cancelled Google consent counted as a signup | Fixed in commit `ccc9ee7` | Already fixed. Recorded here as historical context for post-merge metric-comparison sanity |

---

## Section 10 — Vercel Env Vars Required

**Required for production.** Missing = feature silently absent, not a crash (except the two marked **prod-required**).

| Env Var | Example / Placeholder | In `.env.example`? | Line | Criticality |
|---|---|---|---|---|
| `NEXT_PUBLIC_GTM_ID` | `GTM-MD563HH5` | ✅ | 174 | **Required** — GTM is the universal dispatcher |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | `AW-18089516768` | ✅ | 194 | **Required** for any Google Ads attribution |
| `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` | `false` (first deploy) → `true` (after GTM verified) | ✅ | 204 | Required — without setting, kill switch stays on (safe default) |
| `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL` | `mxJmCO3N-Z8cEOC94LFD` | ✅ (empty) | 211 | Required with the kill switch flip |
| `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` | `""` (pending manager) | ✅ (empty) | 214 | Optional — unused until wired |
| `NEXT_PUBLIC_GOOGLE_ADS_FIRST_EXECUTION_LABEL` | `""` (future) | ✅ (empty) | 217 | Optional — unused until wired |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-XXXXXXXXXX` | ✅ | 187 | Optional (GA4 disabled without it) |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | `vx5sglywjv` | ✅ | 209 | Optional |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://...@sentry.io/...` | ✅ | 220 | Optional |
| `META_CAPI_ACCESS_TOKEN` | `EAAG...` (Meta Business System User token) | ✅ | 181 | **Prod-required** — without it, CAPI dedup for Meta broken (pixel still works but adblocker gap remains) |

### 10.1 Env vars referenced in code but NOT in .env.example

Pre-existing gaps found during this audit. Not attribution-v2 scope but worth flagging:

| Env Var | Referenced At | Missing From .env.example |
|---|---|---|
| `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS` | `src/lib/platform-admin.ts:9` | ✅ missing |
| `NEXT_PUBLIC_PUSHER_KEY` | `src/lib/pusher-client.ts:14` | ✅ missing |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | `src/lib/pusher-client.ts:15` | ✅ missing |

---

## Section 11 — GTM Container — What We Know / Don't Know

### 11.1 Known from code

| Fact | Evidence |
|---|---|
| GTM container is loaded when `NEXT_PUBLIC_GTM_ID` is set | `TrackingScripts.tsx:25-35` injects `gtm.js`; `layout.tsx:276-285` injects noscript iframe |
| Container ID expected: `GTM-MD563HH5` | From email thread in Phase 1 prompt. NOT hardcoded in our repo — set via env var only |
| Consent Mode v2 defaults are set BEFORE GTM loads | `layout.tsx:258-270` uses `strategy="beforeInteractive"` |

### 11.2 dataLayer events we push (GTM triggers available on these)

**Full list** — manager can configure GTM tags to fire on any of these:

| Event | Payload fields |
|---|---|
| `sign_up` | `content_name`, `user_email?`, `user_name?`, `event_id` (via fbq trackCompleteRegistration dataLayer mirror at `meta-pixel.ts:47`) |
| `sign_up_complete` | `method` ("credentials" / "google"), `event_id` |
| `generate_lead` | varies by caller |
| `contact_form` | `content_name` |
| `view_item` | varies |
| `view_register_page` | — |
| `purchase` | `content_name`, `currency`, `value`, `event_id` |
| `purchase_complete` | `plan`, `currency`, `value`, `event_id` |
| `begin_checkout` | `plan`, `value`, `currency` |
| `login` | `method` |
| `first_execution_success` | `event_id`, `user_id_hash`, `node_count` |
| `workflow_shared` | `platform` (gtag event, not dataLayer push) |
| `exit_intent_shown` / `exit_intent_dismissed` / `exit_intent_email_submitted` | gtag events |
| `survey_start` / `survey_scene_view` / `survey_scene_complete` / `survey_discovery` / `survey_profession` / `survey_team_size` / `survey_pricing` / `survey_skip` / `survey_complete` / `pricing_view` / `pricing_cta_click` / `user_properties_set` | Various survey funnel fields |
| `enhanced_conversion_data` | `{sha256_email_address?, sha256_phone_number?, address?}` — pushed before conversion events, consumed by GTM's Enhanced Conversions tag |

### 11.3 What the GTM container is configured to do with these

⚠️ **We cannot verify this from code.** GTM config lives on Google's servers. From the marketing manager's email thread we know:
- GTM ID is `GTM-MD563HH5`
- At least one Google Ads conversion tag may be configured inside the container (unknown which label / trigger)
- We have explicitly designed `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` to stay `false` until someone screenshots the container and confirms no double-fire risk

**Action item:** manager Task 2 in `docs/attribution-v2-manager-checklist.md`.

### 11.4 Expected GTM tag configurations (reference for manager)

| Signal to GTM | Expected GTM tag | Status |
|---|---|---|
| Page load | Google Tag base (Ads + GA4) | Presumed present |
| dataLayer `sign_up` or `sign_up_complete` | Optional: Google Ads Conversion tag → Sign-up (3) label | **DO NOT configure if our code also fires gtag directly** — double-fire. Either our code fires OR GTM does, never both. |
| dataLayer `purchase_complete` | Google Ads Conversion tag → Purchase label (when manager creates one) | Pending |
| dataLayer `first_execution_success` | Optional GA4 event tag → for funnel reports | Manager can set up anytime |
| dataLayer `sign_up` / `purchase` | GA4 events (built-in GA4 recognises these) | Likely present |

---

## Section 12 — Post-Merge Health Check

Run in order. Bracketed placeholders require your substitution.

### 12.1 Database sanity

```sh
# Confirm migration applied
psql "$DATABASE_URL" -c "\d users" | grep -E "(gclid|signupEventId|firstExecutionAt|utmSource|landedAt)"
# Expect 15 matching lines.

# Check that new signups populate attribution
psql "$DATABASE_URL" -c "
  SELECT email, gclid, \"utmSource\", \"signupEventId\", \"firstExecutionAt\", \"landedAt\"
  FROM users
  WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'
  ORDER BY \"createdAt\" DESC
  LIMIT 20;
"

# Confirm no user has a signupEventId that isn't 'signup_<uuid>'-shaped
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM users WHERE \"signupEventId\" IS NOT NULL AND \"signupEventId\" NOT LIKE 'signup_%';
"
# Expect 0.

# Confirm firstExecutionAt is monotonic (only set once)
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM users WHERE \"firstExecutionAt\" IS NOT NULL AND \"firstExecutionAt\" < \"createdAt\";
"
# Expect 0.
```

### 12.2 Browser — attribution cookie

1. Open incognito window
2. Navigate to `https://trybuildflow.in/?gclid=TEST123&utm_source=verify&utm_campaign=health-check`
3. Devtools → Application → Cookies → `https://trybuildflow.in` → find `bf_attribution`
4. Decode: `decodeURIComponent(document.cookie.split('bf_attribution=')[1].split(';')[0])`
5. Expect a JSON object with `gclid:"TEST123"`, `utmSource:"verify"`, `utmCampaign:"health-check"`, `landingPage:"/?..."`, `landedAt:"<iso>"`.

### 12.3 Browser — dataLayer events after signup

After completing a test email signup:

```js
// In devtools console
window.dataLayer.filter(x => x.event === 'sign_up_complete')
// Expect exactly one entry with {event: 'sign_up_complete', method: 'credentials', event_id: 'signup_<uuid>'}

window.dataLayer.filter(x => x.event === 'sign_up')
// Expect one entry with content_name: 'email_signup' or 'phone_signup', event_id matching above

window.dataLayer.filter(x => x.enhanced_conversion_data)
// Expect one entry with sha256_email_address filled
```

### 12.4 Browser — first execution success

After running a test workflow to SUCCESS:

```js
window.dataLayer.filter(x => x.event === 'first_execution_success')
// Expect one entry with event_id: 'first_exec_<userId>', user_id_hash: '<64 hex>', node_count: <int>

// Re-run the same (or a different) workflow
window.dataLayer.filter(x => x.event === 'first_execution_success')
// Expect STILL exactly one entry (atomic server gate held)
```

### 12.5 Network tab — conversion fires gated off by default

1. Devtools → Network → filter: `googleadservices.com`
2. Perform a test signup
3. Expect **zero** requests to `/pagead/conversion/` while `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE` is `false` / unset
4. Flip env var to `true` in Vercel, redeploy, repeat
5. Expect exactly one request to `/pagead/conversion/AW-18089516768/?...` with `transaction_id=signup_<uuid>`

### 12.6 Meta Events Manager

1. Business Suite → Events Manager → Pixel ID `2072969213494487`
2. Test Events tab → open `trybuildflow.in/?fbclid=TEST` in a separate window
3. Complete a signup
4. In Test Events, expect:
   - 1x `CompleteRegistration` with source = Browser
   - 1x `CompleteRegistration` with source = Server
   - "Deduplicated" badge showing both share the same event_id
5. For a test subscription:
   - 1x `Purchase` Browser + 1x `Purchase` Server, deduped

### 12.7 OAuth smoke test

1. Sign out
2. Open incognito with a throwaway Google account → click "Continue with Google"
3. On `/onboard`:
   ```js
   // Check session has signupEventId
   (await fetch('/api/auth/session').then(r => r.json())).user.signupEventId
   // Expect 'signup_<uuid>'

   // Verify localStorage flag was set
   localStorage.getItem(`bf_oauth_signup_fired_${(await fetch('/api/auth/session').then(r => r.json())).user.id}`)
   // Expect '1'

   // Verify conversion fired once in dataLayer
   window.dataLayer.filter(x => x.event === 'sign_up_complete' && x.method === 'google')
   // Expect exactly one entry
   ```
4. Hard-refresh `/onboard` → dataLayer should NOT get a new `sign_up_complete` push (localStorage guard held)

---

## Section 13 — 30-Day Roadmap

Ordered by marketing-ROI impact.

| # | Action | Owner | Why it matters | Ref |
|---|---|---|---|---|
| 1 | Run `prisma migrate deploy` against prod DB | Founder | Prereq for deploy — attribution columns must exist before new code lands | `docs/attribution-v2-plan.md` §9 |
| 2 | Deploy `feat/attribution-v2` to prod | Founder (via merge + Vercel) | Unlocks everything below | — |
| 3 | Add new env vars to Vercel | Founder | Wire the kill switch label | Section 10 |
| 4 | Manager runs `docs/attribution-v2-manager-checklist.md` Tasks 1 + 2 | Manager | Archive stale Sign-up (1)(2) conversions; screenshot GTM container | — |
| 5 | Confirm GTM container does NOT already fire a Google Ads conversion tag | Founder + Manager | Prevents double-fire | Section 11.3 |
| 6 | Flip `NEXT_PUBLIC_FIRE_ADS_CONVERSIONS_CLIENT_SIDE = true` in Vercel | Founder | Signup conversions flow to Google Ads | Section 7 |
| 7 | Monitor Google Ads Diagnostics for Sign-up (3) | Founder | Confirm conversions recording | ads.google.com → Goals → Conversions → Sign-up (3) → Diagnostics |
| 8 | Manager runs Task 3 (create Purchase conversion) | Manager | Unlocks ROAS tracking for paid subs | `attribution-v2-manager-checklist.md` Task 3 |
| 9 | Wire Purchase conversion in code (small PR) | Founder | One gtag call in `thank-you/subscription/page.tsx` + `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` env | Small commit — thank-you page localStorage guard + CAPI infra already in place |
| 10 | Fix Google OAuth login not firing Meta `Login` event | Founder | Closes login funnel for Google users | Section 9 gap #3 |
| 11 | Add fbc/fbp cookies to Meta CAPI payloads | Founder | Better Meta match quality | Section 9 gap #5 |
| 12 | Migrate internal `analytics-logs/` to Prisma / external sink | Founder | Fixes Vercel filesystem non-persistence | Section 9 gap #6 |
| 13 | Promote Meta Pixel ID + API version to env vars | Founder | Rotation without code deploy | Section 9 gap #7 |
| 14 | Implement server-side Google Ads Enhanced Conversions for Leads (mirror Meta CAPI) | Founder | Adblocker-proof + iOS14+ attribution | `attribution-v2-plan.md` §12 |
| 15 | Build OCI (Offline Conversion Import) pipeline for paid subscriptions | Founder | Upload paid-sub events to Google Ads by gclid within 14-day lookback | `attribution-v2-plan.md` §12 |
| 16 | Additional micro-conversions: `workflow_saved`, `trial_started`, `teammate_invited`, `boq_generated` | Founder | Smart-bidding signal density (10x improvement per Google docs) | — |
| 17 | Bing Ads UET / LinkedIn Insight pixel (when budget allocated) | Founder + Manager | Attribution on those platforms | Section 9 gap #12 |
| 18 | Add `bf_attr_last` cookie (last-touch companion) | Founder | Better OCI match rate if first-touch gclid stale | `attribution-v2-plan.md` §12 |

---

## Section 14 — Manager Handoff

**Forward this section as-is to vibecoders786@gmail.com** — it's written for a non-technical reader.

### 14.1 Immediately (this week)

Follow the three tasks in `docs/attribution-v2-manager-checklist.md`:

1. **Archive stale Sign-up (1) and Sign-up (2)** in Google Ads → Goals → Conversions. Leave Sign-up (3) alone.
2. **Screenshot the GTM container tag list** (`tagmanager.google.com` → container `GTM-MD563HH5` → Tags) and email vibecoders. Do not edit anything.
3. **Create the Purchase conversion action** in Google Ads. Use category "Purchase", count "One", click-through window 30 days. When you get to the "Install tag" screen, copy the label (the part after `AW-18089516768/`) and email vibecoders. DO NOT install the code snippet yourself.

### 14.2 What NOT to do, ever

- Do not create "Sign-up (4)", "Sign-up (5)", etc. If you want to change how signups are counted, email vibecoders first.
- Do not install Google's suggested conversion-tracking code snippet on any page. Our developer handles that.
- Do not add, edit, or pause tags inside Google Tag Manager. View-only.
- Do not share `vibecoders786@gmail.com` password with anyone. Use Google Ads' "add user" feature instead.

### 14.3 What you'll see when it's live

After vibecoders deploys + flips the kill switch (estimated 1 business day after you finish Task 2):

- Google Ads → Goals → Conversions → **Sign-up (3)** → **Diagnostics** — a green "Recording conversions" indicator will appear within 3-24 hours
- Google Ads → Reports → Conversions — signup count starts accumulating
- Meta Events Manager → pixel `2072969213494487` — CompleteRegistration events show a **Deduplicated** badge (that's correct behaviour — means browser + server events are being matched)

### 14.4 What happens next

Once the signup conversion is verified live, vibecoders adds the Purchase conversion (depends on you finishing Task 3). Then we can turn on smart bidding strategies that target ROAS instead of just cost-per-signup.

### 14.5 Questions you might have

**Q: Why did we have THREE "Sign-up" conversions?**
A: Each time you clicked "New conversion action" for signup, a new action was created. Only the newest one — "Sign-up (3)" — is wired to fire. The other two were counting nothing.

**Q: Why does the Purchase conversion not work yet?**
A: We haven't created it yet. That's Task 3. Once you do it and send vibecoders the label, it takes ~30 minutes of developer work to wire in.

**Q: Why is there a "kill switch"?**
A: Safety. If something about the GTM container or tag setup is wrong, we don't want to pollute the ads account with bad conversion data. The switch stays OFF until you screenshot GTM and we verify nothing's double-firing. Then we flip it ON.

**Q: Why am I being asked to do any of this? The developer usually does it all.**
A: The pieces that require being logged in to Google Ads / GTM must be done by an account with access. That's you. The code is ready and waiting.

---

## Appendix — Source Code Map (quick reference)

| Concern | File |
|---|---|
| Tracking script loaders | `src/shared/components/TrackingScripts.tsx` |
| Consent Mode v2 default | `src/app/layout.tsx:258-270` |
| Cookie consent banner + update | `src/shared/components/CookieConsent.tsx`, `src/lib/cookie-consent.ts` |
| Meta Pixel helpers | `src/lib/meta-pixel.ts` |
| Meta CAPI helpers | `src/lib/server-conversions.ts` |
| GTM dataLayer helpers + Enhanced Conversions | `src/lib/gtm.ts` |
| Attribution cookie (zod schema + capture) | `src/lib/attribution.ts` |
| URL param extraction (UTM + click IDs) | `src/lib/utm.ts` |
| Middleware — attribution cookie write | `middleware.ts` |
| Page view tracking on SPA nav | `src/shared/components/UTMCapture.tsx` |
| Register page (email signup) | `src/app/(auth)/register/page.tsx` |
| Register API route | `src/app/api/auth/register/route.ts` |
| Login page | `src/app/(auth)/login/page.tsx` |
| Auth config + events.createUser | `src/lib/auth.ts`, `src/lib/auth.config.ts` |
| Signup conversions hook | `src/features/auth/hooks/useSignupConversions.ts` |
| OAuth post-redirect fire | `src/features/auth/components/OAuthSignupConversionFire.tsx` |
| Onboard page (mounts OAuth fire) | `src/app/onboard/page.tsx` |
| Thank-you / purchase pixel | `src/app/thank-you/subscription/page.tsx` |
| Stripe webhook (purchase CAPI) | `src/app/api/stripe/webhook/route.ts` |
| Razorpay webhook (purchase CAPI) | `src/app/api/razorpay/webhook/route.ts` |
| First-execution gate (server) | `src/app/api/executions/[id]/route.ts` |
| First-execution gate (client push) | `src/features/execution/hooks/useExecution.ts` |
| Internal event log / analytics | `src/lib/analytics.ts`, `src/lib/track.ts`, `src/app/api/analytics/route.ts` |
| Survey funnel events | `src/features/onboarding-survey/lib/survey-analytics.ts` |
| Landing page CTA events | `src/app/page.tsx`, `src/features/landing/components/NewsletterSignup.tsx`, `src/app/book-demo/page.tsx` |
| Canvas share events | `src/features/canvas/components/toolbar/CanvasToolbar.tsx` |
| Exit-intent events | `src/features/marketing/components/ExitIntentModal.tsx` |

---

**Last updated:** 2026-04-22 (post-completion of `feat/attribution-v2` branch, HEAD `3be75ae`, prior to merge). Update this timestamp + the HEAD ref whenever material changes to marketing instrumentation land.
