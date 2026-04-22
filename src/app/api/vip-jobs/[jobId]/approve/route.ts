/**
 * POST /api/vip-jobs/[jobId]/approve
 *
 * Phase 2.3 Workstream C. User has reviewed the Stage 2 image in the
 * approval gate and wants to proceed with CAD extraction (Stages 3-7).
 *
 * Phase 2.6.1 hotfix — idempotent under concurrent clicks.
 *
 * The original implementation was a check-then-act (findUnique → check
 * status === "AWAITING_APPROVAL" → schedule QStash → update status to
 * RUNNING). That's non-atomic: any two concurrent requests (double-
 * click on the gate, two tabs, a fast React double-render) both pass
 * the first read, both schedule QStash, and only one wins the final
 * update — OR the second finds status=RUNNING on the first read and
 * returns 400 "Job is RUNNING, not AWAITING_APPROVAL" even though the
 * job is being approved correctly from the user's POV.
 *
 * Fix: claim the approval atomically via updateMany on the
 * userApproval="pending" row. Only the winner schedules QStash; losers
 * get an idempotent 200 {already:true}. If QStash fails after a
 * successful claim, roll the claim back so the user can retry cleanly.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleVipWorkerResume } from "@/lib/qstash";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Atomic claim — exactly one concurrent request flips pending→approved.
  const claim = await prisma.vipJob.updateMany({
    where: {
      id: jobId,
      userId,
      status: "AWAITING_APPROVAL",
      userApproval: "pending",
    },
    data: { userApproval: "approved" },
  });

  if (claim.count === 0) {
    // We didn't claim it. Three reasons, in priority order:
    //   1. Job doesn't exist or isn't ours → 404.
    //   2. Someone already approved (userApproval="approved") → 200 idempotent.
    //   3. Job is in a wrong state (QUEUED / RUNNING with userApproval != pending,
    //      COMPLETED, FAILED, regenerating) → 400 with the actual status.
    const current = await prisma.vipJob.findFirst({
      where: { id: jobId, userId },
      select: { status: true, userApproval: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (current.userApproval === "approved") {
      return NextResponse.json({
        ok: true,
        jobId,
        status: current.status,
        already: true,
      });
    }
    return NextResponse.json(
      { error: `Job is ${current.status}, not AWAITING_APPROVAL` },
      { status: 400 },
    );
  }

  // We own the transition. Schedule the resume worker FIRST so we never
  // flip status to RUNNING without a worker queued.
  try {
    await scheduleVipWorkerResume(jobId);
  } catch (err) {
    // Roll back the approval claim so a retry can try again cleanly.
    // Guarded by the same (jobId, userApproval=approved, status=AWAITING_APPROVAL)
    // predicate to avoid racing a successful parallel attempt.
    await prisma.vipJob
      .updateMany({
        where: {
          id: jobId,
          userId,
          status: "AWAITING_APPROVAL",
          userApproval: "approved",
        },
        data: { userApproval: "pending" },
      })
      .catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to schedule resume: ${msg}` },
      { status: 503 },
    );
  }

  // Schedule succeeded. Flip status to RUNNING.
  await prisma.vipJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" },
  });

  return NextResponse.json({ ok: true, jobId, status: "RUNNING" });
}
