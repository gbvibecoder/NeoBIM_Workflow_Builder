import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trackFirstWorkflow } from "@/lib/analytics";

// GET /api/workflows — list user's workflows
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workflows = await prisma.workflow.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      tags: true,
      isPublished: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { executions: true } },
    },
  });

  return NextResponse.json({ workflows });
}

// POST /api/workflows — create new workflow
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, description, tags, tileGraph } = body;

  const workflow = await prisma.workflow.create({
    data: {
      ownerId: session.user.id,
      name: name ?? "Untitled Workflow",
      description,
      tags: tags ?? [],
      tileGraph: tileGraph ?? { nodes: [], edges: [] },
    },
  });

  // 🔥 TRACK WORKFLOW CREATION (+ first workflow milestone)
  await trackFirstWorkflow(session.user.id, workflow.id);

  return NextResponse.json({ workflow }, { status: 201 });
}
