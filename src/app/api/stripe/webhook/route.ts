import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import Stripe from 'stripe';
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendPlanChangedEmail,
} from '@/services/email';

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[STRIPE_WEBHOOK] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json(formatErrorResponse({ title: "Server misconfiguration", message: "Webhook secret is not configured. Please contact support.", code: "NET_001" }), { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    console.error('[STRIPE_WEBHOOK] Missing stripe-signature header');
    return NextResponse.json(
      formatErrorResponse({ title: "Invalid request", message: "Missing stripe-signature header.", code: "VAL_001" }),
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error('[STRIPE_WEBHOOK] Webhook signature verification failed:', error);
    return NextResponse.json(
      formatErrorResponse({ title: "Verification failed", message: "Webhook signature verification failed.", code: "VAL_001" }),
      { status: 400 }
    );
  }

  console.info('[STRIPE_WEBHOOK] Event received:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Handle successful checkout
        if (session.mode === 'subscription' && session.customer) {
          const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
          if (!subscriptionId) break;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);

          const customerId = typeof session.customer === 'string'
            ? session.customer
            : session.customer.id;

          await updateUserSubscription(customerId, subscription);

          // Send welcome email (fire-and-forget)
          const checkoutUser = await prisma.user.findFirst({
            where: { stripeCustomerId: customerId },
            select: { email: true, name: true, role: true },
          });
          if (checkoutUser?.email) {
            sendWelcomeEmail(checkoutUser.email, checkoutUser.name, checkoutUser.role).catch(() => {});
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
        await updateUserSubscription(customerId, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
        await cancelUserSubscription(customerId);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.info('[STRIPE_WEBHOOK] Payment succeeded for invoice:', invoice.id);
        
        // Optionally send receipt email or notification
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.error('[STRIPE_WEBHOOK] Payment failed for invoice:', invoice.id);

        // Send payment failed email
        const failedCustomerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;
        if (failedCustomerId) {
          const failedUser = await prisma.user.findFirst({
            where: { stripeCustomerId: failedCustomerId },
            select: { email: true, name: true },
          });
          if (failedUser?.email) {
            sendPaymentFailedEmail(failedUser.email, failedUser.name).catch(() => {});
          }
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription;
        console.info('[STRIPE_WEBHOOK] Trial ending soon for customer:', subscription.customer);
        break;
      }

      case 'customer.updated': {
        const customer = event.data.object as Stripe.Customer;
        if (customer.email) {
          const user = await prisma.user.findFirst({ where: { stripeCustomerId: customer.id } });
          if (user && user.email !== customer.email) {
            console.info('[STRIPE_WEBHOOK] Syncing email from Stripe:', { userId: user.id, newEmail: customer.email });
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        console.info('[STRIPE_WEBHOOK] Charge refunded:', { chargeId: charge.id, amount: charge.amount_refunded });
        break;
      }

      default:
        console.info('[STRIPE_WEBHOOK] Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[STRIPE_WEBHOOK] Error processing webhook:', error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}

async function updateUserSubscription(
  stripeCustomerId: string,
  subscription: Stripe.Subscription
) {
  // Only grant paid role for active/trialing; downgrade for all other statuses
  const paidStatuses: Stripe.Subscription.Status[] = ['active', 'trialing'];
  if (!paidStatuses.includes(subscription.status)) {
    console.info('[STRIPE_WEBHOOK] Non-active subscription status, downgrading to FREE:', {
      customerId: stripeCustomerId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });

    const user = await prisma.user.findFirst({ where: { stripeCustomerId } });
    if (!user) {
      console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
      return;
    }

    // For terminal statuses, clear all subscription fields so the user can re-subscribe.
    // For past_due, keep fields so Stripe can retry and webhook can re-activate.
    const terminalStatuses: string[] = ['canceled', 'incomplete_expired', 'unpaid'];
    const isTerminal = terminalStatuses.includes(subscription.status);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: isTerminal ? null : subscription.id,
        stripePriceId: isTerminal ? null : undefined,
        stripeCurrentPeriodEnd: isTerminal ? null : undefined,
        role: 'FREE',
      },
    });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

  const previousRole = user.role;

  // Webhook payloads may not include items fully — retrieve from API if needed
  let sub = subscription;
  if (!sub.items?.data?.length) {
    console.info('[STRIPE_WEBHOOK] Items not in payload, retrieving subscription:', sub.id);
    sub = await stripe.subscriptions.retrieve(sub.id);
  }

  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? null;
  const plan = getPlanByPriceId(priceId);

  // current_period_end: prefer item-level, fall back to sub-level, then now
  const currentPeriodEnd = firstItem?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end
    ?? Math.floor(Date.now() / 1000);

  // CRITICAL: If a paid subscription resolves to FREE, something is wrong with price ID mapping
  if (plan === 'FREE' && priceId) {
    console.error('[STRIPE_WEBHOOK] CRITICAL: Paid subscription resolved to FREE role!', {
      userId: user.id,
      priceId,
      subscriptionId: sub.id,
      subscriptionStatus: sub.status,
      envMini: process.env.STRIPE_MINI_PRICE_ID,
      envStarter: process.env.STRIPE_STARTER_PRICE_ID,
      envPro: process.env.STRIPE_PRICE_ID,
      envTeam: process.env.STRIPE_TEAM_PRICE_ID,
    });
  }

  console.info('[STRIPE_WEBHOOK] Attempting role update:', {
    userId: user.id,
    priceId,
    resolvedPlan: plan,
    subscriptionId: sub.id,
    subscriptionStatus: sub.status,
    hasItems: !!firstItem,
  });

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
        role: plan,
      },
    });

    console.info('[STRIPE_WEBHOOK] Successfully updated user subscription:', {
      userId: user.id,
      plan,
      subscriptionId: sub.id,
    });

    // Send plan changed email if role actually changed (fire-and-forget)
    if (previousRole !== plan && user.email) {
      const TIER_ORDER = ['FREE', 'MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'];
      const type = TIER_ORDER.indexOf(plan) > TIER_ORDER.indexOf(previousRole) ? 'upgrade' : 'downgrade';
      sendPlanChangedEmail(user.email, user.name, previousRole, plan, type).catch(() => {});
    }
  } catch (dbError) {
    console.error('[STRIPE_WEBHOOK] CRITICAL: DB update failed! User paid but role not updated.', {
      userId: user.id,
      priceId,
      plan,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
    throw dbError; // Re-throw so Stripe retries the webhook
  }
}

async function cancelUserSubscription(stripeCustomerId: string) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

  const previousRole = user.role;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
      role: 'FREE',
    },
  });

  console.info('[STRIPE_WEBHOOK] Canceled user subscription:', user.id);

  // Send cancellation email (fire-and-forget)
  if (user.email) {
    sendSubscriptionCanceledEmail(user.email, user.name, previousRole).catch(() => {});
  }
}
