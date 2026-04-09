import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstExecution } from "@/lib/analytics";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
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
        metadata: {},
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

    if (!workflowId) {
      return NextResponse.json(formatErrorResponse({ title: "Missing field", message: "workflowId is required.", code: "VAL_001" }), { status: 400 });
    }

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, ownerId: session.user.id, deletedAt: null },
    });

    if (!workflow) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    const execution = await prisma.execution.create({
      data: {
        workflowId,
        userId: session.user.id,
        status: "RUNNING",
        startedAt: new Date(),
        ...(inputSummary && { tileResults: { inputSummary } }),
      },
    });

    // Track execution (+ first execution milestone)
    await trackFirstExecution(session.user.id, execution.id);

    return NextResponse.json({ execution }, { status: 201 });
  } catch (error) {
    console.error("[executions/POST]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
