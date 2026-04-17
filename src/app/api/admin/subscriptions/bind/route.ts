import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { getAdminSession, unauthorizedResponse, logAudit } from '@/lib/admin-server';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { invalidateUserRoleCache } from '@/lib/auth';

/**
 * POST /api/admin/subscriptions/bind
 *
 * Manually assign a Stripe or Razorpay subscription to a specific user.
 * Used when the automatic reconcile surfaces an orphan (live subscription
 * but no notes/metadata/email match) — admin pastes the paying user's
 * email from the DB and we bind the sub to them.
 *
 * Body: { gateway: "stripe" | "razorpay", subscriptionId, userEmail OR userId }
 *
 * Behavior:
 *   - Fetch the live subscription from the provider
 *   - Resolve role from its plan_id / price_id
 *   - If plan can't be mapped (env drift), return `unresolved` and do NOT
 *     touch the user's role — same no-downgrade guarantee as everywhere else.
 *   - Otherwise write full subscription state into the user record + audit log.
 */
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  let body: {
    gateway?: 'stripe' | 'razorpay';
    subscriptionId?: string;
    userEmail?: string;
    userId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const gateway = body.gateway;
  const subscriptionId = body.subscriptionId?.trim();
  const userEmail = body.userEmail?.trim();
  const userIdRaw = body.userId?.trim();

  if (gateway !== 'stripe' && gateway !== 'razorpay') {
    return NextResponse.json({ error: 'gateway must be "stripe" or "razorpay"' }, { status: 400 });
  }
  if (!subscriptionId) {
    return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
  }
  if (!userEmail && !userIdRaw) {
    return NextResponse.json({ error: 'userEmail or userId is required' }, { status: 400 });
  }

  // Resolve the target user. Email lookup is case-insensitive so we don't
  // silently mis-match Google-vs-Credentials emails.
  const user = await prisma.user.findFirst({
    where: userIdRaw
      ? { id: userIdRaw }
      : { email: { equals: userEmail!, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      role: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      stripeCustomerId: true,
      razorpaySubscriptionId: true,
      razorpayPlanId: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      { error: `No user found for ${userIdRaw ? `id=${userIdRaw}` : `email=${userEmail}`}` },
      { status: 404 },
    );
  }

  // ─────────────── Stripe ───────────────
  if (gateway === 'stripe') {
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (err) {
      return NextResponse.json(
        { error: `Stripe fetch failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }

    const firstItem = sub.items?.data?.[0];
    const priceId = firstItem?.price?.id ?? null;
    const newRole = getPlanByPriceId(priceId);

    if (newRole === 'FREE' && priceId) {
      return NextResponse.json({
        bound: false,
        reason: 'unmapped_price_id',
        priceId,
        message: 'The subscription price is not mapped to any plan env var. Fix STRIPE_*_PRICE_ID first, then rerun.',
      });
    }

    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const periodEnd =
      firstItem?.current_period_end ??
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      Math.floor(Date.now() / 1000);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: newRole,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(periodEnd * 1000),
      },
      select: { id: true, email: true, role: true },
    });
    invalidateUserRoleCache(user.id);

    await logAudit(session.id, 'USER_ROLE_CHANGED', 'user', user.id, {
      source: 'admin_manual_bind',
      gateway: 'stripe',
      previousRole: user.role,
      newRole,
      subscriptionId: sub.id,
      priceId,
      customerId,
      reason: 'Admin manually bound an orphan Stripe subscription to this user',
    });

    return NextResponse.json({
      bound: true,
      gateway: 'stripe',
      previousRole: user.role,
      newRole,
      user: updated,
      subscription: { id: sub.id, priceId, status: sub.status },
    });
  }

  // ─────────────── Razorpay ───────────────
  interface RazorpaySubShape {
    id: string;
    status: string;
    plan_id?: string;
    current_end?: number;
    charge_at?: number;
    notes?: Record<string, unknown>;
  }

  let sub: RazorpaySubShape;
  try {
    sub = (await razorpay.subscriptions.fetch(subscriptionId)) as unknown as RazorpaySubShape;
  } catch (err) {
    return NextResponse.json(
      { error: `Razorpay fetch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const planId = sub.plan_id ?? null;
  const newRole = getRoleByRazorpayPlanId(planId);

  if (newRole === 'FREE' && planId) {
    return NextResponse.json({
      bound: false,
      reason: 'unmapped_plan_id',
      planId,
      message: 'The subscription plan is not mapped to any role env var. Fix RAZORPAY_*_PLAN_ID first, then rerun.',
    });
  }

  const periodEnd = sub.current_end || sub.charge_at;
  const currentPeriodEnd = periodEnd
    ? new Date(periodEnd * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: newRole,
      razorpaySubscriptionId: sub.id,
      razorpayPlanId: planId,
      paymentGateway: 'razorpay',
      stripeCurrentPeriodEnd: currentPeriodEnd,
    },
    select: { id: true, email: true, role: true },
  });
  invalidateUserRoleCache(user.id);

  await logAudit(session.id, 'USER_ROLE_CHANGED', 'user', user.id, {
    source: 'admin_manual_bind',
    gateway: 'razorpay',
    previousRole: user.role,
    newRole,
    subscriptionId: sub.id,
    planId,
    reason: 'Admin manually bound an orphan Razorpay subscription to this user',
  });

  return NextResponse.json({
    bound: true,
    gateway: 'razorpay',
    previousRole: user.role,
    newRole,
    user: updated,
    subscription: { id: sub.id, planId, status: sub.status },
  });
}
