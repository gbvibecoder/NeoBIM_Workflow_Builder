import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { stripe, getPlanByPriceId } from '@/features/billing/lib/stripe';
import { razorpay, getRoleByRazorpayPlanId } from '@/features/billing/lib/razorpay';
import { invalidateUserRoleCache } from '@/lib/auth';
import { logAudit } from '@/lib/admin-server';

interface CronReport {
  startedAt: string;
  stripeLiveSubs: number;
  razorpaySubs: number;
  razorpayLiveSubs: number;
  reconciled: { userId: string; email: string | null; previousRole: string; newRole: string; gateway: string; subscriptionId: string }[];
  unresolved: { gateway: string; subscriptionId: string; reason: string; planOrPriceId?: string | null; notes?: unknown }[];
  orphans: { gateway: string; subscriptionId: string; hint?: string }[];
  errors: { gateway?: string; error: string; subscriptionId?: string }[];
  durationMs: number;
}

/**
 * Identical logic to the admin deep-scan in
 * src/app/api/admin/reconcile-subscriptions/route.ts, minus the admin-session
 * gating and with audit log source tagged "cron_reconcile". Kept as a
 * separate module so the cron route itself can stay tiny and the heavy
 * dependencies are only loaded when the cron actually fires.
 */
export async function runCronReconcile(): Promise<CronReport> {
  const t0 = Date.now();
  const report: CronReport = {
    startedAt: new Date().toISOString(),
    stripeLiveSubs: 0,
    razorpaySubs: 0,
    razorpayLiveSubs: 0,
    reconciled: [],
    unresolved: [],
    orphans: [],
    errors: [],
    durationMs: 0,
  };

  // ── Stripe ────────────────────────────────────────────────
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
    report.stripeLiveSubs = stripeSubs.length;
  } catch (err) {
    report.errors.push({ gateway: 'stripe', error: err instanceof Error ? err.message : String(err) });
  }

  for (const sub of stripeSubs) {
    try {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const metadataUserId = typeof sub.metadata?.userId === 'string' ? sub.metadata.userId.trim() : undefined;

      const selectFields = {
        id: true, email: true, role: true,
        stripeSubscriptionId: true, stripePriceId: true,
      } as const;

      let user = await prisma.user.findFirst({
        where: { stripeCustomerId: customerId },
        select: selectFields,
      });
      if (!user && metadataUserId) {
        user = await prisma.user.findUnique({ where: { id: metadataUserId }, select: selectFields });
      }
      if (!user) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!('deleted' in customer && customer.deleted)) {
            const email = (customer as Stripe.Customer).email;
            if (email) {
              user = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
                select: selectFields,
              });
            }
          }
        } catch { /* ignore */ }
      }

      if (!user) {
        report.orphans.push({ gateway: 'stripe', subscriptionId: sub.id });
        continue;
      }

      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id ?? null;
      const newRole = getPlanByPriceId(priceId);
      if (newRole === 'FREE' && priceId) {
        report.unresolved.push({ gateway: 'stripe', subscriptionId: sub.id, reason: 'unmapped_price_id', planOrPriceId: priceId });
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
        continue; // already synced
      }

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
      await logAudit(null, 'USER_ROLE_CHANGED', 'user', user.id, {
        source: 'cron_reconcile',
        gateway: 'stripe',
        previousRole: user.role,
        newRole,
        subscriptionId: sub.id,
        priceId,
      });
      report.reconciled.push({
        userId: user.id,
        email: user.email,
        previousRole: user.role,
        newRole,
        gateway: 'stripe',
        subscriptionId: sub.id,
      });
    } catch (err) {
      report.errors.push({ gateway: 'stripe', subscriptionId: sub.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Razorpay ──────────────────────────────────────────────
  interface RazorpaySubLike {
    id: string; status: string; plan_id?: string;
    current_end?: number; charge_at?: number;
    notes?: Record<string, unknown>;
  }
  interface RazorpayPaymentLike {
    subscription_id?: string; email?: string; contact?: string;
  }

  const razorpaySubs: RazorpaySubLike[] = [];
  try {
    const PAGE = 100;
    for (let page = 0; page < 20; page++) {
      const res = await razorpay.subscriptions.all({ count: PAGE, skip: page * PAGE });
      const items = (res.items as unknown as RazorpaySubLike[]) || [];
      razorpaySubs.push(...items);
      if (items.length < PAGE) break;
    }
    report.razorpaySubs = razorpaySubs.length;
  } catch (err) {
    report.errors.push({ gateway: 'razorpay', error: err instanceof Error ? err.message : String(err) });
  }

  const liveRazorpay = razorpaySubs.filter((s) =>
    ['active', 'authenticated', 'pending'].includes(s.status),
  );
  report.razorpayLiveSubs = liveRazorpay.length;

  // Index recent payments by subscription_id
  const paymentsBySubId = new Map<string, { email?: string; contact?: string }[]>();
  try {
    const PAGE = 100;
    for (let i = 0; i < 3; i++) {
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
    console.warn('[cron_reconcile] payments.all failed:', err);
  }

  for (const sub of liveRazorpay) {
    try {
      let notes: Record<string, unknown> = {};
      if (sub.notes && typeof sub.notes === 'object') notes = sub.notes;
      const notesUserId = typeof notes.userId === 'string' ? (notes.userId as string).trim() : '';
      const notesEmail = typeof notes.email === 'string' ? (notes.email as string).trim() : '';

      const selectFields = {
        id: true, email: true, role: true,
        razorpaySubscriptionId: true, razorpayPlanId: true,
      } as const;

      let user: {
        id: string; email: string | null; role: string;
        razorpaySubscriptionId: string | null; razorpayPlanId: string | null;
      } | null = null;

      if (notesUserId) {
        user = await prisma.user.findUnique({ where: { id: notesUserId }, select: selectFields });
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

      // Payment-level fallback
      if (!user) {
        const hints = paymentsBySubId.get(sub.id) ?? [];
        const emails = Array.from(new Set(hints.map((p) => p.email).filter((e): e is string => !!e)));
        for (const email of emails) {
          const match = await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: selectFields,
          });
          if (match) { user = match; break; }
        }
        if (!user) {
          const contacts = Array.from(new Set(hints.map((p) => p.contact).filter((c): c is string => !!c)));
          for (const c of contacts) {
            const digits = c.replace(/\D/g, '');
            if (!digits) continue;
            const variants = [c, `+${digits}`, digits.length === 10 ? `+91${digits}` : null].filter(Boolean) as string[];
            for (const phone of variants) {
              const match = await prisma.user.findFirst({
                where: { phoneNumber: phone },
                select: selectFields,
              });
              if (match) { user = match; break; }
            }
            if (user) break;
          }
        }
      }

      if (!user) {
        report.orphans.push({ gateway: 'razorpay', subscriptionId: sub.id });
        continue;
      }

      const planId = sub.plan_id ?? null;
      const newRole = getRoleByRazorpayPlanId(planId);
      if (newRole === 'FREE' && planId) {
        report.unresolved.push({
          gateway: 'razorpay',
          subscriptionId: sub.id,
          reason: 'unmapped_plan_id',
          planOrPriceId: planId,
          notes,
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
      ) continue;

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
      await logAudit(null, 'USER_ROLE_CHANGED', 'user', user.id, {
        source: 'cron_reconcile',
        gateway: 'razorpay',
        previousRole: user.role,
        newRole,
        subscriptionId: sub.id,
        planId,
      });
      report.reconciled.push({
        userId: user.id,
        email: user.email,
        previousRole: user.role,
        newRole,
        gateway: 'razorpay',
        subscriptionId: sub.id,
      });
    } catch (err) {
      report.errors.push({ gateway: 'razorpay', subscriptionId: sub.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── STALE-ROLE SWEEP ──────────────────────────────────────────────
  // Catch users whose cancellation webhook was missed: they have a paid
  // role but their subscription period has expired. Check the provider
  // to confirm before downgrading.
  const ADMIN_ROLES_SWEEP = new Set(['PLATFORM_ADMIN', 'TEAM_ADMIN']);
  try {
    const staleUsers = await prisma.user.findMany({
      where: {
        role: { notIn: ['FREE', 'PLATFORM_ADMIN', 'TEAM_ADMIN'] },
        stripeCurrentPeriodEnd: { lt: new Date() },
      },
      select: {
        id: true, email: true, role: true,
        stripeSubscriptionId: true, razorpaySubscriptionId: true,
      },
      take: 50,
    });

    for (const u of staleUsers) {
      if (ADMIN_ROLES_SWEEP.has(u.role)) continue;
      try {
        let stillActive = false;

        if (u.razorpaySubscriptionId) {
          try {
            const sub = await razorpay.subscriptions.fetch(u.razorpaySubscriptionId);
            stillActive = ['active', 'authenticated', 'pending'].includes(sub.status);
          } catch { /* treat as inactive */ }
        }

        if (!stillActive && u.stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(u.stripeSubscriptionId);
            stillActive = ['active', 'trialing', 'past_due'].includes(sub.status);
          } catch { /* treat as inactive */ }
        }

        if (!stillActive) {
          await prisma.user.update({
            where: { id: u.id },
            data: {
              role: 'FREE',
              stripeSubscriptionId: null,
              stripePriceId: null,
              razorpaySubscriptionId: null,
              razorpayPlanId: null,
              stripeCurrentPeriodEnd: null,
              paymentGateway: null,
            },
          });
          invalidateUserRoleCache(u.id);
          report.reconciled.push({
            userId: u.id,
            email: u.email,
            previousRole: u.role,
            newRole: 'FREE',
            gateway: 'sweep',
            subscriptionId: u.stripeSubscriptionId || u.razorpaySubscriptionId || 'none',
          });
          console.info('[CRON_RECONCILE] Stale-role sweep downgraded user:', { userId: u.id, previousRole: u.role });
        }
      } catch (err) {
        report.errors.push({ gateway: 'sweep', subscriptionId: u.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    report.errors.push({ gateway: 'sweep', subscriptionId: 'scan', error: err instanceof Error ? err.message : String(err) });
  }

  report.durationMs = Date.now() - t0;
  console.info('[CRON_RECONCILE] complete', {
    stripe: report.stripeLiveSubs,
    razorpay: report.razorpaySubs,
    razorpayLive: report.razorpayLiveSubs,
    reconciled: report.reconciled.length,
    orphans: report.orphans.length,
    unresolved: report.unresolved.length,
    errors: report.errors.length,
    durationMs: report.durationMs,
  });
  return report;
}
