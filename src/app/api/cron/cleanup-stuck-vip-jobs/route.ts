/**
 * GET /api/cron/cleanup-stuck-vip-jobs
 *
 * Vercel Cron (every 15 min). Marks RUNNING VipJobs that have been
 * stuck for >15 minutes as FAILED so they no longer count against
 * the user's 5-job concurrency limit.
 *
 * Auth: Bearer ${CRON_SECRET} (same pattern as reconcile-subscriptions).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON_VIP_CLEANUP] CRON_SECRET is not set — refusing to run");
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const result = await prisma.vipJob.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      errorMessage: "Worker timeout — job exceeded 15-minute limit. Please try again.",
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(`[CRON_VIP_CLEANUP] Marked ${result.count} stuck job(s) as FAILED`);
  }

  return NextResponse.json({ cleaned: result.count });
}
