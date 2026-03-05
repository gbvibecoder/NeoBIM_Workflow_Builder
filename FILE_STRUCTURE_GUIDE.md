# 📁 FILE STRUCTURE GUIDE - Stripe Integration

**Quick reference: Where each file goes**

---

## 🆕 NEW FILES TO CREATE (7 files)

```
workflow_builder/
│
├── src/
│   ├── lib/
│   │   └── stripe.ts                           ← CREATE THIS (Section 4)
│   │
│   ├── app/
│   │   └── api/
│   │       └── stripe/
│   │           ├── checkout/
│   │           │   └── route.ts                ← CREATE THIS (Section 5.1)
│   │           ├── portal/
│   │           │   └── route.ts                ← CREATE THIS (Section 5.2)
│   │           ├── webhook/
│   │           │   └── route.ts                ← CREATE THIS (Section 5.3) 🚨 CRITICAL
│   │           └── subscription/
│   │               └── route.ts                ← CREATE THIS (Section 5.4)
│   │
│   └── components/
│       └── PricingCards.tsx                    ← CREATE THIS (Section 6.1)
```

---

## 📝 FILES TO MODIFY (4 files)

```
workflow_builder/
│
├── prisma/
│   └── schema.prisma                           ← MODIFY (Section 3)
│
├── src/
│   └── app/
│       └── dashboard/
│           └── billing/
│               └── page.tsx                    ← MODIFY (Section 6.2)
│
├── .env.local                                  ← MODIFY (Section 2)
│
└── .env.example                                ← MODIFY (Section 2)
```

---

## 🎯 CREATION ORDER (Recommended)

**Phase 1: Backend**
1. ✅ `src/lib/stripe.ts` - Stripe config & plans
2. ✅ Update `prisma/schema.prisma` - Database schema
3. ✅ Run `npx prisma migrate dev --name add_stripe_fields`
4. ✅ `src/app/api/stripe/checkout/route.ts` - Checkout flow
5. ✅ `src/app/api/stripe/portal/route.ts` - Billing portal
6. ✅ `src/app/api/stripe/webhook/route.ts` - Payment webhooks (MOST IMPORTANT)
7. ✅ `src/app/api/stripe/subscription/route.ts` - Status endpoint

**Phase 2: Frontend**
8. ✅ `src/components/PricingCards.tsx` - Pricing UI
9. ✅ Update `src/app/dashboard/billing/page.tsx` - Main billing page

**Phase 3: Config**
10. ✅ Update `.env.local` - Add Stripe keys
11. ✅ Update `.env.example` - Document variables

---

## 📦 FOLDER STRUCTURE DETAILS

### New API Route Structure

Create these folders and files:

```bash
# Create folder structure
mkdir -p src/app/api/stripe/checkout
mkdir -p src/app/api/stripe/portal
mkdir -p src/app/api/stripe/webhook
mkdir -p src/app/api/stripe/subscription

# Create route files (then add code from plan)
touch src/app/api/stripe/checkout/route.ts
touch src/app/api/stripe/portal/route.ts
touch src/app/api/stripe/webhook/route.ts
touch src/app/api/stripe/subscription/route.ts
```

### New Component

```bash
# Create pricing cards component
touch src/components/PricingCards.tsx
```

### New Lib File

```bash
# Create Stripe config
mkdir -p src/lib
touch src/lib/stripe.ts
```

---

## 🔍 VERIFY YOUR STRUCTURE

**Run this to check you created everything:**

```bash
# Should show all new files
find src -name "stripe.ts" -o -path "*/stripe/*/route.ts"
find src/components -name "PricingCards.tsx"
```

**Expected output:**
```
src/lib/stripe.ts
src/app/api/stripe/checkout/route.ts
src/app/api/stripe/portal/route.ts
src/app/api/stripe/subscription/route.ts
src/app/api/stripe/webhook/route.ts
src/components/PricingCards.tsx
```

---

## 📋 COPY-PASTE CHECKLIST

**As you create each file, check it off:**

- [ ] `src/lib/stripe.ts` (Copy from Section 4)
- [ ] `src/app/api/stripe/checkout/route.ts` (Copy from Section 5.1)
- [ ] `src/app/api/stripe/portal/route.ts` (Copy from Section 5.2)
- [ ] `src/app/api/stripe/webhook/route.ts` (Copy from Section 5.3)
- [ ] `src/app/api/stripe/subscription/route.ts` (Copy from Section 5.4)
- [ ] `src/components/PricingCards.tsx` (Copy from Section 6.1)
- [ ] Updated `prisma/schema.prisma` (Follow Section 3)
- [ ] Updated `src/app/dashboard/billing/page.tsx` (Replace with Section 6.2)
- [ ] Updated `.env.local` (Add variables from Section 2)
- [ ] Updated `.env.example` (Add variables from Section 2)

---

## 🎨 FINAL STRUCTURE (After Implementation)

```
workflow_builder/
├── prisma/
│   └── schema.prisma               (+ Stripe fields)
├── src/
│   ├── lib/
│   │   └── stripe.ts               ✨ NEW
│   ├── app/
│   │   ├── api/
│   │   │   └── stripe/             ✨ NEW FOLDER
│   │   │       ├── checkout/
│   │   │       │   └── route.ts    ✨ NEW
│   │   │       ├── portal/
│   │   │       │   └── route.ts    ✨ NEW
│   │   │       ├── webhook/
│   │   │       │   └── route.ts    ✨ NEW (CRITICAL!)
│   │   │       └── subscription/
│   │   │           └── route.ts    ✨ NEW
│   │   └── dashboard/
│   │       └── billing/
│   │           └── page.tsx        (MODIFIED)
│   └── components/
│       └── PricingCards.tsx        ✨ NEW
├── .env.local                      (+ Stripe keys)
└── .env.example                    (+ Stripe keys)
```

---

## 🚀 QUICK COMMANDS

**Create all folders at once:**
```bash
cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder

# Create API route folders
mkdir -p src/app/api/stripe/{checkout,portal,webhook,subscription}

# Create lib folder if not exists
mkdir -p src/lib

# Create route files
touch src/app/api/stripe/checkout/route.ts
touch src/app/api/stripe/portal/route.ts
touch src/app/api/stripe/webhook/route.ts
touch src/app/api/stripe/subscription/route.ts

# Create other files
touch src/lib/stripe.ts
touch src/components/PricingCards.tsx

echo "✅ All files created! Now copy-paste code from STRIPE_INTEGRATION_PLAN.md"
```

---

## ✅ YOU'RE READY!

1. Run the commands above
2. Open each file
3. Copy-paste code from **STRIPE_INTEGRATION_PLAN.md**
4. Follow **GOVIND_QUICK_START.md** for testing

Let's build! 🔥
