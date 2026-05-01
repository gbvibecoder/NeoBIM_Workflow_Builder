import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/executions/[id]/artifacts — append node artifact into tileResults JSON
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 60 artifacts per user per minute (called during multi-node execution)
    const rl = await checkEndpointRateLimit(session.user.id, "artifacts-append", 60, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const { id: executionId } = await params;

    // Verify ownership
    const execution = await prisma.execution.findFirst({
      where: { id: executionId, userId: session.user.id, workflow: { deletedAt: null } },
    });
    if (!execution) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Execution not found.", code: "NODE_001" }), { status: 404 });
    }

    const { nodeId, nodeLabel, type, title, data, metadata } = await req.json();

    // Append artifact entry to tileResults JSON array
    const existing = Array.isArray(execution.tileResults) ? execution.tileResults : [];
    const updated = [
      ...existing,
      { nodeId, nodeLabel, type, title, data, metadata, createdAt: new Date().toISOString() },
    ];

    const updatedExecution = await prisma.execution.update({
      where: { id: executionId },
      data: { tileResults: updated },
    });

    return NextResponse.json({ execution: updatedExecution }, { status: 201 });
  } catch (error) {
    console.error("[executions/artifacts/POST]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
