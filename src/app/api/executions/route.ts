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

  const executions = await prisma.execution.findMany({
    where: {
      userId: session.user.id,
      ...(workflowId && { workflowId }),
      ...(statusParam && { status: statusParam }),
    },
    include: {
      workflow: { select: { id: true, name: true } },
      artifacts: {
        select: { id: true, type: true, data: true, metadata: true, tileInstanceId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startedAt: "desc" },
    take: limit,
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
