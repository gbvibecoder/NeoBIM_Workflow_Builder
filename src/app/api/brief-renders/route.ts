/**
 * Brief-to-Renders job collection endpoints.
 *
 *   POST /api/brief-renders   — create a job + dispatch the QStash worker.
 *   GET  /api/brief-renders   — list the requesting user's jobs (cursor paginated).
 *
 * Both endpoints are gated by:
 *   1. Auth (NextAuth session) — 401 on miss.
 *   2. Canary (`shouldUserSeeBriefRenders`) — 403 on miss.
 *
 * POST also enforces:
 *   3. Per-endpoint rate limit — 10 req / hour per user.
 *   4. Per-user concurrency cap — ≤2 active jobs (QUEUED+RUNNING+AWAITING_APPROVAL).
 *   5. SSRF guard on `briefUrl` — must point at the configured R2 bucket.
 *   6. Idempotency-Key header support — repeat call returns the existing job.
 *
 * Errors flow through `formatErrorResponse` so the client surfaces the
 * same UX as every other route.
 */

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleBriefRenderWorker } from "@/lib/qstash";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import { getBriefRendersMonthlyLimit } from "@/features/billing/lib/stripe";

export const maxDuration = 30;

const MAX_ACTIVE_JOBS_PER_USER = 2;
const RATE_LIMIT_PER_HOUR = 10;

const POST_BODY_SCHEMA = z
  .object({
    briefUrl: z.string().min(1).max(2000),
  })
  .strict();

const LIST_QUERY_SCHEMA = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "Brief-to-Renders is not available for your account.",
  code: "BRIEF_RENDERS_NOT_AVAILABLE",
} as const;

const RATE_LIMITED_ERROR = {
  title: "Too many requests",
  message: "You've created too many briefs in the last hour. Please wait and try again.",
  code: "RATE_001",
} as const;

const CONCURRENCY_ERROR = {
  title: "Active job limit reached",
  message: `You can have at most ${MAX_ACTIVE_JOBS_PER_USER} brief jobs in flight at once. Wait for one to finish or cancel it.`,
  code: "BRIEF_RENDERS_CONCURRENCY_LIMIT",
} as const;

const QUOTA_ERROR = {
  title: "Monthly Brief→Renders limit reached",
  message:
    "You've hit your plan's monthly limit for Brief→Renders runs. Upgrade your plan or wait until next month.",
  code: "BRIEF_RENDERS_QUOTA_EXCEEDED",
} as const;

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const INVALID_BRIEF_URL = {
  title: "Invalid brief URL",
  message:
    "The supplied brief URL is not from an authorised storage location. Re-upload the brief and try again.",
  code: "BRIEF_RENDERS_INVALID_URL",
} as const;

const QSTASH_FAILED = {
  title: "Failed to schedule job",
  message:
    "We couldn't schedule the background worker. The job is created but not yet running — please retry.",
  code: "BRIEF_RENDERS_QSTASH_FAILED",
} as const;

/**
 * SSRF guard — accepts only URLs whose host matches the configured
 * `R2_PUBLIC_URL` host or `*.r2.cloudflarestorage.com`. Mirrors the
 * Phase 2 stage-1-spec-extract guard byte-for-byte (kept inline here
 * because the Phase 2 helper is private to that module).
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
      // R2_PUBLIC_URL malformed → fall through.
    }
  }
  return false;
}

/**
 * Compose an idempotency-safe `requestId` from the user's ID + the
 * client's Idempotency-Key header. Hashing them together means a
 * different user can't reuse another user's idempotency key.
 */
function deriveRequestId(userId: string, idempotencyKey: string | null): string {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    // No key supplied → generate a fresh per-call random ID. We use
    // crypto.randomUUID via the same `randomUUID` constructor (require
    // node:crypto at top of file).
    return globalThis.crypto.randomUUID();
  }
  return createHash("sha256")
    .update(`${userId}::${idempotencyKey.trim()}`)
    .digest("hex");
}

// ─── POST /api/brief-renders ────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  // Canary gate.
  if (!shouldUserSeeBriefRenders(userEmail, userId)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  // Admin-bypass check. Two trust signals are honoured:
  //   1. Email is in `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS` / `PLATFORM_ADMIN_EMAILS`
  //      (env-based platform admins — used for testing in production).
  //   2. DB `User.role` is `PLATFORM_ADMIN` or `TEAM_ADMIN`.
  // Either signal short-circuits rate limit + monthly quota, matching
  // the project-wide "TEAM_ADMIN/PLATFORM_ADMIN bypass limits"
  // convention documented in CLAUDE.md.
  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = userRecord?.role ?? "FREE";
  const isAdmin =
    isPlatformAdmin(userEmail) ||
    role === "PLATFORM_ADMIN" ||
    role === "TEAM_ADMIN";

  // Rate limit (admin-bypassed).
  if (!isAdmin) {
    const rl = await checkEndpointRateLimit(
      userId,
      "brief-renders-create",
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

  // Idempotency.
  const idempotencyKey = req.headers.get("idempotency-key");
  const requestId = deriveRequestId(userId, idempotencyKey);

  // Repeat-call short-circuit. Don't enter the concurrency check or
  // create a new row when the key matches an existing in-flight or
  // completed job. CANCELLED/FAILED rows are treated as expired so
  // the user can retry with the same client-side key after a
  // pipeline failure (otherwise the idempotency cache would replay
  // the broken row forever).
  let effectiveRequestId = requestId;
  if (idempotencyKey) {
    const existing = await prisma.briefRenderJob.findUnique({
      where: { requestId },
    });
    if (existing && existing.userId === userId) {
      const isTerminalFailure =
        existing.status === "CANCELLED" || existing.status === "FAILED";
      if (!isTerminalFailure) {
        return NextResponse.json(
          {
            jobId: existing.id,
            requestId: existing.requestId,
            status: existing.status,
            createdAt: existing.createdAt.toISOString(),
          },
          { status: 200 },
        );
      }
      // Cached row is a dead horse — derive a fresh requestId so the
      // unique-constraint doesn't fire on the create below. The original
      // key still maps to the dead row; future retries with the same
      // localStorage key will hit this branch again and mint another.
      effectiveRequestId = createHash("sha256")
        .update(`${requestId}::retry::${globalThis.crypto.randomUUID()}`)
        .digest("hex");
    }
  }

  // Concurrency cap.
  const activeCount = await prisma.briefRenderJob.count({
    where: {
      userId,
      status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"] },
    },
  });
  if (activeCount >= MAX_ACTIVE_JOBS_PER_USER) {
    return NextResponse.json(formatErrorResponse(CONCURRENCY_ERROR), {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  // Plan quota — count this calendar month's jobs (any status, including
  // cancelled, since the spec-extract has already run by the time the
  // user can cancel). Admin bypass mirrors the rate-limit bypass above
  // so env-based platform admins aren't caught by quota either.
  // `getBriefRendersMonthlyLimit` already returns -1 for the DB-role
  // admins; the explicit `isAdmin` check covers env-based admins.
  const monthlyLimit = isAdmin ? -1 : getBriefRendersMonthlyLimit(role);
  if (monthlyLimit !== -1) {
    const monthCount = await prisma.briefRenderJob.count({
      where: { userId, createdAt: { gte: startOfMonthUtc() } },
    });
    if (monthCount >= monthlyLimit) {
      return NextResponse.json(formatErrorResponse(QUOTA_ERROR), {
        status: 402,
      });
    }
  }

  // Create the row. `effectiveRequestId` equals `requestId` for fresh
  // calls; differs only when a cached terminal-failure row was found
  // above and we're spawning a retry against the same client key.
  const job = await prisma.briefRenderJob.create({
    data: {
      userId,
      requestId: effectiveRequestId,
      briefUrl: body.briefUrl,
      status: "QUEUED",
    },
  });

  // Dispatch the worker. If QStash fails, the row stays QUEUED — a
  // future cron sweep can retry. Phase 4 will harden this by attempting
  // a one-shot retry then falling through to a dedicated dead-letter
  // path. For Phase 3 we surface the failure to the client.
  try {
    await scheduleBriefRenderWorker(job.id);
  } catch (err) {
    // Surface the QStash error to server logs so operators can tell
    // "tunnel down" from "QSTASH_TOKEN expired" from "destination URL
    // refused" without having to instrument further. Client message
    // stays generic — full error is server-only.
    console.error("[brief-renders] QStash dispatch failed", {
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
      requestId: job.requestId,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
    },
    { status: 201 },
  );
}

// ─── GET /api/brief-renders ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  if (!shouldUserSeeBriefRenders(userEmail, userId)) {
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

  // Cursor pagination by descending createdAt. We over-fetch by 1 to
  // determine whether more pages exist.
  const rows = await prisma.briefRenderJob.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      requestId: true,
      briefUrl: true,
      status: true,
      progress: true,
      currentStage: true,
      costUsd: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      pausedAt: true,
      userApproval: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : undefined;

  return NextResponse.json({
    jobs: page.map((j) => ({
      id: j.id,
      requestId: j.requestId,
      briefUrl: j.briefUrl,
      status: j.status,
      progress: j.progress,
      currentStage: j.currentStage,
      costUsd: j.costUsd,
      errorMessage: j.errorMessage,
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
      pausedAt: j.pausedAt?.toISOString() ?? null,
      userApproval: j.userApproval,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    })),
    ...(nextCursor ? { nextCursor } : {}),
  });
}
