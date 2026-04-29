/**
 * POST /api/brief-renders/:jobId/admin-force-kick
 *
 * Admin-only emergency endpoint that bypasses QStash entirely. Calls
 * `runStage3ImageGen` synchronously for the next pending shot (or the
 * specified shot) and returns a detailed diagnostic envelope describing
 * exactly which gate fired.
 *
 * Why this exists:
 *   The normal post-approval flow is `approve → QStash → worker → stage-3`.
 *   When QStash silently fails (cloudflared tunnel dropped, signing keys
 *   wrong, NEXT_PUBLIC_APP_URL stale), the worker is never invoked and
 *   the job hangs at `currentStage="rendering"` with all 12 shots stuck
 *   on `pending` forever — no error, no retry (we use `retries: 0`).
 *
 *   This endpoint sidesteps QStash + signature verification so an admin
 *   can:
 *     1. Confirm the post-QStash code path works (proves the bug is
 *        QStash dispatch, not the renderer).
 *     2. Manually unstick a hung job by clicking through 12 times.
 *     3. After the first sync render, opportunistically re-enqueue via
 *        QStash for the rest — if QStash is healthy again, this resumes
 *        the normal sequential flow.
 *
 * Auth: admin only.
 *   • PLATFORM_ADMIN_EMAILS env allowlist, OR
 *   • session.user.role ∈ {PLATFORM_ADMIN, TEAM_ADMIN}.
 *
 * Body (all optional):
 *   {
 *     apartmentIndex?: number,
 *     shotIndexInApartment?: number,  // both must be set together
 *   }
 *   Omit both → picks first pending shot.
 *
 * Response:
 *   200 { ok, picked, gate, result, reEnqueue, costUsd, ... }
 *   401 unauthenticated
 *   403 not admin / not feature-flagged
 *   404 job not found
 *   409 job not in a kick-able state
 */

export const maxDuration = 180;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { scheduleBriefRenderRenderWorker } from "@/lib/qstash";
import { formatErrorResponse } from "@/lib/user-errors";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import { runStage3ImageGen } from "@/features/brief-renders/services/brief-pipeline/stage-3-image-gen";
import { createStageLogPersister } from "@/features/brief-renders/services/brief-pipeline/stage-log-store";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import type {
  BriefStageLogEntry,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Body schema ────────────────────────────────────────────────────

const BODY_SCHEMA = z
  .object({
    apartmentIndex: z.number().int().nonnegative().optional(),
    shotIndexInApartment: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (b) =>
      (b.apartmentIndex === undefined &&
        b.shotIndexInApartment === undefined) ||
      (b.apartmentIndex !== undefined && b.shotIndexInApartment !== undefined),
    {
      message:
        "apartmentIndex and shotIndexInApartment must both be set or both omitted",
    },
  );

// ─── Errors ─────────────────────────────────────────────────────────

const FORBIDDEN_ERROR = {
  title: "Forbidden",
  message: "Admin force-kick is only available to platform/team admins.",
  code: "BRIEF_RENDERS_ADMIN_FORBIDDEN",
} as const;

const FEATURE_OFF_ERROR = {
  title: "Feature not available",
  message: "Brief-to-Renders is not enabled for this account.",
  code: "BRIEF_RENDERS_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "Job not found",
  message: "Brief render job not found.",
  code: "BRIEF_RENDERS_NOT_FOUND",
} as const;

const WRONG_STATE_ERROR = {
  title: "Job not in a kick-able state",
  message:
    "Force kick only works while the job is RUNNING with currentStage=rendering and at least one pending shot.",
  code: "BRIEF_RENDERS_NOT_KICKABLE",
} as const;

const INVALID_BODY_ERROR = {
  title: "Invalid body",
  message: "Body must be empty or { apartmentIndex, shotIndexInApartment }.",
  code: "BRIEF_RENDERS_INVALID_BODY",
} as const;

// ─── Helpers ────────────────────────────────────────────────────────

function findFirstPendingShot(shots: ShotResult[]):
  | { apartmentIndex: number; shotIndexInApartment: number; flatIndex: number }
  | null {
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (
      s.status === "pending" &&
      s.apartmentIndex !== null &&
      s.apartmentIndex !== undefined
    ) {
      return {
        apartmentIndex: s.apartmentIndex,
        shotIndexInApartment: s.shotIndexInApartment,
        flatIndex: i,
      };
    }
  }
  return null;
}

function isAdmin(session: {
  user?: { email?: string | null; role?: string | null } | null;
} | null): boolean {
  const email = session?.user?.email ?? null;
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;
  return (
    isPlatformAdmin(email) ||
    role === "PLATFORM_ADMIN" ||
    role === "TEAM_ADMIN"
  );
}

// ─── Handler ────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email ?? null;

  if (!userId) {
    return NextResponse.json(
      { error: { title: "Unauthorized", message: "Sign in required.", code: "AUTH_001" } },
      { status: 401 },
    );
  }

  if (!shouldUserSeeBriefRenders(userEmail, userId)) {
    return NextResponse.json(formatErrorResponse(FEATURE_OFF_ERROR), {
      status: 403,
    });
  }

  if (!isAdmin(session)) {
    return NextResponse.json(formatErrorResponse(FORBIDDEN_ERROR), {
      status: 403,
    });
  }

  const { jobId } = await params;

  // Body parse — empty body is valid.
  let bodyParsed: z.infer<typeof BODY_SCHEMA> = {};
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const json = JSON.parse(text);
      const parsed = BODY_SCHEMA.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(formatErrorResponse(INVALID_BODY_ERROR), {
          status: 400,
        });
      }
      bodyParsed = parsed.data;
    }
  } catch {
    return NextResponse.json(formatErrorResponse(INVALID_BODY_ERROR), {
      status: 400,
    });
  }

  // Load job (admin can kick any user's job — debugging tool).
  const job = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      currentStage: true,
      shots: true,
      stageLog: true,
    },
  });
  if (!job) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  if (job.status !== "RUNNING") {
    return NextResponse.json(
      {
        ok: false,
        gate: "job_not_running",
        jobStatus: job.status,
        currentStage: job.currentStage,
        message: WRONG_STATE_ERROR.message,
      },
      { status: 409 },
    );
  }

  const shots = (job.shots as ShotResult[] | null) ?? [];

  // Resolve target shot.
  let target:
    | { apartmentIndex: number; shotIndexInApartment: number; flatIndex: number }
    | null;

  if (
    bodyParsed.apartmentIndex !== undefined &&
    bodyParsed.shotIndexInApartment !== undefined
  ) {
    const flat = shots.findIndex(
      (s) =>
        s.apartmentIndex === bodyParsed.apartmentIndex &&
        s.shotIndexInApartment === bodyParsed.shotIndexInApartment,
    );
    if (flat < 0) {
      return NextResponse.json(
        {
          ok: false,
          gate: "shot_not_found",
          message: `No shot at (${bodyParsed.apartmentIndex}, ${bodyParsed.shotIndexInApartment}).`,
        },
        { status: 404 },
      );
    }
    target = {
      apartmentIndex: bodyParsed.apartmentIndex,
      shotIndexInApartment: bodyParsed.shotIndexInApartment,
      flatIndex: flat,
    };
  } else {
    target = findFirstPendingShot(shots);
  }

  if (!target) {
    return NextResponse.json(
      {
        ok: false,
        gate: "no_pending_shots",
        jobStatus: job.status,
        currentStage: job.currentStage,
        message:
          "All shots are already terminal (success/failed). Nothing to kick.",
        shotCounts: countShotsByStatus(shots),
      },
      { status: 409 },
    );
  }

  // Wire logger so the stage timeline picks up the synchronous run.
  const persister = createStageLogPersister(jobId, prisma);
  const logger = new BriefRenderLogger(persister);
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefStageLogEntry[]);
  }

  console.log(
    `[brief-renders][admin-force-kick] jobId=${jobId} ` +
      `picked S${target.apartmentIndex + 1}.${target.shotIndexInApartment + 1} ` +
      `flatIndex=${target.flatIndex} actor=${userEmail ?? userId}`,
  );

  let result;
  try {
    result = await runStage3ImageGen({
      jobId,
      apartmentIndex: target.apartmentIndex,
      shotIndexInApartment: target.shotIndexInApartment,
      logger,
      prisma,
    });
  } catch (err) {
    await logger.flushPending();
    const message =
      err instanceof Error
        ? err.name && err.name !== "Error"
          ? `${err.name}: ${err.message}`
          : err.message
        : typeof err === "string"
          ? err
          : `Non-Error thrown: ${JSON.stringify(err).slice(0, 200)}`;
    console.error(
      `[brief-renders][admin-force-kick] runStage3 threw jobId=${jobId} err=${message}`,
    );
    return NextResponse.json(
      {
        ok: false,
        gate: "runStage3_threw",
        picked: target,
        error: message,
      },
      { status: 500 },
    );
  }

  await logger.flushPending();

  // Compute next-pending + opportunistic re-enqueue.
  const after = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: { status: true, shots: true, costUsd: true, currentStage: true },
  });
  const nextPending =
    after && after.status === "RUNNING"
      ? findFirstPendingShot((after.shots as ShotResult[] | null) ?? [])
      : null;

  const reEnqueue: {
    attempted: boolean;
    ok: boolean;
    messageId?: string;
    error?: string;
    workerUrl: string;
  } = {
    attempted: false,
    ok: false,
    workerUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/brief-renders/worker/render`,
  };

  if (result.status === "success" && nextPending) {
    reEnqueue.attempted = true;
    try {
      const messageId = await scheduleBriefRenderRenderWorker(jobId);
      reEnqueue.ok = true;
      reEnqueue.messageId = messageId;
      console.log(
        `[brief-renders][admin-force-kick] re-enqueue ok jobId=${jobId} messageId=${messageId}`,
      );
    } catch (err) {
      reEnqueue.ok = false;
      reEnqueue.error =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(
        `[brief-renders][admin-force-kick] re-enqueue FAILED jobId=${jobId} err=${reEnqueue.error}`,
      );
    }
  }

  console.log(
    `[brief-renders][admin-force-kick] result jobId=${jobId} ` +
      `status=${result.status} costUsd=${after?.costUsd ?? "?"}`,
  );

  return NextResponse.json({
    ok: result.status === "success",
    gate: "stage3_completed",
    picked: target,
    result,
    nextPending,
    reEnqueue,
    job: {
      status: after?.status ?? null,
      currentStage: after?.currentStage ?? null,
      costUsd: after?.costUsd ?? null,
      shotCounts: after
        ? countShotsByStatus((after.shots as ShotResult[] | null) ?? [])
        : null,
    },
  });
}

function countShotsByStatus(shots: ShotResult[]): Record<string, number> {
  const out: Record<string, number> = {
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
  };
  for (const s of shots) {
    out[s.status] = (out[s.status] ?? 0) + 1;
  }
  return out;
}
