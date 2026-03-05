import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

// Initialize Stripe with API version
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
});

// Stripe pricing configuration
export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    priceId: null, // No Stripe price ID for free tier
    features: [
      '3 workflow runs per day',
      'Basic tiles & nodes',
      'Community templates',
      'Public workflows only',
    ],
    limits: {
      runsPerDay: 3,
      maxWorkflows: 5,
      maxNodesPerWorkflow: 10,
    },
  },
  PRO: {
    name: 'Pro',
    price: 79,
    priceId: process.env.STRIPE_PRO_PRICE_ID, // Set in .env
    features: [
      'Unlimited workflow runs',
      'All tiles & nodes',
      'Private workflows',
      'Priority support',
      'Advanced AI features',
      'Export to IFC/JSON/OBJ',
    ],
    limits: {
      runsPerDay: -1, // unlimited
      maxWorkflows: -1,
      maxNodesPerWorkflow: -1,
    },
  },
  TEAM: {
    name: 'Team',
    price: 149,
    priceId: process.env.STRIPE_TEAM_PRICE_ID, // Set in .env
    features: [
      'Everything in Pro',
      'Team collaboration',
      '5 team members',
      'Shared workflow library',
      'Team analytics',
      'Dedicated support',
    ],
    limits: {
      runsPerDay: -1,
      maxWorkflows: -1,
      maxNodesPerWorkflow: -1,
      teamMembers: 5,
    },
  },
} as const;

// Helper to get plan by price ID (returns Prisma UserRole enum)
export function getPlanByPriceId(priceId: string | null): 'FREE' | 'PRO' | 'TEAM_ADMIN' {
  if (!priceId) return 'FREE';
  if (priceId === STRIPE_PLANS.PRO.priceId) return 'PRO';
  if (priceId === STRIPE_PLANS.TEAM.priceId) return 'TEAM_ADMIN'; // Map TEAM to TEAM_ADMIN
  return 'FREE';
}

// Helper to check if subscription is active
export function isSubscriptionActive(
  stripeCurrentPeriodEnd: Date | null
): boolean {
  if (!stripeCurrentPeriodEnd) return false;
  return stripeCurrentPeriodEnd.getTime() > Date.now();
}
