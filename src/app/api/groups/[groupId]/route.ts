import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { pusherTrigger } from "@/lib/pusher-server";

// PATCH /api/groups/[groupId] — update group (label/color/position/size)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { groupId } = await params;
  const existing = await prisma.canvasGroup.findUnique({ where: { id: groupId } });
  if (!existing || existing.createdById !== session.user.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });
  }

  const body = await req.json();
  const { label, color, positionX, positionY, width, height } = body as {
    label?: string; color?: string; positionX?: number; positionY?: number; width?: number; height?: number;
  };

  const group = await prisma.canvasGroup.update({
    where: { id: groupId },
    data: {
      ...(label != null ? { label } : {}),
      ...(color != null ? { color } : {}),
      ...(positionX != null ? { positionX } : {}),
      ...(positionY != null ? { positionY } : {}),
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    },
  });

  void pusherTrigger(`private-canvas-${existing.workflowId}`, "canvas-group:updated", { group });

  return NextResponse.json({ group });
}

// DELETE /api/groups/[groupId] — delete group
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { groupId } = await params;
  const existing = await prisma.canvasGroup.findUnique({ where: { id: groupId } });
  if (!existing || existing.createdById !== session.user.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });
  }

  await prisma.canvasGroup.delete({ where: { id: groupId } });

  void pusherTrigger(`private-canvas-${existing.workflowId}`, "canvas-group:deleted", { groupId });

  return NextResponse.json({ success: true });
}
