import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { auth, invalidateUserRoleCache } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { checkEndpointRateLimit } from '@/lib/rate-limit';
import { formatErrorResponse, UserErrors } from '@/lib/user-errors';
import { reconcileUserSubscription } from '@/features/billing/lib/reconcile';

/**
 * POST /api/user/self-reconcile
 *
 * User-facing self-heal: the currently signed-in user asks us to look them up
 * on Stripe and Razorpay and fix their role if a live subscription exists
 * that's not reflected in the DB.
 *
 * Called from the dashboard layout on mount (fire-and-forget) so a user who
 * paid but whose webhook / verify failed gets auto-upgraded by simply opening
 * the app. Rate-limited.
 *
 * Order of operations:
 *   1. If the user already has a Razorpay or Stripe subscription ID in the DB,
 *      defer to the shared `reconcileUserSubscription` helper — fast path.
 *   2. Stripe fallback: if the user has a `stripeCustomerId`, list their
 *      active/trialing subscriptions. If found, bind.
 *   3. Stripe discovery: if no customer id, search Stripe customers by email
 *      and check them for active subscriptions.
 *   4. Razorpay discovery: list all Razorpay subscriptions in live states and
 *      match this user by `notes.userId`, `notes.email`, `payment.email`, or
 *      `payment.contact`. Match by email is case-insensitive.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rl = await checkEndpointRateLimit(session.user.id, 'user-self-reconcile', 5, '10 m');
    if (!rl.success) {
      return NextResponse.json(
        formatErrorResponse({
          title: 'Too many requests',
          message: 'Please wait a few minutes before trying again.',
          code: 'RATE_001',
        }),
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        role: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        razorpaySubscriptionId: true,
        razorpayPlanId: true,
      },
    });
    if (!user) {
      return NextResponse.json(
        formatErrorResponse({ title: 'User not found', message: 'No account found.', code: 'AUTH_001' }),
        { status: 404 },
      );
    }

    // Fast path: user already has subscription metadata → reuse the shared helper.
    if (user.stripeSubscriptionId || user.razorpaySubscriptionId) {
      const outcome = await reconcileUserSubscription({
        id: user.id,
        role: user.role,
        stripeSubscriptionId: user.stripeSubscriptionId,
        razorpaySubscriptionId: user.razorpaySubscriptionId,
        razorpayPlanId: user.razorpayPlanId,
      });
      return NextResponse.json({ path: 'fast', outcome, currentRole: user.role });
    }

    // Only users currently on FREE need discovery. Paid users can skip.
    if (user.role !== 'FREE') {
      return NextResponse.json({ path: 'noop', reason: 'already_paid', currentRole: user.role });
    }

    // ── Stripe discovery ───────────────────────────────────────────
    const tryStripeBind = async (sub: Stripe.Subscription) => {
      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id ?? null;
      const newRole = getPlanByPriceId(priceId);
      if (newRole === 'FREE' && priceId) {
        return { status: 'unresolved' as const, reason: 'unmapped_price_id', priceId };
      }
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const periodEnd =
        firstItem?.current_period_end ??
        (sub as unknown as { current_period_end?: number }).current_period_end ??
        Math.floor(Date.now() / 1000);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          role: newRole,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          stripeCurrentPeriodEnd: new Date(periodEnd * 1000),
        },
      });
      invalidateUserRoleCache(user.id);
      return {
        status: 'reconciled' as const,
        gateway: 'stripe' as const,
        previousRole: user.role,
        newRole,
        subscriptionId: sub.id,
        priceId,
      };
    };

    // Check by stored stripeCustomerId first
    if (user.stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: 'all',
          limit: 5,
        });
        const live = subs.data.find((s) =>
          ['active', 'trialing', 'past_due'].includes(s.status),
        );
        if (live) {
          const out = await tryStripeBind(live);
          if (out.status === 'reconciled') {
            return NextResponse.json({ path: 'stripe_by_customer', outcome: out });
          }
        }
      } catch (err) {
        console.warn('[self-reconcile] stripe by customer failed:', err);
      }
    }

    // Fall back to email-based customer discovery on Stripe
    if (user.email) {
      try {
        const customers = await stripe.customers.list({ email: user.email, limit: 5 });
        for (const c of customers.data) {
          if (c.deleted) continue;
          const subs = await stripe.subscriptions.list({
            customer: c.id,
            status: 'all',
            limit: 5,
          });
          const live = subs.data.find((s) =>
            ['active', 'trialing', 'past_due'].includes(s.status),
          );
          if (live) {
            const out = await tryStripeBind(live);
            if (out.status === 'reconciled') {
              return NextResponse.json({ path: 'stripe_by_email', outcome: out });
            }
          }
        }
      } catch (err) {
        console.warn('[self-reconcile] stripe by email failed:', err);
      }
    }

    // ── Razorpay discovery ────────────────────────────────────────
    try {
      interface RazorpaySubLike {
        id: string;
        status: string;
        plan_id?: string;
        current_end?: number;
        charge_at?: number;
        notes?: Record<string, unknown>;
      }
      interface RazorpayPaymentLike {
        subscription_id?: string;
        email?: string;
        contact?: string;
      }
      const PAGE = 100;
      const candidates: RazorpaySubLike[] = [];
      for (let i = 0; i < 3; i++) {
        const page = await razorpay.subscriptions.all({ count: PAGE, skip: i * PAGE });
        const items = (page.items as unknown as RazorpaySubLike[]) || [];
        for (const s of items) {
          if (!['active', 'authenticated', 'pending'].includes(s.status)) continue;
          let notes: Record<string, unknown> = {};
          if (s.notes && typeof s.notes === 'object') notes = s.notes;
          const nUid = typeof notes.userId === 'string' ? notes.userId.trim() : '';
          const nEmail = typeof notes.email === 'string' ? notes.email.trim().toLowerCase() : '';
          if (nUid === user.id) { candidates.unshift(s); continue; }
          if (user.email && nEmail === user.email.toLowerCase()) { candidates.push(s); continue; }
        }
        if (items.length < PAGE) break;
      }

      let picked = candidates[0];

      // If notes didn't match, scan payments for email/contact match.
      if (!picked && (user.email || user.phoneNumber)) {
        const seenSubs = new Set<string>();
        const normalizedPhone = (user.phoneNumber || '').replace(/\D/g, '');
        for (let i = 0; i < 3; i++) {
          const page = await razorpay.payments.all({ count: PAGE, skip: i * PAGE });
          const items = (page.items as unknown as RazorpayPaymentLike[]) || [];
          for (const p of items) {
            if (!p.subscription_id || seenSubs.has(p.subscription_id)) continue;
            const emailMatch =
              user.email && p.email &&
              p.email.toLowerCase() === user.email.toLowerCase();
            const contactDigits = (p.contact || '').replace(/\D/g, '');
            const phoneMatch =
              normalizedPhone.length >= 10 &&
              contactDigits.endsWith(normalizedPhone.slice(-10));
            if (emailMatch || phoneMatch) {
              seenSubs.add(p.subscription_id);
              try {
                const subFetched = (await razorpay.subscriptions.fetch(
                  p.subscription_id,
                )) as unknown as RazorpaySubLike;
                if (['active', 'authenticated', 'pending'].includes(subFetched.status)) {
                  picked = subFetched;
                  break;
                }
              } catch { /* ignore */ }
            }
          }
          if (picked) break;
          if (items.length < PAGE) break;
        }
      }

      if (picked) {
        const planId = picked.plan_id ?? null;
        const newRole = getRoleByRazorpayPlanId(planId);
        if (newRole === 'FREE' && planId) {
          return NextResponse.json({
            path: 'razorpay_unresolved',
            outcome: {
              status: 'unresolved',
              reason: 'unmapped_plan_id',
              planId,
              subscriptionId: picked.id,
            },
          });
        }
        const periodEnd = picked.current_end || picked.charge_at;
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            razorpaySubscriptionId: picked.id,
            razorpayPlanId: planId,
            paymentGateway: 'razorpay',
            stripeCurrentPeriodEnd: currentPeriodEnd,
          },
        });
        invalidateUserRoleCache(user.id);
        return NextResponse.json({
          path: 'razorpay_discovery',
          outcome: {
            status: 'reconciled',
            gateway: 'razorpay',
            previousRole: user.role,
            newRole,
            subscriptionId: picked.id,
            planId,
          },
        });
      }
    } catch (err) {
      console.warn('[self-reconcile] razorpay discovery failed:', err);
    }

    return NextResponse.json({
      path: 'no_subscription_found',
      currentRole: user.role,
    });
  } catch (error) {
    console.error('[self-reconcile] Unexpected error:', error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
