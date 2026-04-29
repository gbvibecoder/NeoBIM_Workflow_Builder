/**
 * POST /api/brief-renders/worker/render
 *
 * Per-shot render worker — one shot per QStash invocation. Re-enqueues
 * itself after each shot until all 12 are done, at which point the
 * job's `currentStage` flips to `"awaiting_compile"` (Phase 5 owns the
 * COMPLETED transition).
 *
 * Signature-verified (production-hard). Returns 200 on every well-formed
 * invocation regardless of outcome — QStash retries are unhelpful here
 * because the orchestrator's idempotency + per-shot mutex make duplicate
 * deliveries safe but unproductive.
 *
 * Adaptive retry on rate-limit: 5s → 15s → 45s, capped at 3 attempts.
 * After cap, the shot is marked permanently failed and the worker
 * continues to the next pending shot.
 */

export const maxDuration = 180;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  scheduleBriefRenderCompileWorker,
  scheduleBriefRenderRenderWorker,
  verifyQstashSignature,
} from "@/lib/qstash";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import { runStage3ImageGen } from "@/features/brief-renders/services/brief-pipeline/stage-3-image-gen";
import { createStageLogPersister } from "@/features/brief-renders/services/brief-pipeline/stage-log-store";
import type {
  BriefStageLogEntry,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Constants ──────────────────────────────────────────────────────

const RATE_LIMIT_BACKOFF_SECONDS = [5, 15, 45] as const;
const MAX_RATE_LIMIT_RETRIES = RATE_LIMIT_BACKOFF_SECONDS.length;
const LOCK_BUSY_RETRY_DELAY_SECONDS = 5;
const AWAITING_COMPILE_STAGE = "awaiting_compile";

// ─── Body schema ────────────────────────────────────────────────────

const BODY_SCHEMA = z
  .object({
    jobId: z.string().min(1),
    apartmentIndex: z.number().int().nonnegative().optional(),
    shotIndexInApartment: z.number().int().nonnegative().optional(),
    retryCount: z.number().int().min(0).max(MAX_RATE_LIMIT_RETRIES).optional(),
  })
  .strict()
  .refine(
    (b) =>
      (b.apartmentIndex === undefined && b.shotIndexInApartment === undefined) ||
      (b.apartmentIndex !== undefined && b.shotIndexInApartment !== undefined),
    {
      message:
        "apartmentIndex and shotIndexInApartment must be specified together or both omitted",
    },
  );

type BodyInput = z.infer<typeof BODY_SCHEMA>;

// ─── Helpers ────────────────────────────────────────────────────────

function findFirstPendingShot(shots: ShotResult[]):
  | { apartmentIndex: number; shotIndexInApartment: number }
  | null {
  for (const s of shots) {
    if (
      s.status === "pending" &&
      s.apartmentIndex !== null &&
      s.apartmentIndex !== undefined
    ) {
      return {
        apartmentIndex: s.apartmentIndex,
        shotIndexInApartment: s.shotIndexInApartment,
      };
    }
  }
  return null;
}

/** Phase 4: previous in-render label that the revert path restores. */
const RENDERING_STAGE = "rendering";

/**
 * Phase 5: flip currentStage → "awaiting_compile" AND dispatch the
 * compile worker. Replaces the Phase 4 stand-alone `markAwaitingCompile`.
 *
 * Behaviour:
 *   • The conditional updateMany filters on `status: "RUNNING"`, so a
 *     concurrent cancel during the last shot is detected (count = 0)
 *     and we exit cleanly without dispatching.
 *   • On QStash dispatch failure, a second conditional updateMany
 *     reverts `currentStage` to `"rendering"` (the Phase 4 in-render
 *     label). The render worker's caller (QStash) retries; on retry
 *     the "no pending shots" branch runs again.
 *
 * Returns:
 *   `flipped:false` → status changed before flip; caller exits 200 OK.
 *   `flipped:true, dispatched:true` → caller returns success.
 *   `flipped:true, dispatched:false` → caller returns 500 so QStash retries.
 */
async function transitionToAwaitingCompileAndDispatch(
  jobId: string,
): Promise<{ flipped: boolean; dispatched: boolean }> {
  const claim = await prisma.briefRenderJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { currentStage: AWAITING_COMPILE_STAGE, progress: 80 },
  });
  if (claim.count === 0) {
    return { flipped: false, dispatched: false };
  }

  try {
    await scheduleBriefRenderCompileWorker(jobId);
    return { flipped: true, dispatched: true };
  } catch {
    // Revert — only if we still hold the awaiting_compile slot. If a
    // concurrent cancel beat us here, the revert is a no-op (count = 0)
    // and the job stays CANCELLED — which is correct.
    await prisma.briefRenderJob.updateMany({
      where: { id: jobId, currentStage: AWAITING_COMPILE_STAGE },
      data: { currentStage: RENDERING_STAGE, progress: 35 },
    });
    return { flipped: true, dispatched: false };
  }
}

async function markShotPermanentlyFailed(
  jobId: string,
  apartmentIndex: number,
  shotIndexInApartment: number,
): Promise<void> {
  // Find the flat index by re-reading the row, then jsonb_set via raw.
  const job = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: { shots: true },
  });
  if (!job) return;
  const shots = (job.shots as ShotResult[] | null) ?? [];
  let flatIndex = -1;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (
      s.apartmentIndex === apartmentIndex &&
      s.shotIndexInApartment === shotIndexInApartment
    ) {
      flatIndex = i;
      break;
    }
  }
  if (flatIndex < 0) return;
  const patch = {
    status: "failed",
    errorMessage: "rate_limit_retries_exhausted",
    completedAt: new Date().toISOString(),
  };
  const indexStr = String(flatIndex);
  const patchJson = JSON.stringify(patch);
  // "updatedAt" must be quoted — Prisma stores this column as
  // case-sensitive camelCase. See note in stage-3-image-gen.ts.
  await prisma.$executeRaw`
    UPDATE brief_render_jobs
    SET shots = jsonb_set(
          shots,
          ARRAY[${indexStr}]::text[],
          (shots->${flatIndex}::int) || ${patchJson}::jsonb
        ),
        "updatedAt" = NOW()
    WHERE id = ${jobId} AND status = 'RUNNING'
  `;
}

// ─── Main handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Hoisted so the outer `finally` can drain stageLog writes before
  // we respond to QStash. Critical: without this drain, fire-and-
  // forget logger flushes can be lost when cloudflared closes the
  // request connection (free trycloudflare tunnels are flaky), which
  // matches the "stuck at S3.startStage forever, no further writes"
  // symptom the diagnostic captured on job cmojvwo2j00001uli95ppq4tt.
  let workerLogger: BriefRenderLogger | null = null;
  try {
    return await runRenderWorker(req, (l) => {
      workerLogger = l;
    });
  } finally {
    if (workerLogger) {
      await (workerLogger as BriefRenderLogger).flushPending();
    }
  }
}

async function runRenderWorker(
  req: NextRequest,
  setLogger: (l: BriefRenderLogger) => void,
): Promise<NextResponse> {
  console.log(`[brief-renders][worker] POST received`);
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // Production-hard signature check; explicit dev opt-out via env var.
  const skipVerify = process.env.SKIP_QSTASH_SIG_VERIFY === "true";
  if (skipVerify && process.env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY: SKIP_QSTASH_SIG_VERIFY must not be true in production",
    );
  }
  if (!skipVerify) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) {
      console.error(
        `[brief-renders][worker] signature verification FAILED — rejecting 401. ` +
          `signaturePresent=${!!signature} bodyBytes=${rawBody.length}`,
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.log(`[brief-renders][worker] signature verified`);
  } else {
    console.log(
      `[brief-renders][worker] SKIP_QSTASH_SIG_VERIFY=true (dev only) — bypassing signature check`,
    );
  }

  let body: BodyInput;
  try {
    body = BODY_SCHEMA.parse(JSON.parse(rawBody));
  } catch (err) {
    console.error(
      `[brief-renders][worker] body parse failed — 400. err=${err instanceof Error ? err.message : String(err)} body=${rawBody.slice(0, 200)}`,
    );
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  console.log(
    `[brief-renders][worker] body ok jobId=${body.jobId} ai=${body.apartmentIndex ?? "auto"} si=${body.shotIndexInApartment ?? "auto"} retry=${body.retryCount ?? 0}`,
  );

  // Load the job. If status is non-RUNNING, exit cleanly — cancel /
  // already-completed jobs are normal terminal states.
  const job = await prisma.briefRenderJob.findUnique({
    where: { id: body.jobId },
    select: { id: true, status: true, shots: true, stageLog: true },
  });
  if (!job) {
    console.error(`[brief-renders][worker] job not found jobId=${body.jobId}`);
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "RUNNING") {
    console.log(
      `[brief-renders][worker] job not RUNNING (status=${job.status}); skipping. jobId=${body.jobId}`,
    );
    return NextResponse.json({
      jobId: body.jobId,
      status: job.status,
      message: "Job is not RUNNING; no work performed.",
    });
  }

  // Stage logger seeded from existing log so events append rather than
  // replace. Persister writes after every event so the polling client
  // sees progress in near-real-time.
  const persister = createStageLogPersister(body.jobId, prisma);
  const logger = new BriefRenderLogger(persister);
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefStageLogEntry[]);
  }
  // Hand the logger to the outer POST handler so its finally block
  // can drain pending stageLog writes before we respond to QStash.
  setLogger(logger);

  const shots = (job.shots as ShotResult[] | null) ?? [];

  // Resolve target shot.
  let target:
    | { apartmentIndex: number; shotIndexInApartment: number }
    | null;

  if (body.apartmentIndex !== undefined && body.shotIndexInApartment !== undefined) {
    target = {
      apartmentIndex: body.apartmentIndex,
      shotIndexInApartment: body.shotIndexInApartment,
    };
  } else {
    target = findFirstPendingShot(shots);
  }

  // No pending shots → flip to awaiting_compile + dispatch compile worker.
  if (!target) {
    const { flipped, dispatched } = await transitionToAwaitingCompileAndDispatch(
      body.jobId,
    );
    if (!flipped) {
      // Race — job state changed before our flip landed. Exit 200 OK.
      return NextResponse.json({
        jobId: body.jobId,
        status: "skipped",
        message: "Job state changed; no compile dispatched.",
      });
    }
    if (!dispatched) {
      return NextResponse.json(
        { jobId: body.jobId, error: "compile_dispatch_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      jobId: body.jobId,
      status: "RUNNING",
      currentStage: AWAITING_COMPILE_STAGE,
      message: "All shots done — compile worker dispatched.",
    });
  }

  console.log(
    `[brief-renders][worker] target shot S${target.apartmentIndex + 1}.${target.shotIndexInApartment + 1} jobId=${body.jobId} — entering runStage3ImageGen`,
  );

  // Run Stage 3 for this shot.
  const result = await runStage3ImageGen({
    jobId: body.jobId,
    apartmentIndex: target.apartmentIndex,
    shotIndexInApartment: target.shotIndexInApartment,
    logger,
    prisma,
  });

  console.log(
    `[brief-renders][worker] runStage3 returned jobId=${body.jobId} status=${result.status}` +
      (result.status === "skipped" ? ` reason=${result.reason}` : "") +
      (result.status === "failed" ? ` kind=${result.kind} error=${result.error.slice(0, 120)}` : ""),
  );

  // Branch on Stage 3 result.
  switch (result.status) {
    case "success": {
      // Re-enqueue for the next pending shot. Conditional check: if
      // this *was* the last pending shot, mark awaiting_compile instead.
      const remaining = await prisma.briefRenderJob.findUnique({
        where: { id: body.jobId },
        select: { shots: true, status: true },
      });
      if (!remaining || remaining.status !== "RUNNING") {
        return NextResponse.json({
          jobId: body.jobId,
          status: "skipped",
          message: "Job no longer RUNNING after success.",
        });
      }
      const next = findFirstPendingShot(
        (remaining.shots as ShotResult[] | null) ?? [],
      );
      if (next) {
        await scheduleBriefRenderRenderWorker(body.jobId);
      } else {
        // No more pending shots — flip to awaiting_compile + dispatch
        // the compile worker. We tolerate dispatch failure here because
        // the shot itself succeeded; retry on the next render-worker
        // re-invocation will fire this branch again.
        await transitionToAwaitingCompileAndDispatch(body.jobId);
      }
      return NextResponse.json({
        jobId: body.jobId,
        status: "success",
        nextPending: next ?? null,
      });
    }

    case "skipped": {
      switch (result.reason) {
        case "already_done": {
          // Move on — re-enqueue for the next pending shot.
          const after = await prisma.briefRenderJob.findUnique({
            where: { id: body.jobId },
            select: { shots: true, status: true },
          });
          if (!after || after.status !== "RUNNING") {
            return NextResponse.json({
              jobId: body.jobId,
              status: "skipped",
            });
          }
          const next = findFirstPendingShot(
            (after.shots as ShotResult[] | null) ?? [],
          );
          if (next) {
            await scheduleBriefRenderRenderWorker(body.jobId);
          } else {
            await transitionToAwaitingCompileAndDispatch(body.jobId);
          }
          return NextResponse.json({
            jobId: body.jobId,
            status: "skipped",
            reason: "already_done",
          });
        }
        case "lock_busy": {
          // Another worker holds the per-shot lock; back off briefly
          // and retry. Targets the SAME shot indices.
          await scheduleBriefRenderRenderWorker(body.jobId, {
            apartmentIndex: target.apartmentIndex,
            shotIndexInApartment: target.shotIndexInApartment,
            delay: LOCK_BUSY_RETRY_DELAY_SECONDS,
          });
          return NextResponse.json({
            jobId: body.jobId,
            status: "skipped",
            reason: "lock_busy",
          });
        }
        case "job_cancelled": {
          // Terminal — no re-enqueue.
          return NextResponse.json({
            jobId: body.jobId,
            status: "skipped",
            reason: "job_cancelled",
          });
        }
      }
      // Should be exhaustive — TypeScript will catch unhandled cases.
      return NextResponse.json({ jobId: body.jobId, status: "skipped" });
    }

    case "failed": {
      if (result.kind === "rate_limited") {
        const nextRetry = (body.retryCount ?? 0) + 1;
        if (nextRetry <= MAX_RATE_LIMIT_RETRIES) {
          const delay = RATE_LIMIT_BACKOFF_SECONDS[nextRetry - 1];
          await scheduleBriefRenderRenderWorker(body.jobId, {
            apartmentIndex: target.apartmentIndex,
            shotIndexInApartment: target.shotIndexInApartment,
            retryCount: nextRetry,
            delay,
          });
          return NextResponse.json({
            jobId: body.jobId,
            status: "rate_limited_retry_scheduled",
            retryCount: nextRetry,
            delaySeconds: delay,
          });
        }
        // Cap reached → mark shot permanently failed, then continue to
        // the next pending shot.
        await markShotPermanentlyFailed(
          body.jobId,
          target.apartmentIndex,
          target.shotIndexInApartment,
        );
      }

      // For provider / r2_upload / db_race / rate_limit_exhausted: the
      // shot is now (or was already) marked failed in DB by Stage 3.
      // Move on to the next pending shot.
      const after = await prisma.briefRenderJob.findUnique({
        where: { id: body.jobId },
        select: { shots: true, status: true },
      });
      if (!after || after.status !== "RUNNING") {
        return NextResponse.json({
          jobId: body.jobId,
          status: "failed",
          kind: result.kind,
        });
      }
      const next = findFirstPendingShot(
        (after.shots as ShotResult[] | null) ?? [],
      );
      if (next) {
        await scheduleBriefRenderRenderWorker(body.jobId);
      } else {
        // No more pending shots — flip to awaiting_compile + dispatch
        // the compile worker. We tolerate dispatch failure here because
        // the shot itself succeeded; retry on the next render-worker
        // re-invocation will fire this branch again.
        await transitionToAwaitingCompileAndDispatch(body.jobId);
      }
      return NextResponse.json({
        jobId: body.jobId,
        status: "failed",
        kind: result.kind,
      });
    }
  }
}
