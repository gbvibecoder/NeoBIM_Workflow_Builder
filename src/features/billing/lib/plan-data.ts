/**
 * Plan configuration — SINGLE SOURCE OF TRUTH.
 *
 * This file is intentionally free of server-only imports (no `stripe` SDK,
 * no `prisma`, no Node.js APIs). It can be safely imported by both server
 * and client components.
 *
 * The Stripe SDK instance and server-only helpers (getPlanByPriceId,
 * isSubscriptionActive, etc.) live in `stripe.ts`, which re-exports
 * STRIPE_PLANS from here for backward compatibility.
 */

// ── Node-type categories for metered features ──────────────────────────────
export const VIDEO_NODES = new Set(['GN-009']);
export const MODEL_3D_NODES = new Set(['GN-007', 'GN-008', 'GN-010']);
export const RENDER_NODES = new Set(['GN-003']);
export const BRIEF_RENDER_NODES = new Set<string>();

// ── Plan pricing configuration (INR for India market) ────────────────────
// Updated 2026-05-03: final pricing migration (P-FINAL).
// Prices are UNCHANGED — only limits changed.
// Existing users are grandfathered via User.legacyLimits (see getEffectiveLimits).
export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    currency: '₹',
    priceId: null as string | null,
    features: [
      '1 lifetime execution',
      'Basic tiles & nodes',
      'Community templates',
      '1 concept render',
    ],
    limits: {
      runsPerMonth: 1,
      maxWorkflows: 1,
      maxNodesPerWorkflow: 5,
      videoPerMonth: 0,
      modelsPerMonth: 0,
      rendersPerMonth: 1,
      floorPlansPerMonth: 1,
      briefRendersPerMonth: 0,
      briefToIfcV3RunsPerMonth: 0,
    },
  },
  MINI: {
    name: 'Mini',
    price: 99,
    currency: '₹',
    priceId: process.env.STRIPE_MINI_PRICE_ID as string | undefined,
    features: [
      '3 workflows + executions',
      'Basic tiles & nodes',
      'Community templates',
      '3 concept renders',
      'JSON/CSV export',
    ],
    limits: {
      runsPerMonth: 3,
      maxWorkflows: 3,
      maxNodesPerWorkflow: 12,
      videoPerMonth: 0,
      modelsPerMonth: 0,
      rendersPerMonth: 3,
      floorPlansPerMonth: 1,
      briefRendersPerMonth: 1,
      briefToIfcV3RunsPerMonth: 2,
    },
  },
  STARTER: {
    name: 'Starter',
    price: 799,
    currency: '₹',
    priceId: process.env.STRIPE_STARTER_PRICE_ID as string | undefined,
    features: [
      '15 workflows + executions',
      'All tiles & nodes',
      'Private workflows',
      '2 video walkthroughs',
      '2 AI 3D models',
      '8 concept renders',
      'Export to IFC/JSON/OBJ',
      'Email support',
    ],
    limits: {
      runsPerMonth: 15,
      maxWorkflows: 15,
      maxNodesPerWorkflow: 25,
      videoPerMonth: 2,
      modelsPerMonth: 2,
      rendersPerMonth: 8,
      floorPlansPerMonth: 5,
      briefRendersPerMonth: 5,
      briefToIfcV3RunsPerMonth: 5,
    },
  },
  PRO: {
    name: 'Pro',
    price: 1999,
    currency: '₹',
    priceId: process.env.STRIPE_PRICE_ID as string | undefined,
    features: [
      '45 workflows + executions',
      '7 video walkthroughs',
      '10 AI 3D models',
      '25 concept renders',
      'Priority execution',
      'Priority support',
    ],
    limits: {
      runsPerMonth: 45,
      maxWorkflows: 45,
      maxNodesPerWorkflow: -1,
      videoPerMonth: 7,
      modelsPerMonth: 10,
      rendersPerMonth: 25,
      floorPlansPerMonth: 15,
      briefRendersPerMonth: 15,
      briefToIfcV3RunsPerMonth: 20,
    },
  },
  TEAM: {
    name: 'Team',
    price: 4999,
    currency: '₹',
    priceId: process.env.STRIPE_TEAM_PRICE_ID as string | undefined,
    features: [
      'Everything in Pro',
      '300 workflows + executions',
      '20 video walkthroughs',
      '30 AI 3D models',
      '60 concept renders',
      '5 team members',
      'Team analytics',
      'Dedicated support',
    ],
    limits: {
      runsPerMonth: 300,
      maxWorkflows: 300,
      maxNodesPerWorkflow: -1,
      teamMembers: 5,
      videoPerMonth: 20,
      modelsPerMonth: 30,
      rendersPerMonth: 60,
      floorPlansPerMonth: 50,
      briefRendersPerMonth: 50,
      briefToIfcV3RunsPerMonth: 999,
    },
  },
} as const;

// ── Free-tier constant — single source of truth ─────────────────────────
// All user-facing copy that mentions the free execution count MUST reference
// this constant (or STRIPE_PLANS.FREE.limits.runsPerMonth, which it mirrors).
// The Redis rate-limiter reads from the env var; keep .env in sync.
export const FREE_TIER_EXECUTIONS = STRIPE_PLANS.FREE.limits.runsPerMonth;

// ── Helpers that only need STRIPE_PLANS (no Stripe SDK) ──────────────────

export function getBriefRendersMonthlyLimit(role: string): number {
  switch (role) {
    case 'PLATFORM_ADMIN':
    case 'TEAM_ADMIN':
      return STRIPE_PLANS.TEAM.limits.briefRendersPerMonth;
    case 'PRO':
      return STRIPE_PLANS.PRO.limits.briefRendersPerMonth;
    case 'STARTER':
      return STRIPE_PLANS.STARTER.limits.briefRendersPerMonth;
    case 'MINI':
      return STRIPE_PLANS.MINI.limits.briefRendersPerMonth;
    default:
      return STRIPE_PLANS.FREE.limits.briefRendersPerMonth;
  }
}

/**
 * Monthly cap on Brief-to-IFC v3 runs per user, by plan.
 *
 * FREE=0 prevents anyone using v3 without a paid plan (each run costs
 * ~$1.50 in Anthropic spend — FREE would burn margin instantly).
 * MINI=2 is taster, PRO=20 is production usage, TEAM=999 is effectively
 * unlimited with a guardrail.
 */
export function getBriefToIfcV3MonthlyLimit(role: string): number {
  switch (role) {
    case 'PLATFORM_ADMIN':
    case 'TEAM_ADMIN':
      return STRIPE_PLANS.TEAM.limits.briefToIfcV3RunsPerMonth;
    case 'PRO':
      return STRIPE_PLANS.PRO.limits.briefToIfcV3RunsPerMonth;
    case 'STARTER':
      return STRIPE_PLANS.STARTER.limits.briefToIfcV3RunsPerMonth;
    case 'MINI':
      return STRIPE_PLANS.MINI.limits.briefToIfcV3RunsPerMonth;
    default:
      return STRIPE_PLANS.FREE.limits.briefToIfcV3RunsPerMonth;
  }
}

export function getNodeTypeLimits(role: string) {
  switch (role) {
    case 'TEAM_ADMIN':
    case 'PLATFORM_ADMIN':
      return STRIPE_PLANS.TEAM.limits;
    case 'PRO':
      return STRIPE_PLANS.PRO.limits;
    case 'STARTER':
      return STRIPE_PLANS.STARTER.limits;
    case 'MINI':
      return STRIPE_PLANS.MINI.limits;
    default:
      return STRIPE_PLANS.FREE.limits;
  }
}
