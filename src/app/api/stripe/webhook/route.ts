import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    console.error('[STRIPE_WEBHOOK] Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    console.error('[STRIPE_WEBHOOK] Webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
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
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );

          await updateUserSubscription(
            session.customer as string,
            subscription
          );
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await updateUserSubscription(subscription.customer as string, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await cancelUserSubscription(subscription.customer as string);
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

      default:
        console.info('[STRIPE_WEBHOOK] Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[STRIPE_WEBHOOK] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function updateUserSubscription(
  stripeCustomerId: string,
  subscription: Stripe.Subscription
) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId },
  });

  if (!user) {
    console.error('[STRIPE_WEBHOOK] User not found for customer:', stripeCustomerId);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = getPlanByPriceId(priceId);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeCurrentPeriodEnd: new Date((subscription as any).current_period_end as number * 1000),
      role: plan,
    },
  });

  console.info('[STRIPE_WEBHOOK] Updated user subscription:', {
    userId: user.id,
    plan,
    subscriptionId: subscription.id,
  });
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
