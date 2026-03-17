import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { stripe, isSubscriptionActive, getPlanByPriceId } from '@/lib/stripe';
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 10 subscription checks per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, "stripe-subscription", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        stripeCurrentPeriodEnd: true,
      },
    });

    if (!user) {
      return NextResponse.json(formatErrorResponse({ title: "User not found", message: "No user account found for this session.", code: "AUTH_001" }), { status: 404 });
    }

    let subscriptionStatus = null;
    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId
        );
        const periodEnd = subscription.items.data[0]?.current_period_end;
        subscriptionStatus = {
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
          currentPeriodEnd: periodEnd
            ? new Date(periodEnd * 1000)
            : null,
        };
      } catch (error) {
        console.error('[STRIPE_SUBSCRIPTION] Failed to fetch subscription:', error);
      }
    }

    return NextResponse.json({
      role: user.role,
      subscription: subscriptionStatus,
      hasActiveSubscription: !!user.stripeSubscriptionId && isSubscriptionActive(user.stripeCurrentPeriodEnd),
    });
  } catch (error: unknown) {
    console.error('[STRIPE_SUBSCRIPTION]', error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}

/**
 * POST — Sync subscription from Stripe.
 * Safety net: If webhook failed (race condition, DB enum missing, etc.),
 * the billing page calls this after successful checkout to ensure the
 * user's role is updated.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 5 sync attempts per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, "stripe-sync", 5, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait before syncing again.", code: "RATE_001" }), { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return NextResponse.json(formatErrorResponse({ title: "User not found", message: "No user account found.", code: "AUTH_001" }), { status: 404 });
    }

    // No Stripe customer — nothing to sync
    if (!user.stripeCustomerId) {
      return NextResponse.json({ role: user.role, synced: false, reason: "no_stripe_customer" });
    }

    // Find active subscription for this customer directly from Stripe
    let activeSubscription: {
      id: string;
      priceId: string;
      currentPeriodEnd: number;
    } | null = null;

    try {
      // Check existing subscription ID first
      if (user.stripeSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        if (sub.status === 'active' || sub.status === 'trialing') {
          activeSubscription = {
            id: sub.id,
            priceId: sub.items.data[0]?.price.id,
            currentPeriodEnd: sub.items.data[0]?.current_period_end
              ?? Math.floor(Date.now() / 1000),
          };
        }
      }

      // If no active subscription found by ID, list all subscriptions for this customer
      if (!activeSubscription) {
        const activeSubscriptions = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: 'active',
          limit: 1,
        });

        let sub = activeSubscriptions.data[0];

        // Also check trialing subscriptions if no active one found
        if (!sub) {
          const trialingSubscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
            status: 'trialing',
            limit: 1,
          });
          sub = trialingSubscriptions.data[0];
        }

        if (sub) {
          activeSubscription = {
            id: sub.id,
            priceId: sub.items.data[0]?.price.id,
            currentPeriodEnd: sub.items.data[0]?.current_period_end
              ?? Math.floor(Date.now() / 1000),
          };
        }
      }
    } catch (stripeError) {
      console.error('[STRIPE_SYNC] Failed to fetch subscription from Stripe:', stripeError);
      return NextResponse.json(formatErrorResponse({
        title: "Sync failed",
        message: "Unable to verify subscription with Stripe. Please try again.",
        code: "STRIPE_SYNC_001",
      }), { status: 502 });
    }

    // No active subscription found on Stripe
    if (!activeSubscription) {
      return NextResponse.json({ role: user.role, synced: false, reason: "no_active_subscription" });
    }

    // Map price ID to plan role
    const newRole = getPlanByPriceId(activeSubscription.priceId);

    // Only update if role is different (or subscription details are different)
    if (user.role !== newRole || user.stripeSubscriptionId !== activeSubscription.id) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            stripeSubscriptionId: activeSubscription.id,
            stripePriceId: activeSubscription.priceId,
            stripeCurrentPeriodEnd: new Date(activeSubscription.currentPeriodEnd * 1000),
          },
        });

        console.info('[STRIPE_SYNC] Synced subscription for user:', {
          userId: user.id,
          oldRole: user.role,
          newRole,
          subscriptionId: activeSubscription.id,
        });

        return NextResponse.json({ role: newRole, synced: true, previousRole: user.role });
      } catch (dbError) {
        console.error('[STRIPE_SYNC] DB update failed:', dbError);
        return NextResponse.json(formatErrorResponse({
          title: "Database update failed",
          message: "Your payment was received but we couldn't update your plan. Please contact support.",
          code: "STRIPE_SYNC_002",
        }), { status: 500 });
      }
    }

    // Already in sync
    return NextResponse.json({ role: user.role, synced: false, reason: "already_synced" });
  } catch (error: unknown) {
    console.error('[STRIPE_SYNC] Unexpected error:', error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
