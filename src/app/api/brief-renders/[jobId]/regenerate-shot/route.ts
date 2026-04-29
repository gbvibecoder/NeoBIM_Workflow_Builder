/**
 * POST /api/brief-renders/:jobId/regenerate-shot
 *
 * Reset a single completed-or-awaiting-compile shot back to `pending`
 * and dispatch the render worker against it. Body:
 * `{ apartmentIndex, shotIndexInApartment }`.
 *
 * Pre-conditions:
 *   • Job belongs to the requesting user (404 on mismatch).
 *   • Job status is `RUNNING` with `currentStage="awaiting_compile"`
 *     OR `COMPLETED`. Anything else → 409.
 *   • Specified shot exists in `job.shots[]` (404 otherwise).
 *
 * Action:
 *   1. Reset the shot's status to `pending` and clear `imageUrl` /
 *      `errorMessage` / `completedAt` via atomic `jsonb_set`.
 *   2. If the job was `COMPLETED`, revert to `RUNNING` with
 *      `currentStage="awaiting_compile"` (Phase 5's compile worker
 *      will re-trigger when it sees a pending shot post-compile).
 *   3. Dispatch the render worker, targeting the specific shot.
 *
 * Idempotency: optional `Idempotency-Key` header. The hash of
 * `{userId}:{jobId}:{ai}:{si}:{key}` keys a 1-hour Redis cache; repeat
 * calls return the cached response.
 *
 * Rate limit: 10 regenerations per user per hour.
 */

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redis, redisConfigured } from "@/lib/rate-limit";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { scheduleBriefRenderRenderWorker } from "@/lib/qstash";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import type { ShotResult } from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Constants ──────────────────────────────────────────────────────

const REGENERATE_RATE_LIMIT_PER_HOUR = 10;
const IDEMPOTENCY_CACHE_TTL_SECONDS = 3600;
const IDEMPOTENCY_KEY_PREFIX = "briefrenders:regen-shot:";

const AWAITING_COMPILE_STAGE = "awaiting_compile";

// ─── Body schema ────────────────────────────────────────────────────

const BODY_SCHEMA = z
  .object({
    apartmentIndex: z.number().int().nonnegative(),
    shotIndexInApartment: z.number().int().nonnegative(),
  })
  .strict();

// ─── Errors ─────────────────────────────────────────────────────────

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "Brief-to-Renders is not available for your account.",
  code: "BRIEF_RENDERS_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "Job or shot not found",
  message: "The brief render job or shot was not found.",
  code: "BRIEF_RENDERS_NOT_FOUND",
} as const;

const WRONG_STATUS_ERROR = {
  title: "Cannot regenerate now",
  message:
    "Shots can only be regenerated once all renders have completed. Please wait for the active job to finish.",
  code: "BRIEF_RENDERS_REGEN_WRONG_STATUS",
} as const;

const RATE_LIMITED_ERROR = {
  title: "Too many regenerations",
  message: "You can regenerate up to 10 shots per hour. Please wait and try again.",
  code: "RATE_001",
} as const;

const QSTASH_FAILED = {
  title: "Failed to schedule regeneration",
  message:
    "We couldn't schedule the render worker. Please try again in a moment.",
  code: "BRIEF_RENDERS_QSTASH_FAILED",
} as const;

// ─── Helpers ────────────────────────────────────────────────────────

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

function deriveIdempotencyCacheKey(
  userId: string,
  jobId: string,
  apartmentIndex: number,
  shotIndexInApartment: number,
  idempotencyKey: string,
): string {
  const hash = createHash("sha256")
    .update(
      `${userId}::${jobId}::${apartmentIndex}::${shotIndexInApartment}::${idempotencyKey}`,
    )
    .digest("hex");
  return `${IDEMPOTENCY_KEY_PREFIX}${hash}`;
}

async function readIdempotencyCache(
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  if (!redisConfigured) return null;
  try {
    const cached = await redis.get<Record<string, unknown>>(cacheKey);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function writeIdempotencyCache(
  cacheKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!redisConfigured) return;
  try {
    await redis.set(cacheKey, payload, {
      ex: IDEMPOTENCY_CACHE_TTL_SECONDS,
    });
  } catch {
    // Idempotency cache is best-effort.
  }
}

/**
 * Atomically reset the targeted shot to `pending` + (when needed)
 * revert the job from COMPLETED to RUNNING+awaiting_compile in a
 * single statement. The status filter on the WHERE clause prevents
 * mutating already-cancelled rows.
 */
async function resetShotForRegeneration(
  jobId: string,
  flatShotIndex: number,
  wasCompleted: boolean,
): Promise<{ updated: boolean }> {
  const indexStr = String(flatShotIndex);
  const patchJson = JSON.stringify({
    status: "pending",
    imageUrl: null,
    errorMessage: null,
    completedAt: null,
    startedAt: null,
  });

  if (wasCompleted) {
    // Column names MUST be double-quoted: Prisma stores these as
    // case-sensitive camelCase ("currentStage", "completedAt",
    // "pdfUrl", "updatedAt"). Unquoted identifiers fold to lowercase
    // and resolve to non-existent columns (Postgres error 42703).
    //
    // Phase 5: also clear "pdfUrl" so a polling client doesn't see a
    // stale download link that points at the pre-regen PDF. Phase 5's
    // compile worker will write a fresh URL when the regen flow re-
    // enters awaiting_compile.
    const affected = await prisma.$executeRaw`
      UPDATE brief_render_jobs
      SET shots = jsonb_set(
            shots,
            ARRAY[${indexStr}]::text[],
            (shots->${flatShotIndex}::int) || ${patchJson}::jsonb
          ),
          status = 'RUNNING',
          "currentStage" = ${AWAITING_COMPILE_STAGE},
          "completedAt" = NULL,
          "pdfUrl" = NULL,
          "updatedAt" = NOW()
      WHERE id = ${jobId} AND status IN ('COMPLETED', 'RUNNING')
    `;
    return { updated: affected > 0 };
  }

  const affected = await prisma.$executeRaw`
    UPDATE brief_render_jobs
    SET shots = jsonb_set(
          shots,
          ARRAY[${indexStr}]::text[],
          (shots->${flatShotIndex}::int) || ${patchJson}::jsonb
        ),
        "updatedAt" = NOW()
    WHERE id = ${jobId} AND status = 'RUNNING'
  `;
  return { updated: affected > 0 };
}

// ─── Main handler ───────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  if (!shouldUserSeeBriefRenders(userEmail, userId)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const { jobId } = await params;

  // Body validation.
  let body: z.infer<typeof BODY_SCHEMA>;
  try {
    const json = await req.json();
    const parsed = BODY_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
        status: 400,
      });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  // Rate limit.
  const rl = await checkEndpointRateLimit(
    userId,
    "brief-renders-regen-shot",
    REGENERATE_RATE_LIMIT_PER_HOUR,
    "1 h",
  );
  if (!rl.success) {
    return NextResponse.json(formatErrorResponse(RATE_LIMITED_ERROR), {
      status: 429,
    });
  }

  // Idempotency cache check.
  const idempotencyKey = req.headers.get("idempotency-key");
  const cacheKey = idempotencyKey
    ? deriveIdempotencyCacheKey(
        userId,
        jobId,
        body.apartmentIndex,
        body.shotIndexInApartment,
        idempotencyKey,
      )
    : null;
  if (cacheKey) {
    const cached = await readIdempotencyCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }
  }

  // Ownership + status precondition. findFirst with userId scoping
  // returns 404-friendly null for foreign jobs.
  const job = await prisma.briefRenderJob.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true, currentStage: true, shots: true },
  });
  if (!job) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  const isRegeneratable =
    (job.status === "RUNNING" && job.currentStage === AWAITING_COMPILE_STAGE) ||
    job.status === "COMPLETED";
  if (!isRegeneratable) {
    return NextResponse.json(formatErrorResponse(WRONG_STATUS_ERROR), {
      status: 409,
    });
  }

  // Locate the shot.
  const shots = (job.shots as ShotResult[] | null) ?? [];
  const flatIndex = findFlatShotIndex(
    shots,
    body.apartmentIndex,
    body.shotIndexInApartment,
  );
  if (flatIndex < 0) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  const wasCompleted = job.status === "COMPLETED";
  const resetResult = await resetShotForRegeneration(
    jobId,
    flatIndex,
    wasCompleted,
  );
  if (!resetResult.updated) {
    // Race — job status changed between the precondition check and
    // the atomic reset. Surface as 409 so the client sees a clean
    // failure mode rather than a confusing partial regen.
    return NextResponse.json(formatErrorResponse(WRONG_STATUS_ERROR), {
      status: 409,
    });
  }

  // Dispatch the render worker for this exact shot.
  try {
    await scheduleBriefRenderRenderWorker(jobId, {
      apartmentIndex: body.apartmentIndex,
      shotIndexInApartment: body.shotIndexInApartment,
    });
  } catch {
    // QStash unreachable — we accept the reset (the shot is now in a
    // pending state) and surface a 503. A future cron sweep can pick
    // up orphan-pending shots; Phase 4 leaves that to Phase 6.
    return NextResponse.json(formatErrorResponse(QSTASH_FAILED), {
      status: 503,
    });
  }

  // Success response — cache for idempotency replay if a key was given.
  const response = {
    jobId,
    apartmentIndex: body.apartmentIndex,
    shotIndexInApartment: body.shotIndexInApartment,
    status: "regeneration_dispatched",
  };
  if (cacheKey) {
    await writeIdempotencyCache(cacheKey, response);
  }
  return NextResponse.json(response, { status: 200 });
}
