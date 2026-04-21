/**
 * GET /api/vip-jobs/:jobId
 *
 * Returns current VipJob state for polling.
 * Auth required — user can only read their own jobs.
 * Cache-Control: no-store (must be fresh for 3s polling).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 },
    );
  }

  const { jobId } = await params;

  const job = await prisma.vipJob.findFirst({
    where: {
      id: jobId,
      userId: session.user.id, // ownership check — returns 404, not 403 (don't leak existence)
    },
    select: {
      id: true,
      requestId: true,
      prompt: true,
      status: true,
      progress: true,
      currentStage: true,
      costUsd: true,
      errorMessage: true,
      resultProject: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      // Phase 2.3 Workstream C: the image approval gate fields.
      intermediateImage: true,
      userApproval: true,
      pausedAt: true,
      pausedStage: true,
      // Phase 2.6: stage-by-stage log for the Pipeline Logs Panel UI.
      stageLog: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Only include resultProject when completed (avoid sending large JSON during polling)
  const result: Record<string, unknown> = {
    id: job.id,
    requestId: job.requestId,
    prompt: job.prompt,
    status: job.status,
    progress: job.progress,
    currentStage: job.currentStage,
    costUsd: job.costUsd,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    // Phase 2.6: stage log drives the Pipeline Logs Panel. Always
    // included so the panel can render mid-flight. Null when the
    // worker hasn't written any entries yet (QUEUED state).
    stageLog: job.stageLog ?? null,
  };

  if (job.status === "COMPLETED" && job.resultProject) {
    result.resultProject = job.resultProject;
  }

  // Phase 2.3 Workstream C: surface the approval-gate fields only when
  // the job is actually awaiting approval. The base64 image can be
  // several hundred KB, so we skip it once past the gate.
  if (job.status === "AWAITING_APPROVAL") {
    result.intermediateImage = job.intermediateImage ?? null;
    result.userApproval = job.userApproval ?? null;
    result.pausedAt = job.pausedAt?.toISOString() ?? null;
    result.pausedStage = job.pausedStage ?? null;
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
