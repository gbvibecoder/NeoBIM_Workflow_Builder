/**
 * VideoJob service — the brain of the QStash-backed background video pipeline.
 *
 * End-to-end flow:
 *
 *   1. GN-009 handler (or future video producer) calls createVideoJobAndEnqueue
 *      AFTER it already has Kling task IDs in hand. We never submit to Kling
 *      here — only track submitted work and poll it to completion.
 *
 *   2. createVideoJobAndEnqueue writes a VideoJob row (status="queued",
 *      segments[] with each Kling taskId + initial status="submitted") and
 *      publishes a QStash message targeting /api/video-worker/poll with a
 *      10s initial delay. Returns the videoJobId to the handler so it can
 *      stuff it into the artifact.
 *
 *   3. QStash fires the worker route, which verifies the signature then calls
 *      advanceVideoJob(videoJobId). advanceVideoJob:
 *        a. Acquires a Redis mutex (videojob:lock:{id}, SET NX EX 60).
 *           Declined → return without advancing; the next delivery picks up.
 *        b. Loads the job. Terminal → release + return (no re-enqueue).
 *        c. For each non-terminal segment: polls Kling, persists any
 *           successfully-completed clip to R2, updates the segment in place.
 *        d. Writes the mutated segments + bookkeeping fields back to Postgres.
 *        e. If all segments settled → computes final status (complete / partial
 *           / failed) and does NOT re-enqueue.
 *           If not settled → computes an adaptive delay and publishes the next
 *           poll via QStash.
 *
 *   4. Client polls /api/video-jobs/[id] which returns the computed client view.
 *      UI components (VideoBody, MediaTab, HeroSection) render from that view.
 *
 * Source-of-truth convention:
 *   The VideoJob row is authoritative. We intentionally do NOT patch
 *   Execution.tileResults / Artifact.data — doing so reliably would require
 *   mapping the handler's client-generated executionId to a DB Execution.id,
 *   which the handler doesn't receive. UI reads from useVideoJob (= this
 *   service) and overlays the live state on top of the original artifact.
 *
 * Idempotency:
 *   Every transition checks current status before writing, so a repeated
 *   QStash delivery is a no-op. R2 object keys are deterministic
 *   (videos/{jobId}/{kind}.mp4) — overwrites are safe.
 */

import { Client as QStashClient } from "@upstash/qstash";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redis, redisConfigured } from "@/lib/rate-limit";
import { uploadVideoToR2, isR2Configured } from "@/lib/r2";
import { logger } from "@/lib/logger";
import {
  KLING_IMAGE2VIDEO_PATH,
  KLING_TEXT2VIDEO_PATH,
  KLING_OMNI_PATH,
  COST_PER_SECOND,
  klingFetch,
  extractKlingVideoUrl,
  type KlingTaskResponse,
} from "@/features/3d-render/services/kling-client";
import type {
  VideoJobClientView,
  VideoJobStatus,
  VideoPipeline,
  VideoSegmentKind,
  VideoSegmentRecord,
  VideoSegmentStatus,
} from "@/types/video-job";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Mutex TTL — long enough for one poll cycle + R2 upload, short enough that
 *  a crashed worker doesn't stall the pipeline. Matches Vercel maxDuration=60 */
const REDIS_LOCK_TTL_SECONDS = 60;

/** Hard ceiling on total elapsed poll time — if Kling is this slow we give up. */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/** Max R2 retries per segment before we surface the Kling URL and call it done. */
const R2_RETRY_LIMIT = 5;

/** Amortized GPT-Image-1 edit cost appended to renovation jobs. Fixes audit
 *  Issue #10 (the "$2.04 isn't 2×$1.00" mystery from gn-009.ts:487). */
const GPT_IMAGE_1_COST = 0.04;

// ─── QStash singleton ──────────────────────────────────────────────────────

let _qstash: QStashClient | null = null;
function getQStash(): QStashClient {
  if (_qstash) return _qstash;
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is not configured");
  _qstash = new QStashClient({ token });
  return _qstash;
}

function workerUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/video-worker/poll`;
}

/** Schedule the next worker invocation for this job. */
async function enqueueWorker(videoJobId: string, attempt: number, delaySeconds: number): Promise<void> {
  const client = getQStash();
  await client.publishJSON({
    url: workerUrl(),
    body: { videoJobId },
    delay: delaySeconds,
    retries: 3,
    deduplicationId: `videojob-${videoJobId}-${attempt}`,
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface CreateVideoJobInput {
  userId: string;
  /** Client-generated execution correlation ID (not a FK). */
  executionId: string;
  /**
   * DB Execution.id when the workflow was persisted at run time. Phase 2
   * field — used by the worker's terminal patch to locate and mutate the
   * Execution.tileResults JSON so non-VideoJob-aware readers see a playable
   * videoUrl on the artifact. Pass `undefined` for demo / unsaved runs; the
   * patch step gracefully no-ops in that case.
   */
  dbExecutionId?: string;
  /** Workflow node instance id (tileInstanceId in the handler). */
  nodeId: string;
  pipeline: VideoPipeline;
  isRenovation: boolean;
  isFloorPlan: boolean;
  segments: Array<{
    kind: VideoSegmentKind;
    taskId: string;
    durationSeconds: number;
  }>;
  buildingDescription?: string;
}

/**
 * Insert a VideoJob row seeded with the just-submitted Kling tasks and kick
 * off the QStash worker. Returns the videoJobId — the handler puts this on
 * the artifact so the client can poll it.
 */
export async function createVideoJobAndEnqueue(
  input: CreateVideoJobInput,
): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();

  const segments: VideoSegmentRecord[] = input.segments.map((s) => ({
    kind: s.kind,
    taskId: s.taskId,
    status: "submitted",
    durationSeconds: s.durationSeconds,
    submittedAt: nowIso,
  }));

  const totalDurationSeconds = segments.reduce(
    (sum, s) => sum + s.durationSeconds,
    0,
  );
  const costUsd = computeCostUsd(totalDurationSeconds, input.isRenovation);

  const job = await prisma.videoJob.create({
    data: {
      userId: input.userId,
      executionId: input.executionId,
      dbExecutionId: input.dbExecutionId ?? null,
      nodeId: input.nodeId,
      pipeline: input.pipeline,
      isRenovation: input.isRenovation,
      isFloorPlan: input.isFloorPlan,
      status: "queued",
      segments: segments as unknown as object, // Prisma Json column
      pollAttempts: 0,
      firstSubmittedAt: now,
      totalDurationSeconds,
      costUsd,
      buildingDescription: input.buildingDescription,
    },
    select: { id: true },
  });

  try {
    await enqueueWorker(job.id, 1, 10);
    logger.info(`[VIDEO_JOB] created+enqueued id=${job.id} segments=${segments.length}`);
  } catch (err) {
    // If QStash enqueue failed we still have the row — surface this loudly
    // because without a worker the job will rot.
    logger.error("[VIDEO_JOB] QStash enqueue failed after row insert", {
      videoJobId: job.id,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return job.id;
}

/**
 * Advance a VideoJob by one poll cycle. Called by the QStash worker route.
 * Idempotent: safe to call multiple times for the same delivery — Redis
 * mutex + status checks prevent double-work.
 */
export async function advanceVideoJob(
  videoJobId: string,
): Promise<{ terminal: boolean; status: VideoJobStatus }> {
  const lockAcquired = await acquireLock(videoJobId);
  if (!lockAcquired) {
    logger.info(`[VIDEO_JOB] ${videoJobId} mutex declined — another worker advancing`);
    const current = await prisma.videoJob.findUnique({
      where: { id: videoJobId },
      select: { status: true },
    });
    const status = (current?.status as VideoJobStatus | undefined) ?? "processing";
    return { terminal: isTerminalStatus(status), status };
  }

  try {
    const job = await prisma.videoJob.findUnique({
      where: { id: videoJobId },
    });
    if (!job) {
      throw new Error(`VideoJob ${videoJobId} not found`);
    }

    const currentStatus = job.status as VideoJobStatus;
    if (isTerminalStatus(currentStatus)) {
      logger.info(`[VIDEO_JOB] ${videoJobId} already terminal (${currentStatus}) — no-op`);
      return { terminal: true, status: currentStatus };
    }

    const segments = parseSegments(job.segments);
    const nextAttempt = job.pollAttempts + 1;
    const elapsedMs = Date.now() - job.firstSubmittedAt.getTime();

    // ── Cap: if we've been grinding for 30 min, force-fail any non-terminal segments.
    if (elapsedMs > MAX_POLL_DURATION_MS) {
      for (const seg of segments) {
        if (seg.status !== "complete" && seg.status !== "failed") {
          seg.status = "failed";
          seg.failureReason = "poll cap exceeded (30m)";
          seg.completedAt = new Date().toISOString();
        }
      }
    } else {
      // ── Poll each outstanding segment. Write to DB immediately after each
      // terminal transition so the client sees the [complete, processing]
      // intermediate state. Without this, both segments completing in one
      // worker invocation atomically flip together and the streaming UX dies.
      //
      // Phase 3 fix. The end-of-function DB write below still runs and handles
      // the job-level status flip, failureReason, costUsd, completedAt.
      for (const seg of segments) {
        if (seg.status === "complete" || seg.status === "failed") continue;

        const wasInFlight = seg.status === "submitted" || seg.status === "processing";
        await pollAndPersistSegment(seg, job.pipeline as VideoPipeline, videoJobId);
        // Type assertion to VideoSegmentStatus is required (and correct):
        // TypeScript narrowed seg.status to "submitted" | "processing" above
        // via the `continue` guard at the top of the loop. The await call
        // mutates seg.status through a reference — invisible to TS's flow
        // analysis, which keeps the old narrowed type after the await. This
        // widens back to the full VideoSegmentStatus union, which is the
        // actual runtime type of the value post-await.
        const statusAfter = seg.status as VideoSegmentStatus;
        const nowTerminal = statusAfter === "complete" || statusAfter === "failed";

        if (wasInFlight && nowTerminal) {
          // Persist segment transition immediately. Job-level status stays
          // "processing" here — the end-of-function update computes and writes
          // the final status (complete / partial / failed) after all segments
          // have been polled.
          await prisma.videoJob.update({
            where: { id: videoJobId },
            data: {
              segments: segments as unknown as object,
              status: "processing",
              lastPolledAt: new Date(),
            },
          });

          // ── Incremental patch: show the first completed video immediately ──
          // Don't make users wait for ALL segments. As soon as one segment
          // finishes, patch the execution artifact so the result page shows
          // a playable video instead of a loading spinner.
          if (statusAfter === "complete" && job.dbExecutionId) {
            const completedSoFar = segments.filter((s) => s.status === "complete");
            const completedDur = completedSoFar.reduce((sum, s) => sum + s.durationSeconds, 0);
            try {
              await patchExecutionArtifact({
                videoJobId,
                dbExecutionId: job.dbExecutionId,
                userId: job.userId,
                nodeId: job.nodeId,
                terminalStatus: "partial",
                failureReason: null,
                segments,
                completedDuration: completedDur,
                finalCostUsd: computeCostUsd(completedDur, job.isRenovation),
                isRenovation: job.isRenovation,
                isFloorPlan: job.isFloorPlan,
                pipeline: job.pipeline as VideoPipeline,
              });
              logger.info(
                `[VIDEO_JOB] ${videoJobId} incremental patch — ${completedSoFar.length} segment(s) playable`,
              );
            } catch (earlyPatchErr) {
              // Non-fatal — the terminal patch will catch up.
              logger.warn(
                `[VIDEO_JOB] ${videoJobId} incremental patch failed (non-fatal): ${(earlyPatchErr as Error).message}`,
              );
            }
          }
        }
      }
    }

    const { allSettled, anyComplete, anyFailed } = classifySegments(segments);

    let newStatus: VideoJobStatus;
    let failureReason: string | null = null;
    if (allSettled) {
      if (anyComplete && anyFailed) newStatus = "partial";
      else if (anyComplete) newStatus = "complete";
      else {
        newStatus = "failed";
        failureReason = firstFailureReason(segments) ?? "all video segments failed";
      }
    } else {
      newStatus = "processing";
    }

    // Recompute final cost from actually-completed segments so renovation / failed
    // cases don't overcharge the UI's displayed cost.
    const completedDuration = segments
      .filter((s) => s.status === "complete")
      .reduce((sum, s) => sum + s.durationSeconds, 0);
    const finalCost =
      newStatus === "complete" || newStatus === "partial"
        ? computeCostUsd(completedDuration, job.isRenovation)
        : job.costUsd;

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: {
        segments: segments as unknown as object,
        status: newStatus,
        failureReason: failureReason ?? undefined,
        pollAttempts: nextAttempt,
        lastPolledAt: new Date(),
        totalDurationSeconds:
          newStatus === "complete" || newStatus === "partial"
            ? completedDuration
            : job.totalDurationSeconds,
        costUsd: finalCost,
        completedAt: isTerminalStatus(newStatus) ? new Date() : null,
      },
    });

    if (isTerminalStatus(newStatus)) {
      // Phase 2 durability patch: mutate Execution.tileResults so downstream
      // readers (share endpoint, exports, PDF reports, execution history) see
      // a playable videoUrl without relying on the VideoJob row. The patch is
      // idempotent by construction — writing the same derived state twice is
      // a no-op. Graceful failure on missing rows; the job still terminalizes.
      await patchExecutionArtifact({
        videoJobId,
        dbExecutionId: job.dbExecutionId,
        userId: job.userId,
        nodeId: job.nodeId,
        terminalStatus: newStatus,
        failureReason: failureReason ?? null,
        segments,
        completedDuration,
        finalCostUsd: finalCost ?? 0,
        isRenovation: job.isRenovation,
        isFloorPlan: job.isFloorPlan,
        pipeline: job.pipeline as VideoPipeline,
      });
      logger.info(`[VIDEO_JOB] ${videoJobId} terminal=${newStatus}`);
      return { terminal: true, status: newStatus };
    }

    // ── Schedule next poll with adaptive backoff.
    const delay = adaptiveDelaySeconds(elapsedMs);
    await enqueueWorker(videoJobId, nextAttempt + 1, delay);
    logger.info(
      `[VIDEO_JOB] ${videoJobId} re-enqueued delay=${delay}s elapsed=${Math.round(elapsedMs / 1000)}s`,
    );
    return { terminal: false, status: newStatus };
  } finally {
    await releaseLock(videoJobId);
  }
}

/**
 * Read a VideoJob and return the client-safe view. Performs ownership check.
 */
export async function getVideoJobForUser(
  videoJobId: string,
  userId: string,
): Promise<VideoJobClientView | null> {
  const job = await prisma.videoJob.findUnique({ where: { id: videoJobId } });
  if (!job) return null;
  if (job.userId !== userId) return null;

  const segments = parseSegments(job.segments);
  return buildClientView(job, segments);
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function parseSegments(raw: unknown): VideoSegmentRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is VideoSegmentRecord => {
    if (!x || typeof x !== "object") return false;
    const r = x as Partial<VideoSegmentRecord>;
    return (
      typeof r.kind === "string" &&
      typeof r.taskId === "string" &&
      typeof r.status === "string" &&
      typeof r.durationSeconds === "number" &&
      typeof r.submittedAt === "string"
    );
  });
}

function isTerminalStatus(s: VideoJobStatus): boolean {
  return s === "complete" || s === "failed" || s === "partial";
}

function classifySegments(segments: VideoSegmentRecord[]): {
  allSettled: boolean;
  anyComplete: boolean;
  anyFailed: boolean;
} {
  const allSettled = segments.every(
    (s) => s.status === "complete" || s.status === "failed",
  );
  const anyComplete = segments.some((s) => s.status === "complete");
  const anyFailed = segments.some((s) => s.status === "failed");
  return { allSettled, anyComplete, anyFailed };
}

function firstFailureReason(segments: VideoSegmentRecord[]): string | null {
  for (const s of segments) {
    if (s.status === "failed" && s.failureReason) return s.failureReason;
  }
  return null;
}

/** Match the cinematic pipeline's philosophy: slow early, faster later. */
function adaptiveDelaySeconds(elapsedMs: number): number {
  if (elapsedMs < 120_000) return 8; // 0–2min: tight poll while Kling is warming up
  if (elapsedMs < 360_000) return 15; // 2–6min: moderate
  if (elapsedMs < 900_000) return 30; // 6–15min: loose
  return 60; // 15–30min: rare tail
}

function computeCostUsd(totalDurationSeconds: number, isRenovation: boolean): number {
  const base = totalDurationSeconds * COST_PER_SECOND;
  const total = isRenovation ? base + GPT_IMAGE_1_COST : base;
  // Round to 3 decimals to avoid float-noise in the UI.
  return Math.round(total * 1000) / 1000;
}

function statusGetPath(pipeline: VideoPipeline, kind: VideoSegmentKind): string {
  // For floor-plan jobs we originally POSTed to Omni in prod. Polling is
  // tolerant: checkSingleVideoStatus tries Omni first, falls through to
  // image2video. For direct segment polls we pick the matching endpoint.
  if (pipeline === "text2video") return KLING_TEXT2VIDEO_PATH;
  if (pipeline === "omni" || kind === "single") return KLING_OMNI_PATH;
  return KLING_IMAGE2VIDEO_PATH;
}

/** Poll one segment. Mutates seg in place. */
async function pollAndPersistSegment(
  seg: VideoSegmentRecord,
  pipeline: VideoPipeline,
  videoJobId: string,
): Promise<void> {
  let result: KlingTaskResponse;
  try {
    const path = statusGetPath(pipeline, seg.kind);
    result = await klingFetch(`${path}/${seg.taskId}`, {
      method: "GET",
      retryOn1303: false, // status reads shouldn't burn 90s on 1303
    });
  } catch (err) {
    // Omni path's status endpoint sometimes 404s until the task is picked up.
    // Fall through to image2video as a best-effort retry for single/omni jobs.
    if (pipeline === "omni" || seg.kind === "single") {
      try {
        result = await klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${seg.taskId}`, {
          method: "GET",
          retryOn1303: false,
        });
      } catch (fallbackErr) {
        logger.warn(
          `[VIDEO_JOB] ${videoJobId} segment=${seg.kind} poll transient error: ${(fallbackErr as Error).message}`,
        );
        return; // leave segment unchanged; next poll retries
      }
    } else {
      logger.warn(
        `[VIDEO_JOB] ${videoJobId} segment=${seg.kind} poll transient error: ${(err as Error).message}`,
      );
      return;
    }
  }

  const taskStatus = result.data.task_status;

  if (taskStatus === "submitted" || taskStatus === "processing") {
    // Bump in-flight status so the UI shows progress ticking.
    if (seg.status === "submitted" && taskStatus === "processing") {
      seg.status = "processing";
    }
    return;
  }

  if (taskStatus === "failed") {
    seg.status = "failed";
    seg.failureReason = result.data.task_status_msg ?? "Kling task failed";
    seg.completedAt = new Date().toISOString();
    return;
  }

  if (taskStatus === "succeed") {
    const videoUrl = extractKlingVideoUrl(result);
    if (!videoUrl) {
      // Edge case: Kling says succeed but no URL. Treat as transient; next
      // poll may surface it (sometimes their CDN is slightly behind).
      logger.warn(
        `[VIDEO_JOB] ${videoJobId} segment=${seg.kind} succeed but no URL yet — retry next cycle`,
      );
      return;
    }

    seg.klingUrl = videoUrl;

    // Try to persist to R2. On failure, leave segment in "processing" with
    // klingUrl set so the next worker run retries. After R2_RETRY_LIMIT
    // retries, give up and accept the Kling URL as the final URL.
    if (!isR2Configured()) {
      logger.warn(
        `[VIDEO_JOB] ${videoJobId} R2 not configured — using Kling URL directly for ${seg.kind}`,
      );
      seg.status = "complete";
      seg.completedAt = new Date().toISOString();
      return;
    }

    const retries = seg.r2RetryCount ?? 0;
    try {
      const persisted = await persistToR2(videoJobId, seg.kind, videoUrl);
      seg.r2Url = persisted;
      seg.status = "complete";
      seg.completedAt = new Date().toISOString();
      seg.r2RetryCount = retries; // unchanged on success
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      seg.r2RetryCount = retries + 1;
      if (seg.r2RetryCount >= R2_RETRY_LIMIT) {
        logger.error(
          `[VIDEO_JOB] ${videoJobId} segment=${seg.kind} R2 persist failed ${seg.r2RetryCount}× — falling back to Kling URL`,
          { msg },
        );
        seg.status = "complete";
        seg.completedAt = new Date().toISOString();
      } else {
        logger.warn(
          `[VIDEO_JOB] ${videoJobId} segment=${seg.kind} R2 persist failed (${seg.r2RetryCount}/${R2_RETRY_LIMIT}) — will retry next cycle: ${msg}`,
        );
        // Leave status as "processing" so the next poll retries.
        seg.status = "processing";
      }
    }
  }
}

/** Download the MP4 from Kling's CDN and upload to R2 under a deterministic key. */
async function persistToR2(
  videoJobId: string,
  kind: VideoSegmentKind,
  klingUrl: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 5 * 60_000);
  let buffer: Buffer;
  try {
    const res = await fetch(klingUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Kling download HTTP ${res.status}`);
    }
    buffer = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeoutHandle);
  }

  const filename = `videos/${videoJobId}/${kind}.mp4`;
  const upload = await uploadVideoToR2(buffer, filename);
  if (!upload.success) {
    throw new Error(`R2 upload failed: ${upload.error}`);
  }
  return upload.url;
}

// ─── Redis mutex ────────────────────────────────────────────────────────────

async function acquireLock(videoJobId: string): Promise<boolean> {
  if (!redisConfigured) return true; // dev-friendly — no locking without Redis
  const key = `videojob:lock:${videoJobId}`;
  const result = await redis.set(key, "1", { nx: true, ex: REDIS_LOCK_TTL_SECONDS });
  return result === "OK";
}

async function releaseLock(videoJobId: string): Promise<void> {
  if (!redisConfigured) return;
  try {
    await redis.del(`videojob:lock:${videoJobId}`);
  } catch (err) {
    logger.warn(`[VIDEO_JOB] ${videoJobId} mutex release failed (non-fatal)`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Execution.tileResults durability patch (Phase 2) ──────────────────────
//
// When a VideoJob terminalizes, mutate the corresponding artifact entry in
// Execution.tileResults so that downstream readers — share endpoint, exports,
// execution history, PDF reports — see a playable videoUrl without knowing
// about VideoJob. The VideoJob row stays live-authoritative for in-flight
// state; this patch is the durability backup for terminal state.
//
// Design:
//   • Nothing throws. Missing Execution row, missing artifact entry, Prisma
//     hiccup — all log-and-skip. The video job MUST still terminalize cleanly.
//   • Idempotent: writes the same derived shape every time for the same inputs.
//     No "skip if already patched" guard — it's deterministic by construction.
//   • Does NOT write to the separate `Artifact` table. Many consumers read
//     tileResults (see executions/route.ts:44–62 for proof — the list endpoint
//     reconstructs artifacts FROM tileResults). One surface is enough.

interface PatchArtifactInput {
  videoJobId: string;
  dbExecutionId: string | null;
  userId: string;
  nodeId: string;
  terminalStatus: VideoJobStatus;
  failureReason: string | null;
  segments: VideoSegmentRecord[];
  completedDuration: number;
  finalCostUsd: number;
  isRenovation: boolean;
  isFloorPlan: boolean;
  pipeline: VideoPipeline;
}

async function patchExecutionArtifact(input: PatchArtifactInput): Promise<void> {
  const {
    videoJobId, dbExecutionId, userId, nodeId,
    terminalStatus, failureReason, segments,
    completedDuration, finalCostUsd, isRenovation, isFloorPlan, pipeline,
  } = input;

  if (!dbExecutionId) {
    // Demo / unsaved workflow — nothing to patch. Normal path for many users.
    return;
  }

  try {
    const exec = await prisma.execution.findFirst({
      where: { id: dbExecutionId, userId },
      select: { id: true, tileResults: true },
    });
    if (!exec) {
      logger.warn(
        `[VIDEO_JOB_PATCH] execution row not found jobId=${videoJobId} dbExecId=${dbExecutionId}`,
      );
      return;
    }

    const rawTileResults = Array.isArray(exec.tileResults) ? exec.tileResults : [];
    // Defensive clone — we mutate one entry then hand Prisma the whole array.
    const tileResults = rawTileResults.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return { ...(entry as Record<string, unknown>) };
    });

    let patchedIndex = -1;
    for (let i = 0; i < tileResults.length; i++) {
      const entry = tileResults[i] as Record<string, unknown> | null;
      if (!entry || typeof entry !== "object") continue;
      if (entry.type !== "video") continue;
      const data = entry.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== "object") continue;
      if (data.videoJobId === videoJobId) {
        patchedIndex = i;
        break;
      }
      // Fallback match by nodeId when videoJobId isn't on the entry yet — can
      // happen if the client persisted the artifact before the handler stuffed
      // videoJobId into tileResults (rare timing race).
      if (patchedIndex < 0 && (entry.nodeId === nodeId || entry.tileInstanceId === nodeId)) {
        patchedIndex = i;
        // Keep scanning in case a videoJobId-exact match appears later.
      }
    }

    if (patchedIndex < 0) {
      logger.warn(
        `[VIDEO_JOB_PATCH] no matching video artifact jobId=${videoJobId} nodeId=${nodeId}`,
      );
      return;
    }

    const completeSegments = segments.filter((s) => s.status === "complete");
    const prioritized = [...completeSegments].sort(
      (a, b) => segmentPriority(a.kind) - segmentPriority(b.kind),
    );
    const primary = prioritized[0];
    const primaryUrl = primary ? (primary.r2Url ?? primary.klingUrl ?? "") : "";
    const interior = completeSegments.find((s) => s.kind === "interior");
    const interiorUrl = interior ? (interior.r2Url ?? interior.klingUrl) : undefined;

    // Include ALL segments — complete ones with URLs, in-progress ones with
    // empty URLs so the frontend can show "generating…" pills for pending shots.
    const allSorted = [...segments].sort(
      (a, b) => segmentPriority(a.kind) - segmentPriority(b.kind),
    );
    const flatSegments = allSorted.map((s) => {
      const url = s.status === "complete" ? (s.r2Url ?? s.klingUrl ?? "") : "";
      return {
        kind: s.kind,
        url: url || undefined,
        videoUrl: url,
        downloadUrl: url,
        durationSeconds: s.durationSeconds,
        label: segmentLabel(s.kind, s.durationSeconds),
      };
    });

    const label = deriveFinalLabel({
      terminalStatus,
      isRenovation,
      isFloorPlan,
      pipeline,
      completedDuration,
      shotCount: completeSegments.length,
    });

    const targetEntry = tileResults[patchedIndex] as Record<string, unknown>;
    const previousData = (targetEntry.data as Record<string, unknown>) ?? {};

    const patchedData: Record<string, unknown> = {
      ...previousData,
      videoGenerationStatus: terminalStatus,
      videoUrl: primaryUrl,
      downloadUrl: primaryUrl,
      ...(interiorUrl !== undefined ? { interiorVideoUrl: interiorUrl } : {}),
      segments: flatSegments,
      durationSeconds: completedDuration > 0 ? completedDuration : previousData.durationSeconds,
      shotCount: completeSegments.length || 1,
      costUsd: finalCostUsd,
      generationProgress: 100,
      label,
      videoJobId,
    };
    if (terminalStatus === "failed" && failureReason) {
      patchedData.failureReason = failureReason;
    } else {
      // Clear any stale failureReason on a happy patch.
      delete patchedData.failureReason;
    }

    tileResults[patchedIndex] = { ...targetEntry, data: patchedData };

    await prisma.execution.update({
      where: { id: dbExecutionId },
      // Cast through unknown because Prisma.InputJsonValue is a recursive
      // union TypeScript can't narrow our plain object to; the shape is
      // valid JSON by construction (built from Json-safe primitives above).
      data: { tileResults: tileResults as unknown as Prisma.InputJsonValue },
    });

    logger.info(
      `[VIDEO_JOB_PATCH] patched execution=${dbExecutionId} nodeId=${nodeId} status=${terminalStatus} segments=${flatSegments.length}`,
    );
  } catch (err) {
    // Swallow — the job must still terminalize. This is durability, not correctness.
    logger.error(
      `[VIDEO_JOB_PATCH] failed jobId=${videoJobId} dbExecId=${dbExecutionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function segmentLabel(kind: VideoSegmentKind, seconds: number): string {
  if (kind === "exterior") return `Exterior — ${seconds}s`;
  if (kind === "interior") return `Interior — ${seconds}s`;
  return `Walkthrough — ${seconds}s`;
}

function deriveFinalLabel(args: {
  terminalStatus: VideoJobStatus;
  isRenovation: boolean;
  isFloorPlan: boolean;
  pipeline: VideoPipeline;
  completedDuration: number;
  shotCount: number;
}): string {
  const { terminalStatus, isRenovation, isFloorPlan, pipeline, completedDuration, shotCount } = args;
  if (terminalStatus === "failed") return "Video generation failed";
  const suffix = terminalStatus === "partial" ? " (partial)" : "";
  const seconds = completedDuration;
  if (isFloorPlan || pipeline === "omni") {
    return `Floor Plan Walkthrough — ${seconds}s${suffix}`;
  }
  if (isRenovation) {
    return `Renovation Walkthrough — ${seconds}s · ${shotCount} shots${suffix}`;
  }
  return `Cinematic Walkthrough — ${seconds}s · ${shotCount} shots${suffix}`;
}

// ─── Client view construction ───────────────────────────────────────────────

interface VideoJobRow {
  id: string;
  status: string;
  pipeline: string;
  isRenovation: boolean;
  isFloorPlan: boolean;
  totalDurationSeconds: number | null;
  costUsd: number | null;
  failureReason: string | null;
  updatedAt: Date;
}

function buildClientView(
  job: VideoJobRow,
  segments: VideoSegmentRecord[],
): VideoJobClientView {
  const status = job.status as VideoJobStatus;

  const statusWeight: Record<string, number> = {
    submitted: 10,
    processing: 50,
    complete: 100,
    failed: 100,
  };
  const totalWeight = segments.reduce(
    (sum, s) => sum + (statusWeight[s.status] ?? 0),
    0,
  );
  const avgWeight = segments.length > 0 ? totalWeight / segments.length : 0;
  const progress = isTerminalStatus(status) ? 100 : Math.round(avgWeight);

  const segView = segments.map((s) => ({
    kind: s.kind,
    status: s.status,
    durationSeconds: s.durationSeconds,
    completedAt: s.completedAt,
    failureReason: s.failureReason,
    url: s.status === "complete" ? (s.r2Url ?? s.klingUrl) : undefined,
  }));

  // Primary playable URL — prefer exterior/single over interior, within complete segments.
  const completeSorted = [...segments]
    .filter((s) => s.status === "complete")
    .sort((a, b) => segmentPriority(a.kind) - segmentPriority(b.kind));
  const primary = completeSorted[0];
  const primaryVideoUrl = primary?.r2Url ?? primary?.klingUrl;

  const playableSegments = completeSorted
    .map((s) => ({
      kind: s.kind,
      url: (s.r2Url ?? s.klingUrl) as string | undefined,
      durationSeconds: s.durationSeconds,
    }))
    .filter((p): p is { kind: VideoSegmentKind; url: string; durationSeconds: number } =>
      typeof p.url === "string",
    );

  return {
    id: job.id,
    status,
    pipeline: job.pipeline as VideoPipeline,
    isRenovation: job.isRenovation,
    isFloorPlan: job.isFloorPlan,
    segments: segView,
    totalDurationSeconds: job.totalDurationSeconds ?? undefined,
    costUsd: job.costUsd ?? undefined,
    failureReason: job.failureReason ?? undefined,
    progress,
    primaryVideoUrl,
    playableSegments,
    updatedAt: job.updatedAt.toISOString(),
  };
}

function segmentPriority(kind: VideoSegmentKind): number {
  // exterior first (the opening shot), single next, interior last.
  if (kind === "exterior") return 0;
  if (kind === "single") return 1;
  return 2;
}
