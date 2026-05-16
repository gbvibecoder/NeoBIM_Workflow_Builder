/**
 * GET /api/brief-to-ifc/v3/runs/[id]/status
 *
 * Polling endpoint for the v3 results page. Returns the run's
 * lifecycle state in the exact shape the `<ExecutionResultPage>`
 * client component reads. `Cache-Control: no-store` because polling
 * happens every 5s during RUNNING.
 *
 * Auth: session-bound. A user can only read their own runs (we filter
 * by `userId` — a wrong-user request returns 404, NOT 403, so the
 * endpoint can't be used to probe for run-id existence).
 *
 * Canary: gated by `BRIEF_TO_IFC_V3_ENABLED` like the rest of v3.
 */

import { NextRequest, NextResponse } from "next/server";

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

export interface BriefToIfcV3StatusView {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  ifcUrl: string | null;
  entityCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatorCostUsd: number;
  generatorMs: number;
  turns: number;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function GET(
  _req: NextRequest,
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
  const run = await prisma.briefToIfcV3Run.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true, status: true, ifcUrl: true, entityCount: true,
      errorCode: true, errorMessage: true,
      generatorCostUsd: true, generatorMs: true, turns: true,
      lastHeartbeatAt: true, startedAt: true, completedAt: true,
      createdAt: true, updatedAt: true,
    },
  });
  if (!run) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  const view: BriefToIfcV3StatusView = {
    id: run.id,
    status: run.status,
    ifcUrl: run.ifcUrl,
    entityCount: run.entityCount,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    generatorCostUsd: run.generatorCostUsd,
    generatorMs: run.generatorMs,
    turns: run.turns,
    lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}
