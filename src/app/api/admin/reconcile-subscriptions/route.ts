import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { getAdminSession, unauthorizedResponse, logAudit } from '@/lib/admin-server';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { invalidateUserRoleCache } from '@/lib/auth';

type Gateway = 'stripe' | 'razorpay';

interface ReportEntry {
  userId?: string;
  email: string | null;
  outcome: Record<string, unknown>;
}

interface ReportBuckets {
  reconciled: ReportEntry[];
  unresolved: ReportEntry[];
  orphans: ReportEntry[];
  errors: ReportEntry[];
  skipped: ReportEntry[];
}

function emptyBuckets(): ReportBuckets {
  return { reconciled: [], unresolved: [], orphans: [], errors: [], skipped: [] };
}

/**
 * GET — Cheap DB-only preview. Shows how many users in the DB look stuck
 * (have a Stripe/Razorpay subscription ID but are still on FREE). The real
 * story may be worse: POST does a deep scan that lists live subscriptions
 * directly from the payment providers, catching cases where the sub ID was
 * never even written to the DB (webhook never fired, verify crashed mid-flow).
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const [stuckInDb, paidInDb, withStripeCustomer] = await Promise.all([
    prisma.user.count({
      where: {
        role: 'FREE',
        OR: [
          { stripeSubscriptionId: { not: null } },
          { razorpaySubscriptionId: { not: null } },
        ],
      },
    }),
    prisma.user.count({ where: { role: { not: 'FREE' } } }),
    prisma.user.count({ where: { stripeCustomerId: { not: null }, role: 'FREE' } }),
  ]);

  const sample = await prisma.user.findMany({
    where: {
      role: 'FREE',
      OR: [
        { stripeSubscriptionId: { not: null } },
        { razorpaySubscriptionId: { not: null } },
        { stripeCustomerId: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      razorpaySubscriptionId: true,
      razorpayPlanId: true,
      paymentGateway: true,
      createdAt: true,
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    total: stuckInDb, // legacy field used by the admin UI badge
    stuckInDb,
    paidInDb,
    freeUsersWithStripeCustomer: withStripeCustomer,
    sample,
    note: 'POST performs a deep scan: lists live subscriptions directly from Stripe and Razorpay and matches them back to users by stripeCustomerId / subscription metadata / notes. This finds paid users even when no sub ID was ever written to our DB.',
  });
}

/**
 * POST — Deep subscription reconcile.
 *
 *  1. Stripe: list every `active`, `trialing`, and `past_due` subscription in
 *     our Stripe account (paginated). For each, match to a user via
 *     `stripeCustomerId`, `subscription.metadata.userId`, or the customer's
 *     email. Then map `price.id` → role and write the full subscription state
 *     into the DB.
 *
 *  2. Razorpay: list every subscription (paginated), filter to live statuses
 *     (`active`, `authenticated`, `pending`). For each, match to a user via
 *     `notes.userId`, `notes.email`, or an already-stored
 *     `razorpaySubscriptionId`. Map `plan_id` → role and write DB state.
 *
 * Never downgrades: when mapping yields `'FREE'` but a real plan/price ID is
 * present, the user is reported as `unresolved` (env-var drift) and left
 * alone.
 *
 * Body: `{ dryRun?: boolean }`
 */
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body optional
  }
  const dryRun = body.dryRun === true;

  const buckets = emptyBuckets();
  let stripeSubsSeen = 0;
  let razorpaySubsSeen = 0;

  // ─────────────────────────────── STRIPE ───────────────────────────────
  const stripeSubs: Stripe.Subscription[] = [];
  try {
    for (const status of ['active', 'trialing', 'past_due'] as const) {
      let startingAfter: string | undefined;
      do {
        const page = await stripe.subscriptions.list({
          status,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        stripeSubs.push(...page.data);
        startingAfter =
          page.has_more && page.data.length > 0
            ? page.data[page.data.length - 1].id
            : undefined;
      } while (startingAfter);
    }
    stripeSubsSeen = stripeSubs.length;
  } catch (err) {
    buckets.errors.push({
      email: null,
      outcome: {
        gateway: 'stripe' as Gateway,
        phase: 'list',
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  for (const sub of stripeSubs) {
    try {
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const metadataUserId =
        typeof sub.metadata?.userId === 'string' ? sub.metadata.userId.trim() : undefined;
      const attempted: Record<string, string | null> = {
        'stripeCustomerId': customerId,
        'metadata.userId': metadataUserId ?? null,
        'customer.email': null,
      };

      const selectFields = {
        id: true,
        email: true,
        role: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      } as const;

      let user = await prisma.user.findFirst({
        where: { stripeCustomerId: customerId },
        select: selectFields,
      });

      if (!user && metadataUserId) {
        user = await prisma.user.findUnique({
          where: { id: metadataUserId },
          select: selectFields,
        });
      }

      // Final attempt: fetch the Stripe customer and match by email.
      // Case-insensitive to avoid missing users whose DB email differs in case.
      let customerEmail: string | null = null;
      if (!user) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!('deleted' in customer && customer.deleted)) {
            customerEmail = (customer as Stripe.Customer).email ?? null;
            attempted['customer.email'] = customerEmail;
            if (customerEmail) {
              user = await prisma.user.findFirst({
                where: { email: { equals: customerEmail, mode: 'insensitive' } },
                select: selectFields,
              });
            }
          }
        } catch {
          // ignore — fall through as orphan
        }
      }

      if (!user) {
        buckets.orphans.push({
          email: customerEmail,
          outcome: {
            gateway: 'stripe' as Gateway,
            reason: 'no_matching_user',
            subscriptionId: sub.id,
            customerId,
            customerEmail,
            subscriptionStatus: sub.status,
            priceId: sub.items?.data?.[0]?.price?.id ?? null,
            attempted,
            hint: 'Use the "Bind to user" input below to assign this subscription to a user by their DB email.',
          },
        });
        continue;
      }

      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id ?? null;
      const newRole = getPlanByPriceId(priceId);

      if (newRole === 'FREE' && priceId) {
        buckets.unresolved.push({
          userId: user.id,
          email: user.email,
          outcome: {
            gateway: 'stripe' as Gateway,
            reason: 'unmapped_price_id',
            details: { priceId },
            subscriptionId: sub.id,
          },
        });
        continue;
      }

      const periodEnd =
        firstItem?.current_period_end ??
        (sub as unknown as { current_period_end?: number }).current_period_end ??
        Math.floor(Date.now() / 1000);

      if (
        user.role === newRole &&
        user.stripeSubscriptionId === sub.id &&
        user.stripePriceId === priceId
      ) {
        buckets.skipped.push({
          userId: user.id,
          email: user.email,
          outcome: {
            gateway: 'stripe' as Gateway,
            reason: 'already_synced',
            subscriptionId: sub.id,
          },
        });
        continue;
      }

      if (!dryRun) {
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
        await logAudit(session.id, 'USER_ROLE_CHANGED', 'user', user.id, {
          source: 'admin_reconcile_deep',
          gateway: 'stripe',
          previousRole: user.role,
          newRole,
          subscriptionId: sub.id,
          priceId,
        });
      }

      buckets.reconciled.push({
        userId: user.id,
        email: user.email,
        outcome: {
          gateway: 'stripe' as Gateway,
          previousRole: user.role,
          newRole,
          subscriptionId: sub.id,
          priceId,
        },
      });
    } catch (err) {
      buckets.errors.push({
        email: null,
        outcome: {
          gateway: 'stripe' as Gateway,
          subscriptionId: sub.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ────────────────────────────── RAZORPAY ──────────────────────────────
  interface RazorpaySubLike {
    id: string;
    status: string;
    plan_id?: string;
    current_end?: number;
    charge_at?: number;
    notes?: Record<string, unknown>;
  }

  const razorpaySubs: RazorpaySubLike[] = [];
  try {
    const batchSize = 100;
    let skip = 0;
    // Safety cap: 20 pages = 2000 subscriptions. Should be plenty for a
    // bootstrap; raise if you actually have more.
    for (let page = 0; page < 20; page++) {
      const res = await razorpay.subscriptions.all({ count: batchSize, skip });
      const items = (res.items as unknown as RazorpaySubLike[]) || [];
      razorpaySubs.push(...items);
      if (items.length < batchSize) break;
      skip += batchSize;
    }
    razorpaySubsSeen = razorpaySubs.length;
  } catch (err) {
    buckets.errors.push({
      email: null,
      outcome: {
        gateway: 'razorpay' as Gateway,
        phase: 'list',
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  const liveRazorpay = razorpaySubs.filter((s) =>
    ['active', 'authenticated', 'pending'].includes(s.status),
  );

  // Prefetch recent Razorpay payments so we can match an orphan subscription
  // via payment.email / payment.contact when notes-based matching fails.
  // Razorpay doesn't expose a subscription_id filter on /payments, so we
  // fetch a window and index by subscription_id client-side.
  const paymentsBySubId = new Map<
    string,
    { email?: string; contact?: string }[]
  >();
  try {
    interface RazorpayPaymentLike {
      subscription_id?: string;
      email?: string;
      contact?: string;
    }
    const PAGE = 100;
    const PAGES = 3; // 300 most recent payments
    for (let i = 0; i < PAGES; i++) {
      const res = await razorpay.payments.all({ count: PAGE, skip: i * PAGE });
      const items = (res.items as unknown as RazorpayPaymentLike[]) || [];
      for (const p of items) {
        if (!p.subscription_id) continue;
        const list = paymentsBySubId.get(p.subscription_id) ?? [];
        list.push({ email: p.email, contact: p.contact });
        paymentsBySubId.set(p.subscription_id, list);
      }
      if (items.length < PAGE) break;
    }
  } catch (err) {
    console.warn('[ADMIN_RECONCILE] payments.all failed:', err);
  }

  for (const sub of liveRazorpay) {
    try {
      // Razorpay notes are a plain object; be defensive in case they arrive
      // stringified or absent entirely.
      let notes: Record<string, unknown> = {};
      if (sub.notes && typeof sub.notes === 'object') {
        notes = sub.notes as Record<string, unknown>;
      } else if (typeof sub.notes === 'string') {
        try { notes = JSON.parse(sub.notes); } catch { /* keep empty */ }
      }
      const notesUserId =
        typeof notes.userId === 'string' ? (notes.userId as string).trim() : undefined;
      const notesEmail =
        typeof notes.email === 'string' ? (notes.email as string).trim() : undefined;

      const attempted: Record<string, string | null> = {
        'notes.userId': notesUserId ?? null,
        'notes.email (case-insensitive)': notesEmail ?? null,
        'razorpaySubscriptionId': sub.id,
      };

      const selectFields = {
        id: true,
        email: true,
        role: true,
        razorpaySubscriptionId: true,
        razorpayPlanId: true,
      } as const;

      let user: {
        id: string;
        email: string | null;
        role: string;
        razorpaySubscriptionId: string | null;
        razorpayPlanId: string | null;
      } | null = null;

      if (notesUserId) {
        user = await prisma.user.findUnique({
          where: { id: notesUserId },
          select: selectFields,
        });
      }
      if (!user && notesEmail) {
        user = await prisma.user.findFirst({
          where: { email: { equals: notesEmail, mode: 'insensitive' } },
          select: selectFields,
        });
      }
      if (!user) {
        user = await prisma.user.findFirst({
          where: { razorpaySubscriptionId: sub.id },
          select: selectFields,
        });
      }

      // Payment-level fallback: use the emails / phone numbers from actual
      // Razorpay payment records tied to this subscription. Covers older subs
      // created before we started writing notes.userId / notes.email.
      const paymentHints = paymentsBySubId.get(sub.id) ?? [];
      const paymentEmails = Array.from(
        new Set(paymentHints.map((p) => p.email).filter((e): e is string => !!e)),
      );
      const paymentContacts = Array.from(
        new Set(paymentHints.map((p) => p.contact).filter((c): c is string => !!c)),
      );
      attempted['payment.email (case-insensitive)'] =
        paymentEmails.length > 0 ? paymentEmails.join(', ') : null;
      attempted['payment.contact'] =
        paymentContacts.length > 0 ? paymentContacts.join(', ') : null;

      if (!user && paymentEmails.length > 0) {
        for (const candidate of paymentEmails) {
          const match = await prisma.user.findFirst({
            where: { email: { equals: candidate, mode: 'insensitive' } },
            select: selectFields,
          });
          if (match) {
            user = match;
            break;
          }
        }
      }
      if (!user && paymentContacts.length > 0) {
        // Razorpay payment.contact may be '9876543210' or '+919876543210'.
        // Try both raw and +91-prefixed forms against the normalized phone
        // stored on the User record.
        const variants = new Set<string>();
        for (const c of paymentContacts) {
          variants.add(c);
          const digits = c.replace(/\D/g, '');
          if (digits) variants.add(`+${digits}`);
          if (digits.length === 10) variants.add(`+91${digits}`);
        }
        for (const phone of variants) {
          const match = await prisma.user.findFirst({
            where: { phoneNumber: phone },
            select: selectFields,
          });
          if (match) {
            user = match;
            break;
          }
        }
      }

      if (!user) {
        buckets.orphans.push({
          email:
            notesEmail ??
            (paymentEmails.length > 0 ? paymentEmails[0] : null),
          outcome: {
            gateway: 'razorpay' as Gateway,
            reason: 'no_matching_user',
            subscriptionId: sub.id,
            subscriptionStatus: sub.status,
            planId: sub.plan_id ?? null,
            notes,
            paymentEmails,
            paymentContacts,
            attempted,
            hint: 'Use the "Bind to user" input below to assign this subscription to a user by their DB email.',
          },
        });
        continue;
      }

      const planId = sub.plan_id ?? null;
      const newRole = getRoleByRazorpayPlanId(planId);

      if (newRole === 'FREE' && planId) {
        buckets.unresolved.push({
          userId: user.id,
          email: user.email,
          outcome: {
            gateway: 'razorpay' as Gateway,
            reason: 'unmapped_plan_id',
            details: { planId },
            subscriptionId: sub.id,
          },
        });
        continue;
      }

      const periodEnd = sub.current_end || sub.charge_at;
      const currentPeriodEnd = periodEnd
        ? new Date(periodEnd * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      if (
        user.role === newRole &&
        user.razorpaySubscriptionId === sub.id &&
        user.razorpayPlanId === planId
      ) {
        buckets.skipped.push({
          userId: user.id,
          email: user.email,
          outcome: {
            gateway: 'razorpay' as Gateway,
            reason: 'already_synced',
            subscriptionId: sub.id,
          },
        });
        continue;
      }

      if (!dryRun) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: newRole,
            razorpaySubscriptionId: sub.id,
            razorpayPlanId: planId,
            paymentGateway: 'razorpay',
            stripeCurrentPeriodEnd: currentPeriodEnd,
          },
        });
        invalidateUserRoleCache(user.id);
        await logAudit(session.id, 'USER_ROLE_CHANGED', 'user', user.id, {
          source: 'admin_reconcile_deep',
          gateway: 'razorpay',
          previousRole: user.role,
          newRole,
          subscriptionId: sub.id,
          planId,
        });
      }

      buckets.reconciled.push({
        userId: user.id,
        email: user.email,
        outcome: {
          gateway: 'razorpay' as Gateway,
          previousRole: user.role,
          newRole,
          subscriptionId: sub.id,
          planId,
        },
      });
    } catch (err) {
      buckets.errors.push({
        email: null,
        outcome: {
          gateway: 'razorpay' as Gateway,
          subscriptionId: sub.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  console.info('[ADMIN_RECONCILE] Deep reconcile complete:', {
    adminId: session.id,
    dryRun,
    stripeSubsSeen,
    razorpaySubsSeen,
    counts: {
      reconciled: buckets.reconciled.length,
      unresolved: buckets.unresolved.length,
      orphans: buckets.orphans.length,
      errors: buckets.errors.length,
      skipped: buckets.skipped.length,
    },
  });

  return NextResponse.json({
    dryRun,
    scanned: stripeSubsSeen + razorpaySubsSeen,
    summary: {
      stripeSubsSeen,
      razorpaySubsSeen,
      razorpaySubsLive: liveRazorpay.length,
    },
    counts: {
      reconciled: buckets.reconciled.length,
      unresolved: buckets.unresolved.length,
      orphans: buckets.orphans.length,
      errors: buckets.errors.length,
      skipped: buckets.skipped.length,
    },
    reconciled: buckets.reconciled,
    unresolved: buckets.unresolved,
    orphans: buckets.orphans,
    errors: buckets.errors,
    skipped: buckets.skipped,
  });
}
