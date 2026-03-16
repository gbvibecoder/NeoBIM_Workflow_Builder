import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { stripe, isSubscriptionActive } from '@/lib/stripe';
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 10 subscription checks per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id!, "stripe-subscription", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
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
        subscriptionStatus = {
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
          currentPeriodEnd: (subscription as unknown as { current_period_end?: number }).current_period_end
            ? new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000)
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
