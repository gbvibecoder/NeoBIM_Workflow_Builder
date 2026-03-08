import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

// GET /api/workflows/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const workflow = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!workflow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error("[workflows/GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/workflows/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, description, tags, tileGraph } = body;

    const existing = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/workflows/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await prisma.workflow.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.execution.deleteMany({ where: { workflowId: id } }),
      prisma.workflow.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[workflows/DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
