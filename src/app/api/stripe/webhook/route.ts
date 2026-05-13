import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import Stripe from 'stripe';
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendPlanChangedEmail,
  sendPaidSubscriptionNotification,
} from '@/shared/services/email';
import { checkWebhookIdempotency, clearWebhookIdempotency } from '@/lib/webhook-idempotency';
import { invalidateUserRoleCache } from '@/lib/auth';
import { logAudit } from "@/lib/admin-server";
import { trackServerPurchase } from "@/lib/server-conversions";
import { getPlanValueINR, getPlanValueEUR } from "@/lib/plan-pricing";
import { billingFeatureFlags } from '@/features/billing/lib/feature-flags';
import {
  billingGraceWindowFlagOff,
  billingRolePreservedInGrace,
  billingCancelWithNoPeriodEnd,
  billingPastDuePreserved,
} from '@/features/billing/lib/metrics';
import { applyImmediateDowngrade } from '@/features/billing/lib/role-transitions';

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

  // Idempotency: skip already-processed events
  const isDuplicate = await checkWebhookIdempotency('stripe', event.id);
  if (isDuplicate) {
    console.info('[STRIPE_WEBHOOK] Duplicate event skipped:', event.id);
    return NextResponse.json({ received: true, duplicate: true });
  }

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
            select: { id: true, email: true, name: true, role: true, phoneNumber: true },
          });
          if (checkoutUser?.email) {
            sendWelcomeEmail(checkoutUser.email, checkoutUser.name, checkoutUser.role).catch((err) => console.error("[webhook] Failed to send welcome email:", err));

            // Server-side conversion: Meta CAPI (fire-and-forget)
            // Currency reported to ad platforms is EUR — see plan-pricing.ts
            // header. Stripe charges users in INR (`session.amount_total`),
            // but we deliberately do NOT pass that through; the EUR plan map
            // is the single source of truth for ad-side value.
            // fbp/fbc/clientIp/clientUa are stashed on session.metadata at
            // checkout creation so this webhook (which fires from Stripe's
            // servers, no browser cookies) can still attribute the Purchase to
            // the browser session that initiated it.
            trackServerPurchase({
              userId: checkoutUser.id,
              email: checkoutUser.email,
              phone: checkoutUser.phoneNumber,
              firstName: checkoutUser.name?.split(" ")[0],
              plan: checkoutUser.role,
              currency: "EUR",
              value: getPlanValueEUR(checkoutUser.role),
              fbp: session.metadata?.fbp || undefined,
              fbc: session.metadata?.fbc || undefined,
              ip: session.metadata?.clientIp || undefined,
              userAgent: session.metadata?.clientUa || undefined,
            }).catch(err => console.warn("[meta-capi]", err));
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

        // Grace-aware termination intercept. Active / trialing / incomplete
        // fall through to the existing updateUserSubscription path; the four
        // cancel-class statuses route through the grace handler.
        const status = subscription.status;
        if (
          status === 'canceled' ||
          status === 'incomplete_expired' ||
          status === 'unpaid' ||
          status === 'past_due'
        ) {
          await handleStripeSubscriptionStatusEvent(customerId, subscription, event.id);
          break;
        }

        await updateUserSubscription(customerId, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
        await handleStripeSubscriptionDeleted(customerId, subscription, event.id);
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
            sendPaymentFailedEmail(failedUser.email, failedUser.name).catch((err) => console.error("[webhook] Failed to send payment failed email:", err));
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
    await clearWebhookIdempotency('stripe', event.id);
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
  // Paid tier stays granted for active/trialing AND past_due — Stripe's Smart
  // Retries keep the subscription in past_due for up to ~3 weeks while it
  // re-attempts the failed renewal. Downgrading immediately would kick paying
  // users off the plan for a transient card decline. When retries truly fail,
  // Stripe transitions to canceled/unpaid and fires customer.subscription.deleted,
  // which is handled separately via cancelUserSubscription().
  const paidStatuses: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due'];
  if (!paidStatuses.includes(subscription.status)) {
    console.info('[STRIPE_WEBHOOK] Non-active subscription status, downgrading to FREE:', {
      customerId: stripeCustomerId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });

    const user = await prisma.user.findFirst({
      where: { stripeCustomerId },
      select: { id: true, role: true },
    });
    if (!user) {
      console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
      return;
    }

    // For terminal statuses, clear all subscription fields so the user can re-subscribe.
    // For past_due, keep fields so Stripe can retry and webhook can re-activate.
    const terminalStatuses: string[] = ['canceled', 'incomplete_expired', 'unpaid'];
    const isTerminal = terminalStatuses.includes(subscription.status);

    const isRoleChange = user.role !== 'FREE';
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: isTerminal ? null : subscription.id,
        stripePriceId: isTerminal ? null : undefined,
        stripeCurrentPeriodEnd: isTerminal ? null : undefined,
        paymentGateway: isTerminal ? null : undefined,
        role: 'FREE',
        ...(isRoleChange && {
          legacyLimits: Prisma.DbNull,
          legacyLimitsSetAt: null,
          planChangedAt: new Date(),
        }),
      },
    });
    if (isRoleChange) invalidateUserRoleCache(user.id);

    // Audit log the cancellation/downgrade
    logAudit(null, "USER_ROLE_CHANGED", "user", user.id, {
      source: "stripe_webhook",
      previousRole: user.role,
      newRole: "FREE",
      reason: `subscription_${subscription.status}`,
      subscriptionId: subscription.id,
      isTerminal,
    }).catch(() => {});

    return;
  }

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
    select: { id: true, email: true, name: true, role: true, phoneNumber: true },
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

  // CRITICAL FIX: If a paid subscription resolves to FREE, the priceId doesn't
  // match any env var. Do NOT downgrade the user — keep their current role and
  // log a critical error so ops can investigate the price mapping.
  if (plan === 'FREE' && priceId) {
    console.error('[STRIPE_WEBHOOK] CRITICAL: Paid subscription resolved to FREE role! Refusing to downgrade user.', {
      userId: user.id,
      priceId,
      subscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentRole: previousRole,
      envMini: process.env.STRIPE_MINI_PRICE_ID,
      envStarter: process.env.STRIPE_STARTER_PRICE_ID,
      envPro: process.env.STRIPE_PRICE_ID,
      envTeam: process.env.STRIPE_TEAM_PRICE_ID,
    });

    // Still update Stripe metadata (so we can retry later), but preserve the
    // user's existing role instead of blindly setting FREE.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
        // DO NOT change role — keep previousRole
      },
    });

    // Audit log the failed mapping so admins can see it
    logAudit(null, "USER_ROLE_CHANGED", "user", user.id, {
      source: "stripe_webhook",
      action: "BLOCKED — priceId not mapped",
      priceId,
      subscriptionId: sub.id,
      currentRole: previousRole,
    }).catch(() => {});

    return; // Early return — do NOT update role
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
    const isRoleChange = previousRole !== plan;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
        paymentGateway: 'stripe',
        role: plan,
        ...(isRoleChange && {
          legacyLimits: Prisma.DbNull,
          legacyLimitsSetAt: null,
          planChangedAt: new Date(),
        }),
      },
    });
    if (isRoleChange) invalidateUserRoleCache(user.id);

    console.info('[STRIPE_WEBHOOK] Successfully updated user subscription:', {
      userId: user.id,
      plan,
      subscriptionId: sub.id,
    });

    // Audit log the role change so it's visible in admin dashboard
    if (previousRole !== plan) {
      logAudit(null, "USER_ROLE_CHANGED", "user", user.id, {
        source: "stripe_webhook",
        previousRole,
        newRole: plan,
        priceId,
        subscriptionId: sub.id,
        subscriptionStatus: sub.status,
      }).catch(() => {});
    }

    // Send plan changed email if role actually changed (fire-and-forget)
    if (previousRole !== plan && user.email) {
      const TIER_ORDER = ['FREE', 'MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'];
      const type = TIER_ORDER.indexOf(plan) > TIER_ORDER.indexOf(previousRole) ? 'upgrade' : 'downgrade';
      sendPlanChangedEmail(user.email, user.name, previousRole, plan, type).catch((err) => console.error("[webhook] Failed to send plan changed email:", err));
    }

    // Team notification to buildflow786@gmail.com — fires ONCE per user on
    // first paid activation (FREE → any paid tier). Upgrades between paid
    // tiers (Starter → Pro) go through sendPlanChangedEmail above but do
    // NOT fire this team ping — the team already knows about paid users.
    // Phone: prefer DB, fall back to Stripe Customer.phone (single cheap
    // API call, tolerated failures).
    if (previousRole === 'FREE' && plan !== 'FREE' && user.email) {
      void (async () => {
        let phone = user.phoneNumber ?? null;
        if (!phone) {
          try {
            const customer = await stripe.customers.retrieve(stripeCustomerId);
            if (customer && !customer.deleted && customer.phone) {
              phone = customer.phone;
            }
          } catch (err) {
            console.warn('[webhook] Could not enrich phone from Stripe customer:', err);
          }
        }
        sendPaidSubscriptionNotification({
          name: user.name,
          email: user.email!,
          phone,
          plan,
          amountInr: getPlanValueINR(plan),
          gateway: 'stripe',
          subscriptionId: sub.id,
        }).catch((err) => console.error('[webhook] Failed to send team subscription notification:', err));
      })();
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

/**
 * Grace-aware handler for `customer.subscription.deleted`.
 *
 * Flag OFF: emit billing.grace_window_flag_off, run cancelUserSubscription_LEGACY
 *           byte-for-byte unchanged. This is the rollback path.
 *
 * Flag ON:
 *   - period_end missing → emit alert metric, refuse to act.
 *   - period_end > now (cancel-immediately scenario can hit this) → preserve
 *     role, refresh stripeCurrentPeriodEnd, emit preserved metric.
 *   - period_end <= now (typical end-of-period cancel) → applyImmediateDowngrade.
 *
 * Exported for tests.
 */
export async function handleStripeSubscriptionDeleted(
  customerId: string,
  subscription: Stripe.Subscription,
  webhookEventId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!billingFeatureFlags.graceWindowEnabled) {
    billingGraceWindowFlagOff({
      handler: 'stripe.customer.subscription.deleted',
      userId: user?.id ?? null,
      event: 'customer.subscription.deleted',
    });
    await cancelUserSubscription_LEGACY(customerId);
    return;
  }

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', customerId);
    return;
  }

  const periodEndUnix =
    subscription.items?.data?.[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  if (!periodEndUnix || periodEndUnix <= 0) {
    billingCancelWithNoPeriodEnd({
      provider: 'stripe',
      eventType: 'customer.subscription.deleted',
      userId: user.id,
      subscriptionId: subscription.id,
    });
    return;
  }

  const periodEnd = new Date(periodEndUnix * 1000);
  if (periodEnd > new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCurrentPeriodEnd: periodEnd },
    });
    billingRolePreservedInGrace({
      userId: user.id,
      provider: 'stripe',
      eventType: 'customer.subscription.deleted',
      graceUntilIso: periodEnd.toISOString(),
    });
    return;
  }

  await applyImmediateDowngrade({
    userId: user.id,
    reason: 'cancel_event_grace_already_past',
    triggeredBy: 'webhook',
    providerEventId: webhookEventId,
  });
}

/**
 * Grace-aware handler for `customer.subscription.updated` events whose
 * status is in {canceled, incomplete_expired, unpaid, past_due}. Other
 * statuses (active/trialing/incomplete) bypass this and go directly to
 * the existing updateUserSubscription path.
 *
 * Flag OFF: emit billing.grace_window_flag_off and call updateUserSubscription
 *           unchanged. The legacy non-paid-status branch inside that function
 *           handles the downgrade exactly as before.
 *
 * Flag ON:
 *   - past_due → emit billing.past_due_preserved and return. Stripe Smart
 *     Retries keep retrying for ~3 weeks; we never punish transient declines.
 *   - canceled / incomplete_expired / unpaid:
 *     period_end missing → alert, return.
 *     period_end > now → preserve role, refresh stripeCurrentPeriodEnd.
 *     period_end <= now → applyImmediateDowngrade.
 *
 * Exported for tests.
 */
export async function handleStripeSubscriptionStatusEvent(
  customerId: string,
  subscription: Stripe.Subscription,
  webhookEventId: string,
): Promise<void> {
  const status = subscription.status;
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!billingFeatureFlags.graceWindowEnabled) {
    billingGraceWindowFlagOff({
      handler: `stripe.customer.subscription.updated.${status}`,
      userId: user?.id ?? null,
      event: 'customer.subscription.updated',
    });
    await updateUserSubscription(customerId, subscription);
    return;
  }

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', customerId);
    return;
  }

  if (status === 'past_due') {
    billingPastDuePreserved({
      userId: user.id,
      provider: 'stripe',
    });
    return;
  }

  // canceled / incomplete_expired / unpaid
  const periodEndUnix =
    subscription.items?.data?.[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  if (!periodEndUnix || periodEndUnix <= 0) {
    billingCancelWithNoPeriodEnd({
      provider: 'stripe',
      eventType: `customer.subscription.updated.${status}`,
      userId: user.id,
      subscriptionId: subscription.id,
    });
    return;
  }

  const periodEnd = new Date(periodEndUnix * 1000);
  if (periodEnd > new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCurrentPeriodEnd: periodEnd },
    });
    billingRolePreservedInGrace({
      userId: user.id,
      provider: 'stripe',
      eventType: `customer.subscription.updated.${status}`,
      graceUntilIso: periodEnd.toISOString(),
    });
    return;
  }

  await applyImmediateDowngrade({
    userId: user.id,
    reason: 'cancel_event_grace_already_past',
    triggeredBy: 'webhook',
    providerEventId: webhookEventId,
  });
}

/**
 * LEGACY immediate-downgrade behaviour for customer.subscription.deleted.
 * Preserved BYTE-FOR-BYTE so flipping BILLING_GRACE_WINDOW_ENABLED back to
 * false instantly restores prior behaviour. Do NOT modify this function —
 * it is the rollback path.
 */
async function cancelUserSubscription_LEGACY(stripeCustomerId: string) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

  const previousRole = user.role;
  const isRoleChange = previousRole !== 'FREE';

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
      paymentGateway: null,
      role: 'FREE',
      ...(isRoleChange && {
        legacyLimits: Prisma.DbNull,
        legacyLimitsSetAt: null,
        planChangedAt: new Date(),
      }),
    },
  });
  invalidateUserRoleCache(user.id);

  console.info('[STRIPE_WEBHOOK] Canceled user subscription:', user.id);

  // Send cancellation email (fire-and-forget)
  if (user.email) {
    sendSubscriptionCanceledEmail(user.email, user.name, previousRole).catch((err) => console.error("[webhook] Failed to send subscription canceled email:", err));
  }
}
