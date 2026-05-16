/**
 * GET /api/brief-to-ifc/v3/runs/[id]/logs
 *
 * Returns the last `limit` log lines for a run (default 200, max 500).
 * The dashboard uses this for the initial hydrate on mount; Pusher's
 * live channel (`private-bf-v3-{id}`) carries the deltas thereafter.
 *
 * Why not SSE here: Next.js App-Router SSE requires ReadableStream
 * plumbing that interacts poorly with Vercel's response timeouts +
 * cache layers; Pusher is already wired into the codebase for live
 * updates AND handles reconnection / replay automatically. This route
 * is the durable-store hydrate path; Pusher is the live path.
 *
 * `?after=<ISO>` filters logs strictly after a given timestamp — used
 * by the client's reconnection logic to fill in any gap that landed
 * during Pusher's reconnect window.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3/canary";

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The v3 AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "Run not found",
  message: "AI IFC run not found.",
  code: "BRIEF_TO_IFC_V3_RUN_NOT_FOUND",
} as const;

const QUERY_SCHEMA = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  after: z.string().datetime().optional(),
});

export interface ExecutionLogView {
  id: string;
  executionId: string;
  level: string;
  source: string;
  message: string;
  metadata: unknown;
  timestamp: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  if (!shouldUseBriefToIfcV3(session.user.email ?? null)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const { id } = await params;

  // Ownership pre-check — 404 on mismatch matches the status route.
  const run = await prisma.briefToIfcV3Run.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  const url = new URL(req.url);
  const parsed = QUERY_SCHEMA.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }
  const { limit, after } = parsed.data;

  const where: { executionId: string; timestamp?: { gt: Date } } = {
    executionId: id,
  };
  if (after) {
    where.timestamp = { gt: new Date(after) };
  }

  const rows = await prisma.executionLog.findMany({
    where,
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true, executionId: true, level: true, source: true,
      message: true, metadata: true, timestamp: true,
    },
  });

  const view: ExecutionLogView[] = rows.map((r) => ({
    id: r.id,
    executionId: r.executionId,
    level: r.level,
    source: r.source,
    message: r.message,
    metadata: r.metadata,
    timestamp: r.timestamp.toISOString(),
  }));

  return NextResponse.json(
    {
      logs: view,
      // Subscription details so the client doesn't have to know the
      // channel-naming convention out-of-band.
      pusher: {
        channel: `private-bf-v3-${id}`,
        event: "execution-log:appended",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
