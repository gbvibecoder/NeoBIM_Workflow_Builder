/**
 * POST /api/brief-renders/:jobId/admin-retry-compile
 *
 * Admin-only emergency endpoint that re-runs Stage 4 (PDF compile)
 * synchronously, bypassing QStash. Mirrors `admin-force-kick` for the
 * compile stage.
 *
 * Why this exists:
 *   When the compile worker fails (e.g. a 12 MB PDF hitting the old
 *   5 MB R2 cap, R2 credentials drift, jspdf font load), the job sits
 *   in `RUNNING + currentStage="compiling"` indefinitely — `retries: 0`
 *   means QStash never re-fires. This endpoint lets an admin re-trigger
 *   the compile after the underlying issue is fixed (cap raised, env
 *   updated, etc.) without having to cancel + restart from scratch.
 *
 * Auth: admin only.
 *   • PLATFORM_ADMIN_EMAILS env allowlist, OR
 *   • session.user.role ∈ {PLATFORM_ADMIN, TEAM_ADMIN}.
 *
 * Body: empty.
 *
 * Response:
 *   200 { ok, gate, result, job }   — Stage 4 ran (success/failed/skipped)
 *   401 unauthenticated
 *   403 not admin / not feature-flagged
 *   404 job not found
 *   409 job not in a compile-able state
 */

export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { formatErrorResponse } from "@/lib/user-errors";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import { runStage4PdfCompile } from "@/features/brief-renders/services/brief-pipeline/stage-4-pdf-compile";
import { createStageLogPersister } from "@/features/brief-renders/services/brief-pipeline/stage-log-store";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import type { BriefStageLogEntry } from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Errors ─────────────────────────────────────────────────────────

const FORBIDDEN_ERROR = {
  title: "Forbidden",
  message: "Admin retry-compile is only available to platform/team admins.",
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

// ─── Helpers ────────────────────────────────────────────────────────

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
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email ?? null;

  if (!userId) {
    return NextResponse.json(
      {
        error: {
          title: "Unauthorized",
          message: "Sign in required.",
          code: "AUTH_001",
        },
      },
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

  // Stage 4 itself classifies readiness — RUNNING + (awaiting_compile |
  // compiling) and all 12 shots succeeded. Surface a clean 409 if the
  // job's nowhere near compile-able rather than burning a Stage 4
  // run that immediately exits.
  const isCompileable =
    job.status === "RUNNING" &&
    (job.currentStage === "awaiting_compile" ||
      job.currentStage === "compiling");
  if (!isCompileable) {
    return NextResponse.json(
      {
        ok: false,
        gate: "job_not_compileable",
        jobStatus: job.status,
        currentStage: job.currentStage,
        message:
          "Retry compile only works when status=RUNNING and currentStage is awaiting_compile or compiling.",
      },
      { status: 409 },
    );
  }

  // If previously stuck in `compiling` (worker died mid-compile),
  // revert to `awaiting_compile` so Stage 4's claim transition
  // succeeds. Conditional updateMany — won't touch a cancelled job.
  if (job.currentStage === "compiling") {
    await prisma.briefRenderJob.updateMany({
      where: { id: jobId, status: "RUNNING", currentStage: "compiling" },
      data: { currentStage: "awaiting_compile" },
    });
  }

  const persister = createStageLogPersister(jobId, prisma);
  const logger = new BriefRenderLogger(persister);
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefStageLogEntry[]);
  }

  console.log(
    `[brief-renders][admin-retry-compile] jobId=${jobId} actor=${userEmail ?? userId}`,
  );

  let result;
  try {
    result = await runStage4PdfCompile({ jobId, logger, prisma });
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
      `[brief-renders][admin-retry-compile] runStage4 threw jobId=${jobId} err=${message}`,
    );
    return NextResponse.json(
      {
        ok: false,
        gate: "runStage4_threw",
        error: message,
      },
      { status: 500 },
    );
  }

  await logger.flushPending();

  const after = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      currentStage: true,
      pdfUrl: true,
      progress: true,
      costUsd: true,
    },
  });

  console.log(
    `[brief-renders][admin-retry-compile] jobId=${jobId} result=${result.status}`,
  );

  return NextResponse.json({
    ok: result.status === "success",
    gate: "stage4_completed",
    result,
    job: {
      status: after?.status ?? null,
      currentStage: after?.currentStage ?? null,
      pdfUrl: after?.pdfUrl ?? null,
      progress: after?.progress ?? null,
      costUsd: after?.costUsd ?? null,
    },
  });
}
