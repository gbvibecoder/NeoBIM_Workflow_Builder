import { NextRequest, NextResponse } from 'next/server';
import { razorpay, verifyWebhookSignature, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { prisma } from '@/lib/db';
import { invalidateUserRoleCache } from '@/lib/auth';
import { formatErrorResponse } from '@/lib/user-errors';
import {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendPaidSubscriptionNotification,
} from '@/shared/services/email';
import { checkWebhookIdempotency, clearWebhookIdempotency } from '@/lib/webhook-idempotency';
import { trackServerPurchase } from '@/lib/server-conversions';
import { getPlanValueINR } from '@/lib/plan-pricing';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  // Verify webhook signature (if secret is configured)
  if (!verifyWebhookSignature(body, signature)) {
    console.error('[RAZORPAY_WEBHOOK] Signature verification failed');
    return NextResponse.json(
      formatErrorResponse({ title: 'Verification failed', message: 'Webhook signature invalid.', code: 'VAL_001' }),
      { status: 400 },
    );
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json(
      formatErrorResponse({ title: 'Invalid payload', message: 'Could not parse webhook body.', code: 'VAL_001' }),
      { status: 400 },
    );
  }

  const eventType = event.event as string;
  // Razorpay's real delivery ID is in the X-Razorpay-Event-Id header, not the
  // body. Falling back to Date.now() would make idempotency a no-op, so
  // combine the stable subscription/payment ID with the event type as a
  // best-effort fallback (prevents duplicate processing of a given status
  // change on a given subscription even if the header is missing).
  const headerEventId = req.headers.get('x-razorpay-event-id');
  const subId =
    (event.payload?.subscription?.entity?.id as string | undefined) ||
    (event.payload?.payment?.entity?.id as string | undefined);
  const eventId = headerEventId || (subId ? `${eventType}:${subId}` : `${eventType}_${Date.now()}`);
  console.info('[RAZORPAY_WEBHOOK] Event received:', eventType, eventId);

  // Idempotency: skip already-processed events
  const isDuplicate = await checkWebhookIdempotency('razorpay', eventId);
  if (isDuplicate) {
    console.info('[RAZORPAY_WEBHOOK] Duplicate event skipped:', eventId);
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        await activateSubscription(subscription);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired':
      case 'subscription.halted': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        await cancelSubscription(subscription);
        break;
      }

      case 'subscription.paused': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        await pauseSubscription(subscription);
        break;
      }

      case 'subscription.resumed': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        await activateSubscription(subscription);
        break;
      }

      case 'payment.failed': {
        const payment = event.payload?.payment?.entity;
        if (!payment) break;

        // Find user by subscription or notes
        const subscriptionId = payment.subscription_id;
        if (subscriptionId) {
          const user = await prisma.user.findFirst({
            where: { razorpaySubscriptionId: subscriptionId },
            select: { email: true, name: true },
          });
          if (user?.email) {
            sendPaymentFailedEmail(user.email, user.name).catch((err) => console.error("[webhook] Failed to send payment failed email:", err));
          }
        }
        break;
      }

      default:
        console.info('[RAZORPAY_WEBHOOK] Unhandled event:', eventType);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[RAZORPAY_WEBHOOK] Error processing webhook:', error);
    await clearWebhookIdempotency('razorpay', eventId);
    return NextResponse.json(
      formatErrorResponse({ title: 'Webhook error', message: 'Internal error processing webhook.', code: 'NET_001' }),
      { status: 500 },
    );
  }
}

async function activateSubscription(subscription: {
  id: string;
  plan_id?: string;
  notes?: { userId?: string; email?: string };
  current_end?: number;
  charge_at?: number;
}) {
  // Find user by subscription ID or notes.userId
  let user = await prisma.user.findFirst({
    where: { razorpaySubscriptionId: subscription.id },
    select: { id: true, email: true, name: true, role: true, phoneNumber: true },
  });

  // If not found by sub ID, try notes.userId
  if (!user && subscription.notes?.userId) {
    user = await prisma.user.findUnique({
      where: { id: subscription.notes.userId },
      select: { id: true, email: true, name: true, role: true, phoneNumber: true },
    });
  }

  if (!user) {
    console.error('[RAZORPAY_WEBHOOK] User not found for subscription:', subscription.id);
    return;
  }

  // Fetch fresh subscription from Razorpay API to get plan_id
  let planId = subscription.plan_id;
  if (!planId) {
    try {
      const freshSub = await razorpay.subscriptions.fetch(subscription.id);
      planId = freshSub.plan_id;
    } catch (e) {
      console.error('[RAZORPAY_WEBHOOK] Failed to fetch subscription from API:', e);
    }
  }

  const newRole = getRoleByRazorpayPlanId(planId || null);
  const previousRole = user.role;

  const periodEnd = subscription.current_end || subscription.charge_at;
  const currentPeriodEnd = periodEnd
    ? new Date(periodEnd * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // If a paid Razorpay plan_id can't be mapped to a role, refuse to downgrade.
  // Persist the subscription metadata so ops can backfill after fixing env vars,
  // but keep the user's existing role. Mirrors the Stripe webhook guard.
  if (newRole === 'FREE' && planId) {
    console.error('[RAZORPAY_WEBHOOK] CRITICAL: Paid subscription resolved to FREE — refusing to downgrade user.', {
      userId: user.id,
      planId,
      subscriptionId: subscription.id,
      currentRole: previousRole,
      envMini: process.env.RAZORPAY_MINI_PLAN_ID ? 'set' : 'MISSING',
      envStarter: process.env.RAZORPAY_STARTER_PLAN_ID ? 'set' : 'MISSING',
      envPro: process.env.RAZORPAY_PRO_PLAN_ID ? 'set' : 'MISSING',
      envTeam: process.env.RAZORPAY_TEAM_PLAN_ID ? 'set' : 'MISSING',
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: planId,
        paymentGateway: 'razorpay',
        stripeCurrentPeriodEnd: currentPeriodEnd,
        // role deliberately NOT touched
      },
    });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: newRole,
      razorpaySubscriptionId: subscription.id,
      razorpayPlanId: planId || null,
      paymentGateway: 'razorpay',
      stripeCurrentPeriodEnd: currentPeriodEnd,
    },
  });
  invalidateUserRoleCache(user.id);

  console.info('[RAZORPAY_WEBHOOK] Subscription activated:', {
    userId: user.id,
    previousRole,
    newRole,
    subscriptionId: subscription.id,
  });

  // Send welcome email on first activation
  if (previousRole === 'FREE' && user.email) {
    sendWelcomeEmail(user.email, user.name, newRole).catch((err) => console.error("[webhook] Failed to send welcome email:", err));

    // Team notification to buildflow786@gmail.com — fires ONCE per subscription
    // (this block only runs on FREE → paid transition). Renewal charges
    // (subscription.charged events) re-enter this function but previousRole
    // will already be paid, so we skip. Phone is best-effort: Prisma first,
    // Razorpay payment contact as fallback.
    void (async () => {
      let phone = user.phoneNumber ?? null;
      if (!phone) {
        try {
          const invoices = await razorpay.invoices.all({ subscription_id: subscription.id, count: 1 });
          const paymentId = invoices.items?.[0]?.payment_id;
          if (paymentId) {
            const payment = await razorpay.payments.fetch(paymentId);
            if (payment?.contact) phone = String(payment.contact);
          }
        } catch (err) {
          console.warn('[webhook] Could not enrich phone from Razorpay payment:', err);
        }
      }
      sendPaidSubscriptionNotification({
        name: user.name,
        email: user.email!,
        phone,
        plan: newRole,
        amountInr: getPlanValueINR(newRole),
        gateway: 'razorpay',
        subscriptionId: subscription.id,
      }).catch((err) => console.error('[webhook] Failed to send team subscription notification:', err));
    })();

    // Server-side conversion: Meta CAPI (fire-and-forget)
    trackServerPurchase({
      userId: user.id,
      email: user.email,
      firstName: user.name?.split(" ")[0],
      plan: newRole,
      currency: "INR",
      value: getPlanValueINR(newRole),
    }).catch(err => console.warn("[meta-capi]", err));
  }
}

async function cancelSubscription(subscription: { id: string }) {
  const user = await prisma.user.findFirst({
    where: { razorpaySubscriptionId: subscription.id },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error('[RAZORPAY_WEBHOOK] User not found for cancelled subscription:', subscription.id);
    return;
  }

  const previousRole = user.role;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'FREE',
      razorpaySubscriptionId: null,
      razorpayPlanId: null,
      stripeCurrentPeriodEnd: null,
      paymentGateway: null,
    },
  });
  invalidateUserRoleCache(user.id);

  console.info('[RAZORPAY_WEBHOOK] Subscription cancelled:', {
    userId: user.id,
    previousRole,
    subscriptionId: subscription.id,
  });

  if (user.email) {
    sendSubscriptionCanceledEmail(user.email, user.name, previousRole).catch((err) => console.error("[webhook] Failed to send subscription canceled email:", err));
  }
}

async function pauseSubscription(subscription: { id: string }) {
  const user = await prisma.user.findFirst({
    where: { razorpaySubscriptionId: subscription.id },
    select: { id: true, role: true, stripeCurrentPeriodEnd: true },
  });

  if (!user) return;

  // DO NOT downgrade the role. The user has already paid for the current
  // billing period — pausing the e-mandate only stops future renewals.
  // The role stays active until stripeCurrentPeriodEnd expires, at which
  // point the cancel/halt webhook (or the reconcile cron) will downgrade.
  console.info('[RAZORPAY_WEBHOOK] Subscription paused — role preserved until period end:', {
    userId: user.id,
    currentRole: user.role,
    periodEnd: user.stripeCurrentPeriodEnd,
    subscriptionId: subscription.id,
  });
}
