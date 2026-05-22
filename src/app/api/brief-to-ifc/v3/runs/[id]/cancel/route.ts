/**
 * POST /api/brief-to-ifc/v3/runs/[id]/cancel
 *
 * Phase ζ.1 — user-initiated cancellation for v3 runs.
 *
 * Sets the run to CANCELLED so:
 *   1. Any in-flight agent-job worker's per-turn cancel-check (driver.ts)
 *      sees the status flip on its next turn boundary and returns via
 *      the graceful `failed(CANCELLED_BY_USER)` shape, bounding additional
 *      Anthropic spend to whatever turn was already mid-stream.
 *   2. Any queued iteration N+1 QStash message that fires later fails its
 *      atomic claim (which requires `status IN {PENDING,RUNNING}`) and
 *      returns 200 without entering `runGenerator`.
 *   3. The worker's "shall I chain iter N+1" guard re-reads the run row
 *      between iterations and skips the re-enqueue when status=CANCELLED.
 *
 * Idempotency: if the run is already terminal (COMPLETED / FAILED /
 * CANCELLED), the endpoint returns 200 with the current status rather
 * than throwing — a double-click on STOP must not 500.
 *
 * Ownership: the caller must own the run. We mirror the
 * `runs/[id]/status` route's pattern (`findFirst({ where: { id, userId } })`);
 * a wrong-user request returns 404 (not 403) so the endpoint cannot be
 * used to probe for run-id existence.
 *
 * Canary: gated by `BRIEF_TO_IFC_V3_ENABLED` like the rest of v3.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3/canary";
import { appendLog } from "@/features/brief-to-ifc/v3/runtime/append-log";
import {
  transitionStatus,
  type BriefToIfcV3RunStatus,
} from "@/features/brief-to-ifc/v3/lifecycle/transitions";

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

const TERMINAL_STATUSES = new Set<BriefToIfcV3RunStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

interface CancelResponseBody {
  id: string;
  status: BriefToIfcV3RunStatus;
  /** True if THIS call performed the transition. False when the run was
   *  already terminal (idempotent no-op). */
  cancelled: boolean;
}

export async function POST(
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

  // Ownership + lookup. Wrong-user / unknown id → 404, never 403, so the
  // endpoint can't be used to probe run-id existence.
  const run = await prisma.briefToIfcV3Run.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!run) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), {
      status: 404,
    });
  }

  // Idempotency: already terminal → no-op success.
  if (TERMINAL_STATUSES.has(run.status)) {
    return NextResponse.json(
      {
        id: run.id,
        status: run.status,
        cancelled: false,
      } satisfies CancelResponseBody,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Atomic transition through the state-machine helper. `transitionStatus`
  // validates that PENDING|RUNNING → CANCELLED is allowed (it is — see
  // lifecycle/transitions.ts:52-53) and writes `errorCode=CANCELLED_BY_USER`,
  // `completedAt=now`, and the supplied errorMessage.
  try {
    await transitionStatus(prisma, run.id, run.status, {
      to: "CANCELLED",
      payload: {
        errorMessage: "Cancelled by user.",
      },
    });
  } catch (err) {
    // Race with another writer (e.g. the worker just transitioned the row
    // to COMPLETED / FAILED a millisecond before us) — re-read and report
    // whatever status now stands. Never 500 the user on a race; cancel is
    // a "best-effort, idempotent" operation.
    const after = await prisma.briefToIfcV3Run.findUnique({
      where: { id: run.id },
      select: { status: true },
    });
    const status = (after?.status ?? run.status) as BriefToIfcV3RunStatus;
    // eslint-disable-next-line no-console
    console.warn(
      `[bf-v3 cancel] transition race for ${run.id}: ${
        err instanceof Error ? err.message : String(err)
      } — current status=${status}`,
    );
    return NextResponse.json(
      {
        id: run.id,
        status,
        cancelled: false,
      } satisfies CancelResponseBody,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  await appendLog(prisma, {
    executionId: run.id,
    level: "INFO",
    source: "LIFECYCLE",
    message:
      `Run cancelled by user. The in-flight agent-job worker will detect ` +
      `this on its next turn boundary and abort gracefully.`,
    metadata: { cancelledBy: session.user.id, priorStatus: run.status },
  });

  return NextResponse.json(
    {
      id: run.id,
      status: "CANCELLED" as const,
      cancelled: true,
    } satisfies CancelResponseBody,
    { headers: { "Cache-Control": "no-store" } },
  );
}
