import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/features/billing/lib/stripe';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import {
  formatErrorResponse,
  UserErrors,
  BillingErrors,
  FormErrors
} from '@/lib/user-errors';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    // Rate limit: 5 checkout attempts per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id!, "stripe-checkout", 5, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait before trying again.", code: "RATE_001" }), { status: 429 });
    }

    let plan: string;
    try {
      ({ plan } = await req.json());
    } catch {
      return NextResponse.json(
        formatErrorResponse({ title: "Invalid request", message: "Invalid request body.", code: "FORM_001" }),
        { status: 400 }
      );
    }

    // Validate plan (accept both 'TEAM' and 'TEAM_ADMIN' from frontend)
    const normalizedPlan = plan === 'TEAM' ? 'TEAM_ADMIN' : plan;
    if (!normalizedPlan || !['MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'].includes(normalizedPlan)) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("plan")),
        { status: 400 }
      );
    }

    // Resolve priceId server-side from env
    const priceId = normalizedPlan === 'MINI'
      ? process.env.STRIPE_MINI_PRICE_ID
      : normalizedPlan === 'STARTER'
      ? process.env.STRIPE_STARTER_PRICE_ID
      : normalizedPlan === 'PRO'
      ? process.env.STRIPE_PRICE_ID
      : process.env.STRIPE_TEAM_PRICE_ID;
    if (!priceId) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Configuration error",
          message: "Stripe price is not configured. Please contact support.",
          code: "STRIPE_CONFIG",
        }),
        { status: 500 }
      );
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true, email: true, name: true },
    });

    if (!user) {
      return NextResponse.json(
        formatErrorResponse({
          title: "User not found",
          message: "Your account could not be found. Please try signing out and back in.",
          code: "USER_001",
          action: "Sign Out",
          actionUrl: "/api/auth/signout",
        }),
        { status: 404 }
      );
    }

    // Guard against duplicate subscriptions — but allow re-subscription if old one is dead
    if (user.stripeSubscriptionId) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        if (['active', 'trialing', 'past_due'].includes(existingSub.status)) {
          // Subscription is alive — user should use the billing portal to change plans
          return NextResponse.json(
            formatErrorResponse({
              title: "Subscription already active",
              message: "You already have an active subscription. Please use the billing portal to change plans.",
              code: "BILL_001",
              action: "Manage Subscription",
              actionUrl: "/dashboard/billing",
            }),
            { status: 400 }
          );
        }
        // Subscription is dead (canceled, incomplete_expired, unpaid) — clear stale data
        console.info('[stripe/checkout] Clearing stale subscription:', {
          userId: user.id,
          oldSubId: user.stripeSubscriptionId,
          oldStatus: existingSub.status,
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubscriptionId: null, stripePriceId: null, stripeCurrentPeriodEnd: null },
        });
      } catch {
        // Can't verify old subscription (deleted on Stripe?) — clear stale data
        console.warn('[stripe/checkout] Could not verify subscription, clearing:', user.stripeSubscriptionId);
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubscriptionId: null, stripePriceId: null, stripeCurrentPeriodEnd: null },
        });
      }
    }

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email: user.email!,
          name: user.name || undefined,
          metadata: { userId: user.id },
        });
        customerId = customer.id;

        // Save customer ID
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: customerId },
        });
      } catch (stripeError: unknown) {
        console.error("[stripe/checkout] Customer creation failed:", stripeError);
        return NextResponse.json(
          formatErrorResponse({
            title: "Payment setup failed",
            message: "Unable to set up your payment account. Please try again or contact support.",
            code: "STRIPE_001",
          }),
          { status: 500 }
        );
      }
    }

    // Validate NEXTAUTH_URL
    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) {
      console.error('[stripe/checkout] NEXTAUTH_URL is not configured');
      return NextResponse.json(
        formatErrorResponse({ title: "Server configuration error", message: "A server configuration is missing. Please contact support.", code: "NET_001" }),
        { status: 500 }
      );
    }

    // Create checkout session
    try {
      // Auto-apply coupon if configured, otherwise allow promo code input
      const defaultCoupon = process.env.STRIPE_DEFAULT_COUPON_ID;

      const checkoutSession = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/thank-you/subscription?plan=${normalizedPlan}`,
        cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
        ...(defaultCoupon
          ? { discounts: [{ coupon: defaultCoupon }] }
          : { allow_promotion_codes: true }),
        metadata: {
          userId: user.id,
          plan: normalizedPlan,
        },
      });

      return NextResponse.json({ url: checkoutSession.url });
    } catch (stripeError: unknown) {
      console.error("[stripe/checkout] Session creation failed:", stripeError);

      // Handle specific Stripe errors
      if (stripeError instanceof Error && (stripeError as { code?: string }).code === 'resource_missing') {
        return NextResponse.json(
          formatErrorResponse({
            title: "Invalid plan selected",
            message: "The selected plan is not available. Please choose a different plan.",
            code: "STRIPE_002",
          }),
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        formatErrorResponse(BillingErrors.PAYMENT_FAILED),
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error('[stripe/checkout] Unexpected error:', error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 }
    );
  }
}
