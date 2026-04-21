/**
 * POST /api/vip-jobs/worker
 *
 * Background worker called by QStash. Runs the full VIP pipeline
 * and updates VipJob row as each stage completes.
 *
 * maxDuration: 600 (10 min — plenty of headroom for ~73s pipeline).
 * QStash signature verification required (rejects unsigned requests).
 *
 * On crash/timeout: VipJob stays RUNNING. Phase 2.x cleanup task
 * marks stuck jobs as FAILED after 15 minutes (known issue).
 */

export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import { runVIPPipeline } from "@/features/floor-plan/lib/vip-pipeline/orchestrator";

const PIPELINE_TIMEOUT_MS = 550_000; // 550s safety margin vs Vercel's 600s

export async function POST(req: NextRequest) {
  // ── QStash signature verification ──
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // Phase 2.4 GA.3: explicit opt-in bypass (replaces implicit NODE_ENV check).
  // Hard-fails if SKIP_QSTASH_SIG_VERIFY=true leaks into production.
  const skipVerify = process.env.SKIP_QSTASH_SIG_VERIFY === "true";
  if (skipVerify && process.env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY: SKIP_QSTASH_SIG_VERIFY must not be true in production",
    );
  }
  if (!skipVerify) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { jobId: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { jobId } = body;
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  // ── Load job ──
  const job = await prisma.vipJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "QUEUED") {
    // Already running or completed — idempotent, don't re-process
    return NextResponse.json({ status: job.status, message: "Already processed" });
  }

  // ── Mark as RUNNING ──
  await prisma.vipJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    // ── Parse constraints ──
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    await updateJob(jobId, { progress: 5, currentStage: "parse" });
    const parseRes = await parseConstraints(job.prompt, apiKey);
    await updateJob(jobId, { progress: 10, currentStage: "parse" });

    // ── Run VIP pipeline with timeout protection ──
    const pipelinePromise = runVIPPipeline({
      prompt: job.prompt,
      parsedConstraints: parseRes.constraints,
      logContext: { requestId: job.requestId, userId: job.userId },
      onProgress: async (progress, stage) => {
        await updateJob(jobId, { progress, currentStage: stage });
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("VIP pipeline timeout (550s)")),
        PIPELINE_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([pipelinePromise, timeoutPromise]);

    if (result.success) {
      // ── SUCCESS ──
      const meta = result.project.metadata as unknown as Record<string, unknown>;
      const costUsd = typeof meta.generation_cost_usd === "number" ? meta.generation_cost_usd : 0;
      await prisma.vipJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          progress: 100,
          currentStage: "complete",
          resultProject: JSON.parse(JSON.stringify(result.project)),
          costUsd,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ status: "COMPLETED", qualityScore: result.qualityScore });
    }

    // ── FALL_THROUGH or FAILURE ──
    const errorMsg = result.error || "Pipeline failed";
    await prisma.vipJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ status: "FAILED", reason: errorMsg });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vip-worker] Job ${jobId} failed:`, message);

    await prisma.vipJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
    }).catch(() => {});

    return NextResponse.json({ status: "FAILED", reason: message }, { status: 500 });
  }
}

/** Fire-and-forget job update. Never throws. */
async function updateJob(
  jobId: string,
  data: { progress?: number; currentStage?: string; costUsd?: number },
): Promise<void> {
  try {
    await prisma.vipJob.update({ where: { id: jobId }, data });
  } catch (err) {
    console.warn(
      `[vip-worker] Job ${jobId} progress update failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
