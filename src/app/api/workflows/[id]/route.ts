import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

// GET /api/workflows/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const { id } = await params;
    const workflow = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!workflow) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error("[workflows/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// PUT /api/workflows/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit saves: 30 per minute
    const rl = await checkEndpointRateLimit(session.user.id, "workflows-update", 30, "1 m");
    if (!rl.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please wait before saving again.", code: "RATE_001" }), { status: 429 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, description, tags, tileGraph } = body;

    const existing = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    // Save current state as a version snapshot before overwriting
    if (tileGraph !== undefined) {
      try {
        await prisma.workflowVersion.create({
          data: {
            workflowId: id,
            version: existing.version,
            name: existing.name,
            description: existing.description,
            tileGraph: existing.tileGraph as object,
            createdBy: session.user.id,
          },
        });

        // Clean up old versions (fire-and-forget — non-critical)
        prisma.workflowVersion.findMany({
          where: { workflowId: id },
          orderBy: { version: "desc" },
          skip: 20,
          select: { id: true },
        }).then(old => {
          if (old.length > 0) {
            prisma.workflowVersion.deleteMany({
              where: { id: { in: old.map(v => v.id) } },
            }).catch(() => {});
          }
        }).catch(() => {});
      } catch (err) {
        // Log but don't block save — duplicate version key means concurrent save, which is OK
        console.warn("[workflows/PUT] Version snapshot failed (may be concurrent save):", err);
      }
    }

    const workflow = await prisma.workflow.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(tags !== undefined && { tags }),
        ...(tileGraph !== undefined && { tileGraph }),
        version: { increment: 1 },
      },
    });

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error("[workflows/PUT]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// DELETE /api/workflows/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const { id } = await params;
    const existing = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(formatErrorResponse({ title: "Not found", message: "Workflow not found.", code: "NODE_001" }), { status: 404 });
    }

    await prisma.$transaction([
      prisma.execution.deleteMany({ where: { workflowId: id } }),
      prisma.workflow.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[workflows/DELETE]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
