import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
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

    const { plan } = await req.json();

    // Validate plan (accept both 'TEAM' and 'TEAM_ADMIN' from frontend)
    const normalizedPlan = plan === 'TEAM' ? 'TEAM_ADMIN' : plan;
    if (!normalizedPlan || !['PRO', 'TEAM_ADMIN'].includes(normalizedPlan)) {
      return NextResponse.json(
        formatErrorResponse(FormErrors.REQUIRED_FIELD("plan")),
        { status: 400 }
      );
    }

    // Resolve priceId server-side from env
    const priceId = normalizedPlan === 'PRO'
      ? process.env.STRIPE_PRICE_ID
      : process.env.STRIPE_TEAM_PRICE_ID ?? process.env.STRIPE_PRICE_ID;
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
      select: { id: true, stripeCustomerId: true, email: true, name: true },
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

    // Create checkout session
    try {
      // Auto-apply coupon if configured, otherwise allow promo code input
      const defaultCoupon = process.env.STRIPE_DEFAULT_COUPON_ID;

      const checkoutSession = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.NEXTAUTH_URL}/dashboard/billing?success=true`,
        cancel_url: `${process.env.NEXTAUTH_URL}/dashboard/billing?canceled=true`,
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
