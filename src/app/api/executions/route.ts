import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstExecution } from "@/lib/analytics";
import type { ExecutionStatus } from "@prisma/client";

// GET /api/executions — list user's executions with workflow name
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  const statusParam = searchParams.get("status") as ExecutionStatus | null;
  const limit = parseInt(searchParams.get("limit") ?? "50");

  const rawExecutions = await prisma.execution.findMany({
    where: {
      userId: session.user.id,
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
}

// POST /api/executions — create new execution record
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workflowId, inputSummary, triggerType } = await req.json();

  if (!workflowId) {
    return NextResponse.json({ error: "workflowId required" }, { status: 400 });
  }

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, ownerId: session.user.id },
  });

  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
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

  // 🔥 TRACK EXECUTION (+ first execution milestone)
  await trackFirstExecution(session.user.id, execution.id);

  return NextResponse.json({ execution }, { status: 201 });
}
