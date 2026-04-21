/**
 * POST /api/vip-jobs/worker/resume
 *
 * Phase 2.3 Workstream C. QStash-triggered worker that picks up a
 * paused VipJob (AWAITING_APPROVAL → approved → RUNNING) and executes
 * Stages 3-7 using the saved intermediate state.
 *
 * The originating API route (/api/vip-jobs/[id]/approve) has already
 * flipped status to RUNNING and userApproval to "approved" before
 * this QStash message fires.
 */

export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";
import { runVIPPipelinePhaseB } from "@/features/floor-plan/lib/vip-pipeline/orchestrator-gated";
import {
  createStageLogPersister,
  readStageLog,
} from "@/features/floor-plan/lib/vip-pipeline/stage-log-store";
import type {
  Stage1Output,
  Stage2Output,
} from "@/features/floor-plan/lib/vip-pipeline/types";

const PIPELINE_TIMEOUT_MS = 550_000;

interface IntermediateBrief {
  stage1Output: Stage1Output;
  stage2Output: Stage2Output;
  stage1Ms: number;
  stage2Ms: number;
  stage1CostUsd: number;
  stage2CostUsd: number;
}

export async function POST(req: NextRequest) {
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

  const job = await prisma.vipJob.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!job.intermediateBrief) {
    return NextResponse.json({ error: "Job has no intermediate state" }, { status: 400 });
  }

  const intermediateBrief = job.intermediateBrief as unknown as IntermediateBrief;
  const intermediate = {
    success: true as const,
    paused: true as const,
    stage1Output: intermediateBrief.stage1Output,
    stage2Output: intermediateBrief.stage2Output,
    gptImageBase64:
      intermediateBrief.stage2Output.images.find((i) => i.model === "gpt-image-1.5")?.base64 ?? "",
    stage1Ms: intermediateBrief.stage1Ms,
    stage2Ms: intermediateBrief.stage2Ms,
    stage1CostUsd: intermediateBrief.stage1CostUsd,
    stage2CostUsd: intermediateBrief.stage2CostUsd,
  };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const parseRes = await parseConstraints(job.prompt, apiKey);

    const pipelinePromise = runVIPPipelinePhaseB({
      intermediate,
      config: {
        prompt: job.prompt,
        parsedConstraints: parseRes.constraints,
        logContext: { requestId: job.requestId, userId: job.userId },
        onProgress: async (progress, stage) => {
          await prisma.vipJob
            .update({ where: { id: jobId }, data: { progress, currentStage: stage } })
            .catch(() => {});
        },
        // Phase 2.6: carry over Phase A's stage log so Stage 3-7 entries
        // extend the timeline instead of overwriting it, and keep the
        // DB column in sync as new stages complete.
        onStageLog: createStageLogPersister(jobId),
        existingStageLog: readStageLog(job.stageLog as unknown),
      },
      startMs: Date.now() - intermediateBrief.stage1Ms - intermediateBrief.stage2Ms,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("VIP resume timeout (550s)")), PIPELINE_TIMEOUT_MS),
    );
    const result = await Promise.race([pipelinePromise, timeoutPromise]);

    if (result.success) {
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

    const errorMsg = result.error || "Pipeline failed";
    await prisma.vipJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: errorMsg, completedAt: new Date() },
    });
    return NextResponse.json({ status: "FAILED", reason: errorMsg });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.vipJob
      .update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: message.slice(0, 1000), completedAt: new Date() },
      })
      .catch(() => {});
    return NextResponse.json({ status: "FAILED", reason: message }, { status: 500 });
  }
}
