import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { pusherTrigger } from "@/lib/pusher-server";

// PATCH /api/comments/[commentId] — update comment body/mentions
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { commentId } = await params;
  const existing = await prisma.canvasComment.findUnique({ where: { id: commentId } });
  if (!existing || existing.authorId !== session.user.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });
  }

  const body = await req.json();
  const { text, mentions } = body as { text?: string; mentions?: string[] };

  const comment = await prisma.canvasComment.update({
    where: { id: commentId },
    data: {
      ...(text?.trim() ? { body: text.trim() } : {}),
      ...(mentions ? { mentions } : {}),
    },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });

  void pusherTrigger(`private-canvas-${existing.workflowId}`, "canvas-comment:updated", { comment });

  return NextResponse.json({ comment });
}

// DELETE /api/comments/[commentId] — delete comment
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });

  const { commentId } = await params;
  const existing = await prisma.canvasComment.findUnique({ where: { id: commentId } });
  if (!existing || existing.authorId !== session.user.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 403 });
  }

  await prisma.canvasComment.delete({ where: { id: commentId } });

  void pusherTrigger(`private-canvas-${existing.workflowId}`, "canvas-comment:deleted", { commentId });

  return NextResponse.json({ success: true });
}
