import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/workflows/[id]/versions — list version history
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rl = await checkEndpointRateLimit(session.user.id, "workflow-versions-list", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait.", code: "RATE_001" }), { status: 429 });
    }

    const { id } = await params;

    // Verify ownership
    const workflow = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id, deletedAt: null },
      select: { id: true, version: true },
    });

    if (!workflow) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    const versions = await prisma.workflowVersion.findMany({
      where: { workflowId: id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        name: true,
        description: true,
        createdAt: true,
      },
      take: 20,
    });

    return NextResponse.json({ versions, currentVersion: workflow.version });
  } catch (error) {
    console.error("[workflows/versions/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// POST /api/workflows/[id]/versions — restore a specific version
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rl = await checkEndpointRateLimit(session.user.id, "workflow-versions-restore", 10, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait.", code: "RATE_001" }), { status: 429 });
    }

    const { id } = await params;
    const { versionId } = await req.json();

    if (typeof versionId !== "string" || !versionId) {
      return NextResponse.json(formatErrorResponse({ title: "Invalid", message: "Version ID required.", code: "VAL_001" }), { status: 400 });
    }

    // Verify ownership
    const workflow = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id, deletedAt: null },
    });

    if (!workflow) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    // Get the version to restore
    const versionToRestore = await prisma.workflowVersion.findUnique({
      where: { id: versionId },
    });

    if (!versionToRestore || versionToRestore.workflowId !== id) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Version not found.", code: "NODE_001" }), { status: 404 });
    }

    // Use transaction: save current state + restore old version atomically
    const userId = session.user.id;
    const updated = await prisma.$transaction(async (tx) => {
      // Save current state as a version snapshot
      await tx.workflowVersion.create({
        data: {
          workflowId: id,
          version: workflow.version,
          name: workflow.name,
          description: workflow.description,
          tileGraph: workflow.tileGraph as object,
          createdBy: userId,
        },
      }).catch(() => {
        // Duplicate version key = concurrent operation, skip snapshot
      });

      // Restore the old version
      return tx.workflow.update({
        where: { id },
        data: {
          name: versionToRestore.name,
          description: versionToRestore.description,
          tileGraph: versionToRestore.tileGraph as object,
          version: { increment: 1 },
        },
      });
    });

    return NextResponse.json({ workflow: updated });
  } catch (error) {
    console.error("[workflows/versions/POST]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
