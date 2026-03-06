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
      artifacts: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!execution) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ execution });
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
