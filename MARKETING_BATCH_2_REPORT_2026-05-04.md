# Marketing Batch 2 Report — 2026-05-04

## 1. Executive Summary

4 fixes shipped — every paid customer is now permanently attributable to the campaign that drove them:

1. 🔴 **User model UTM fields** — 8 nullable attribution columns + 2 indexes added to `User` via additive-only Prisma migration. Zero risk to existing data.
2. 🔴 **Persist UTMs on signup** — Credentials signups read UTMs from sessionStorage and write them into the User row at creation. Google OAuth signups stash UTMs in a short-lived cookie (`bf_pending_utm`) before redirect, then the `events.createUser` handler reads it and updates the User row.
3. 🔴 **Webhooks enrich CAPI + Google Ads with UTMs** — Both Razorpay and Stripe webhooks now look up the user's stored UTMs and pass them into `trackServerPurchase()` as `custom_data` for Meta CAPI. Thank-you page pushes UTMs from sessionStorage into Google Ads conversion params. Razorpay also now passes `phone` (parity fix from BATCH 1 audit).
4. 🟡 **Book-demo form UTMs** — Form now reads sessionStorage UTMs and includes `utmSource/utmMedium/utmCampaign` in the POST body. API already accepted these fields.

---

## 2. Per-Fix Verification

### Fix 1: User Model UTM Fields

**File:** `prisma/schema.prisma`

**Added to User model (lines 40-47):**
```prisma
utmSource              String?
utmMedium              String?
utmCampaign            String?
utmTerm                String?
utmContent             String?
referrer               String?
landingPage            String?
acquisitionDate        DateTime?
```

**Indexes added (lines 68-69):**
```prisma
@@index([utmSource])
@@index([utmCampaign])
```

**Contract preserved:** All existing User fields unchanged. All new fields nullable. No existing column modified.

---

### Fix 2: Persist UTMs on Signup

**Files:** `src/app/(auth)/register/page.tsx`, `src/app/api/auth/register/route.ts`, `src/lib/auth.ts`

**2a — Credentials client (register/page.tsx):**
```typescript
import { getUTMParams } from "@/lib/utm";
// ...
const utms = getUTMParams();
if (utms?.utm_source) body.utmSource = utms.utm_source;
// ... (all 5 UTM fields + document.referrer)
```

**2b — Credentials server (register/route.ts):**
```typescript
const user = await prisma.user.create({
  data: {
    // ... existing fields ...
    utmSource: safeStr(utmSource),
    utmMedium: safeStr(utmMedium),
    utmCampaign: safeStr(utmCampaign),
    utmTerm: safeStr(utmTerm),
    utmContent: safeStr(utmContent),
    referrer: safeStr(clientReferrer),
    acquisitionDate: new Date(),
  },
});
```

**2c — Google OAuth (auth.ts events.createUser):**
- Before OAuth redirect: register page sets `bf_pending_utm` cookie (max-age 600s)
- After OAuth creates user: `events.createUser` reads cookie, parses UTMs, updates User row, clears cookie
- If cookie is absent (direct OAuth without landing page UTMs): no-op, fields stay null

**Contract preserved:** No modification to OAuth provider config, session/JWT callbacks, existing `bf_signup_just_created` cookie logic, validation, password hashing, or response shapes.

---

### Fix 3: Webhooks → CAPI + Google Ads UTM Enrichment

**Files:** `src/lib/server-conversions.ts`, `src/app/api/razorpay/webhook/route.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/thank-you/subscription/page.tsx`

**Razorpay changes:**
- User select extended to include `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`
- `trackServerPurchase()` call now includes `phone: user.phoneNumber` (parity fix) and `utmData` map
- Fire-and-forget `.catch()` preserved

**Stripe changes:**
- checkoutUser select extended with same UTM fields
- `trackServerPurchase()` call now includes `utmData` map
- Existing `phone` param untouched

**Thank-you page changes:**
- Imports `getUTMParams` from `@/lib/utm`
- `purchase_complete` GTM event now includes `campaign_source`, `campaign_medium`, `campaign_name`
- Google Ads conversion now includes `campaign_source`, `campaign_name`
- BATCH 1 idempotency guard untouched

**Contract preserved:** Webhook signature verification, subscription state machine, response codes, event payloads — all unchanged.

---

### Fix 4: Book-Demo Form UTMs

**File:** `src/app/book-demo/page.tsx`

```typescript
import { getUTMParams } from "@/lib/utm";
// ...
const utms = getUTMParams();
const payload = {
  ...formData,
  ...(utms?.utm_source && { utmSource: utms.utm_source }),
  ...(utms?.utm_medium && { utmMedium: utms.utm_medium }),
  ...(utms?.utm_campaign && { utmCampaign: utms.utm_campaign }),
};
```

**Contract preserved:** No UI change. No form field change. No server-side modification. API already accepted these fields.

---

## 3. Prisma Migration

**Path:** `prisma/migrations/20260504060354_add_user_utm_attribution/migration.sql`

**Full SQL:**
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "acquisitionDate" TIMESTAMP(3),
ADD COLUMN     "landingPage" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateIndex
CREATE INDEX "users_utmSource_idx" ON "users"("utmSource");

-- CreateIndex
CREATE INDEX "users_utmCampaign_idx" ON "users"("utmCampaign");
```

**Confirmation:** Additive only. Zero `DROP` statements. Zero `ALTER` on existing columns. All new columns are nullable — no backfill required. Existing rows get `NULL` for all new fields.

---

## 4. Auth.js Integration Detail

**Hook used:** `events.createUser` (Auth.js v5)

**Why this hook:** It fires exclusively when the PrismaAdapter inserts a new User row — which only happens on Google OAuth first sign-in. Credentials signups go through `/api/auth/register` directly and never trigger this event. This makes it the exact right place for OAuth-specific UTM persistence.

**Cookie approach:** The register page sets a `bf_pending_utm` cookie before calling `signIn("google", ...)`. The cookie contains JSON-stringified UTMs from sessionStorage. In `events.createUser`, the server reads this cookie via `cookies()` (already imported and used for `bf_signup_just_created`), parses the UTM data, and calls `prisma.user.update()` to persist them. The cookie is cleared after successful persistence.

**Why not `signIn` callback:** The `signIn` callback fires on every sign-in (new and returning users), not just first-time signups. Using `events.createUser` ensures UTMs are only written once, for new users only, without needing a `createdAt`-based heuristic.

---

## 5. `trackServerPurchase` Signature Change

**Before:**
```typescript
export async function trackServerPurchase(params: {
  userId: string;
  email: string;
  phone?: string | null;
  firstName?: string;
  plan: string;
  currency?: string;
  value?: number;
  ip?: string;
  userAgent?: string;
}): Promise<void>
```

**After:**
```typescript
export async function trackServerPurchase(params: {
  userId: string;
  email: string;
  phone?: string | null;
  firstName?: string;
  plan: string;
  currency?: string;
  value?: number;
  ip?: string;
  userAgent?: string;
  utmData?: Record<string, string | undefined>;  // NEW
}): Promise<void>
```

**Call sites updated:**
1. `src/app/api/razorpay/webhook/route.ts` — added `phone` + `utmData`
2. `src/app/api/stripe/webhook/route.ts` — added `utmData`

**Fire-and-forget pattern preserved:** Both call sites still use `.catch(err => console.warn("[meta-capi]", err))`.

---

## 6. UTM Data Flow Diagram

```
Landing Page (?utm_source=meta&utm_campaign=spring_2026)
    │
    ▼
UTMCapture component → captureUTMParams() → sessionStorage["buildflow-utm"]
    │
    ├─── CREDENTIALS SIGNUP ─────────────────────────────────────────
    │       │
    │       ▼ register/page.tsx reads getUTMParams()
    │       │ merges into POST body
    │       ▼
    │    /api/auth/register → prisma.user.create({ utmSource, utmCampaign, ... })
    │       │
    │       ▼ User row has UTMs ✅
    │
    ├─── GOOGLE OAUTH ───────────────────────────────────────────────
    │       │
    │       ▼ register/page.tsx sets cookie bf_pending_utm
    │       │ signIn("google", ...)
    │       ▼
    │    auth.ts events.createUser → reads bf_pending_utm cookie
    │       │ prisma.user.update({ utmSource, utmCampaign, ... })
    │       │ clears cookie
    │       ▼ User row has UTMs ✅
    │
    ├─── RAZORPAY PURCHASE ──────────────────────────────────────────
    │       │
    │       ▼ webhook looks up user with UTM select
    │       │ trackServerPurchase({ utmData: { utm_source, ... } })
    │       ▼ Meta CAPI Purchase event has custom_data.utm_source ✅
    │
    ├─── STRIPE PURCHASE ────────────────────────────────────────────
    │       │
    │       ▼ same pattern as Razorpay
    │       ▼ Meta CAPI Purchase event has custom_data.utm_source ✅
    │
    ├─── THANK-YOU PAGE ─────────────────────────────────────────────
    │       │
    │       ▼ reads getUTMParams() from sessionStorage
    │       │ pushToDataLayer("purchase_complete", { campaign_source, campaign_name, ... })
    │       │ trackAdsConversion({ campaign_source, campaign_name })
    │       ▼ Google Ads conversion has campaign params ✅
    │
    └─── BOOK-DEMO FORM ─────────────────────────────────────────────
            │
            ▼ reads getUTMParams() from sessionStorage
            │ POST /api/book-demo { utmSource, utmMedium, utmCampaign }
            ▼ DemoRequest row has UTMs ✅
```

---

## 7. tsc + Build + Prisma Output

**TypeScript:** `npx tsc --noEmit` — zero errors (clean output).

**Build:** `npm run build` — succeeded. All routes compiled.

**Tests:** 4 failed / 165 passed (same baseline as main — pre-existing failures in IFC viewcube + brief-renders).

**Prisma:** `npx prisma migrate status` — "Database schema is up to date!" (23 migrations applied).

**Prisma generate:** succeeded, new UTM fields present in generated client types.

---

## 8. Files NOT Touched

Explicitly confirmed untouched:
- ❌ Thank-you redesign visuals (layout, animations, copy, icons)
- ❌ BATCH 1 idempotency guard (preserved, UTM push added after it)
- ❌ BATCH 1 free-tier constant, double-rupee fix, EUR→INR, USD→INR, showcase keys, pricing CTA routing
- ❌ Subscription state machine (activate/cancel/upgrade logic)
- ❌ Razorpay/Stripe signature verification
- ❌ Phase 4a IFC enhance code
- ❌ Floor plan VIP pipeline
- ❌ IFC viewer, dashboard, canvas, BOQ visualizer
- ❌ Auth middleware / `auth.config.ts`
- ❌ Billing amounts, plan prices, rate-limiting logic
- ❌ `UTMCapture.tsx` component (not modified)
- ❌ `package.json` / `package-lock.json`
- ❌ Existing `UserSurvey` UTM fields (parallel capture, untouched)

---

## 9. Smoke-Test Checklist for Rutik

- [ ] Visit homepage with `?utm_source=meta&utm_campaign=test_batch2&utm_medium=paid_social` → sign up with email/password → check DB: `SELECT email, "utmSource", "utmCampaign", "utmMedium", "acquisitionDate" FROM users ORDER BY "createdAt" DESC LIMIT 1` → all fields populated
- [ ] Same flow with Google OAuth → confirm UTMs land on User row (check `bf_pending_utm` cookie is cleared after)
- [ ] Sign up WITHOUT UTMs (direct visit) → confirm User row has nulls for UTM fields, no error
- [ ] Complete a Razorpay test purchase as a user with UTMs → check Meta Events Manager → server Purchase event has `custom_data` fields with `utm_source`/`utm_campaign`
- [ ] Same purchase → check Google Ads conversion has `campaign_source`/`campaign_name` params in the GTM dataLayer push
- [ ] Submit a book-demo with UTMs in URL → check DB: `SELECT "utmSource", "utmMedium", "utmCampaign" FROM demo_requests ORDER BY "createdAt" DESC LIMIT 1` → UTM fields populated
- [ ] Run `SELECT "utmCampaign", COUNT(*) FROM users WHERE "utmCampaign" IS NOT NULL GROUP BY "utmCampaign"` → confirm shape ready for Prajakta's reports
- [ ] Refresh thank-you page → confirm Purchase event does NOT double-fire (BATCH 1 idempotency guard still works)
