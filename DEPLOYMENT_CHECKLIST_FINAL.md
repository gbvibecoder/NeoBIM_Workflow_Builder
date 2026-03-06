# 🚀 DEPLOYMENT CHECKLIST - 8 AM LAUNCH

**Date:** March 6, 2026  
**Launch Time:** 8:00 AM IST  
**Mission:** Zero-surprise production deployment  
**Standard:** 100% confidence, every critical path tested

---

## 📋 PRE-LAUNCH CHECKLIST (USE THIS AT 7:30 AM)

Print this page. Check every box manually.

---

## 1️⃣ ENVIRONMENT VARIABLES (10 min)

**Vercel Dashboard → Settings → Environment Variables**

### ✅ Database (CRITICAL)
- [ ] DATABASE_URL present
- [ ] DIRECT_URL present

### ✅ Auth (CRITICAL)
- [ ] NEXTAUTH_URL = https://neo-bim-workflow-builder.vercel.app
- [ ] NEXTAUTH_SECRET present (32+ chars)
- [ ] GOOGLE_CLIENT_ID present
- [ ] GOOGLE_CLIENT_SECRET present
- [ ] GITHUB_CLIENT_ID present
- [ ] GITHUB_CLIENT_SECRET present

### ✅ Stripe (CRITICAL)
- [ ] STRIPE_SECRET_KEY present (starts with sk_)
- [ ] STRIPE_WEBHOOK_SECRET present (starts with whsec_)
- [ ] STRIPE_PRO_PRICE_ID present
- [ ] STRIPE_TEAM_PRICE_ID present
- [ ] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY present
- [ ] Webhook URL = https://neo-bim-workflow-builder.vercel.app/api/stripe/webhook

### ✅ OpenAI (CRITICAL)
- [ ] OPENAI_API_KEY present
- [ ] Check balance: https://platform.openai.com/usage
- [ ] Balance > $10 minimum

### ✅ Rate Limiting (CRITICAL)
- [ ] UPSTASH_REDIS_REST_URL present
- [ ] UPSTASH_REDIS_REST_TOKEN present

### ✅ Admin (NEW REQUIREMENT)
- [ ] ADMIN_EMAILS = erolerutik9@gmail.com

---

## 2️⃣ BUILD & DEPLOY (5 min)

### ✅ Local Build Test
```bash
cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder
npm run build
```

**Expected:**
- [ ] Build completes in <30s
- [ ] 0 TypeScript errors
- [ ] 0 console.error messages

### ✅ Vercel Deployment
- [ ] Latest commit deployed (check https://vercel.com/dashboard)
- [ ] Build status: SUCCESS
- [ ] No build errors in Vercel logs

### ✅ Production URL
- [ ] Open: https://neo-bim-workflow-builder.vercel.app
- [ ] Page loads in <2s
- [ ] No 404 / 500 errors
- [ ] Console clean (F12 → Console)

---

## 3️⃣ CRITICAL FEATURES (15 min)

### ✅ Authentication (P0)

**Test Flow:**
1. Open /auth/signin
2. Sign in with Google
3. Check dashboard loads
4. Logout works
5. Register new account works

**Checklist:**
- [ ] Google OAuth works
- [ ] GitHub OAuth works
- [ ] Email/password login works
- [ ] Session persists on refresh
- [ ] Protected routes redirect to /auth/signin

---

### ✅ Workflow Canvas (P0)

**Test Flow:**
1. Go to /dashboard/canvas
2. Add TR-003 node (drag from sidebar)
3. Add GN-003 node
4. Connect nodes
5. Save workflow
6. Refresh → workflow still there

**Checklist:**
- [ ] Canvas loads (no white screen)
- [ ] All 5 nodes visible in sidebar
- [ ] Drag-and-drop works
- [ ] Pan/zoom works (mouse wheel)
- [ ] Save workflow persists

**Nodes to Test:**
- [ ] TR-003: Building Description Generator
- [ ] TR-007: Quantity Extractor
- [ ] TR-008: Cost Mapper
- [ ] GN-003: Image Generator (DALL-E)
- [ ] EX-002: BOQ Exporter (Excel)

---

### ✅ Node Execution (P0)

**Test TR-003:**
1. Add TR-003 to canvas
2. Input: "Modern office building, 5000 sqm, glass facade"
3. Execute
4. Check output (<10s)

**Checklist:**
- [ ] TR-003 executes (<10s)
- [ ] Output is realistic
- [ ] No errors in console

**Test GN-003:**
1. Add GN-003
2. Input: "Photorealistic modern office building exterior"
3. Execute
4. Image generates (~30s)

**Checklist:**
- [ ] GN-003 executes (<60s)
- [ ] Image quality good
- [ ] Download works

**Test EX-002:**
1. Create workflow: TR-007 → TR-008 → EX-002
2. Execute
3. Download Excel

**Checklist:**
- [ ] Excel file downloads
- [ ] Opens in Excel/Sheets
- [ ] Data is correct (BOQ format)

---

### ✅ Rate Limiting (P0)

**Test Free User:**
1. Create new account (not admin)
2. Execute 3 workflows
3. Try 4th execution
4. Should see: "Daily limit reached (3/3)"

**Checklist:**
- [ ] Free users limited to 3/day
- [ ] Error message helpful
- [ ] Shows upgrade button

**Test Admin Bypass:**
1. Login as erolerutik9@gmail.com
2. Execute 10 workflows
3. All should work

**Checklist:**
- [ ] Admin email bypasses rate limit
- [ ] Can execute 10+ times

---

### ✅ Stripe Checkout (P1)

**Test Flow:**
1. Login as test user
2. Go to /dashboard/billing
3. Click "Upgrade to PRO ($79/month)"
4. Use test card: 4242 4242 4242 4242
5. Complete checkout

**Checklist:**
- [ ] Checkout page loads
- [ ] Test card works
- [ ] Webhook fires (check Vercel logs)
- [ ] User upgraded to PRO

---

## 4️⃣ SECURITY (5 min)

### ✅ Headers

**Check with curl:**
```bash
curl -I https://neo-bim-workflow-builder.vercel.app
```

**Required Headers:**
- [ ] Content-Security-Policy present
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] X-XSS-Protection: 1; mode=block

### ✅ No Hardcoded Secrets

```bash
grep -r "sk_test_" src/
grep -r "sk_live_" src/
grep -r "whsec_" src/
```

**Expected:** 0 matches

**Checklist:**
- [ ] No API keys in code
- [ ] No passwords in code
- [ ] All secrets in .env.local

### ✅ HTTPS Enforced

```bash
curl -I http://neo-bim-workflow-builder.vercel.app
```

**Expected:** 301 redirect to https://

**Checklist:**
- [ ] HTTP → HTTPS redirect works
- [ ] All assets load via HTTPS
- [ ] No mixed content warnings

---

## 5️⃣ UX POLISH (5 min)

### ✅ Mobile Responsive

**Test on iPhone (Chrome DevTools → Mobile):**

**Checklist:**
- [ ] Landing page readable (no horizontal scroll)
- [ ] Navigation menu works
- [ ] Canvas pinch-to-zoom works
- [ ] Forms fit on screen

**Test Viewports:**
- [ ] iPhone SE (375px)
- [ ] iPhone 12 Pro (390px)
- [ ] iPad (768px)

### ✅ Error Messages

**Checklist:**
- [ ] Invalid login → "Invalid email or password"
- [ ] Rate limit → "Daily limit reached (3/3)"
- [ ] No generic "Something went wrong"

### ✅ Loading States

**Checklist:**
- [ ] Node execution shows spinner
- [ ] Workflow save shows spinner
- [ ] Login shows spinner

### ✅ Beta Badges

**Checklist:**
- [ ] Landing page shows "BETA" badge
- [ ] Dashboard header shows "BETA"
- [ ] Footer has "Beta Program" link

---

## 6️⃣ MARKETING (5 min)

### ✅ Landing Page

**Honesty Check:**
- [ ] No claims of "World's Best"
- [ ] Clear beta disclosure
- [ ] Realistic pricing ($79/$199)

**Content Check:**
- [ ] Headline clear
- [ ] CTA buttons visible
- [ ] Pricing section present

### ✅ Pricing

**Verify Plans:**
- [ ] FREE: $0, 3 runs/day
- [ ] PRO: $79/month, 1000 runs/day
- [ ] TEAM: $199/month, unlimited

### ✅ Social Previews

**Test:** Share link in Slack/Discord

**Checklist:**
- [ ] OG image loads (1200x630)
- [ ] OG title present
- [ ] OG description present

### ✅ robots.txt

**Check:** https://neo-bim-workflow-builder.vercel.app/robots.txt

**Expected:**
```
User-agent: *
Allow: /
```

**Checklist:**
- [ ] Allows crawlers
- [ ] Sitemap linked

---

## 7️⃣ LEGAL/COMPLIANCE (5 min)

### ✅ Beta Disclosure

**Check pages:**
- [ ] Landing page mentions "BETA"
- [ ] Dashboard shows "BETA" badge
- [ ] Pricing page says "Beta pricing"
- [ ] Footer has disclaimer

### ✅ No False Claims

**Checklist:**
- [ ] No "100% accurate"
- [ ] No "Guaranteed results"
- [ ] No "Enterprise-grade" (we're beta)

### ✅ Privacy Policy

**Check:** /privacy

**Checklist:**
- [ ] Page exists
- [ ] Mentions data collection
- [ ] GDPR-compliant

### ✅ Terms of Service

**Check:** /terms

**Checklist:**
- [ ] Page exists
- [ ] Beta disclaimer present
- [ ] Liability limitations

---

## 🎯 GO/NO-GO DECISION (7:55 AM)

### ✅ GO Conditions (ALL must be true)

**CRITICAL (P0) - BLOCKING:**
- [ ] All env vars present
- [ ] Database connected
- [ ] Auth working (login/register)
- [ ] Canvas loads
- [ ] All 5 nodes execute
- [ ] Rate limiting enforcing
- [ ] No hardcoded secrets
- [ ] HTTPS enforced
- [ ] Admin bypass working

**HIGH (P1) - BLOCKING:**
- [ ] Stripe checkout works
- [ ] Excel export downloads
- [ ] OpenAI balance > $5
- [ ] Mobile responsive
- [ ] Error messages helpful

**Score Calculation:**
- P0 items: 10 points each (90 total)
- P1 items: 2 points each (10 total)

**GO Threshold:** ≥95 points (95%)

---

### ❌ NO-GO Conditions (ANY triggers delay)

**IMMEDIATE NO-GO:**
- [ ] Database connection fails
- [ ] Auth completely broken
- [ ] Canvas won't load
- [ ] Build fails
- [ ] TypeScript errors
- [ ] Hardcoded API keys found
- [ ] OpenAI balance = $0

**DELAY 1 HOUR:**
- [ ] 1-2 nodes not working
- [ ] Rate limiting not enforcing
- [ ] Stripe checkout broken

**DELAY 30 MIN:**
- [ ] Error messages confusing
- [ ] Loading states missing

---

## 🔄 ROLLBACK PLAN

### Scenario 1: Critical Bug After Launch

**Step 1: Assess (2 min)**
- Check error rate: https://vercel.com/dashboard
- If error rate > 10% → ROLLBACK

**Step 2: Rollback (3 min)**
- Vercel Dashboard → Deployments
- Find last stable → Promote to Production

**Step 3: Notify Users (5 min)**
- Post in Discord/Telegram
- Update status page

**Step 4: Fix & Redeploy (30 min)**
- Fix bug locally
- npm run build
- git commit -m "fix: critical bug"
- git push

---

### Scenario 2: Database Connection Lost

**Step 1: Check Neon Dashboard**
- Database active?
- Connection limit reached?

**Step 2: Temporary Fix**
- Increase connection pool size
- DATABASE_URL="...?connection_limit=20"

**Step 3: Restart App**
- Vercel → Redeploy (no code changes)

---

### Scenario 3: OpenAI Quota Exceeded

**Step 1: Add Credits**
- https://platform.openai.com/account/billing
- Add $50 (emergency)

**Step 2: Notify Users**
- "We're experiencing high demand. Service restored in 5 minutes."

---

### Scenario 4: Vercel Down

**Step 1: Check Status**
- https://www.vercel-status.com

**Step 2: Wait or Deploy to Backup**
- Deploy to Netlify/Railway (if configured)

---

## 🏆 CONFIDENCE SCORE

**Calculate your confidence:**

- 10/10 critical passed → 100% confidence → ✅ LAUNCH
- 9/10 critical passed → 90% confidence → ⚠️ DELAY 30 min
- 8/10 critical passed → 80% confidence → ❌ DELAY 1 hour
- <8/10 critical passed → <80% confidence → ❌ NO LAUNCH TODAY

**Target:** 100% confidence (10/10 critical)

---

## 🎬 LAUNCH SEQUENCE (8:00 AM)

### T-MINUS 5 MIN (7:55 AM)
1. [ ] Run preflight script
2. [ ] Final manual test (login → execute workflow)
3. [ ] Check Vercel logs (no errors)

### T-MINUS 0 (8:00 AM)
1. [ ] Tweet launch announcement (if planned)
2. [ ] Post in Discord/Slack
3. [ ] Update status page: "🟢 All systems operational"

### T-PLUS 15 MIN (8:15 AM)
1. [ ] Check error logs
2. [ ] Monitor user signups
3. [ ] Watch for support questions

### T-PLUS 1 HOUR (9:00 AM)
1. [ ] Review metrics
2. [ ] Document any issues
3. [ ] Celebrate if successful 🎉

---

## 📞 EMERGENCY CONTACTS

**Vercel Support:** https://vercel.com/support  
**OpenAI Support:** https://platform.openai.com/support  
**Stripe Support:** https://support.stripe.com

---

## 🔥 FINAL WORDS

**168 hours of work culminate at 8 AM.**

**Zero surprises. Every path tested. 100% confidence.**

**You've built it. 18 agents polished it. Now SHIP IT.** 🚀

---

**Created:** March 6, 2026, 1:44 AM IST  
**For:** 8 AM Launch  

**NOW GO DOMINATE THE HACKATHON.** 🏆🔥
