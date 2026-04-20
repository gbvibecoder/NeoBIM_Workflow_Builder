/**
 * POST /api/vip-jobs
 *
 * Creates a VipJob and schedules the QStash background worker.
 * Returns immediately (<1s) with jobId for polling.
 *
 * Gated by PIPELINE_VIP_JOBS feature flag.
 * Rate limited: max 5 active jobs per user (QUEUED + RUNNING).
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { scheduleVipWorker } from "@/lib/qstash";

export async function POST(req: NextRequest) {
  // Feature flag gate
  if (process.env.PIPELINE_VIP_JOBS !== "true") {
    return NextResponse.json(
      { error: "VIP job queue is not enabled" },
      { status: 503 },
    );
  }

  // Auth
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 },
    );
  }
  const userId = session.user.id;

  // Parse body
  const MAX_PROMPT_LENGTH = 2000;
  const body = await req.json();
  const rawPrompt = body.prompt;
  if (!rawPrompt || typeof rawPrompt !== "string" || !rawPrompt.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const prompt = rawPrompt.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt too long (${prompt.length} chars, max ${MAX_PROMPT_LENGTH})` },
      { status: 400 },
    );
  }

  // Rate limit: max 5 active jobs
  const activeCount = await prisma.vipJob.count({
    where: {
      userId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (activeCount >= 5) {
    return NextResponse.json(
      { error: "Max 5 concurrent VIP jobs. Wait for existing jobs to complete." },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  }

  // Create job
  const requestId = randomUUID();
  const job = await prisma.vipJob.create({
    data: {
      userId,
      requestId,
      prompt,
      status: "QUEUED",
    },
  });

  // Schedule QStash worker (fire-and-forget — job exists even if QStash fails)
  try {
    await scheduleVipWorker(job.id);
  } catch (err) {
    console.error("[vip-jobs] QStash schedule failed:", err);
    // Mark as failed so it doesn't stay QUEUED forever
    await prisma.vipJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: "Failed to schedule worker" },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to schedule job. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    jobId: job.id,
    requestId: job.requestId,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
  });
}
