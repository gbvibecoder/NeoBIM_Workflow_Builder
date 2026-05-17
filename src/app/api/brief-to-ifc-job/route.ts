/**
 * Brief-to-IFC v2 queued-pipeline job endpoints — retirement-mode (2026-05-17).
 *
 *   POST /api/brief-to-ifc-job  — returns HTTP 410 Gone with
 *                                 `error: "PIPELINE_RETIRED"`. New IFC
 *                                 generation lives at v3:
 *                                 POST /api/brief-to-ifc/v3/runs
 *   GET  /api/brief-to-ifc-job  — still online so users can inspect
 *                                 their HISTORICAL v2 jobs (read-only,
 *                                 own-data; canary check removed).
 *
 * Backstory: v2 produced broken millimetre-scale IFCs (see
 * PHASE_BEAST_MODE_CLOSEOUT_REPORT_2026-05-16.md). v3 supersedes it
 * with one node, validators, and a stable visual gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

// Retirement-era surface (2026-05-17). The original v2 POST body
// validator, rate-limit constants, concurrency-cap constants, and the
// canary-gate helpers are all gone — POST now returns 410 unconditionally.
// Only the read path (GET) remains, paginating the user's own historical
// job rows.

export const maxDuration = 30;

const LIST_QUERY_SCHEMA = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// ─── POST /api/brief-to-ifc-job ─────────────────────────────────────
//
// RETIRED 2026-05-17. The v2 queued IFC pipeline produced broken
// millimetre-scale IFCs (see PHASE_BEAST_MODE_CLOSEOUT_REPORT_2026-05-16.md)
// and was superseded by v3 (POST /api/brief-to-ifc/v3/runs). This
// endpoint now returns HTTP 410 Gone for all new submissions.
//
// The GET endpoints below remain functional so users can still inspect
// their historical job rows. The QStash worker callback (worker/route.ts)
// also returns 410 so any in-flight callbacks short-circuit.

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: "PIPELINE_RETIRED",
      message:
        "The v2 IFC pipeline was retired on 2026-05-17. Use the v3 pipeline instead.",
      replacement: "/api/brief-to-ifc/v3/runs",
      docs: "https://trybuildflow.in/dashboard/templates",
    },
    { status: 410 },
  );
}


// ─── GET /api/brief-to-ifc-job ──────────────────────────────────────

// GET stays online so users can still inspect their HISTORICAL v2 jobs
// (rows in the DB) even though new submissions are 410 above. We drop
// the canary check on read — historical data belongs to the user.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const params = LIST_QUERY_SCHEMA.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!params.success) {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }
  const { limit, cursor } = params.data;

  // Cursor pagination by descending createdAt. Over-fetch by 1 to detect
  // whether more pages exist. Heavy text columns (enrichedSpec,
  // architectScript) are deliberately NOT selected here.
  const rows = await prisma.briefToIfcJob.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      progress: true,
      currentStage: true,
      ifcR2Url: true,
      ifcEntityCount: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : undefined;

  return NextResponse.json(
    {
      jobs: page.map((j) => ({
        id: j.id,
        status: j.status,
        progress: j.progress,
        currentStage: j.currentStage,
        ifcR2Url: j.ifcR2Url,
        ifcEntityCount: j.ifcEntityCount,
        error: j.error ?? null,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
      ...(nextCursor ? { nextCursor } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
