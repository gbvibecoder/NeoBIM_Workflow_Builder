# 🚀 GOVIND'S QUICK START - Stripe Integration

**Date:** March 5, 2026  
**Time Estimate:** 6-8 hours total  
**Read this first, then follow STRIPE_INTEGRATION_PLAN.md**

---

## ⚡ ULTRA-QUICK OVERVIEW (2 min read)

**What we're building:**
- Stripe subscriptions for NeoBIM
- 3 tiers: FREE ($0), PRO ($79/mo), TEAM ($199/mo)
- User clicks "Upgrade" → Stripe Checkout → Webhook updates DB → Done

**Your job:**
1. Copy-paste code from plan (all ready)
2. Create Stripe products (5 min)
3. Test with test cards (1 hour)
4. Ship it

---

## 📋 STEP-BY-STEP CHECKLIST

### Morning Setup (30 min)

**[ ] 1. Install dependencies**
```bash
cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder
npm install stripe @stripe/stripe-js
npm install --save-dev @types/stripe
```

**[ ] 2. Update database schema**
- Open `prisma/schema.prisma`
- Add Stripe fields to User model (Section 3 of main plan)
- Add StripeEvent model (Section 3)
- Run:
```bash
npx prisma migrate dev --name add_stripe_fields
npx prisma generate
```

**[ ] 3. Create Stripe account (if not done)**
- Go to https://dashboard.stripe.com
- Sign up / Log in
- Stay in **TEST MODE** (top right toggle)

**[ ] 4. Get API keys**
- Stripe Dashboard → Developers → API Keys
- Copy:
  - **Publishable key** (pk_test_...)
  - **Secret key** (sk_test_...)
- Add to `.env.local`:
```env
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

---

### Create Files (2 hours)

**All code is ready in STRIPE_INTEGRATION_PLAN.md - just copy-paste!**

**[ ] 5. Create `src/lib/stripe.ts`**
- Copy from Section 4
- Contains Stripe client + plan config

**[ ] 6. Create `src/app/api/stripe/checkout/route.ts`**
- Copy from Section 5.1
- Handles checkout session creation

**[ ] 7. Create `src/app/api/stripe/portal/route.ts`**
- Copy from Section 5.2
- Handles billing portal access

**[ ] 8. Create `src/app/api/stripe/webhook/route.ts`**
- Copy from Section 5.3
- **MOST IMPORTANT FILE** - handles payment events

**[ ] 9. Create `src/app/api/stripe/subscription/route.ts`**
- Copy from Section 5.4
- Fetches current subscription status

**[ ] 10. Create `src/components/PricingCards.tsx`**
- Copy from Section 6.1
- Beautiful pricing cards UI

**[ ] 11. Update `src/app/dashboard/billing/page.tsx`**
- Replace entire file with code from Section 6.2
- Main billing dashboard

---

### Stripe Dashboard Setup (15 min)

**[ ] 12. Create products**
- Go to https://dashboard.stripe.com/test/products
- Click **+ Add product**

**Product 1: NeoBIM Pro**
- Name: `NeoBIM Pro`
- Description: `50 executions/month + priority support`
- Price: $79.00 USD, Monthly
- Save → **Copy Price ID** → Add to `.env.local` as `STRIPE_PRO_PRICE_ID`

**Product 2: NeoBIM Team**
- Name: `NeoBIM Team`
- Description: `500 executions/month + team features`
- Price: $199.00 USD, Monthly
- Save → **Copy Price ID** → Add to `.env.local` as `STRIPE_TEAM_PRICE_ID`

**[ ] 13. Setup webhooks (for local testing)**
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Start forwarding (keep this running in separate terminal)
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**[ ] 14. Copy webhook secret**
- From Stripe CLI output, copy `whsec_...` secret
- Add to `.env.local` as `STRIPE_WEBHOOK_SECRET`

**[ ] 15. Enable Customer Portal**
- Go to https://dashboard.stripe.com/test/settings/billing/portal
- Click **Activate test link**
- Enable:
  - ✅ Update payment methods
  - ✅ Cancel subscriptions
  - ✅ Switch plans
- Save

---

### Testing (2 hours)

**Make sure Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/stripe/webhook`**

**[ ] 16. Start dev server**
```bash
npm run dev
```

**[ ] 17. Test PRO subscription**
1. Go to http://localhost:3000/dashboard/billing
2. Click "Upgrade" on PRO card
3. Use test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/25)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any (e.g., 12345)
4. Complete payment

**Verify:**
- ✅ Redirected to `/dashboard/billing?success=true`
- ✅ In Stripe CLI, see `checkout.session.completed` event
- ✅ Check database: `stripeCustomerId` and `stripeSubscriptionId` populated
- ✅ User role = `PRO`

**[ ] 18. Test TEAM subscription**
- Same as above, but for TEAM plan
- Verify role = `TEAM`

**[ ] 19. Test billing portal**
1. As subscribed user, click "Manage Subscription"
2. Should redirect to Stripe Customer Portal
3. Try:
   - Update payment method
   - Switch from PRO to TEAM (or vice versa)
   - Cancel subscription

**[ ] 20. Test cancellation**
1. In Customer Portal, cancel subscription
2. Watch Stripe CLI for `customer.subscription.deleted`
3. Verify:
   - User role back to `FREE`
   - `stripeSubscriptionId` = null in DB

**[ ] 21. Test payment failure**
1. Use card: `4000 0000 0000 0341` (always fails)
2. Try to subscribe
3. Should show error
4. Check `invoice.payment_failed` in Stripe CLI

---

### Build & Deploy (1 hour)

**[ ] 22. Test build**
```bash
npm run build
```

**[ ] 23. Push to GitHub**
```bash
git add .
git commit -m "feat: Add Stripe subscription integration"
git push origin main
```

**[ ] 24. Deploy to Vercel**
- Auto-deploys from main
- Add env vars in Vercel dashboard
- Update webhook URL in Stripe to production URL

---

## 🚨 COMMON ISSUES & FIXES

### Issue: "Webhook signature verification failed"
**Fix:** Make sure `STRIPE_WEBHOOK_SECRET` matches what Stripe CLI shows. It changes each time you run `stripe listen`.

### Issue: User role not updating after payment
**Fix:** Check Stripe CLI output - is webhook being received? Check database `stripe_events` table.

### Issue: "No active subscription" error
**Fix:** User must complete checkout first. Check `stripeCustomerId` is populated in database.

### Issue: Can't access billing portal
**Fix:** Make sure Customer Portal is activated in Stripe Dashboard settings.

### Issue: Build fails with Prisma error
**Fix:** Run `npx prisma generate` after schema changes.

---

## 📞 NEED HELP?

1. **Read full plan:** `STRIPE_INTEGRATION_PLAN.md`
2. **Check Stripe docs:** https://stripe.com/docs
3. **Stripe CLI logs:** Watch the terminal running `stripe listen`
4. **Database check:** Use Prisma Studio - `npx prisma studio`
5. **Ask Rutik/Chhawa**

---

## ✅ DEFINITION OF DONE

**You're done when:**
- ✅ All 24 checkboxes above completed
- ✅ Can subscribe to PRO using test card
- ✅ Can subscribe to TEAM using test card
- ✅ Can open billing portal and cancel
- ✅ User role updates automatically after payment
- ✅ Webhook events logged in database
- ✅ `npm run build` succeeds
- ✅ Deployed to production

---

## 🔥 LET'S SHIP IT!

**You got this, Govind! 🚀**

Everything is ready. Just copy-paste and test. Should take 6-8 hours total.

If anything breaks, check the main plan or ask. Good luck! 💪
