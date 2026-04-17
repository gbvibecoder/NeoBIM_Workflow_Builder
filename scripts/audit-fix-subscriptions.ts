/**
 * scripts/audit-fix-subscriptions.ts
 *
 * Deep audit: lists every live subscription from Stripe + Razorpay, matches
 * each to a DB user, and reports/fixes role mismatches and orphaned subs.
 *
 * Usage:
 *   npx tsx scripts/audit-fix-subscriptions.ts           # dry-run (report only)
 *   npx tsx scripts/audit-fix-subscriptions.ts --apply    # fix the DB
 */

// Step 1: Load env BEFORE anything else touches process.env
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

import type Stripe from 'stripe';

const apply = process.argv.includes('--apply');

const AMOUNT_TO_ROLE: Record<number, string> = {
  9900: 'MINI',
  79900: 'STARTER',
  199900: 'PRO',
  499900: 'TEAM_ADMIN',
};

interface Report {
  gateway: 'stripe' | 'razorpay';
  subscriptionId: string;
  subscriptionStatus: string;
  providerEmail: string | null;
  providerPhone: string | null;
  planOrPriceId: string | null;
  amountPaise: number | null;
  expectedRole: string | null;
  dbUserId: string | null;
  dbEmail: string | null;
  dbRole: string | null;
  action: string;
  detail: string;
}

const reports: Report[] = [];

async function main() {
  // Dynamic imports so env vars are available when constructors run
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaNeon } = await import('@prisma/adapter-neon');
  const StripeModule = (await import('stripe')).default;
  const RazorpayModule = (await import('razorpay')).default;

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL ?? '' });
  const prisma = new PrismaClient({ adapter });
  const stripe = new StripeModule(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
  });
  const razorpay = new RazorpayModule({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
  });

  console.log('\n🔍 Subscription Audit Script');
  console.log(`   Mode: ${apply ? '⚡ APPLY (will write to DB)' : '👀 DRY RUN (read-only)'}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Test DB
  try {
    const count = await prisma.user.count();
    console.log(`  ✅ DB connected (${count} users total)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ❌ Cannot connect to database:', msg);
    console.error('     Try: sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder');
    process.exit(1);
  }

  const USER_SELECT = {
    id: true, email: true, phoneNumber: true, role: true,
    stripeCustomerId: true, stripeSubscriptionId: true,
    razorpaySubscriptionId: true, razorpayPlanId: true,
  } as const;

  type UserRow = Awaited<ReturnType<typeof prisma.user.findUnique<{ select: typeof USER_SELECT }>>>;

  async function findUser(strategies: { field: string; value: string | null }[]): Promise<UserRow> {
    for (const { field, value } of strategies) {
      if (!value) continue;
      let user: UserRow = null;
      try {
        if (field === 'id') user = await prisma.user.findUnique({ where: { id: value }, select: USER_SELECT });
        else if (field === 'stripeCustomerId') user = await prisma.user.findFirst({ where: { stripeCustomerId: value }, select: USER_SELECT });
        else if (field === 'razorpaySubscriptionId') user = await prisma.user.findFirst({ where: { razorpaySubscriptionId: value }, select: USER_SELECT });
        else if (field === 'email') user = await prisma.user.findFirst({ where: { email: { equals: value, mode: 'insensitive' } }, select: USER_SELECT });
        else if (field === 'phoneNumber') {
          const digits = value.replace(/\D/g, '');
          for (const phone of [value, `+${digits}`, `+91${digits}`]) {
            user = await prisma.user.findFirst({ where: { phoneNumber: phone }, select: USER_SELECT });
            if (user) break;
          }
        }
      } catch { /* continue */ }
      if (user) return user;
    }
    return null;
  }

  async function fixUser(userId: string, expectedRole: string, gw: string, subId: string, planOrPriceId: string | null) {
    const data: Record<string, unknown> = {
      role: expectedRole,
      stripeCurrentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      updatedAt: new Date(),
    };
    if (gw === 'razorpay') {
      data.razorpaySubscriptionId = subId;
      data.razorpayPlanId = planOrPriceId;
      data.paymentGateway = 'razorpay';
    } else {
      data.stripeSubscriptionId = subId;
      data.stripePriceId = planOrPriceId;
      data.paymentGateway = 'stripe';
    }
    await prisma.user.update({ where: { id: userId }, data });
  }

  // ── RAZORPAY SCAN ──
  console.log('\n══════════════════════════════════════════');
  console.log('  SCANNING RAZORPAY SUBSCRIPTIONS');
  console.log('══════════════════════════════════════════\n');

  interface RzpSub { id: string; status: string; plan_id?: string; notes?: Record<string, unknown> }
  const rzpSubs: RzpSub[] = [];

  try {
    for (let skip = 0, page = 0; page < 20; page++, skip += 100) {
      const res = await razorpay.subscriptions.all({ count: 100, skip });
      const items = ((res as { items?: RzpSub[] }).items) || [];
      rzpSubs.push(...items);
      if (items.length < 100) break;
    }
  } catch (err: unknown) {
    console.error('  ❌ Razorpay list failed:', err instanceof Error ? err.message : err);
  }

  const liveRzp = rzpSubs.filter(s => ['active', 'authenticated', 'pending'].includes(s.status));
  console.log(`  Total: ${rzpSubs.length}, Live: ${liveRzp.length}`);

  // Prefetch payments for email/phone matching
  const payBySubId = new Map<string, { email?: string; contact?: string }[]>();
  try {
    for (let i = 0; i < 5; i++) {
      const res = await razorpay.payments.all({ count: 100, skip: i * 100 });
      const items = ((res as { items?: { subscription_id?: string; email?: string; contact?: string }[] }).items) || [];
      for (const p of items) {
        if (!p.subscription_id) continue;
        const arr = payBySubId.get(p.subscription_id) ?? [];
        arr.push({ email: p.email, contact: p.contact });
        payBySubId.set(p.subscription_id, arr);
      }
      if (items.length < 100) break;
    }
  } catch { /* non-fatal */ }

  for (const sub of liveRzp) {
    const report: Report = {
      gateway: 'razorpay', subscriptionId: sub.id, subscriptionStatus: sub.status,
      providerEmail: null, providerPhone: null, planOrPriceId: sub.plan_id ?? null,
      amountPaise: null, expectedRole: null, dbUserId: null, dbEmail: null, dbRole: null,
      action: 'OK', detail: '',
    };

    // Determine tier by plan amount
    try {
      if (sub.plan_id) {
        const plan = await razorpay.plans.fetch(sub.plan_id);
        const amount = (plan as unknown as { item?: { amount?: number } })?.item?.amount;
        report.amountPaise = amount ?? null;
        if (amount && AMOUNT_TO_ROLE[amount]) report.expectedRole = AMOUNT_TO_ROLE[amount];
      }
    } catch { /* fallback below */ }

    // Env-var fallback
    if (!report.expectedRole && sub.plan_id) {
      if (sub.plan_id === process.env.RAZORPAY_MINI_PLAN_ID) report.expectedRole = 'MINI';
      else if (sub.plan_id === process.env.RAZORPAY_STARTER_PLAN_ID) report.expectedRole = 'STARTER';
      else if (sub.plan_id === process.env.RAZORPAY_PRO_PLAN_ID) report.expectedRole = 'PRO';
      else if (sub.plan_id === process.env.RAZORPAY_TEAM_PLAN_ID) report.expectedRole = 'TEAM_ADMIN';
    }

    const notes = (sub.notes && typeof sub.notes === 'object') ? sub.notes as Record<string, unknown> : {};
    const notesUserId = typeof notes.userId === 'string' ? notes.userId.trim() : null;
    const notesEmail = typeof notes.email === 'string' ? notes.email.trim() : null;
    const hints = payBySubId.get(sub.id) ?? [];
    const payEmail = hints.find(p => p.email)?.email ?? null;
    const payPhone = hints.find(p => p.contact)?.contact ?? null;
    report.providerEmail = notesEmail ?? payEmail;
    report.providerPhone = payPhone;

    const user = await findUser([
      { field: 'id', value: notesUserId },
      { field: 'email', value: notesEmail },
      { field: 'razorpaySubscriptionId', value: sub.id },
      { field: 'email', value: payEmail },
      { field: 'phoneNumber', value: payPhone },
    ]);

    if (!user) {
      report.action = 'ORPHAN';
      report.detail = `No DB user. Email: ${report.providerEmail}, phone: ${report.providerPhone}`;
      reports.push(report); continue;
    }

    report.dbUserId = user.id;
    report.dbEmail = user.email;
    report.dbRole = user.role;

    if (!report.expectedRole) {
      report.action = 'UNRESOLVABLE';
      report.detail = `Cannot determine tier from plan ${sub.plan_id} (amount: ${report.amountPaise})`;
      reports.push(report); continue;
    }

    if (user.role === report.expectedRole) {
      report.action = 'OK';
      report.detail = 'Role matches';
      reports.push(report); continue;
    }

    if (apply) {
      try {
        await fixUser(user.id, report.expectedRole, 'razorpay', sub.id, sub.plan_id ?? null);
        report.action = 'FIXED';
        report.detail = `${user.role} → ${report.expectedRole} ✅ APPLIED`;
      } catch (err: unknown) {
        report.action = 'ERROR';
        report.detail = `DB update failed: ${err instanceof Error ? err.message : err}`;
      }
    } else {
      report.action = 'NEEDS_FIX';
      report.detail = `${user.role} → ${report.expectedRole} (re-run with --apply)`;
    }
    reports.push(report);
  }

  // ── STRIPE SCAN ──
  console.log('\n══════════════════════════════════════════');
  console.log('  SCANNING STRIPE SUBSCRIPTIONS');
  console.log('══════════════════════════════════════════\n');

  const stripeSubs: Stripe.Subscription[] = [];
  try {
    for (const status of ['active', 'trialing', 'past_due'] as const) {
      let after: string | undefined;
      do {
        const page = await stripe.subscriptions.list({ status, limit: 100, ...(after ? { starting_after: after } : {}) });
        stripeSubs.push(...page.data);
        after = page.has_more && page.data.length ? page.data[page.data.length - 1].id : undefined;
      } while (after);
    }
  } catch (err: unknown) {
    console.error('  ❌ Stripe list failed:', err instanceof Error ? err.message : err);
  }

  console.log(`  Total live subs: ${stripeSubs.length}`);

  for (const sub of stripeSubs) {
    const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const item0 = sub.items?.data?.[0];
    const priceId = item0?.price?.id ?? null;
    const unitAmount = item0?.price?.unit_amount ?? null;

    const report: Report = {
      gateway: 'stripe', subscriptionId: sub.id, subscriptionStatus: sub.status,
      providerEmail: null, providerPhone: null, planOrPriceId: priceId,
      amountPaise: unitAmount, expectedRole: (unitAmount && AMOUNT_TO_ROLE[unitAmount]) || null,
      dbUserId: null, dbEmail: null, dbRole: null, action: 'OK', detail: '',
    };

    if (!report.expectedRole && priceId) {
      if (priceId === process.env.STRIPE_MINI_PRICE_ID) report.expectedRole = 'MINI';
      else if (priceId === process.env.STRIPE_STARTER_PRICE_ID) report.expectedRole = 'STARTER';
      else if (priceId === process.env.STRIPE_PRICE_ID) report.expectedRole = 'PRO';
      else if (priceId === process.env.STRIPE_TEAM_PRICE_ID) report.expectedRole = 'TEAM_ADMIN';
    }

    let custEmail: string | null = null;
    try {
      const c = await stripe.customers.retrieve(custId);
      if (!('deleted' in c && c.deleted)) custEmail = (c as Stripe.Customer).email ?? null;
      report.providerEmail = custEmail;
    } catch { /* continue */ }

    const metaUserId = sub.metadata?.userId?.trim() ?? null;
    const user = await findUser([
      { field: 'stripeCustomerId', value: custId },
      { field: 'id', value: metaUserId },
      { field: 'email', value: custEmail },
    ]);

    if (!user) {
      report.action = 'ORPHAN';
      report.detail = `No DB user. Customer: ${custId}, email: ${custEmail}`;
      reports.push(report); continue;
    }

    report.dbUserId = user.id;
    report.dbEmail = user.email;
    report.dbRole = user.role;

    if (!report.expectedRole) {
      report.action = 'UNRESOLVABLE';
      report.detail = `Cannot determine tier from price ${priceId} (amount: ${unitAmount})`;
      reports.push(report); continue;
    }

    if (user.role === report.expectedRole) {
      report.action = 'OK';
      report.detail = 'Role matches';
      reports.push(report); continue;
    }

    if (apply) {
      try {
        await fixUser(user.id, report.expectedRole, 'stripe', sub.id, priceId);
        report.action = 'FIXED';
        report.detail = `${user.role} → ${report.expectedRole} ✅ APPLIED`;
      } catch (err: unknown) {
        report.action = 'ERROR';
        report.detail = `DB update failed: ${err instanceof Error ? err.message : err}`;
      }
    } else {
      report.action = 'NEEDS_FIX';
      report.detail = `${user.role} → ${report.expectedRole} (re-run with --apply)`;
    }
    reports.push(report);
  }

  // ── DB-SIDE STUCK PATTERNS ──
  console.log('\n══════════════════════════════════════════');
  console.log('  DB-SIDE STUCK PATTERNS');
  console.log('══════════════════════════════════════════\n');

  const stuck = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'FREE', stripeSubscriptionId: { not: null } },
        { role: 'FREE', razorpaySubscriptionId: { not: null } },
        { role: 'FREE', stripeCustomerId: { not: null } },
        { role: 'FREE', paymentGateway: { not: null } },
      ],
    },
    select: {
      id: true, email: true, phoneNumber: true, role: true, paymentGateway: true,
      stripeCustomerId: true, stripeSubscriptionId: true, stripePriceId: true,
      razorpaySubscriptionId: true, razorpayPlanId: true,
      stripeCurrentPeriodEnd: true, updatedAt: true,
    },
  });

  console.log(`  Stuck users (FREE with billing fields): ${stuck.length}`);
  for (const u of stuck) {
    console.log(`\n  🔴 ${u.email || u.phoneNumber || u.id}`);
    console.log(`     role=${u.role} gw=${u.paymentGateway}`);
    console.log(`     stripe: cust=${u.stripeCustomerId} sub=${u.stripeSubscriptionId} price=${u.stripePriceId}`);
    console.log(`     razorpay: sub=${u.razorpaySubscriptionId} plan=${u.razorpayPlanId}`);
    console.log(`     periodEnd=${u.stripeCurrentPeriodEnd} updated=${u.updatedAt}`);
  }

  // ── FINAL REPORT ──
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SUBSCRIPTION AUDIT REPORT                ║');
  console.log(`║              Mode: ${apply ? '⚡ APPLY (LIVE FIX)' : '👀 DRY RUN (read-only)'}               ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const ok = reports.filter(r => r.action === 'OK');
  const fixed = reports.filter(r => r.action === 'FIXED');
  const needsFix = reports.filter(r => r.action === 'NEEDS_FIX');
  const orphans = reports.filter(r => r.action === 'ORPHAN');
  const unresolvable = reports.filter(r => r.action === 'UNRESOLVABLE');
  const errors = reports.filter(r => r.action === 'ERROR');

  console.log(`  ✅ OK (role correct):         ${ok.length}`);
  console.log(`  🔧 Fixed this run:            ${fixed.length}`);
  console.log(`  ⏳ Needs fix (dry run):       ${needsFix.length}`);
  console.log(`  👻 Orphaned (no DB user):     ${orphans.length}`);
  console.log(`  ❓ Unresolvable:              ${unresolvable.length}`);
  console.log(`  ❌ Errors:                    ${errors.length}\n`);

  for (const r of needsFix) {
    console.log(`  🔴 NEEDS FIX [${r.gateway}] ${r.dbEmail || r.dbUserId}`);
    console.log(`     Sub: ${r.subscriptionId} | Plan/Price: ${r.planOrPriceId}`);
    console.log(`     Amount: ₹${(r.amountPaise ?? 0) / 100} → Expected: ${r.expectedRole} | DB: ${r.dbRole}`);
    console.log(`     ${r.detail}\n`);
  }

  for (const r of fixed) {
    console.log(`  ✅ FIXED [${r.gateway}] ${r.dbEmail || r.dbUserId} — ${r.detail}\n`);
  }

  for (const r of orphans) {
    console.log(`  👻 ORPHAN [${r.gateway}] Sub: ${r.subscriptionId} (${r.subscriptionStatus})`);
    console.log(`     Plan/Price: ${r.planOrPriceId} | Amount: ₹${(r.amountPaise ?? 0) / 100}`);
    console.log(`     Email: ${r.providerEmail ?? 'unknown'} | Phone: ${r.providerPhone ?? 'unknown'}`);
    console.log(`     Expected role: ${r.expectedRole ?? 'UNKNOWN'}\n`);
  }

  for (const r of unresolvable) {
    console.log(`  ❓ UNRESOLVABLE [${r.gateway}] ${r.dbEmail || r.subscriptionId} — ${r.detail}\n`);
  }

  for (const r of errors) {
    console.log(`  ❌ ERROR [${r.gateway}] ${r.dbEmail || r.subscriptionId} — ${r.detail}\n`);
  }

  if (needsFix.length > 0) {
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ${needsFix.length} user(s) need fixing. Run:`);
    console.log('  npx tsx scripts/audit-fix-subscriptions.ts --apply');
    console.log('═══════════════════════════════════════════════════\n');
  }

  if (orphans.length > 0) {
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ${orphans.length} orphaned sub(s). These users may not`);
    console.log('  have signed up, or signed up with a different email.');
    console.log('═══════════════════════════════════════════════════\n');
  }

  if (needsFix.length === 0 && orphans.length === 0 && errors.length === 0) {
    console.log('  🎉 All subscriptions are in sync!\n');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
