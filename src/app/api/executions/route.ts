import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstExecution } from "@/lib/analytics";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { createExecutionWithCapCheck } from "@/features/billing/lib/check-execution-eligibility";
import type { ExecutionStatus } from "@prisma/client";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

// GET /api/executions — list user's executions with workflow name
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 30 reads per user per minute
    const rl = await checkEndpointRateLimit(session.user.id, "executions-list", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId");
    const statusParam = searchParams.get("status") as ExecutionStatus | null;
    const limit = parseInt(searchParams.get("limit") ?? "50");

    const rawExecutions = await prisma.execution.findMany({
      where: {
        userId: session.user.id,
        // Hide executions whose parent workflow has been soft-deleted from
        // the user's view. Admin pages don't apply this filter, so they
        // still see the historical activity.
        workflow: { deletedAt: null },
        ...(workflowId && { workflowId }),
        ...(statusParam && { status: statusParam }),
      },
      include: {
        workflow: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    // Build artifacts from tileResults JSON (where useExecution actually stores them)
    const executions = rawExecutions.map(execution => {
      const tileResults = Array.isArray(execution.tileResults) ? execution.tileResults : [];
      const artifacts = (tileResults as Record<string, unknown>[]).map((result, index) => ({
        id: `artifact-${index}`,
        type: (result.type as string) ?? "json",
        data: (result.data as Record<string, unknown>) ?? result,
        metadata: (result.metadata as Record<string, unknown>) ?? {},
        tileInstanceId: (result.nodeId as string) ?? `node-${index}`,
        nodeId: (result.nodeId as string) ?? `node-${index}`,
        nodeLabel: (result.nodeLabel as string) ?? null,
        title: (result.title as string) ?? (result.nodeLabel as string) ?? "Result",
        createdAt: (result.createdAt as string) ?? execution.startedAt?.toISOString(),
      }));
      return { ...execution, artifacts };
    });

    return NextResponse.json({ executions });
  } catch (error) {
    console.error("[executions/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// POST /api/executions — create new execution record
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 20 creates per user per minute
    const rl = await checkEndpointRateLimit(session.user.id, "executions-create", 20, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const { workflowId, inputSummary } = await req.json();

    // Atomic cap check + Execution-row creation. The helper:
    //   • acquires a per-user pg_advisory_xact_lock so concurrent Run clicks
    //     serialize and only one passes when the user is at cap;
    //   • falls back to the per-user `__standalone_tools__` scratch workflow
    //     when workflowId is omitted (closes the save-failure billing leak);
    //   • atomically consumes a referral bonus if available;
    //   • uses a slot-reservation count (completed + recent in-flight) so
    //     two concurrent runs cannot both pass when only one slot is free.
    const userRole = ((session.user as { role?: string }).role) ?? "FREE";
    const userEmail = session.user.email;
    const emailVerified = !!(session.user as { emailVerified?: boolean }).emailVerified;

    const result = await createExecutionWithCapCheck({
      userId: session.user.id,
      userRole,
      userEmail,
      emailVerified,
      intent: { kind: "workflow-run" },
      workflowId: workflowId ?? null,
      initialStatus: "RUNNING",
      inputSummary,
    });

    if (!result.ok) {
      const block = result.eligibility.blocks[0];
      return NextResponse.json(
        formatErrorResponse({
          title: block.title,
          message: block.message,
          code: "RATE_001",
          action: block.action,
          actionUrl: block.actionUrl,
        }),
        {
          status: 429,
          headers: {
            "X-Plan-Limit": String(result.eligibility.limit),
            "X-Plan-Used": String(result.eligibility.used),
          },
        },
      );
    }

    // Track execution (+ first execution milestone)
    await trackFirstExecution(session.user.id, result.execution.id);

    const execution = await prisma.execution.findUnique({ where: { id: result.execution.id } });

    const responseHeaders: Record<string, string> = {};
    if (result.usedReferralBonus) {
      responseHeaders["X-Referral-Bonus-Used"] = "1";
      responseHeaders["X-Referral-Bonus-Remaining"] = String(result.bonusRemaining);
    }

    return NextResponse.json({ execution }, { status: 201, headers: responseHeaders });
  } catch (error) {
    console.error("[executions/POST]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
