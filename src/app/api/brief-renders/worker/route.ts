/**
 * POST /api/brief-renders/worker
 *
 * QStash callback that runs the orchestrator. Mirrors VIP's worker
 * route — `maxDuration = 600`, signature-verified, returns 200 to
 * QStash regardless of orchestrator outcome (we don't want QStash to
 * retry on permanent errors; the orchestrator's outer try/catch
 * persists the FAILED status to the row, which the client sees via
 * polling).
 *
 * Signature is hard-required in production. The dev escape hatch is
 * `SKIP_QSTASH_SIG_VERIFY=true` — guarded against being set in prod.
 */

export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { verifyQstashSignature } from "@/lib/qstash";
import { runBriefRenderOrchestrator } from "@/features/brief-renders/services/brief-pipeline/orchestrator";

const BODY_SCHEMA = z.object({ jobId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // Dev escape hatch — explicit opt-in. Mirrors VIP's wording so the
  // production check is a hard fail, not a silent allow.
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

  // Run the orchestrator. Errors are persisted to the row by the
  // orchestrator's outer try/catch — we always return 200 so QStash
  // doesn't retry permanent failures.
  try {
    const result = await runBriefRenderOrchestrator({
      jobId: body.jobId,
      prisma,
    });
    return NextResponse.json({ jobId: body.jobId, status: result.status });
  } catch (err) {
    // Only `JobNotFoundError` and a handful of other defensive throws
    // bypass the orchestrator's catch. Surface a 200 anyway — there's
    // nothing useful for QStash to retry, and the client polls the row
    // directly to see the final state.
    const message =
      err instanceof Error ? err.message : "unknown worker error";
    return NextResponse.json({
      jobId: body.jobId,
      status: "FAILED",
      error: message.slice(0, 500),
    });
  }
}
