import { NextRequest, NextResponse } from 'next/server';
import { razorpay, verifyWebhookSignature, getRoleByRazorpayPlanId } from '@/lib/razorpay';
import { prisma } from '@/lib/db';
import { formatErrorResponse } from '@/lib/user-errors';
import {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} from '@/services/email';
import { checkWebhookIdempotency } from '@/lib/webhook-idempotency';

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
  const eventId = event.event_id || `${eventType}_${Date.now()}`;
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
      case 'subscription.expired': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        await cancelSubscription(subscription);
        break;
      }

      case 'subscription.paused': {
        const subscription = event.payload?.subscription?.entity;
        if (!subscription?.id) break;

        // Pause = downgrade to FREE but keep subscription ID for resume
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
    select: { id: true, email: true, name: true, role: true },
  });

  // If not found by sub ID, try notes.userId
  if (!user && subscription.notes?.userId) {
    user = await prisma.user.findUnique({
      where: { id: subscription.notes.userId },
      select: { id: true, email: true, name: true, role: true },
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

  if (newRole === 'FREE' && planId) {
    console.error('[RAZORPAY_WEBHOOK] CRITICAL: Paid subscription resolved to FREE!', {
      userId: user.id,
      planId,
      subscriptionId: subscription.id,
    });
  }

  const periodEnd = subscription.current_end || subscription.charge_at;
  const currentPeriodEnd = periodEnd
    ? new Date(periodEnd * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

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

  console.info('[RAZORPAY_WEBHOOK] Subscription activated:', {
    userId: user.id,
    previousRole,
    newRole,
    subscriptionId: subscription.id,
  });

  // Send welcome email on first activation
  if (previousRole === 'FREE' && user.email) {
    sendWelcomeEmail(user.email, user.name, newRole).catch((err) => console.error("[webhook] Failed to send welcome email:", err));
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
    },
  });

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
    select: { id: true, role: true },
  });

  if (!user) return;

  // Keep subscription ID so it can be resumed, but downgrade role
  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'FREE' },
  });

  console.info('[RAZORPAY_WEBHOOK] Subscription paused:', {
    userId: user.id,
    previousRole: user.role,
    subscriptionId: subscription.id,
  });
}
