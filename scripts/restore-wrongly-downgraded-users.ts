#!/usr/bin/env tsx
/**
 * scripts/restore-wrongly-downgraded-users.ts
 *
 * One-shot restore of users whose role was wrongly downgraded to FREE by
 * the pre-fix cancel webhooks. Two output sets:
 *
 *   AUTO-RESTORE (strict — auto-restored under --execute):
 *     role = 'FREE'
 *     AND stripeCurrentPeriodEnd > NOW()
 *     AND (razorpaySubscriptionId IS NOT NULL OR stripeSubscriptionId IS NOT NULL)
 *
 *   MANUAL-REVIEW (printed only — NEVER auto-restored):
 *     role = 'FREE'
 *     AND (razorpaySubscriptionId IS NOT NULL OR stripeSubscriptionId IS NOT NULL)
 *     AND (stripeCurrentPeriodEnd IS NULL OR stripeCurrentPeriodEnd <= NOW())
 *     These users may still be active at the provider, but the stored
 *     period_end is missing or stale (likely the 30-day fallback from
 *     activateSubscription that has since passed). Verify against
 *     Razorpay/Stripe API before deciding.
 *
 * Default: --dry-run (no DB writes). Use --execute to apply.
 *
 * Run with: npx tsx scripts/restore-wrongly-downgraded-users.ts [--execute]
 */

import { PrismaClient } from "@prisma/client";
import { deriveRoleFromPlan } from "@/features/billing/lib/role-transitions";

const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--execute");

interface CandidateRow {
  id: string;
  email: string | null;
  role: string;
  stripeCurrentPeriodEnd: Date | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  paymentGateway: string | null;
}

interface AutoRestoreEntry {
  user: CandidateRow;
  derivedRole: "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN";
  provider: "razorpay" | "stripe";
  planOrPriceId: string;
}

interface AmbiguousEntry {
  user: CandidateRow;
  reason: string;
}

function classify(rows: CandidateRow[]): {
  toRestore: AutoRestoreEntry[];
  ambiguous: AmbiguousEntry[];
} {
  const toRestore: AutoRestoreEntry[] = [];
  const ambiguous: AmbiguousEntry[] = [];

  for (const u of rows) {
    let provider: "razorpay" | "stripe" | null = null;
    let planOrPriceId: string | null = null;

    if (u.razorpaySubscriptionId && u.razorpayPlanId) {
      provider = "razorpay";
      planOrPriceId = u.razorpayPlanId;
    } else if (u.stripeSubscriptionId && u.stripePriceId) {
      provider = "stripe";
      planOrPriceId = u.stripePriceId;
    }

    if (!provider || !planOrPriceId) {
      ambiguous.push({ user: u, reason: "no_plan_id_to_derive_role" });
      continue;
    }

    const derived = deriveRoleFromPlan({ provider, planOrPriceId });
    if (derived === "FREE") {
      ambiguous.push({
        user: u,
        reason: `plan_resolves_to_FREE (planId=${planOrPriceId} — env mismatch?)`,
      });
      continue;
    }

    toRestore.push({ user: u, derivedRole: derived, provider, planOrPriceId });
  }

  return { toRestore, ambiguous };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const now = new Date();

  // ─── Set 1: strict auto-restore set ────────────────────────────────
  const autoRestoreCandidates: CandidateRow[] = await prisma.user.findMany({
    where: {
      role: "FREE",
      stripeCurrentPeriodEnd: { gt: now },
      OR: [
        { razorpaySubscriptionId: { not: null } },
        { stripeSubscriptionId: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      stripeCurrentPeriodEnd: true,
      razorpaySubscriptionId: true,
      razorpayPlanId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      paymentGateway: true,
    },
  });

  // ─── Set 2: manual-review set — period_end null or stale ──────────
  const manualReviewCandidates: CandidateRow[] = await prisma.user.findMany({
    where: {
      role: "FREE",
      AND: [
        {
          OR: [
            { razorpaySubscriptionId: { not: null } },
            { stripeSubscriptionId: { not: null } },
          ],
        },
        {
          OR: [
            { stripeCurrentPeriodEnd: null },
            { stripeCurrentPeriodEnd: { lte: now } },
          ],
        },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      stripeCurrentPeriodEnd: true,
      razorpaySubscriptionId: true,
      razorpayPlanId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      paymentGateway: true,
    },
  });

  const { toRestore, ambiguous } = classify(autoRestoreCandidates);

  // ─── Report header ────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  RESTORE WRONGLY-DOWNGRADED USERS  (mode: ${DRY_RUN ? "DRY-RUN" : "EXECUTE"})`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ─── Auto-restore table ───────────────────────────────────────────
  console.log(`AUTO-RESTORE candidates (paid period in future): ${toRestore.length}`);
  console.log("───────────────────────────────────────────────────────────────");
  if (toRestore.length === 0) {
    console.log("  (none)\n");
  } else {
    console.log("  email                          curr→new     paidUntil                gateway    planId");
    for (const e of toRestore) {
      const email = pad(e.user.email ?? "<no-email>", 30);
      const transition = pad(`FREE→${e.derivedRole}`, 12);
      const paidUntil = pad(e.user.stripeCurrentPeriodEnd?.toISOString() ?? "<null>", 24);
      const gateway = pad(e.provider, 10);
      const planId = e.planOrPriceId;
      console.log(`  ${email} ${transition} ${paidUntil} ${gateway} ${planId}`);
    }
    console.log();
  }

  // ─── Ambiguous in auto-restore set ────────────────────────────────
  console.log(`AMBIGUOUS in auto-restore set (skipped — review manually): ${ambiguous.length}`);
  console.log("───────────────────────────────────────────────────────────────");
  if (ambiguous.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const e of ambiguous) {
      console.log(`  ${e.user.email ?? "<no-email>"}  reason: ${e.reason}`);
    }
    console.log();
  }

  // ─── Manual-review table ──────────────────────────────────────────
  console.log(`NEEDS MANUAL REVIEW (period_end null or stale): ${manualReviewCandidates.length}`);
  console.log("───────────────────────────────────────────────────────────────");
  console.log("  These users are FREE with a sub_id but their stored period_end is");
  console.log("  null or has already passed. They may still be active at the provider");
  console.log("  (e.g. activateSubscription wrote the 30-day fallback months ago).");
  console.log("  Check Razorpay / Stripe API manually before restoring.\n");
  if (manualReviewCandidates.length === 0) {
    console.log("  (none)\n");
  } else {
    console.log("  email                          paidUntil                gateway       subId");
    for (const u of manualReviewCandidates) {
      const email = pad(u.email ?? "<no-email>", 30);
      const paidUntil = pad(u.stripeCurrentPeriodEnd?.toISOString() ?? "<null>", 24);
      const gateway = pad(
        u.paymentGateway ?? (u.razorpaySubscriptionId ? "razorpay?" : u.stripeSubscriptionId ? "stripe?" : "?"),
        13,
      );
      const subId = u.razorpaySubscriptionId ?? u.stripeSubscriptionId ?? "?";
      console.log(`  ${email} ${paidUntil} ${gateway} ${subId}`);
    }
    console.log();
  }

  // ─── Summary ──────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  auto_restore_eligible:        ${toRestore.length}`);
  console.log(`  ambiguous (manual review):    ${ambiguous.length}`);
  console.log(`  stale_period (manual review): ${manualReviewCandidates.length}`);
  console.log(`  TOTAL needing attention:      ${toRestore.length + ambiguous.length + manualReviewCandidates.length}`);
  console.log();

  if (DRY_RUN) {
    console.log("DRY-RUN: no DB writes performed. Re-run with --execute to apply auto-restore set.");
    return;
  }

  // ─── Execute mode ─────────────────────────────────────────────────
  if (toRestore.length === 0) {
    console.log("No users to restore. Exiting.");
    return;
  }

  console.log(`\n⚠️  EXECUTE MODE: this will UPDATE role for ${toRestore.length} users.`);
  console.log("   Press Ctrl+C in the next 5 seconds to abort.\n");
  await new Promise<void>((resolve) => setTimeout(resolve, 5000));

  let restored = 0;
  let failed = 0;
  for (const e of toRestore) {
    try {
      await prisma.user.update({
        where: { id: e.user.id },
        data: { role: e.derivedRole },
      });
      restored++;
      console.log("[RESTORE]", {
        userId: e.user.id,
        email: e.user.email,
        fromRole: "FREE",
        toRole: e.derivedRole,
      });
    } catch (err) {
      failed++;
      console.error("[RESTORE_FAILED]", {
        userId: e.user.id,
        email: e.user.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`\nRestored: ${restored} | Failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error("[RESTORE] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
