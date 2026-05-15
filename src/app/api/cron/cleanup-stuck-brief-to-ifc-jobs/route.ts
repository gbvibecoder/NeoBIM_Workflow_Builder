/**
 * GET /api/cron/cleanup-stuck-brief-to-ifc-jobs
 *
 * Vercel Cron (every 15 min). Sweeps non-terminal Brief-to-IFC v2 jobs
 * that have not made progress for >15 minutes and marks them FAILED so
 * they stop counting against the user's concurrency cap.
 *
 * Why `updatedAt` is a safe staleness signal: the worker's wall-clock
 * budget is `maxDuration = 800s` (~13.3 min) — Vercel kills any worker
 * past that — and the stage logger writes (which bump `updatedAt`) bracket
 * every stage. So a job whose `updatedAt` is >15 min stale has no live
 * worker behind it: the worker crashed, QStash never delivered, or a
 * scheduled retry never fired.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as cleanup-stuck-vip-jobs.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Must exceed the worker's 800s maxDuration with margin. */
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

const NON_TERMINAL_STATUSES = [
  "QUEUED",
  "RUNNING_ENRICH",
  "RUNNING_ARCHITECT",
  "RUNNING_GENERATE",
  "AWAITING_RETRY",
] as const;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[CRON_BRIEF_TO_IFC_CLEANUP] CRON_SECRET is not set — refusing to run",
    );
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const result = await prisma.briefToIfcJob.updateMany({
    where: {
      status: { in: [...NON_TERMINAL_STATUSES] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      error: {
        code: "WORKER_TIMEOUT",
        message:
          "Worker timeout — the job made no progress for over 15 minutes. Please try again.",
        stage: "unknown",
      },
      lockedAt: null,
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(
      `[CRON_BRIEF_TO_IFC_CLEANUP] Marked ${result.count} stuck job(s) as FAILED`,
    );
  }

  return NextResponse.json({ cleaned: result.count });
}
