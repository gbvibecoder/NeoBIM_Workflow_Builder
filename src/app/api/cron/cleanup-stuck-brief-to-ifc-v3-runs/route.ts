/**
 * GET /api/cron/cleanup-stuck-brief-to-ifc-v3-runs
 *
 * Vercel Cron (every 10 min). Phase ζ.1 zombie-defence: reaps non-terminal
 * `BriefToIfcV3Run` rows whose heartbeat ticker has gone stale (>5 minutes
 * silent) and transitions them to FAILED with code `STUCK_NO_HEARTBEAT`.
 *
 * Why this exists: the prior v3 lifecycle defined `STUCK_NO_HEARTBEAT` +
 * `isStuck()` + a 5s heartbeat ticker but **no consumer** — abandoned
 * RUNNING rows accumulated and locked up the quota. This cron closes the
 * gap. It is structurally identical to `cleanup-stuck-vip-jobs`: a single
 * conditional `updateMany`, no per-row work, no Anthropic calls, no
 * QStash dispatches.
 *
 * The transition is `RUNNING → FAILED` which the lifecycle state machine
 * already permits (`lifecycle/transitions.ts:53`). Using `updateMany`
 * instead of the per-row `transitionStatus` helper is deliberate — the
 * cron must operate on N stale rows atomically + idempotently, and the
 * `data` block below mirrors the FAILED-transition's invariants
 * (`errorCode` set, `ifcUrl` / `entityCount` cleared, `completedAt` set).
 *
 * Worker-side races (a worker emitting its final telemetry write just as
 * the cron fires) are harmless: subsequent worker writes target the row
 * by id without status guards on the read side, and the worker's own
 * `transitionStatus` calls have `where: { status: from }` guards that
 * will fail with `count=0` once we've moved the row to FAILED.
 *
 * Auth: `Bearer ${CRON_SECRET}` — same pattern as
 * `cleanup-stuck-vip-jobs` and `cleanup-stuck-brief-to-ifc-jobs`.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { STUCK_THRESHOLD_MS } from "@/features/brief-to-ifc/v3/lifecycle/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[CRON_BRIEF_TO_IFC_V3_CLEANUP] CRON_SECRET is not set — refusing to run",
    );
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  // Only reap RUNNING rows whose heartbeat has gone stale. We deliberately
  // exclude rows with a null `lastHeartbeatAt`: those are either pre-claim
  // (still PENDING in practice, but if status flipped to RUNNING without
  // a heartbeat write we'd reap a freshly-started worker before its first
  // tick). The narrow predicate is correct-by-construction and matches the
  // v2 / VIP cron precedent.
  const result = await prisma.briefToIfcV3Run.updateMany({
    where: {
      status: "RUNNING",
      lastHeartbeatAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      errorCode: "STUCK_NO_HEARTBEAT",
      errorMessage:
        "Worker timeout — no heartbeat for over 5 minutes. The agent-job " +
        "worker crashed or was killed by the platform. Any Anthropic spend " +
        "already incurred is in `generatorCostUsd`.",
      // Invariants of the FAILED-terminal payload (see lifecycle/transitions.ts:222-239):
      // FAILED rows MUST clear the success-only fields.
      ifcUrl: null,
      entityCount: null,
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(
      `[CRON_BRIEF_TO_IFC_V3_CLEANUP] Marked ${result.count} stuck v3 run(s) as FAILED`,
    );
  }

  return NextResponse.json({ cleaned: result.count });
}
