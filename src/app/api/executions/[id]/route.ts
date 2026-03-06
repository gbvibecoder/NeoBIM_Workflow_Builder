import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

// GET /api/executions/[id] — get execution with all artifacts
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const execution = await prisma.execution.findFirst({
    where: { id, userId: session.user.id },
    include: {
      workflow: { select: { id: true, name: true } },
    },
  });

  if (!execution) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Build artifacts from tileResults JSON (where useExecution actually stores them)
  // The Artifact Prisma relation is empty because the write path uses tileResults JSON
  const tileResults = Array.isArray(execution.tileResults) ? execution.tileResults : [];
  const artifacts = (tileResults as Record<string, unknown>[]).map((result, index) => ({
    id: `artifact-${index}`,
    executionId: execution.id,
    tileInstanceId: (result.nodeId as string) ?? `node-${index}`,
    nodeId: (result.nodeId as string) ?? `node-${index}`,
    nodeLabel: (result.nodeLabel as string) ?? null,
    type: (result.type as string) ?? "json",
    title: (result.title as string) ?? (result.nodeLabel as string) ?? "Result",
    data: (result.data as Record<string, unknown>) ?? result,
    metadata: {},
    createdAt: (result.createdAt as string) ?? execution.startedAt?.toISOString() ?? new Date().toISOString(),
  }));

  return NextResponse.json({ execution: { ...execution, artifacts } });
}

// PUT /api/executions/[id] — update status / results
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership before updating
  const existing = await prisma.execution.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { status, tileResults, errorMessage } = await req.json();

  const execution = await prisma.execution.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(tileResults !== undefined && { tileResults }),
      ...(errorMessage !== undefined && { errorMessage }),
      ...(status && ["SUCCESS", "FAILED", "PARTIAL"].includes(status) && {
        completedAt: new Date(),
      }),
    },
  });

  return NextResponse.json({ execution });
}
