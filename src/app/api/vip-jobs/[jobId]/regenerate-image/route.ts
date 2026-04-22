/**
 * POST /api/vip-jobs/[jobId]/regenerate-image
 *
 * Phase 2.3 Workstream C. User has rejected the Stage 2 image in the
 * approval gate and wants a fresh one. Re-runs Stage 2 only (~$0.034)
 * and stays in AWAITING_APPROVAL — full pipeline not yet triggered.
 *
 * Phase 2.6.1 hotfix — idempotent under concurrent clicks. Same race
 * model as /approve: a double-click used to cause a second POST to
 * enqueue a duplicate regenerate worker and double the Stage 2 cost.
 * Now a single atomic claim on userApproval="pending" → "regenerating"
 * gates the enqueue; losers get a 200 {already:true}.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleVipWorkerRegenerateImage } from "@/lib/qstash";

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

  // Atomic claim — flip pending→regenerating on the one row we own,
  // which excludes concurrent /approve clicks (they filter on
  // userApproval="pending" too, so only one of {approve, regen} wins).
  const claim = await prisma.vipJob.updateMany({
    where: {
      id: jobId,
      userId,
      status: "AWAITING_APPROVAL",
      userApproval: "pending",
    },
    data: { userApproval: "regenerating", progress: 20 },
  });

  if (claim.count === 0) {
    const current = await prisma.vipJob.findFirst({
      where: { id: jobId, userId },
      select: { status: true, userApproval: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (current.userApproval === "regenerating") {
      // A prior click already scheduled the regenerate — idempotent success.
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

  // We own the transition — schedule the regenerate worker.
  try {
    await scheduleVipWorkerRegenerateImage(jobId);
  } catch (err) {
    // Roll the claim back so the user can retry cleanly.
    await prisma.vipJob
      .updateMany({
        where: {
          id: jobId,
          userId,
          status: "AWAITING_APPROVAL",
          userApproval: "regenerating",
        },
        data: { userApproval: "pending" },
      })
      .catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to schedule regenerate: ${msg}` },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, jobId, status: "AWAITING_APPROVAL" });
}
