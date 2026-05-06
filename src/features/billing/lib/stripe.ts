import Stripe from 'stripe';
import { STRIPE_PLANS } from './plan-data';

// Initialize Stripe — uses placeholder during build when env var is missing
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_placeholder_for_build', {
  apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
  typescript: true,
});

// ── Re-exports from plan-data.ts (client-safe, no Stripe SDK dep) ─────────
// Server-side consumers can keep importing from this file.
// Client-side consumers SHOULD import from plan-data.ts directly to avoid
// pulling the Stripe SDK into the browser bundle.
export {
  STRIPE_PLANS,
  VIDEO_NODES,
  MODEL_3D_NODES,
  RENDER_NODES,
  BRIEF_RENDER_NODES,
  getBriefRendersMonthlyLimit,
  getNodeTypeLimits,
} from './plan-data';

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

// Helper to check if subscription is active
export function isSubscriptionActive(
  stripeCurrentPeriodEnd: Date | null
): boolean {
  if (!stripeCurrentPeriodEnd) return false;
  return stripeCurrentPeriodEnd.getTime() > Date.now();
}
