/**
 * POST /api/vip-jobs/[jobId]/approve
 *
 * Phase 2.3 Workstream C. User has reviewed the Stage 2 image in the
 * approval gate and wants to proceed with CAD extraction (Stages 3-7).
 *
 * Validates: session, ownership, VipJob exists in AWAITING_APPROVAL.
 * Side effects: enqueues QStash resume worker + updates VipJob row.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleVipWorkerResume } from "@/lib/qstash";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.vipJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== "AWAITING_APPROVAL") {
    return NextResponse.json(
      { error: `Job is ${job.status}, not AWAITING_APPROVAL` },
      { status: 400 },
    );
  }

  try {
    await scheduleVipWorkerResume(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to schedule resume: ${msg}` },
      { status: 503 },
    );
  }

  await prisma.vipJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", userApproval: "approved" },
  });

  return NextResponse.json({ ok: true, jobId, status: "RUNNING" });
}
