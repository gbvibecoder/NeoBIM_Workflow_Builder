/**
 * GET /api/cron/cleanup-stuck-brief-renders
 *
 * Vercel Cron (every 5 min). Phase η.1 zombie-defence for the Brief-to-
 * Renders pipeline: reaps non-terminal `BriefRenderJob` rows whose
 * `updatedAt` has gone stale (>15 minutes silent) and transitions them
 * to FAILED with code `STUCK_WORKER_TIMEOUT`.
 *
 * Why this exists: brief-renders had a DELETE `/api/brief-renders/[jobId]`
 * cancel endpoint and a between-stage CANCELLED check inside the
 * orchestrator, BUT no automated cleanup cron. A worker that crashes
 * mid-pipeline (Stage 1 Sonnet call dies, OOM, Vercel kill, etc.)
 * leaves its row in RUNNING/QUEUED/AWAITING_APPROVAL forever, locking
 * up the user's `MAX_ACTIVE_JOBS_PER_USER` slot. This cron closes the
 * gap. Structurally identical to `cleanup-stuck-vip-jobs` and
 * `cleanup-stuck-brief-to-ifc-v3-runs`: a single conditional
 * `updateMany`, no per-row work, no Anthropic calls, no QStash
 * dispatches.
 *
 * Why `updatedAt` not `lastHeartbeatAt`: brief-renders does not have a
 * heartbeat ticker. Its `updatedAt` column bumps on every stage-log
 * write, every progress update, and every stage transition — so a job
 * whose `updatedAt` has been silent for >15 min has no live worker
 * behind it (the worker's `maxDuration = 600s` ≈ 10 min, with margin).
 *
 * Auth: `Bearer ${CRON_SECRET}` — same pattern as every other cleanup
 * cron in this codebase.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** A `BriefRenderJob` whose `updatedAt` is older than this is presumed
 *  stuck — the worker crashed or was killed by the platform. Must exceed
 *  the worker's 600s `maxDuration` plus a margin for slow Anthropic /
 *  OpenAI calls. 15 minutes is the same threshold the v2 brief-to-ifc
 *  cleanup cron uses. */
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

const NON_TERMINAL_STATUSES = [
  "QUEUED",
  "RUNNING",
  "AWAITING_APPROVAL",
] as const;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[CRON_BRIEF_RENDERS_CLEANUP] CRON_SECRET is not set — refusing to run",
    );
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  // Reap non-terminal rows whose updatedAt has gone stale. Transitions
  // to FAILED with errorMessage explaining the timeout — matches the
  // brief-renders FAILED-terminal shape (the orchestrator's own
  // markFailed helper writes the same fields).
  const result = await prisma.briefRenderJob.updateMany({
    where: {
      status: { in: [...NON_TERMINAL_STATUSES] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      errorMessage:
        "Worker timeout — no progress for over 15 minutes. The pipeline " +
        "worker crashed or was killed by the platform. Any Anthropic / " +
        "OpenAI spend already incurred is recorded in `costUsd`.",
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(
      `[CRON_BRIEF_RENDERS_CLEANUP] Marked ${result.count} stuck brief-render job(s) as FAILED`,
    );
  }

  return NextResponse.json({ cleaned: result.count });
}
