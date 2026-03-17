import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import Stripe from 'stripe';
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

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
        
        // Optionally notify user about payment failure
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

    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: subscription.id,
        role: 'FREE',
      },
    });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = getPlanByPriceId(priceId);
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end
    ?? Math.floor(Date.now() / 1000);

  console.info('[STRIPE_WEBHOOK] Attempting role update:', {
    userId: user.id,
    priceId,
    resolvedPlan: plan,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
  });

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(currentPeriodEnd * 1000),
        role: plan,
      },
    });

    console.info('[STRIPE_WEBHOOK] Successfully updated user subscription:', {
      userId: user.id,
      plan,
      subscriptionId: subscription.id,
    });
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
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

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
}
