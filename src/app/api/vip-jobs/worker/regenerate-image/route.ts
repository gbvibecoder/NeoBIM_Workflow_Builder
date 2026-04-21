/**
 * POST /api/vip-jobs/worker/regenerate-image
 *
 * Phase 2.3 Workstream C. QStash-triggered worker that re-runs Stage 2
 * only using the saved Stage 1 brief, then stores the new intermediate
 * state and keeps the job in AWAITING_APPROVAL for another user review.
 */

export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { runVIPPipelineRegenerateImage } from "@/features/floor-plan/lib/vip-pipeline/orchestrator-gated";
import type {
  Stage1Output,
  Stage2Output,
} from "@/features/floor-plan/lib/vip-pipeline/types";
import { parseConstraints } from "@/features/floor-plan/lib/structured-parser";

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
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { jobId } = body;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const job = await prisma.vipJob.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!job.intermediateBrief) {
    return NextResponse.json({ error: "Job has no intermediate state" }, { status: 400 });
  }

  const prior = job.intermediateBrief as unknown as IntermediateBrief;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    const parseRes = await parseConstraints(job.prompt, apiKey);

    const result = await runVIPPipelineRegenerateImage(
      prior.stage1Output,
      {
        prompt: job.prompt,
        parsedConstraints: parseRes.constraints,
        logContext: { requestId: job.requestId, userId: job.userId },
      },
      prior.stage1Ms,
      prior.stage1CostUsd,
    );

    if (!result.success) {
      await prisma.vipJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: result.error, completedAt: new Date() },
      });
      return NextResponse.json({ status: "FAILED", reason: result.error });
    }

    const nextIntermediate: IntermediateBrief = {
      stage1Output: result.stage1Output,
      stage2Output: result.stage2Output,
      stage1Ms: result.stage1Ms,
      stage2Ms: result.stage2Ms,
      stage1CostUsd: result.stage1CostUsd,
      stage2CostUsd: result.stage2CostUsd,
    };

    await prisma.vipJob.update({
      where: { id: jobId },
      data: {
        status: "AWAITING_APPROVAL",
        progress: 35,
        currentStage: "stage2",
        userApproval: "pending",
        intermediateBrief: JSON.parse(JSON.stringify(nextIntermediate)),
        intermediateImage: result.gptImageBase64,
        pausedAt: new Date(),
        pausedStage: 2,
      },
    });

    return NextResponse.json({ status: "AWAITING_APPROVAL", jobId });
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
