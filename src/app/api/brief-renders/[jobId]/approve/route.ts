/**
 * POST /api/brief-renders/:jobId/approve
 *
 * Flips a job from `AWAITING_APPROVAL` to `RUNNING` so the render
 * worker can pick it up. Phase 4 wires the QStash dispatch:
 *
 *   1. Atomic status flip (`updateMany` with status filter).
 *   2. On success → schedule the render worker.
 *   3. On dispatch failure → atomic revert back to AWAITING_APPROVAL
 *      (status filter prevents reverting a concurrently-cancelled job)
 *      and 503 to the client.
 *
 * Idempotency: a second POST after status has flipped to RUNNING
 * returns 409, NOT 200. This is a deliberate "loud" semantic — we
 * never want a silent double-approve to mask a UI race.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleBriefRenderRenderWorker } from "@/lib/qstash";
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

const NOT_AWAITING_APPROVAL_ERROR = {
  title: "Cannot approve",
  message:
    "This job is not awaiting approval. It may have completed, failed, been cancelled, or already been approved.",
  code: "BRIEF_RENDERS_NOT_AWAITING_APPROVAL",
} as const;

const QSTASH_FAILED_ERROR = {
  title: "Failed to start image generation",
  message:
    "We couldn't schedule the render worker. The approval has been reverted; please try again in a moment.",
  code: "BRIEF_RENDERS_QSTASH_FAILED",
} as const;

export async function POST(
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

  const existing = await prisma.briefRenderJob.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  // Atomic transition AWAITING_APPROVAL → RUNNING. The conditional
  // status guard catches both already-approved and concurrent-cancel
  // races — both surface as 409 here.
  const result = await prisma.briefRenderJob.updateMany({
    where: { id: jobId, userId, status: "AWAITING_APPROVAL" },
    data: {
      status: "RUNNING",
      userApproval: "approved",
      currentStage: "rendering",
      progress: 35,
    },
  });

  if (result.count === 0) {
    return NextResponse.json(
      formatErrorResponse(NOT_AWAITING_APPROVAL_ERROR),
      { status: 409 },
    );
  }

  // Phase 4: dispatch the render worker. On dispatch failure, revert
  // the status flip so the user can retry — the conditional revert
  // (still RUNNING with userApproval="approved") prevents racing with
  // a concurrent cancel that already moved past RUNNING.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  console.log(
    `[brief-renders][approve] dispatching render worker jobId=${jobId} url=${appUrl}/api/brief-renders/worker/render`,
  );
  try {
    const messageId = await scheduleBriefRenderRenderWorker(jobId);
    console.log(
      `[brief-renders][approve] QStash dispatch ok jobId=${jobId} messageId=${messageId}`,
    );
  } catch (err) {
    const errMessage =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(
      `[brief-renders][approve] QStash dispatch FAILED jobId=${jobId} err=${errMessage}`,
    );
    await prisma.briefRenderJob.updateMany({
      where: { id: jobId, status: "RUNNING", userApproval: "approved" },
      data: {
        status: "AWAITING_APPROVAL",
        userApproval: "pending",
        currentStage: "Awaiting approval",
        progress: 30,
      },
    });
    return NextResponse.json(formatErrorResponse(QSTASH_FAILED_ERROR), {
      status: 503,
    });
  }

  const job = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      userApproval: true,
      currentStage: true,
      progress: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    id: job?.id ?? jobId,
    status: job?.status ?? "RUNNING",
    userApproval: job?.userApproval ?? "approved",
    currentStage: job?.currentStage ?? null,
    progress: job?.progress ?? 35,
    updatedAt: job?.updatedAt?.toISOString() ?? new Date().toISOString(),
  });
}
