# 📊 ANALYTICS IMPLEMENTATION PLAN - NeoBIM Workflow Builder

**Created:** March 5, 2026, 19:20 IST  
**Status:** PREPARATION COMPLETE - READY FOR IMPLEMENTATION  
**Estimated Implementation Time:** 8-10 hours  
**Priority:** 🔥 CRITICAL (Hackathon War Mode - March 5-12)

---

## 🎯 EXECUTIVE SUMMARY

**Current State:** ❌ **ZERO ANALYTICS TRACKING**  
- No tracking code in codebase
- No analytics packages installed
- Flying blind on user behavior, conversions, and revenue
- Cannot measure hackathon success

**Goal:** Build complete analytics system to track:
1. **User Behavior** (signup sources, feature usage, retention)
2. **Product Metrics** (workflow success rate, node usage, execution time)
3. **Conversions** (free → pro, trial → paid, funnel drop-offs)
4. **Revenue** (MRR, churn, LTV, ARPU)
5. **Performance** (API latency, error rates, uptime)
6. **Growth** (DAU, WAU, MAU, viral coefficient)

**Recommended Stack:**
- **Primary:** PostHog (product analytics, session replay, feature flags)
- **Secondary:** Plausible (optional - simple pageview tracking)
- **Error Tracking:** Sentry (essential for production)
- **Revenue:** Stripe Dashboard (native subscription analytics)

---

## 📋 TABLE OF CONTENTS

1. [Current Tracking Audit](#1-current-tracking-audit)
2. [Metrics We Need](#2-metrics-we-need)
3. [Tool Evaluation](#3-tool-evaluation)
4. [Recommended Architecture](#4-recommended-architecture)
5. [Implementation Plan](#5-implementation-plan)
6. [Dashboard Design](#6-dashboard-design)
7. [Environment Variables](#7-environment-variables)
8. [File Structure](#8-file-structure)
9. [Testing Checklist](#9-testing-checklist)
10. [Go-Live Plan](#10-go-live-plan)

---

## 1️⃣ CURRENT TRACKING AUDIT

### What Exists? ❌ NOTHING

**Code Analysis:**
```bash
# Searched entire codebase for analytics/tracking code
grep -r "analytics|tracking|gtag|plausible|posthog|mixpanel" ./src
# Result: ZERO tracking implementations
```

**Package Analysis:**
```json
// package.json - NO analytics packages
{
  "dependencies": {
    // ❌ No analytics packages
    // ✅ Has @upstash/ratelimit (internal analytics only, not user tracking)
  }
}
```

**Environment Variables:**
```env
# .env.example - NO analytics config
# ❌ No ANALYTICS_*
# ❌ No POSTHOG_*
# ❌ No PLAUSIBLE_*
# ❌ No GA_*
```

**Conclusion:**
- **User tracking:** None
- **Event tracking:** None
- **Error tracking:** None (Sentry mentioned in tech stack but not implemented)
- **Performance monitoring:** None
- **Revenue analytics:** Only via Stripe Dashboard (external)

### What We're Missing (Critical Gaps)

| Category | Missing Metrics | Business Impact |
|----------|-----------------|-----------------|
| **User Acquisition** | Signup source, referral tracking, campaign attribution | Can't optimize marketing spend |
| **User Behavior** | Feature usage, workflow creation rate, node usage heatmap | Don't know what features matter |
| **Conversions** | Free→Pro conversion rate, funnel drop-offs, upgrade triggers | Can't improve revenue |
| **Product Health** | Execution success rate, error frequency, workflow completion | Can't fix bugs fast |
| **Revenue** | MRR, churn rate, LTV, ARPU, expansion revenue | Can't forecast growth |
| **Growth** | DAU/WAU/MAU, retention cohorts, viral coefficient | Can't measure product-market fit |
| **Performance** | API latency, page load time, 3D render time | Can't optimize UX |

---

## 2️⃣ METRICS WE NEED

### A. User Acquisition & Onboarding

**Tracking Goal:** Understand where users come from and how they onboard.

| Metric | Definition | Why It Matters | How to Track |
|--------|------------|----------------|--------------|
| **Signup Source** | Channel user came from | Optimize marketing budget | UTM params + PostHog |
| **Registration Completion Rate** | % who complete signup form | Identify friction points | Funnel tracking |
| **Time to First Workflow** | Minutes from signup to creating first workflow | Measure onboarding quality | Event timestamps |
| **Activation Rate** | % who run their first workflow within 24h | True activation metric | Cohort analysis |

**Events to Track:**
- `page_view` (landing page)
- `signup_started`
- `user_registered`
- `workflow_created`
- `first_execution`

### B. Product Usage & Engagement

**Tracking Goal:** Understand how users interact with the workflow builder.

| Metric | Definition | Why It Matters | How to Track |
|--------|------------|----------------|--------------|
| **DAU / WAU / MAU** | Daily/Weekly/Monthly Active Users | Core growth metric | Unique users per period |
| **Node Usage Heatmap** | Which nodes are most/least used | Guide product roadmap | Node execution events |
| **Workflow Completion Rate** | % of workflows that execute successfully | Product quality metric | Success vs. error rate |
| **Retention (D1, D7, D30)** | % of users who return after 1/7/30 days | Product stickiness | Cohort retention |

**Events to Track:**
- `node_added`
- `node_connected`
- `workflow_executed`
- `execution_failed`
- `artifact_downloaded`

### C. Conversion & Monetization

**Tracking Goal:** Maximize free → paid conversions and reduce churn.

| Metric | Definition | Why It Matters | How to Track |
|--------|------------|----------------|--------------|
| **Free → Pro Conversion Rate** | % of free users who upgrade to Pro | Primary revenue driver | Subscription events |
| **Churn Rate** | % of subscribers who cancel per month | Revenue retention | Cancellation events |
| **MRR** | Total monthly subscription revenue | Growth metric | Stripe webhook |
| **LTV** | Average revenue per customer over lifetime | CAC comparison | Cohort analysis |

**Events to Track:**
- `paywall_viewed`
- `upgrade_clicked`
- `subscription_created`
- `subscription_cancelled`
- `payment_failed`

### D. Performance & Errors

**Tracking Goal:** Monitor system health and user experience quality.

| Metric | Definition | Why It Matters | How to Track |
|--------|------------|----------------|--------------|
| **API Latency (p50, p95, p99)** | Response time percentiles | UX quality | Sentry performance |
| **Error Rate** | % of requests that fail | System stability | Sentry error tracking |
| **Execution Success Rate** | % of workflows that complete successfully | Product reliability | Execution events |

---

## 3️⃣ TOOL EVALUATION

### Option 1: PostHog ⭐ RECOMMENDED

**What it is:** Open-source product analytics platform.

**Pros:**
- ✅ Complete product analytics suite (events, funnels, retention, cohorts)
- ✅ Session replay - Watch user sessions when errors occur
- ✅ Feature flags - Gradual rollouts, A/B testing
- ✅ Self-hostable - Keep data private, GDPR compliant
- ✅ Free tier - 1M events/month free
- ✅ Developer-friendly - Great React SDK, TypeScript support
- ✅ Autocapture - Tracks clicks/pageviews automatically

**Cons:**
- ⚠️ Heavier than Plausible (~15KB vs 1KB script)
- ⚠️ More complex setup than simple pageview tracking

**Pricing:**
- **Free:** 1M events/month, unlimited users, 1 year data retention
- **Paid:** $0.00031/event after 1M

**Verdict:** ⭐⭐⭐⭐⭐ **BEST FOR NEOBIM**  
- Need session replay to debug canvas workflows
- Feature flags critical for hackathon
- Funnels & cohorts essential for conversions

---

### Option 2: Sentry ⭐ ESSENTIAL

**What it is:** Error tracking and performance monitoring.

**Pros:**
- ✅ Best error tracking in industry
- ✅ Source map support - See exact code line
- ✅ Performance monitoring - API latency, page load
- ✅ Release tracking - Track bugs per deployment

**Pricing:**
- **Free:** 5K errors/month
- **Team:** $26/month (50K errors)

**Verdict:** ⭐⭐⭐⭐⭐ **ESSENTIAL FOR PRODUCTION**  
- Use alongside PostHog
- PostHog = user behavior, Sentry = errors

---

### Option 3: Plausible Analytics

**What it is:** Privacy-focused, lightweight pageview tracker.

**Pros:**
- ✅ Tiny script (< 1KB)
- ✅ Privacy-first, GDPR compliant
- ✅ Beautiful UI
- ✅ No cookie banner needed

**Cons:**
- ❌ Pageviews only (no custom events)
- ❌ No user identification
- ❌ No funnels/cohorts

**Pricing:** $9/month (10K pageviews)

**Verdict:** ⭐⭐⭐☆☆ **OPTIONAL**  
- Use for landing page analytics
- NOT enough for product analytics

---

### Final Recommendation

**Multi-Tool Stack:**

| Tool | Purpose | Cost | Priority |
|------|---------|------|----------|
| **PostHog** | Product analytics, session replay | Free (1M events/mo) | 🔥 CRITICAL |
| **Sentry** | Error tracking, performance | Free (5K errors/mo) | 🔥 CRITICAL |
| **Vercel Analytics** | Page load performance | Free (100K views/mo) | ✅ Nice to have |
| **Stripe Dashboard** | Revenue analytics | Free (built-in) | 🔥 CRITICAL |

**Total Cost:** $0/month (all free tiers)  
**Total Setup Time:** 8-10 hours

---

## 4️⃣ RECOMMENDED ARCHITECTURE

### Analytics Layer Structure

```
src/lib/analytics/
├── index.ts              # Main analytics facade (single export)
├── posthog.ts            # PostHog client config
├── sentry.ts             # Sentry client config
├── events.ts             # Event definitions (TypeScript types)
└── utils.ts              # Helper functions

src/hooks/
└── useAnalytics.ts       # React hook for components

src/app/providers/
└── AnalyticsProvider.tsx  # Context provider
```

### Event Naming Convention

**Format:** `object_action` (snake_case)

**Examples:**
- ✅ `workflow_created`
- ✅ `node_added`
- ✅ `subscription_upgraded`
- ✅ `execution_failed`
- ❌ `createdWorkflow` (camelCase - bad)

---

## 5️⃣ IMPLEMENTATION PLAN

### Phase 1: Foundation (2-3 hours)

#### Step 1.1: Install Dependencies

```bash
npm install posthog-js @sentry/nextjs
```

#### Step 1.2: Add Environment Variables

**Add to `.env.local`:**
```env
# PostHog (Product Analytics)
NEXT_PUBLIC_POSTHOG_KEY="phc_your_posthog_project_key"
NEXT_PUBLIC_POSTHOG_HOST="https://app.posthog.com"

# Sentry (Error Tracking)
NEXT_PUBLIC_SENTRY_DSN="https://xxxxx@xxxxx.ingest.sentry.io/xxxxx"
SENTRY_AUTH_TOKEN="your_sentry_auth_token"
SENTRY_ORG="your_sentry_org"
SENTRY_PROJECT="neobim-workflow-builder"

# Feature Flags
NEXT_PUBLIC_ENABLE_ANALYTICS="true"
NEXT_PUBLIC_ENABLE_SESSION_REPLAY="true"
```

#### Step 1.3: Create Analytics Client

**File: `src/lib/analytics/posthog.ts`**
```typescript
import posthog from 'posthog-js'

if (typeof window !== 'undefined') {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true'
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  
  if (enabled && key) {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      loaded: (posthog) => {
        if (process.env.NODE_ENV === 'development') {
          posthog.debug()
        }
      },
      capture_pageview: false,
      autocapture: true,
      session_recording: {
        maskAllInputs: false,
        maskInputOptions: {
          password: true,
        },
      },
    })
  }
}

export default posthog
```

#### Step 1.4: Create Analytics Facade

**File: `src/lib/analytics/index.ts`**
```typescript
import posthog from './posthog'
import { Sentry } from './sentry'

class Analytics {
  identify(userId: string, traits?: Record<string, any>) {
    if (typeof window === 'undefined') return
    posthog?.identify(userId, traits)
    Sentry?.setUser({ id: userId, email: traits?.email })
  }
  
  track(eventName: string, properties?: Record<string, any>) {
    if (typeof window === 'undefined') return
    posthog?.capture(eventName, properties)
  }
  
  page(pageName?: string, properties?: Record<string, any>) {
    if (typeof window === 'undefined') return
    posthog?.capture('$pageview', {
      $current_url: window.location.href,
      page: pageName,
      ...properties,
    })
  }
  
  reset() {
    if (typeof window === 'undefined') return
    posthog?.reset()
    Sentry?.setUser(null)
  }
  
  captureError(error: Error, context?: Record<string, any>) {
    if (typeof window === 'undefined') return
    Sentry?.captureException(error, { extra: context })
  }
}

export const analytics = new Analytics()
```

#### Step 1.5: Create React Hook

**File: `src/hooks/useAnalytics.ts`**
```typescript
import { useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { analytics } from '@/lib/analytics'

export function useAnalytics() {
  const { data: session } = useSession()
  
  useEffect(() => {
    if (session?.user) {
      const user = session.user as any
      analytics.identify(user.id, {
        email: user.email,
        name: user.name,
        plan: user.role || 'FREE',
      })
    } else {
      analytics.reset()
    }
  }, [session])
  
  const track = useCallback((eventName: string, properties?: Record<string, any>) => {
    analytics.track(eventName, properties)
  }, [])
  
  const page = useCallback((pageName?: string, properties?: Record<string, any>) => {
    analytics.page(pageName, properties)
  }, [])
  
  return { track, page }
}
```

---

### Phase 2: Page View Tracking (1 hour)

#### Step 2.1: Create Analytics Provider

**File: `src/components/providers/AnalyticsProvider.tsx`**
```typescript
'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { analytics } from '@/lib/analytics'

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  
  useEffect(() => {
    if (pathname) {
      analytics.page(pathname)
    }
  }, [pathname])
  
  return <>{children}</>
}
```

#### Step 2.2: Update Root Layout

**File: `src/app/layout.tsx`**
```typescript
import { AnalyticsProvider } from "@/components/providers/AnalyticsProvider"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <SessionProvider>
          <AnalyticsProvider>
            <MobileGate>{children}</MobileGate>
          </AnalyticsProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
```

---

### Phase 3: Event Tracking (3 hours)

**Track these key events:**

#### 3.1 User Events

**In `src/app/api/auth/register/route.ts`:**
```typescript
import { analytics } from '@/lib/analytics'

export async function POST(req: Request) {
  // ... existing code ...
  
  analytics.identify(newUser.id, {
    email: newUser.email,
    plan: 'FREE',
    signupDate: new Date().toISOString(),
  })
  
  analytics.track('user_registered', {
    userId: newUser.id,
    provider: 'email',
  })
}
```

**In `src/app/(auth)/login/page.tsx`:**
```typescript
import { useAnalytics } from '@/hooks/useAnalytics'

export default function LoginPage() {
  const { track } = useAnalytics()
  
  const handleLogin = async () => {
    // ... existing code ...
    track('user_logged_in', { provider: 'email' })
  }
}
```

#### 3.2 Workflow Events

**In workflow creation page:**
```typescript
const { track } = useAnalytics()

const handleCreateWorkflow = async () => {
  // ... existing code ...
  track('workflow_created', { workflow_id: workflow.id })
}
```

**In canvas editor:**
```typescript
const handleNodeAdd = (nodeType: string) => {
  // ... existing code ...
  track('node_added', { node_type: nodeType, workflow_id: workflowId })
}
```

**In execution API:**
```typescript
// Success
analytics.track('execution_completed', {
  workflow_id: workflowId,
  execution_time_ms: Date.now() - startTime,
  success: true,
})

// Failure
analytics.track('execution_failed', {
  workflow_id: workflowId,
  error_type: error.name,
})
```

#### 3.3 Billing Events

**In billing page:**
```typescript
const handleUpgradeClick = (plan: string) => {
  track('upgrade_clicked', { from_plan: userRole, to_plan: plan })
}
```

**In Stripe webhook:**
```typescript
// Subscription created
analytics.track('subscription_created', {
  userId: user.id,
  plan: 'PRO',
  price: 79,
})

// Subscription cancelled
analytics.track('subscription_cancelled', {
  userId: user.id,
  plan: user.role,
})
```

---

## 6️⃣ DASHBOARD DESIGN

### PostHog Dashboards

#### Dashboard 1: Executive Overview (Daily Check)

| Metric | Goal | Alert |
|--------|------|-------|
| **DAU** | Upward trend | < 10/day |
| **New Signups** | 10% WoW growth | < 5/day |
| **Free → Pro Conversions** | 5% rate | < 1% |
| **MRR** | $1000 by March 12 | Flat |
| **Workflow Executions** | 100+/day | < 20/day |
| **Error Rate** | < 2% | > 5% |

#### Dashboard 2: User Funnel

1. Landing Page View → 100%
2. Signup Started → 60%
3. Registration Complete → 45%
4. First Workflow Created → 30%
5. First Execution → 25%
6. Upgrade Clicked → 8%
7. Subscription Created → 5%

#### Dashboard 3: Product Engagement

- Most Used Nodes (bar chart)
- Execution Success Rate (percentage)
- Average Workflow Complexity (line)
- Session Duration (histogram)

---

## 7️⃣ ENVIRONMENT VARIABLES

### Add to `.env.local`

```env
# PostHog
NEXT_PUBLIC_POSTHOG_KEY="phc_XXXXXXXXXXXX"
NEXT_PUBLIC_POSTHOG_HOST="https://app.posthog.com"

# Sentry
NEXT_PUBLIC_SENTRY_DSN="https://xxxxx@xxxxx.ingest.sentry.io/xxxxx"
SENTRY_AUTH_TOKEN="sntrys_XXXXXXXXXXXX"
SENTRY_ORG="your-org"
SENTRY_PROJECT="neobim-workflow-builder"

# Feature Flags
NEXT_PUBLIC_ENABLE_ANALYTICS="true"
NEXT_PUBLIC_ENABLE_SESSION_REPLAY="true"
```

---

## 8️⃣ FILE STRUCTURE

### New Files to Create

```
src/
├── lib/analytics/
│   ├── index.ts              # Analytics facade
│   ├── posthog.ts            # PostHog config
│   ├── sentry.ts             # Sentry config
│   └── events.ts             # Event types
├── hooks/
│   └── useAnalytics.ts       # React hook
└── components/providers/
    └── AnalyticsProvider.tsx # Context provider
```

### Files to Modify

```
✏️  src/app/layout.tsx
✏️  src/app/(auth)/login/page.tsx
✏️  src/app/api/auth/register/route.ts
✏️  src/app/dashboard/billing/page.tsx
✏️  src/app/api/stripe/webhook/route.ts
✏️  package.json
✏️  .env.local
```

---

## 9️⃣ TESTING CHECKLIST

### Before Going Live

- [ ] Create PostHog account → https://app.posthog.com
- [ ] Create Sentry account → https://sentry.io
- [ ] Copy API keys to `.env.local`
- [ ] `npm run dev` → verify no errors
- [ ] Register test user → see `user_registered` in PostHog
- [ ] Create workflow → see `workflow_created` event
- [ ] Execute workflow → see `execution_completed` event
- [ ] Check Sentry → no unexpected errors
- [ ] Test session replay → can watch user session

---

## 🔟 GO-LIVE PLAN

### Day 1-2: Setup (4 hours)
- Install dependencies
- Set up PostHog & Sentry accounts
- Create analytics abstraction layer
- Add page view tracking

### Day 3: Core Events (3 hours)
- Track auth events (signup, login, logout)
- Track workflow creation & execution
- Track node operations

### Day 4: Conversions (2 hours)
- Track billing page interactions
- Track Stripe subscription events

### Day 5: Dashboards (2 hours)
- Build PostHog dashboards
- Set up alerts
- Monitor metrics

---

## 📌 SUMMARY

**What We're Building:**
- PostHog for product analytics & session replay
- Sentry for error tracking
- Complete event tracking (auth, workflows, billing)
- Real-time dashboards

**Total Cost:** $0/month (free tiers)  
**Implementation Time:** 8-10 hours  
**Priority:** 🔥 CRITICAL for hackathon

**Critical Metrics to Watch:**
1. **DAU** - Are people using it?
2. **Signups** - Is marketing working?
3. **Conversions** - Is pricing right?
4. **MRR** - Are we hitting revenue target?
5. **Error Rate** - Is the app stable?

---

## 🚀 NEXT STEPS

1. **Create PostHog account** (5 min) → https://app.posthog.com
2. **Create Sentry account** (5 min) → https://sentry.io
3. **Follow Phase 1** (2 hours) → Install & setup
4. **Ship it!**

**Questions?**
- PostHog docs: https://posthog.com/docs
- Sentry docs: https://docs.sentry.io

**LET'S TRACK EVERYTHING AND WIN THIS HACKATHON.** 🔥
