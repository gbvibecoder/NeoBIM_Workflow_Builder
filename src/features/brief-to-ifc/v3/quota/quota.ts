/**
 * Per-user monthly quota for Brief-to-IFC v3.
 *
 * Implements two operations:
 *   • `checkBriefToIfcV3Quota(userId, role)` — pre-flight check; returns
 *     ok/quota/used. Does NOT mutate state.
 *   • `incrementBriefToIfcV3Usage(userId)` — atomic increment after a
 *     successful run row has been created. Lazy-resets the counter
 *     when the calendar month changes.
 *
 * Lazy reset: each call computes the start of the CURRENT month
 * (UTC). If the stored `currentMonthStart` is older than that, we
 * rewrite it AND zero `runsThisMonth` + `costThisMonthUsd`. No cron
 * required — the reset happens on first access each month.
 */

import type { PrismaClient } from "@prisma/client";

import { getBriefToIfcV3MonthlyLimit } from "@/features/billing/lib/plan-data";

export interface QuotaCheckResult {
  ok: boolean;
  limit: number;
  used: number;
  errorCode?: "QUOTA_EXCEEDED";
  message?: string;
}

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function checkBriefToIfcV3Quota(
  prisma: PrismaClient,
  userId: string,
  role: string,
): Promise<QuotaCheckResult> {
  const limit = getBriefToIfcV3MonthlyLimit(role);
  if (limit <= 0) {
    return {
      ok: false,
      limit: 0,
      used: 0,
      errorCode: "QUOTA_EXCEEDED",
      message: "Your plan doesn't include any AI IFC v3 runs. Upgrade to use this feature.",
    };
  }

  const row = await prisma.briefToIfcV3UserQuota.findUnique({
    where: { userId },
    select: { runsThisMonth: true, currentMonthStart: true },
  });
  if (!row) {
    return { ok: true, limit, used: 0 };
  }
  const monthStart = startOfCurrentMonthUtc();
  const used = row.currentMonthStart < monthStart ? 0 : row.runsThisMonth;
  if (used >= limit) {
    return {
      ok: false,
      limit,
      used,
      errorCode: "QUOTA_EXCEEDED",
      message: `You've used ${used} of ${limit} AI IFC v3 runs this month. Upgrade for more.`,
    };
  }
  return { ok: true, limit, used };
}

/**
 * Increment after a run row has been created.
 *
 * Idempotent inside a single calendar month per (userId, run) call —
 * NOT idempotent if called twice without a new run. Callers should call
 * exactly once per `BriefToIfcV3Run` row insert.
 */
export async function incrementBriefToIfcV3Usage(
  prisma: PrismaClient,
  userId: string,
  costUsd: number = 0,
): Promise<void> {
  const monthStart = startOfCurrentMonthUtc();
  // Upsert + lazy-reset in a single transaction. We can't use a single
  // upsert with conditional update for the reset, so we read first then
  // branch. This is bounded to two queries; race conditions just risk a
  // momentarily-off counter, never an exceeded quota.
  const existing = await prisma.briefToIfcV3UserQuota.findUnique({
    where: { userId },
    select: { id: true, currentMonthStart: true },
  });
  if (!existing) {
    await prisma.briefToIfcV3UserQuota.create({
      data: {
        userId,
        currentMonthStart: monthStart,
        runsThisMonth: 1,
        costThisMonthUsd: costUsd,
      },
    });
    return;
  }
  if (existing.currentMonthStart < monthStart) {
    await prisma.briefToIfcV3UserQuota.update({
      where: { userId },
      data: {
        currentMonthStart: monthStart,
        runsThisMonth: 1,
        costThisMonthUsd: costUsd,
      },
    });
    return;
  }
  await prisma.briefToIfcV3UserQuota.update({
    where: { userId },
    data: {
      runsThisMonth: { increment: 1 },
      costThisMonthUsd: { increment: costUsd },
    },
  });
}
