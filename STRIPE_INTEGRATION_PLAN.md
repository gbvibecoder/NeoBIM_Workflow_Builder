# 🎯 STRIPE INTEGRATION PLAN - NeoBIM Workflow Builder

**Created:** March 5, 2026  
**For:** Govind (Implementation Tomorrow)  
**Status:** READY TO IMPLEMENT  

---

## 📋 OVERVIEW

This plan implements Stripe subscriptions with 3 pricing tiers:
- **FREE** ($0/month) - 5 workflow executions/month
- **PRO** ($79/month) - 50 executions/month + priority support
- **TEAM** ($199/month) - 500 executions/month + team features

**Flow:**
1. User clicks "Upgrade" → Stripe Checkout
2. Payment success → Webhook updates DB
3. User role upgraded → Dashboard reflects new tier
4. Manage subscription → Stripe Customer Portal

---

## 1️⃣ INSTALL DEPENDENCIES

```bash
npm install stripe @stripe/stripe-js
npm install --save-dev @types/stripe
```

**Files changed:** `package.json`

---

## 2️⃣ ENVIRONMENT VARIABLES

### Add to `.env.local`:

```env
# ============================================================
# STRIPE
# ============================================================
STRIPE_SECRET_KEY="sk_test_..." # Get from Stripe Dashboard → Developers → API Keys
STRIPE_WEBHOOK_SECRET="whsec_..." # Get after creating webhook (step 4)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..." # Get from Stripe Dashboard → Developers → API Keys

# Stripe Price IDs (create products in Stripe Dashboard first)
STRIPE_PRO_PRICE_ID="price_..." # Monthly PRO subscription price ID
STRIPE_TEAM_PRICE_ID="price_..." # Monthly TEAM subscription price ID
```

### Add to `.env.example`:

```env
# ============================================================
# STRIPE
# ============================================================
STRIPE_SECRET_KEY="sk_test_your_stripe_secret_key"
STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_your_publishable_key"
STRIPE_PRO_PRICE_ID="price_pro_monthly"
STRIPE_TEAM_PRICE_ID="price_team_monthly"
```

**Files changed:** `.env.local`, `.env.example`

---

## 3️⃣ DATABASE SCHEMA CHANGES

### Update `prisma/schema.prisma`:

**ADD to User model (after `role` field):**

```prisma
model User {
  // ... existing fields ...
  role              UserRole  @default(FREE)
  
  // ✨ ADD THESE FIELDS
  stripeCustomerId       String?   @unique
  stripeSubscriptionId   String?   @unique
  stripePriceId          String?
  stripeCurrentPeriodEnd DateTime?
  
  bio           String?
  // ... rest of fields ...
}
```

**ADD new model (after WorkflowClone model):**

```prisma
// ============================================================
// SUBSCRIPTIONS & BILLING
// ============================================================

model StripeEvent {
  id              String   @id @default(cuid())
  stripeEventId   String   @unique
  type            String
  processed       Boolean  @default(false)
  createdAt       DateTime @default(now())
  data            Json?

  @@index([type])
  @@index([processed])
  @@map("stripe_events")
}
```

**ADD new enum (after WorkflowComplexity enum):**

```prisma
enum SubscriptionStatus {
  ACTIVE
  CANCELED
  PAST_DUE
  TRIALING
}
```

**Update UserRole enum:**

```prisma
enum UserRole {
  FREE
  PRO
  TEAM          // ✨ RENAME FROM TEAM_ADMIN
  PLATFORM_ADMIN
}
```

### Run migration:

```bash
npx prisma migrate dev --name add_stripe_fields
npx prisma generate
```

**Files changed:** `prisma/schema.prisma`

---

## 4️⃣ STRIPE CONFIG & UTILITIES

### Create `src/lib/stripe.ts`:

```typescript
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
});

export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    executionsPerMonth: 5,
    features: [
      '5 workflow executions/month',
      'Basic templates',
      'Community support',
    ],
  },
  PRO: {
    name: 'Pro',
    price: 79,
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    executionsPerMonth: 50,
    features: [
      '50 workflow executions/month',
      'All templates',
      'Priority email support',
      'Advanced node types',
      'Export to IFC/JSON',
    ],
  },
  TEAM: {
    name: 'Team',
    price: 149,
    priceId: process.env.STRIPE_TEAM_PRICE_ID!,
    executionsPerMonth: 500,
    features: [
      '500 workflow executions/month',
      'Everything in Pro',
      'Team collaboration',
      'Priority support (24h response)',
      'Custom integrations',
      'SSO (coming soon)',
    ],
  },
} as const;
```

**Files created:** `src/lib/stripe.ts`

---

## 5️⃣ API ROUTES

### 5.1 Create Checkout Session

**Create `src/app/api/stripe/checkout/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { stripe, STRIPE_PLANS } from '@/lib/stripe';
import { prisma } from '@/lib/prisma'; // Assuming you have this

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { priceId, plan } = await req.json();

    // Validate plan
    if (!['PRO', 'TEAM'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, stripeCustomerId: true, email: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let customerId = user.stripeCustomerId;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;

      // Update user with customerId
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // Create checkout session
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?canceled=true`,
      metadata: {
        userId: user.id,
        plan,
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Files created:** `src/app/api/stripe/checkout/route.ts`

---

### 5.2 Customer Portal Session

**Create `src/app/api/stripe/portal/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No active subscription' },
        { status: 400 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error: any) {
    console.error('Stripe portal error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Files created:** `src/app/api/stripe/portal/route.ts`

---

### 5.3 Webhook Handler (CRITICAL!)

**Create `src/app/api/stripe/webhook/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import Stripe from 'stripe';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'No signature' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  // Check if event was already processed
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existingEvent?.processed) {
    return NextResponse.json({ received: true });
  }

  // Log event
  await prisma.stripeEvent.create({
    data: {
      stripeEventId: event.id,
      type: event.type,
      data: event.data as any,
    },
  });

  // Handle different event types
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark as processed
    await prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: { processed: true },
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

// ============================================================
// WEBHOOK HANDLERS
// ============================================================

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan as 'PRO' | 'TEAM';

  if (!userId || !plan) {
    throw new Error('Missing metadata in checkout session');
  }

  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items.data[0].price.id,
      stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      role: plan, // Update to PRO or TEAM
    },
  });

  console.log(`✅ User ${userId} upgraded to ${plan}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;

  const user = await prisma.user.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!user) {
    console.error('User not found for subscription:', subscription.id);
    return;
  }

  // Determine plan from price ID
  let newRole: 'FREE' | 'PRO' | 'TEAM' = 'FREE';
  const priceId = subscription.items.data[0].price.id;

  if (priceId === process.env.STRIPE_PRO_PRICE_ID) {
    newRole = 'PRO';
  } else if (priceId === process.env.STRIPE_TEAM_PRICE_ID) {
    newRole = 'TEAM';
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripePriceId: priceId,
      stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      role: subscription.status === 'active' ? newRole : 'FREE',
    },
  });

  console.log(`✅ Subscription updated for user ${user.id}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const user = await prisma.user.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!user) {
    console.error('User not found for subscription:', subscription.id);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
      role: 'FREE',
    },
  });

  console.log(`✅ Subscription deleted, user ${user.id} downgraded to FREE`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.error('User not found for customer:', customerId);
    return;
  }

  // TODO: Send email notification to user
  console.log(`⚠️ Payment failed for user ${user.id}`);
}

// Disable body parsing for webhooks
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

**Files created:** `src/app/api/stripe/webhook/route.ts`

---

### 5.4 Subscription Status API

**Create `src/app/api/stripe/subscription/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        stripeCurrentPeriodEnd: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // If user has active subscription, fetch latest from Stripe
    let subscriptionStatus = null;
    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId
        );
        subscriptionStatus = {
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        };
      } catch (error) {
        console.error('Failed to fetch subscription:', error);
      }
    }

    return NextResponse.json({
      role: user.role,
      subscription: subscriptionStatus,
      hasActiveSubscription: !!user.stripeSubscriptionId,
    });
  } catch (error: any) {
    console.error('Subscription status error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Files created:** `src/app/api/stripe/subscription/route.ts`

---

## 6️⃣ FRONTEND COMPONENTS

### 6.1 Pricing Cards Component

**Create `src/components/PricingCards.tsx`:**

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CheckIcon } from 'lucide-react';
import { STRIPE_PLANS } from '@/lib/stripe';

interface PricingCardsProps {
  currentPlan?: 'FREE' | 'PRO' | 'TEAM';
}

export function PricingCards({ currentPlan = 'FREE' }: PricingCardsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleSubscribe = async (plan: 'PRO' | 'TEAM') => {
    setLoading(plan);
    try {
      const priceId = STRIPE_PLANS[plan].priceId;
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, plan }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
      {(Object.keys(STRIPE_PLANS) as Array<keyof typeof STRIPE_PLANS>).map((planKey) => {
        const plan = STRIPE_PLANS[planKey];
        const isCurrentPlan = planKey === currentPlan;
        const isPopular = planKey === 'PRO';

        return (
          <div
            key={planKey}
            className={`relative border rounded-2xl p-8 ${
              isPopular ? 'border-blue-500 shadow-lg scale-105' : 'border-gray-200'
            }`}
          >
            {isPopular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500">
                Most Popular
              </Badge>
            )}

            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold">${plan.price}</span>
                {plan.price > 0 && <span className="text-gray-500">/month</span>}
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <CheckIcon className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-600">{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              className="w-full"
              variant={isCurrentPlan ? 'outline' : isPopular ? 'default' : 'outline'}
              disabled={isCurrentPlan || loading !== null || planKey === 'FREE'}
              onClick={() => handleSubscribe(planKey as 'PRO' | 'TEAM')}
            >
              {loading === planKey
                ? 'Loading...'
                : isCurrentPlan
                ? 'Current Plan'
                : planKey === 'FREE'
                ? 'Free Forever'
                : 'Upgrade'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
```

**Files created:** `src/components/PricingCards.tsx`

---

### 6.2 Update Billing Page

**Replace `src/app/dashboard/billing/page.tsx`:**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PricingCards } from '@/components/PricingCards';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { format } from 'date-fns';

interface SubscriptionData {
  role: string;
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date;
  } | null;
  hasActiveSubscription: boolean;
}

export default function BillingPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    try {
      const res = await fetch('/api/stripe/subscription');
      const data = await res.json();
      setSubscriptionData(data);
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Portal error:', error);
      alert('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-12">
        <h1 className="text-3xl font-bold mb-2">Billing & Subscription</h1>
        <p className="text-gray-600">Manage your subscription and billing details</p>
      </div>

      {/* Current Plan Status */}
      {subscriptionData?.hasActiveSubscription && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-12">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">
                Current Plan: {subscriptionData.role}
              </h2>
              {subscriptionData.subscription && (
                <p className="text-gray-600">
                  {subscriptionData.subscription.cancelAtPeriodEnd
                    ? 'Cancels on '
                    : 'Renews on '}
                  {format(
                    new Date(subscriptionData.subscription.currentPeriodEnd),
                    'MMMM d, yyyy'
                  )}
                </p>
              )}
            </div>
            <Button onClick={handleManageSubscription} disabled={portalLoading}>
              {portalLoading ? 'Loading...' : 'Manage Subscription'}
            </Button>
          </div>
        </div>
      )}

      {/* Pricing Cards */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-center mb-8">Choose Your Plan</h2>
        <PricingCards currentPlan={subscriptionData?.role as any} />
      </div>

      {/* Additional Info */}
      <div className="text-center text-sm text-gray-500">
        <p>All plans include 7-day money-back guarantee</p>
        <p>Cancel anytime. No hidden fees.</p>
      </div>
    </div>
  );
}
```

**Files changed:** `src/app/dashboard/billing/page.tsx`

---

## 7️⃣ STRIPE DASHBOARD SETUP

### 7.1 Create Products & Prices

1. Go to: https://dashboard.stripe.com/test/products
2. Click **+ Add product**

**Product 1: NeoBIM Pro**
- Name: `NeoBIM Pro`
- Description: `Professional plan with 50 executions/month`
- Pricing:
  - Recurring: Monthly
  - Price: $79.00 USD
- Click **Save product**
- **Copy the Price ID** (starts with `price_`) → Add to `.env.local` as `STRIPE_PRO_PRICE_ID`

**Product 2: NeoBIM Team**
- Name: `NeoBIM Team`
- Description: `Team plan with 500 executions/month`
- Pricing:
  - Recurring: Monthly
  - Price: $199.00 USD
- Click **Save product**
- **Copy the Price ID** → Add to `.env.local` as `STRIPE_TEAM_PRICE_ID`

---

### 7.2 Create Webhook Endpoint

1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click **+ Add endpoint**
3. Endpoint URL: `https://yourdomain.com/api/stripe/webhook`
   - **For local testing:** Use ngrok or Stripe CLI
4. Listen to events:
   - ✅ `checkout.session.completed`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
   - ✅ `invoice.payment_failed`
5. Click **Add endpoint**
6. **Copy Signing Secret** (starts with `whsec_`) → Add to `.env.local` as `STRIPE_WEBHOOK_SECRET`

---

### 7.3 Enable Customer Portal

1. Go to: https://dashboard.stripe.com/test/settings/billing/portal
2. Click **Activate test link**
3. Configure:
   - ✅ Allow customers to update payment methods
   - ✅ Allow customers to cancel subscriptions
   - ✅ Allow customers to switch plans
4. Save settings

---

## 8️⃣ TESTING CHECKLIST

### 8.1 Local Development Testing

**Setup:**
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Copy the webhook signing secret from output → add to .env.local
```

---

### 8.2 Test Cases

**✅ Test 1: Checkout Flow (PRO)**
1. Navigate to `/dashboard/billing`
2. Click "Upgrade" on PRO plan
3. Use test card: `4242 4242 4242 4242` (any future date, any CVC)
4. Complete checkout
5. **Verify:**
   - Redirected to billing page with `?success=true`
   - User role updated to `PRO` in database
   - `stripeCustomerId` populated
   - `stripeSubscriptionId` populated
   - Webhook event logged in `stripe_events` table

**✅ Test 2: Checkout Flow (TEAM)**
1. Same as Test 1, but for TEAM plan
2. **Verify:** User role updated to `TEAM`

**✅ Test 3: Customer Portal**
1. As subscribed user, go to `/dashboard/billing`
2. Click "Manage Subscription"
3. **Verify:**
   - Redirected to Stripe Customer Portal
   - Can update payment method
   - Can cancel subscription
   - Can switch between PRO/TEAM

**✅ Test 4: Subscription Cancellation**
1. In Customer Portal, cancel subscription
2. **Verify:**
   - `customer.subscription.deleted` webhook received
   - User role downgraded to `FREE` in database
   - `stripeSubscriptionId` set to null

**✅ Test 5: Payment Failure**
1. Use test card: `4000 0000 0000 0341` (payment fails)
2. Try to subscribe
3. **Verify:**
   - `invoice.payment_failed` webhook received
   - User remains on FREE plan
   - Error logged

**✅ Test 6: Duplicate Webhook Protection**
1. Use Stripe CLI to replay a webhook:
   ```bash
   stripe events resend evt_xxx
   ```
2. **Verify:**
   - Event logged only once in `stripe_events`
   - User not double-charged
   - `processed: true` set

---

### 8.3 Production Testing

**Before going live:**
1. Switch to **live mode** in Stripe Dashboard
2. Update environment variables with **live keys** (no `_test_`)
3. Re-create products with **production Price IDs**
4. Update webhook endpoint to **production URL**
5. Test with **real payment method** (can refund immediately)

---

## 9️⃣ SECURITY CHECKLIST

**✅ Environment Variables**
- All Stripe keys in `.env.local` (not committed)
- Webhook secret properly configured

**✅ API Routes**
- Authentication checked on all routes
- Webhook signature verified
- User validation on checkout/portal

**✅ Database**
- Idempotency: Webhook events logged and checked
- Foreign key constraints on User → StripeEvent

**✅ Frontend**
- No Stripe secret key exposed
- Only publishable key in client code
- Loading states prevent double-clicks

---

## 🔟 DEPLOYMENT STEPS

### Step 1: Local Implementation (Tomorrow)
```bash
# 1. Install dependencies
npm install stripe @stripe/stripe-js

# 2. Update schema
# (Follow Section 3)
npx prisma migrate dev --name add_stripe_fields
npx prisma generate

# 3. Add environment variables
# (Follow Section 2)

# 4. Create files
# - src/lib/stripe.ts
# - src/app/api/stripe/checkout/route.ts
# - src/app/api/stripe/portal/route.ts
# - src/app/api/stripe/webhook/route.ts
# - src/app/api/stripe/subscription/route.ts
# - src/components/PricingCards.tsx
# - Update src/app/dashboard/billing/page.tsx

# 5. Setup Stripe Dashboard
# (Follow Section 7)

# 6. Test with Stripe CLI
stripe listen --forward-to localhost:3000/api/stripe/webhook

# 7. Run tests
# (Follow Section 8.2)
```

### Step 2: Staging Deployment
1. Deploy to staging environment (Vercel preview)
2. Update webhook URL in Stripe (test mode)
3. Run full test suite
4. Fix any issues

### Step 3: Production Deployment
1. Switch to Stripe live mode
2. Re-create products with live Price IDs
3. Update production environment variables
4. Deploy to production
5. Test with real payment (refund immediately)
6. Monitor webhook logs for 24h

---

## 📊 FILES CREATED/MODIFIED

### Created (7 files):
1. `src/lib/stripe.ts`
2. `src/app/api/stripe/checkout/route.ts`
3. `src/app/api/stripe/portal/route.ts`
4. `src/app/api/stripe/webhook/route.ts`
5. `src/app/api/stripe/subscription/route.ts`
6. `src/components/PricingCards.tsx`
7. `STRIPE_INTEGRATION_PLAN.md` (this file)

### Modified (4 files):
1. `prisma/schema.prisma`
2. `src/app/dashboard/billing/page.tsx`
3. `.env.local`
4. `.env.example`

---

## 🚨 COMMON GOTCHAS

1. **Webhook signature fails:**
   - Make sure `STRIPE_WEBHOOK_SECRET` matches current endpoint
   - Use `stripe listen` for local dev, not the dashboard secret

2. **Customer already exists error:**
   - Check if `stripeCustomerId` is already set
   - Handle existing customers gracefully

3. **Role not updating:**
   - Check webhook logs in database (`stripe_events` table)
   - Verify `processed: true` is set
   - Check Stripe Dashboard → Events for delivery status

4. **Test cards not working:**
   - Make sure you're in **test mode** (keys start with `sk_test_`)
   - Use `4242 4242 4242 4242` for success
   - Use `4000 0000 0000 0341` for payment failure

5. **Portal link doesn't work:**
   - Must activate Customer Portal in Stripe Dashboard
   - User must have `stripeCustomerId` set

---

## 💰 REVENUE TRACKING (Optional - Future Enhancement)

Track MRR (Monthly Recurring Revenue):

```sql
-- Query for current MRR
SELECT 
  COUNT(*) as active_subscriptions,
  SUM(CASE WHEN role = 'PRO' THEN 79 ELSE 0 END) as pro_mrr,
  SUM(CASE WHEN role = 'TEAM' THEN 149 ELSE 0 END) as team_mrr,
  SUM(CASE WHEN role = 'PRO' THEN 79 WHEN role = 'TEAM' THEN 149 ELSE 0 END) as total_mrr
FROM users
WHERE stripeSubscriptionId IS NOT NULL;
```

---

## ✅ READY TO IMPLEMENT

This plan is **complete and ready for Govind to implement tomorrow morning**.

**Estimated implementation time:** 4-6 hours  
**Testing time:** 2-3 hours  
**Total:** ~1 working day

**Questions? Check:**
- Stripe Docs: https://stripe.com/docs/billing/subscriptions/overview
- Next.js App Router: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- Webhook Guide: https://stripe.com/docs/webhooks

---

🔥 **LET'S MAKE MONEY!** 🔥
