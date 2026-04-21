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
import { runVIPPipelinePhaseA } from "@/features/floor-plan/lib/vip-pipeline/orchestrator-gated";

const PIPELINE_TIMEOUT_MS = 550_000; // 550s safety margin vs Vercel's 600s
/** Phase 2.3 Workstream C: feature flag for the image approval gate. */
const APPROVAL_GATE_ENABLED = process.env.PIPELINE_VIP_APPROVAL_GATE === "true";

export async function POST(req: NextRequest) {
  // ── QStash signature verification ──
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // In dev mode without QStash, allow unsigned requests from localhost
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev) {
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

    // ── Phase 2.3 Workstream C: image approval gate ──
    // When the feature flag is on, run Phase A only (Stages 1-2) and
    // pause for user approval. The user later hits /api/vip-jobs/[id]/approve
    // which enqueues /api/vip-jobs/worker/resume to run Stages 3-7.
    if (APPROVAL_GATE_ENABLED) {
      const phaseA = await runVIPPipelinePhaseA({
        prompt: job.prompt,
        parsedConstraints: parseRes.constraints,
        logContext: { requestId: job.requestId, userId: job.userId },
        onProgress: async (progress, stage) => {
          await updateJob(jobId, { progress, currentStage: stage });
        },
      });

      if (!phaseA.success) {
        await prisma.vipJob.update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            errorMessage: phaseA.error,
            completedAt: new Date(),
          },
        });
        return NextResponse.json({ status: "FAILED", reason: phaseA.error });
      }

      const intermediatePayload = {
        stage1Output: phaseA.stage1Output,
        stage2Output: phaseA.stage2Output,
        stage1Ms: phaseA.stage1Ms,
        stage2Ms: phaseA.stage2Ms,
        stage1CostUsd: phaseA.stage1CostUsd,
        stage2CostUsd: phaseA.stage2CostUsd,
      };

      await prisma.vipJob.update({
        where: { id: jobId },
        data: {
          status: "AWAITING_APPROVAL",
          progress: 35,
          currentStage: "awaiting-approval",
          intermediateBrief: JSON.parse(JSON.stringify(intermediatePayload)),
          intermediateImage: phaseA.gptImageBase64,
          userApproval: "pending",
          pausedAt: new Date(),
          pausedStage: 2,
        },
      });

      return NextResponse.json({ status: "AWAITING_APPROVAL", jobId });
    }

    // ── Legacy path: run full pipeline monolithically (no gate) ──
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
