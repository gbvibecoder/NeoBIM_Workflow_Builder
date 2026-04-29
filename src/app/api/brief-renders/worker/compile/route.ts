/**
 * POST /api/brief-renders/worker/compile
 *
 * QStash callback that runs Stage 4 (editorial PDF compile). One
 * invocation produces the entire PDF — no per-shot batching here, the
 * shots have all been rendered by Phase 4 and live as R2 URLs on
 * `BriefRenderJob.shots[]`.
 *
 * Mirrors `worker/render/route.ts` for auth + signature + body shape.
 * `maxDuration = 300`: PDF render + 12 R2 image fetches + jspdf assembly
 * fits comfortably in 60-180 s; 300 s leaves headroom without being
 * wasteful.
 *
 * Idempotency: Stage 4 is safe to re-invoke for the same jobId — the
 * deterministic R2 key overwrites in place; the conditional terminal
 * flip races but only one wins.
 */

export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import { runStage4PdfCompile } from "@/features/brief-renders/services/brief-pipeline/stage-4-pdf-compile";
import { createStageLogPersister } from "@/features/brief-renders/services/brief-pipeline/stage-log-store";
import type { BriefStageLogEntry } from "@/features/brief-renders/services/brief-pipeline/types";

const BODY_SCHEMA = z.object({ jobId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // Production-hard signature check; explicit dev opt-out.
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
    body = BODY_SCHEMA.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Load — fail fast on missing job.
  const job = await prisma.briefRenderJob.findUnique({
    where: { id: body.jobId },
    select: { id: true, status: true, currentStage: true, stageLog: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Status guard — accept RUNNING + (awaiting_compile | compiling).
  // Any other state → idempotent terminal exit (200 OK, no work).
  if (
    job.status !== "RUNNING" ||
    (job.currentStage !== "awaiting_compile" &&
      job.currentStage !== "compiling")
  ) {
    return NextResponse.json({
      jobId: body.jobId,
      status: job.status,
      currentStage: job.currentStage,
      message: "Job is not ready for compile; no work performed.",
    });
  }

  // Stage logger seeded from existing log so events append rather than
  // replace. Persister writes after every event for client polling.
  const persister = createStageLogPersister(body.jobId, prisma);
  const logger = new BriefRenderLogger(persister);
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefStageLogEntry[]);
  }

  // Run Stage 4. The orchestrator persists its own stage events.
  const result = await runStage4PdfCompile({
    jobId: body.jobId,
    logger,
    prisma,
  });

  switch (result.status) {
    case "success":
      return NextResponse.json({
        jobId: body.jobId,
        status: "COMPLETED",
        pdfUrl: result.pdfUrl,
        pageCount: result.pageCount,
        pdfSizeBytes: result.pdfSizeBytes,
      });
    case "skipped":
      return NextResponse.json({
        jobId: body.jobId,
        status: "skipped",
        reason: result.reason,
      });
    case "failed":
      // 500 lets QStash retry (up to its configured cap). The
      // orchestrator left the job in `compiling` with the failure
      // recorded in the stage log.
      return NextResponse.json(
        { jobId: body.jobId, status: "failed", error: result.error },
        { status: 500 },
      );
  }
}
