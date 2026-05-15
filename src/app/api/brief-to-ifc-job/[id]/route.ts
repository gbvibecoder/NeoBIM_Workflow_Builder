/**
 * Brief-to-IFC v2 per-job endpoints.
 *
 *   GET    /api/brief-to-ifc-job/:id  — full job state for polling.
 *   DELETE /api/brief-to-ifc-job/:id  — cancel a non-terminal job.
 *
 * Authorization:
 *   • 401 when unauthenticated.
 *   • 403 when the canary is off.
 *   • 404 when the job belongs to another user (deliberately 404 not 403
 *     so an attacker can't probe for job IDs — mirrors brief-renders).
 *
 * `Cache-Control: no-store` on GET because the client polls every few
 * seconds and caching would mask state transitions. The GET response is
 * exactly the `BriefToIfcJobView` contract from `job-types.ts`.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV2Queue } from "@/features/ifc/services/brief-to-ifc-v2/canary";
import type {
  BriefToIfcJobView,
  BriefToIfcStageLogEntry,
  BriefToIfcJobError,
  BriefToIfcAudit,
  BriefToIfcRetryAttempt,
} from "@/features/ifc/services/brief-to-ifc-v2/job-types";

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The queued AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "Job not found",
  message: "AI IFC job not found.",
  code: "BRIEF_TO_IFC_NOT_FOUND",
} as const;

const ALREADY_TERMINAL_ERROR = {
  title: "Job already finished",
  message: "This job has already completed, failed, or been cancelled.",
  code: "BRIEF_TO_IFC_ALREADY_TERMINAL",
} as const;

/** Statuses a job can be cancelled FROM. */
const CANCELLABLE_STATUSES = [
  "QUEUED",
  "RUNNING_ENRICH",
  "RUNNING_ARCHITECT",
  "RUNNING_GENERATE",
  "AWAITING_RETRY",
] as const;

// ─── JSON-column coercion (Prisma `JsonValue` → typed view) ─────────

function coerceStageLog(raw: unknown): BriefToIfcStageLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is BriefToIfcStageLogEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as { stage?: unknown }).stage === "number",
  );
}

function coerceJobError(raw: unknown): BriefToIfcJobError | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.code !== "string" || typeof e.message !== "string") return null;
  return {
    code: e.code,
    message: e.message,
    stage: typeof e.stage === "string" ? e.stage : "unknown",
  };
}

function coerceAudit(raw: unknown): BriefToIfcAudit | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.total_entities !== "number") return null;
  const byClass: Record<string, number> = {};
  if (a.by_class && typeof a.by_class === "object") {
    for (const [k, v] of Object.entries(a.by_class as Record<string, unknown>)) {
      if (typeof v === "number") byClass[k] = v;
    }
  }
  return { total_entities: a.total_entities, by_class: byClass };
}

/** Phase 3 — `BriefToIfcJob.retryHistory` is `BriefToIfcRetryAttempt[]`. */
function coerceRetryHistory(raw: unknown): BriefToIfcRetryAttempt[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefToIfcRetryAttempt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (
      typeof e.attempt !== "number" ||
      (e.status !== "succeeded" && e.status !== "failed") ||
      typeof e.scriptCode !== "string"
    ) {
      continue;
    }
    out.push({
      attempt: e.attempt,
      status: e.status,
      scriptCode: e.scriptCode,
      scriptLength:
        typeof e.scriptLength === "number"
          ? e.scriptLength
          : e.scriptCode.length,
      durationMs: typeof e.durationMs === "number" ? e.durationMs : 0,
      errorType: typeof e.errorType === "string" ? e.errorType : null,
      errorTraceback:
        typeof e.errorTraceback === "string" ? e.errorTraceback : null,
      sandboxExitCode:
        typeof e.sandboxExitCode === "number" ? e.sandboxExitCode : null,
    });
  }
  return out;
}

// ─── GET ────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const job = await prisma.briefToIfcJob.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      progress: true,
      currentStage: true,
      stageLog: true,
      enrichedSpec: true,
      architectScript: true,
      ifcR2Url: true,
      ifcEntityCount: true,
      ifcAudit: true,
      error: true,
      errorTraceback: true,
      errorType: true,
      attemptCount: true,
      retryHistory: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  if (!job) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  const view: BriefToIfcJobView = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentStage: job.currentStage,
    stageLog: coerceStageLog(job.stageLog),
    enrichedSpec: job.enrichedSpec,
    architectScript: job.architectScript,
    ifcR2Url: job.ifcR2Url,
    ifcEntityCount: job.ifcEntityCount,
    ifcAudit: coerceAudit(job.ifcAudit),
    error: coerceJobError(job.error),
    errorTraceback: job.errorTraceback,
    errorType: job.errorType,
    attemptCount: job.attemptCount,
    retryHistory: coerceRetryHistory(job.retryHistory),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };

  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}

// ─── DELETE ─────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  // Ownership pre-check — 404 (not 403) on mismatch, matching GET.
  const existing = await prisma.briefToIfcJob.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  // Atomic conditional cancel — filtering on current status prevents
  // racing a concurrent worker completion. A cancelled job is FAILED
  // with an explicit "cancelled by user" error; the worker's atomic
  // claims and `markFailed`'s `notIn: [COMPLETED, FAILED]` guard mean an
  // in-flight worker simply no-ops on its next transition.
  const result = await prisma.briefToIfcJob.updateMany({
    where: { id, status: { in: [...CANCELLABLE_STATUSES] } },
    data: {
      status: "FAILED",
      error: {
        code: "CANCELLED_BY_USER",
        message: "The job was cancelled by the user.",
        stage: "cancelled",
      },
      currentStage: "cancelled",
      lockedAt: null,
      completedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json(formatErrorResponse(ALREADY_TERMINAL_ERROR), {
      status: 409,
    });
  }

  const job = await prisma.briefToIfcJob.findUnique({
    where: { id },
    select: { id: true, status: true, completedAt: true },
  });

  return NextResponse.json({
    id: job?.id ?? id,
    status: job?.status ?? "FAILED",
    completedAt: job?.completedAt?.toISOString() ?? null,
  });
}
