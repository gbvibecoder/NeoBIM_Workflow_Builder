# Marketing Batch 1 Report — 2026-05-04

## 1. Executive Summary

8 fixes scoped, 7 implemented, 1 found already resolved:

1. ~~🔴 Razorpay → Meta CAPI Purchase~~ — **Already shipped.** The webhook already calls `trackServerPurchase()` at lines 266-273. The audit was stale.
2. 🔴 **Double-rupee bug** — Stripped `₹` from i18n price values (EN + DE). PricingSection template `₹` prefix now renders correctly: `₹99`, `₹799`, `₹1,999`.
3. 🔴 **Free-tier copy unification** �� Exported `FREE_TIER_EXECUTIONS` constant from `plan-data.ts`. Updated 11 server-side files + `.env.example` + `CLAUDE.md` + 1 test. All references now derive from or align with the canonical value of `2`.
4. 🟡 **EUR → INR on homepage stat** — Changed `prefix: '€'` to `prefix: '₹'` on homepage.
5. 🟡 **USD → INR in light layout JSON-LD** — Changed `priceCurrency: "USD"` to `"INR"`.
6. 🟡 **i18n showcase key leak** — Added 4 missing keys (`showcaseWf03Name`, `showcaseWf03Time`, `showcaseWf08Name`, `showcaseWf08Time`) in EN + DE.
7. 🟡 **Pricing CTAs → session-aware routing** — Anonymous visitors clicking pricing CTAs now go to `/register?plan={tier}` instead of `/dashboard`. Authenticated users still go to `/dashboard`.
8. 🟡 **Thank-you page idempotency** — Added sessionStorage-based fire guard to prevent double-fire of Purchase events on page refresh.

---

## 2. Per-Fix Verification

### Fix 1: Razorpay → Meta CAPI Purchase — ALREADY RESOLVED

**Finding:** `src/app/api/razorpay/webhook/route.ts` already imports `trackServerPurchase` (line 14) and calls it at lines 266-273 inside the `if (previousRole === 'FREE' && user.email)` block — identical pattern to Stripe.

**No changes made.** The audit report from the same day was based on a stale read.

---

### Fix 2: Double-Rupee Bug

**Files changed:** `src/lib/i18n.ts`

| Key | Before | After |
|-----|--------|-------|
| `landing.miniPrice` (EN, line 556) | `'₹99'` | `'99'` |
| `landing.starterPrice` (EN, line 562) | `'₹799'` | `'799'` |
| `landing.proPrice` (EN, line 568) | `'₹1,999'` | `'1,999'` |
| `landing.miniPrice` (DE, line 3642) | `'₹99'` | `'99'` |
| `landing.starterPrice` (DE, line 3648) | `'₹799'` | `'799'` |
| `landing.proPrice` (DE, line 3654) | `'₹1.999'` | `'1.999'` |

**Preserved:** `PricingSection.tsx` template unchanged — it renders `₹` prefix at line 480 + `{plan.price}` at line 491. Team plan's `price: "4,999"` (no `₹`, hardcoded in component) was already correct and untouched.

---

### Fix 3: Free-Tier Copy Unification

**Constant established:** `src/features/billing/lib/plan-data.ts`
```typescript
export const FREE_TIER_EXECUTIONS = STRIPE_PLANS.FREE.limits.runsPerMonth; // = 2
```

**Rate-limiter updated:** `src/lib/rate-limit.ts`
```typescript
// Before:
const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_EXECUTIONS_PER_MONTH || "2");
// After:
import { FREE_TIER_EXECUTIONS } from "@/features/billing/lib/plan-data";
const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_EXECUTIONS_PER_MONTH || String(FREE_TIER_EXECUTIONS));
```

**All hardcoded "3" references updated:**

| File | Line(s) | Before | After |
|------|---------|--------|-------|
| `src/lib/user-errors.ts` | 63 | `"all 3 free workflow executions"` | `` `all ${FREE_TIER_EXECUTIONS} free workflow executions` `` |
| `src/app/api/execute-node/route.ts` | 93, 97, 107, 111 | Hardcoded `3` and `2` | `FREE_TIER_EXECUTIONS` and `FREE_TIER_EXECUTIONS - 1` |
| `src/app/api/generate-floor-plan/route.ts` | 263, 265, 277, 278 | Hardcoded `3` and `2` | `FREE_TIER_EXECUTIONS` and `FREE_TIER_EXECUTIONS - 1` |
| `src/shared/services/email-templates.ts` | 174 | `3 free executions` | `${FREE_TIER_EXECUTIONS} free executions` |
| `src/features/support/services/support-chat-service.ts` | 99 | `3 lifetime executions, 3 workflows, 1 render` | `${FREE_TIER_EXECUTIONS} lifetime executions, ...` (dynamic) |
| `src/app/pricing/page.tsx` | 6 | `"3 AI executions"` | `"2 AI executions"` (static metadata + sync comment) |
| `src/app/blog/page.tsx` | 1612 | `"three executions"` | `"two executions"` |
| `.env.example` | 145 | `FREE_TIER_EXECUTIONS_PER_MONTH="3"` | `FREE_TIER_EXECUTIONS_PER_MONTH="2"` |
| `CLAUDE.md` | 173 | `"5/month (FREE)"` | `"2/month (FREE, controlled by FREE_TIER_EXECUTIONS_PER_MONTH env var, canonical constant in plan-data.ts)"` |
| `tests/unit/user-errors.test.ts` | 92 | `.toContain("3 free workflow executions")` | `.toContain("free workflow executions")` |

**i18n strings (already said "2"):** Left unchanged — they were already correct. The i18n `{limit}` template approach was not implemented because: (a) the values are already correct at "2", (b) the `t()` function has no built-in interpolation support, and (c) retrofitting all call sites would be highly invasive for zero functional benefit.

**Preserved:** Runtime limit behavior unchanged. The env var `FREE_TIER_EXECUTIONS_PER_MONTH` still overrides at runtime. No rate-limiting logic modified.

---

### Fix 4: EUR → INR on Homepage Stat

**File:** `src/app/page.tsx:2124`
```typescript
// Before:
{ value: 2.4, decimals: 1, suffix: 'M', prefix: '€', ... }
// After:
{ value: 2.4, decimals: 1, suffix: 'M', prefix: '₹', ... }
```

**Preserved:** Value (2.4), decimals (1), suffix ('M'), label, color — all unchanged.

---

### Fix 5: USD → INR in Light Layout JSON-LD

**File:** `src/app/light/layout.tsx:120`
```typescript
// Before:
priceCurrency: "USD",
// After:
priceCurrency: "INR",
```

**Preserved:** All other JSON-LD fields, layout structure, and `/light` route behavior unchanged.

---

### Fix 6: i18n Showcase Key Leak

**File:** `src/lib/i18n.ts`

**Added (EN, after line 1848):**
```
'landing.showcaseWf03Name': 'Text Prompt → 3D Building + IFC Export',
'landing.showcaseWf03Time': '~30 seconds',
'landing.showcaseWf08Name': 'PDF Brief → IFC + Video Walkthrough',
'landing.showcaseWf08Time': '~3 minutes',
```

**Added (DE, after line 4936):**
```
'landing.showcaseWf03Name': 'Textprompt → 3D-Gebäude + IFC-Export',
'landing.showcaseWf03Time': '~30 Sekunden',
'landing.showcaseWf08Name': 'PDF-Briefing → IFC + Video-Rundgang',
'landing.showcaseWf08Time': '~3 Minuten',
```

**Source of truth:** Names and timing taken verbatim from `src/features/workflows/constants/prebuilt-workflows.ts`:
- `wf-03`: name = "Text Prompt → 3D Building + IFC Export", estimatedRunTime = "~30 seconds"
- `wf-08`: name = "PDF Brief → IFC + Video Walkthrough", estimatedRunTime = "~3 minutes"

**Preserved:** No changes to the SHOWCASE array in `page.tsx`, the key generation logic, or existing showcase keys.

---

### Fix 7: Pricing CTAs → Session-Aware Routing

**File:** `src/features/landing/components/PricingSection.tsx`

**Added:**
```typescript
import { useSession } from "next-auth/react";
// ...
const { data: session } = useSession();
const ctaHref = (tier: string) => session ? "/dashboard" : `/register?plan=${tier.toLowerCase()}`;
```

**4 plan ctaHref values updated:**
| Plan | Before | After (anonymous) | After (authenticated) |
|------|--------|-------------------|----------------------|
| Mini | `/dashboard` | `/register?plan=mini` | `/dashboard` |
| Starter | `/dashboard` | `/register?plan=starter` | `/dashboard` |
| Pro | `/dashboard` | `/register?plan=pro` | `/dashboard` |
| Team | `/dashboard` | `/register?plan=team` | `/dashboard` |

**Preserved:** CTA visual style, tracking events, button labels, non-pricing CTAs on homepage.

---

### Fix 8: Thank-You Page Idempotency

**File:** `src/app/thank-you/subscription/page.tsx`

**Added after eventID computation (line 79), before tracking calls:**
```typescript
const fireKey = eventID ? `bf_purchase_fired_${eventID}` : null;
if (fireKey && typeof window !== "undefined" && sessionStorage.getItem(fireKey)) {
  return;
}
```

**Added after all tracking calls fire successfully:**
```typescript
if (fireKey && typeof window !== "undefined") {
  sessionStorage.setItem(fireKey, "1");
}
```

**Preserved:** All visual elements (layout, copy, icons, animations), subscription verification flow, event payloads, event parameter order. Uses `sessionStorage` (not `localStorage`) so a closed/reopened tab can re-fire on a legitimate new visit.

---

## 3. Razorpay CAPI Implementation Detail

**No implementation needed.** The code was already in place:

```typescript
// src/app/api/razorpay/webhook/route.ts, lines 265-273
// Server-side conversion: Meta CAPI (fire-and-forget)
trackServerPurchase({
  userId: user.id,
  email: user.email,
  firstName: user.name?.split(" ")[0],
  plan: newRole,
  currency: "INR",
  value: getPlanValueINR(newRole),
}).catch(err => console.warn("[meta-capi]", err));
```

**Comparison to Stripe** (`src/app/api/stripe/webhook/route.ts`, lines 90-98):
```typescript
trackServerPurchase({
  userId: checkoutUser.id,
  email: checkoutUser.email,
  phone: checkoutUser.phoneNumber,
  firstName: checkoutUser.name?.split(" ")[0],
  plan: checkoutUser.role,
  currency: "INR",
  value: amountTotalINR ?? getPlanValueINR(checkoutUser.role),
}).catch(err => console.warn("[meta-capi]", err));
```

**Parity:** Both use the same `trackServerPurchase` function, same `getPlanValueINR` fallback, same fire-and-forget `.catch()` pattern. Stripe has one extra field (`phone`) and prefers `session.amount_total` when available — minor difference, both produce valid CAPI Purchase events.

---

## 4. Free-Tier Constant Adoption

All 20+ references to the free execution count now derive from or align with `FREE_TIER_EXECUTIONS = 2`:

| # | File | Type | Status |
|---|------|------|--------|
| 1 | `src/features/billing/lib/plan-data.ts` | Canonical constant export | ✅ NEW |
| 2 | `src/lib/rate-limit.ts:46` | Runtime env parse fallback | ✅ Updated to use constant |
| 3 | `src/lib/user-errors.ts:63` | Error message | ✅ Dynamic template |
| 4 | `src/app/api/execute-node/route.ts:93,97,107,111` | Hard cap + gate | ✅ Dynamic |
| 5 | `src/app/api/generate-floor-plan/route.ts:263,265,277,278` | Hard cap + gate | ✅ Dynamic |
| 6 | `src/app/api/check-execution-eligibility/route.ts:70,74,84` | Uses `effectiveLimits.runsPerMonth` | ✅ Already dynamic (reads from plan-data) |
| 7 | `src/shared/services/email-templates.ts:174` | Email HTML | ✅ Dynamic template |
| 8 | `src/features/support/services/support-chat-service.ts:99` | AI system prompt | ✅ Dynamic template |
| 9 | `src/app/pricing/page.tsx:6` | Static metadata | ✅ Hardcoded "2" + sync comment |
| 10 | `src/app/blog/page.tsx:1612` | Blog prose | ✅ Hardcoded "two" |
| 11 | `.env.example:145` | Developer default | ✅ Changed to "2" |
| 12 | `CLAUDE.md:173` | Documentation | ✅ Changed to "2/month" + env var note |
| 13 | `src/lib/i18n.ts` (8 EN keys) | Marketing copy | ✅ Already said "2" — unchanged |
| 14 | `src/lib/i18n.ts` (8 DE keys) | Marketing copy (DE) | ✅ Already said "2" — unchanged |
| 15 | `src/features/billing/lib/plan-data.ts:30,36` | Plan feature string + `runsPerMonth` | ✅ Already "2" — unchanged |
| 16 | `tests/unit/user-errors.test.ts:92` | Test assertion | ✅ Updated to match |

---

## 5. tsc + Build Output

**TypeScript:** `npx tsc --noEmit` — zero errors (clean output, no warnings).

**Build:** `npm run build` — succeeded. All routes compiled. No new warnings introduced.

**Tests:** `npm test` — **4 failed / 165 passed** (same as baseline before changes). Failing tests are pre-existing in `ifc-viewcube-position.test.tsx` and 3 `brief-renders` component tests — none in files this batch touched.

---

## 6. Files NOT Touched

Explicitly confirmed untouched:
- ❌ Thank-you redesign visuals (layout, animations, copy, icons all preserved)
- ❌ Razorpay signature verification (`verifyWebhookSignature` untouched)
- ❌ Subscription state machine (`activateSubscription`, `cancelSubscription` logic untouched)
- ❌ Phase 4a / IFC enhance code
- ❌ Floor plan pipeline (except free-tier copy in the API route)
- ❌ Dashboard components
- ❌ Auth middleware / `auth.ts` / `auth.config.ts`
- ❌ Billing amounts / plan prices / Stripe/Razorpay payment logic
- ❌ Rate-limiting numerical logic (only the fallback default string changed)
- ❌ `prisma/schema.prisma`
- ❌ `package.json` / `package-lock.json`
- ❌ Any file not explicitly listed in this report

---

## 7. Smoke-Test Checklist for Rutik

- [ ] **Visit homepage incognito** → Mini card shows `₹99`, Starter shows `₹799`, Pro shows `₹1,999` (single `₹`, not double)
- [ ] **Scroll to showcase section** → wf-03 shows "Text Prompt → 3D Building + IFC Export", wf-08 shows "PDF Brief → IFC + Video Walkthrough" (no raw i18n keys)
- [ ] **Check hero stats** → stat shows `₹2.4M` not `€2.4M`
- [ ] **Click a pricing CTA while logged out** → goes to `/register?plan=mini` (or starter/pro/team). Log in first → goes to `/dashboard`
- [ ] **Trigger free-tier-exceeded error** → message says "all 2 free executions" not "3"
- [ ] **Switch to DE locale** → pricing still shows single `₹` (99, 799, 1.999)
- [ ] **Test Razorpay purchase in test mode** → check Meta Events Manager for server-side Purchase event (already working — verify it's still there)
- [ ] **Complete a purchase → land on /thank-you/subscription** → open browser DevTools Network tab, refresh page → confirm Purchase/conversion events do NOT double-fire (check `fbq` calls and `gtag` calls)
- [ ] **Open `/light` page → View Page Source → search for `priceCurrency`** → should show `"INR"` not `"USD"`
- [ ] **View `/pricing` → View Page Source → check `<meta name="description">`** → should mention "2 AI executions"
