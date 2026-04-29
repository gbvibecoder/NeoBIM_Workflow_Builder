/**
 * Stage 3 — per-shot image generation.
 *
 * Each invocation renders ONE shot. The render-worker route at
 * `src/app/api/brief-renders/worker/render/route.ts` orchestrates the
 * 12-shot loop by re-enqueueing itself after each shot.
 *
 * The Stage 3 invariants:
 *
 *   • Per-shot Redis mutex prevents duplicate renders on QStash retries.
 *   • TOCTOU re-read inside the lock — if another worker raced past
 *     the mutex (e.g. Redis blip + lock TTL expiry) and finished the
 *     shot, we skip cleanly.
 *   • Deterministic R2 key (`briefs/shots/{jobId}/{ai}-{si}.png`)
 *     means a re-upload of the same shot overwrites in place; no
 *     duplicate objects pile up across retries.
 *   • Atomic single-field DB update via `jsonb_set` so concurrent
 *     workers updating different shots don't clobber each other's
 *     writes (the classic lost-update race on whole-array writes).
 *   • Cost increment via Prisma's `cost_usd = cost_usd + N` — read-
 *     then-write would race with concurrent shot completions.
 *
 * Phase 4 NEVER sets `status = "COMPLETED"`. The terminal Phase 4 state
 * is `status = "RUNNING"` + `currentStage = "awaiting_compile"`. Phase 5
 * owns the COMPLETED transition.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { uploadBase64ToR2 } from "@/lib/r2";
import { JobNotFoundError } from "./orchestrator";
import {
  ImageGenProviderError,
  ImageGenRateLimitError,
  generateShotImage,
} from "./providers/gpt-image";
import {
  acquireShotLock,
  releaseShotLock,
  type ShotLockHandle,
} from "./redis-locks";
import type { BriefRenderLogger } from "./logger";
import type { BriefSpec, ShotResult } from "./types";

// ─── Public surface ─────────────────────────────────────────────────

export interface Stage3Args {
  jobId: string;
  apartmentIndex: number;
  shotIndexInApartment: number;
  logger: BriefRenderLogger;
  prisma: PrismaClient;
}

export type Stage3Result =
  | {
      status: "success";
      imageUrl: string;
      costUsd: number;
      widthPx: number;
      heightPx: number;
    }
  | {
      status: "failed";
      error: string;
      costUsd: 0;
      kind: "rate_limited" | "provider" | "r2_upload" | "db_race";
    }
  | {
      status: "skipped";
      reason: "already_done" | "lock_busy" | "job_cancelled";
    };

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Find the flat-array index of a shot identified by its (apartment,
 * shot-in-apartment) pair. Returns -1 if not found.
 */
function findFlatShotIndex(
  shots: ShotResult[],
  apartmentIndex: number,
  shotIndexInApartment: number,
): number {
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (
      s.apartmentIndex === apartmentIndex &&
      s.shotIndexInApartment === shotIndexInApartment
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Atomic single-field shot update.
 *
 * Uses Postgres `jsonb_set` to mutate ONLY the targeted shot entry
 * inside `shots[]`, so concurrent workers updating *different* shots
 * never overwrite each other's writes (lost-update race).
 *
 * Also atomically increments `cost_usd` in the same statement.
 *
 * The `WHERE status = 'RUNNING'` filter rejects writes to cancelled or
 * terminal jobs — `count: 0` from the executeRaw call is the signal.
 */
async function persistShotPatch(
  prisma: PrismaClient,
  jobId: string,
  flatShotIndex: number,
  patch: Partial<ShotResult>,
  costIncrement: number,
): Promise<{ updated: boolean }> {
  const patchJson = JSON.stringify(patch);
  const indexStr = String(flatShotIndex);
  // Column names MUST be double-quoted: Prisma migrations store
  // BriefRenderJob columns as case-sensitive camelCase ("costUsd",
  // "updatedAt"). Unquoted identifiers in Postgres are folded to
  // lowercase, so `cost_usd` / `updated_at` resolve to columns that
  // do not exist (error 42703). This was the root cause of every
  // shot staying "pending" forever post-approve.
  const affected = await prisma.$executeRaw`
    UPDATE brief_render_jobs
    SET shots = jsonb_set(
          shots,
          ARRAY[${indexStr}]::text[],
          (shots->${flatShotIndex}::int) || ${patchJson}::jsonb
        ),
        "costUsd" = "costUsd" + ${costIncrement},
        "updatedAt" = NOW()
    WHERE id = ${jobId} AND status = 'RUNNING'
  `;
  return { updated: affected > 0 };
}

// ─── Main entry point ───────────────────────────────────────────────

export async function runStage3ImageGen(
  args: Stage3Args,
): Promise<Stage3Result> {
  const { jobId, apartmentIndex, shotIndexInApartment, logger, prisma } = args;

  logger.startStage(
    3,
    `Image Gen S${apartmentIndex + 1}.${shotIndexInApartment + 1}`,
  );

  // 1. Pre-check job state and shot state without holding the lock yet.
  //    This avoids burning a Redis SET NX EX call for shots that are
  //    obviously not eligible.
  const job = await prisma.briefRenderJob.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.endStage(3, "failed", undefined, "job_not_found");
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "RUNNING") {
    logger.endStage(3, "success", { skipped: "job_cancelled" });
    return { status: "skipped", reason: "job_cancelled" };
  }

  const shots = (job.shots as ShotResult[] | null) ?? [];
  const flatIndex = findFlatShotIndex(shots, apartmentIndex, shotIndexInApartment);
  if (flatIndex < 0) {
    logger.endStage(3, "failed", undefined, "shot_not_found");
    return {
      status: "failed",
      error: "shot_not_found",
      costUsd: 0,
      kind: "db_race",
    };
  }

  if (shots[flatIndex].status === "success") {
    logger.endStage(3, "success", { skipped: "already_done", flatIndex });
    return { status: "skipped", reason: "already_done" };
  }

  // 2. Acquire the per-shot mutex.
  const lock: ShotLockHandle = await acquireShotLock(
    jobId,
    apartmentIndex,
    shotIndexInApartment,
  );
  if (!lock.acquired) {
    logger.endStage(3, "success", { skipped: "lock_busy" });
    return { status: "skipped", reason: "lock_busy" };
  }

  try {
    // 3. TOCTOU re-read — another worker might have completed this shot
    //    between our pre-check and the lock acquire (lock TTL expired,
    //    two workers raced).
    const fresh = await prisma.briefRenderJob.findUnique({
      where: { id: jobId },
      select: { status: true, shots: true, specResult: true },
    });
    if (!fresh) {
      logger.endStage(3, "failed", undefined, "job_disappeared");
      return {
        status: "failed",
        error: "job_disappeared",
        costUsd: 0,
        kind: "db_race",
      };
    }
    if (fresh.status !== "RUNNING") {
      logger.endStage(3, "success", { skipped: "job_cancelled_after_lock" });
      return { status: "skipped", reason: "job_cancelled" };
    }
    const freshShots = (fresh.shots as ShotResult[] | null) ?? [];
    if (freshShots[flatIndex]?.status === "success") {
      logger.endStage(3, "success", { skipped: "already_done_after_lock" });
      return { status: "skipped", reason: "already_done" };
    }

    const targetShot = freshShots[flatIndex];
    const referenceImageUrls =
      ((fresh.specResult as BriefSpec | null)?.referenceImageUrls ?? []);

    // 4a. Mark the shot `running` BEFORE the OpenAI call.
    //
    // Why: gpt-image-1.5 edit() takes 15-45 s. Without this write the
    // shot stays `pending` for that whole window, the polling UI shows
    // a "Pending" tile, and users (especially admins) think nothing is
    // happening. With this write, the next poll tick (≤5 s) flips the
    // tile to `Rendering…` (animated pulse) so progressive UX matches
    // the strict-sequential architecture.
    //
    // The count=0 check below is a cheap save: if the job was
    // cancelled in the narrow window between the TOCTOU re-read and
    // this write, the WHERE clause (`status='RUNNING'`) returns 0
    // affected rows and we bail BEFORE burning a $0.25 OpenAI call.
    //
    // Crash semantics: if the worker dies between this write and the
    // next persistShotPatch, the shot is left in `running` state. The
    // Redis lock TTL (90 s) still expires, allowing a retry to claim
    // it. The retry's TOCTOU re-read sees `running`, treats it like
    // pending (only `success` short-circuits at line 207), and
    // overwrites with the new outcome. So a stuck `running` is
    // self-healing.
    const runningPersist = await persistShotPatch(
      prisma,
      jobId,
      flatIndex,
      {
        status: "running",
        startedAt: new Date().toISOString(),
      },
      0, // no cost increment — image gen hasn't been billed yet
    );
    if (!runningPersist.updated) {
      logger.endStage(3, "success", {
        skipped: "job_cancelled_before_running_write",
      });
      return { status: "skipped", reason: "job_cancelled" };
    }

    // 4b. Generate the image.
    let genResult;
    try {
      genResult = await generateShotImage({
        prompt: targetShot.prompt,
        aspectRatio: targetShot.aspectRatio,
        referenceImageUrls,
        inputFidelity: "high",
        requestId: `${jobId}:${apartmentIndex}:${shotIndexInApartment}`,
      });
    } catch (err) {
      if (err instanceof ImageGenRateLimitError) {
        // Caller decides re-enqueue strategy; do NOT mark the shot
        // failed here — it should retry later.
        logger.endStage(3, "failed", { rate_limited: true }, "rate_limited");
        return {
          status: "failed",
          error: "rate_limited",
          costUsd: 0,
          kind: "rate_limited",
        };
      }
      if (err instanceof ImageGenProviderError) {
        // Permanent failure for this shot — mark it failed in DB so
        // the worker route can move on to the next pending shot.
        await persistShotPatch(
          prisma,
          jobId,
          flatIndex,
          {
            status: "failed",
            errorMessage: `provider:${err.kind}: ${err.message.slice(0, 500)}`,
            completedAt: new Date().toISOString(),
          },
          0,
        );
        logger.endStage(3, "failed", { kind: err.kind }, err.message);
        return {
          status: "failed",
          error: err.message,
          costUsd: 0,
          kind: "provider",
        };
      }
      throw err;
    }

    // 5. Upload to R2 with deterministic key.
    const r2Key = `briefs-shots-${jobId}-${apartmentIndex}-${shotIndexInApartment}.png`;
    const uploadedUrl = await uploadBase64ToR2(
      genResult.imageBase64,
      r2Key,
      "image/png",
    );
    if (!uploadedUrl || uploadedUrl.startsWith("data:")) {
      // R2 not configured — uploadBase64ToR2 returns the original
      // data URI as a graceful fallback. For Phase 4 production we
      // hard-fail rather than persisting a giant data: URL into the
      // shot record (it would inflate the row past JSONB practical
      // limits). Phase 5's PDF compile would also choke on data URIs.
      logger.endStage(3, "failed", undefined, "r2_unconfigured");
      return {
        status: "failed",
        error: "R2 not configured — cannot persist shot image",
        costUsd: 0,
        kind: "r2_upload",
      };
    }

    // 6. Atomic DB write — single shot field + cost increment in one
    //    statement, gated on status === RUNNING.
    const completedAt = new Date().toISOString();
    const persistResult = await persistShotPatch(
      prisma,
      jobId,
      flatIndex,
      {
        status: "success",
        imageUrl: uploadedUrl,
        errorMessage: null,
        costUsd: genResult.costUsd,
        completedAt,
      },
      genResult.costUsd,
    );
    if (!persistResult.updated) {
      // Job was cancelled between the lock acquire and the DB write.
      // The R2 object remains but is harmless (overwritten on regen
      // or swept by the cleanup cron).
      logger.endStage(3, "success", { skipped: "db_race_after_upload" });
      return { status: "skipped", reason: "job_cancelled" };
    }

    logger.recordCost(3, genResult.costUsd);
    logger.endStage(3, "success", {
      apartmentIndex,
      shotIndexInApartment,
      flatIndex,
      imageUrl: uploadedUrl,
      costUsd: genResult.costUsd,
      widthPx: genResult.widthPx,
      heightPx: genResult.heightPx,
    });

    return {
      status: "success",
      imageUrl: uploadedUrl,
      costUsd: genResult.costUsd,
      widthPx: genResult.widthPx,
      heightPx: genResult.heightPx,
    };
  } finally {
    await releaseShotLock(lock);
  }
}

// ─── Re-exports for callers ─────────────────────────────────────────

export { ImageGenRateLimitError, ImageGenProviderError } from "./providers/gpt-image";

// Type re-export for consumers (worker route, regenerate-shot route).
export type { Prisma };
