import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay — uses placeholder during build
export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
});

// ── Razorpay plan configuration (INR) ──────────────────────────────────────
export const RAZORPAY_PLANS = {
  MINI: {
    name: 'Mini',
    price: 99,
    planId: process.env.RAZORPAY_MINI_PLAN_ID,
  },
  STARTER: {
    name: 'Starter',
    price: 799,
    planId: process.env.RAZORPAY_STARTER_PLAN_ID,
  },
  PRO: {
    name: 'Pro',
    price: 1999,
    planId: process.env.RAZORPAY_PRO_PLAN_ID,
  },
  TEAM: {
    name: 'Team',
    price: 4999,
    planId: process.env.RAZORPAY_TEAM_PLAN_ID,
  },
} as const;

/**
 * Map a Razorpay plan_id to our UserRole enum.
 * Uses both cached RAZORPAY_PLANS and runtime env var re-read as fallback.
 */
export function getRoleByRazorpayPlanId(
  planId: string | null
): 'FREE' | 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN' {
  if (!planId) return 'FREE';

  // Primary: check against cached plan IDs
  if (planId === RAZORPAY_PLANS.MINI.planId) return 'MINI';
  if (planId === RAZORPAY_PLANS.STARTER.planId) return 'STARTER';
  if (planId === RAZORPAY_PLANS.PRO.planId) return 'PRO';
  if (planId === RAZORPAY_PLANS.TEAM.planId) return 'TEAM_ADMIN';

  // Fallback: re-read env vars at call time
  if (planId === process.env.RAZORPAY_MINI_PLAN_ID) return 'MINI';
  if (planId === process.env.RAZORPAY_STARTER_PLAN_ID) return 'STARTER';
  if (planId === process.env.RAZORPAY_PRO_PLAN_ID) return 'PRO';
  if (planId === process.env.RAZORPAY_TEAM_PLAN_ID) return 'TEAM_ADMIN';

  console.error('[razorpay] getRoleByRazorpayPlanId: UNRECOGNIZED planId!', {
    planId,
    envMini: process.env.RAZORPAY_MINI_PLAN_ID ? 'set' : 'MISSING',
    envStarter: process.env.RAZORPAY_STARTER_PLAN_ID ? 'set' : 'MISSING',
    envPro: process.env.RAZORPAY_PRO_PLAN_ID ? 'set' : 'MISSING',
    envTeam: process.env.RAZORPAY_TEAM_PLAN_ID ? 'set' : 'MISSING',
  });
  return 'FREE';
}

/** Resolve env plan ID from normalized plan name */
export function resolveRazorpayPlanId(plan: string): string | undefined {
  switch (plan) {
    case 'MINI': return process.env.RAZORPAY_MINI_PLAN_ID;
    case 'STARTER': return process.env.RAZORPAY_STARTER_PLAN_ID;
    case 'PRO': return process.env.RAZORPAY_PRO_PLAN_ID;
    case 'TEAM_ADMIN': return process.env.RAZORPAY_TEAM_PLAN_ID;
    default: return undefined;
  }
}

/**
 * Verify Razorpay payment signature after checkout.
 * sig = HMAC-SHA256(razorpay_payment_id + "|" + razorpay_subscription_id, key_secret)
 */
export function verifyPaymentSignature(params: {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const body = params.razorpay_payment_id + '|' + params.razorpay_subscription_id;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return expectedSignature === params.razorpay_signature;
}

/**
 * Verify Razorpay webhook signature.
 * sig = HMAC-SHA256(request_body, webhook_secret)
 */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // No webhook secret configured — fall back to API verification
    console.warn('[razorpay] No RAZORPAY_WEBHOOK_SECRET configured, skipping signature verification');
    return true;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
}
