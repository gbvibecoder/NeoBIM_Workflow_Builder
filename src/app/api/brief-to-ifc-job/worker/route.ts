/**
 * POST /api/brief-to-ifc-job/worker
 *
 * QStash callback that advances a Brief-to-IFC v2 job by exactly one
 * stage. Mirrors the brief-renders worker route — signature-verified,
 * always returns 200 to QStash regardless of orchestrator outcome (we
 * never want QStash to retry: the orchestrator owns retries via atomic
 * claims + self-re-enqueue, and the client polls the row for the final
 * state).
 *
 * `maxDuration = 800` — Vercel Fluid Compute. Each invocation runs ONE
 * stage whose internal wall-clock cap is 540s; the extra headroom covers
 * brief download, DB writes, and the next-stage re-enqueue.
 *
 * Signature verification is hard-required in production. The dev escape
 * hatch is `SKIP_QSTASH_SIG_VERIFY=true`, guarded against being set in
 * prod (a hard throw, not a silent allow).
 */

export const maxDuration = 800;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { runBriefToIfcOrchestrator } from "@/features/ifc/services/brief-to-ifc-v2/job-orchestrator";

const BODY_SCHEMA = z.object({ jobId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

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

  // Run the orchestrator. Stage failures are persisted to the row by the
  // orchestrator itself; only an unexpected throw (e.g. DB unreachable)
  // escapes here — return 200 anyway so QStash doesn't retry, the client
  // polls the row directly.
  try {
    const result = await runBriefToIfcOrchestrator({
      jobId: body.jobId,
      prisma,
    });
    return NextResponse.json({
      jobId: result.jobId,
      status: result.status,
      ranStage: result.ranStage,
      outcome: result.outcome,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown worker error";
    console.error("[brief-to-ifc] worker uncaught error", {
      jobId: body.jobId,
      message,
    });
    return NextResponse.json({
      jobId: body.jobId,
      status: "FAILED",
      error: message.slice(0, 500),
    });
  }
}
