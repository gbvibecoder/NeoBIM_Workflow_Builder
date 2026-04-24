/**
 * Client-facing VideoJob read endpoint.
 *
 * Returns the computed VideoJobClientView — safe to expose to the browser.
 * Kling taskIds are scrubbed server-side inside getVideoJobForUser; the
 * caller never sees them.
 *
 * Rate limit is generous (60/min) because this is a DB-only read, not a
 * Kling API call. Clients should poll every 5s by default.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse } from "@/lib/user-errors";
import { getVideoJobForUser } from "@/features/3d-render/services/video-job-service";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Unauthorized",
        message: "Please sign in.",
        code: "AUTH_001",
      }),
      { status: 401 },
    );
  }

  const rl = await checkEndpointRateLimit(
    session.user.id,
    "video-jobs-read",
    60,
    "1 m",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "Slow down — polling is limited to 60 requests per minute.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing id",
        message: "Job id is required.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  const view = await getVideoJobForUser(id, session.user.id);
  if (!view) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Not found",
        message: "Video job not found or not accessible.",
        code: "NODE_001",
      }),
      { status: 404 },
    );
  }

  return NextResponse.json(view);
}

// Silence lint if `req` isn't referenced.
void ((_: NextRequest) => _);
