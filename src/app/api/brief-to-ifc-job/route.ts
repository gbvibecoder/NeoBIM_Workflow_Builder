/**
 * Brief-to-IFC v2 queued-pipeline job collection endpoints.
 *
 *   POST /api/brief-to-ifc-job  — create a job + dispatch the QStash worker.
 *   GET  /api/brief-to-ifc-job  — list the requesting user's jobs (newest first).
 *
 * Mirrors `POST /api/brief-renders` — same auth → canary → rate-limit →
 * concurrency-cap → SSRF-guard → create → dispatch → 201 shape. It is
 * deliberately LIGHTER than brief-renders: no plan-quota / billing gate
 * (the queued path is canary-gated and concurrency-capped, and the
 * Phase 1 synchronous path already counts against the execution cap), and
 * no `requestId` idempotency column (the ≤2-active concurrency cap plus
 * client-side dedup is the guard).
 *
 * The brief file itself is uploaded separately through the existing
 * `POST /api/upload-brief` endpoint; this route receives the resulting
 * `briefUrl` — exactly the brief-renders two-step shape.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleBriefToIfcWorker } from "@/lib/qstash";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { shouldUseBriefToIfcV2Queue } from "@/features/ifc/services/brief-to-ifc-v2/canary";

export const maxDuration = 30;

/** Active-job concurrency cap per user — mirrors brief-renders. */
const MAX_ACTIVE_JOBS_PER_USER = 2;
/** Per-endpoint rate limit. */
const RATE_LIMIT_PER_HOUR = 10;
/** Statuses that count as "in flight" for the concurrency cap. */
const ACTIVE_STATUSES = [
  "QUEUED",
  "RUNNING_ENRICH",
  "RUNNING_ARCHITECT",
  "RUNNING_GENERATE",
  "AWAITING_RETRY",
] as const;

const POST_BODY_SCHEMA = z
  .object({
    briefUrl: z.string().min(1).max(2000),
    executionId: z.string().min(1).max(64).optional(),
  })
  .strict();

const LIST_QUERY_SCHEMA = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The queued AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_NOT_AVAILABLE",
} as const;

const RATE_LIMITED_ERROR = {
  title: "Too many requests",
  message:
    "You've started too many IFC jobs in the last hour. Please wait and try again.",
  code: "RATE_001",
} as const;

const CONCURRENCY_ERROR = {
  title: "Active job limit reached",
  message: `You can have at most ${MAX_ACTIVE_JOBS_PER_USER} AI IFC jobs in flight at once. Wait for one to finish or cancel it.`,
  code: "BRIEF_TO_IFC_CONCURRENCY_LIMIT",
} as const;

const INVALID_BRIEF_URL = {
  title: "Invalid brief URL",
  message:
    "The supplied brief URL is not from an authorised storage location. Re-upload the brief and try again.",
  code: "BRIEF_TO_IFC_INVALID_URL",
} as const;

const QSTASH_FAILED = {
  title: "Failed to schedule job",
  message:
    "We couldn't schedule the background worker. The job is created but not yet running — please retry.",
  code: "BRIEF_TO_IFC_QSTASH_FAILED",
} as const;

/**
 * SSRF guard — accepts only URLs whose host matches the configured
 * `R2_PUBLIC_URL` host or `*.r2.cloudflarestorage.com`. Mirrors the
 * brief-renders guard byte-for-byte; the brief file is always one our
 * own `POST /api/upload-brief` produced, so this is defence-in-depth.
 */
function isAuthorizedBriefUrl(briefUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(briefUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith(".r2.cloudflarestorage.com")) return true;
  const publicUrl = process.env.R2_PUBLIC_URL ?? "";
  if (publicUrl) {
    try {
      const allowedHost = new URL(publicUrl).hostname.toLowerCase();
      if (allowedHost && host === allowedHost) return true;
    } catch {
      /* R2_PUBLIC_URL malformed → fall through. */
    }
  }
  return false;
}

// ─── POST /api/brief-to-ifc-job ─────────────────────────────────────

export async function POST(req: NextRequest) {
  // Phase 2.2: one-line "I was reached" beacon. If this line never appears
  // in Vercel logs for a wf-13 run, the canvas dispatched on the SYNC path
  // (the `/api/execute-node` node-loop) — i.e. the client never even tried
  // the queued endpoint. Confirms the canary axis of the dispatch decision.
  console.log("[brief-to-ifc-job POST] received request — canary check downstream");
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  // Canary gate.
  if (!shouldUseBriefToIfcV2Queue(userEmail)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const isAdmin = isPlatformAdmin(userEmail);

  // Rate limit (admin-bypassed).
  if (!isAdmin) {
    const rl = await checkEndpointRateLimit(
      userId,
      "brief-to-ifc-create",
      RATE_LIMIT_PER_HOUR,
      "1 h",
    );
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse(RATE_LIMITED_ERROR), {
        status: 429,
      });
    }
  }

  // Body validation.
  let body: z.infer<typeof POST_BODY_SCHEMA>;
  try {
    const json = await req.json();
    const parsed = POST_BODY_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("briefUrl")),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  if (!isAuthorizedBriefUrl(body.briefUrl)) {
    return NextResponse.json(formatErrorResponse(INVALID_BRIEF_URL), {
      status: 400,
    });
  }

  // Concurrency cap.
  const activeCount = await prisma.briefToIfcJob.count({
    where: { userId, status: { in: [...ACTIVE_STATUSES] } },
  });
  if (activeCount >= MAX_ACTIVE_JOBS_PER_USER) {
    return NextResponse.json(formatErrorResponse(CONCURRENCY_ERROR), {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  // Create the job row.
  const job = await prisma.briefToIfcJob.create({
    data: {
      userId,
      briefFileR2Key: body.briefUrl,
      executionId: body.executionId ?? null,
      status: "QUEUED",
      progress: 0,
    },
  });

  // Dispatch the worker. If QStash fails, the row stays QUEUED — the
  // cleanup cron will eventually sweep it to FAILED. Surface the failure
  // to the client so it can retry.
  try {
    await scheduleBriefToIfcWorker(job.id);
  } catch (err) {
    console.error("[brief-to-ifc] QStash dispatch failed", {
      jobId: job.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(formatErrorResponse(QSTASH_FAILED), {
      status: 503,
    });
  }

  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
    },
    { status: 201 },
  );
}

// ─── GET /api/brief-to-ifc-job ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  if (!shouldUseBriefToIfcV2Queue(userEmail)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

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
