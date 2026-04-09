import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/features/billing/lib/stripe';
import { prisma } from '@/lib/db';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';

function resolvePriceId(plan: string): string | undefined {
  switch (plan) {
    case 'MINI': return process.env.STRIPE_MINI_PRICE_ID;
    case 'STARTER': return process.env.STRIPE_STARTER_PRICE_ID;
    case 'PRO': return process.env.STRIPE_PRICE_ID;
    case 'TEAM_ADMIN': return process.env.STRIPE_TEAM_PRICE_ID;
    default: return undefined;
  }
}

/**
 * POST — Preview proration cost for a plan change.
 * Returns the amount the user will be charged/credited.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 10 previews per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, 'stripe-proration-preview', 10, '1 m');
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Too many requests', message: 'Please wait before trying again.', code: 'RATE_001' }),
        { status: 429 },
      );
    }

    let plan: string;
    try {
      ({ plan } = await req.json());
    } catch {
      return NextResponse.json(
        formatErrorResponse({ title: 'Invalid request', message: 'Invalid request body.', code: 'FORM_001' }),
        { status: 400 },
      );
    }

    const normalizedPlan = plan === 'TEAM' ? 'TEAM_ADMIN' : plan;
    if (!normalizedPlan || !['MINI', 'STARTER', 'PRO', 'TEAM_ADMIN'].includes(normalizedPlan)) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Invalid plan', message: 'Please select a valid plan.', code: 'VAL_001' }),
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeSubscriptionId: true },
    });

    if (!user?.stripeSubscriptionId) {
      return NextResponse.json(
        formatErrorResponse({ title: 'No subscription', message: 'No active subscription found.', code: 'BILL_001' }),
        { status: 400 },
      );
    }

    const newPriceId = resolvePriceId(normalizedPlan);
    if (!newPriceId) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Configuration error', message: 'Plan price not configured.', code: 'STRIPE_CONFIG' }),
        { status: 500 },
      );
    }

    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const currentItemId = subscription.items.data[0]?.id;
    if (!currentItemId) {
      return NextResponse.json(
        formatErrorResponse({ title: 'Subscription error', message: 'Unable to preview changes.', code: 'STRIPE_001' }),
        { status: 500 },
      );
    }

    // Create upcoming invoice preview for proration
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    const invoice = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.id,
      subscription_details: {
        items: [{ id: currentItemId, price: newPriceId }],
        proration_behavior: 'create_prorations',
      },
    });

    // Find proration line items (proration is nested in parent.invoice_item_details)
    const lines = invoice.lines?.data || [];
    const prorationItems = lines.filter(
      (line) => line.parent?.invoice_item_details?.proration === true
    );
    const prorationAmount = prorationItems.length > 0
      ? prorationItems.reduce((sum, item) => sum + item.amount, 0)
      : lines.reduce((sum, item) => sum + item.amount, 0);

    return NextResponse.json({
      prorationAmount: prorationAmount / 100, // Convert from paise to rupees
      currency: invoice.currency?.toUpperCase() || 'INR',
      immediateCharge: prorationAmount > 0 ? prorationAmount / 100 : 0,
      credit: prorationAmount < 0 ? Math.abs(prorationAmount) / 100 : 0,
      nextBillingDate: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
    });
  } catch (error: unknown) {
    console.error('[stripe/preview-proration] Error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
