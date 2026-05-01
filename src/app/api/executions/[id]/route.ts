import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/executions/[id] — get execution with all artifacts
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 30 reads per user per minute
    const rl = await checkEndpointRateLimit(session.user.id, "execution-detail", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const { id } = await params;

    const execution = await prisma.execution.findFirst({
      where: { id, userId: session.user.id, workflow: { deletedAt: null } },
      include: {
        workflow: { select: { id: true, name: true } },
      },
    });

    if (!execution) {
      return NextResponse.json(formatErrorResponse({ title: "Execution not found", message: "The requested execution could not be found.", code: "NODE_001" }), { status: 404 });
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
      metadata: (result.metadata as Record<string, unknown>) ?? {},
      createdAt: (result.createdAt as string) ?? execution.startedAt?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({ execution: { ...execution, artifacts } });
  } catch (error) {
    console.error("[executions/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// PUT /api/executions/[id] — update status / results
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 30 updates per user per minute
    const rl = await checkEndpointRateLimit(session.user.id, "execution-update", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const { id } = await params;

    // Verify ownership before updating
    const existing = await prisma.execution.findFirst({
      where: { id, userId: session.user.id, workflow: { deletedAt: null } },
    });
    if (!existing) {
      return NextResponse.json(formatErrorResponse({ title: "Execution not found", message: "The requested execution could not be found.", code: "NODE_001" }), { status: 404 });
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
  } catch (error) {
    console.error("[executions/PUT]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
