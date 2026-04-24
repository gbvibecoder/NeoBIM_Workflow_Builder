/**
 * QStash-triggered worker for the VideoJob background pipeline.
 *
 * This route is NOT user-facing. It's only invoked by QStash with a signed
 * POST body. The signature is the only auth — no session cookie check.
 *
 * Middleware (middleware.ts) already excludes /api/* from NextAuth gating,
 * so no additional bypass configuration is needed.
 *
 * On success → return 200 { ok, terminal, status }. QStash considers the
 * delivery complete.
 * On failure → return 500. QStash will retry per its own retry policy
 * (configured via `retries` in publishJSON). Idempotency in advanceVideoJob
 * guarantees duplicate deliveries are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyQstashSignature } from "@/lib/qstash";
import { advanceVideoJob } from "@/features/3d-render/services/video-job-service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
/** Vercel Pro function ceiling. One advance cycle must fit comfortably under this. */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const signature = req.headers.get("upstash-signature");
  const bodyText = await req.text();

  const valid = await verifyQstashSignature(signature, bodyText);
  if (!valid) {
    logger.warn("[VIDEO_WORKER] rejected — invalid or missing QStash signature");
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401 },
    );
  }

  let payload: { videoJobId?: unknown };
  try {
    payload = JSON.parse(bodyText) as { videoJobId?: unknown };
  } catch {
    return NextResponse.json(
      { error: "malformed body" },
      { status: 400 },
    );
  }

  const videoJobId = typeof payload.videoJobId === "string" ? payload.videoJobId : null;
  if (!videoJobId) {
    return NextResponse.json(
      { error: "videoJobId required" },
      { status: 400 },
    );
  }

  try {
    const result = await advanceVideoJob(videoJobId);
    return NextResponse.json({
      ok: true,
      terminal: result.terminal,
      status: result.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[VIDEO_WORKER] advanceVideoJob threw", {
      videoJobId,
      err: msg,
    });
    // 500 → QStash retries. The advance function is idempotent so a retry
    // won't double-persist.
    return NextResponse.json(
      { error: "worker error", detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
