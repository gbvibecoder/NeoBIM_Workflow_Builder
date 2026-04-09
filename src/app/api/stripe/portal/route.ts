import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/features/billing/lib/stripe';
import { prisma } from '@/lib/db';
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        formatErrorResponse({ title: "No billing account", message: "No Stripe customer found. Please subscribe to a plan first.", action: "View Plans", actionUrl: "/dashboard/billing", code: "BILL_001" }),
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) {
      console.error('[stripe/portal] NEXTAUTH_URL is not configured');
      return NextResponse.json(formatErrorResponse({ title: "Server configuration error", message: "A server configuration is missing. Please contact support.", code: "NET_001" }), { status: 500 });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/dashboard/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error: unknown) {
    console.error('Stripe portal error:', error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR, error instanceof Error ? error.message : String(error)),
      { status: 500 }
    );
  }
}
