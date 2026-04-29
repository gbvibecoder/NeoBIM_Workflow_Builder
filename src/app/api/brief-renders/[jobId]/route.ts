/**
 * Per-job endpoints.
 *
 *   GET    /api/brief-renders/:jobId  — full job state for polling.
 *   DELETE /api/brief-renders/:jobId  — cancel a non-terminal job.
 *
 * Authorization:
 *   • 401 when unauthenticated.
 *   • 403 when canary is off (rare — typically caught at job creation).
 *   • 404 when the job belongs to another user (we deliberately return
 *     404 not 403 so an attacker can't probe for job IDs).
 *
 * `Cache-Control: no-store` on GET because the polling cadence is
 * 5–15 s and caching would mask state transitions.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "Brief-to-Renders is not available for your account.",
  code: "BRIEF_RENDERS_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "Job not found",
  message: "Brief render job not found.",
  code: "BRIEF_RENDERS_NOT_FOUND",
} as const;

const ALREADY_TERMINAL_ERROR = {
  title: "Job already finished",
  message: "This job has already completed, failed, or been cancelled.",
  code: "BRIEF_RENDERS_ALREADY_TERMINAL",
} as const;

// ─── GET ────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
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
  const job = await prisma.briefRenderJob.findFirst({
    where: { id: jobId, userId },
    select: {
      id: true,
      requestId: true,
      briefUrl: true,
      status: true,
      progress: true,
      currentStage: true,
      specResult: true,
      shots: true,
      pdfUrl: true,
      errorMessage: true,
      costUsd: true,
      startedAt: true,
      completedAt: true,
      pausedAt: true,
      userApproval: true,
      stageLog: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!job) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  return NextResponse.json(
    {
      id: job.id,
      requestId: job.requestId,
      briefUrl: job.briefUrl,
      status: job.status,
      progress: job.progress,
      currentStage: job.currentStage,
      // Heavy payloads — needed for the AWAITING_APPROVAL gate UI. Total
      // size for a 12-shot run is ~50 KB; acceptable on a 5-15s cadence.
      specResult: job.specResult ?? null,
      shots: job.shots ?? null,
      pdfUrl: job.pdfUrl ?? null,
      errorMessage: job.errorMessage,
      costUsd: job.costUsd,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      pausedAt: job.pausedAt?.toISOString() ?? null,
      userApproval: job.userApproval,
      stageLog: job.stageLog ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ─── DELETE ─────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
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

  // Ownership pre-check. Returning 404 (not 403) on mismatch matches
  // the GET semantics so attackers can't enumerate IDs.
  const existing = await prisma.briefRenderJob.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  // Atomic conditional cancel. Filtering by current status prevents
  // racing with concurrent worker completions.
  const result = await prisma.briefRenderJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"] },
    },
    data: {
      status: "CANCELLED",
      userApproval: null,
      completedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json(formatErrorResponse(ALREADY_TERMINAL_ERROR), {
      status: 409,
    });
  }

  // Refetch for response payload.
  const job = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      completedAt: true,
    },
  });

  return NextResponse.json({
    id: job?.id ?? jobId,
    status: job?.status ?? "CANCELLED",
    completedAt: job?.completedAt?.toISOString() ?? null,
  });
}
