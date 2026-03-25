import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";

const VALID_STATUSES = ["todo", "in-progress", "done", "deferred", "dropped"];

// PATCH — Update task status
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminSession();
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const task = await prisma.aiRoadmapTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const previousStatus = task.status;

  const updated = await prisma.aiRoadmapTask.update({
    where: { id },
    data: { status },
  });

  logAudit(admin.id, "ROADMAP_TASK_UPDATED", "AiRoadmapTask", id, {
    previousStatus,
    newStatus: status,
    taskTitle: task.title,
  }).catch(() => {});

  return NextResponse.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}
