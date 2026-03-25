import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

// GET — Single roadmap with full task details
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const { id } = await params;

  const roadmap = await prisma.aiRoadmap.findUnique({
    where: { id },
    include: {
      tasks: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!roadmap) {
    return NextResponse.json({ error: "Roadmap not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...roadmap,
    weekOf: roadmap.weekOf.toISOString(),
    createdAt: roadmap.createdAt.toISOString(),
    tasks: roadmap.tasks.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}
