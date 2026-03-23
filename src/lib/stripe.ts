import Stripe from 'stripe';

// Initialize Stripe — uses placeholder during build when env var is missing
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_placeholder_for_build', {
  apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
  typescript: true,
});

// ── Node-type categories for metered features ──────────────────────────────
export const VIDEO_NODES = new Set(['GN-009']);
export const MODEL_3D_NODES = new Set(['GN-007', 'GN-008', 'GN-010']);
export const RENDER_NODES = new Set(['GN-003']);

// ── Stripe pricing configuration (INR for India market) ────────────────────
export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    currency: '₹',
    priceId: null, // No Stripe price ID for free tier
    features: [
      '3 executions per month',
      'Basic tiles & nodes',
      'Community templates',
      '1 concept render',
    ],
    limits: {
      runsPerMonth: 3,
      maxWorkflows: 3,
      maxNodesPerWorkflow: 10,
      videoPerMonth: 0,
      modelsPerMonth: 0,
      rendersPerMonth: 1,
    },
  },
  MINI: {
    name: 'Mini',
    price: 99,
    currency: '₹',
    priceId: process.env.STRIPE_MINI_PRICE_ID,
    features: [
      '10 executions per month',
      'Basic tiles & nodes',
      'Community templates',
      '3 concept renders',
      'JSON/CSV export',
    ],
    limits: {
      runsPerMonth: 10,
      maxWorkflows: 10,
      maxNodesPerWorkflow: 15,
      videoPerMonth: 0,
      modelsPerMonth: 0,
      rendersPerMonth: 3,
    },
  },
  STARTER: {
    name: 'Starter',
    price: 799,
    currency: '₹',
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    features: [
      '30 executions per month',
      'All tiles & nodes',
      'Private workflows',
      '3 video walkthroughs',
      '3 AI 3D models',
      '10 concept renders',
      'Export to IFC/JSON/OBJ',
      'Email support',
    ],
    limits: {
      runsPerMonth: 30,
      maxWorkflows: 30,
      maxNodesPerWorkflow: 25,
      videoPerMonth: 3,
      modelsPerMonth: 3,
      rendersPerMonth: 10,
    },
  },
  PRO: {
    name: 'Pro',
    price: 1999,
    currency: '₹',
    priceId: process.env.STRIPE_PRICE_ID, // Set in .env
    features: [
      '100 executions per month',
      '100 workflows',
      '7 video walkthroughs',
      '10 AI 3D models',
      '30 concept renders',
      'Priority execution',
      'Priority support',
    ],
    limits: {
      runsPerMonth: 100,
      maxWorkflows: 100,
      maxNodesPerWorkflow: -1,
      videoPerMonth: 7,
      modelsPerMonth: 10,
      rendersPerMonth: 30,
    },
  },
  TEAM: {
    name: 'Team',
    price: 4999,
    currency: '₹',
    priceId: process.env.STRIPE_TEAM_PRICE_ID, // Set in .env
    features: [
      'Everything in Pro',
      'Unlimited workflows',
      '15 video walkthroughs',
      '30 AI 3D models',
      'Unlimited renders',
      '5 team members',
      'Team analytics',
      'Dedicated support',
    ],
    limits: {
      runsPerMonth: -1,
      maxWorkflows: -1,
      maxNodesPerWorkflow: -1,
      teamMembers: 5,
      videoPerMonth: 15,
      modelsPerMonth: 30,
      rendersPerMonth: -1,
    },
  },
} as const;

// Helper to get plan by price ID (returns Prisma UserRole enum)
// Uses both cached STRIPE_PLANS and runtime env var re-read as fallback
// to guard against module-init race conditions where env vars aren't yet available.
export function getPlanByPriceId(priceId: string | null): 'FREE' | 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN' {
  if (!priceId) return 'FREE';

  // Primary: check against STRIPE_PLANS (cached at module init)
  if (priceId === STRIPE_PLANS.MINI.priceId) return 'MINI';
  if (priceId === STRIPE_PLANS.STARTER.priceId) return 'STARTER';
  if (priceId === STRIPE_PLANS.PRO.priceId) return 'PRO';
  if (priceId === STRIPE_PLANS.TEAM.priceId) return 'TEAM_ADMIN';

  // Fallback: re-read env vars at call time (handles cold-start edge cases)
  if (priceId === process.env.STRIPE_MINI_PRICE_ID) return 'MINI';
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return 'STARTER';
  if (priceId === process.env.STRIPE_PRICE_ID) return 'PRO';
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'TEAM_ADMIN';

  console.error('[stripe] getPlanByPriceId: UNRECOGNIZED priceId — user paid but plan cannot be resolved!', {
    priceId,
    envMini: process.env.STRIPE_MINI_PRICE_ID ? 'set' : 'MISSING',
    envStarter: process.env.STRIPE_STARTER_PRICE_ID ? 'set' : 'MISSING',
    envPro: process.env.STRIPE_PRICE_ID ? 'set' : 'MISSING',
    envTeam: process.env.STRIPE_TEAM_PRICE_ID ? 'set' : 'MISSING',
  });
  return 'FREE';
}

// Helper to get node-type limits for a given role
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

// Helper to check if subscription is active
export function isSubscriptionActive(
  stripeCurrentPeriodEnd: Date | null
): boolean {
  if (!stripeCurrentPeriodEnd) return false;
  return stripeCurrentPeriodEnd.getTime() > Date.now();
}
