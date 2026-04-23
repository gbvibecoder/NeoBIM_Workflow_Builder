# Razorpay Graceful-Errors + Env-Validation Fix — 2026-04-23

**Branch:** `fix/razorpay-graceful-errors-and-env-validation` (off `origin/main`)
**Status:** Working tree committed in 6 functional commits + 1 docs commit. Pushed to remote. **No PR opened — Rutik opens it manually.**

---

## Background — what happened on 2026-04-23

Production checkout broke around mid-day IST. Two symptoms:
1. Red toast **"Failed to start checkout. Please try again."** when clicking *Upgrade to Mini*.
2. Razorpay's own **"Oops! Payment Failed"** modal when the flow somehow got further.

Root cause confirmed by Rutik: `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Vercel were from different rotations (key ID and secret had desynced over a previous rotation). Razorpay's API returned a SERVER_ERROR 500 with sparse fields (NA/NA/NA) instead of a clean 401, because the ID resolved but signature validation on `subscriptions.create` failed internally.

Evidence: 4 successful captured payments between Apr 16–22 prove the account, plans, and feature activation are fine. Failure started Apr 23 — matches the timeline of the desynced key pair. **Already fixed in Vercel** by regenerating the key pair + webhook secret and redeploying.

This branch ships the *code-side* hardening so future env-var or SDK-error regressions are visible, actionable, and impossible to deploy unnoticed.

---

## Task A — Comprehensive review findings

| Concern | Result |
|---|---|
| Stripe path regression | ✓ Clean — `handleStripeCheckout`, `/api/stripe/*`, all Stripe state untouched. The legacy `t('billing.checkoutFailed')` toast on line 203 is the Stripe path's, kept verbatim. |
| Webhook path regression | ✓ Clean — `verifyWebhookSignature()`, `/api/razorpay/webhook/route.ts`, `/api/razorpay/verify/route.ts` all untouched. |
| One-time payment regression | ✓ N/A — repo has no `orders.create` path; Razorpay flow is subscriptions-only. |
| `any` / `@ts-ignore` | ✓ Zero. All casts go through narrow interfaces (`RazorpaySdkError`, `{ Razorpay?: ... }`). |
| Razorpay SDK error coverage | ✓ Full coverage of `{ statusCode, error.{code,description,field,step,reason} }`, `message`, `code`. 401/403 now classify as `AUTHENTICATION_ERROR` so the user is asked to refresh, not blame the payment service. |
| `PAYMENT_FAILED` modal state | ✓ Added explicit copy ("Payment didn't go through. Your bank declined or cancelled the payment.") — no longer falls into the generic default bucket. |
| Type tightening | ✓ `PaymentErrorCode` union changed from `\| string` to a discriminated set of 5 known codes. |

---

## Task B + C — Edge cases tightened

### Server (`src/app/api/razorpay/checkout/route.ts`)
- **Outer try/catch already wrapped the whole handler** — confirmed. Auth/Prisma/rate-limit failures still return structured `formatErrorResponse(UserErrors.INTERNAL_ERROR)` 500 body, not raw exceptions.
- Added `console.warn('[razorpay/checkout] classified as:', { code, status, razorpayCode })` so dashboards can chart bucket frequency without parsing the full SDK error.

### Client (`src/app/dashboard/billing/page.tsx`)
- **AbortController 30s timeout** around `/api/razorpay/checkout` fetch. A hung edge proxy used to keep the spinner alive forever; now it aborts cleanly into `PAYMENT_SERVICE_UNAVAILABLE` after 30s with the message "Checkout request timed out after 30 seconds." `clearTimeout` runs in `finally` so the timer never leaks.
- **try/catch around `new Razorpay(...)`** constructor — rare stale-CDN scenarios where the SDK loads but initializes badly are now caught and surfaced as `PAYMENT_SERVICE_UNAVAILABLE` instead of unhandled exceptions.
- **`rzp.on('payment.error', ...)`** added alongside `payment.failed`. Razorpay fires `payment.failed` for declined/cancelled bank flows but `payment.error` for SDK-internal issues. Both now share the same handler; neither outcome falls through to a stale spinner.
- **401/403 → `AUTHENTICATION_ERROR`** classification on the client so session-expired users are guided to refresh, not blamed for payment failure.

### Modal (`src/features/billing/components/PaymentErrorModal.tsx`)
- **`PAYMENT_FAILED` state** — "Payment didn't go through. Your bank declined or cancelled the payment. Try again, or use a different payment method."
- **`AUTHENTICATION_ERROR` state** — "We couldn't verify your account. Please refresh the page and sign in again." Primary CTA becomes "Refresh" (RefreshCw icon) and triggers `window.location.reload()`.
- **Escape key** closes the modal (window keydown listener, scoped to `open` state, cleaned up on unmount).
- **Focus trap** — initial focus lands on the first focusable element on open; `Tab` / `Shift+Tab` cycles within the dialog; original focus is restored to the opener button on close. Implemented manually with a ref + `querySelectorAll` so no new dependency.
- **`PaymentErrorCode` union tightened** — `\| string` removed, replaced with discriminated set of `PAYMENT_SERVICE_UNAVAILABLE | PLAN_UNAVAILABLE | PAYMENT_FAILED | AUTHENTICATION_ERROR | UNKNOWN`.
- **Slide-up-and-fade entrance** instead of scale (less abrupt; `y: 16 → 0` + opacity).
- **Backdrop migrated to Tailwind `backdrop-blur-sm`** instead of inline `backdropFilter`.
- **Amber color migrated to design token** — `colors.warning` from `@/constants/design-tokens` replaces hardcoded `#F59E0B` literals. (The brighter gradient stop `#FBBF24` stays inline — no JS-importable token exists for it and adding one would touch design-tokens.ts which is outside scope.)
- All copy reviewed: calm tone, never blames the user, always actionable. Empathetic Wrench icon kept.

---

## Task D — Commits (independently revertible, each explains WHY)

```
7b1d380  feat(env): validate Razorpay env vars at boot, enforce key mode parity
b2a8c96  feat(billing): classify Razorpay SDK errors into structured response codes
732ac27  feat(billing): remove rzp_placeholder fallback in production
a63d85a  feat(billing): add graceful PaymentErrorModal replacing red toast
1232fb7  feat(billing): unswallow checkout error + surface real reason to modal
5a98cd4  feat(billing): handle payment.error event + checkout timeout + modal a11y
<this>   docs(billing): full review report with manual test checklist
```

**Diff stat from `origin/main`:**

| File | Net change |
|---|---:|
| `src/lib/env.ts` | +112 / −1 |
| `src/app/api/razorpay/checkout/route.ts` | +97 / −2 |
| `src/features/billing/lib/razorpay.ts` | +25 / −5 |
| `src/features/billing/components/PaymentErrorModal.tsx` | +271 (new) |
| `src/app/dashboard/billing/page.tsx` | +183 / −36 |
| **Total** | **+668 / −44** across 5 files |

The reorganisation of commits 1→6 means each commit is independently revertible without breaking compile/lint. Commit 1 (env validation) and commit 2 (server classification) are also independently safe to backport to other branches.

---

## Task E — Validation output

### `npx tsc --noEmit`
```
TSC EXIT: 0
(no output)
```

### `npm run build`
```
BUILD EXIT: 0
├ ƒ /onboard
├ ○ /pricing
├ ○ /privacy
├ ○ /register
├ ○ /reset-password
├ ƒ /share/[slug]
├ ○ /sitemap.xml
├ ○ /templates
├ ● /templates/[slug]
│ ├ /templates/pdf-brief-to-ifc-to-video-walkthrough
│ ├ /templates/text-prompt-to-floor-plan
│ ├ /templates/floor-plan-to-render-to-video-walkthrough
│ └ [+6 more paths]
├ ○ /terms
├ ○ /thank-you/subscription
├ ○ /verify-email
└ ○ /workflows
```

### Env validator harness (4 cases, all PASS)
```
PASS mode-mismatch throws
PASS prod missing throws
PASS dev missing only warns
PASS matched + complete passes
```

---

## Manual test checklist for Rutik

Run each in order against the deployed preview (or `npm run dev`) before merging.

### Happy paths (regression sanity — these MUST still work)
- [ ] Open `/dashboard/billing` in **Incognito**, sign in as a fresh FREE user, click **Upgrade to Mini** → choose UPI → Razorpay modal opens → complete the ₹99 test payment → role updates to MINI, redirect to `/thank-you/subscription?plan=MINI`.
- [ ] Repeat in **Incognito** with **Upgrade to Pro** → confirm modal also opens for the higher-tier plan (proves the flow isn't Mini-specific).
- [ ] **Stripe path still works** — same page, click *International cards* → Stripe Checkout loads on `checkout.stripe.com`, complete with `4242 4242 4242 4242`, role updates.

### New error UX (the whole point of this branch)
- [ ] **PAYMENT_SERVICE_UNAVAILABLE** — temporarily comment out `RAZORPAY_KEY_SECRET` in `.env.local`, restart dev server, attempt upgrade → amber modal shows **"Payment service is temporarily unavailable"** with Wrench icon. NO red toast. Console shows `[billing/razorpay] checkout failed: …` with the real Razorpay error. Restore env, restart.
- [ ] **PLAN_UNAVAILABLE** — temporarily set `RAZORPAY_MINI_PLAN_ID=plan_BOGUS` in `.env.local`, restart, attempt Mini upgrade → modal shows **"This plan is temporarily unavailable"**. Restore env.
- [ ] **PAYMENT_FAILED** (in-modal) — using the live Razorpay test mode (set `RAZORPAY_KEY_ID=rzp_test_…` + matching test plan IDs), open the modal, enter Razorpay's documented decline card `5267 3181 8797 5449` → after the failure, the new amber modal appears with **"Payment didn't go through"**. Console shows `[billing/razorpay] payment.failed event:` with the bank's error.
- [ ] **AUTHENTICATION_ERROR** — manually expire the session (delete the `next-auth.session-token` cookie in DevTools), click upgrade → modal shows **"We couldn't verify your account"** with a "Refresh" button. Click Refresh → page reloads, sign-in flow appears.
- [ ] **Checkout timeout** — in DevTools Network tab, set throttling to "Offline" briefly OR add a 35s delay to `/api/razorpay/checkout` and click upgrade → after 30s the modal appears with **"Payment service is temporarily unavailable"** + "Checkout request timed out after 30 seconds" — no infinite spinner.

### Modal a11y
- [ ] When the modal opens, focus lands on the **Try again** button (visible blue ring). Press `Tab` → focus moves to **Contact support**, then back to the close `X`. `Shift+Tab` cycles backwards. Tab does **not** escape the modal into the page behind.
- [ ] Press `Escape` → modal closes. Focus returns to the original "Upgrade to Mini" button.
- [ ] Click the dimmed backdrop → modal closes.

### Boot env validation
- [ ] Edit `.env.local` to make `RAZORPAY_KEY_ID="rzp_live_…"` and `NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_…"` (mode mismatch). Restart `npm run dev` → server fails to boot with `❌ RAZORPAY KEY MODE MISMATCH:` showing both vars and their detected modes. Revert.
- [ ] In a temp shell: `NODE_ENV=production npx tsx -e 'import("./src/lib/env").then(m => m.validateRazorpayEnv({NODE_ENV:"production"}))'` → expect throw with `❌ RAZORPAY ENV VALIDATION FAILED`.
- [ ] In dev, unset all Razorpay vars (`unset RAZORPAY_KEY_ID …`). Restart dev → expect `⚠️  Razorpay env vars missing (dev) — payment flow will fail at runtime:` warning, server still boots.

### Webhook regression sanity
- [ ] In Razorpay dashboard → Webhooks → use **"Send test webhook"** with a `subscription.activated` event. Verify the receiver returns 200 (signature validates). Look for `[RAZORPAY_WEBHOOK] Event received:` in Vercel logs. Confirms `verifyWebhookSignature()` was not regressed — webhook secret rotation is properly picked up.

### Server-side classification
- [ ] Hit `/api/razorpay/checkout` with a malformed payload (e.g. invalid `plan: "FOO"` via curl) → response body is `{ error: { title, message, code: "VAL_001", … } }`, status 400. Confirms structured error wire-format unchanged for non-Razorpay-SDK errors.
- [ ] Force a Razorpay SDK error (point `RAZORPAY_MINI_PLAN_ID` at a deleted plan) → response body has `{ error: { code: "PLAN_UNAVAILABLE", razorpayCode: "BAD_REQUEST_ERROR", message, title } }` with status 422. Vercel log shows `[razorpay/checkout] classified as: { code: 'PLAN_UNAVAILABLE', status: 422, razorpayCode: 'BAD_REQUEST_ERROR' }`.

---

## Forbidden list — confirmed clean

- ✓ No changes outside billing/env path (no IFC, no Enhance, no 3D, no floor-plan, no admin, no Stripe).
- ✓ No new dependencies (`package.json` untouched).
- ✓ No merge to main.
- ✓ No `gh pr create` / `gh pr merge` / any auto-merge.
- ✓ No force pushes.
- ✓ Zero `any`, zero `@ts-ignore`, zero `prisma db push`.

---

**READY FOR MANUAL REVIEW + MERGE.**
