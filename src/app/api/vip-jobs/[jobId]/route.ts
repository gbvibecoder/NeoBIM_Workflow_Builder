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
  };

  if (job.status === "COMPLETED" && job.resultProject) {
    result.resultProject = job.resultProject;
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
